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
import { ExamDefinitions } from "../../apps/server/src/exam-definitions.js";
import { AttemptGrants } from "../../apps/server/src/attempt-grants.js";
import { grantExam } from "../fixtures/grant-exam.js";

it("reviews fixed saved-work authority and refuses delayed retention after pending permission is superseded", async () => {
  const data = mkdtempSync(tmpdir() + "/saved-source-grant-"),
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
      managementOperations: ["grants.source-plan", "grants.source-confirm"],
    },
  });
  try {
    const settings = grantExam(store, "saved-work"),
      sourceSettings = grantExam(store, "saved-source-history"),
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
        sourceSettings.id,
        JSON.stringify(sourceSettings),
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
      native = async (operation: string, body: unknown) => {
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
        return app.inject({
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
      },
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
    expect(preview.json().rows[0].replaces).toEqual([]);
    const intent = {
        revision: preview.json().revision,
        request: randomUUID(),
        replacement_policy: "single-unused-v1",
      },
      confirmed = await post(
        `/api/admin/grant-issuance/${preview.json().id}/confirm`,
        intent,
      );
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(confirmed.json().issued[0].replaced).toEqual([]);
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
    const pendingDashboard = await app.inject({
      url: `/api/admin/exams/${settings.id}/dashboard`,
      headers,
    });
    expect(pendingDashboard.statusCode, pendingDashboard.body).toBe(200);
    expect(pendingDashboard.json().students[0]).toMatchObject({
      attempts: [],
      unusedGrants: { available: 0, pendingNative: 1 },
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
    const retirement = await post(
      `/api/admin/exams/${settings.id}/retirement-preview`,
      { action: "archive" },
    );
    expect(retirement.statusCode, retirement.body).toBe(200);
    expect(retirement.json().allowed).toBe(false);
    expect(retirement.json().blockers.join(" ")).toContain(
      "Unused grants remain",
    );
    const plan = await native("grants.source-plan", { id, revision: 1 });
    expect(plan.statusCode, plan.body).toBe(200);
    const authoritative = JSON.parse(
      Buffer.from(plan.json().payload, "base64").toString(),
    ).result;
    expect(authoritative).toMatchObject({
      action: "retain",
      grant: { id, revision: 1, work },
      uid: 10001,
      settings: { duration: 5400, webcam: false },
      source: { attempt: source, checksum },
    });
    // This HTTP boundary simulates the trusted native receipt. Actual archive
    // verification/fsync/delete races are the separate compiled CLI acceptance.
    const receipt = {
      id,
      revision: 1,
      grant_hash: pending.json().hash,
      state: "RETAINED",
      source: {
        attempt: source,
        checksum,
        metadata_hash: "c".repeat(64),
        uid: 10001,
      },
      retention_hash: "d".repeat(64),
      retained_at: Date.now(),
    };
    const wrong = await native("grants.source-confirm", {
      ...receipt,
      source: { ...receipt.source, uid: 10002 },
    });
    expect(
      JSON.parse(Buffer.from(wrong.json().payload, "base64").toString()),
    ).toMatchObject({ ok: false, status: 409 });
    expect(
      (await app.inject({ url: `/api/admin/grants/${id}`, headers })).json()
        .status,
    ).toBe("PENDING_NATIVE");
    const acknowledged = await native("grants.source-confirm", receipt);
    expect(acknowledged.statusCode, acknowledged.body).toBe(200);
    expect(
      JSON.parse(Buffer.from(acknowledged.json().payload, "base64").toString()),
    ).toMatchObject({
      ok: true,
      status: 200,
      result: { id, revision: 1, state: "RETAINED", status: "AVAILABLE" },
    });
    expect(
      (await app.inject({ url: `/api/admin/grants/${id}`, headers })).json()
        .status,
    ).toBe("AVAILABLE");
    const consumer = randomUUID(),
      grants = new AttemptGrants(store, "class");
    store.db.transaction(() => {
      const current = grants.claim(id, consumer, 10001),
        binding = grants.binding(current);
      store.db
        .prepare(
          "INSERT INTO attempts(id,exam,username,uid,state,settings,grant_id,grant_revision,grant_hash,grant_kind,grant_issued_order,grant_initial,grant_work) VALUES(?,?,'student',10001,'PREPARING',?,?,?,?,?,?,?,?)",
        )
        .run(
          consumer,
          settings.id,
          JSON.stringify(current.settings),
          current.id,
          current.revision,
          current.hash,
          binding.kind ?? null,
          current.issuance_order,
          current.initial_grant ?? null,
          binding.work ? JSON.stringify(binding.work) : null,
        );
    })();
    const provenance = await app.inject({
      url: `/api/admin/exams/${settings.id}/dashboard?review=${consumer}`,
      headers,
    });
    expect(provenance.statusCode, provenance.body).toBe(200);
    expect(provenance.json().reviewAttempt.grantContext).toMatchObject({
      state: "recorded",
      id,
      revision: 1,
      reason: input.reason,
      work,
      source_attempt: {
        id: source,
        exam: sourceSettings.id,
        attempt_number: 1,
        state: "COMPLETED",
        recorded_protected: true,
        checksum_matches: true,
        available_in_gateway: true,
      },
    });
    expect(provenance.json().students[0].unusedGrants).toMatchObject({
      available: 0,
      pendingNative: 0,
    });
    expect(store.attempt(source)).toEqual(before);
    expect(store.attempt(consumer)).toMatchObject({
      state: "PREPARING",
      start: null,
      deadline: null,
    });
    // Simulate a mismatched historical Unix identity without altering the
    // immutable grant binding. Inspection must not expose another UID's row.
    store.db.prepare("UPDATE attempts SET uid=10002 WHERE id=?").run(source);
    try {
      const mismatched = await app.inject({
        url: `/api/admin/exams/${settings.id}/dashboard?review=${consumer}`,
        headers,
      });
      expect(mismatched.statusCode, mismatched.body).toBe(200);
      expect(
        mismatched.json().reviewAttempt.grantContext.source_attempt,
      ).toEqual({
        id: source,
        available_in_gateway: false,
      });
    } finally {
      store.db.prepare("UPDATE attempts SET uid=10001 WHERE id=?").run(source);
    }
    expect(store.attempt(source)).toEqual(before);
    store.db.transaction(() => {
      store.db
        .prepare(
          "UPDATE attempts SET state='CANCELLED_BEFORE_START',ended=? WHERE id=?",
        )
        .run(Date.now(), consumer);
      grants.retire(store.attempt(consumer));
    })();
    const cancelled = await post(`/api/admin/grants/${id}/revoke`, {
      revision: 1,
      request: randomUUID(),
      reason:
        "Cancel unconfirmed saved-work issuance without reserving account",
    });
    expect(cancelled.statusCode, cancelled.body).toBe(200);
    expect(cancelled.json()).toMatchObject({ id, status: "REVOKED", work });
    expect(
      JSON.parse(
        Buffer.from(
          (await native("grants.source-confirm", receipt)).json().payload,
          "base64",
        ).toString(),
      ),
    ).toMatchObject({ ok: false, status: 409 });
    const closing = await native("grants.source-plan", { id, revision: 1 });
    expect(closing.statusCode, closing.body).toBe(200);
    expect(
      JSON.parse(Buffer.from(closing.json().payload, "base64").toString())
        .result.action,
    ).toBe("release");
    expect(store.attempt(source)).toEqual(before);
    expect(
      store.db.prepare("SELECT count(*) n FROM grant_claims").get(),
    ).toEqual({ n: 1 });
    expect(
      store.db
        .prepare("SELECT state FROM grant_claims WHERE attempt=?")
        .get(consumer),
    ).toEqual({ state: "CANCELLED" });

    // The earlier accepted native pin remains retained history. A later worker
    // can finish retaining a new source after that pending permission has been
    // replaced; its signed reply must never restore the superseded permission.
    const retainedPins = store.db
        .prepare(
          "SELECT * FROM grant_source_retentions ORDER BY grant_id,revision",
        )
        .all(),
      priorAttempts = store.db
        .prepare("SELECT * FROM attempts ORDER BY rowid")
        .all(),
      priorClaims = store.db
        .prepare("SELECT * FROM grant_claims ORDER BY rowid")
        .all(),
      priorBegins = store.db
        .prepare("SELECT * FROM grant_begin_intents ORDER BY rowid")
        .all(),
      issuedPending: any[] = [];
    expect(retainedPins).toHaveLength(1);
    for (let index = 0; index < 2; index++) {
      const nextReview = await post(
        `/api/admin/exams/${settings.id}/grants/additional-preview`,
        { ...input, request: randomUUID() },
      );
      expect(nextReview.statusCode, nextReview.body).toBe(200);
      const replaced = index
        ? [
            {
              id: issuedPending[0].id,
              revision: 1,
              hash: issuedPending[0].hash,
            },
          ]
        : [];
      expect(nextReview.json().rows[0].replaces).toEqual(replaced);
      const nextConfirm = await post(
        `/api/admin/grant-issuance/${nextReview.json().id}/confirm`,
        {
          revision: nextReview.json().revision,
          request: randomUUID(),
          replacement_policy: "single-unused-v1",
        },
      );
      expect(nextConfirm.statusCode, nextConfirm.body).toBe(200);
      expect(nextConfirm.json().issued[0].replaced).toEqual(replaced);
      const current = await app.inject({
        url: `/api/admin/grants/${nextConfirm.json().issued[0].grant}`,
        headers,
      });
      expect(current.statusCode, current.body).toBe(200);
      expect(current.json()).toMatchObject({ status: "PENDING_NATIVE", work });
      issuedPending.push(current.json());
    }
    const superseded = issuedPending[0],
      replacement = issuedPending[1],
      delayed = await native("grants.source-confirm", {
        ...receipt,
        id: superseded.id,
        grant_hash: superseded.hash,
        retained_at: Date.now(),
      });
    expect(delayed.statusCode, delayed.body).toBe(200);
    expect(
      JSON.parse(Buffer.from(delayed.json().payload, "base64").toString()),
    ).toMatchObject({ ok: false, status: 409 });
    const oldStatus = await app.inject({
      url: `/api/admin/grants/${superseded.id}/source-setup?revision=1`,
      headers,
    });
    expect(oldStatus.statusCode, oldStatus.body).toBe(200);
    expect(oldStatus.json()).toMatchObject({
      id: superseded.id,
      revision: 1,
      grant_status: "REVOKED",
      status: "CANCELLED",
    });
    const newStatus = await app.inject({
      url: `/api/admin/grants/${replacement.id}/source-setup?revision=1`,
      headers,
    });
    expect(newStatus.statusCode, newStatus.body).toBe(200);
    expect(newStatus.json()).toMatchObject({
      id: replacement.id,
      grant_status: "PENDING_NATIVE",
      status: "QUEUED",
    });
    const allPermissions = await app.inject({
      url: `/api/admin/exams/${settings.id}/grants?username=student&limit=200`,
      headers,
    });
    expect(allPermissions.statusCode, allPermissions.body).toBe(200);
    expect(
      allPermissions
        .json()
        .grants.filter((grant: any) =>
          ["AVAILABLE", "PENDING_NATIVE"].includes(grant.status),
        )
        .map((grant: any) => grant.id),
    ).toEqual([replacement.id]);
    expect(
      store.db
        .prepare(
          "SELECT * FROM grant_source_retentions ORDER BY grant_id,revision",
        )
        .all(),
    ).toEqual(retainedPins);
    expect(
      store.db.prepare("SELECT * FROM attempts ORDER BY rowid").all(),
    ).toEqual(priorAttempts);
    expect(
      store.db.prepare("SELECT * FROM grant_claims ORDER BY rowid").all(),
    ).toEqual(priorClaims);
    expect(
      store.db
        .prepare("SELECT * FROM grant_begin_intents ORDER BY rowid")
        .all(),
    ).toEqual(priorBegins);
    expect(
      store.db
        .prepare(
          "SELECT count(*) n FROM attempts WHERE state IN ('PREPARING','ACTIVE','LOCKED','FINALIZING','COLLECTION_FAILED')",
        )
        .get(),
    ).toEqual({ n: 0 });
    expect(store.attempt(source)).toEqual(before);
  } finally {
    await app.close();
    rmSync(data, { recursive: true, force: true });
  }
});
