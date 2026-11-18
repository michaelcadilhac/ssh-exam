// Disposable real-FD fault probe. Only this child process changes its limits;
// all keys, data and signed requests are synthetic. No listener/native host/MFA.
import { execFileSync } from "node:child_process";
import { generateKeyPairSync, randomBytes, sign, verify } from "node:crypto";
import {
  closeSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import assert from "node:assert/strict";
import { createApp } from "../../apps/server/src/app.js";
import { ExamDefinitions } from "../../apps/server/src/exam-definitions.js";
import { grantExam } from "./grant-exam.js";

const [soft, mode] = process.argv.slice(2);
assert(["128", "524288"].includes(soft) && ["exhaust", "hold"].includes(mode));
const data = mkdtempSync(tmpdir() + "/policy-fd-probe-"),
  native = generateKeyPairSync("ed25519"),
  gateway = generateKeyPairSync("ed25519");
writeFileSync(
  data + "/native.pub",
  native.publicKey.export({ type: "spki", format: "pem" }),
);
writeFileSync(
  data + "/gateway.key",
  gateway.privateKey.export({ type: "pkcs8", format: "pem" }),
  { mode: 0o600 },
);
const { app, store, life } = await createApp({
  mode: "development",
  origin: "http://localhost:3000",
  data,
  port: 0,
  maintenance: false,
  jump: { host: "localhost", port: 2222, pins: ["0".repeat(64)] },
  class: { host: "localhost", port: 2223, pins: ["1".repeat(64)] },
  agent: {
    id: "class",
    signingKey: data + "/gateway.key",
    callbackPublicKey: data + "/native.pub",
  },
});
grantExam(store, "descriptor-probe");
new ExamDefinitions(store, "class");
const tables = [
  "exams",
  "exam_lifecycle",
  "enrollments",
  "attempts",
  "attempt_grants",
  "grant_claims",
  "grant_begin_intents",
  "clock_reset_requests",
  "agent_events",
  "agent_snapshot",
  "audit",
];
const authority = () =>
  JSON.stringify(
    tables.map((table) => [
      table,
      store.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
    ]),
  );
const request = async () => {
  const nonce = randomBytes(32).toString("hex"),
    payload = Buffer.from(
      JSON.stringify({
        agent: "class",
        exam: "descriptor-probe",
        nonce,
        at: Date.now(),
      }),
    );
  const response = await app.inject({
    method: "POST",
    url: "/api/agent/exam-execution-policy",
    headers: {
      "content-type": "application/vnd.ssh-exam-event",
      "x-exam-signature": sign(null, payload, native.privateKey).toString(
        "base64",
      ),
    },
    payload,
  });
  const body = response.json();
  const valid =
    response.statusCode === 200 &&
    verify(
      null,
      Buffer.from(body.payload, "base64"),
      gateway.publicKey,
      Buffer.from(body.signature, "base64"),
    ) &&
    JSON.parse(Buffer.from(body.payload, "base64").toString()).nonce === nonce;
  return { status: response.statusCode, valid, error: body.error };
};
const held: number[] = [];
let armed = false,
  filled = 0,
  exhausted = "",
  signingError = "";
const release = () => {
  for (const fd of held.splice(0)) closeSync(fd);
};
const originalVerify = life.agent.verifyCallback.bind(life.agent),
  originalSign = life.agent.signTiming.bind(life.agent);
life.agent.verifyCallback = (...args) => {
  originalVerify(...args); // The real callback signature must pass first.
  if (!armed) return;
  // Model descriptors acquired by concurrent IO after authentication. A bounded
  // child-only exhaustion uses real kernel EMFILE, never a mocked signer error.
  for (let n = 0; n < (mode === "exhaust" ? 1024 : 1100); n++) {
    try {
      held.push(openSync("/dev/null", "r"));
    } catch (error) {
      exhausted = (error as NodeJS.ErrnoException).code ?? "unknown";
      if (exhausted !== "EMFILE") throw error;
      break;
    }
  }
  filled = held.length;
};
life.agent.signTiming = (...args) => {
  try {
    return originalSign(...args);
  } catch (error) {
    signingError = (error as NodeJS.ErrnoException).code ?? "unknown";
    throw error;
  } finally {
    release();
  }
};
try {
  const before = authority(),
    baseline = await request();
  assert.equal(baseline.status, 200);
  assert(baseline.valid);
  // Load the whole application before lowering this exact child’s soft limit.
  // Python targets only its verified parent; no service/host setting is changed.
  execFileSync("python3", [
    "-c",
    "import os,resource,sys; p=int(sys.argv[1]); assert p==os.getppid(); _,h=resource.prlimit(p,resource.RLIMIT_NOFILE); resource.prlimit(p,resource.RLIMIT_NOFILE,(int(sys.argv[2]),h))",
    String(process.pid),
    soft!,
  ]);
  const limits = readFileSync("/proc/self/limits", "utf8")
    .split("\n")
    .find((line) => line.startsWith("Max open files"));
  const baselineFDs = readdirSync("/proc/self/fd").length;
  armed = true;
  const pressured = await request();
  release();
  armed = false;
  const retried = await request();
  assert.equal(retried.status, 200);
  assert(retried.valid);
  assert.equal(authority(), before);
  console.log(
    "POLICY_FD_RESULT " +
      JSON.stringify({
        baseline,
        pressured,
        retried,
        filled,
        exhausted,
        signingError,
        limits,
        baselineFDs,
        authorityUnchanged: true,
      }),
  );
} finally {
  release();
  await app.close();
  rmSync(data, { recursive: true, force: true });
}
