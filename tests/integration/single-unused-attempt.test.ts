import { afterEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createApp } from "../../apps/server/src/app.js";
import { AttemptGrants } from "../../apps/server/src/attempt-grants.js";
import { ExamDefinitions } from "../../apps/server/src/exam-definitions.js";
import { grantExam } from "../fixtures/grant-exam.js";
import { RosterManagement } from "../../apps/server/src/roster-management.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0)) await close();
});
async function fixture(names = ["student"]) {
  const data = mkdtempSync(tmpdir() + "/single-unused-attempt-"),
    origin = "http://localhost:3000";
  const { app, store } = await createApp({
    mode: "development",
    origin,
    data,
    port: 0,
    maintenance: false,
    jump: { host: "localhost", port: 2222, pins: ["0".repeat(64)] },
    class: { host: "localhost", port: 2223, pins: ["1".repeat(64)] },
    agent: { id: "class", signingKey: "/unused", callbackPublicKey: "/unused" },
  });
  cleanups.push(async () => {
    await app.close();
    rmSync(data, { recursive: true, force: true });
  });
  const settings = grantExam(store, "replacement"),
    grants = new AttemptGrants(store, "class"),
    definitions = new ExamDefinitions(store, "class");
  for (const [i, name] of names.entries()) {
    new RosterManagement(store, undefined, "class").add(
      settings.id,
      { username: name, webcam: false },
      "instructor",
    );
    store.db
      .prepare("UPDATE enrollments SET uid=? WHERE exam=? AND username=?")
      .run(10001 + i, settings.id, name);
  }
  const session = store.session("admin", "instructor", null),
    headers = {
      origin,
      cookie: `session=${session.token}`,
      "x-csrf-token": session.csrf,
    },
    post = (url: string, payload: any) =>
      app.inject({ method: "POST", url, headers, payload });
  const preview = async (extra: Record<string, any> = {}) => {
    const response = await post(
      `/api/admin/exams/${settings.id}/grants/additional-preview`,
      {
        definition_revision: definitions.show(settings.id).revision,
        template_version: settings.template_version,
        earliest: Date.now() - 1000,
        latest: Date.now() + 600000,
        usernames: names,
        duration: 4500,
        reason: "Replace the student's unused attempt",
        request: randomUUID(),
        ...extra,
      },
    );
    expect(response.statusCode, response.body).toBe(200);
    return response.json();
  };
  const confirm = (review: any, extra: Record<string, any> = {}) =>
    post(`/api/admin/grant-issuance/${review.id}/confirm`, {
      revision: review.revision,
      request: randomUUID(),
      replacement_policy: "single-unused-v1",
      ...extra,
    });
  const live = (username = names[0]) =>
    grants
      .list({ exam: settings.id, username })
      .grants.filter((g: any) =>
        ["AVAILABLE", "PENDING_NATIVE"].includes(g.status),
      );
  return {
    app,
    store,
    settings,
    grants,
    names,
    headers,
    post,
    preview,
    confirm,
    live,
  };
}
const ref = (grant: any) => ({
  id: grant.id,
  revision: grant.revision,
  hash: grant.hash,
});
function preparing(f: Awaited<ReturnType<typeof fixture>>, grant: any) {
  const attempt = randomUUID(),
    binding = f.grants.binding(grant);
  f.store.db.transaction(() => {
    f.grants.claim(grant.id, attempt, 10001);
    f.store.db
      .prepare(
        "INSERT INTO attempts(id,exam,username,uid,state,settings,grant_id,grant_revision,grant_hash,grant_kind,grant_issued_order,grant_initial,grant_work) VALUES(?,?,?,10001,'PREPARING',?,?,?,?,?,?,?,?)",
      )
      .run(
        attempt,
        f.settings.id,
        "student",
        JSON.stringify(grant.settings),
        grant.id,
        grant.revision,
        grant.hash,
        binding.kind ?? null,
        binding.issuance_order,
        binding.initial_grant ?? null,
        binding.work ? JSON.stringify(binding.work) : null,
      );
  })();
  return attempt;
}

it.each(["overlapping", "disjoint"])(
  "HTTP confirmation replaces an unused attempt with %s dates and the student is assigned only its replacement",
  async (dates) => {
    const f = await fixture(),
      old = f.live()[0];
    const review = await f.preview(
      dates === "disjoint"
        ? {
            earliest: old.settings.latest + 1000,
            latest: old.settings.latest + 600000,
          }
        : {},
    );
    expect(review.rows[0].replaces).toEqual([ref(old)]);
    expect(f.live().map((g: any) => g.id)).toEqual([old.id]);
    const confirmed = await f.confirm(review);
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    const result = confirmed.json(),
      next = result.issued[0].grant;
    expect(result.issued[0].replaced).toEqual([ref(old)]);
    expect(f.grants.show({ id: old.id }).status).toBe("REVOKED");
    expect(f.live().map((g: any) => g.id)).toEqual([next]);
    const student = f.store.session("student", "student", f.settings.id);
    const summary = await f.app.inject({
      url: "/api/student/exam",
      headers: { cookie: `session=${student.token}` },
    });
    expect(summary.statusCode, summary.body).toBe(200);
    expect(summary.json().selected_grant).toBe(next);
    expect(summary.json().grants.map((g: any) => g.id)).toEqual([next]);
    expect(f.store.db.prepare("SELECT count(*) n FROM attempts").get()).toEqual(
      { n: 0 },
    );
    expect(
      f.store.db.prepare("SELECT count(*) n FROM grant_claims").get(),
    ).toEqual({ n: 0 });
    expect(
      f.store.db
        .prepare(
          "SELECT action FROM audit WHERE target=? AND action='supersede-unused-grant'",
        )
        .get(old.id),
    ).toEqual({ action: "supersede-unused-grant" });
  },
);

it("two reviewed confirmations cannot replace an unseen newer permission, and exact successful retries never replace again", async () => {
  const f = await fixture(),
    old = f.live()[0],
    a = await f.preview(),
    b = await f.preview();
  const intent = { request: randomUUID() },
    committed = await f.confirm(a, intent);
  expect(committed.statusCode, committed.body).toBe(200);
  const before = f.store.db
    .prepare("SELECT * FROM attempt_grants ORDER BY rowid")
    .all();
  const stale = await f.confirm(b);
  expect(stale.statusCode, stale.body).toBe(409);
  expect(stale.json().error).toMatch(/changed.*review|review.*changed/i);
  expect(
    f.store.db.prepare("SELECT * FROM attempt_grants ORDER BY rowid").all(),
  ).toEqual(before);
  expect((await f.confirm(a, intent)).json()).toEqual(committed.json());
  const nextReview = await f.preview(),
    nextResult = await f.confirm(nextReview);
  expect(nextResult.statusCode, nextResult.body).toBe(200);
  expect((await f.confirm(a, intent)).json()).toEqual(committed.json());
  expect(f.live()[0].id).toBe(nextResult.json().issued[0].grant);
  expect(f.grants.show({ id: old.id }).status).toBe("REVOKED");
});

it("a revision or setup claim after review makes replacement refuse without changing authority", async () => {
  const f = await fixture(),
    old = f.live()[0],
    review = await f.preview();
  f.grants.revise(
    old.id,
    {
      revision: old.revision,
      changes: { duration: 3600 },
      reason: "Explicit allowance revision",
    },
    "instructor",
  );
  expect((await f.confirm(review)).statusCode).toBe(409);
  const fresh = await f.preview(),
    bound = f.live()[0],
    attempt = preparing(f, bound);
  const refused = await f.confirm(fresh);
  expect(refused.statusCode, refused.body).toBe(409);
  expect(refused.json().error).toMatch(/setup|starting/i);
  expect(f.live()[0].id).toBe(bound.id);
  expect(
    f.store.db
      .prepare("SELECT state FROM grant_claims WHERE attempt=?")
      .get(attempt),
  ).toEqual({ state: "PREPARING" });
  expect(
    f.store.db.prepare("SELECT count(*) n FROM grant_begin_intents").get(),
  ).toEqual({ n: 0 });
});

it("replacement first prevents an old grant claim and a cancelled review does not withdraw the current permission", async () => {
  const f = await fixture(),
    old = f.live()[0],
    review = await f.preview();
  expect((await f.confirm(review)).statusCode).toBe(200);
  expect(() =>
    f.store.db.transaction(() => f.grants.claim(old.id, randomUUID(), 10001))(),
  ).toThrow(/revoked|unavailable/i);
  const current = f.live()[0],
    cancelled = await f.preview();
  const response = await f.post(
    `/api/admin/grant-issuance/${cancelled.id}/cancel`,
    { revision: cancelled.revision },
  );
  expect(response.statusCode, response.body).toBe(200);
  expect(f.live()[0].id).toBe(current.id);
  expect(
    f.store.db.prepare("SELECT count(*) n FROM grant_claims").get(),
  ).toEqual({ n: 0 });
});

it("a later invalid batch member rolls back prior replacements, new jobs, audits and request receipts", async () => {
  const f = await fixture(["alice", "bob"]),
    review = await f.preview(),
    before = f.store.db
      .prepare("SELECT * FROM attempt_grants ORDER BY rowid")
      .all();
  f.store.db.exec(
    "CREATE TRIGGER refuse_bob_replacement BEFORE INSERT ON attempt_grants WHEN NEW.username='bob' BEGIN SELECT RAISE(ABORT,'synthetic late issuance failure'); END",
  );
  const response = await f.confirm(review);
  expect(response.statusCode, response.body).toBe(400);
  expect(response.body).toContain("synthetic late issuance failure");
  expect(
    f.store.db.prepare("SELECT * FROM attempt_grants ORDER BY rowid").all(),
  ).toEqual(before);
  expect(
    f.store.db
      .prepare(
        "SELECT count(*) n FROM audit WHERE action='supersede-unused-grant'",
      )
      .get(),
  ).toEqual({ n: 0 });
  expect(
    f.store.db.prepare("SELECT count(*) n FROM grant_source_setup").get(),
  ).toEqual({ n: 0 });
  expect(
    f.store.db
      .prepare("SELECT status FROM grant_issuance_previews WHERE id=?")
      .get(review.id),
  ).toEqual({ status: "REVIEW" });
  f.store.db.exec("DROP TRIGGER refuse_bob_replacement");
  expect((await f.confirm(review)).statusCode).toBe(200);
  expect(f.live("alice")).toHaveLength(1);
  expect(f.live("bob")).toHaveLength(1);
});

it.each(["start", "original_deadline", "protected", "registered_owner"])(
  "contradictory %s evidence cannot be silently superseded as unused",
  async (field) => {
    const f = await fixture(),
      old = f.live()[0],
      review = await f.preview();
    const attempt = preparing(f, old);
    f.store.db.transaction(() => {
      f.store.db
        .prepare(
          "UPDATE attempts SET state='CANCELLED_BEFORE_START' WHERE id=?",
        )
        .run(attempt);
      f.store.db
        .prepare(
          "UPDATE grant_claims SET state='CANCELLED',ended_at=? WHERE attempt=?",
        )
        .run(Date.now(), attempt);
    })();
    f.store.db
      .prepare(`UPDATE attempts SET ${field}=? WHERE grant_id=?`)
      .run(
        field === "registered_owner"
          ? "still-owned"
          : field === "protected"
            ? 1
            : Date.now(),
        old.id,
      );
    const response = await f.confirm(review);
    expect(response.statusCode, response.body).toBe(409);
    expect(f.live()[0].id).toBe(old.id);
    expect(f.grants.show({ id: old.id }).status).toBe("AVAILABLE");
  },
);

it("confirmation requires the replacement-policy handshake and a legacy unconfirmed review requires a fresh review", async () => {
  const f = await fixture(),
    old = f.live()[0],
    review = await f.preview();
  const withoutMarker = await f.post(
    `/api/admin/grant-issuance/${review.id}/confirm`,
    { revision: review.revision },
  );
  expect(withoutMarker.statusCode, withoutMarker.body).toBe(409);
  expect(f.live()[0].id).toBe(old.id);
  const row = f.store.db
    .prepare("SELECT snapshot FROM grant_issuance_previews WHERE id=?")
    .get(review.id) as any;
  const saved = JSON.parse(row.snapshot);
  delete saved.replacement_policy;
  const { hash } = await import("../../apps/server/src/db.js");
  const snapshot = JSON.stringify(saved),
    revision = hash(snapshot);
  f.store.db
    .prepare(
      "UPDATE grant_issuance_previews SET snapshot=?,revision=? WHERE id=?",
    )
    .run(snapshot, revision, review.id);
  const legacy = await f.confirm({ ...review, revision });
  expect(legacy.statusCode, legacy.body).toBe(409);
  expect(f.live()[0].id).toBe(old.id);
});

it("a pending saved-file replacement after protected completion is assigned without reopening the completed attempt", async () => {
  const f = await fixture(),
    old = f.live()[0],
    source = preparing(f, old),
    start = Date.now() - 7200000,
    checksum = "b".repeat(64);
  f.store.db.transaction(() => {
    f.store.db
      .prepare(
        "UPDATE attempts SET state='COMPLETED',start=?,deadline=?,original_deadline=?,protected=1,checksum=?,access_state='RELEASED' WHERE id=?",
      )
      .run(start, start + 5400000, start + 5400000, checksum, source);
    f.store.db
      .prepare("UPDATE grant_claims SET state='CONSUMED' WHERE attempt=?")
      .run(source);
    f.store.db
      .prepare("UPDATE attempt_grants SET status='CONSUMED' WHERE id=?")
      .run(old.id);
  })();
  const original = f.store.attempt(source),
    review = await f.preview({
      work: { kind: "saved", attempt: source, checksum },
    }),
    confirmed = await f.confirm(review);
  expect(confirmed.statusCode, confirmed.body).toBe(200);
  const next = confirmed.json().issued[0].grant;
  expect(f.grants.show({ id: next }).status).toBe("PENDING_NATIVE");
  const student = f.store.session("student", "student", f.settings.id);
  const summary = await f.app.inject({
    url: "/api/student/exam",
    headers: { cookie: `session=${student.token}` },
  });
  expect(summary.statusCode, summary.body).toBe(200);
  expect(summary.json()).toMatchObject({
    attempt: null,
    selected_grant: next,
    settings: { duration: 4500 },
    attempt_blocked: { status: "PENDING_NATIVE" },
    previous_attempt: { id: source },
  });
  expect(f.store.attempt(source)).toEqual(original);
});

it("a pending Start intent on a cancelled claim still prevents supersession", async () => {
  const f = await fixture(),
    old = f.live()[0],
    review = await f.preview(),
    attempt = preparing(f, old);
  f.store.db.transaction(() => {
    f.store.db
      .prepare("UPDATE attempts SET state='CANCELLED_BEFORE_START' WHERE id=?")
      .run(attempt);
    f.store.db
      .prepare(
        "UPDATE grant_claims SET state='CANCELLED',ended_at=? WHERE attempt=?",
      )
      .run(Date.now(), attempt);
    f.store.db
      .prepare(
        "INSERT INTO grant_begin_intents(id,attempt,transport,state,created_at) VALUES(?,?,?,'PENDING',?)",
      )
      .run(randomUUID(), attempt, randomUUID(), Date.now());
  })();
  const result = await f.confirm(review);
  expect(result.statusCode, result.body).toBe(409);
  expect(f.grants.show({ id: old.id }).status).toBe("AVAILABLE");
  expect(f.live()[0].id).toBe(old.id);
});
