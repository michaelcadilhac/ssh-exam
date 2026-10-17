import { expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { createApp } from "../../apps/server/src/app.js";
import { Agent } from "../../apps/server/src/agent.js";
async function setup(history = false) {
  const dir = mkdtempSync(tmpdir() + "/exam-dashboard-");
  const mock = vi
    .spyOn(Agent.prototype, "call")
    .mockImplementation(async (op) => {
      if (op === "health") return { ready: true, fixture: true };
      throw Error("No independent SSH control route");
    });
  const { app, store } = await createApp({
    mode: "development",
    origin: "http://localhost:3000",
    data: dir,
    port: 3000,
    maintenance: false,
    jump: { host: "localhost", port: 2222, pins: ["0".repeat(64)] },
    class: { host: "localhost", port: 2223, pins: ["0".repeat(64)] },
    agent: {
      id: "class",
      signingKey: "/missing",
      callbackPublicKey: "/missing",
    },
  });
  store.db
    .prepare("INSERT INTO exams VALUES(?,?)")
    .run("e", JSON.stringify({ duration: 5400, webcam: true }));
  store.db
    .prepare("INSERT INTO exams VALUES(?,?)")
    .run("other", JSON.stringify({ duration: 3600 }));
  const selectedExam = history ? "sandbox" : "e";
  for (const username of ["alice", "bob"])
    store.db
      .prepare("INSERT INTO enrollments VALUES(?,?,?,?,?,?)")
      .run(
        selectedExam,
        username,
        null,
        null,
        null,
        username === "alice" ? 1001 : 1002,
      );
  const start = Date.now() - 60000,
    deadline = Date.now() + 500123;
  const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  for (const [i, id] of ids.entries())
    store.db
      .prepare(
        "INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline) VALUES(?,?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        i === 3 ? "other" : selectedExam,
        i === 2 ? "removed" : i === 1 && !history ? "bob" : "alice",
        i === 3 ? 1004 : i === 2 ? 1003 : i === 1 && !history ? 1002 : 1001,
        i === 0 ? "ACTIVE" : i === 3 ? "LOCKED" : "COMPLETED",
        JSON.stringify({ duration: 5400, webcam: true }),
        start,
        deadline,
        deadline,
      );
  const session = store.session("admin", "instructor", null),
    headers = {
      cookie: `session=${session.token}`,
      origin: "http://localhost:3000",
      "x-csrf-token": session.csrf,
    };
  const post = (path: string, payload: any, h = headers) =>
    app.inject({
      method: "POST",
      url: `/api/admin/exams/${selectedExam}/` + path,
      headers: h,
      payload,
    });
  return {
    exam: selectedExam,
    app,
    store,
    headers,
    post,
    ids,
    deadline,
    close: async () => {
      await app.close();
      mock.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
it("scopes the combined dashboard to the selected exam, includes all attempts and removed students", async () => {
  const t = await setup(true);
  try {
    expect(
      (await t.app.inject({ url: `/api/admin/exams/${t.exam}/dashboard` }))
        .statusCode,
    ).toBe(401);
    const result = await t.app.inject({
      url: `/api/admin/exams/${t.exam}/dashboard`,
      headers: t.headers,
    });
    expect(result.statusCode).toBe(200);
    const body = result.json();
    expect(body.total).toBe(3);
    expect(body.students.map((s: any) => s.username)).toEqual([
      "alice",
      "bob",
      "removed",
    ]);
    expect(body.students[0].attempts).toHaveLength(2);
    expect(body.students[0].attempts.every((a: any) => a.exam === t.exam)).toBe(
      true,
    );
    expect(body.students[1].attempts).toEqual([]);
    expect(body.students[2].enrollment).toBeNull();
    expect(body.counts).toEqual({
      students: 3,
      working: 0,
      attention: 0,
      active: 1,
      locked: 0,
      collected: 0,
    });
    const filtered = await t.app.inject({
      url: `/api/admin/exams/${t.exam}/dashboard?q=bob`,
      headers: t.headers,
    });
    expect(filtered.json().students).toHaveLength(1);
    const other = await t.app.inject({
      url: "/api/admin/exams/other/dashboard",
      headers: t.headers,
    });
    expect(other.json().students[0].attempts).toHaveLength(1);
  } finally {
    await t.close();
  }
});
it("bulk settings change only future allowances/webcams, preserve snapshots and fail atomically", async () => {
  const t = await setup();
  try {
    const before = t.store.attempt(t.ids[0]);
    expect(
      (
        await t.post("roster/settings", {
          usernames: ["alice", "bob"],
          duration: 7200,
          webcam: false,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      t.store.db
        .prepare("SELECT duration,webcam FROM enrollments WHERE exam='e'")
        .all(),
    ).toEqual([
      { duration: 7200, webcam: 0 },
      { duration: 7200, webcam: 0 },
    ]);
    expect(t.store.attempt(t.ids[0])).toEqual(before);
    expect(
      (
        await t.post("roster/settings", {
          usernames: ["alice", "missing"],
          duration: 600,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        t.store.db
          .prepare("SELECT duration FROM enrollments WHERE username='alice'")
          .get() as any
      ).duration,
    ).toBe(7200);
    expect(
      (
        await t.post("roster/settings", {
          usernames: ["alice"],
          duration: null,
          webcam: null,
        })
      ).statusCode,
    ).toBe(200);
    const student = t.store.session("student", "alice", "e");
    expect(
      (
        await t.post(
          "roster/settings",
          { usernames: ["alice"], webcam: true },
          {
            ...t.headers,
            cookie: `session=${student.token}`,
            "x-csrf-token": student.csrf,
          },
        )
      ).statusCode,
    ).toBe(401);
  } finally {
    await t.close();
  }
});
it("bulk clock actions are durable, per-attempt, additive, retry-safe and scoped to the exam", async () => {
  const t = await setup();
  try {
    const target = { id: t.ids[0], revision: 0, requestID: randomUUID() };
    let result = await t.post("attempts/clocks", {
      action: "extend",
      minutes: 7,
      targets: [target, { id: t.ids[1], revision: 0, requestID: randomUUID() }],
    });
    expect(result.statusCode).toBe(200);
    expect(result.json().results.map((r: any) => r.status)).toEqual([
      "pending",
      "failed",
    ]);
    const pending = JSON.parse(
      (
        t.store.db
          .prepare("SELECT body FROM clock_reset_requests WHERE attempt=?")
          .get(target.id) as any
      ).body,
    );
    expect(pending).toMatchObject({
      remaining_seconds: 0,
      extend_seconds: 420,
      deadline: t.deadline,
    });
    const first = pending.requested_at;
    result = await t.post("attempts/clocks", {
      action: "extend",
      minutes: 7,
      targets: [target],
    });
    expect(result.json().results[0].status).toBe("pending");
    expect(
      t.store.db.prepare("SELECT * FROM clock_reset_requests").all(),
    ).toHaveLength(1);
    expect(
      JSON.parse(
        (
          t.store.db
            .prepare("SELECT body FROM clock_reset_requests")
            .get() as any
        ).body,
      ).requested_at,
    ).toBe(first);
    expect(
      (
        await t.post("attempts/clocks", {
          action: "extend",
          minutes: 8,
          targets: [target],
        })
      ).json().results[0].status,
    ).toBe("failed");
    expect(
      (
        await t.post("attempts/clocks", {
          action: "reset",
          targets: [{ id: t.ids[3], revision: 0, requestID: randomUUID() }],
        })
      ).statusCode,
    ).toBe(403);
    expect(t.store.attempt(target.id).deadline).toBe(t.deadline);
    expect(
      (
        await t.post("attempts/clocks", {
          action: "reset",
          targets: [{ ...target, requestID: randomUUID(), revision: 1 }],
        })
      ).json().results[0].status,
    ).toBe("failed");
  } finally {
    await t.close();
  }
});
it("reset uses each student's future configured allowance with exam-default fallback", async () => {
  const t = await setup();
  try {
    await t.post("roster/settings", { usernames: ["alice"], duration: 7200 });
    const result = await t.post("attempts/clocks", {
      action: "reset",
      targets: [{ id: t.ids[0], revision: 0, requestID: randomUUID() }],
    });
    expect(result.json().results[0].pending.remaining_seconds).toBe(7200);
    expect(result.json().results[0].pending.extend_seconds).toBeUndefined();
  } finally {
    await t.close();
  }
});

it("filters before pagination, keeps original attempt numbers and scopes an open review to its exam", async () => {
  const t = await setup(true);
  try {
    for (let i = 0; i < 120; i++)
      t.store.db
        .prepare("INSERT INTO enrollments(exam,username,uid) VALUES(?,?,?)")
        .run(t.exam, `student${String(i).padStart(3, "0")}`, 2000 + i);
    const late = randomUUID();
    t.store.db
      .prepare("INSERT INTO enrollments(exam,username,uid) VALUES(?,?,?)")
      .run(t.exam, "zz_last_student", 3000);
    t.store.db
      .prepare(
        "INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline) VALUES(?,?,?,?,?,?,?,?,?)",
      )
      .run(
        late,
        t.exam,
        "zz_last_student",
        3000,
        "LOCKED",
        JSON.stringify({ webcam: true }),
        Date.now() - 1000,
        t.deadline,
        t.deadline,
      );
    const read = async (query: string) =>
      t.app.inject({
        url: `/api/admin/exams/${t.exam}/dashboard?${query}`,
        headers: t.headers,
      });
    const attention = (await read("view=attention")).json();
    expect(attention.total).toBe(1);
    expect(attention.students.map((s: any) => s.username)).toEqual([
      "zz_last_student",
    ]);
    expect(attention.counts.students).toBe(124);
    expect(attention.counts.attention).toBe(1);
    expect(
      (await read("offset=100"))
        .json()
        .students.some((s: any) => s.username === "zz_last_student"),
    ).toBe(true);
    const completed = (await read(`view=COMPLETED&review=${t.ids[0]}`)).json();
    expect(
      completed.students.find((s: any) => s.username === "alice").attempts[0]
        .attempt_number,
    ).toBe(2);
    expect(completed.reviewAttempt).toMatchObject({
      id: t.ids[0],
      state: "ACTIVE",
      attempt_number: 1,
    });
    expect((await read(`review=${t.ids[3]}`)).json().reviewAttempt).toBeNull();
    expect((await read("view=unknown")).statusCode).toBe(400);
    expect((await read("review=invalid")).statusCode).toBe(400);
  } finally {
    await t.close();
  }
});
