import { expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { generateKeyPairSync, randomUUID, sign, verify } from "node:crypto";
import { createApp } from "../../apps/server/src/app.js";
import { TemplateCatalog } from "../../apps/server/src/template-catalog.js";
import { AttemptGrants } from "../../apps/server/src/attempt-grants.js";
import { hash } from "../../apps/server/src/db.js";
import { Agent } from "../../apps/server/src/agent.js";
import sharp from "sharp";

async function fixture() {
  const dir = mkdtempSync(tmpdir() + "/registered-owner-"),
    origin = "http://localhost:3000";
  const keys = () =>
    generateKeyPairSync("ed25519", {
      publicKeyEncoding: { format: "pem", type: "spki" },
      privateKeyEncoding: { format: "pem", type: "pkcs8" },
    });
  const gateway = keys(),
    native = keys();
  writeFileSync(dir + "/gateway.key", gateway.privateKey, { mode: 0o600 });
  writeFileSync(dir + "/native.pub", native.publicKey, { mode: 0o600 });
  const f = await createApp({
    mode: "development",
    origin,
    data: dir,
    port: 0,
    maintenance: false,
    jump: { host: "localhost", port: 2222, pins: ["0".repeat(64)] },
    class: { host: "localhost", port: 2223, pins: ["1".repeat(64)] },
    agent: {
      id: "class",
      signingKey: dir + "/gateway.key",
      callbackPublicKey: dir + "/native.pub",
    },
  });
  const admin = f.store.session("admin", "synthetic-instructor", null),
    headers = {
      origin,
      cookie: `session=${admin.token}`,
      "x-csrf-token": admin.csrf,
    };
  const post = (url: string, payload: any) =>
    f.app.inject({ method: "POST", url, headers, payload });
  const authenticated = (url: string, input: any) => {
    const payload = Buffer.from(JSON.stringify(input));
    return f.app.inject({
      method: "POST",
      url,
      headers: {
        "content-type": "application/vnd.ssh-exam-event",
        "x-exam-signature": sign(null, payload, native.privateKey).toString(
          "base64",
        ),
      },
      payload,
    });
  };
  new TemplateCatalog(f.store, "class").sync(
    {
      version: {
        schema: 1,
        name: "v1",
        hash: "a".repeat(64),
        entries: 4,
        files: 2,
        bytes: 30,
        max_file_bytes: 20,
        created: 1000,
      },
      reason: "Synthetic authenticated owner source",
    },
    {
      agent: "class",
      actor: "agent:class:root",
      request: randomUUID(),
      issued: 1000,
      observed: 1001,
    },
  );
  const definition = await post("/api/admin/exams", {
    id: "owner",
    name: "Synthetic owner exam",
    template: "v1",
    template_version: "a".repeat(64),
    duration: 600,
    webcam: false,
    terminals: 2,
    earliest: Date.now() - 60000,
    latest: Date.now() + 3600000,
    requestID: randomUUID(),
  });
  expect(definition.statusCode, definition.body).toBe(200);
  const enrolled = await post("/api/admin/exams/owner/roster/add", {
    username: "synthetic",
  });
  expect(enrolled.statusCode, enrolled.body).toBe(200);
  const g = f.store.db
    .prepare(
      "SELECT g.*,g.rowid issued_order,r.settings,r.hash FROM attempt_grants g JOIN grant_revisions r ON r.grant_id=g.id AND r.revision=g.revision WHERE g.exam='owner'",
    )
    .get() as any;
  const id = randomUUID(),
    uid = 10001,
    page = hash("synthetic original page"),
    transport = hash("synthetic authenticated transport"),
    grants = new AttemptGrants(f.store, "class");
  f.store.db.transaction(() => {
    grants.claim(g.id, id, uid);
    f.store.db
      .prepare(
        "INSERT INTO attempts(id,exam,username,uid,state,settings,page_hash,last_contact,grant_id,grant_revision,grant_hash,grant_issued_order) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        "owner",
        "synthetic",
        uid,
        "PREPARING",
        g.settings,
        page,
        Date.now(),
        g.id,
        g.revision,
        g.hash,
        g.issued_order,
      );
  })();
  const intent = grants.begin(f.store.attempt(id)!, transport, page),
    boot = "77777777-1234-4234-8234-123456789abc";
  const request = {
    type: "grant-begin/v2",
    agent: "class",
    nonce: hash(randomUUID()),
    at: Date.now(),
    attempt: id,
    exam: "owner",
    username: "synthetic",
    uid,
    grant: grants.bindingForAttempt(f.store.attempt(id)!),
    intent,
    transport,
    boot,
    settings: JSON.parse(g.settings),
  };
  return {
    ...f,
    agent: new Agent(
      {
        id: "class",
        signingKey: dir + "/gateway.key",
        callbackPublicKey: dir + "/native.pub",
      },
      f.store,
    ),
    gateway,
    native,
    page,
    transport,
    id,
    intent,
    g,
    grants,
    request,
    authenticated,
    async close() {
      await f.app.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

it("authenticated native Begin requires the original current page before verification and consumes no grant or interval on refusal", async () => {
  const f = await fixture();
  try {
    // Native-only saved sources/absence queries legitimately precede any web
    // attempt. Optional owner lookup must not strand recovery preparation.
    const nativeOnly = randomUUID();
    await expect(
      f.agent.authorize("inspect-recovery-grant", "synthetic", f.transport, {
        id: nativeOnly,
      }),
    ).resolves.toHaveProperty("signature");
    await expect(
      f.agent.authorize("inspect-attempt", "another-account", f.transport, {
        id: f.id,
      }),
    ).rejects.toThrow("another authenticated account");
    await expect(
      f.agent.confirmRegisteredPaneOwner(nativeOnly, undefined, "synthetic"),
    ).rejects.toThrow("another authenticated account");
    const obsolete = await f.authenticated("/api/agent/grant-begin", {
      ...f.request,
      type: "grant-begin/v1",
      page_epoch: f.page,
    });
    expect(obsolete.statusCode, obsolete.body).toBe(400);
    for (const page of [undefined, hash("different page")]) {
      const refused = await f.authenticated("/api/agent/grant-begin", {
        ...f.request,
        nonce: hash(randomUUID()),
        ...(page ? { page_epoch: page } : {}),
      });
      expect(refused.statusCode, refused.body).toBe(409);
      expect(f.store.attempt(f.id)).toMatchObject({
        state: "PREPARING",
        start: null,
        deadline: null,
      });
      expect(
        f.store.db
          .prepare("SELECT status FROM attempt_grants WHERE id=?")
          .get(f.g.id),
      ).toEqual({ status: "AVAILABLE" });
      expect(
        f.store.db
          .prepare("SELECT verified_at FROM grant_begin_intents WHERE id=?")
          .get(f.intent),
      ).toEqual({ verified_at: null });
    }
    // This metadata fixture has no live SSH connection. Seed actual decoded
    // capture through the application's shared service; full HTTP/SSH capture
    // admission is covered by grant-begin and monitoring-readiness workflows.
    const a = f.store.attempt(f.id),
      ticket = f.monitoring.captureChallenge(a, f.page, "screen");
    await f.monitoring.challengedFrame(
      a,
      {
        source: "screen",
        seq: 1,
        challenge: ticket.challenge,
        captured: Date.now(),
        monotonic: 1,
        data: (
          await sharp({
            create: { width: 40, height: 30, channels: 3, background: "white" },
          })
            .jpeg()
            .toBuffer()
        ).toString("base64"),
        readiness: {
          fullscreen: true,
          visible: true,
          focus: true,
          keyboard: true,
          screen: true,
          webcam: false,
        },
      },
      f.page,
    );
    const accepted = await f.authenticated("/api/agent/grant-begin", {
      ...f.request,
      page_epoch: f.page,
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    const frame = accepted.json(),
      payload = Buffer.from(frame.payload, "base64");
    expect(
      verify(
        null,
        payload,
        f.gateway.publicKey,
        Buffer.from(frame.signature, "base64"),
      ),
    ).toBe(true);
    expect(JSON.parse(payload.toString())).toMatchObject({
      page_epoch: f.page,
      attempt: f.id,
      intent: f.intent,
      transport: f.transport,
    });
    f.store.db
      .prepare("UPDATE attempts SET page_hash=? WHERE id=?")
      .run(hash("replacement page"), f.id);
    const stale = await f.authenticated("/api/agent/grant-begin", {
      ...f.request,
      nonce: hash(randomUUID()),
      page_epoch: f.page,
    });
    expect(stale.statusCode, stale.body).toBe(409);
    expect(f.store.attempt(f.id)!.start).toBeNull();
  } finally {
    await f.close();
  }
});

it.each([
  "start",
  "deadline",
  "original_deadline",
  "protected",
  "checksum",
  "registered_owner",
  "other-consumption",
  "intent-interval",
])(
  "fresh authenticated Begin refuses contradictory no-start evidence (%s)",
  async (kind) => {
    const f = await fixture();
    try {
      const a = f.store.attempt(f.id),
        ticket = f.monitoring.captureChallenge(a, f.page, "screen");
      await f.monitoring.challengedFrame(
        a,
        {
          source: "screen",
          seq: 1,
          challenge: ticket.challenge,
          captured: Date.now(),
          monotonic: 1,
          data: (
            await sharp({
              create: {
                width: 40,
                height: 30,
                channels: 3,
                background: "white",
              },
            })
              .jpeg()
              .toBuffer()
          ).toString("base64"),
          readiness: {
            fullscreen: true,
            visible: true,
            focus: true,
            keyboard: true,
            screen: true,
            webcam: false,
          },
        },
        f.page,
      );
      if (kind === "other-consumption") {
        const other = randomUUID();
        f.store.db
          .prepare(
            "INSERT INTO grant_claims VALUES(?,?,1,?,10001,'CANCELLED',?,?)",
          )
          .run(other, f.g.id, f.g.hash, Date.now(), Date.now());
        // A partial restore can retain consumption on a retired claim while
        // the current grant/claim still look available. Respect the unique
        // unresolved-claim index; do not disable it to manufacture this case.
        f.store.db
          .prepare(
            "INSERT INTO grant_begin_intents(id,attempt,transport,state,created_at,start,deadline) VALUES(?,?,?,'CONSUMED',?,100,600100)",
          )
          .run(randomUUID(), other, f.transport, Date.now());
      } else if (kind === "intent-interval") {
        f.store.db
          .prepare(
            "UPDATE grant_begin_intents SET start=100,deadline=600100 WHERE id=?",
          )
          .run(f.intent);
      } else {
        const values: Record<string, string | number> = {
          start: Date.now(),
          deadline: Date.now() + 600000,
          original_deadline: Date.now() + 600000,
          protected: 1,
          checksum: hash("synthetic retained protected source"),
          registered_owner: JSON.stringify({
            attempt: f.id,
            exam: "owner",
            username: "synthetic",
            uid: 10001,
            transport_hash: f.transport,
            boot: f.request.boot,
            page_epoch: f.page,
            input_epoch: hash(randomUUID()),
            generation: 0,
            clock_revision: 0,
          }),
        };
        // The interpolated identifier comes ONLY from the fixed test case list.
        f.store.db
          .prepare(`UPDATE attempts SET ${kind}=? WHERE id=?`)
          .run(values[kind], f.id);
      }
      const before = f.store.attempt(f.id);
      const refused = await f.authenticated("/api/agent/grant-begin", {
        ...f.request,
        page_epoch: f.page,
      });
      expect(refused.statusCode, refused.body).toBe(409);
      expect(f.store.attempt(f.id)).toEqual(before);
      expect(
        f.store.db
          .prepare("SELECT status FROM attempt_grants WHERE id=?")
          .get(f.g.id),
      ).toEqual({ status: "AVAILABLE" });
      expect(
        f.store.db
          .prepare("SELECT verified_at FROM grant_begin_intents WHERE id=?")
          .get(f.intent),
      ).toEqual({ verified_at: null });
    } finally {
      await f.close();
    }
  },
);

it("accepted signed native start records historical ownership, canonical signing fences page confusion, and completion can retain it after page logout", async () => {
  const f = await fixture();
  try {
    const owner = {
      attempt: f.id,
      exam: "owner",
      username: "synthetic",
      uid: 10001,
      transport_hash: f.transport,
      boot: f.request.boot,
      page_epoch: f.page,
      input_epoch: hash(randomUUID()),
      generation: 0,
      clock_revision: 0,
    };
    const started = Date.now(),
      remote = {
        id: f.id,
        exam: "owner",
        username: "synthetic",
        uid: 10001,
        state: "ACTIVE",
        settings: f.request.settings,
        grant: f.request.grant,
        grant_begin_intent: f.intent,
        start: started,
        deadline: started + 600000,
        original_deadline: started + 600000,
        generation: 0,
        boot: f.request.boot,
        protected: false,
        registered_owner: owner,
      };
    const event = await f.authenticated("/api/agent/events", {
      agent: "class",
      sequence: 1,
      attempt: remote,
    });
    expect(event.statusCode, event.body).toBe(200);
    expect(JSON.parse(f.store.attempt(f.id)!.registered_owner!)).toEqual(owner);
    const signed = f.agent.sign(
      "issue-channel-admission",
      "synthetic",
      f.transport,
      { id: f.id, page_epoch: hash("caller supplied stale page") },
    );
    const command = JSON.parse(
      Buffer.from(signed.payload, "base64").toString(),
    );
    expect(command).toMatchObject({
      op: "issue-owner-channel-admission",
      body: { page_epoch: f.page },
    });
    const framed = f.agent.sign(
      "issue-channel-admission",
      "synthetic",
      f.transport,
      { id: f.id, framed_input: true, page_epoch: hash("stale caller page") },
    );
    const framedCommand = JSON.parse(
      Buffer.from(framed.payload, "base64").toString(),
    );
    expect(framedCommand).toMatchObject({
      op: "issue-framed-owner-channel-admission",
      body: { page_epoch: f.page },
    });
    expect(framedCommand.body).not.toHaveProperty("framed_input");
    expect(() => f.agent.verifyRegisteredPaneOwner(f.id, owner)).not.toThrow();
    expect(() =>
      f.agent.verifyRegisteredPaneOwner(f.id, {
        ...owner,
        page_epoch: hash("wrong signed page"),
      }),
    ).toThrow();
    const newerOwner = { ...owner, clock_revision: 1 };
    f.agent.observeExistingRegisteredOwner({
      ...remote,
      registered_owner: newerOwner,
    });
    expect(JSON.parse(f.store.attempt(f.id)!.registered_owner!)).toEqual(
      newerOwner,
    );
    const late = await f.authenticated("/api/agent/events", {
      agent: "class",
      sequence: 2,
      attempt: remote,
    });
    expect(late.statusCode, late.body).toBe(200);
    expect(JSON.parse(f.store.attempt(f.id)!.registered_owner!)).toEqual(
      newerOwner,
    );
    f.store.db
      .prepare("UPDATE attempts SET page_hash=NULL WHERE id=?")
      .run(f.id);
    expect(() => f.agent.verifyRegisteredPaneOwner(f.id, owner)).toThrow();
    const completed = await f.authenticated("/api/agent/events", {
      agent: "class",
      sequence: 3,
      attempt: {
        ...remote,
        state: "COMPLETED",
        protected: true,
        checksum: "b".repeat(64),
        access_state: "HELD",
      },
      manifest: {
        attempt: {
          id: f.id,
          exam: "owner",
          username: "synthetic",
          uid: 10001,
          start: remote.start,
          deadline: remote.deadline,
          original_deadline: remote.original_deadline,
          clock_revision: 0,
        },
        checksum: "b".repeat(64),
        collected: Date.now(),
        secured: Date.now(),
        files: [],
        omissions: [],
      },
    });
    expect(completed.statusCode, completed.body).toBe(200);
    expect(JSON.parse(f.store.attempt(f.id)!.registered_owner!)).toEqual(
      newerOwner,
    );
    expect(f.store.attempt(f.id)!.original_deadline).toBe(
      remote.original_deadline,
    );
  } finally {
    await f.close();
  }
});
