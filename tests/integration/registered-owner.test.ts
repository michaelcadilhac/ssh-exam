import { expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { generateKeyPairSync, randomUUID, sign, verify } from "node:crypto";
import { createApp } from "../../apps/server/src/app.js";
import { TemplateCatalog } from "../../apps/server/src/template-catalog.js";
import { AttemptGrants } from "../../apps/server/src/attempt-grants.js";
import { hash } from "../../apps/server/src/db.js";
import { Agent } from "../../apps/server/src/agent.js";
import sharp from "sharp";

async function fixture(webcam = false) {
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
  const config = {
    mode: "development" as const,
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
  };
  const f = await createApp(config);
  const admin = f.store.session("admin", "synthetic-instructor", null),
    headers = {
      origin,
      cookie: `session=${admin.token}`,
      "x-csrf-token": admin.csrf,
    };
  const post = (url: string, payload: any) =>
    f.app.inject({ method: "POST", url, headers, payload });
  const authenticated = (url: string, input: any, app = f.app) => {
    const payload = Buffer.from(JSON.stringify(input));
    return app.inject({
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
    webcam,
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
    config,
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
    post,
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

async function activeEvidenceFixture(
  webcam = false,
  preflightSeed = false,
  retained = false,
) {
  const f = await fixture(webcam),
    owner = {
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
  let bootstrapReply: any;
  if (preflightSeed) {
    // This fixture has no SSH connection, so seed the actual JPEG consumer
    // directly; the signed native Begin and later proof HTTP interfaces are real.
    for (const source of webcam ? ["screen", "webcam"] : ["screen"]) {
      const a = f.store.attempt(f.id),
        ticket = f.monitoring.captureChallenge(a, f.page, source);
      await f.monitoring.challengedFrame(
        a,
        {
          source,
          seq: 1,
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
          challenge: ticket.challenge,
          readiness: {
            fullscreen: true,
            visible: true,
            focus: true,
            keyboard: true,
            screen: true,
            webcam,
          },
        },
        f.page,
      );
    }
    const prepared = f.store.attempt(f.id),
      response = await f.authenticated("/api/agent/grant-begin", {
        ...f.request,
        type: "grant-begin/v3",
        page_epoch: f.page,
        initial_owner: owner,
      });
    expect(response.statusCode, response.body).toBe(200);
    const frame = response.json(),
      bytes = Buffer.from(frame.payload, "base64");
    expect(
      verify(
        null,
        bytes,
        f.gateway.publicKey,
        Buffer.from(frame.signature, "base64"),
      ),
    ).toBe(true);
    bootstrapReply = JSON.parse(bytes.toString());
    expect(bootstrapReply).toMatchObject({
      type: "grant-begin/v3",
      bootstrap: { type: "monitoring-bootstrap/v1", owner, sequence: 1 },
    });
    expect(f.store.attempt(f.id)).toEqual(prepared);
    expect(
      f.store.db
        .prepare("SELECT status FROM attempt_grants WHERE id=?")
        .get(f.g.id),
    ).toEqual({ status: "AVAILABLE" });
    const premature = await f.authenticated("/api/agent/monitoring-evidence", {
      type: "monitoring-execution-challenge-v1",
      agent: "class",
      nonce: hash(randomUUID()),
      owner,
      after_sequence: 0,
      coverage_epoch: "",
    });
    expect(premature.statusCode, premature.body).toBe(409);
  }
  const started = Date.now();
  // This metadata fixture models the gateway's acknowledged start before the
  // signed native status arrives. An unsolicited new start MUST instead stay
  // locked as "acknowledgment lost"; do not relax that recovery protection.
  // HTTP/JPEG/signatures are real here; SSH/kernel admission remains simulated.
  f.store.db
    .prepare(
      "UPDATE attempts SET state='ACTIVE',start=?,deadline=?,original_deadline=? WHERE id=?",
    )
    .run(started, started + 600000, started + 600000, f.id);
  const accepted = await f.authenticated("/api/agent/events", {
    agent: "class",
    sequence: 1,
    attempt: {
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
      ...(retained
        ? {
            monitoring_mode: "v1",
            browser_ssh: true,
            terminal_supervised: true,
          }
        : {}),
    },
  });
  expect(accepted.statusCode, accepted.body).toBe(200);
  expect(f.store.attempt(f.id)).toMatchObject({
    state: "ACTIVE",
    generation: 0,
  });
  const session = f.store.session("student", "synthetic", "owner"),
    headers = {
      origin: f.config.origin,
      cookie: `session=${session.token}`,
      "x-csrf-token": session.csrf,
      "x-page-instance": "synthetic original page",
    },
    jpeg = (
      await sharp({
        create: { width: 40, height: 30, channels: 3, background: "white" },
      })
        .jpeg()
        .toBuffer()
    ).toString("base64"),
    ready = {
      fullscreen: true,
      visible: true,
      focus: true,
      keyboard: true,
      screen: true,
      webcam,
    },
    challenge = {
      type: "monitoring-execution-challenge-v1",
      agent: "class",
      nonce: hash(randomUUID()),
      owner,
      after_sequence: 0,
      coverage_epoch: "",
    };
  const upload = async (
    policy = ready,
    source: "screen" | "webcam" = "screen",
  ) => {
    const ticket = await f.app.inject({
      method: "POST",
      url: `/api/student/attempts/${f.id}/capture-challenges`,
      headers,
      payload: { source },
    });
    expect(ticket.statusCode, ticket.body).toBe(200);
    return f.app.inject({
      method: "POST",
      url: `/api/student/attempts/${f.id}/frames/challenged`,
      headers,
      payload: {
        source,
        seq: ticket.json().after_sequence + 1,
        captured: Date.now(),
        monotonic: 1,
        data: jpeg,
        challenge: ticket.json().challenge,
        readiness: policy,
      },
    });
  };
  return {
    ...f,
    owner,
    headers,
    jpeg,
    ready,
    challenge,
    upload,
    bootstrapReply,
  };
}

it("signed pending native Continue remains retryable; confirmed native consumption keeps live evidence available while the reply is lost", async () => {
  const f = await activeEvidenceFixture(false, false, true);
  let clock: ReturnType<typeof vi.spyOn> | undefined;
  try {
    const original = f.store.attempt(f.id);
    expect(original.monitoring_mode).toBe("v1");
    f.store.db
      .prepare("UPDATE attempts SET state='LOCKED',generation=1 WHERE id=?")
      .run(f.id);
    const approval = await f.post(`/api/admin/attempts/${f.id}/authorize`, {
      generation: 1,
      revision: f.store.attempt(f.id).continuation_revision,
      requestID: randomUUID(),
      reason: "Synthetic reviewed native pending continuation",
    });
    expect(approval.statusCode, approval.body).toBe(200);
    const a = f.store.attempt(f.id),
      ticket = f.monitoring.captureChallenge(a, f.page, "screen");
    await f.monitoring.challengedFrame(
      a,
      {
        source: "screen",
        seq: ticket.after_sequence + 1,
        captured: Date.now(),
        monotonic: 1,
        data: f.jpeg,
        challenge: ticket.challenge,
        readiness: f.ready,
      },
      f.page,
    );
    const owner = {
        ...f.owner,
        generation: 1,
        input_epoch: hash("confirmed native continuation epoch"),
      },
      bootstrapped = await f.authenticated("/api/agent/monitoring-continue", {
        type: "monitoring-continue/v1",
        agent: "class",
        nonce: hash(randomUUID()),
        previous_owner: f.owner,
        owner,
      });
    expect(bootstrapped.statusCode, bootstrapped.body).toBe(200);
    const seed = JSON.parse(
        Buffer.from(bootstrapped.json().payload, "base64").toString(),
      ),
      native = {
        id: f.id,
        exam: a.exam,
        username: a.username,
        uid: a.uid,
        state: "ACTIVE",
        settings: JSON.parse(a.settings),
        grant: f.request.grant,
        grant_begin_intent: f.intent,
        start: a.start,
        deadline: a.deadline,
        original_deadline: a.original_deadline,
        generation: 1,
        clock_revision: a.clock_revision,
        boot: f.owner.boot,
        protected: false,
        registered_owner: owner,
        browser_ssh: true,
        terminal_supervised: true,
        monitoring_mode: "v1",
      };
    const pending = await f.authenticated("/api/agent/events", {
      agent: "class",
      sequence: 2,
      attempt: { ...native, retained_hold: "resuming" },
    });
    expect(pending.statusCode, pending.body).toBe(200);
    expect(f.store.attempt(f.id)).toMatchObject({
      state: "LOCKED",
      generation: 1,
      retained_hold: "resuming",
      registered_owner: JSON.stringify(f.owner),
      start: original.start,
      original_deadline: original.original_deadline,
    });
    expect(
      (
        f.store.db
          .prepare("SELECT consumed FROM continuations WHERE attempt=?")
          .get(f.id) as any
      ).consumed,
    ).toBe(0);
    await f.agent.acceptRegisteredOwnerObservation({
      ...native,
      retained_hold: "resuming",
    });
    expect(f.store.attempt(f.id).registered_owner).toBe(
      JSON.stringify(f.owner),
    );
    const committed = await f.authenticated("/api/agent/events", {
      agent: "class",
      sequence: 3,
      attempt: native,
    });
    expect(committed.statusCode, committed.body).toBe(200);
    expect(f.store.attempt(f.id)).toMatchObject({
      state: "LOCKED",
      generation: 1,
      retained_hold: null,
      registered_owner: JSON.stringify(owner),
    });
    expect(
      (
        f.store.db
          .prepare("SELECT consumed FROM continuations WHERE attempt=?")
          .get(f.id) as any
      ).consumed,
    ).toBe(1);
    const proof = await f.authenticated("/api/agent/monitoring-evidence", {
      ...f.challenge,
      owner,
    });
    expect(proof.statusCode, proof.body).toBe(200);
    expect(
      JSON.parse(Buffer.from(proof.json().payload, "base64").toString()),
    ).toMatchObject({
      owner,
      coverage_epoch: seed.bootstrap.coverage_epoch,
      sequence: 1,
    });
    // Approval's acceptance window can expire after native consumption. That
    // must not invalidate the already committed operation or mint a new window.
    clock = vi.spyOn(Date, "now").mockReturnValue(approval.json().expires + 1);
    f.life.confirmContinuation(f.id, 1);
    expect(f.store.attempt(f.id)).toMatchObject({
      state: "ACTIVE",
      generation: 1,
      start: original.start,
      deadline: original.deadline,
      original_deadline: original.original_deadline,
    });
  } finally {
    clock?.mockRestore();
    await f.close();
  }
});

it("authenticated retained Continue requires current unused approval and challenged capture; refusal and retries preserve the original interval", async () => {
  const f = await activeEvidenceFixture(true);
  try {
    // Metadata-only fixture for an already VERIFIED native hold. Kernel/SSH
    // containment and actual thaw are covered by native qualification, not this HTTP test.
    f.store.db
      .prepare("UPDATE attempts SET state='LOCKED',generation=1 WHERE id=?")
      .run(f.id);
    const owner = {
        ...f.owner,
        generation: 1,
        input_epoch: hash("new authorized attempt epoch"),
      },
      request = {
        type: "monitoring-continue/v1",
        agent: "class",
        nonce: hash(randomUUID()),
        previous_owner: f.owner,
        owner,
      },
      route = "/api/agent/monitoring-continue";
    expect((await f.authenticated(route, request)).statusCode).toBe(409);
    const authorize = async () => {
      const result = await f.post(`/api/admin/attempts/${f.id}/authorize`, {
        generation: 1,
        revision: f.store.attempt(f.id).continuation_revision,
        requestID: randomUUID(),
        reason: "Synthetic reviewed retained continuation",
      });
      expect(result.statusCode, result.body).toBe(200);
      return result.json().expires as number;
    };
    const expires = await authorize();
    expect((await f.authenticated(route, request)).statusCode).toBe(409);
    // No SSH object exists in this HTTP fixture: keep the real authentication
    // gap refusal, then feed JPEGs through the same validated consumer directly.
    const gap = await f.upload();
    expect(gap.statusCode).toBe(400);
    expect(gap.body).toContain("authorized authentication gap");
    const uploadHeld = async (source: "screen" | "webcam") => {
      const a = f.store.attempt(f.id),
        ticket = f.monitoring.captureChallenge(a, f.page, source);
      return f.monitoring.challengedFrame(
        a,
        {
          source,
          seq: ticket.after_sequence + 1,
          captured: Date.now(),
          monotonic: 1,
          data: f.jpeg,
          challenge: ticket.challenge,
          readiness: f.ready,
        },
        f.page,
      );
    };
    await uploadHeld("screen");
    expect((await f.authenticated(route, request)).statusCode).toBe(409); // Camera still missing.
    await uploadHeld("webcam");
    const before = f.store.attempt(f.id),
      grant = f.store.db
        .prepare("SELECT * FROM continuations WHERE attempt=?")
        .get(f.id),
      reply = await f.authenticated(route, request);
    expect(reply.statusCode, reply.body).toBe(200);
    const raw = Buffer.from(reply.json().payload, "base64"),
      proof = JSON.parse(raw.toString());
    expect(
      verify(
        null,
        raw,
        f.gateway.publicKey,
        Buffer.from(reply.json().signature, "base64"),
      ),
    ).toBe(true);
    expect(proof).toMatchObject({
      type: "monitoring-continue/v1",
      nonce: request.nonce,
      previous_owner: f.owner,
      owner,
      authorization_expires: expires,
      bootstrap: { owner, sequence: 1 },
    });
    expect(proof.capture_valid_for_ms).toBeGreaterThan(0);
    const retry = await f.authenticated(route, request),
      repeated = JSON.parse(
        Buffer.from(retry.json().payload, "base64").toString(),
      );
    expect(repeated.bootstrap).toEqual(proof.bootstrap);
    expect(repeated.capture_valid_for_ms).toBeLessThanOrEqual(
      proof.capture_valid_for_ms,
    );
    expect(f.store.attempt(f.id)).toEqual(before);
    expect(
      f.store.db
        .prepare("SELECT * FROM continuations WHERE attempt=?")
        .get(f.id),
    ).toEqual(grant);
    for (const input of [
      { ...request, agent: "wrong-agent" },
      { ...request, owner: { ...owner, generation: 2 } },
      { ...request, owner: { ...owner, page_epoch: hash("wrong page") } },
      {
        ...request,
        previous_owner: { ...f.owner, transport_hash: hash("wrong SSH") },
      },
    ])
      expect((await f.authenticated(route, input)).statusCode).toBe(409);
    f.store.db
      .prepare("UPDATE continuations SET consumed=1 WHERE attempt=?")
      .run(f.id);
    expect((await f.authenticated(route, request)).statusCode).toBe(409);
    f.store.db
      .prepare("UPDATE continuations SET consumed=0,expires=? WHERE attempt=?")
      .run(Date.now() - 1, f.id);
    expect((await f.authenticated(route, request)).statusCode).toBe(409);
    f.store.db.prepare("DELETE FROM continuations WHERE attempt=?").run(f.id);
    expect((await f.authenticated(route, request)).statusCode).toBe(409);
    expect(f.store.attempt(f.id)).toEqual({
      ...before,
      continuation_revision: before.continuation_revision + 3,
    });
    // Simulate the acknowledged native SAME interval and approval consumption;
    // original-age capture may seed the new owner, never a new clock or grace.
    await authorize();
    const nextOwner = {
        ...owner,
        input_epoch: hash("fresh native pending scope after replacement"),
      },
      fresh = await f.authenticated(route, {
        ...request,
        nonce: hash(randomUUID()),
        owner: nextOwner,
      });
    expect(fresh.statusCode, fresh.body).toBe(200);
    const nextProof = JSON.parse(
      Buffer.from(fresh.json().payload, "base64").toString(),
    );
    expect(nextProof.bootstrap.coverage_epoch).not.toBe(
      proof.bootstrap.coverage_epoch,
    );
    f.store.db
      .prepare("UPDATE continuations SET consumed=1 WHERE attempt=?")
      .run(f.id);
    f.store.db
      .prepare(
        "UPDATE attempts SET state='ACTIVE',registered_owner=? WHERE id=?",
      )
      .run(JSON.stringify(nextOwner), f.id);
    const promoted = await f.authenticated("/api/agent/monitoring-evidence", {
      ...f.challenge,
      owner: nextOwner,
    });
    expect(promoted.statusCode, promoted.body).toBe(200);
    const evidence = JSON.parse(
      Buffer.from(promoted.json().payload, "base64").toString(),
    );
    expect(evidence).toMatchObject({
      owner: nextOwner,
      coverage_epoch: nextProof.bootstrap.coverage_epoch,
      sequence: 1,
    });
    expect(evidence.age_ms).toBeGreaterThanOrEqual(
      15000 - nextProof.capture_valid_for_ms,
    );
    expect(f.store.attempt(f.id)).toMatchObject({
      start: before.start,
      deadline: before.deadline,
      original_deadline: before.original_deadline,
    });
  } finally {
    await f.close();
  }
});

it("versioned Begin bootstrap consumes no clock/grant; only acknowledged native ACTIVE promotes its original capture coverage", async () => {
  const f = await activeEvidenceFixture(true, true);
  try {
    const initial = await f.authenticated(
      "/api/agent/monitoring-evidence",
      f.challenge,
    );
    expect(initial.statusCode, initial.body).toBe(200);
    const observed = JSON.parse(
      Buffer.from(initial.json().payload, "base64").toString(),
    );
    expect(observed).toMatchObject({
      owner: f.owner,
      sequence: 1,
      coverage_epoch: f.bootstrapReply.bootstrap.coverage_epoch,
    });
    expect(observed.age_ms).toBeGreaterThanOrEqual(
      15000 - f.bootstrapReply.capture_valid_for_ms,
    );
    const request = {
      ...f.challenge,
      nonce: hash(randomUUID()),
      after_sequence: 1,
      coverage_epoch: observed.coverage_epoch,
    };
    expect(
      (await f.authenticated("/api/agent/monitoring-evidence", request))
        .statusCode,
    ).toBe(409); // No self-renewal from bootstrap.
    const screen = await f.upload();
    expect(screen.statusCode, screen.body).toBe(200);
    const updated = await f.authenticated(
      "/api/agent/monitoring-evidence",
      request,
    );
    expect(updated.statusCode, updated.body).toBe(200);
    expect(
      JSON.parse(Buffer.from(updated.json().payload, "base64").toString()),
    ).toMatchObject({ coverage_epoch: observed.coverage_epoch, sequence: 2 });
  } finally {
    await f.close();
  }
});

it("actual challenged JPEG and native authenticated HTTP issue scoped live evidence; legacy images and reply retries never freshen it", async () => {
  const f = await activeEvidenceFixture();
  try {
    const proof = (input = f.challenge) =>
      f.authenticated("/api/agent/monitoring-evidence", input);
    expect((await proof()).statusCode).toBe(409);
    const legacy = await f.app.inject({
      method: "POST",
      url: `/api/student/attempts/${f.id}/frames`,
      headers: f.headers,
      payload: {
        source: "screen",
        seq: 1,
        captured: Date.now(),
        monotonic: 1,
        data: f.jpeg,
      },
    });
    expect(legacy.statusCode, legacy.body).toBe(200);
    expect((await proof()).statusCode).toBe(409);
    const upload = await f.upload();
    expect(upload.statusCode, upload.body).toBe(200);
    const before = f.store.attempt(f.id),
      signed = await proof();
    expect(signed.statusCode, signed.body).toBe(200);
    const frame = signed.json(),
      payload = Buffer.from(frame.payload, "base64");
    expect(
      verify(
        null,
        payload,
        f.gateway.publicKey,
        Buffer.from(frame.signature, "base64"),
      ),
    ).toBe(true);
    const evidence = JSON.parse(payload.toString());
    expect(evidence).toMatchObject({
      type: "monitoring-execution-evidence-v1",
      audience: "class",
      owner: f.owner,
      nonce: f.challenge.nonce,
      complete: true,
    });
    expect(evidence.sequence).toBeGreaterThan(0);
    expect(evidence.age_ms).toBeGreaterThanOrEqual(0);
    expect(evidence.age_ms).toBeLessThan(15000);
    expect((await f.upload()).statusCode).toBe(200);
    const retry = await proof();
    expect(retry.statusCode, retry.body).toBe(200);
    expect(retry.json()).toEqual(frame);
    expect(f.store.attempt(f.id)).toEqual(before);
    expect(
      (
        await proof({
          ...f.challenge,
          owner: { ...f.owner, transport_hash: hash("another transport") },
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (await proof({ ...f.challenge, agent: "another-agent" })).statusCode,
    ).toBe(409);
    const unsigned = await f.app.inject({
      method: "POST",
      url: "/api/agent/monitoring-evidence",
      payload: f.challenge,
    });
    expect(unsigned.statusCode).not.toBe(200);
  } finally {
    await f.close();
  }
});

it("actual native evidence requires each challenged JPEG source saved in a webcam-required grant", async () => {
  const f = await activeEvidenceFixture(true);
  try {
    const screen = await f.upload();
    expect(screen.statusCode, screen.body).toBe(200);
    const incomplete = await f.authenticated(
      "/api/agent/monitoring-evidence",
      f.challenge,
    );
    expect(incomplete.statusCode, incomplete.body).toBe(409);
    const camera = await f.upload(f.ready, "webcam");
    expect(camera.statusCode, camera.body).toBe(200);
    const complete = await f.authenticated(
      "/api/agent/monitoring-evidence",
      f.challenge,
    );
    expect(complete.statusCode, complete.body).toBe(200);
    expect(f.store.attempt(f.id)).toMatchObject({
      state: "ACTIVE",
      generation: 0,
    });
  } finally {
    await f.close();
  }
});

it("captured genuine policy loss uses durable existing lock policy; restart and later positive images cannot silently restore its evidence", async () => {
  const f = await activeEvidenceFixture();
  let reopened: Awaited<ReturnType<typeof createApp>> | undefined;
  try {
    expect((await f.upload()).statusCode).toBe(200);
    expect(
      (await f.authenticated("/api/agent/monitoring-evidence", f.challenge))
        .statusCode,
    ).toBe(200);
    const before = f.store.attempt(f.id),
      loss = await f.upload({ ...f.ready, fullscreen: false });
    expect(loss.statusCode, loss.body).toBe(200);
    expect(f.store.attempt(f.id)).toMatchObject({
      state: "LOCKED",
      generation: 1,
      start: before.start,
      deadline: before.deadline,
      original_deadline: before.original_deadline,
    });
    // No live SSH exists in this metadata fixture. Current legacy lock policy
    // correctly refuses an authentication-gap upload; C3 retention is not on.
    expect((await f.upload()).statusCode).toBe(400);
    expect(
      (
        await f.authenticated("/api/agent/monitoring-evidence", {
          ...f.challenge,
          nonce: hash(randomUUID()),
        })
      ).statusCode,
    ).toBe(409);
    await f.app.close();
    reopened = await createApp(f.config);
    expect(reopened.store.attempt(f.id)).toMatchObject({
      state: "LOCKED",
      generation: 1,
      start: before.start,
      deadline: before.deadline,
    });
    const refused = await f.authenticated(
      "/api/agent/monitoring-evidence",
      { ...f.challenge, nonce: hash(randomUUID()) },
      reopened.app,
    );
    expect(refused.statusCode, refused.body).toBe(409);
  } finally {
    await reopened?.app.close();
    await f.close();
  }
});

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
