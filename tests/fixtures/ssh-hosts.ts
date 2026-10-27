// Development simulation only. Commands use student SSH; no separate agent listener.
import { hosts } from "./hosts.js";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { sign } from "node:crypto";
import path from "node:path";
import { Store, hash, now } from "../../apps/server/src/db.js";
const dir = path.resolve("var/demo");
mkdirSync(dir, { recursive: true, mode: 0o700 });
const h = await hosts();
const dbDir = path.resolve("var/app");
const store = new Store(dbDir);
const exam = {
  id: "sample",
  name: "Development programming exam",
  earliest: now() - 60000,
  latest: now() + 86400000,
  duration: 5400,
  webcam: false,
  terminals: 4,
  template: "sample-exam",
};
store.db
  .prepare("INSERT OR IGNORE INTO exams VALUES(?,?)")
  .run(exam.id, JSON.stringify(exam));
store.db
  .prepare("INSERT OR IGNORE INTO enrollments VALUES(?,?,?,?,?,?)")
  .run("sample", "student01", null, null, "Disposable student", 10001);
store.close();
const statePath = dir + "/agent-state.json";
const state = existsSync(statePath)
  ? JSON.parse(readFileSync(statePath, "utf8"))
  : { attempts: [], events: [], sequence: 0, exports: [] };
const attempts = new Map<string, any>(state.attempts);
for (const [id, a] of attempts) h.attempts.set(id, a);
const save = () => {
  state.attempts = [...attempts];
  writeFileSync(statePath, JSON.stringify(state), { mode: 0o600 });
};
const accounts = { student01: 10001, student02: 10002, student03: 10003 };
const health = {
  ready: true,
  fixture: true,
  capabilities: ["recovery-allowance-sync-v1"],
  warning: "Simulation; no native account or process isolation",
};
const manifest = (a: any) =>
  JSON.parse(readFileSync(`${dir}/${a.id}.manifest.json`, "utf8"));
const enqueue = (a?: any) => {
  state.events.push({
    agent: "class",
    sequence: ++state.sequence,
    at: now(),
    ...(a
      ? { attempt: { ...a }, manifest: a.protected ? manifest(a) : undefined }
      : { health, accounts }),
  });
  save();
};
const collect = (a: any, reason: string) => {
  if (a.protected) return;
  Object.assign(a, {
    state: "COMPLETED",
    ended: reason === "expiration" ? a.deadline : now(),
    reason,
    completed_at: now(),
    collected_at: now(),
    secured_at: now(),
    protected: true,
    access_state: a.exam === "sandbox" ? "RELEASED" : "HELD",
  });
  const work = `${dir}/saved-${a.id}`;
  mkdirSync(work, { recursive: true, mode: 0o700 });
  writeFileSync(work + "/answer.txt", a.saved || "No saved fixture work");
  execFileSync("/usr/bin/tar", [
    "-czf",
    `${dir}/${a.id}.tar.gz`,
    "-C",
    work,
    "answer.txt",
  ]);
  a.checksum = hash(readFileSync(`${dir}/${a.id}.tar.gz`));
  writeFileSync(
    `${dir}/${a.id}.manifest.json`,
    JSON.stringify({
      attempt: { ...a },
      files: [],
      omissions: [],
      collected: a.collected_at,
      secured: a.secured_at,
      checksum: a.checksum,
    }),
  );
  enqueue(a);
};
h.control.command = async (op, b) => {
  if (op === "register") {
    if (b.continuation) {
      const a = attempts.get(b.continuation.id);
      if (!a || a.state === "COMPLETED") throw Error("Attempt cannot resume");
      if (a.state === "ACTIVE") {
        a.state = "LOCKED";
        a.generation++;
      }
      if (a.generation !== b.continuation.generation)
        throw Error("Stale continuation");
      a.authorization = b.continuation.expires;
    }
    return {};
  }
  if (op.startsWith("issue-")) return h.agent.call(op, b);
  if (op === "health") return health;
  if (op === "reconcile-recovery-allowance")
    return { version: 1, recovery: null }; // This simulator has no legacy recovery catalog.
  if (op === "resolve-course-accounts") {
    if (b.usernames.some((n: string) => !(n in accounts)))
      throw Error("Unknown fixture account");
    return Object.fromEntries(
      b.usernames.map((n: keyof typeof accounts) => [n, accounts[n]]),
    );
  }
  if (op === "prepare-attempt") {
    if (!attempts.has(b.id)) {
      const a = { ...b, state: "PREPARING", generation: 0 };
      attempts.set(b.id, a);
      h.attempts.set(b.id, a);
      enqueue(a);
    }
    return attempts.get(b.id);
  }
  const a = attempts.get(b.id);
  if (!a) throw Error("Unknown fixture attempt");
  switch (op) {
    case "activate-attempt":
      if (!a.start) {
        Object.assign(a, {
          state: "ACTIVE",
          start: now(),
          deadline: now() + a.settings.duration * 1000,
          work_path: "/work",
          access_state: "HELD",
        });
      }
      break;
    case "lock-attempt":
      if (a.state === "ACTIVE") {
        a.state = "LOCKED";
        a.generation++;
      }
      break;
    case "attach-transport":
      if (a.state !== "LOCKED") throw Error("Not locked");
      a.transport = b.transport;
      a.resumeTransport = b.transport;
      break;
    case "consume-continuation":
      if (!a.resumeTransport) throw Error("Fresh SSH required");
      a.state = "ACTIVE";
      break;
    case "cancel-attempt":
      if (a.start) throw Error("Already started");
      a.state = "CANCELLED_BEFORE_START";
      break;
    case "finalize-attempt":
      collect(a, b.reason || "student finish");
      return a;
    case "submission-manifest":
      return manifest(a);
    case "inspect-attempt":
    case "submission-status":
    case "renew-execution-lease":
      return a;
    default:
      throw Error("Unsupported fixture operation");
  }
  enqueue(a);
  return a;
};
const origin = "http://localhost:3000";
let delivering = false;
const post = async (url: string, payload: Buffer, bytes = payload) => {
  const archive = bytes !== payload;
  const response = await fetch(origin + url, {
    method: "POST",
    headers: {
      "content-type": archive
        ? "application/gzip"
        : "application/vnd.ssh-exam-event",
      "x-exam-signature": sign(null, payload, h.callbackKey).toString("base64"),
      ...(archive ? { "x-exam-receipt": payload.toString("base64") } : {}),
    },
    body: new Uint8Array(bytes),
  });
  if (!response.ok) throw Error("Callback pending");
};
const timer = setInterval(() => {
  for (const a of attempts.values()) {
    if (a.start && a.deadline <= now() && !a.protected)
      collect(a, "expiration");
    if (
      a.state === "COMPLETED" &&
      a.access_state === "HELD" &&
      a.deadline <= now()
    ) {
      a.access_state = "RELEASED";
      enqueue(a);
    }
  }
  if (delivering) return;
  delivering = true;
  void (async () => {
    while (state.events.length) {
      const payload = Buffer.from(JSON.stringify(state.events[0]));
      await post("/api/agent/events", payload);
      state.events.shift();
      save();
    }
    for (const a of attempts.values())
      if (a.protected && !state.exports.includes(a.id)) {
        const payload = Buffer.from(
          JSON.stringify({
            agent: "class",
            attempt: a.id,
            checksum: a.checksum,
          }),
        );
        await post(
          "/api/agent/submissions/" + a.id,
          payload,
          readFileSync(`${dir}/${a.id}.tar.gz`),
        );
        state.exports.push(a.id);
        save();
      }
  })()
    .catch(() => {})
    .finally(() => (delivering = false));
}, 1000);
enqueue();
writeFileSync(
  dir + "/config.json",
  JSON.stringify(
    {
      mode: "development",
      origin,
      data: dbDir,
      port: 3000,
      jump: h.jump,
      class: h.class,
      agent: h.agentConfig,
    },
    null,
    2,
  ),
  { mode: 0o600 },
);
console.log(
  "Disposable SSH fixtures ready. Configuration: var/demo/config.json. This simulation provides no production isolation.",
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    clearInterval(timer);
    void h.close().then(() => process.exit());
  });
