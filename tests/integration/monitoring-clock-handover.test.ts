import { afterEach, expect, it, vi } from "vitest";
import {
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
} from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { createApp } from "../../apps/server/src/app.js";
import { Agent } from "../../apps/server/src/agent.js";
import { hash } from "../../apps/server/src/db.js";
import { AttemptGrants } from "../../apps/server/src/attempt-grants.js";
import { grantExam } from "../fixtures/grant-exam.js";

const clock = vi.hoisted(() => ({ now: 10000 }));
vi.mock("../../apps/server/src/monitoring-clock.js", () => ({
  monitoringBootTimeMS: () => clock.now,
}));
afterEach(() => {
  clock.now = 10000;
  vi.restoreAllMocks();
});

// Real administrator clock intent, signed native outcome and evidence HTTP,
// challenged JPEG decoding/storage. Only the evidence clock and native health
// response are synthetic. Go separately exercises the actual signed clock RPC.
it("accepted clock-only native revision preserves challenged HTTP evidence while old-scope proofs and expired facts refuse", async () => {
  const data = mkdtempSync(tmpdir() + "/monitoring-clock-handover-"),
    origin = "http://localhost:3000",
    keys = generateKeyPairSync("ed25519", {
      publicKeyEncoding: { format: "pem", type: "spki" },
      privateKeyEncoding: { format: "pem", type: "pkcs8" },
    });
  writeFileSync(data + "/agent.pub", keys.publicKey);
  writeFileSync(data + "/gateway.key", keys.privateKey, { mode: 0o600 });
  const { app, store } = await createApp({
    mode: "development",
    origin,
    data,
    port: 0,
    maintenance: false,
    jump: { host: "localhost", port: 2222, pins: ["0".repeat(64)] },
    class: { host: "localhost", port: 2223, pins: ["1".repeat(64)] },
    agent: {
      id: "class",
      signingKey: data + "/gateway.key",
      callbackPublicKey: data + "/agent.pub",
    },
  });
  const id = randomUUID(),
    page = randomUUID(),
    start = Date.now() - 1000,
    deadline = start + 5400000,
    owner = {
      attempt: id,
      exam: "clock",
      username: "synthetic",
      uid: 10001,
      transport_hash: "a".repeat(64),
      boot: "77777777-1234-4234-8234-123456789abc",
      page_epoch: hash(page),
      input_epoch: "b".repeat(64),
      generation: 0,
      clock_revision: 0,
    },
    grants = new AttemptGrants(store, "class");
  grantExam(store, "clock");
  const grant = store.db.transaction(() => {
    const issued = grants.initial(
      "clock",
      "synthetic",
      null,
      false,
      "synthetic-fixture",
    );
    if (!issued) throw Error("Initial fixture grant not issued");
    store.db
      .prepare(
        "INSERT INTO enrollments(exam,username,uid,webcam) VALUES('clock','synthetic',10001,0)",
      )
      .run();
    grants.claim(issued.id, id, 10001);
    store.db
      .prepare(
        "INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline,page_hash,monitoring_mode,registered_owner,grant_id,grant_revision,grant_hash,grant_issued_order) VALUES(?,'clock','synthetic',10001,'ACTIVE',?,?,?,?,?,'v1',?,?,?,?,?)",
      )
      .run(
        id,
        JSON.stringify(issued.settings),
        start,
        deadline,
        deadline,
        hash(page),
        JSON.stringify(owner),
        issued.id,
        issued.revision,
        issued.hash,
        issued.issuance_order,
      );
    return issued;
  })();
  const settings = JSON.stringify(grant.settings),
    begin = grants.begin(
      store.attempt(id),
      owner.transport_hash,
      owner.page_epoch,
    );
  // Authored already-started native fixture; consume its original exact grant
  // and Begin lineage before exercising the actual HTTP clock workflow.
  grants.accept(
    {
      ...store.attempt(id),
      settings: grant.settings,
      grant: grants.binding(grant),
      grant_begin_intent: begin,
      registered_owner: owner,
      boot: owner.boot,
      browser_ssh: true,
      terminal_supervised: true,
    },
    store.attempt(id),
  );
  const student = store.session("student", "synthetic", "clock"),
    admin = store.session("admin", "instructor", null),
    headers = {
      origin,
      cookie: `session=${student.token}`,
      "x-csrf-token": student.csrf,
      "x-page-instance": page,
    },
    signed = async (url: string, body: unknown) => {
      const payload = Buffer.from(JSON.stringify(body));
      return app.inject({
        method: "POST",
        url,
        headers: {
          "content-type": "application/vnd.ssh-exam-event",
          "x-exam-signature": sign(null, payload, keys.privateKey).toString(
            "base64",
          ),
        },
        payload,
      });
    },
    evidence = (scope = owner) =>
      signed("/api/agent/monitoring-evidence", {
        type: "monitoring-execution-challenge-v1",
        agent: "class",
        nonce: randomBytes(32).toString("hex"),
        owner: scope,
        coverage_epoch: "",
        after_sequence: 0,
      }),
    decode = (r: any) =>
      JSON.parse(Buffer.from(r.json().payload, "base64").toString());
  try {
    const ticket = await app.inject({
      method: "POST",
      url: `/api/student/attempts/${id}/capture-challenges`,
      headers,
      payload: { source: "screen" },
    });
    expect(ticket.statusCode, ticket.body).toBe(200);
    const jpeg = await sharp({
      create: { width: 40, height: 30, channels: 3, background: "white" },
    })
      .jpeg()
      .toBuffer();
    const upload = await app.inject({
      method: "POST",
      url: `/api/student/attempts/${id}/frames/challenged`,
      headers,
      payload: {
        source: "screen",
        seq: 1,
        captured: Date.now(),
        monotonic: 1,
        challenge: ticket.json().challenge,
        data: jpeg.toString("base64"),
        readiness: {
          fullscreen: true,
          visible: true,
          keyboard: true,
          screen: true,
          webcam: false,
          focus: true,
        },
      },
    });
    expect(upload.statusCode, upload.body).toBe(200);
    const before = await evidence();
    expect(before.statusCode, before.body).toBe(200);
    const facts = decode(before);
    expect(facts.age_ms).toBe(0);
    vi.spyOn(Agent.prototype, "call").mockImplementation(async (op) => {
      if (op !== "health") throw Error("Unexpected native call " + op);
      return { capabilities: ["clock-reset", "deadline-timing-check"] };
    });
    const intent = randomUUID(),
      accepted = await app.inject({
        method: "POST",
        url: `/api/admin/attempts/${id}/reset-clock`,
        headers: {
          origin,
          cookie: `session=${admin.token}`,
          "x-csrf-token": admin.csrf,
        },
        payload: { minutes: 60, revision: 0, requestID: intent },
      });
    expect(accepted.statusCode, accepted.body).toBe(200);
    const row = store.db
        .prepare("SELECT body FROM clock_reset_requests WHERE id=?")
        .get(intent) as { body: string },
      request = JSON.parse(row.body),
      changed = request.requested_at + 3600000,
      next = { ...owner, clock_revision: 1 },
      reset = {
        id: intent,
        actor: "instructor",
        requested_at: request.requested_at,
        applied_at: Date.now(),
        previous_deadline: deadline,
        deadline: changed,
        remaining_seconds: 3600,
        revision: 1,
      };
    clock.now += 4000;
    const outcome = await signed("/api/agent/events", {
      agent: "class",
      sequence: 1,
      at: Date.now(),
      attempt: {
        id,
        exam: "clock",
        username: "synthetic",
        uid: 10001,
        state: "ACTIVE",
        settings: JSON.parse(settings),
        start,
        deadline: changed,
        original_deadline: deadline,
        clock_revision: 1,
        clock_resets: [reset],
        registered_owner: next,
        boot: owner.boot,
        browser_ssh: true,
        terminal_supervised: true,
        monitoring_mode: "v1",
        grant: grants.binding(grant),
        grant_begin_intent: begin,
      },
    });
    expect(outcome.statusCode, outcome.body).toBe(200);
    const after = await evidence(next);
    expect(after.statusCode, after.body).toBe(200);
    expect(decode(after)).toMatchObject({
      owner: next,
      coverage_epoch: facts.coverage_epoch,
      sequence: facts.sequence,
      age_ms: 4000,
    });
    expect((await evidence(owner)).statusCode).toBe(409);
    expect(store.attempt(id)).toMatchObject({
      state: "ACTIVE",
      start,
      original_deadline: deadline,
      clock_revision: 1,
      deadline: changed,
    });
    expect(store.db.prepare("SELECT * FROM incidents").all()).toEqual([]);
    clock.now = 25000;
    expect((await evidence(next)).statusCode).toBe(409);
  } finally {
    await app.close();
    rmSync(data, { recursive: true, force: true });
  }
});
