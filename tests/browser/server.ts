// Browser fixtures only; this file is excluded from the production server build.
import { createApp } from "../../apps/server/src/app.js";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import argon2 from "argon2";
import { hosts } from "../fixtures/hosts.js";
import { Agent } from "../../apps/server/src/agent.js";
import { hash } from "../../apps/server/src/db.js";
const h = await hosts();
const attempts = new Map<string, any>();
const archive = Buffer.from("TEST-FIXTURE-ARCHIVE");
let failedSandboxExport: string | undefined;
Agent.prototype.call = async function (op: string, b: any = {}): Promise<any> {
  if (op.startsWith("issue-")) return h.agent.call(op, b);
  if (op === "health") return { ready: true, fixture: true };
  if (op === "resolve-course-accounts") {
    const users: Record<string, number> = {
      student01: 10001,
      student02: 10002,
      student03: 10003,
      student04: 10004,
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
      a.work_path = "/work";
      h.attempts.set(a.id, a);
      break;
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
Agent.prototype.archive = async (id: string) => {
  if (attempts.get(id)?.exam === "sandbox" && !failedSandboxExport) {
    failedSandboxExport = id;
    throw Error("Transient sandbox export failure");
  }
  return archive;
};
const { app, store } = await createApp({
  mode: "development",
  origin: "http://localhost:3100",
  data: mkdtempSync(tmpdir() + "/exam-browser-"),
  port: 3100,
  jump: h.jump,
  class: h.class,
  agent: {
    url: "https://127.0.0.1:1",
    ca: "/missing",
    cert: "/missing",
    key: "/missing",
  },
  maintenance: false,
  preflightIdleMs: 5000,
});
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
await app.listen({ host: "127.0.0.1", port: 3100 });
process.on("SIGTERM", () => void app.close().then(() => h.close()));
