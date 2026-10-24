import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createApp } from "../../apps/server/src/app.js";
import { ExamDefinitions } from "../../apps/server/src/exam-definitions.js";
import { grantExam } from "../fixtures/grant-exam.js";

it("reviews fixed saved-work authority but keeps it unavailable and cancellable until durable native source confirmation", async () => {
  const data = mkdtempSync(tmpdir() + "/saved-source-grant-"),
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
    const settings = grantExam(store, "saved-work"),
      source = randomUUID(),
      checksum = "b".repeat(64),
      definitions = new ExamDefinitions(store, "class"),
      ended = Date.now() - 7200000;
    definitions.update(
      settings.id,
      {
        earliest: ended - 5400000,
        latest: ended - 1000,
      },
      definitions.show(settings.id).revision,
      "instructor",
      "Closed original default window",
    );
    store.db
      .prepare(
        "INSERT INTO enrollments(exam,username,uid,webcam) VALUES(?,'student',10001,0)",
      )
      .run(settings.id);
    store.db
      .prepare(
        "INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline,protected,checksum,access_state) VALUES(?,?,'student',10001,'COMPLETED',?,?,?,?,1,?,'RELEASED')",
      )
      .run(
        source,
        settings.id,
        JSON.stringify(settings),
        ended - 5400000,
        ended,
        ended,
        checksum,
      );
    const before = store.attempt(source),
      session = store.session("admin", "instructor", null),
      headers = {
        origin,
        cookie: `session=${session.token}`,
        "x-csrf-token": session.csrf,
      },
      post = (url: string, payload: Record<string, unknown>) =>
        app.inject({ method: "POST", url, headers, payload }),
      work = { kind: "saved", attempt: source, checksum },
      input = {
        definition_revision: definitions.show(settings.id).revision,
        template_version: settings.template_version,
        earliest: Date.now() - 1000,
        latest: Date.now() + 600000,
        usernames: ["student"],
        duration: 5400,
        work,
        reason: "Explicit new ninety-minute attempt from secured saved work",
      };
    const preview = await post(
      `/api/admin/exams/${settings.id}/grants/additional-preview`,
      input,
    );
    expect(preview.statusCode, preview.body).toBe(200);
    expect(preview.json().rows[0]).toMatchObject({
      username: "student",
      work,
      settings: {
        duration: 5400,
        webcam: false,
        earliest: input.earliest,
        latest: input.latest,
      },
    });
    const intent = { revision: preview.json().revision, request: randomUUID() },
      confirmed = await post(
        `/api/admin/grant-issuance/${preview.json().id}/confirm`,
        intent,
      );
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(
      (
        await post(
          `/api/admin/grant-issuance/${preview.json().id}/confirm`,
          intent,
        )
      ).json(),
    ).toEqual(confirmed.json());
    const id = confirmed.json().issued[0].grant,
      pending = await app.inject({ url: `/api/admin/grants/${id}`, headers });
    expect(pending.statusCode, pending.body).toBe(200);
    expect(pending.json()).toMatchObject({
      status: "PENDING_NATIVE",
      work,
      settings: { duration: 5400, webcam: false },
    });
    expect(
      store.db
        .prepare(
          "SELECT count(*) n FROM attempt_grants WHERE status='AVAILABLE'",
        )
        .get(),
    ).toEqual({ n: 0 });
    expect(
      store.db.prepare("SELECT count(*) n FROM grant_claims").get(),
    ).toEqual({ n: 0 });
    expect(store.db.prepare("SELECT count(*) n FROM attempts").get()).toEqual({
      n: 1,
    });
    expect(store.attempt(source)).toEqual(before);
    const cancelled = await post(`/api/admin/grants/${id}/revoke`, {
      revision: 1,
      request: randomUUID(),
      reason:
        "Cancel unconfirmed saved-work issuance without reserving account",
    });
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    expect(cancelled.json()).toMatchObject({ id, status: "REVOKED", work });
    expect(store.attempt(source)).toEqual(before);
    expect(
      store.db.prepare("SELECT count(*) n FROM grant_claims").get(),
    ).toEqual({ n: 0 });
  } finally {
    await app.close();
    rmSync(data, { recursive: true, force: true });
  }
});
