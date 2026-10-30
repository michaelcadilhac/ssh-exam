import { expect, it, vi } from "vitest";
import {
  randomUUID,
  randomBytes,
  generateKeyPairSync,
  sign,
} from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createApp } from "../../apps/server/src/app.js";
import { ExamDefinitions } from "../../apps/server/src/exam-definitions.js";
import { grantExam } from "../fixtures/grant-exam.js";

async function savedGrant(f: Awaited<ReturnType<typeof fixture>>) {
  const preview = await f.post(
    `/api/admin/exams/${f.exam}/grants/additional-preview`,
    { ...f.input, request: randomUUID() },
  );
  expect(preview.statusCode, preview.body).toBe(200);
  const confirmed = await f.post(
    `/api/admin/grant-issuance/${preview.json().id}/confirm`,
    { revision: preview.json().revision, request: randomUUID() },
  );
  expect(confirmed.statusCode, confirmed.body).toBe(200);
  return confirmed.json().issued.find((g: any) => g.username === "savedstudent")
    .grant as string;
}

it("one actor-bound review status read projects a consistent cohort without exposing another instructor's request", async () => {
  const f = await fixture();
  try {
    const id = await savedGrant(f),
      row = f.store.db
        .prepare(
          "SELECT id FROM grant_issuance_previews WHERE status='CONFIRMED'",
        )
        .get() as any;
    const url = `/api/admin/grant-issuance/${row.id}/source-setup`;
    expect((await f.app.inject({ url })).statusCode).toBe(401);
    const response = await f.app.inject({ url, headers: f.headers });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().rows).toHaveLength(3);
    expect(response.json().rows.find((r: any) => r.id === id)).toMatchObject({
      username: "savedstudent",
      status: "QUEUED",
      grant_status: "PENDING_NATIVE",
      grant: { id, revision: 1, status: "PENDING_NATIVE", claims: [] },
    });
    expect(response.body).not.toMatch(/page_hash|password|settings_hash/);
    const other = f.store.session("admin", "otherteacher", null);
    expect(
      (
        await f.app.inject({
          url,
          headers: { ...f.headers, cookie: `session=${other.token}` },
        })
      ).statusCode,
    ).toBe(403);
  } finally {
    await f.close();
  }
});

async function fixture() {
  const data = mkdtempSync(tmpdir() + "/prof-attempts-"),
    origin = "http://localhost:3000";
  const keys = generateKeyPairSync("ed25519", {
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
        "grants.source-next",
        "grants.source-report",
        "grants.source-status",
        "grants.source-retry",
        "grants.source-plan",
        "grants.source-confirm",
      ],
    },
  });
  const exam = "prof-mixed",
    settings = grantExam(store, exam);
  const definitions = new ExamDefinitions(store, "class");
  definitions.update(
    exam,
    { duration: 95 },
    definitions.show(exam).revision,
    "instructor",
    "Synthetic exact-second default for preservation",
  );
  for (const [username, uid, duration, webcam] of [
    ["savedstudent", 10001, null, 0],
    ["starterstudent", 10002, 900, null],
    ["emptystudent", 10003, 5400, 0],
  ])
    store.db
      .prepare(
        "INSERT INTO enrollments(exam,username,uid,duration,webcam) VALUES(?,?,?,?,?)",
      )
      .run(exam, username, uid, duration, webcam);
  const source = randomUUID(),
    start = Date.now() - 7200000,
    checksum = "b".repeat(64);
  store.db
    .prepare(
      "INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline,protected,checksum,access_state) VALUES(?,?,'savedstudent',10001,'COMPLETED',?,?,?,?,1,?,'RELEASED')",
    )
    .run(
      source,
      exam,
      JSON.stringify(settings),
      start,
      start + 5400000,
      start + 5400000,
      checksum,
    );
  const original = store.attempt(source),
    session = store.session("admin", "instructor", null),
    headers = {
      origin,
      cookie: `session=${session.token}`,
      "x-csrf-token": session.csrf,
    };
  const post = (url: string, payload: any) =>
    app.inject({ method: "POST", url, headers, payload });
  const input = {
    definition_revision: new ExamDefinitions(store, "class").show(exam)
      .revision,
    template_version: settings.template_version,
    earliest: Date.now() - 1000,
    latest: Date.now() + 600000,
    usernames: ["savedstudent", "starterstudent", "emptystudent"],
    preserve_duration: true,
    reason:
      "Instructor approved another attempt with each student's time limit",
    request: randomUUID(),
    work_sources: [
      {
        username: "savedstudent",
        work: { kind: "saved", attempt: source, checksum },
      },
      {
        username: "starterstudent",
        work: {
          kind: "template",
          name: settings.template,
          hash: settings.template_version,
        },
      },
      { username: "emptystudent", work: { kind: "empty" } },
    ],
  };
  return {
    app,
    store,
    exam,
    settings,
    source,
    original,
    headers,
    post,
    input,
    native: async (operation: string, body: unknown) => {
      const payload = Buffer.from(
        JSON.stringify({
          version: 1,
          purpose: "ssh-exam-management/v1",
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

it("saved-work setup leases survive worker loss and cannot turn a child success into file protection", async () => {
  const f = await fixture();
  try {
    const id = await savedGrant(f),
      path = `/api/admin/grants/${id}/source-setup?revision=1`;
    expect((await f.app.inject({ url: path })).statusCode).toBe(401);
    const get = () => f.app.inject({ url: path, headers: f.headers });
    expect((await get()).json()).toMatchObject({
      status: "QUEUED",
      grant_status: "PENDING_NATIVE",
      tries: 0,
    });
    const first = (await f.native("grants.source-next", {})).result.task;
    expect(first).toMatchObject({ id, revision: 1 });
    expect((await f.native("grants.source-next", {})).result.task).toBeNull();
    // Coordinator died: lease expires; the confirmation intent must not change.
    f.store.db
      .prepare("UPDATE grant_source_setup SET lease_until=0 WHERE grant_id=?")
      .run(id);
    const second = (await f.native("grants.source-next", {})).result.task;
    expect(second.request).toBe(first.request);
    expect(second.lease).not.toBe(first.lease);
    expect(
      await f.native("grants.source-report", {
        id,
        revision: 1,
        lease: first.lease,
        error: "stale worker",
      }),
    ).toMatchObject({ ok: false, status: 409 });
    // Even a zero exit status cannot authorize Ready without native confirmation.
    expect(
      await f.native("grants.source-report", {
        id,
        revision: 1,
        lease: second.lease,
        error: "",
      }),
    ).toMatchObject({
      ok: true,
      result: { status: "FAILED", grant_status: "PENDING_NATIVE" },
    });
    expect((await f.native("grants.source-next", {})).result.task).toBeNull();
    expect(
      (
        await f.post(`/api/admin/grants/${id}/source-setup`, {
          revision: 1,
          request: randomUUID(),
        })
      ).statusCode,
    ).toBe(200);
    const third = (await f.native("grants.source-next", {})).result.task;
    expect(third.request).toBe(first.request);
    const grant = (
      await f.app.inject({ url: `/api/admin/grants/${id}`, headers: f.headers })
    ).json();
    const confirmation = await f.native("grants.source-confirm", {
      id,
      revision: 1,
      grant_hash: grant.hash,
      state: "RETAINED",
      source: {
        attempt: f.source,
        checksum: f.input.work_sources[0].work.checksum,
        uid: 10001,
        metadata_hash: "c".repeat(64),
      },
      retention_hash: "d".repeat(64),
      retained_at: Date.now(),
    });
    expect(confirmation).toMatchObject({
      ok: true,
      result: { status: "AVAILABLE" },
    });
    // Native confirmation committed, but child lost its reply or coordinator
    // restarted. A late failure is harmless and must reconcile to Ready.
    expect(
      await f.native("grants.source-report", {
        id,
        revision: 1,
        lease: third.lease,
        error: "Lost confirmation response",
      }),
    ).toMatchObject({
      ok: true,
      result: { status: "READY", grant_status: "AVAILABLE" },
    });
    expect((await get()).json()).toMatchObject({ status: "READY", tries: 3 });
    expect(f.store.attempt(f.source)).toEqual(f.original);
    expect(
      f.store.db.prepare("SELECT count(*) n FROM grant_claims").get(),
    ).toEqual({ n: 0 });
    expect(f.store.db.prepare("SELECT count(*) n FROM attempts").get()).toEqual(
      { n: 1 },
    );
  } finally {
    await f.close();
  }
});

it("saved-work setup cancels stale, revoked and expired work without changing the original source", async () => {
  const f = await fixture();
  try {
    const id = await savedGrant(f),
      first = (await f.native("grants.source-next", {})).result.task;
    const revised = await f.post(`/api/admin/grants/${id}/revise`, {
      revision: 1,
      changes: { duration: 120 },
      reason: "Explicit revised unused time limit",
      request: randomUUID(),
    });
    expect(revised.statusCode, revised.body).toBe(200);
    expect(
      await f.native("grants.source-report", {
        id,
        revision: 1,
        lease: first.lease,
        error: "old revision",
      }),
    ).toMatchObject({
      ok: true,
      result: { status: "CANCELLED", current_revision: 2 },
    });
    const second = (await f.native("grants.source-next", {})).result.task;
    expect(second).toMatchObject({ id, revision: 2 });
    expect(second.request).not.toBe(first.request);
    expect(
      (
        await f.post(`/api/admin/grants/${id}/revoke`, {
          revision: 2,
          reason: "Instructor cancelled unused attempt",
          request: randomUUID(),
        })
      ).statusCode,
    ).toBe(200);
    expect(
      await f.native("grants.source-report", {
        id,
        revision: 2,
        lease: second.lease,
        error: "cancelled",
      }),
    ).toMatchObject({
      ok: true,
      result: { status: "CANCELLED", grant_status: "REVOKED" },
    });
    expect(
      (await f.post(`/api/admin/grants/${id}/source-setup`, { revision: 2 }))
        .statusCode,
    ).toBe(409);
    const expired = await savedGrant(f);
    // Time advances beyond this synthetic grant's explicit window.
    const clock = vi.spyOn(Date, "now").mockReturnValue(f.input.latest + 1);
    expect((await f.native("grants.source-next", {})).result.task).toBeNull();
    expect(
      (
        await f.app.inject({
          url: `/api/admin/grants/${expired}/source-setup?revision=1`,
          headers: f.headers,
        })
      ).json(),
    ).toMatchObject({ status: "CANCELLED", grant_status: "PENDING_NATIVE" });
    clock.mockRestore();
    expect(f.store.attempt(f.source)).toEqual(f.original);
    expect(
      f.store.db.prepare("SELECT count(*) n FROM grant_claims").get(),
    ).toEqual({ n: 0 });
  } finally {
    vi.restoreAllMocks();
    await f.close();
  }
});

it("one reviewed batch mixes starting files and preserves each current time limit down to exact seconds", async () => {
  const f = await fixture();
  try {
    const preview = await f.post(
      `/api/admin/exams/${f.exam}/grants/additional-preview`,
      f.input,
    );
    expect(preview.statusCode, preview.body).toBe(200);
    const review = preview.json();
    expect(
      review.rows.map((r: any) => [
        r.username,
        r.settings.duration,
        r.settings.webcam,
        r.work.kind,
      ]),
    ).toEqual([
      ["emptystudent", 5400, false, "empty"],
      ["savedstudent", 95, false, "saved"],
      ["starterstudent", 900, true, "template"],
    ]);
    expect(
      f.store.db.prepare("SELECT count(*) n FROM attempt_grants").get(),
    ).toEqual({ n: 0 });
    const body = { revision: review.revision, request: randomUUID() };
    const confirmed = await f.post(
      `/api/admin/grant-issuance/${review.id}/confirm`,
      body,
    );
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(
      (
        await f.post(`/api/admin/grant-issuance/${review.id}/confirm`, body)
      ).json(),
    ).toEqual(confirmed.json());
    const grants = await f.app.inject({
      url: `/api/admin/exams/${f.exam}/grants`,
      headers: f.headers,
    });
    expect(grants.statusCode, grants.body).toBe(200);
    expect(
      grants
        .json()
        .grants.map((g: any) => [g.username, g.status, g.settings.duration])
        .sort(),
    ).toEqual([
      ["emptystudent", "AVAILABLE", 5400],
      ["savedstudent", "PENDING_NATIVE", 95],
      ["starterstudent", "AVAILABLE", 900],
    ]);
    expect(f.store.attempt(f.source)).toEqual(f.original);
    expect(
      f.store.db.prepare("SELECT count(*) n FROM grant_claims").get(),
    ).toEqual({ n: 0 });
    expect(f.store.db.prepare("SELECT count(*) n FROM attempts").get()).toEqual(
      { n: 1 },
    );
  } finally {
    await f.close();
  }
});

it("mixed reviews reject ambiguous time choices, missing owners and changed enrollment without partial issuance", async () => {
  const f = await fixture();
  try {
    for (const patch of [
      { duration: 600 },
      { work: { kind: "empty" } },
      { work_sources: f.input.work_sources.slice(0, 2) },
      {
        work_sources: [
          ...f.input.work_sources.slice(0, 2),
          { username: "outsider", work: { kind: "empty" } },
        ],
      },
    ]) {
      const refused = await f.post(
        `/api/admin/exams/${f.exam}/grants/additional-preview`,
        { ...f.input, ...patch, request: randomUUID() },
      );
      expect(refused.statusCode, refused.body).toBe(400);
    }
    const preview = await f.post(
      `/api/admin/exams/${f.exam}/grants/additional-preview`,
      {
        ...f.input,
        student_settings: [
          { username: "starterstudent", duration: 600, webcam: false },
        ],
        request: randomUUID(),
      },
    );
    expect(preview.statusCode, preview.body).toBe(200);
    expect(
      preview.json().rows.find((r: any) => r.username === "starterstudent")
        .settings,
    ).toMatchObject({ duration: 600, webcam: false });
    const edit = await f.post(`/api/admin/exams/${f.exam}/roster/settings`, {
      usernames: ["savedstudent"],
      duration: 120,
    });
    expect(edit.statusCode, edit.body).toBe(200);
    const confirmed = await f.post(
      `/api/admin/grant-issuance/${preview.json().id}/confirm`,
      { revision: preview.json().revision, request: randomUUID() },
    );
    expect(confirmed.statusCode, confirmed.body).toBe(409);
    expect(
      f.store.db.prepare("SELECT count(*) n FROM attempt_grants").get(),
    ).toEqual({ n: 0 });
    expect(
      f.store.db.prepare("SELECT count(*) n FROM grant_claims").get(),
    ).toEqual({ n: 0 });
    expect(f.store.attempt(f.source)).toEqual(f.original);
  } finally {
    await f.close();
  }
});

it("instructor file pickers retrieve existing source metadata without credentials or pasted references", async () => {
  const f = await fixture();
  try {
    f.store.db
      .prepare("UPDATE attempts SET page_hash=? WHERE id=?")
      .run("private-page-proof", f.source);
    const list = `/api/admin/exams/${f.exam}/attempts?q=savedstudent&limit=1`;
    expect((await f.app.inject({ url: list })).statusCode).toBe(401);
    const page = await f.app.inject({ url: list, headers: f.headers });
    expect(page.statusCode, page.body).toBe(200);
    expect(page.json().attempts).toMatchObject([
      {
        id: f.source,
        username: "savedstudent",
        protected: 1,
        attempt_number: 1,
      },
    ]);
    expect(page.json().next).toBeNull();
    expect(page.body).not.toContain("private-page-proof");
    expect(page.body).not.toContain("page_hash");
    const detail = await f.app.inject({
      url: `/api/admin/attempts/${f.source}/metadata`,
      headers: f.headers,
    });
    expect(detail.statusCode, detail.body).toBe(200);
    expect(detail.json().attempt).toMatchObject({
      id: f.source,
      exam: f.exam,
      username: "savedstudent",
      checksum: "b".repeat(64),
    });
    expect(detail.body).not.toContain("private-page-proof");
    expect(
      f.store.db.prepare("SELECT count(*) n FROM attempt_grants").get(),
    ).toEqual({ n: 0 });
  } finally {
    await f.close();
  }
});

it("recent requests are retrieved by the signed-in instructor with complete cursor paging", async () => {
  const f = await fixture();
  try {
    const ids = [];
    for (let i = 0; i < 2; i++) {
      const result = await f.post(
        `/api/admin/exams/${f.exam}/grants/additional-preview`,
        { ...f.input, request: randomUUID() },
      );
      expect(result.statusCode, result.body).toBe(200);
      ids.push(result.json().id);
    }
    const url = `/api/admin/exams/${f.exam}/grant-reviews?limit=1`;
    expect((await f.app.inject({ url })).statusCode).toBe(401);
    const first = await f.app.inject({ url, headers: f.headers });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json().rows).toHaveLength(1);
    expect(first.json().next).toBe(first.json().rows[0].id);
    const second = await f.app.inject({
      url: `${url}&after=${first.json().next}`,
      headers: f.headers,
    });
    expect(second.statusCode, second.body).toBe(200);
    expect(second.json().next).toBeNull();
    expect(
      [...first.json().rows, ...second.json().rows]
        .map((r: any) => r.id)
        .sort(),
    ).toEqual(ids.sort());
    const other = f.store.session("admin", "otherteacher", null);
    const otherView = await f.app.inject({
      url,
      headers: { ...f.headers, cookie: `session=${other.token}` },
    });
    expect(otherView.statusCode, otherView.body).toBe(200);
    expect(otherView.json().rows).toEqual([]);
    expect(
      f.store.db.prepare("SELECT count(*) n FROM attempt_grants").get(),
    ).toEqual({ n: 0 });
  } finally {
    await f.close();
  }
});
