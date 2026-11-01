import { expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { createApp } from "../../apps/server/src/app.js";
import { hash } from "../../apps/server/src/db.js";
import { MonitoringVideoProcess } from "../../apps/server/src/monitoring-video-process.js";

// Existing authenticated legacy transport/capture is synthetic here; no real
// student, SSH session, root authority bypass or production service is involved.
async function fixture(fault=false) {
  const dir=mkdtempSync(join(tmpdir(),"video-http-isolation-")),origin="http://127.0.0.1";
  const running=await createApp({mode:"development",origin,data:dir,port:0,maintenance:false,
    jump:{host:"localhost",port:2222,pins:["0".repeat(64)]},
    class:{host:"localhost",port:2223,pins:["1".repeat(64)]},
    agent:{id:"class",signingKey:"/unused",callbackPublicKey:"/unused"}},
    fault?{videoWorkerEntry:new URL("../fixtures/faulting-video-worker.ts",import.meta.url),videoTimeoutMs:1000}:{});
  const {app,store}=running,ended=Date.now()-60000,id=fault?"kill":randomUUID(),frame=randomUUID(),live=randomUUID(),page=randomUUID();
  store.db.exec("INSERT INTO exams VALUES('synthetic-video','{}')");
  store.db.prepare(`INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline,ended,protected,checksum,access_state)
    VALUES(?,'synthetic-video','historical-synthetic',1001,'COMPLETED','{}',?,?,?,?,1,?,'HELD')`)
    .run(id,ended-60000,ended,ended,ended,"a".repeat(64));
  const data=await sharp({create:{width:320,height:180,channels:3,background:"#345678"}}).jpeg({quality:75}).toBuffer();
  const directory=join(dir,"monitoring",id);mkdirSync(directory,{mode:0o700});
  writeFileSync(join(directory,frame+".jpg"),data,{mode:0o600});
  writeFileSync(join(directory,frame+".thumb.jpg"),data,{mode:0o600});
  store.db.prepare("INSERT INTO frames VALUES(?,?,?,?,?,?,?,?,?,?,?)")
    .run(frame,id,"screen",1,"historical-page",ended-5000,1,ended-4999,320,180,hash(data));
  const start=Date.now(),deadline=start+600000;
  store.db.prepare(`INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline,page_hash,last_contact,access_state)
    VALUES(?,'synthetic-video','live-synthetic',1002,'ACTIVE','{"webcam":false}',?,?,?,?,?,'HELD')`)
    .run(live,start,deadline,deadline,hash(page),start);
  writeFileSync(join(dir,"submissions/protected"),"PROTECTED",{mode:0o600});
  const instructor=store.session("admin","synthetic-teacher",null),student=store.session("student","live-synthetic","synthetic-video");
  const admin={origin,cookie:`session=${instructor.token}`,"x-csrf-token":instructor.csrf};
  const liveHeaders={origin,cookie:`session=${student.token}`,"x-csrf-token":student.csrf,"x-page-instance":page};
  const before=store.attempt(live),historical=store.attempt(id);
  const optimize=()=>app.inject({method:"POST",url:`/api/admin/attempts/${id}/monitoring/optimization`,headers:admin,
    payload:{action:"request",requestID:randomUUID()}});
  const status=async()=>{
    const response=await app.inject({url:`/api/admin/attempts/${id}/monitoring`,headers:admin});
    expect(response.statusCode,response.body).toBe(200);return response.json().optimization;
  };
  const activeCapture=async()=>{
    const started=Date.now();
    const health=await app.inject({url:"/health/live"});expect(health.statusCode,health.body).toBe(200);
    const response=await app.inject({method:"POST",url:`/api/student/attempts/${live}/frames`,headers:liveHeaders,
      payload:{source:"screen",seq:1,captured:Date.now(),monotonic:123,data:data.toString("base64")}});
    expect(response.statusCode,response.body).toBe(200);expect(response.json().hash).toBe(hash(data));
    expect(Date.now()-started).toBeLessThan(2000);
    expect(store.attempt(live)).toEqual(before);expect(store.attempt(id)).toEqual(historical);
    expect(store.db.prepare("SELECT * FROM incidents").all()).toEqual([]);
    expect(store.db.prepare("SELECT * FROM outbox").all()).toEqual([]);
  };
  return {...running,dir,id,frame,data,directory,optimize,status,activeCapture,
    async close(){expect(readFileSync(join(dir,"submissions/protected"),"utf8")).toBe("PROTECTED");await app.close();rmSync(dir,{recursive:true,force:true});}};
}

it("a codec worker exit leaves public capture/health responsive, held accounts and deadlines unchanged, and every original retained",async()=>{
  const f=await fixture(true);
  try {
    const response=await f.optimize();expect(response.statusCode,response.body).toBe(200);
    await vi.waitFor(async()=>expect((await f.status()).status).toBe("retry"),{timeout:5000,interval:100});
    await f.activeCapture();
    expect(readFileSync(join(f.directory,f.frame+".jpg"))).toEqual(f.data);
    expect((await f.status()).converted_frames).toBe(0);
  } finally {await f.close();}
},15000);

it("a stalled asynchronous durability barrier blocks original deletion while public capture proceeds; real sync then completes safely",async()=>{
  const original=MonitoringVideoProcess.prototype.sync;
  let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const barrier=vi.spyOn(MonitoringVideoProcess.prototype,"sync").mockImplementation(async function(this:MonitoringVideoProcess){
    await gate;await original.call(this);
  });
  const f=await fixture();
  try {
    const response=await f.optimize();expect(response.statusCode,response.body).toBe(200);
    await vi.waitFor(()=>expect(barrier).toHaveBeenCalled(),{timeout:5000,interval:50});
    expect(readFileSync(join(f.directory,f.frame+".jpg"))).toEqual(f.data);
    await f.activeCapture();release();
    await vi.waitFor(async()=>expect((await f.status()).status).toBe("complete"),{timeout:5000,interval:100});
    expect(existsSync(join(f.directory,f.frame+".jpg"))).toBe(false);
  } finally {release();barrier.mockRestore();await f.close();}
},15000);
