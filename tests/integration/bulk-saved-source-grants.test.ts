import { expect, it } from "vitest";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createApp } from "../../apps/server/src/app.js";
import { ExamDefinitions } from "../../apps/server/src/exam-definitions.js";
import { grantExam } from "../fixtures/grant-exam.js";

it("reviews explicit per-student saved sources atomically, preserves settings and keeps every grant pending without consuming time", async () => {
  const data = mkdtempSync(tmpdir() + "/bulk-saved-grants-"),
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
  try {
    const settings = grantExam(store, "bulk-saved"),
      definitions = new ExamDefinitions(store, "class"),
      ended = Date.now() - 7200000,
      sources = [
        {
          username: "saved01",
          attempt: randomUUID(),
          checksum: "b".repeat(64),
        },
        {
          username: "saved02",
          attempt: randomUUID(),
          checksum: "c".repeat(64),
        },
      ];
    definitions.update(
      settings.id,
      { earliest: ended - 5400000, latest: ended - 1000 },
      definitions.show(settings.id).revision,
      "instructor",
      "Closed original default exam window",
    );
    for (const [index, source] of sources.entries()) {
      store.db
        .prepare(
          "INSERT INTO enrollments(exam,username,uid,webcam) VALUES(?,?,?,?)",
        )
        .run(settings.id, source.username, 10001 + index, index);
      store.db
        .prepare(
          "INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline,protected,checksum,access_state) VALUES(?,?,?,?,'COMPLETED',?,?,?,?,1,?,'RELEASED')",
        )
        .run(
          source.attempt,
          settings.id,
          source.username,
          10001 + index,
          JSON.stringify(settings),
          ended - 5400000,
          ended,
          ended,
          source.checksum,
        );
    }
    const original = sources.map((s) => store.attempt(s.attempt)),
      session = store.session("admin", "instructor", null),
      headers = {
        origin,
        cookie: `session=${session.token}`,
        "x-csrf-token": session.csrf,
      },
      post = (url: string, payload: Record<string, unknown>) =>
        app.inject({ method: "POST", url, headers, payload }),
      input = {
        definition_revision: definitions.show(settings.id).revision,
        template_version: settings.template_version,
        earliest: Date.now() - 1000,
        latest: Date.now() + 600000,
        usernames: sources.map((s) => s.username),
        duration: 5400,
        saved_sources: sources,
        reason:
          "Explicit bulk ninety-minute attempts from each student own protected archive",
      },
      preview = (body: Record<string, unknown> = input) =>
        post(`/api/admin/exams/${settings.id}/grants/additional-preview`, body),
      grants = () =>
        (store.db.prepare("SELECT count(*) n FROM attempt_grants").get() as any)
          .n;

    const first = await preview({ ...input, request: randomUUID() });
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json().rows).toHaveLength(2);
    for (const [index, source] of sources.entries()) {
      expect(first.json().rows[index]).toMatchObject({
        username: source.username,
        work: {
          kind: "saved",
          attempt: source.attempt,
          checksum: source.checksum,
        },
        settings: {
          duration: 5400,
          webcam: !!index,
          earliest: input.earliest,
          latest: input.latest,
        },
      });
    }
    expect(grants()).toBe(0);
    const cancelled = await post(
      `/api/admin/grant-issuance/${first.json().id}/cancel`,
      { revision: first.json().revision },
    );
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    expect(cancelled.json().status).toBe("CANCELLED");
    expect(
      (
        await post(`/api/admin/grant-issuance/${first.json().id}/confirm`, {
          revision: first.json().revision,
        })
      ).statusCode,
    ).toBe(409);

    for (const saved_sources of [
      sources.slice(0, 1),
      [sources[0], sources[0]],
      [sources[0], { ...sources[1], username: "unselected" }],
    ]) {
      const refused = await preview({ ...input, saved_sources });
      expect(refused.statusCode, refused.body).toBe(400);
      expect(grants()).toBe(0);
    }
    const mixed = await preview({ ...input, work: { kind: "empty" } });
    expect(mixed.statusCode, mixed.body).toBe(400);
    const swapped = await preview({
      ...input,
      saved_sources: sources.map((s, i) => ({
        ...sources[1 - i],
        username: s.username,
      })),
    });
    expect(swapped.statusCode, swapped.body).toBe(409);
    expect(grants()).toBe(0);

    const request = randomUUID(),
      reviewed = await preview({ ...input, request });
    expect(reviewed.statusCode, reviewed.body).toBe(200);
    expect((await preview({ ...input, request })).json()).toEqual(
      reviewed.json(),
    );
    const intent = {
        revision: reviewed.json().revision,
        request: randomUUID(),
      },
      issued = await post(
        `/api/admin/grant-issuance/${reviewed.json().id}/confirm`,
        intent,
      );
    expect(issued.statusCode, issued.body).toBe(200);
    expect(
      (
        await post(
          `/api/admin/grant-issuance/${reviewed.json().id}/confirm`,
          intent,
        )
      ).json(),
    ).toEqual(issued.json());
    expect(grants()).toBe(2);
    const saved = [];
    for (const source of sources) {
      const id = issued
          .json()
          .issued.find((g: any) => g.username === source.username).grant,
        result = await app.inject({ url: `/api/admin/grants/${id}`, headers });
      expect(result.statusCode, result.body).toBe(200);
      expect(result.json()).toMatchObject({
        status: "PENDING_NATIVE",
        work: {
          kind: "saved",
          attempt: source.attempt,
          checksum: source.checksum,
        },
        settings: { duration: 5400 },
      });
      saved.push(result.json());
    }
    const again = await preview();
    expect(again.statusCode, again.body).toBe(200);
    expect(again.json().rows.map((r: any) => r.existing_grants)).toEqual([
      1, 1,
    ]);
    definitions.update(
      settings.id,
      { duration: 3600, webcam: true },
      definitions.show(settings.id).revision,
      "instructor",
      "Later defaults must not alter issued saved grants",
    );
    for (const grant of saved)
      expect(
        (
          await app.inject({ url: `/api/admin/grants/${grant.id}`, headers })
        ).json(),
      ).toEqual(grant);
    // The second archive can lose protection AFTER review. Confirmation must
    // roll back the first student's issuance too, without starting either clock.
    const staleSettings = grantExam(store, "bulk-source-lost"),
      staleSources = [
        {
          username: "stale01",
          attempt: randomUUID(),
          checksum: "d".repeat(64),
        },
        {
          username: "stale02",
          attempt: randomUUID(),
          checksum: "e".repeat(64),
        },
      ];
    for (const [index, source] of staleSources.entries()) {
      store.db
        .prepare(
          "INSERT INTO enrollments(exam,username,uid,webcam) VALUES(?,?,?,0)",
        )
        .run(staleSettings.id, source.username, 10003 + index);
      store.db
        .prepare(
          "INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline,protected,checksum,access_state) VALUES(?,?,?,?,'COMPLETED',?,?,?,?,1,?,'RELEASED')",
        )
        .run(
          source.attempt,
          staleSettings.id,
          source.username,
          10003 + index,
          JSON.stringify(staleSettings),
          ended - 5400000,
          ended,
          ended,
          source.checksum,
        );
    }
    const staleReview = await post(
      `/api/admin/exams/${staleSettings.id}/grants/additional-preview`,
      {
        ...input,
        definition_revision: definitions.show(staleSettings.id).revision,
        template_version: staleSettings.template_version,
        usernames: staleSources.map((s) => s.username),
        saved_sources: staleSources,
      },
    );
    expect(staleReview.statusCode, staleReview.body).toBe(200);
    store.db
      .prepare("UPDATE attempts SET protected=0 WHERE id=?")
      .run(staleSources[1].attempt);
    const staleHistory = staleSources.map((s) => store.attempt(s.attempt)),
      lost = await post(
        `/api/admin/grant-issuance/${staleReview.json().id}/confirm`,
        { revision: staleReview.json().revision },
      );
    expect(lost.statusCode, lost.body).toBe(409);
    expect(lost.json().error).toContain("protected");
    expect(grants()).toBe(2);
    expect(staleSources.map((s) => store.attempt(s.attempt))).toEqual(
      staleHistory,
    );
    expect(
      store.db.prepare("SELECT count(*) n FROM grant_claims").get(),
    ).toEqual({ n: 0 });
    expect(store.db.prepare("SELECT count(*) n FROM attempts").get()).toEqual({
      n: 4,
    });
    expect(sources.map((s) => store.attempt(s.attempt))).toEqual(original);
  } finally {
    await app.close();
    rmSync(data, { recursive: true, force: true });
  }
});
