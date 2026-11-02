import { expect, it } from "vitest";
import { generateKeyPairSync, randomUUID, sign, verify } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { createApp } from "../../apps/server/src/app.js";
import { ExamDefinitions } from "../../apps/server/src/exam-definitions.js";
import { ExamExecutionPolicies } from "../../apps/server/src/exam-execution-policy.js";
import {
  examExecutionPolicyCapability,
  examExecutionPolicyReply,
} from "../../packages/protocol/exam-execution-policy.js";
import { grantExam } from "../fixtures/grant-exam.js";

async function fixture() {
  const data = mkdtempSync(tmpdir() + "/exam-execution-policy-"),
    origin = "http://localhost:3000",
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
    origin,
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
  const settings = grantExam(store, "execution-policy"),
    definitions = new ExamDefinitions(store, "class"),
    policies = new ExamExecutionPolicies(store, "class"),
    admin = store.session("admin", "instructor", null),
    headers = {
      origin,
      cookie: `session=${admin.token}`,
      "x-csrf-token": admin.csrf,
    };
  let sequence = 0;
  const post = (url: string, payload: Record<string, unknown>) =>
    app.inject({ method: "POST", url, headers, payload });
  const signed = (
    url: string,
    value: Record<string, unknown>,
    wrongKey = false,
  ) => {
    const payload = Buffer.from(JSON.stringify(value));
    return app.inject({
      method: "POST",
      url,
      headers: {
        "content-type": "application/vnd.ssh-exam-event",
        "x-exam-signature": sign(
          null,
          payload,
          wrongKey ? gateway.privateKey : native.privateKey,
        ).toString("base64"),
      },
      payload,
    });
  };
  const event = (extra: Record<string, unknown>) =>
    signed("/api/agent/events", {
      agent: "class",
      sequence: ++sequence,
      at: Date.now(),
      ...extra,
    });
  const support = async (
    patch: Record<string, unknown> = {},
    healthPatch: Record<string, unknown> = {},
  ) => {
    const observed = Date.now();
    const response = await event({
      health: {
        ready: true,
        production_ready: true,
        capabilities: [examExecutionPolicyCapability],
        native_roles: { complete: true, retained_enabled: true, observed },
        execution_policy_support: {
          schema: 1,
          capability: examExecutionPolicyCapability,
          observation_only: true,
          supported: true,
          observed,
          roles: ["agent", "watchdog", "source-worker"],
          issues: [],
          ...patch,
        },
        ...healthPatch,
      },
      accounts: {},
    });
    expect(response.statusCode, response.body).toBe(200);
  };
  const save = (changes: Record<string, unknown>) =>
    post("/api/admin/exams", {
      id: settings.id,
      revision: definitions.show(settings.id).revision,
      reason: "Change shared execution settings in one exam-wide save",
      ...changes,
    });
  const add = async (username = "student") => {
    const response = await post(`/api/admin/exams/${settings.id}/roster/add`, {
      username,
      duration: 7200,
      webcam: false,
    });
    expect(response.statusCode, response.body).toBe(200);
  };
  const legacy = (state = "ACTIVE", frozen: Record<string, unknown> = {}) => {
    const id = randomUUID(),
      username = "legacy",
      start = state === "PREPARING" ? null : Date.now() - 600000,
      saved = {
        ...settings,
        duration: 7200,
        webcam: false,
        collection_file_mib: 1,
        collection_total_mib: 2,
        ...frozen,
      },
      deadline = start === null ? null : start + 7200000;
    store.db
      .prepare("INSERT INTO enrollments(exam,username,uid) VALUES(?,?,10001)")
      .run(settings.id, username);
    store.db
      .prepare(
        "INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline,access_state,page_hash) VALUES(?,?,?,10001,?,?,?,?,?,'HELD',?)",
      )
      .run(
        id,
        settings.id,
        username,
        state,
        JSON.stringify(saved),
        start,
        deadline,
        deadline,
        "a".repeat(64),
      );
    return store.attempt(id);
  };
  const domain = () =>
    Object.fromEntries(
      [
        "exams",
        "exam_lifecycle",
        "enrollments",
        "attempts",
        "attempt_grants",
        "grant_revisions",
        "grant_claims",
        "grant_begin_intents",
        "clock_reset_requests",
        "exam_definition_requests",
        "agent_events",
        "agent_snapshot",
        "audit",
      ].map((table) => [
        table,
        store.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
      ]),
    );
  const policyRequest = (
    extra: Record<string, unknown> = {},
    wrongKey = false,
  ) =>
    signed(
      "/api/agent/exam-execution-policy",
      {
        agent: "class",
        exam: settings.id,
        nonce: "b".repeat(64),
        at: Date.now(),
        ...extra,
      },
      wrongKey,
    );
  return {
    app,
    store,
    life,
    data,
    origin,
    settings,
    definitions,
    policies,
    headers,
    gateway,
    post,
    signed,
    event,
    support,
    save,
    add,
    legacy,
    domain,
    policyRequest,
    async close() {
      await app.close();
      rmSync(data, { recursive: true, force: true });
    },
  };
}

it("serves the exact current policy through a nonce-bound authenticated signed HTTP exchange without changing authority", async () => {
  const f = await fixture();
  try {
    const before = f.domain(),
      response = await f.policyRequest();
    expect(response.statusCode, response.body).toBe(200);
    const frame = response.json(),
      payload = Buffer.from(frame.payload, "base64");
    expect(
      verify(
        null,
        payload,
        f.gateway.publicKey,
        Buffer.from(frame.signature, "base64"),
      ),
    ).toBe(true);
    const reply = examExecutionPolicyReply.parse(
      JSON.parse(payload.toString()),
    );
    expect(reply).toMatchObject({
      type: "exam-execution-policy",
      audience: "class",
      nonce: "b".repeat(64),
      policy: f.policies.current(f.settings.id),
    });
    expect(reply.expires).toBeGreaterThan(Date.now());
    expect(reply.expires).toBeLessThanOrEqual(Date.now() + 30000);
    expect(Object.keys(reply.policy).sort()).toEqual(
      [
        "schema",
        "agent",
        "exam",
        "instance",
        "revision",
        "terminals",
        "collection_file_mib",
        "collection_total_mib",
      ].sort(),
    );
    expect(f.domain()).toEqual(before);
  } finally {
    await f.close();
  }
});

it("refuses invalid signatures, stale requests and wrong scopes through the public signed endpoint", async () => {
  const f = await fixture();
  try {
    const before = f.domain();
    for (const [extra, wrongKey, status] of [
      [{}, true, 403],
      [{ agent: "other" }, false, 403],
      [{ exam: "missing" }, false, 404],
      [{ at: Date.now() - 60000 }, false, 409],
      [{ at: Date.now() + 60000 }, false, 409],
      [{ nonce: "short" }, false, 400],
      [{ webcam: true }, false, 400],
    ] as const) {
      const response = await f.policyRequest(extra, wrongKey);
      expect(response.statusCode, response.body).toBe(status);
    }
    expect(f.domain()).toEqual(before);
  } finally {
    await f.close();
  }
});

it("blocks a live shared save without a matched cohort, then applies one atomic save without revising permissions or clocks", async () => {
  const f = await fixture();
  try {
    await f.add();
    const before = f.domain(),
      rejected = await f.save({
        terminals: 2,
        collection_file_mib: 64,
        collection_total_mib: 256,
      });
    expect(rejected.statusCode, rejected.body).toBe(503);
    expect(rejected.json().error).toContain(
      "agent, watchdog and saved-work worker",
    );
    expect(f.domain()).toEqual(before);
    await f.support();
    const current = f.domain(),
      saved = await f.save({
        terminals: 2,
        collection_file_mib: 64,
        collection_total_mib: 256,
      });
    expect(saved.statusCode, saved.body).toBe(200);
    const policy = f.policies.current(f.settings.id);
    expect(policy).toMatchObject({
      terminals: 2,
      collection_file_mib: 64,
      collection_total_mib: 256,
    });
    expect(policy.revision).toBe(
      (current.exam_lifecycle as any[]).find((r) => r.exam === f.settings.id)
        .version + 1,
    );
    const after = f.domain();
    for (const table of [
      "enrollments",
      "attempts",
      "attempt_grants",
      "grant_revisions",
      "grant_claims",
      "grant_begin_intents",
      "clock_reset_requests",
    ])
      expect(after[table]).toEqual(current[table]);
    const student = f.store.session("student", "student", f.settings.id),
      status = await f.app.inject({
        url: "/api/student/exam",
        headers: { cookie: `session=${student.token}` },
      });
    expect(status.statusCode, status.body).toBe(200);
    expect(status.json()).toMatchObject({
      settings: { terminals: 4, duration: 7200, webcam: false },
      executionPolicy: policy,
    });
  } finally {
    await f.close();
  }
});

it.each([
  { supported: false },
  { roles: ["agent", "watchdog"] },
  { observed: Date.now() - 120001 },
  { observation_only: false },
])(
  "refuses incomplete or stale signed cohort evidence %j with no partial save",
  async (patch) => {
    const f = await fixture();
    try {
      await f.add();
      await f.support(patch);
      const before = f.domain(),
        response = await f.save({ terminals: 2 });
      expect(response.statusCode, response.body).toBe(503);
      expect(f.domain()).toEqual(before);
    } finally {
      await f.close();
    }
  },
);

it.each(["PREPARING", "ACTIVE", "LOCKED", "FINALIZING", "COLLECTION_FAILED"])(
  "requires the cohort for unfinished %s metadata without changing its interval",
  async (state) => {
    const f = await fixture();
    try {
      const a = f.legacy(state),
        before = f.domain(),
        response = await f.save({ collection_file_mib: 64 });
      expect(response.statusCode, response.body).toBe(503);
      expect(f.domain()).toEqual(before);
      expect(f.store.attempt(a.id)).toEqual(a);
    } finally {
      await f.close();
    }
  },
);

it("permits empty or completed-history exam configuration offline without reopening history", async () => {
  const f = await fixture();
  try {
    expect((await f.save({ terminals: 2 })).statusCode).toBe(200);
    const a = f.legacy("COMPLETED");
    const response = await f.save({ terminals: 3 });
    expect(response.statusCode, response.body).toBe(200);
    expect(f.store.attempt(a.id)).toEqual(a);
    expect(
      f.store.db.prepare("SELECT count(*) n FROM attempt_grants").get(),
    ).toEqual({ n: 0 });
  } finally {
    await f.close();
  }
});

it("keeps frozen settings separate in status and signed commands, and still signs Finish when policy metadata is unavailable", async () => {
  const f = await fixture();
  try {
    const a = f.legacy("ACTIVE"),
      student = f.store.session("student", a.username, a.exam);
    await f.support();
    const changed = await f.save({ terminals: 2, collection_file_mib: 64 });
    expect(changed.statusCode, changed.body).toBe(200);
    const response = await f.app.inject({
      url: `/api/student/attempts/${a.id}/status`,
      headers: { cookie: `session=${student.token}` },
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      attempt: {
        settings: a.settings,
        deadline: a.deadline,
        clock_revision: a.clock_revision,
      },
      executionPolicy: f.policies.current(a.exam),
    });
    const command = f.life.agent.sign(
        "issue-channel-admission",
        a.username,
        "transport",
        { id: a.id, execution_policy: { forged: true } },
      ),
      body = JSON.parse(Buffer.from(command.payload, "base64").toString());
    expect(body.body.execution_policy).toEqual(f.policies.current(a.exam));
    expect(f.store.attempt(a.id)).toEqual(a);
    f.store.db
      .prepare("UPDATE exam_lifecycle SET instance='invalid' WHERE exam=?")
      .run(a.exam);
    expect(() =>
      f.life.agent.sign("issue-channel-admission", a.username, "transport", {
        id: a.id,
      }),
    ).toThrow();
    const finish = f.life.agent.sign(
        "finalize-attempt",
        a.username,
        "transport",
        { id: a.id, execution_policy: { forged: true } },
      ),
      finishPayload = Buffer.from(finish.payload, "base64"),
      finishBody = JSON.parse(finishPayload.toString());
    expect(
      verify(
        null,
        finishPayload,
        f.gateway.publicKey,
        Buffer.from(finish.signature, "base64"),
      ),
    ).toBe(true);
    expect(finishBody.body.execution_policy).toBeUndefined();
    expect(finishBody.op).toBe("finalize-attempt");
    const unavailable = await f.app.inject({
      url: `/api/student/attempts/${a.id}/status`,
      headers: { cookie: `session=${student.token}` },
    });
    expect(unavailable.statusCode, unavailable.body).toBe(200);
    expect(unavailable.json()).toMatchObject({
      executionPolicy: null,
      executionPolicyUnavailable: true,
    });
    expect(f.store.attempt(a.id)).toEqual(a);
  } finally {
    await f.close();
  }
});

async function archiveFixture() {
  const f = await fixture();
  const a = f.legacy("ACTIVE"),
    job = "e".repeat(64);
  await f.support();
  expect(
    (await f.save({ collection_file_mib: 2, collection_total_mib: 4 }))
      .statusCode,
  ).toBe(200);
  const policy = f.policies.current(a.exam);
  expect(
    (await f.save({ collection_file_mib: 1, collection_total_mib: 2 }))
      .statusCode,
  ).toBe(200);
  // This is a signed native receipt fixture. Native qualification verifies real
  // archive bytes; web verification must retain its own immutable policy here.
  const remote = {
    id: a.id,
    exam: a.exam,
    username: a.username,
    uid: a.uid,
    settings: JSON.parse(a.settings),
    state: "COMPLETED",
    start: a.start,
    deadline: a.deadline,
    original_deadline: a.original_deadline,
    clock_revision: a.clock_revision,
    ended: Date.now(),
    reason: "Student finished",
    completed_at: Date.now(),
    collected_at: Date.now(),
    secured_at: Date.now(),
    protected: true,
    checksum: "b".repeat(64),
    access_state: "HELD",
    collection_job: job,
  };
  const manifest: any = {
    attempt: { ...remote },
    files: [{ path: "large.bin", size: 1572864, sha256: "c".repeat(64) }],
    omissions: [],
    collected: remote.collected_at,
    secured: remote.secured_at,
    checksum: remote.checksum,
    collection_policy: { job, policy },
  };
  return { ...f, a, remote, manifest };
}

it("accepts and retains a signed archive's own older larger policy without using frozen or current lower caps", async () => {
  const f = await archiveFixture();
  try {
    expect(f.policies.current(f.a.exam).revision).toBeGreaterThan(
      f.manifest.collection_policy.policy.revision,
    );
    const response = await f.event({ attempt: f.remote, manifest: f.manifest });
    expect(response.statusCode, response.body).toBe(200);
    expect(f.store.attempt(f.a.id)).toMatchObject({
      protected: 1,
      checksum: f.remote.checksum,
      settings: f.a.settings,
      deadline: f.a.deadline,
    });
    const receipt = JSON.parse(
      readFileSync(`${f.data}/receipts/${f.a.id}.manifest.json`, "utf8"),
    );
    expect(receipt.collection_policy).toEqual(f.manifest.collection_policy);
    expect(receipt.files[0].size).toBeGreaterThan(
      JSON.parse(f.a.settings).collection_file_mib * 1048576,
    );
  } finally {
    await f.close();
  }
});

it.each(["job", "missing-job", "agent", "exam", "size", "nested"])(
  "refuses a signed collection receipt with invalid %s proof before publishing or protecting it",
  async (kind) => {
    const f = await archiveFixture();
    try {
      if (kind === "job") f.manifest.collection_policy.job = "f".repeat(64);
      if (kind === "missing-job") delete f.manifest.attempt.collection_job;
      if (kind === "agent") f.manifest.collection_policy.policy.agent = "other";
      if (kind === "exam") f.manifest.collection_policy.policy.exam = "other";
      if (kind === "size") f.manifest.files[0].size = 3 * 1048576;
      if (kind === "nested")
        f.manifest.attempt.collection_policy = f.manifest.collection_policy;
      const before = f.domain(),
        response = await f.event({ attempt: f.remote, manifest: f.manifest });
      expect(response.statusCode, response.body).toBe(400);
      expect(response.json().error).toContain("Protected collection");
      expect(f.domain()).toEqual(before);
      expect(existsSync(`${f.data}/receipts/${f.a.id}.manifest.json`)).toBe(
        false,
      );
    } finally {
      await f.close();
    }
  },
);

it("continues accepting legacy protected receipts with absent collection policy metadata", async () => {
  const f = await archiveFixture();
  try {
    delete f.manifest.collection_policy;
    f.manifest.files = [];
    const response = await f.event({ attempt: f.remote, manifest: f.manifest });
    expect(response.statusCode, response.body).toBe(200);
    expect(f.store.attempt(f.a.id).protected).toBe(1);
  } finally {
    await f.close();
  }
});
