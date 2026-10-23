import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { createApp } from "../../apps/server/src/app.js";
import { Agent } from "../../apps/server/src/agent.js";
import { hash } from "../../apps/server/src/db.js";
async function setup() {
  const dir = mkdtempSync(tmpdir() + "/agent-callbacks-");
  const keys = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { format: "pem", type: "spki" },
    privateKeyEncoding: { format: "pem", type: "pkcs8" },
  });
  writeFileSync(dir + "/agent.pub", keys.publicKey);
  writeFileSync(dir + "/gateway.key", keys.privateKey, { mode: 0o600 });
  const config: any = {
    mode: "development",
    origin: "http://localhost:3000",
    data: dir,
    port: 0,
    maintenance: false,
    jump: { host: "localhost", port: 2222, pins: ["0".repeat(64)] },
    class: { host: "localhost", port: 2223, pins: ["1".repeat(64)] },
    agent: {
      id: "class",
      signingKey: dir + "/gateway.key",
      callbackPublicKey: dir + "/agent.pub",
    },
  };
  let current = await createApp(config);
  current.store.db.exec(
    "INSERT INTO exams VALUES('e','{}'); INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,access_state) VALUES('a','e','alice',1001,'LOCKED','{}',100,5400100,'HELD')",
  );
  const archive = Buffer.from("protected archive");
  const remote: any = {
    id: "a",
    exam: "e",
    username: "alice",
    uid: 1001,
    state: "COMPLETED",
    start: 100,
    deadline: 5400100,
    ended: 5400100,
    reason: "expiration",
    completed_at: 5400101,
    collected_at: 5400102,
    secured_at: 5400103,
    protected: true,
    checksum: hash(archive),
    access_state: "HELD",
  };
  const manifest = {
    attempt: { ...remote },
    files: [],
    omissions: [],
    collected: remote.collected_at,
    secured: remote.secured_at,
    checksum: remote.checksum,
  };
  const at = Date.now();
  const post = async (sequence: number, extra: any = {}) => {
    const payload = Buffer.from(
      JSON.stringify({
        agent: "class",
        sequence,
        at,
        attempt: remote,
        manifest,
        ...extra,
      }),
    );
    return current.app.inject({
      method: "POST",
      url: "/api/agent/events",
      headers: {
        "content-type": "application/vnd.ssh-exam-event",
        "x-exam-signature": sign(null, payload, keys.privateKey).toString(
          "base64",
        ),
      },
      payload,
    });
  };
  const upload = async (bytes = archive) => {
    const payload = Buffer.from(
      JSON.stringify({
        agent: "class",
        attempt: "a",
        checksum: remote.checksum,
      }),
    );
    return current.app.inject({
      method: "POST",
      url: "/api/agent/submissions/a",
      headers: {
        "content-type": "application/gzip",
        "x-exam-receipt": payload.toString("base64"),
        "x-exam-signature": sign(null, payload, keys.privateKey).toString(
          "base64",
        ),
      },
      payload: bytes,
    });
  };
  return {
    config,
    dir,
    remote,
    manifest,
    archive,
    post,
    upload,
    current: () => current,
    restart: async () => {
      await current.app.close();
      current = await createApp(config);
    },
    close: async () => {
      await current.app.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
it("keeps pending native preflight checks unstarted and cancellation final without violation alerts", async () => {
  const t = await setup();
  try {
    const id = randomUUID();
    t.current()
      .store.db.prepare(
        "INSERT INTO attempts(id,exam,username,uid,state,settings,preflight_started_at) VALUES(?,'e','bob',1002,'PREPARING','{}',?)",
      )
      .run(id, Date.now());
    const pending = {
      id,
      exam: "e",
      username: "bob",
      uid: 1002,
      state: "PREPARING",
      preparation_pending: true,
      start: 0,
      deadline: 0,
      original_deadline: 0,
      protected: false,
      access_state: "",
    };
    const outbox = () =>
      t.current().store.db.prepare("SELECT COUNT(*) AS n FROM outbox").get();
    const before = outbox();
    expect(
      (await t.post(1, { attempt: pending, manifest: undefined })).statusCode,
    ).toBe(200);
    expect(t.current().store.attempt(id)).toMatchObject({
      state: "PREPARING",
      start: null,
      deadline: null,
      original_deadline: null,
      generation: 0,
    });
    expect(outbox()).toEqual(before);
    expect(
      (
        await t.post(2, {
          attempt: { ...pending, preparation_pending: false },
          manifest: undefined,
        })
      ).statusCode,
    ).toBe(200);
    expect(t.current().store.attempt(id).start).toBeNull();
    expect(
      (
        await t.post(3, {
          attempt: {
            ...pending,
            preparation_pending: false,
            state: "CANCELLED_BEFORE_START",
            reason:
              "Technical preflight checks did not complete; no clock started",
            ended: Date.now(),
          },
          manifest: undefined,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await t.post(4, { attempt: pending, manifest: undefined })).statusCode,
    ).toBe(200);
    expect(t.current().store.attempt(id)).toMatchObject({
      state: "CANCELLED_BEFORE_START",
      start: null,
      deadline: null,
      original_deadline: null,
      generation: 0,
    });
    expect(outbox()).toEqual(before);
  } finally {
    await t.close();
  }
});

it.each([
  [true, "NORMAL", false],
  [false, "NORMAL", true],
  [true, "RESTORE_PENDING", true],
  [undefined, "NORMAL", true],
] as const)(
  "signed cancellation alert follows positive cleanup/restoration (%s/%s)",
  async (cleanup, policy, actionable) => {
    const t = await setup();
    try {
      const id = randomUUID();
      t.current()
        .store.db.prepare(
          "INSERT INTO attempts(id,exam,username,uid,state,settings,preflight_started_at,access_state) VALUES(?,'e','bob',1002,'PREPARING','{}',?,'HELD')",
        )
        .run(id, Date.now());
      const remote = {
        id,
        exam: "e",
        username: "bob",
        uid: 1002,
        state: "CANCELLED_BEFORE_START",
        start: 0,
        deadline: 0,
        original_deadline: 0,
        protected: false,
        access_state: "HELD",
        policy_state: policy,
        cancellation_cleanup_complete: cleanup,
        errors: ["Earlier synthetic cleanup failure"],
      };
      expect(
        (await t.post(1, { attempt: remote, manifest: undefined })).statusCode,
      ).toBe(200);
      const episodes = () =>
        t
          .current()
          .store.db.prepare(
            "SELECT e.id,e.resolved,o.status FROM alert_episodes e JOIN outbox o ON o.id=e.outbox WHERE e.attempt=? AND e.event='preflight-agent-error'",
          )
          .all(id);
      expect(episodes()).toHaveLength(actionable ? 1 : 0);
      expect(
        t
          .current()
          .store.db.prepare(
            "SELECT detail FROM audit WHERE action='preflight-cleanup-agent-error' AND target=?",
          )
          .all(id),
      ).toEqual([{ detail: JSON.stringify(remote.errors) }]);
      expect(t.current().store.attempt(id)).toMatchObject({
        state: "CANCELLED_BEFORE_START",
        start: null,
        deadline: null,
        access_state: "HELD",
      });
      await t.restart();
      expect(
        (await t.post(2, { attempt: remote, manifest: undefined })).statusCode,
      ).toBe(200);
      expect(episodes()).toHaveLength(actionable ? 1 : 0);
    } finally {
      await t.close();
    }
  },
);

it("signed cleanup success resolves existing failure and genuine recurrence reopens through admin alert status", async () => {
  const t = await setup();
  try {
    const id = randomUUID();
    t.current()
      .store.db.prepare(
        "INSERT INTO attempts(id,exam,username,uid,state,settings,preflight_started_at,access_state) VALUES(?,'e','bob',1002,'PREPARING','{}',?,'HELD')",
      )
      .run(id, Date.now());
    const remote = {
      id,
      exam: "e",
      username: "bob",
      uid: 1002,
      state: "CANCELLED_BEFORE_START",
      start: 0,
      deadline: 0,
      original_deadline: 0,
      protected: false,
      access_state: "HELD",
      policy_state: "RESTORE_PENDING",
      cancellation_cleanup_complete: true,
      errors: ["Earlier synthetic restoration failure"],
    };
    const post = async (sequence: number) =>
      expect(
        (await t.post(sequence, { attempt: remote, manifest: undefined }))
          .statusCode,
      ).toBe(200);
    const rows = () =>
      t
        .current()
        .store.db.prepare(
          "SELECT e.id,e.resolved,e.outbox,o.status FROM alert_episodes e JOIN outbox o ON o.id=e.outbox WHERE e.attempt=? AND e.event='preflight-agent-error' ORDER BY e.rowid",
        )
        .all(id) as any[];
    await post(1);
    const [opened] = rows();
    expect(opened).toMatchObject({ resolved: null, status: "pending" });
    remote.policy_state = "NORMAL";
    await post(2);
    expect(rows()).toEqual([
      { ...opened, resolved: expect.any(Number), status: "cancelled" },
    ]);
    const status = async (outbox: string) => {
      const session = t.current().store.session("admin", "instructor", null);
      const reply = await t.current().app.inject({
        method: "GET",
        url: `/api/admin/notifications/${outbox}`,
        headers: { cookie: `session=${session.token}` },
      });
      expect(reply.statusCode, reply.body).toBe(200);
      return reply.json();
    };
    expect(await status(opened.outbox)).toMatchObject({
      status: "cancelled",
      episode: { resolved: expect.any(Number) },
    });
    await t.restart();
    await post(3);
    expect(rows()).toHaveLength(1);
    remote.policy_state = "RESTORE_PENDING";
    await post(4);
    const reopened = rows();
    expect(reopened).toHaveLength(2);
    expect(reopened[1]).toMatchObject({ resolved: null, status: "pending" });
    expect(await status(reopened[1].outbox)).toMatchObject({
      status: "pending",
      episode: { resolved: null },
    });
    await post(5);
    expect(rows()).toHaveLength(2);
    remote.policy_state = "NORMAL";
    await post(6);
    expect(
      rows().every(
        (row) => row.resolved !== null && row.status === "cancelled",
      ),
    ).toBe(true);
    expect(
      t
        .current()
        .store.db.prepare(
          "SELECT count(*) AS n FROM audit WHERE action='preflight-cleanup-agent-error' AND target=?",
        )
        .get(id),
    ).toEqual({ n: 1 });
    expect(t.current().store.attempt(id)).toMatchObject({
      start: null,
      deadline: null,
      access_state: "HELD",
    });
  } finally {
    await t.close();
  }
});

it("accepts signed deadline completion without a browser while refusing archive transfers", async () => {
  const t = await setup();
  try {
    expect((await t.post(1)).statusCode).toBe(200);
    expect(t.current().store.attempt("a")).toMatchObject({
      state: "COMPLETED",
      protected: 1,
      access_state: "HELD",
      export_status: "server-only",
    });
    expect((await t.upload(Buffer.from("changed"))).statusCode).toBe(410);
    expect((await t.upload()).statusCode).toBe(410);
    expect(existsSync(t.dir + "/submissions/a.tar.gz")).toBe(false);
    const admin = t.current().store.session("admin", "instructor", null);
    expect(
      (
        await t.current().app.inject({
          url: "/api/admin/attempts/a/submission",
          headers: { cookie: "session=" + admin.token },
        })
      ).statusCode,
    ).toBe(404);
  } finally {
    await t.close();
  }
});
it("reports current authenticated policy and qualified protection with quoted causes, deduplicating after restart", async () => {
  const t = await setup();
  try {
    t.current().store.db.exec(
      "UPDATE attempts SET access_state='UNKNOWN',policy_state='READY' WHERE id='a'",
    );
    Object.assign(t.remote, {
      policy_state: "RESTORE_FAILED",
      policy_error: 'unsafe "path"\nStudent: forged',
      access_error: "collection refused until all writers are quiesced",
    });
    expect((await t.post(1)).statusCode).toBe(200);
    const alerts = t
      .current()
      .store.db.prepare("SELECT subject,body FROM outbox ORDER BY rowid")
      .all() as any[];
    expect(alerts).toHaveLength(2);
    for (const alert of alerts) {
      expect(alert.body).toContain(
        "Account restriction: HELD; policy: RESTORE_FAILED",
      );
      expect(alert.body).toContain("America/Chicago");
      expect(alert.body).toContain("examctl info a");
      expect(alert.body).not.toContain("\nStudent: forged");
    }
    expect(alerts[0].body).toContain(JSON.stringify(t.remote.policy_error));
    expect(alerts[1].body).toContain(
      "gateway has not verified its manifest yet",
    );
    expect(alerts[1].body).not.toContain("The submission is already secured.");
    // A bare protected flag did not establish verification. The separately
    // validated manifest later in the same callback is what secured this view.
    expect(t.current().store.attempt("a").protected).toBe(1);
    await t.restart();
    expect((await t.post(2)).statusCode).toBe(200);
    expect(
      t.current().store.db.prepare("SELECT * FROM outbox").all(),
    ).toHaveLength(2);
  } finally {
    await t.close();
  }
});
it("rejects unsigned, tampered and wrongly scoped callbacks without a cookie bypass", async () => {
  const t = await setup();
  try {
    const response = await t.current().app.inject({
      method: "POST",
      url: "/api/agent/events",
      headers: { "content-type": "application/vnd.ssh-exam-event" },
      payload: Buffer.from("{}"),
    });
    expect(response.statusCode).toBe(403);
    const archiveResponse = await t.current().app.inject({
      method: "POST",
      url: "/api/agent/submissions/a",
      headers: { "content-type": "application/gzip" },
      payload: Buffer.from("unauthenticated archive"),
    });
    expect(archiveResponse.statusCode).toBe(410);
    expect((await t.post(1, { agent: "other" })).statusCode).toBe(400);
    expect(
      (await t.post(1, { attempt: { ...t.remote, username: "other" } }))
        .statusCode,
    ).toBe(400);
    expect(t.current().store.attempt("a").state).toBe("LOCKED");
  } finally {
    await t.close();
  }
});
it("deduplicates receipts across restarts, rejects conflicts and ignores stale transitions", async () => {
  const t = await setup();
  try {
    expect((await t.post(2)).statusCode).toBe(200);
    await t.restart();
    expect((await t.post(2)).statusCode).toBe(200);
    expect((await t.post(2, { at: 0 })).statusCode).toBe(400);
    expect(
      (
        await t.post(1, {
          attempt: { ...t.remote, state: "LOCKED", protected: false },
        })
      ).statusCode,
    ).toBe(200);
    expect(t.current().store.attempt("a").state).toBe("COMPLETED");
    expect((await t.upload()).statusCode).toBe(410);
    await t.restart();
    expect((await t.upload()).statusCode).toBe(410);
  } finally {
    await t.close();
  }
});
it("keeps the original deadline immutable and rejects unverified success", async () => {
  const t = await setup();
  try {
    expect(
      (await t.post(1, { attempt: { ...t.remote, deadline: 999999999 } }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await t.post(1, {
          attempt: { ...t.remote, protected: false },
          manifest: undefined,
        })
      ).statusCode,
    ).toBe(400);
    expect(t.current().store.attempt("a").protected).toBe(0);
  } finally {
    await t.close();
  }
});
it("stores registry callbacks for instructor rosters without a separate connection", async () => {
  const t = await setup();
  try {
    expect(
      (
        await t.post(1, {
          attempt: undefined,
          manifest: undefined,
          health: { ready: true },
          accounts: { alice: 1001 },
        })
      ).statusCode,
    ).toBe(200);
    const agent = new Agent(t.config.agent, t.current().store);
    expect(
      await agent.call("resolve-course-accounts", { usernames: ["alice"] }),
    ).toEqual({ alice: 1001 });
    await expect(
      agent.call("resolve-course-accounts", { usernames: ["root"] }),
    ).rejects.toThrow("not approved");
    await expect(agent.call("finalize-attempt", { id: "a" })).rejects.toThrow(
      "Reconnect",
    );
  } finally {
    await t.close();
  }
});
it("instructor approval needs no student connection and the stop endpoint is removed", async () => {
  const t = await setup();
  try {
    t.current()
      .store.db.prepare("UPDATE attempts SET deadline=? WHERE id='a'")
      .run(Date.now() + 5400000);
    const admin = t.current().store.session("admin", "instructor", null);
    const headers = {
      origin: t.config.origin,
      cookie: "session=" + admin.token,
      "x-csrf-token": admin.csrf,
    };
    const response = await t.current().app.inject({
      method: "POST",
      url: "/api/admin/attempts/a/authorize",
      headers,
      payload: {
        generation: t.current().store.attempt("a").generation,
        revision: t.current().store.attempt("a").continuation_revision,
        requestID: randomUUID(),
        reason: "Reviewed synthetic interruption",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(
      t
        .current()
        .store.db.prepare("SELECT * FROM continuations WHERE attempt='a'")
        .get(),
    ).toBeTruthy();
    expect(
      (
        await t.current().app.inject({
          method: "POST",
          url: "/api/admin/attempts/a/end",
          headers,
          payload: {},
        })
      ).statusCode,
    ).toBe(404);
  } finally {
    await t.close();
  }
});
