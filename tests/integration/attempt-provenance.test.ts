import { expect, it, vi } from "vitest";
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
import { grantExam } from "../fixtures/grant-exam.js";

it("dashboard and signed CLI inspection use an attempt's historical grant revision after unused authority changes", async () => {
  const data = mkdtempSync(tmpdir() + "/attempt-provenance-"),
    origin = "http://localhost:3000";
  const keys = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { format: "pem", type: "spki" },
    privateKeyEncoding: { format: "pem", type: "pkcs8" },
  });
  writeFileSync(data + "/agent.pub", keys.publicKey);
  writeFileSync(data + "/gateway.key", keys.privateKey, { mode: 0o600 });
  const config = {
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
      managementOperations: ["attempts.show"],
    },
  } satisfies Parameters<typeof createApp>[0];
  const { app, store } = await createApp(config);
  try {
    grantExam(store, "provenance");
    const session = store.session("admin", "instructor", null),
      headers = {
        origin,
        cookie: `session=${session.token}`,
        "x-csrf-token": session.csrf,
      };
    const enrolled = await app.inject({
      method: "POST",
      url: "/api/admin/exams/provenance/roster/add",
      headers,
      payload: { username: "student", webcam: false },
    });
    expect(enrolled.statusCode, enrolled.body).toBe(200);
    const listed = await app.inject({
      url: "/api/admin/exams/provenance/grants?username=student",
      headers,
    });
    expect(listed.statusCode, listed.body).toBe(200);
    const original = listed.json().grants[0],
      id = randomUUID();
    // Build a valid claim through the production preparation transaction. The
    // lifecycle outcome is synthetic; this test exercises metadata inspection.
    const grants = new AttemptGrants(store, "class");
    store.db.transaction(() => {
      const current = grants.claim(original.id, id, 10001);
      const binding = grants.binding(current);
      store.db
        .prepare(
          "INSERT INTO attempts(id,exam,username,uid,state,settings,grant_id,grant_revision,grant_hash,grant_kind,grant_issued_order,grant_initial,grant_work) VALUES(?,'provenance','student',10001,'PREPARING',?,?,?,?,?,?,?,?)",
        )
        .run(
          id,
          JSON.stringify(current.settings),
          current.id,
          current.revision,
          current.hash,
          binding.kind ?? null,
          current.issuance_order,
          current.initial_grant ?? null,
          binding.work ? JSON.stringify(binding.work) : null,
        );
      store.db
        .prepare(
          "UPDATE attempts SET state='CANCELLED_BEFORE_START',ended=? WHERE id=?",
        )
        .run(Date.now(), id);
      grants.retire(store.attempt(id));
    })();
    const revised = await app.inject({
      method: "POST",
      url: `/api/admin/grants/${original.id}/revise`,
      headers,
      payload: {
        revision: 1,
        changes: { duration: 4500 },
        work: { kind: "empty" },
        reason: "Explicit unused revision after cancelled preflight",
        request: randomUUID(),
      },
    });
    expect(revised.statusCode, revised.body).toBe(200);
    expect(revised.json().revision).toBe(2);
    const dashboard = await app.inject({
      url: `/api/admin/exams/provenance/dashboard?review=${id}`,
      headers,
    });
    expect(dashboard.statusCode, dashboard.body).toBe(200);
    const recorded = dashboard.json().reviewAttempt;
    expect(recorded.grantContext).toMatchObject({
      state: "recorded",
      id: original.id,
      revision: 1,
      hash: original.hash,
      current_revision: 2,
      current_status: "AVAILABLE",
      reason: original.reason,
      settings: {
        duration: 5400,
        webcam: false,
        template_version: original.settings.template_version,
      },
      work: original.work,
    });
    expect(dashboard.json().students[0].unusedGrants).toMatchObject({
      available: 1,
      future: 0,
      closed: 0,
      pendingNative: 0,
      more: false,
    });
    // Exercise the real dashboard at captured instants on either side of the
    // saved Begin window. Inspection must neither consume nor revise authority.
    const savedWindow = revised.json().settings;
    for (const [at, expected] of [
      [savedWindow.earliest - 1, { available: 0, future: 1, closed: 0 }],
      [savedWindow.latest + 1, { available: 0, future: 0, closed: 1 }],
    ] as const) {
      const clock = vi.spyOn(Date, "now").mockReturnValue(at);
      try {
        const snapshot = await app.inject({
          url: "/api/admin/exams/provenance/dashboard",
          headers,
        });
        expect(snapshot.statusCode, snapshot.body).toBe(200);
        expect(snapshot.json().students[0].unusedGrants).toMatchObject(
          expected,
        );
      } finally {
        clock.mockRestore();
      }
    }
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
        operation: "attempts.show",
        body: { id },
      }),
    );
    const inspected = await app.inject({
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
    expect(inspected.statusCode, inspected.body).toBe(200);
    const reply = JSON.parse(
      Buffer.from(inspected.json().payload, "base64").toString(),
    );
    expect(reply.ok, reply).toBe(true);
    expect(reply.result.attempt.attempt_number).toBe(1);
    expect(reply.result.attempt.grantContext).toEqual(recorded.grantContext);
    expect(reply.result.attempt.settings.template_version).toBe(
      original.settings.template_version,
    );
    expect(store.attempt(id)).toMatchObject({
      state: "CANCELLED_BEFORE_START",
      start: null,
      deadline: null,
      grant_revision: 1,
      grant_hash: original.hash,
    });
    expect(() =>
      store.db
        .prepare("UPDATE attempts SET grant_hash=? WHERE id=?")
        .run("f".repeat(64), id),
    ).toThrow("immutable");
    // A mismatched configured class agent must not borrow another agent's
    // grant. Exercise this through the authenticated dashboard, preserving DB
    // guards and the historical binding rather than corrupting that binding.
    const other = await createApp({
      ...config,
      agent: { ...config.agent, id: "other" },
    });
    try {
      const unavailable = await other.app.inject({
        url: `/api/admin/exams/provenance/dashboard?review=${id}`,
        headers,
      });
      expect(unavailable.statusCode, unavailable.body).toBe(200);
      expect(unavailable.json().reviewAttempt.grantContext.state).toBe(
        "unavailable",
      );
      expect(unavailable.json().students[0].attempts).toHaveLength(1);
    } finally {
      await other.app.close();
    }
  } finally {
    await app.close();
    rmSync(data, { recursive: true, force: true });
  }
});
