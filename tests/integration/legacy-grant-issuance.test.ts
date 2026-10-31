import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createApp } from "../../apps/server/src/app.js";
import { ExamDefinitions } from "../../apps/server/src/exam-definitions.js";
import { grantExam } from "../fixtures/grant-exam.js";

it("reviews NEW legacy-unused grants, preserves effective settings and confirms once without reserving accounts or inventing history", async () => {
  const data = mkdtempSync(tmpdir() + "/legacy-grants-"),
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
  try {
    const settings = grantExam(store, "legacy"),
      definitions = new ExamDefinitions(store, "class");
    store.db
      .prepare(
        "INSERT INTO enrollments(exam,username,uid,duration,webcam) VALUES('legacy','old01',0,7200,0),('legacy','old02',0,NULL,NULL),('legacy','historical',10001,NULL,NULL)",
      )
      .run();
    store.db
      .prepare(
        "INSERT INTO attempts(id,exam,username,uid,state,settings,access_state) VALUES('history','legacy','historical',10001,'COMPLETED',?,'RELEASED')",
      )
      .run(JSON.stringify(settings));
    const session = store.session("admin", "instructor", null),
      headers = {
        origin,
        cookie: `session=${session.token}`,
        "x-csrf-token": session.csrf,
      },
      post = (url: string, payload: any) =>
        app.inject({ method: "POST", url, headers, payload }),
      read = (id: string) =>
        app.inject({ url: `/api/admin/grant-issuance/${id}`, headers }),
      body = () => ({
        definition_revision: definitions.show("legacy").revision,
        template_version: settings.template_version,
        earliest: Date.now() + 7200000,
        latest: Date.now() + 10800000,
        usernames: ["old01", "old02"],
        reason: "Reviewed NEW grants using selected current settings",
        request: randomUUID(),
      }),
      preview = (input = body()) =>
        post("/api/admin/exams/legacy/grants/issue-preview", input);
    const before = store.db
      .prepare("SELECT * FROM enrollments ORDER BY username")
      .all();
    const input = body(),
      first = await preview(input);
    expect(first.statusCode, first.body).toBe(200);
    const review = first.json();
    expect(review).toMatchObject({
      kind: "NEW_LEGACY_INITIAL_GRANTS",
      status: "REVIEW",
      agent: "class",
      exam: "legacy",
    });
    expect(review.rows).toMatchObject([
      {
        username: "old01",
        settings: {
          duration: 7200,
          webcam: false,
          earliest: input.earliest,
          latest: input.latest,
        },
      },
      { username: "old02", settings: { duration: 5400, webcam: true } },
    ]);
    expect((await preview(input)).json()).toEqual(review);
    expect(
      store.db.prepare("SELECT count(*) n FROM attempt_grants").get(),
    ).toEqual({ n: 0 });
    expect(store.db.prepare("SELECT count(*) n FROM attempts").get()).toEqual({
      n: 1,
    });
    expect(
      store.db.prepare("SELECT * FROM enrollments ORDER BY username").all(),
    ).toEqual(before);
    expect((await read(review.id)).json()).toEqual(review);
    expect(
      (await preview({ ...body(), usernames: ["old01", "historical"] }))
        .statusCode,
    ).toBe(409);
    expect(
      (await preview({ ...body(), usernames: ["old01", "absent"] })).statusCode,
    ).toBe(409);
    const change = { revision: review.revision, request: randomUUID() };
    expect(
      (
        await post(`/api/admin/grant-issuance/${review.id}/confirm`, {
          ...change,
          revision: "0".repeat(64),
        })
      ).statusCode,
    ).toBe(409);
    const other = store.session("admin", "other", null);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/admin/grant-issuance/${review.id}/confirm`,
          headers: {
            origin,
            cookie: `session=${other.token}`,
            "x-csrf-token": other.csrf,
          },
          payload: change,
        })
      ).statusCode,
    ).toBe(403);
    store.db
      .prepare("UPDATE enrollments SET duration=4500 WHERE username='old01'")
      .run();
    const changedEnrollment = await post(
      `/api/admin/grant-issuance/${review.id}/confirm`,
      change,
    );
    expect(changedEnrollment.statusCode).toBe(409);
    expect(changedEnrollment.json().error).toBe(
      "Enrollment or settings for old01 changed after this review. Create a new review. This request allowed no attempts.",
    );
    expect(
      store.db.prepare("SELECT count(*) n FROM attempt_grants").get(),
    ).toEqual({ n: 0 });
    expect(
      (
        await post(`/api/admin/grant-issuance/${review.id}/cancel`, change)
      ).json().status,
    ).toBe("CANCELLED");
    const reusedCancellationRequest = await post(
      `/api/admin/grant-issuance/${review.id}/confirm`,
      change,
    );
    expect(reusedCancellationRequest.statusCode).toBe(409);
    expect(reusedCancellationRequest.json().error).toBe(
      "Grant request ID conflicts with a different intent; inspect current grant and use a new request ID",
    );
    const cancelledReview = await post(
      `/api/admin/grant-issuance/${review.id}/confirm`,
      { ...change, request: randomUUID() },
    );
    expect(cancelledReview.statusCode).toBe(409);
    expect(cancelledReview.json().error).toBe(
      "This review was cancelled or expired. Create a new review before allowing attempts. This request did not allow attempts or reserve accounts.",
    );
    const expired = (await preview()).json();
    store.db
      .prepare("UPDATE grant_issuance_previews SET expires=0 WHERE id=?")
      .run(expired.id);
    expect((await read(expired.id)).json().status).toBe("EXPIRED");
    const expiredReview = await post(
      `/api/admin/grant-issuance/${expired.id}/confirm`,
      {
        revision: expired.revision,
        request: randomUUID(),
      },
    );
    expect(expiredReview.statusCode).toBe(409);
    expect(expiredReview.json().error).toBe(cancelledReview.json().error);
    const stale = (await preview()).json();
    definitions.update(
      "legacy",
      { duration: 3600 },
      definitions.show("legacy").revision,
      "admin",
      "Changed defaults after review",
    );
    const changedDefinition = await post(
      `/api/admin/grant-issuance/${stale.id}/confirm`,
      {
        revision: stale.revision,
        request: randomUUID(),
      },
    );
    expect(changedDefinition.statusCode).toBe(409);
    expect(changedDefinition.json().error).toBe(
      "The exam settings changed after this review. Create a new review. This request allowed no attempts.",
    );
    const current = (await preview()).json(),
      confirm = { revision: current.revision, request: randomUUID() };
    const confirmed = await post(
      `/api/admin/grant-issuance/${current.id}/confirm`,
      confirm,
    );
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(confirmed.json().status).toBe("CONFIRMED");
    expect(confirmed.json().issued).toHaveLength(2);
    expect(
      (
        await post(`/api/admin/grant-issuance/${current.id}/confirm`, confirm)
      ).json(),
    ).toEqual(confirmed.json());
    expect((await read(current.id)).json()).toEqual(confirmed.json());
    expect(
      store.db.prepare("SELECT count(*) n FROM attempt_grants").get(),
    ).toEqual({ n: 2 });
    expect(store.db.prepare("SELECT count(*) n FROM attempts").get()).toEqual({
      n: 1,
    });
    const saved = store.db
      .prepare("SELECT settings FROM grant_revisions ORDER BY grant_id")
      .all() as any[];
    expect(saved.map((r) => JSON.parse(r.settings).duration).sort()).toEqual([
      3600, 4500,
    ]);
    expect((await preview()).statusCode).toBe(409);
  } finally {
    await app.close();
    rmSync(data, { recursive: true, force: true });
  }
});
