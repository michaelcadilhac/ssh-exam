import { expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, unlinkSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { Store, hash } from "../../apps/server/src/db.js";
import { Monitoring } from "../../apps/server/src/monitoring.js";
import { MonitoringMedia } from "../../apps/server/src/monitoring-media.js";
import { MonitoringVideoProcess, MonitoringVideoError } from "../../apps/server/src/monitoring-video-process.js";
import { MonitoringVideoJobs, monitoringVideoStatus, requestMonitoringOptimization } from "../../apps/server/src/monitoring-video-jobs.js";

async function fixture(count=3) {
  const store = new Store(mkdtempSync(join(tmpdir(),"video-jobs-")));
  const monitoring = new Monitoring(store);
  const attempt = randomUUID(), ended=Date.now()-60000;
  store.db.exec("INSERT INTO exams VALUES('synthetic-video','{}')");
  store.db.prepare(`INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline,ended,protected,checksum)
    VALUES(?,'synthetic-video','synthetic',1001,'COMPLETED','{}',?,?,?,?,1,?)`)
    .run(attempt,ended-60000,ended,ended,ended,"a".repeat(64));
  const directory=join(store.dir,"monitoring",attempt);
  mkdirSync(directory,{recursive:true,mode:0o700});
  const originals=new Map<string,Buffer>();
  for(let n=0;n<count;n++) {
    const id=randomUUID(),captured=ended-5000*(count-n);
    const data=await sharp(Buffer.from(`<svg width="320" height="180"><rect width="320" height="180" fill="#234567"/><text x="12" y="36" fill="white">Synthetic capture ${n}</text></svg>`)).jpeg({quality:75}).toBuffer();
    const thumb=await sharp(data).resize({width:256}).jpeg().toBuffer();
    writeFileSync(join(directory,id+".jpg"),data,{mode:0o600});
    writeFileSync(join(directory,id+".thumb.jpg"),thumb,{mode:0o600});
    originals.set(id,data);
    store.db.prepare("INSERT INTO frames VALUES(?,?,?,?,?,?,?,?,?,?,?)")
      .run(id,attempt,"screen",n,"synthetic-page",captured,n*5000,captured+1,320,180,hash(data));
  }
  writeFileSync(join(store.dir,"submissions/protected"),"PROTECTED-SYNTHETIC-WORK",{mode:0o600});
  const beforeAttempt=store.attempt(attempt),beforeFrames=store.db.prepare("SELECT * FROM frames ORDER BY id").all();
  const request=(action:"request"|"retry"|"cancel"="request",requestID=randomUUID())=>
    requestMonitoringOptimization(store,{id:attempt,action,requestID},"teacher");
  return {store,monitoring,attempt,directory,originals,request,beforeAttempt,beforeFrames,
    close(){expect(readFileSync(join(store.dir,"submissions/protected"),"utf8")).toBe("PROTECTED-SYNTHETIC-WORK");store.close();rmSync(store.dir,{recursive:true,force:true});}};
}

it("converts completed captures to verified video, serves derived JPEGs, removes duplicates only after durable mapping and preserves all authority", async()=>{
  const f=await fixture(),jobs=new MonitoringVideoJobs(f.store),media=new MonitoringMedia(f.store);
  try {
    expect(f.request()).toMatchObject({id:f.attempt,action:"request",accepted:true});
    await jobs.kick();await jobs.kick();
    expect(monitoringVideoStatus(f.store,f.attempt)).toMatchObject({status:"complete",frames:3,converted_frames:3,remaining_frames:0,segments:1,error:null});
    expect(f.store.attempt(f.attempt)).toEqual(f.beforeAttempt);
    expect(f.store.db.prepare("SELECT * FROM frames ORDER BY id").all()).toEqual(f.beforeFrames);
    for(const[id,bytes]of f.originals){
      expect(existsSync(join(f.directory,id+".jpg"))).toBe(false);
      expect(existsSync(join(f.directory,id+".thumb.jpg"))).toBe(false);
      const image=await media.read(id,false,"teacher",f.attempt);
      expect(image.provenance).toMatchObject({encoding:"vp9-webm-v1",capture_sha256:hash(bytes),capture_width:320,capture_height:180});
      expect((await sharp(image.data).metadata()).width).toBe(320);
      expect(hash(image.data)).not.toBe(hash(bytes));
    }
  } finally {await media.close();await jobs.close();f.close();}
},20000);

it("makes optimization intents idempotent and pauses future work without removing captures or changing clocks",async()=>{
  const f=await fixture(),jobs=new MonitoringVideoJobs(f.store);
  try {
    const requestID=randomUUID(),first=f.request("request",requestID);
    expect(f.request("request",requestID)).toEqual(first);
    expect(()=>f.request("cancel",requestID)).toThrow("conflicts");
    f.request("cancel");await jobs.kick();
    expect(monitoringVideoStatus(f.store,f.attempt).status).toBe("paused");
    for(const id of f.originals.keys())expect(existsSync(join(f.directory,id+".jpg"))).toBe(true);
    expect(f.store.attempt(f.attempt)).toEqual(f.beforeAttempt);
    f.request("retry");await jobs.kick();await jobs.kick();
    expect(monitoringVideoStatus(f.store,f.attempt).status).toBe("complete");
  } finally {await jobs.close();f.close();}
},15000);

it("preserves the final upload window and notices a late completed capture instead of losing it",async()=>{
  const f=await fixture(1),jobs=new MonitoringVideoJobs(f.store);
  try {
    f.store.db.prepare("UPDATE attempts SET ended=? WHERE id=?").run(Date.now(),f.attempt);
    f.request();await jobs.kick();
    expect(monitoringVideoStatus(f.store,f.attempt).converted_frames).toBe(0);
    expect((f.store.db.prepare("SELECT next FROM monitoring_video_jobs WHERE attempt=?").get(f.attempt) as any).next).toBeGreaterThan(Date.now());
    f.store.db.prepare("UPDATE attempts SET ended=? WHERE id=?").run(Date.now()-60000,f.attempt);
    f.store.db.prepare("UPDATE monitoring_video_jobs SET next=0 WHERE attempt=?").run(f.attempt);
    await jobs.kick();await jobs.kick();
    const id=randomUUID(),data=[...f.originals.values()][0];
    writeFileSync(join(f.directory,id+".jpg"),data,{mode:0o600});
    writeFileSync(join(f.directory,id+".thumb.jpg"),data,{mode:0o600});
    f.store.db.prepare("INSERT INTO frames VALUES(?,?,?,?,?,?,?,?,?,?,?)")
      .run(id,f.attempt,"screen",99,"late-page",Date.now()-50000,999,Date.now(),320,180,hash(data));
    await jobs.kick();await jobs.kick();
    expect(monitoringVideoStatus(f.store,f.attempt)).toMatchObject({status:"complete",frames:2,converted_frames:2,remaining_frames:0});
    expect(existsSync(join(f.directory,id+".jpg"))).toBe(false);
    f.request("cancel");
    const pausedFrame=randomUUID();
    writeFileSync(join(f.directory,pausedFrame+".jpg"),data,{mode:0o600});
    writeFileSync(join(f.directory,pausedFrame+".thumb.jpg"),data,{mode:0o600});
    f.store.db.prepare("INSERT INTO frames VALUES(?,?,?,?,?,?,?,?,?,?,?)")
      .run(pausedFrame,f.attempt,"screen",100,"later-page",Date.now()-49000,1000,Date.now(),320,180,hash(data));
    await jobs.kick();
    expect(monitoringVideoStatus(f.store,f.attempt)).toMatchObject({status:"paused",frames:3,converted_frames:2,remaining_frames:1});
    expect(existsSync(join(f.directory,pausedFrame+".jpg"))).toBe(true);
  } finally {await jobs.close();f.close();}
},15000);

it("keeps every original when publication metadata fails, then supports a repaired retry",async()=>{
  const f=await fixture(),jobs=new MonitoringVideoJobs(f.store);
  try {
    f.request();
    f.store.db.exec("CREATE TRIGGER fail_video BEFORE INSERT ON monitoring_video_segments BEGIN SELECT RAISE(ABORT,'synthetic disk metadata failure'); END");
    await jobs.kick();
    expect(monitoringVideoStatus(f.store,f.attempt).status).toBe("retry");
    expect(f.store.db.prepare("SELECT * FROM monitoring_video_frames").all()).toEqual([]);
    for(const[id,data]of f.originals)expect(readFileSync(join(f.directory,id+".jpg"))).toEqual(data);
    f.store.db.exec("DROP TRIGGER fail_video");f.request("retry");
    await jobs.kick();await jobs.kick();
    expect(monitoringVideoStatus(f.store,f.attempt).status).toBe("complete");
  } finally {await jobs.close();f.close();}
},15000);

it("reverifies a durable clip before crash-retry cleanup, preserving originals if the clip is corrupt",async()=>{
  const f=await fixture(1),jobs=new MonitoringVideoJobs(f.store);
  try {
    f.request();await jobs.kick();
    const segment=f.store.db.prepare("SELECT * FROM monitoring_video_segments").get() as any;
    const path=join(f.directory,segment.id+".webm"),verified=readFileSync(path);
    for(const[id,data]of f.originals){writeFileSync(join(f.directory,id+".jpg"),data,{mode:0o600});writeFileSync(join(f.directory,id+".thumb.jpg"),data,{mode:0o600});}
    f.store.db.exec("UPDATE monitoring_video_segments SET cleaned=NULL");
    f.store.db.exec("UPDATE monitoring_video_jobs SET status='pending',next=0,verified=NULL");
    writeFileSync(path,Buffer.from("synthetic corrupt derivative"));
    await jobs.kick();
    expect(monitoringVideoStatus(f.store,f.attempt)).toMatchObject({status:"retry",error:"digest"});
    for(const[id,data]of f.originals)expect(readFileSync(join(f.directory,id+".jpg"))).toEqual(data);
    writeFileSync(path,verified);f.request("retry");await jobs.kick();
    expect(monitoringVideoStatus(f.store,f.attempt).status).toBe("complete");
    for(const id of f.originals.keys())expect(existsSync(join(f.directory,id+".jpg"))).toBe(false);
  } finally {await jobs.close();f.close();}
},15000);

it("deletion cancels the derivative path and scrubs mappings while preserving protected work/history",async()=>{
  const f=await fixture(),jobs=new MonitoringVideoJobs(f.store),media=new MonitoringMedia(f.store);
  try {
    f.request();await jobs.kick();
    f.monitoring.delete(f.attempt,"teacher");
    expect(monitoringVideoStatus(f.store,f.attempt)).toMatchObject({status:"deleted",frames:0,converted_frames:0,remaining_frames:0,segments:0});
    expect(f.store.db.prepare("SELECT * FROM monitoring_video_segments").all()).toEqual([]);
    expect(f.store.db.prepare("SELECT * FROM monitoring_video_frames").all()).toEqual([]);
    await expect(media.read([...f.originals.keys()][0],false,"teacher")).rejects.toThrow("not found");
    expect(f.store.attempt(f.attempt)).toEqual(f.beforeAttempt);
  } finally {await media.close();await jobs.close();f.close();}
},15000);

it("a bounded export session serves each segment once and fences deletion even for buffered frames",async()=>{
  const f=await fixture(12),jobs=new MonitoringVideoJobs(f.store),media=new MonitoringMedia(f.store);
  const session=media.createReadSession();
  const batches=vi.spyOn(MonitoringVideoProcess.prototype,"frames");
  try {
    f.request();await jobs.kick();await jobs.kick();
    for(const id of f.originals.keys()){
      expect((await session.read(id,false,"teacher",f.attempt)).provenance?.encoding).toBe("vp9-webm-v1");
      expect((await session.read(id,true,"teacher",f.attempt)).data.length).toBeGreaterThan(1);
    }
    expect(batches).toHaveBeenCalledTimes(1);
    const last=[...f.originals.keys()].at(-1)!;
    expect((await session.read(last,false,"teacher",f.attempt)).data)
      .toEqual((await media.read(last,false,"teacher",f.attempt)).data);
    f.monitoring.delete(f.attempt,"teacher");
    await expect(session.read([...f.originals.keys()][0],false,"teacher",f.attempt)).rejects.toThrow();
    session.close();
    await expect(session.read([...f.originals.keys()][0],false,"teacher",f.attempt)).rejects.toThrow();
  } finally {batches.mockRestore();session.close();await media.close();await jobs.close();f.close();}
},20000);

it("never removes originals when the separate metadata durability barrier fails, then retries the same verified mapping",async()=>{
  const f=await fixture(1),jobs=new MonitoringVideoJobs(f.store);
  const barrier=vi.spyOn(MonitoringVideoProcess.prototype,"sync").mockRejectedValueOnce(new MonitoringVideoError("sync-unavailable"));
  try {
    expect(f.store.db.pragma("synchronous",{simple:true})).toBe(1);
    f.request();await jobs.kick();
    expect(monitoringVideoStatus(f.store,f.attempt)).toMatchObject({status:"retry",converted_frames:1,error:"sync-unavailable"});
    for(const[id,data]of f.originals)expect(readFileSync(join(f.directory,id+".jpg"))).toEqual(data);
    const before=f.store.db.prepare("SELECT * FROM monitoring_video_segments").all();
    barrier.mockRestore();f.request("retry");await jobs.kick();
    expect(monitoringVideoStatus(f.store,f.attempt).status).toBe("complete");
    expect(f.store.db.prepare("SELECT id,sha256 FROM monitoring_video_segments").all())
      .toEqual((before as any[]).map(({id,sha256})=>({id,sha256})));
    for(const id of f.originals.keys())expect(existsSync(join(f.directory,id+".jpg"))).toBe(false);
    expect(f.store.attempt(f.attempt)).toEqual(f.beforeAttempt);
  } finally {barrier.mockRestore();await jobs.close();f.close();}
},15000);

it("an installer pause suppresses all background writes and conversion until its marker is removed",async()=>{
  const f=await fixture(1),jobs=new MonitoringVideoJobs(f.store),marker=join(f.store.dir,"monitoring-video-deploy.pause");
  try {
    writeFileSync(marker,"synthetic installer marker",{mode:0o600});
    await jobs.kick();
    expect(f.store.db.prepare("SELECT * FROM monitoring_video_jobs").all()).toEqual([]);
    f.request();const before=f.store.db.prepare("SELECT * FROM monitoring_video_jobs").all();
    await jobs.kick();
    expect(f.store.db.prepare("SELECT * FROM monitoring_video_jobs").all()).toEqual(before);
    expect(monitoringVideoStatus(f.store,f.attempt)).toMatchObject({status:"paused",error:"deployment-paused",converted_frames:0});
    for(const[id,data]of f.originals)expect(readFileSync(join(f.directory,id+".jpg"))).toEqual(data);
    unlinkSync(marker);await jobs.kick();
    expect(monitoringVideoStatus(f.store,f.attempt)).toMatchObject({status:"complete",error:null,converted_frames:1});
    expect(f.store.attempt(f.attempt)).toEqual(f.beforeAttempt);
  } finally {await jobs.close();f.close();}
},15000);

it("recovers copied work after a completed-publication crash without following links or discarding the last good copy of a corrupt video",async()=>{
  const f=await fixture(1),jobs=new MonitoringVideoJobs(f.store);
  try {
    f.request();await jobs.kick();
    const segment=f.store.db.prepare("SELECT id FROM monitoring_video_segments").get() as any;
    const clip=join(f.directory,segment.id+".webm"),verified=readFileSync(clip);
    const old=join(f.directory,".video-work-"+randomUUID());mkdirSync(old,{mode:0o700});
    const copy=join(old,"copied-input.jpg");writeFileSync(copy,[...f.originals.values()][0],{mode:0o600});
    symlinkSync(join(f.store.dir,"submissions/protected"),join(old,"external-link"));
    f.store.db.exec("UPDATE monitoring_video_jobs SET status='pending',next=0,verified=NULL");
    writeFileSync(clip,"synthetic disk corruption");await jobs.kick();
    expect(monitoringVideoStatus(f.store,f.attempt)).toMatchObject({status:"retry",error:"digest"});
    expect(readFileSync(copy)).toEqual([...f.originals.values()][0]);
    writeFileSync(clip,verified);f.request("retry");await jobs.kick();
    expect(monitoringVideoStatus(f.store,f.attempt).status).toBe("complete");
    expect(existsSync(old)).toBe(false);
    expect(readFileSync(join(f.store.dir,"submissions/protected"),"utf8")).toBe("PROTECTED-SYNTHETIC-WORK");
  } finally {await jobs.close();f.close();}
},15000);
