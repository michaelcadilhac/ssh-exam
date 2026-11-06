import { it, expect } from "vitest";
import { EventEmitter } from "node:events";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { BrowserConnection } from "../../apps/server/src/browser-ssh.js";
import {
  Agent,
  AgentCommandDisconnectedError,
  AgentCommandStateError,
} from "../../apps/server/src/agent.js";

it("accepts only agent-signed SSH identity/results with exact nonce, account and transport", async () => {
  const dir = mkdtempSync(tmpdir() + "/browser-proof-");
  const key = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { format: "pem", type: "spki" },
    privateKeyEncoding: { format: "pem", type: "pkcs8" },
  });
  writeFileSync(dir + "/key", key.privateKey, { mode: 0o600 });
  writeFileSync(dir + "/pub", key.publicKey);
  const config: any = {
    agent: {
      id: "class",
      signingKey: dir + "/key",
      callbackPublicKey: dir + "/pub",
    },
  };
  const socket = Object.assign(new EventEmitter(), {
    readyState: 1,
    send: (_s: string) => {},
    close: () => {},
  });
  const conn = new BrowserConnection(
    "student",
    "sandbox",
    config,
    new Agent(config.agent),
    socket as any,
  );
  conn.alive = true;
  conn.transport = "registered-transport";
  let change = (r: any) => {};
  socket.send = (data: string) => {
    const m = JSON.parse(data);
    if (m.type !== "browser-request") return;
    const cmd = JSON.parse(Buffer.from(m.args.payload, "base64").toString());
    const r: any = {
      agent: "class",
      type: "ssh-command-receipt",
      nonce: cmd.nonce,
      username: "student",
      transport: conn.transport,
      expires: Date.now() + 10000,
      result: { trusted: true },
      error: "",
    };
    change(r);
    const payload = Buffer.from(JSON.stringify(r));
    const proof = {
      payload: payload.toString("base64"),
      signature: sign(null, payload, key.privateKey).toString("base64"),
    };
    conn.receive({
      type: "browser-result",
      id: m.id,
      result: { result: { forged: true }, proof },
    });
  };
  try {
    expect(await conn.command("health")).toEqual({ trusted: true });
    const inputEpoch = "a".repeat(64);
    change = (r) => {
      r.result = {
        token: "framed-token",
        input_protocol: "v1",
        input_epoch: inputEpoch,
      };
    };
    await expect(
      conn.command("issue-framed-owner-channel-admission", { id: "attempt" }),
    ).resolves.toMatchObject({ input_epoch: inputEpoch });
    for (const invalid of [
      {},
      { input_protocol: "v0", input_epoch: inputEpoch },
      { input_protocol: "v1", input_epoch: "bad" },
    ]) {
      change = (r) => {
        r.result = { token: "no-raw-fallback", ...invalid };
      };
      await expect(
        conn.command("issue-framed-owner-channel-admission", { id: "attempt" }),
      ).rejects.toThrow("no raw fallback");
    }
    change = (r) => {
      r.error = "cannot renew locked/ended workload";
      r.result = {
        id: "attempt",
        state: "LOCKED",
        reason: "administrator: approved transfer",
        generation: 2,
      };
    };
    await expect(
      conn.command("renew-execution-lease", { id: "attempt" }),
    ).rejects.toMatchObject({
      name: "AgentCommandStateError",
      attemptState: {
        reason: "administrator: approved transfer",
        generation: 2,
      },
    });
    change = () => {};
    for (const field of ["agent", "type", "nonce", "username", "transport"]) {
      change = (r) => {
        r[field] = "forged";
      };
      await expect(conn.command("health")).rejects.toThrow("scope");
    }
    change = (r) => {
      r.expires = 0;
    };
    await expect(conn.command("health")).rejects.toThrow("scope");
    socket.send = (data) => {
      const m = JSON.parse(data);
      if (m.type === "browser-request")
        conn.receive({
          type: "browser-result",
          id: m.id,
          result: { result: { trusted: true } },
        });
    };
    await expect(conn.command("health")).rejects.toThrow("Signed SSH");
    // A pause closes this transport while its signed command is still pending.
    socket.send = () => {};
    const pending = conn.command("lock-attempt", { id: "attempt" });
    const rejected = expect(pending).rejects.toBeInstanceOf(
      AgentCommandDisconnectedError,
    );
    conn.close();
    await rejected;
    await expect(conn.command("health")).rejects.toBeInstanceOf(
      AgentCommandDisconnectedError,
    );
  } finally {
    conn.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

it("browser failure diagnostics preserve stage/correlation but cannot mutate authority or copy raw errors", async () => {
  const socket = Object.assign(new EventEmitter(), {
    readyState: 1,
    send: (_s: string) => {},
    close: () => {},
  });
  const c = new BrowserConnection(
    "synthetic",
    "exam",
    {} as any,
    new Agent({} as any),
    socket as any,
  );
  c.alive = true;
  const observations: any[] = [];
  let losses = 0;
  c.onTransportDiagnostic = (v) => observations.push(v);
  c.onLoss = () => {
    losses++;
  };
  c.receive({
    type: "browser-diagnostic",
    diagnostic: {
      stage: "ssh-keepalive",
      cause: "timeout",
      password: "PRIVATE",
    },
  });
  expect(observations).toEqual([]);
  expect(losses).toBe(0);
  expect(c.alive).toBe(true);
  c.receive({
    type: "browser-diagnostic",
    diagnostic: { stage: "ssh-keepalive", cause: "timeout" },
  });
  expect(observations).toEqual([{ stage: "ssh-keepalive", cause: "timeout" }]);
  expect(c.alive).toBe(true);
  for (let i = 0; i < 100; i++)
    c.receive({
      type: "browser-diagnostic",
      diagnostic: { stage: "ssh-keepalive", cause: "timeout" },
    });
  expect(observations).toHaveLength(1);
  (c as any).relayReference = "b".repeat(24);
  socket.send = (raw) => {
    const m = JSON.parse(raw);
    c.receive({
      type: "browser-result",
      id: m.id,
      error: "PRIVATE",
      diagnostic: { stage: "open", cause: "remote-exit" },
    });
  };
  await expect(
    (c as any).request("open", {
      pane: "11111111-1111-4111-8111-111111111111",
    }),
  ).rejects.toThrow("open/remote-exit");
  expect(observations.at(-1)).toEqual({
    stage: "open",
    cause: "remote-exit",
    relay_reference: "b".repeat(24),
    pane: "11111111-1111-4111-8111-111111111111",
  });
  expect(losses).toBe(0);
  expect(JSON.stringify(observations)).not.toContain("PRIVATE");
  // A diagnostics sink failure cannot turn a healthy connection into a loss.
  c.onTransportDiagnostic = () => {
    throw Error("disk unavailable");
  };
  expect(() =>
    c.receive({
      type: "browser-diagnostic",
      diagnostic: { stage: "relay-ready", cause: "timeout" },
    }),
  ).not.toThrow();
  expect(c.alive).toBe(true);
  c.close();
});
