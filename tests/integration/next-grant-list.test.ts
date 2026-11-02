import { afterEach, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createApp } from "../../apps/server/src/app.js";
import { AttemptGrants } from "../../apps/server/src/attempt-grants.js";
import { RosterManagement } from "../../apps/server/src/roster-management.js";
import { grantExam } from "../fixtures/grant-exam.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanups.splice(0)) await close();
});
async function fixture(count: number, history = 0) {
  const data = mkdtempSync(tmpdir() + "/next-grant-list-"),
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
  const settings = grantExam(store, "next-list"),
    roster = new RosterManagement(store, undefined, "class"),
    grants = new AttemptGrants(store, "class"),
    names = Array.from(
      { length: count },
      (_, i) => `student${String(i).padStart(3, "0")}`,
    ),
    source = randomUUID(),
    start = Date.now() - 10800000;
  // A real saved-source grant remains PENDING_NATIVE until verified retention.
  // Its legacy student row predates history and unified issuance. Public Add
  // cannot be used to recreate a student who already has an earlier attempt.
  store.db
    .prepare("INSERT INTO enrollments(exam,username,uid) VALUES(?,?,0)")
    .run(settings.id, names[0]);
  store.db
    .prepare(
      "INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline,protected,checksum,access_state) VALUES(?,?,?,10001,'COMPLETED',?,?,?,?,1,?,'RELEASED')",
    )
    .run(
      source,
      settings.id,
      names[0],
      JSON.stringify(settings),
      start,
      start + 5400000,
      start + 5400000,
      "b".repeat(64),
    );
  for (const username of names.slice(1))
    roster.add(settings.id, { username }, "instructor");
  store.db.transaction(() =>
    grants.additional(
      settings,
      names[0],
      "instructor",
      "Synthetic saved-source permission for list inspection",
      { kind: "saved", attempt: source, checksum: "b".repeat(64) },
    ),
  )();
  const claimed = grants.current(settings.id, names[1])!,
    attempt = randomUUID();
  store.db.transaction(() => {
    grants.claim(claimed.id, attempt, 10002);
    store.db
      .prepare(
        "INSERT INTO attempts(id,exam,username,uid,state,settings,grant_id,grant_revision,grant_hash,grant_issued_order) VALUES(?,?,?,10002,'PREPARING',?,?,?,?,?)",
      )
      .run(
        attempt,
        settings.id,
        names[1],
        JSON.stringify(claimed.settings),
        claimed.id,
        claimed.revision,
        claimed.hash,
        claimed.issuance_order,
      );
  })();
  const closed = grants.current(settings.id, names[2])!;
  grants.revise(
    closed.id,
    {
      revision: closed.revision,
      changes: { earliest: start, latest: start + 5400000 },
      reason:
        "Synthetic closed dates remain available for instructor inspection",
    },
    "instructor",
  );
  if (history) {
    roster.add(settings.id, { username: "historyuser" }, "instructor");
    store.db.transaction(() => {
      let last;
      for (let i = 0; i < history; i++)
        last = grants.additional(
          settings,
          "historyuser",
          "instructor",
          "Synthetic retained cancelled permission history",
        );
      grants.revoke(
        last!.id,
        {
          revision: last!.revision,
          reason: "Cancel the last synthetic historical permission",
        },
        "instructor",
      );
    })();
  }
  const session = store.session("admin", "instructor", null),
    headers = { origin, cookie: `session=${session.token}` };
  const get = (query = "", auth = headers) =>
    app.inject({
      url: `/api/admin/exams/${settings.id}/grants${query ? "?" + query : ""}`,
      headers: auth,
    });
  const authority = () =>
    Object.fromEntries(
      [
        "attempts",
        "attempt_grants",
        "grant_revisions",
        "grant_claims",
        "grant_begin_intents",
        "grant_source_retentions",
        "grant_source_setup",
      ].map((table) => [
        table,
        store.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),
      ]),
    );
  return {
    app,
    store,
    settings,
    grants,
    names,
    claimed,
    attempt,
    headers,
    get,
    authority,
  };
}

it("loads seventy next permissions in one bounded read despite a thousand historical permissions, retaining pending and claimed rows", async () => {
  const f = await fixture(70, 1000),
    before = f.authority();
  const response = await f.get("next_only=true&limit=200");
  expect(response.statusCode, response.body).toBe(200);
  const page = response.json();
  expect(page.grants).toHaveLength(70);
  expect(page.next).toBeNull();
  expect(new Set(page.grants.map((g: any) => g.username))).toEqual(
    new Set(f.names),
  );
  expect(
    page.grants.every((g: any) =>
      ["AVAILABLE", "PENDING_NATIVE"].includes(g.status),
    ),
  ).toBe(true);
  expect(page.grants.find((g: any) => g.username === f.names[0])).toMatchObject(
    { status: "PENDING_NATIVE", work: { kind: "saved" } },
  );
  expect(page.grants.find((g: any) => g.id === f.claimed.id).claims).toEqual([
    expect.objectContaining({ attempt: f.attempt, state: "PREPARING" }),
  ]);
  expect(
    page.grants.find((g: any) => g.username === f.names[2]).settings.latest,
  ).toBeLessThan(Date.now());
  const scoped = await f.get(`next_only=true&username=${f.names[1]}`);
  expect(scoped.statusCode, scoped.body).toBe(200);
  expect(scoped.json().grants.map((g: any) => g.id)).toEqual([f.claimed.id]);
  const original = await f.get("limit=200"),
    explicit = await f.get("next_only=false&limit=200");
  expect(original.statusCode, original.body).toBe(200);
  expect(original.json().grants).toHaveLength(200);
  expect(original.json().grants.some((g: any) => g.status === "REVOKED")).toBe(
    true,
  );
  expect(explicit.json()).toEqual(original.json());
  expect(f.authority()).toEqual(before);
  const plan = f.store.db
    .prepare(
      "EXPLAIN QUERY PLAN SELECT id FROM attempt_grants WHERE agent=? AND exam=? AND status IN ('AVAILABLE','PENDING_NATIVE') AND id>? ORDER BY id LIMIT ?",
    )
    .all("class", f.settings.id, "", 201);
  expect(plan.map((r: any) => r.detail).join(" ")).toContain(
    "single_unused_grant",
  );
});

it("paginates next-only permission metadata at two hundred and keeps authorization, scope and strict boolean validation", async () => {
  const f = await fixture(230),
    before = f.authority();
  const first = await f.get("next_only=true&limit=200");
  expect(first.statusCode, first.body).toBe(200);
  const page = first.json();
  expect(page.grants).toHaveLength(200);
  expect(page.next).toBe(page.grants.at(-1).id);
  const last = await f.get(`next_only=true&limit=200&after=${page.next}`);
  expect(last.statusCode, last.body).toBe(200);
  expect(last.json().grants).toHaveLength(30);
  expect(last.json().next).toBeNull();
  const ids = [...page.grants, ...last.json().grants].map((g: any) => g.id);
  expect(new Set(ids).size).toBe(230);
  expect(ids).toEqual([...ids].sort());
  expect(
    (await f.get("next_only=true", { origin: f.headers.origin, cookie: "" }))
      .statusCode,
  ).toBe(401);
  const student = f.store.session("student", "student000", f.settings.id);
  expect(
    (
      await f.get("next_only=true", {
        origin: f.headers.origin,
        cookie: `session=${student.token}`,
      })
    ).statusCode,
  ).toBe(401);
  const scoped = await f.get(
    "next_only=true&exam=other-exam&username=student001",
  );
  expect(scoped.statusCode, scoped.body).toBe(200);
  expect(
    scoped
      .json()
      .grants.every(
        (g: any) => g.exam === f.settings.id && g.username === "student001",
      ),
  ).toBe(true);
  for (const value of [
    "1",
    "0",
    "yes",
    "TRUE",
    "False",
    "null",
    "",
    "true&next_only=false",
  ])
    expect((await f.get("next_only=" + value)).statusCode, value).toBe(400);
  for (const query of [
    "next_only=true&limit=201",
    "next_only=true&after=bad",
    "next_only=true&username=bad%20user",
    "next_only=true&agent=other",
  ])
    expect((await f.get(query)).statusCode, query).toBe(400);
  expect(f.authority()).toEqual(before);
});
