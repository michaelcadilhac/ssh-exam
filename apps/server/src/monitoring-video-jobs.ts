import { randomUUID } from "node:crypto";
import { constants, lstatSync } from "node:fs";
import { setImmediate as yieldIO } from "node:timers/promises";
import {
  open,
  mkdir,
  rename,
  unlink,
  rmdir,
  lstat,
  readdir,
  type FileHandle,
} from "node:fs/promises";
import { resolve } from "node:path";
import { hash, now, type Store } from "./db.js";
import {
  monitoringOptimize,
  monitoringOptimization,
} from "../../../packages/protocol/monitoring-video.js";
import {
  MonitoringVideoProcess,
  MonitoringVideoError,
  type VideoRunInput,
} from "./monitoring-video-process.js";

const refuse = (message: string, statusCode = 409): never => {
  throw Object.assign(Error(message), { statusCode });
};
const eligible = (store: Store, id: string) => {
  const a = store.db
    .prepare("SELECT state,start,ended FROM attempts WHERE id=?")
    .get(id) as { state: string; start: number | null; ended: number | null } | undefined;
  return !!a && a.state === "COMPLETED" && a.start !== null && a.ended !== null &&
    !store.db.prepare("SELECT 1 FROM tombstones WHERE attempt=?").get(id);
};

export function monitoringVideoDeploymentPaused(store: Pick<Store,"dir">) {
  try {
    lstatSync(resolve(store.dir,"monitoring-video-deploy.pause"));
    return true;
  } catch(error) {
    // An unsafe/uncertain installer marker pauses background conversion only.
    // It never changes student login, monitoring, clocks or account holds.
    return (error as NodeJS.ErrnoException).code !== "ENOENT";
  }
}

export function monitoringVideoStatus(store: Store, id: string) {
  if (!store.db.prepare("SELECT 1 FROM attempts WHERE id=?").get(id))
    return refuse("Attempt not found; refresh the exam's attempt list", 404);
  if (store.db.prepare("SELECT 1 FROM tombstones WHERE attempt=?").get(id))
    return monitoringOptimization.parse({ status: "deleted", eligible: false, frames: 0,
      converted_frames: 0, remaining_frames: 0, segments: 0, source_bytes: 0,
      video_bytes: 0, verified_at: null, error: null });
  const frames = (store.db.prepare("SELECT COUNT(*) n FROM frames WHERE attempt=?").get(id) as any).n;
  const converted = (store.db.prepare(`SELECT COUNT(*) n FROM monitoring_video_frames v
    JOIN frames f ON f.id=v.frame WHERE f.attempt=?`).get(id) as any).n;
  const sizes = store.db.prepare(`SELECT COUNT(*) segments,COALESCE(SUM(source_bytes),0) source_bytes,
    COALESCE(SUM(bytes),0) video_bytes FROM monitoring_video_segments WHERE attempt=?`).get(id) as any;
  const job = store.db.prepare("SELECT status,verified,error FROM monitoring_video_jobs WHERE attempt=?").get(id) as any;
  const allowed = eligible(store, id);
  const paused = allowed && monitoringVideoDeploymentPaused(store);
  return monitoringOptimization.parse({status: allowed ? paused && !["running","complete"].includes(job?.status)
      ? "paused" : job?.status ?? "not-queued" : "ineligible",
    eligible: allowed, frames, converted_frames: converted, remaining_frames: frames-converted,
    ...sizes, verified_at: job?.verified ?? null, error: paused ? "deployment-paused" : job?.error ?? null});
}

// A durable technical intent, independent of exam/grant/account authority.
// Cached receipts acknowledge the same intent, never manufacture fresh status.
export function requestMonitoringOptimization(store: Store, input: unknown, actor: string) {
  const body = monitoringOptimize.parse(input);
  const digest = hash(JSON.stringify({id: body.id, action: body.action, actor}));
  return store.db.transaction(() => {
    const old = store.db.prepare("SELECT input_hash,result FROM monitoring_video_requests WHERE id=?")
      .get(body.requestID) as {input_hash:string;result:string}|undefined;
    if (old) {
      if (old.input_hash !== digest)
        return refuse("Optimization request conflicts with an earlier intent; inspect monitoring show and use a new request");
      return JSON.parse(old.result);
    }
    if (!eligible(store, body.id))
      return refuse("Only completed, retained exam recordings can be optimized. No live capture, clock or account restriction changed");
    const at = now();
    // Preserve the existing thirty-second final-capture upload period.
    const next = Math.max(at,store.attempt(body.id).ended!+30000);
    if (body.action === "cancel") {
      store.db.prepare(`INSERT INTO monitoring_video_jobs(attempt,status,next,updated)
        VALUES(?,'paused',?,?) ON CONFLICT(attempt) DO UPDATE SET
        status='paused',
        owner=NULL,error=NULL,updated=excluded.updated`).run(body.id,at,at);
    } else {
      store.db.prepare(`INSERT INTO monitoring_video_jobs(attempt,status,next,updated)
        VALUES(?,'pending',?,?) ON CONFLICT(attempt) DO UPDATE SET
        status=CASE WHEN status IN ('running','complete') THEN status ELSE 'pending' END,
        next=excluded.next,error=NULL,updated=excluded.updated`).run(body.id,next,at);
    }
    const result = {id:body.id,action:body.action,accepted:true};
    store.audit(actor,"monitoring-optimize-"+body.action,body.id,JSON.stringify({requestID:body.requestID}));
    store.db.prepare("INSERT INTO monitoring_video_requests VALUES(?,?,?,?,?,?,?)")
      .run(body.requestID,body.id,body.action,at,actor,digest,JSON.stringify(result));
    return result;
  })();
}

type Frame = {id:string;attempt:string;source:"screen"|"webcam";hash:string;captured:number;width:number;height:number;[key:string]:unknown};
const directoryFlags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
const fileFlags = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
async function privateDirectory(path: string) {
  const fd = await open(path, directoryFlags);
  const info = await fd.stat();
  if (!info.isDirectory() || info.uid !== process.geteuid?.() || (info.mode & 0o077)) {
    await fd.close();
    throw new MonitoringVideoError("unsafe-target");
  }
  return fd;
}
async function inspectFile(path: string, optional = false) {
  let fd: FileHandle;
  try { fd = await open(path, fileFlags); }
  catch (error) { if (optional && (error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  try {
    const info = await fd.stat();
    if (!info.isFile() || info.nlink !== 1 || info.uid !== process.geteuid?.() || (info.mode & 0o077))
      throw new MonitoringVideoError("unsafe-target");
    return info;
  } finally { await fd.close(); }
}

// One coordinator per gateway. Durable owner UUIDs fence cancellation/restart;
// the encoder's inherited kernel lock additionally excludes orphan workers.
export class MonitoringVideoJobs {
  private process: MonitoringVideoProcess;
  private active?: Promise<void>;
  private stopped = false;
  private unsettled?: { attempt: string; owner: string };
  constructor(private store: Store, private options: {
    entry?: URL; timeoutMs?: number; onFailure?: (code:string)=>void;
  } = {}) {
    this.process = new MonitoringVideoProcess(store, options);
    store.db.prepare(`UPDATE monitoring_video_jobs SET status='pending',owner=NULL,next=?,updated=?,
      error='coordinator-restarted' WHERE status='running'`).run(now(),now());
  }
  kick() {
    if (this.stopped) return Promise.resolve();
    if (this.active) return this.active;
    if (monitoringVideoDeploymentPaused(this.store)) return Promise.resolve();
    const task = (async()=>{
      do {
        if(this.stopped || monitoringVideoDeploymentPaused(this.store))return;
        await this.runOne();
        if(this.stopped || monitoringVideoDeploymentPaused(this.store))return;
        await yieldIO();
      } while(this.store.db.prepare(`SELECT 1 FROM monitoring_video_jobs
        WHERE status IN ('pending','retry') AND next<=? LIMIT 1`).get(now()));
    })().catch(() => this.report("job-store-unavailable"));
    this.active = task;
    void task.finally(() => { if (this.active === task) this.active = undefined; });
    return task;
  }
  private report(code: string) { try { this.options.onFailure?.(code); } catch { /* diagnostics are not authority */ } }
  private owns(id: string, owner: string) {
    return eligible(this.store,id) && !!this.store.db.prepare(
      "SELECT 1 FROM monitoring_video_jobs WHERE attempt=? AND owner=? AND status='running'",
    ).get(id,owner);
  }
  private async verifyClips(attempt:FileHandle,clips:Iterable<{segment:string;sha256:string;bytes:number}>) {
    for (const clip of clips) {
      const path = `/proc/self/fd/${attempt.fd}/${clip.segment}.webm`;
      const info = await inspectFile(path);
      if (!info || info.size !== clip.bytes || info.size > 32*1024*1024)
        throw new MonitoringVideoError("digest");
      const file = await open(path,fileFlags);
      try {
        const bytes = await file.readFile();
        const after = await file.stat();
        if (bytes.length !== info.size || after.size !== info.size || after.mtimeMs !== info.mtimeMs ||
            after.ctimeMs !== info.ctimeMs || hash(bytes) !== clip.sha256)
          throw new MonitoringVideoError("digest");
      } finally { await file.close(); }
    }
  }
  private async cleanupWork(id:string,attempt:FileHandle,exclude?:string) {
    const names=(await readdir(`/proc/self/fd/${attempt.fd}`,{withFileTypes:true}))
      .filter(entry=>entry.isDirectory()&&/^\.video-work-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(entry.name)&&entry.name!==exclude)
      .map(entry=>entry.name);
    if(!names.length)return;
    const clips=this.store.db.prepare("SELECT id segment,sha256,bytes FROM monitoring_video_segments WHERE attempt=?")
      .all(id) as {segment:string;sha256:string;bytes:number}[];
    await this.verifyClips(attempt,clips);
    // Acquiring this worker's encode lock proves no old producer still owns a
    // work directory. These reserved directories contain copies, never originals.
    await this.process.sync();
    if(!eligible(this.store,id))return;
    for(const name of names)await this.removeWork(`/proc/self/fd/${attempt.fd}/${name}`);
    await attempt.sync();
  }
  private async removeWork(path:string) {
    const leaf=path.split("/").at(-1)!;
    if(!/^\.video-work-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(leaf))
      throw new MonitoringVideoError("unsafe-target");
    let fd:FileHandle;
    try {fd=await privateDirectory(path);}
    catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return;throw error;}
    try {
      const identity=await fd.stat(),pinned=`/proc/self/fd/${fd.fd}`;
      const entries=await readdir(pinned,{withFileTypes:true});
      if(entries.length>64||entries.some(entry=>entry.isDirectory()))
        throw new MonitoringVideoError("unexpected-work-directory");
      for(const entry of entries) {
        try {await unlink(`${pinned}/${entry.name}`);}
        catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
      }
      const current=await lstat(path);
      if(!current.isDirectory()||current.dev!==identity.dev||current.ino!==identity.ino)
        throw new MonitoringVideoError("unsafe-target");
      await rmdir(path);
    } finally {await fd.close();}
  }
  private async cleanupMapped(id:string, attempt:FileHandle) {
    const mappings = this.store.db.prepare(`SELECT f.id,f.hash,s.id segment,s.sha256,s.bytes FROM frames f
      JOIN monitoring_video_frames v ON v.frame=f.id JOIN monitoring_video_segments s ON s.id=v.segment
      WHERE f.attempt=? AND s.attempt=? AND s.cleaned IS NULL`).all(id,id) as {id:string;hash:string;segment:string;sha256:string;bytes:number}[];
    // Verify every referenced replacement before removing any redundant JPEG.
    // This matters after a crash between publishing metadata and cleanup.
    await this.verifyClips(attempt,new Map(mappings.map(m => [m.segment,m])).values());
    // SQLite WAL/NORMAL commit is not a durability barrier. The separate worker
    // syncs WAL, database and parent directory without blocking this event loop
    // or opening/closing SQLite database descriptors in the owning PID.
    if(mappings.length) await this.process.sync();
    for (const frame of mappings) {
      if (!eligible(this.store,id)) return;
      const original = `/proc/self/fd/${attempt.fd}/${frame.id}.jpg`;
      const info = await inspectFile(original,true);
      if (info) {
        if (info.size > 1500000) throw new MonitoringVideoError("source-changed");
        const fd = await open(original,fileFlags);
        try {
          const bytes = await fd.readFile();
          const after = await fd.stat();
          if (bytes.length !== info.size || after.size !== info.size || after.mtimeMs !== info.mtimeMs ||
              after.ctimeMs !== info.ctimeMs || hash(bytes) !== frame.hash)
            throw new MonitoringVideoError("source-changed");
        } finally { await fd.close(); }
        if (!eligible(this.store,id)) return;
        await unlink(original);
      }
      const thumbnail = `/proc/self/fd/${attempt.fd}/${frame.id}.thumb.jpg`;
      if (await inspectFile(thumbnail,true)) {
        if (!eligible(this.store,id)) return;
        await unlink(thumbnail);
      }
    }
    await attempt.sync();
    if (eligible(this.store,id))
      this.store.db.transaction(() => {
        for (const segment of new Set(mappings.map(m=>m.segment)))
          this.store.db.prepare("UPDATE monitoring_video_segments SET cleaned=? WHERE id=? AND attempt=?")
            .run(now(),segment,id);
      })();
  }
  private async runOne() {
    if (this.unsettled) {
      this.store.db.prepare(`UPDATE monitoring_video_jobs SET status='retry',owner=NULL,next=?,updated=?,
        error='metadata-commit-unconfirmed' WHERE attempt=? AND owner=? AND status='running'`)
        .run(now(),now(),this.unsettled.attempt,this.unsettled.owner);
      this.unsettled = undefined;
    }
    const owner = randomUUID();
    const job = this.store.db.transaction(() => {
      this.store.db.prepare(`INSERT OR IGNORE INTO monitoring_video_jobs(attempt,status,next,updated)
        SELECT a.id,'pending',MAX(?,a.ended+30000),? FROM attempts a WHERE a.state='COMPLETED' AND a.start IS NOT NULL
        AND a.ended IS NOT NULL AND NOT EXISTS(SELECT 1 FROM tombstones t WHERE t.attempt=a.id)
        AND NOT EXISTS(SELECT 1 FROM monitoring_video_jobs j WHERE j.attempt=a.id) LIMIT 100`).run(now(),now());
      // Uploads accepted before the final-capture cutoff can finish later.
      // Never lose those rows or leave their images permanently unprocessed.
      this.store.db.prepare(`UPDATE monitoring_video_jobs SET status='pending',owner=NULL,
        next=MAX(?,(SELECT ended+30000 FROM attempts WHERE id=monitoring_video_jobs.attempt)),updated=?,verified=NULL
        WHERE status='complete' AND EXISTS(SELECT 1 FROM frames f WHERE f.attempt=monitoring_video_jobs.attempt
          AND NOT EXISTS(SELECT 1 FROM monitoring_video_frames v WHERE v.frame=f.id))
        AND attempt IN (SELECT id FROM attempts WHERE state='COMPLETED' AND start IS NOT NULL AND ended IS NOT NULL)
        AND attempt NOT IN (SELECT attempt FROM tombstones)`).run(now(),now());
      this.store.db.prepare(`UPDATE monitoring_video_jobs SET status='deleted',owner=NULL,error=NULL,updated=?
        WHERE status<>'deleted' AND attempt IN (SELECT attempt FROM tombstones)`).run(now());
      const row = this.store.db.prepare(`SELECT attempt,tries FROM monitoring_video_jobs
        WHERE status IN ('pending','retry') AND next<=? ORDER BY next,attempt LIMIT 1`)
        .get(now()) as {attempt:string;tries:number}|undefined;
      if (!row) return;
      this.store.db.prepare(`UPDATE monitoring_video_jobs SET status='running',owner=?,tries=MIN(tries+1,2147483647),
        updated=?,error=NULL WHERE attempt=?`).run(owner,now(),row.attempt);
      return row;
    })();
    if (!job) return;
    this.unsettled = {attempt:job.attempt,owner};
    const handles: FileHandle[] = [];
    let stage: string | undefined;
    let published: string | undefined;
    let committed = false;
    try {
      if (!this.owns(job.attempt,owner)) throw new MonitoringVideoError("ineligible");
      const first = this.store.db.prepare(`SELECT f.* FROM frames f
        WHERE f.attempt=? AND NOT EXISTS(SELECT 1 FROM monitoring_video_frames v WHERE v.frame=f.id)
        ORDER BY f.received,f.id LIMIT 1`).get(job.attempt) as Frame|undefined;
      if (!first && !(this.store.db.prepare(`SELECT 1 FROM monitoring_video_frames v
        JOIN frames f ON f.id=v.frame WHERE f.attempt=? LIMIT 1`).get(job.attempt))) {
        this.store.db.prepare(`UPDATE monitoring_video_jobs SET status='complete',owner=NULL,error=NULL,
          updated=?,verified=? WHERE attempt=? AND owner=?`).run(now(),now(),job.attempt,owner);
        return;
      }
      const root = await privateDirectory(resolve(this.store.dir,"monitoring")); handles.push(root);
      const attempt = await privateDirectory(`/proc/self/fd/${root.fd}/${job.attempt}`); handles.push(attempt);
      await this.cleanupMapped(job.attempt,attempt);
      if (!first) {
        await this.cleanupWork(job.attempt,attempt);
        if (this.owns(job.attempt,owner)) {
          this.store.db.prepare(`UPDATE monitoring_video_jobs SET status='complete',owner=NULL,error=NULL,
            updated=?,verified=? WHERE attempt=? AND owner=?`).run(now(),now(),job.attempt,owner);
        }
        return;
      }
      const frames = this.store.db.prepare(`SELECT f.* FROM frames f WHERE f.attempt=? AND f.source=? AND f.width=? AND f.height=?
        AND NOT EXISTS(SELECT 1 FROM monitoring_video_frames v WHERE v.frame=f.id) ORDER BY f.received,f.id LIMIT 12`)
        .all(job.attempt,first.source,first.width,first.height) as Frame[];
      const segment = randomUUID();
      const work = resolve(this.store.dir,"monitoring",job.attempt,".video-work-"+segment);
      stage = `/proc/self/fd/${attempt.fd}/.video-work-${segment}`;
      await mkdir(stage,{mode:0o700});
      const stageFD = await privateDirectory(stage); handles.push(stageFD);
      let sourceBytes = 0;
      for (const frame of frames) {
        sourceBytes += (await inspectFile(`/proc/self/fd/${attempt.fd}/${frame.id}.jpg`))!.size;
        sourceBytes += (await inspectFile(`/proc/self/fd/${attempt.fd}/${frame.id}.thumb.jpg`,true))?.size ?? 0;
      }
      const input: VideoRunInput = {attempt:job.attempt,segment,source:first.source,work,
        frames:frames.map(({id,hash,captured,width,height})=>({id,hash,captured,width,height}))};
      const result = await this.process.run(input);
      if (!this.owns(job.attempt,owner)) return;
      published = `/proc/self/fd/${attempt.fd}/${result.file}`;
      await rename(`/proc/self/fd/${stageFD.fd}/${result.file}`,published);
      const output = await open(published,fileFlags);
      try { await output.sync(); } finally { await output.close(); }
      await attempt.sync(); await stageFD.sync();
      this.store.db.transaction(() => {
        if (!this.owns(job.attempt,owner)) throw new MonitoringVideoError("stale-result");
        for (const frame of frames) {
          const current = this.store.db.prepare("SELECT * FROM frames WHERE id=?").get(frame.id);
          if (JSON.stringify(current) !== JSON.stringify(frame)) throw new MonitoringVideoError("source-changed");
          if (this.store.db.prepare("SELECT 1 FROM monitoring_video_frames WHERE frame=?").get(frame.id))
            throw new MonitoringVideoError("stale-result");
        }
        const at = now();
        this.store.db.prepare(`INSERT INTO monitoring_video_segments
          (id,attempt,source,sha256,bytes,width,height,frame_count,source_bytes,created,verified)
          VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
          .run(segment,job.attempt,result.source,result.sha256,result.bytes,result.width,result.height,
            result.frames.length,sourceBytes,at,at);
        for (const frame of result.frames)
          this.store.db.prepare("INSERT INTO monitoring_video_frames VALUES(?,?,?,?)")
            .run(frame.id,segment,frame.index,frame.decoded_sha256);
        this.store.audit("system:monitoring-video","monitoring-video-verified",job.attempt,
          JSON.stringify({segment,frames:result.frames.map(f=>f.id),sha256:result.sha256,bytes:result.bytes,source_bytes:sourceBytes}));
      })();
      committed = true;
      await this.cleanupMapped(job.attempt,attempt);
      await this.cleanupWork(job.attempt,attempt,`.video-work-${segment}`);
      if (this.owns(job.attempt,owner))
        this.store.db.prepare(`UPDATE monitoring_video_jobs SET status='pending',owner=NULL,next=?,updated=?,error=NULL
          WHERE attempt=? AND owner=?`).run(now(),now(),job.attempt,owner);
    } catch (error) {
      const code = error instanceof MonitoringVideoError ? error.code : "storage";
      this.store.db.prepare(`UPDATE monitoring_video_jobs SET status='retry',owner=NULL,next=?,updated=?,error=?
        WHERE attempt=? AND owner=? AND status='running'`).run(now()+(code==="capacity"?2000:30000),now(),code.slice(0,80),job.attempt,owner);
      this.report(code);
    } finally {
      if (published && !committed) {
        // Commit acknowledgement may be uncertain. Preserve a referenced clip;
        // only a proven-unreferenced output can be discarded.
        try {
          const segment = published.split("/").at(-1)!.replace(/\.webm$/,"");
          if (!this.store.db.prepare("SELECT 1 FROM monitoring_video_segments WHERE id=?").get(segment))
            await unlink(published).catch(()=>{});
        } catch { /* retain uncertain output for verified retry/purge */ }
      }
      if (stage) await this.removeWork(stage).catch(()=>this.report("work-cleanup-unverified"));
      for (const fd of handles.reverse()) await fd.close().catch(()=>{});
    }
  }
  async close() {
    this.stopped = true;
    await this.process.close();
    await this.active;
  }
}
