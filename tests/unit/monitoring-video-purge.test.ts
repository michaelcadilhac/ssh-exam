import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, symlinkSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../../apps/server/src/db.js";
import { Monitoring } from "../../apps/server/src/monitoring.js";
import { MonitoringPurgeJobs, monitoringPurgeStatus } from "../../apps/server/src/monitoring-purge-jobs.js";

function fixture() {
  const store=new Store(mkdtempSync(join(tmpdir(),"video-purge-"))),monitoring=new Monitoring(store);
  const id=randomUUID(),directory=join(store.dir,"monitoring",id),work=join(directory,".video-work-"+randomUUID());
  store.db.exec("INSERT INTO exams VALUES('synthetic-video','{}')");
  store.db.prepare("INSERT INTO attempts(id,exam,username,uid,state,settings,ended) VALUES(?,'synthetic-video','synthetic',1001,'COMPLETED','{}',?)").run(id,Date.now());
  mkdirSync(work,{recursive:true,mode:0o700});
  const protectedFile=join(store.dir,"submissions/protected");
  writeFileSync(protectedFile,"PROTECTED",{mode:0o600});
  return {store,monitoring,id,directory,work,protectedFile,close(){expect(readFileSync(protectedFile,"utf8")).toBe("PROTECTED");store.close();rmSync(store.dir,{recursive:true,force:true});}};
}

it("physically purges flat videos and recognized one-level work files without following a staging symlink",async()=>{
  const f=fixture(),jobs=new MonitoringPurgeJobs(f.store);
  try {
    writeFileSync(join(f.directory,randomUUID()+".webm"),"synthetic clip",{mode:0o600});
    writeFileSync(join(f.work,"input.jpg"),"synthetic input",{mode:0o600});
    writeFileSync(join(f.work,"manifest.json"),"synthetic manifest",{mode:0o600});
    symlinkSync(f.protectedFile,join(f.work,"outside-link"));
    const before=f.store.attempt(f.id);
    f.monitoring.delete(f.id,"teacher");await jobs.kick();
    expect(monitoringPurgeStatus(f.store,f.id).status).toBe("verified-absent");
    expect(existsSync(f.directory)).toBe(false);
    expect(f.store.attempt(f.id)).toEqual(before);
  } finally {await jobs.close();f.close();}
});

it("continues to refuse arbitrary directories and deeper nesting rather than broadly recursing",async()=>{
  for(const recognized of [true,false]){
    const f=fixture(),jobs=new MonitoringPurgeJobs(f.store);
    try {
      const nested=recognized?join(f.work,"unrecognized-nesting"):join(f.directory,"unrecognized-work");
      mkdirSync(nested,{mode:0o700});writeFileSync(join(nested,"private"),"retained on refusal",{mode:0o600});
      f.monitoring.delete(f.id,"teacher");await jobs.kick();
      expect(monitoringPurgeStatus(f.store,f.id)).toMatchObject({status:"retry",error:"unexpected-directory"});
      expect(existsSync(nested)).toBe(true);
      expect(f.store.db.prepare("SELECT 1 FROM tombstones WHERE attempt=?").get(f.id)).toBeTruthy();
    } finally {await jobs.close();f.close();}
  }
});

it("refuses a recognized work directory with unsafe permissions while deletion remains enforced",async()=>{
  const f=fixture(),jobs=new MonitoringPurgeJobs(f.store);
  try {
    const fs=await import("node:fs/promises");await fs.chmod(f.work,0o755);
    f.monitoring.delete(f.id,"teacher");await jobs.kick();
    expect(monitoringPurgeStatus(f.store,f.id).status).toBe("retry");
    expect(existsSync(f.work)).toBe(true);
    expect(f.store.db.prepare("SELECT 1 FROM tombstones WHERE attempt=?").get(f.id)).toBeTruthy();
  } finally {await jobs.close();f.close();}
});
