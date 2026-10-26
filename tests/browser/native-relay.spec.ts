// Diagnostic only: measure the guarded private test relay, not work permission.
import { test, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";

const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
test("measure private callback relay without starting student attempts", async ({
  request,
}, info) => {
  const bundle = process.env.EXAM_BROWSER_NATIVE_BUNDLE;
  test.skip(!bundle, "Requires the guarded disposable native fixture");
  test.setTimeout(45000);
  expect(bundle).toMatch(
    /^\/var\/tmp\/ssh-exam-browser-native-upload\.[A-Za-z0-9_]+$/,
  );
  const metadata = await (
    await request.get("/api/fixture/native-ready")
  ).json();
  expect(metadata.privateGuest).toBe(true);
  expect(metadata.log).toMatch(
    /^\/tmp\/ssh-exam-browser-native-[A-Za-z0-9]+\/native-root\.log$/,
  );
  const log = await readFile(metadata.log, "utf8");
  const stage = log.match(
    /Private test evidence: (\/var\/tmp\/ssh-exam-overlay-[a-z0-9_]+)\n/,
  )?.[1];
  expect(stage).toBeTruthy();
  const code = `
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from collections import Counter
import base64,json,runpy,socket,stat,sys,threading,time
stage=Path(sys.argv[1]);bundle=Path(sys.argv[2])
bridge=runpy.run_path(str(bundle/'browser_bridge.py'))
# Reuse the actual root/private-mode/profile/active-owned-unit guard. Metadata
# is public test identity only. No native key, frame or grant is read or logged.
bridge['host_bridge'](stage,'metadata')
target=stage/'output/http.sock';i=target.lstat()
assert stat.S_ISSOCK(i.st_mode) and i.st_uid==0 and i.st_mode&0o777==0o600
barrier=threading.Barrier(32,timeout=3)
def probe(index):
 start=time.monotonic()
 try:
  with socket.socket(socket.AF_UNIX) as client:
   client.settimeout(6);client.connect(str(target));barrier.wait()
   start=time.monotonic()
   with client.makefile('rwb',buffering=0) as stream:
    # Deliberately invalid signature: the real gateway MUST reject this before
    # parsing monitoring/attempt state. This measures transport, not authority.
    bridge['send'](stream,{'path':'/api/agent/monitoring-evidence',
     'headers':{'Content-Type':'application/vnd.ssh-exam-event','X-Exam-Signature':base64.b64encode(bytes(64)).decode()},
     'body':base64.b64encode(json.dumps({'private_transport_probe':index}).encode()).decode()})
    reply=bridge['line'](stream)
  return {'ms':round((time.monotonic()-start)*1000),'status':reply.get('status'),'bridge_error':reply.get('bridge_error')}
 except Exception as error:return {'ms':round((time.monotonic()-start)*1000),'error':type(error).__name__}
with ThreadPoolExecutor(max_workers=32) as pool:results=list(pool.map(probe,range(32)))
times=sorted(r['ms'] for r in results)
print(json.dumps({'requests':len(results),'minimum_ms':times[0],'p50_ms':times[16],'p95_ms':times[30],'maximum_ms':times[-1],
 'replies':dict(Counter(str(r.get('status') or r.get('bridge_error') or r.get('error')) for r in results))}))
`;
  const { stdout } = await promisify(execFile)(
    "ssh",
    [
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=10",
      "csc-sys",
      ["sudo", "-n", "python3", "-c", code, stage!, bundle!]
        .map(quote)
        .join(" "),
    ],
    { timeout: 25000, maxBuffer: 65536 },
  );
  const result = z
    .object({
      requests: z.literal(32),
      minimum_ms: z.number().int().nonnegative(),
      p50_ms: z.number().int().nonnegative(),
      p95_ms: z.number().int().nonnegative(),
      maximum_ms: z.number().int().nonnegative(),
      replies: z.record(z.string(), z.number().int().positive()),
    })
    .strict()
    .parse(JSON.parse(stdout.trim().split("\n").at(-1)!));
  expect(Object.values(result.replies).reduce((a, b) => a + b, 0)).toBe(32);
  expect(
    Object.keys(result.replies).some((status) => /^2\d\d$/.test(status)),
  ).toBe(false);
  await mkdir(info.outputDir, { recursive: true });
  const file = info.outputPath("private-relay-measurement.json");
  await writeFile(file, JSON.stringify(result, null, 2), { mode: 0o600 });
  await info.attach("private-relay-measurement", {
    path: file,
    contentType: "application/json",
  });
  // An observed timeout is diagnostic evidence, never a monitoring pass. The
  // fixture teardown aborts this unstarted guest and verifies preservation.
});
