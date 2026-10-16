import { expect, it } from "vitest";
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
      payload: {},
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
