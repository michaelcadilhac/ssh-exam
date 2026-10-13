// Disposable application/SSH/media load harness. The privileged control plane is simulated.
// It cannot certify native containment, institutional SSH, browser permissions or production capacity.
import { createApp } from "../apps/server/src/app.js";
import { Agent } from "../apps/server/src/agent.js";
import { hosts } from "./fixtures/hosts.js";
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  readdirSync,
  statSync,
} from "node:fs";
import { cpus, totalmem, tmpdir, release } from "node:os";
import { randomBytes, randomUUID } from "node:crypto";
import sharp from "sharp";
import WebSocket from "ws";
const count = Number(process.env.LOAD_STUDENTS || 100),
  duration = Number(process.env.LOAD_SECONDS || 10);
if (
  !Number.isInteger(count) ||
  count < 1 ||
  count > 100 ||
  !Number.isInteger(duration) ||
  duration < 5 ||
  duration > 120
)
  throw Error("Fixture bounds: 1–100 students, 5–120 seconds");
const h = await hosts(),
  remote = new Map<string, any>(),
  originalCall = Agent.prototype.call;
const fixtureCall = async function (op: string, b: any = {}): Promise<any> {
  if (op === "register") {
    if (b.continuation) {
      const a = remote.get(b.continuation.id);
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
  if (op === "health") return { ready: true, fixture: true };
  if (op === "prepare-attempt") {
    if (!remote.has(b.id))
      remote.set(b.id, { ...b, state: "PREPARING", generation: 0 });
    return remote.get(b.id);
  }
  const a = remote.get(b.id);
  if (!a) throw Error("Unknown fixture");
  if (op === "activate-attempt" && !a.start) {
    a.start = Date.now();
    a.deadline = a.start + 5400000;
    a.work_path = "/work";
    a.state = "ACTIVE";
  }
  if (op === "lock-attempt") {
    a.state = "LOCKED";
    a.generation++;
  }
  return a;
};
h.control.command = fixtureCall;
const dir = mkdtempSync(tmpdir() + "/exam-load-"),
  origin = "http://127.0.0.1:3200";
const { app, store } = await createApp({
  mode: "development",
  origin,
  data: dir,
  port: 3200,
  jump: h.jump,
  class: h.class,
  agent: h.agentConfig,
  maintenance: false,
});
app.log.level = "silent";
store.db
  .prepare("INSERT INTO agent_snapshot VALUES(?,?,?)")
  .run(
    "class",
    1,
    JSON.stringify({ health: { ready: true, fixture: true }, accounts: {} }),
  );
const exam = {
  id: "load",
  name: "Disposable load fixture",
  earliest: Date.now() - 10000,
  latest: Date.now() + 86400000,
  duration: 5400,
  webcam: true,
  terminals: 4,
  template: "sample-exam",
};
store.db
  .prepare("INSERT INTO exams VALUES(?,?)")
  .run("load", JSON.stringify(exam));
for (let i = 0; i < count; i++)
  store.db
    .prepare("INSERT INTO enrollments VALUES(?,?,?,?,?,?)")
    .run("load", "student" + i, null, null, null, 10000 + i);
await app.listen({ host: "127.0.0.1", port: 3200 });
const jpeg = await sharp(randomBytes(800 * 450 * 3), {
  raw: { width: 800, height: 450, channels: 3 },
})
  .jpeg({ quality: 75 })
  .toBuffer();
const latencies: number[] = [],
  errors: string[] = [],
  clients: WebSocket[] = [],
  timers: ReturnType<typeof setInterval>[] = [];
let outputBytes = 0,
  uploads = 0;
const sleep = (n: number) => new Promise((r) => setTimeout(r, n));
async function student(i: number) {
  let cookies = new Map<string, string>(),
    csrf = "";
  const request = async (url: string, body: any = {}, page?: string) => {
    const started = performance.now();
    const res = await fetch(origin + "/api" + url, {
      method: "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        Cookie: [...cookies].map(([k, v]) => k + "=" + v).join("; "),
        "X-CSRF-Token": csrf,
        ...(page ? { "X-Page-Instance": page } : {}),
      },
      body: JSON.stringify(body),
    });
    latencies.push(performance.now() - started);
    for (const cookie of res.headers.getSetCookie()) {
      const first = cookie.split(";")[0],
        eq = first.indexOf("=");
      cookies.set(first.slice(0, eq), first.slice(eq + 1));
    }
    const result = await res.json();
    if (!res.ok) throw Error(res.status + " " + result.error);
    return result;
  };
  await request("/auth/start");
  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(
      origin.replace("http", "ws") + "/api/auth/dialogue",
      {
        headers: {
          Origin: origin,
          Cookie: [...cookies].map(([k, v]) => k + "=" + v).join("; "),
        },
      },
    );
    clients.push(ws);
    ws.on("open", () =>
      ws.send(
        JSON.stringify({
          v: 1,
          type: "start",
          exam: "load",
          username: "student" + i,
        }),
      ),
    );
    ws.on("error", reject);
    ws.on("message", (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.type === "challenge" && m.prompts.length)
        ws.send(
          JSON.stringify({
            v: 1,
            type: "answers",
            round: m.round,
            answers: m.prompts.map(() => "shared-password"),
          }),
        );
      if (m.type === "authenticated") {
        ws.close();
        resolve();
      }
      if (m.type === "error") reject(Error(m.error));
    });
  });
  csrf = (await request("/auth/complete")).csrf;
  const r = await request("/student/preflight");
  let screen = 0,
    webcam = 0;
  const upload = async (source: string) => {
    await request(
      "/student/attempts/" + r.id + "/frames",
      {
        source,
        seq: source === "screen" ? ++screen : ++webcam,
        captured: Date.now(),
        monotonic: performance.now(),
        data: jpeg.toString("base64"),
      },
      r.page,
    );
    uploads++;
  };
  await upload("screen");
  await upload("webcam");
  const ready = {
    fullscreen: true,
    focus: true,
    visible: true,
    keyboard: true,
    screen: true,
    webcam: true,
  };
  await request("/student/attempts/" + r.id + "/begin", ready, r.page);
  const ws = new WebSocket(
    origin.replace("http", "ws") + "/api/student/session",
    {
      headers: {
        Origin: origin,
        Cookie: [...cookies].map(([k, v]) => k + "=" + v).join("; "),
      },
    },
  );
  clients.push(ws);
  const panes = Array.from({ length: 4 }, () => randomUUID());
  let bound = false;
  ws.on("message", (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === "state" && !bound) {
      bound = true;
      for (const pane of panes)
        ws.send(JSON.stringify({ v: 1, type: "open", pane }));
    }
    if (m.type === "output") outputBytes += Buffer.byteLength(m.data, "base64");
    if (m.type === "error") errors.push(m.error);
  });
  ws.on("error", (err) => errors.push(err.message));
  await new Promise<void>((resolve) =>
    ws.on("open", () => {
      ws.send(
        JSON.stringify({ v: 1, type: "bind", attempt: r.id, page: r.page }),
      );
      resolve();
    }),
  );
  timers.push(
    setInterval(() => {
      if (ws.readyState === WebSocket.OPEN)
        ws.send(JSON.stringify({ v: 1, type: "heartbeat", ready }));
    }, 2000),
  );
  timers.push(
    setInterval(
      () => {
        void upload("screen").catch((e) => errors.push(e.message));
        void upload("webcam").catch((e) => errors.push(e.message));
      },
      5000 + (i % 10) * 20,
    ),
  );
  return r.id;
}
const started = performance.now();
let next = 0;
await Promise.all(
  Array.from({ length: 8 }, async () => {
    while (next < count) {
      const i = next++;
      try {
        await student(i);
      } catch (e) {
        errors.push("student" + i + ": " + (e as Error).message);
      }
    }
  }),
);
await sleep(duration * 1000);
const states = store.db
    .prepare("SELECT state,COUNT(*) count FROM attempts GROUP BY state")
    .all(),
  frameCount = (
    store.db.prepare("SELECT COUNT(*) count FROM frames").get() as any
  ).count;
function bytes(p: string): number {
  return readdirSync(p, { withFileTypes: true }).reduce(
    (total, f) =>
      total +
      (f.isDirectory()
        ? bytes(p + "/" + f.name)
        : statSync(p + "/" + f.name).size),
    0,
  );
}
latencies.sort((a, b) => a - b);
const percentile = (p: number) =>
  latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))] ||
  0;
const report = {
  label: "DISPOSABLE FIXTURE LOAD; NO PRODUCTION CAPACITY OR GUARD CLAIM",
  date: new Date().toISOString(),
  hardware: {
    cpu: cpus()[0]?.model,
    logicalCPUs: cpus().length,
    memoryBytes: totalmem(),
    kernel: release(),
  },
  target: {
    students: count,
    panesPerStudent: 4,
    streamsPerStudent: 2,
    captureSeconds: 5,
    durationSeconds: duration,
    jpegBytes: jpeg.length,
    width: 800,
    height: 450,
  },
  measured: {
    elapsedSeconds: (performance.now() - started) / 1000,
    requests: latencies.length,
    latencyMs: {
      p50: percentile(0.5),
      p95: percentile(0.95),
      p99: percentile(0.99),
    },
    ssh: h.counts,
    uploads,
    frameCount,
    outputBytes,
    privateStorageBytes: bytes(dir),
    states,
    errors: errors.slice(0, 100),
    errorCount: errors.length,
  },
  limitations: [
    "Simulated privileged control path and browser condition reports",
    "Small synthetic 800x450 JPEG, not readability/camera evidence",
    "No real editors, namespace/cgroup workloads, SMTP or reverse proxy",
  ],
};
writeFileSync("docs/load-report.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
for (const timer of timers) clearInterval(timer);
for (const ws of clients) ws.close();
await sleep(100);
await app.close();
await h.close();
Agent.prototype.call = originalCall;
rmSync(dir, { recursive: true, force: true });
