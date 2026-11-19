import { it, expect } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

it("the passive browser observer survives actual tsx serialization without a missing name helper", async () => {
  const source = fileURLToPath(
    new URL("../fixtures/wasm-bootstrap-diagnostics.ts", import.meta.url),
  );
  const code = `
  import vm from 'node:vm';
  import {observeWasmBootstrap} from ${JSON.stringify(source)};
  let script;
  const page={on(){},async addInitScript(value){script=value},async evaluate(){return realm.window.__examBootstrapEvents}};
  const observe=await observeWasmBootstrap(page);
  class Base { listeners=new Map();addEventListener(kind,fn){this.listeners.set(kind,fn)} }
  const realm={window:{Worker:Base}};
  vm.runInNewContext(typeof script==='string'?script:'('+script.toString()+')()',realm);
  const worker=new realm.window.Worker('private-worker.js',{type:'module'});
  worker.listeners.get('message')({data:{type:'ready'}});
  const result=await observe();
  if(JSON.stringify(result.worker)!==JSON.stringify([{event:'created',worker:1},{event:'ready',worker:1}]))throw Error('Observer did not retain ordinary readiness');
  console.log('TSX_OBSERVER_SERIALIZATION_OK');
 `;
  const result = await promisify(execFile)(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", code],
    { timeout: 10000 },
  );
  expect(result.stdout).toContain("TSX_OBSERVER_SERIALIZATION_OK");
});
