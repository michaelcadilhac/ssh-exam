// Browser fixtures only; this file is excluded from the production server build.
import { createApp } from "../../apps/server/src/app.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import argon2 from "argon2";
import { hosts } from "../fixtures/hosts.js";
import { sign } from "node:crypto";
import { verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { WebSocketServer } from "ws";
import net from "node:net";
import { hash } from "../../apps/server/src/db.js";
const h = await hosts();
const timezoneAccounts = Object.fromEntries(
  Array.from({ length: 7 }, (_, i) => [`timezone${i + 1}`, 11001 + i]),
);
const browserMode = process.env.EXAM_BROWSER_SSH === "1";
const relay = browserMode
  ? new WebSocketServer({ port: 3101, host: "127.0.0.1" })
  : null;
if (relay) {
  relay.on("connection", (ws, req) => {
    if (req.headers.origin !== "http://localhost:3100") {
      ws.close(1008);
      return;
    }
    ws.once("message", (data) => {
      const f = JSON.parse(data.toString()),
        b = Buffer.from(f.payload, "base64"),
        t = JSON.parse(b.toString());
      if (
        t.audience !== "fixture-relay" ||
        t.expires <= Date.now() ||
        !verify(
          null,
          b,
          readFileSync(h.agentConfig.signingKey),
          Buffer.from(f.signature, "base64"),
        )
      ) {
        ws.close(1008);
        return;
      }
      const upstream = net.connect(h.jump.port, h.jump.host, () =>
        ws.send('{"ready":true}'),
      );
      ws.on("message", (bytes, binary) => {
        if (!binary) {
          ws.close(1008);
          return;
        }
        upstream.write(bytes as Buffer);
      });
      upstream.on("data", (bytes) => ws.send(bytes, { binary: true }));
      upstream.on("error", () => ws.close());
      ws.on("close", () => upstream.destroy());
      upstream.on("close", () => ws.close());
    });
  });
}
const attempts = new Map<string, any>();
const archive = Buffer.from("TEST-FIXTURE-ARCHIVE");
const fixtureCall = async function (op: string, b: any = {}): Promise<any> {
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
  if (op === "close-pane") return { closed: true };
  if (op === "health") return { ready: true, fixture: true };
  if (op === "resolve-course-accounts") {
    const users: Record<string, number> = {
      ...timezoneAccounts,
      student01: 10001,
      student02: 10002,
      student03: 10003,
      student04: 10004,
      student06: 10006,
      student07: 10007,
      student08: 10008,
      student09: 10009,
      student10: 10010,
      student11: 10011,
      student12: 10012,
    };
    if (b.usernames.some((u: string) => !users[u]))
      throw Error("Unknown fixture account");
    return Object.fromEntries(b.usernames.map((u: string) => [u, users[u]]));
  }
  if (op === "prepare-attempt") {
    attempts.set(b.id, { ...b, state: "PREPARING", generation: 0 });
    return attempts.get(b.id);
  }
  const a = attempts.get(b.id);
  if (!a) throw Error("Unknown fixture attempt");
  switch (op) {
    case "submission-status":
      break;
    case "submission-manifest":
      return {
        attempt: { ...a },
        files: [],
        omissions: [],
        collected: a.collected_at,
        secured: a.secured_at,
        checksum: a.checksum,
      };
    case "cancel-attempt":
      if (a.start) throw Error("Cannot cancel started attempt");
      a.state = "CANCELLED_BEFORE_START";
      break;
    case "activate-attempt":
      a.state = "ACTIVE";
      a.start = Date.now();
      a.deadline = a.start + a.settings.duration * 1000;
      a.original_deadline = a.deadline;
      a.clock_revision = 0;
      a.clock_resets = [];
      a.work_path = "/work";
      h.attempts.set(a.id, a);
      break;
    case "reset-clock": {
      if (a.clock_resets?.some((r: any) => r.id === b.reset_id)) break;
      if (
        a.state !== "ACTIVE" ||
        a.deadline <= Date.now() ||
        (a.clock_revision || 0) !== b.clock_revision
      )
        throw Error("Clock reset rejected");
      const previous = a.deadline;
      a.original_deadline ||= previous;
      a.deadline = b.extend_seconds
        ? previous + b.extend_seconds * 1000
        : b.requested_at + b.remaining_seconds * 1000;
      a.clock_revision = (a.clock_revision || 0) + 1;
      a.clock_resets ||= [];
      a.clock_resets.push({
        id: b.reset_id,
        actor: b.actor,
        requested_at: b.requested_at,
        applied_at: Date.now(),
        previous_deadline: previous,
        deadline: a.deadline,
        remaining_seconds: b.remaining_seconds,
        ...(b.extend_seconds ? { extend_seconds: b.extend_seconds } : {}),
        revision: a.clock_revision,
      });
      break;
    }
    case "lock-attempt":
      if (a.state === "ACTIVE") {
        a.state = "LOCKED";
        a.generation++;
      }
      a.resumeTransport = undefined;
      break;
    case "finalize-attempt":
      a.state = "COMPLETED";
      a.ended ??= Date.now();
      a.reason ||= b.reason;
      a.completed_at ||= a.ended;
      a.collected_at ||= Date.now();
      a.secured_at ||= a.collected_at;
      a.protected = true;
      if (a.exam === "sandbox") a.access_state = "RELEASED";
      a.checksum = hash(archive);
      break;
    case "authorize-continuation":
      a.authorization = b.expires;
      break;
    case "attach-transport":
      if (a.transport === b.transport) throw Error("Fresh SSH required");
      a.transport = b.transport;
      a.resumeTransport = b.transport;
      break;
    case "consume-continuation":
      if (!a.authorization) throw Error("Not authorized");
      if (!a.resumeTransport) throw Error("Fresh SSH required");
      a.state = "ACTIVE";
      a.authorization = 0;
      break;
  }
  return a;
};
const { app, store } = await createApp({
  mode: "development",
  origin: "http://localhost:3100",
  data: mkdtempSync(tmpdir() + "/exam-browser-"),
  port: 3100,
  jump: h.jump,
  class: h.class,
  agent: h.agentConfig,
  ...(browserMode
    ? {
        browserSSH: { relay: "ws://localhost:3101", audience: "fixture-relay" },
      }
    : {}),
  maintenance: false,
  preflightIdleMs: 5000,
});
h.control.command = fixtureCall;
store.db.prepare("INSERT INTO agent_snapshot VALUES(?,?,?)").run(
  "class",
  1,
  JSON.stringify({
    health: { ready: true, fixture: true },
    accounts: {
      ...timezoneAccounts,
      student01: 10001,
      student02: 10002,
      student03: 10003,
      student04: 10004,
      student06: 10006,
      student07: 10007,
      student08: 10008,
      student09: 10009,
      student10: 10010,
      student11: 10011,
      student12: 10012,
    },
  }),
);
let sequence = 1;
const postStatus = async (a: any) => {
  const manifest = a.protected
    ? await fixtureCall("submission-manifest", { id: a.id })
    : undefined;
  const payload = Buffer.from(
    JSON.stringify({
      agent: "class",
      sequence: ++sequence,
      at: Date.now(),
      attempt: { ...a },
      manifest,
    }),
  );
  const headers = {
    "content-type": "application/vnd.ssh-exam-event",
    "x-exam-signature": sign(null, payload, h.callbackKey).toString("base64"),
  };
  await app.inject({
    method: "POST",
    url: "/api/agent/events",
    headers,
    payload,
  });
};
h.control.command = async (op, b) => {
  const result = await fixtureCall(op, b);
  if (op === "finalize-attempt") setTimeout(() => void postStatus(result), 50);
  return result;
};
const watchdog = setInterval(() => {
  for (const a of attempts.values())
    if (a.start && a.deadline <= Date.now() && a.state !== "COMPLETED")
      void fixtureCall("finalize-attempt", {
        id: a.id,
        reason: "expiration",
      }).then(postStatus);
}, 100);
app.addHook("onClose", async () => clearInterval(watchdog));
store.db
  .prepare("INSERT INTO admins VALUES(?,?,?)")
  .run("fixture", "instructor", await argon2.hash("fixture-password"));
const exam = {
  id: "sample",
  name: "Fixture browser exam",
  earliest: Date.now() - 10000,
  latest: Date.now() + 86400000,
  duration: 5400,
  webcam: false,
  terminals: 4,
  template: "sample-exam",
};
store.db
  .prepare("INSERT INTO exams VALUES(?,?)")
  .run("sample", JSON.stringify(exam));
store.db
  .prepare("INSERT INTO enrollments VALUES(?,?,?,?,?,?)")
  .run("sample", "student01", null, null, null, 10001);
for (const [id, webcam] of [
  ["windows", false],
  ["camera", true],
  ["logout", false],
  ["expiry", false],
  ["recovery", false],
] as const) {
  store.db
    .prepare("INSERT INTO exams VALUES(?,?)")
    .run(id, JSON.stringify({ ...exam, id, webcam }));
  store.db
    .prepare("INSERT INTO enrollments VALUES(?,?,?,?,?,?)")
    .run(
      id,
      id === "camera" || id === "expiry"
        ? "student02"
        : id === "logout" || id === "recovery"
          ? "student03"
          : "student01",
      null,
      null,
      null,
      id === "camera" || id === "expiry"
        ? 10002
        : id === "logout" || id === "recovery"
          ? 10003
          : 10001,
    );
}
store.db
  .prepare("INSERT INTO exams VALUES(?,?)")
  .run("reload", JSON.stringify({ ...exam, id: "reload" }));
store.db
  .prepare("INSERT INTO enrollments VALUES(?,?,?,?,?,?)")
  .run("reload", "student11", null, null, null, 10011);
// A separate locked account exercises continuation rejection without depending
// on the old active-exam Sign out button.
store.db
  .prepare("INSERT INTO exams VALUES(?,?)")
  .run("locked", JSON.stringify({ ...exam, id: "locked" }));
store.db
  .prepare("INSERT INTO enrollments VALUES(?,?,?,?,?,?)")
  .run("locked", "student05", null, null, null, 10005);
store.db
  .prepare(
    "INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,access_state) VALUES(?,?,?,?,?,?,?,?,?)",
  )
  .run(
    "55555555-5555-4555-8555-555555555555",
    "locked",
    "student05",
    10005,
    "LOCKED",
    JSON.stringify({ ...exam, id: "locked" }),
    Date.now(),
    Date.now() + 5400000,
    "HELD",
  );
await app.listen({ host: "127.0.0.1", port: 3100 });
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  for (const client of relay?.clients || []) client.terminate();
  await Promise.all([
    app.close(),
    new Promise<void>((resolve, reject) => {
      if (!relay) return resolve();
      relay.close((error) => (error ? reject(error) : resolve()));
    }),
  ]);
  await h.close();
}
process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
