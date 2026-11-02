import { expect, it } from "vitest";
import {
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
} from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createApp } from "../../apps/server/src/app.js";
import { AttemptGrants } from "../../apps/server/src/attempt-grants.js";
import { ExamDefinitions } from "../../apps/server/src/exam-definitions.js";
import { grantExam } from "../fixtures/grant-exam.js";
import { managementPurpose } from "../../packages/protocol/management.js";

async function fixture() {
  const data = mkdtempSync(tmpdir() + "/latest-attempt-settings-"),
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
      managementOperations: [
        "grants.additional-preview",
        "grants.issue-confirm",
      ],
    },
  });
  const exam = "latest-settings",
    settings = grantExam(store, exam),
    session = store.session("admin", "instructor", null),
    headers = {
      origin,
      cookie: `session=${session.token}`,
      "x-csrf-token": session.csrf,
    },
    post = (url: string, payload: any) =>
      app.inject({ method: "POST", url, headers, payload }),
    read = async (view = "") => {
      const response = await app.inject({
        url: `/api/admin/exams/${exam}/dashboard${view ? `?view=${encodeURIComponent(view)}` : ""}`,
        headers,
      });
      expect(response.statusCode, response.body).toBe(200);
      return response.json().students;
    },
    input = (names = ["student"]) => ({
      definition_revision: new ExamDefinitions(store, "class").show(exam)
        .revision,
      template_version: settings.template_version,
      earliest: Date.now() - 1000,
      latest: Date.now() + 900000,
      usernames: names,
      preserve_duration: true,
      reason: "Reviewed attempt with latest saved settings",
      request: randomUUID(),
    }),
    preview = async (patch: any = {}) => {
      const response = await post(
        `/api/admin/exams/${exam}/grants/additional-preview`,
        { ...input(), ...patch },
      );
      expect(response.statusCode, response.body).toBe(200);
      return response.json();
    },
    confirm = (review: any) =>
      post(`/api/admin/grant-issuance/${review.id}/confirm`, {
        revision: review.revision,
        request: randomUUID(),
        replacement_policy: "single-unused-v1",
      });
  return {
    app,
    store,
    exam,
    settings,
    headers,
    post,
    read,
    input,
    preview,
    confirm,
    native: async (operation: string, body: any) => {
      const payload = Buffer.from(
        JSON.stringify({
          version: 1,
          purpose: managementPurpose,
          audience: origin,
          agent: "class",
          actor: "agent-root",
          request: randomUUID(),
          nonce: randomBytes(32).toString("hex"),
          issued: Date.now(),
          expires: Date.now() + 20000,
          operation,
          body,
        }),
      );
      const response = await app.inject({
        method: "POST",
        url: "/api/agent/management",
        headers: {
          "content-type": "application/vnd.ssh-exam-management",
          "x-exam-signature": sign(null, payload, keys.privateKey).toString(
            "base64",
          ),
        },
        payload,
      });
      expect(response.statusCode, response.body).toBe(200);
      return JSON.parse(
        Buffer.from(response.json().payload, "base64").toString(),
      );
    },
    close: async () => {
      await app.close();
      rmSync(data, { recursive: true, force: true });
    },
  };
}

it("dashboard and instructor/root reviews copy saved personal settings and current exam-wide values", async () => {
  const f = await fixture();
  try {
    const enrolled = await f.post(`/api/admin/exams/${f.exam}/roster/add`, {
      username: "student",
    });
    expect(enrolled.statusCode, enrolled.body).toBe(200);
    const initial = (await f.read())[0].unusedAttempt;
    expect(initial).toMatchObject({
      revision: 1,
      settings: { duration: 5400, webcam: true },
    });
    const revised = await f.post(`/api/admin/grants/${initial.id}/revise`, {
      revision: 1,
      changes: {
        duration: 6300,
        webcam: false,
      },
      reason: "Saved accommodation on this unused attempt",
      request: randomUUID(),
    });
    expect(revised.statusCode, revised.body).toBe(200);
    const obsolete = await f.post(
      `/api/admin/exams/${f.exam}/roster/settings`,
      { usernames: ["student"], duration: 2400, webcam: true },
    );
    expect(obsolete.statusCode, obsolete.body).toBe(200);
    const row = (await f.read())[0];
    expect(row.latestSettings).toMatchObject({
      duration: 6300,
      webcam: false,
      terminals: 4,
      collection_file_mib: 128,
      collection_total_mib: 512,
    });
    expect(row.unusedAttempt).toMatchObject({
      id: initial.id,
      revision: 2,
      settings: row.latestSettings,
    });
    const web = await f.preview();
    const native = await f.native("grants.additional-preview", {
      exam: f.exam,
      ...f.input(),
    });
    expect(native.ok, JSON.stringify(native)).toBe(true);
    for (const review of [web, native.result])
      expect(review.rows[0].settings).toMatchObject({
        duration: 6300,
        webcam: false,
        terminals: 4,
        collection_file_mib: 128,
        collection_total_mib: 512,
      });
    const explicit = await f.preview({
      preserve_duration: undefined,
      duration: 600,
      webcam: true,
    });
    expect(explicit.rows[0].settings).toMatchObject({
      duration: 600,
      webcam: true,
    });
    const confirmed = await f.confirm(web);
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(f.store.db.prepare("SELECT count(*) n FROM attempts").get()).toEqual(
      { n: 0 },
    );
    expect(
      f.store.db.prepare("SELECT count(*) n FROM grant_claims").get(),
    ).toEqual({ n: 0 });
    expect((await f.read())[0].unusedAttempt.id).toBe(
      confirmed.json().issued[0].grant,
    );
  } finally {
    await f.close();
  }
});

it("cancelling the unused attempt preserves its last settings for a new review and binds concurrent changes", async () => {
  const f = await fixture();
  try {
    expect(
      (
        await f.post(`/api/admin/exams/${f.exam}/roster/add`, {
          username: "student",
          duration: 7200,
          webcam: false,
        })
      ).statusCode,
    ).toBe(200);
    const original = (await f.read())[0].unusedAttempt;
    const before = await f.preview();
    const cancelled = await f.post(`/api/admin/grants/${original.id}/revoke`, {
      revision: original.revision,
      reason: "Cancel this unused attempt, preserving its settings",
      request: randomUUID(),
    });
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    expect((await f.read())[0]).toMatchObject({
      unusedAttempt: null,
      latestSettings: { duration: 7200, webcam: false },
    });
    const stale = await f.confirm(before);
    expect(stale.statusCode, stale.body).toBe(409);
    expect(stale.body).toContain("latest attempt settings");
    expect(
      f.store.db.prepare("SELECT count(*) n FROM attempt_grants").get(),
    ).toEqual({ n: 1 });
    const replacement = await f.preview();
    expect(replacement.rows[0].settings).toMatchObject({
      duration: 7200,
      webcam: false,
    });
    const updated = await f.preview({
      preserve_duration: undefined,
      duration: 3000,
      webcam: true,
    });
    const issued = await f.confirm(updated);
    expect(issued.statusCode, issued.body).toBe(200);
    const second = issued.json().issued[0].grant;
    // Import/clock values cannot reorder the model's durable issuance sequence.
    f.store.db
      .prepare("UPDATE attempt_grants SET issued_at=1 WHERE id=?")
      .run(second);
    expect(
      (
        await f.post(`/api/admin/grants/${second}/revoke`, {
          revision: 1,
          reason: "Cancel the latest configured unused attempt",
          request: randomUUID(),
        })
      ).statusCode,
    ).toBe(200);
    expect((await f.read())[0]).toMatchObject({
      unusedAttempt: null,
      latestSettings: { duration: 3000, webcam: true },
    });
    expect(
      f.store.db
        .prepare("SELECT status FROM attempt_grants WHERE id=?")
        .get(original.id),
    ).toEqual({ status: "REVOKED" });
  } finally {
    await f.close();
  }
});

it("legacy history preserves exact seconds and protected history, and falls back only without history", async () => {
  const f = await fixture();
  try {
    f.store.db
      .prepare(
        "INSERT INTO enrollments(exam,username,uid,duration,webcam) VALUES(?,?,10001,4800,1)",
      )
      .run(f.exam, "student");
    f.store.db
      .prepare(
        "INSERT INTO enrollments(exam,username,uid,duration,webcam) VALUES(?,?,10002,1200,0)",
      )
      .run(f.exam, "newstudent");
    for (const [duration, start] of [[95, Date.now() - 7200000]])
      f.store.db
        .prepare(
          "INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline,protected,checksum,access_state) VALUES(?,?,'student',10001,'COMPLETED',?,?,?,?,1,?,'RELEASED')",
        )
        .run(
          randomUUID(),
          f.exam,
          JSON.stringify({
            ...f.settings,
            duration,
            webcam: false,
            terminals: 1,
          }),
          start,
          start + duration * 1000,
          start + duration * 1000,
          "b".repeat(64),
        );
    const before = f.store.db
      .prepare("SELECT * FROM attempts ORDER BY rowid")
      .all();
    const rows = await f.read();
    expect(rows.find((r: any) => r.username === "student")).toMatchObject({
      unusedAttempt: null,
      latestSettings: { duration: 95, webcam: false, terminals: 1 },
    });
    expect(rows.find((r: any) => r.username === "newstudent")).toMatchObject({
      unusedAttempt: null,
      latestSettings: { duration: 1200, webcam: false },
    });
    const review = await f.preview({ usernames: ["student", "newstudent"] });
    expect(
      review.rows.map((r: any) => [
        r.username,
        r.settings.duration,
        r.settings.webcam,
      ]),
    ).toEqual([
      ["newstudent", 1200, false],
      ["student", 95, false],
    ]);
    expect((await f.confirm(review)).statusCode).toBe(200);
    const source = before[0] as { id: string };
    const saved = await f.preview({
      work: { kind: "saved", attempt: source.id, checksum: "b".repeat(64) },
    });
    expect((await f.confirm(saved)).statusCode).toBe(200);
    expect(
      (await f.read()).find((r: any) => r.username === "student").unusedAttempt,
    ).toMatchObject({
      status: "PENDING_NATIVE",
      sourceAttempt: {
        id: source.id,
        exam: f.exam,
        exam_name: f.settings.name,
        attempt_number: 1,
        start: (before[0] as any).start,
      },
    });
    expect(
      f.store.db.prepare("SELECT * FROM attempts ORDER BY rowid").all(),
    ).toEqual(before);
  } finally {
    await f.close();
  }
});

it("filtered dashboard retains the current-attempt fact when the visible history hides that attempt", async () => {
  const f = await fixture();
  try {
    f.store.db
      .prepare(
        "INSERT INTO enrollments(exam,username,uid) VALUES(?,'student',10001)",
      )
      .run(f.exam);
    const old = randomUUID(),
      start = Date.now() - 10800000;
    f.store.db
      .prepare(
        "INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline,protected,access_state) VALUES(?,?,'student',10001,'COMPLETED',?,?,?,?,1,'RELEASED')",
      )
      .run(
        old,
        f.exam,
        JSON.stringify(f.settings),
        start,
        start + 5400000,
        start + 5400000,
      );
    expect((await f.read("COMPLETED"))[0].hasCurrentAttempt).toBe(false);
    const review = await f.preview(),
      issued = await f.confirm(review);
    expect(issued.statusCode, issued.body).toBe(200);
    const grant = (await f.read())[0].unusedAttempt,
      attempt = randomUUID();
    f.store.db.transaction(() => {
      new AttemptGrants(f.store, "class").claim(grant.id, attempt, 10001);
      f.store.db
        .prepare(
          "INSERT INTO attempts(id,exam,username,uid,state,settings,grant_id,grant_revision,grant_hash,grant_kind,grant_issued_order) VALUES(?,?,'student',10001,'PREPARING',?,?,?,?,'ADDITIONAL',?)",
        )
        .run(
          attempt,
          f.exam,
          JSON.stringify(grant.settings),
          grant.id,
          grant.revision,
          grant.hash,
          grant.issuance_order,
        );
    })();
    const row = (await f.read("COMPLETED"))[0];
    expect(row.hasCurrentAttempt).toBe(true);
    expect(row.unusedAttempt).toBeNull();
    expect(row.attempts.map((a: any) => a.id)).toEqual([old]);
    expect(row.attempts.every((a: any) => a.state === "COMPLETED")).toBe(true);
  } finally {
    await f.close();
  }
});

it("dashboard does not offer a claimed setup for editing and refuses malformed configuration instead of falling back", async () => {
  const f = await fixture();
  try {
    expect(
      (
        await f.post(`/api/admin/exams/${f.exam}/roster/add`, {
          username: "student",
        })
      ).statusCode,
    ).toBe(200);
    const original = (await f.read())[0].unusedAttempt,
      attempt = randomUUID(),
      grants = new AttemptGrants(f.store, "class");
    f.store.db.transaction(() => {
      grants.claim(original.id, attempt, 10001);
      f.store.db
        .prepare(
          "INSERT INTO attempts(id,exam,username,uid,state,settings,grant_id,grant_revision,grant_hash,grant_issued_order) VALUES(?,?,'student',10001,'PREPARING',?,?,?,?,?)",
        )
        .run(
          attempt,
          f.exam,
          JSON.stringify(original.settings),
          original.id,
          original.revision,
          original.hash,
          original.issuance_order,
        );
    })();
    const row = (await f.read())[0];
    expect(row).toMatchObject({
      unusedAttempt: null,
      latestSettings: original.settings,
    });
    expect(row.grantError).toBeUndefined();
    f.store.db
      .prepare("UPDATE grant_revisions SET settings='{}' WHERE grant_id=?")
      .run(original.id);
    expect((await f.read())[0]).toMatchObject({
      unusedAttempt: null,
      latestSettings: null,
      grantError: true,
    });
    const failed = await f.post(
      `/api/admin/exams/${f.exam}/grants/additional-preview`,
      f.input(),
    );
    expect(failed.statusCode).not.toBe(200);
    expect(
      f.store.db.prepare("SELECT count(*) n FROM attempt_grants").get(),
    ).toEqual({ n: 1 });
  } finally {
    await f.close();
  }
});
