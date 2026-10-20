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
