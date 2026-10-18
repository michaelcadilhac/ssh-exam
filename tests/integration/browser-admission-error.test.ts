import { it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { BrowserConnection } from "../../apps/server/src/browser-ssh.js";
import { Agent } from "../../apps/server/src/agent.js";

it.each([false, true])(
  "sends a safe visible error before closing the auth socket (SSH authenticated: %s)",
  async (authenticated) => {
    const dir = mkdtempSync(tmpdir() + "/admission-error-");
    const key = generateKeyPairSync("ed25519", {
      publicKeyEncoding: { format: "pem", type: "spki" },
      privateKeyEncoding: { format: "pem", type: "pkcs8" },
    });
    writeFileSync(dir + "/key", key.privateKey, { mode: 0o600 });
    writeFileSync(dir + "/pub", key.publicKey);
    const messages: any[] = [];
    const socket = Object.assign(new EventEmitter(), {
      readyState: 1,
      send: (s: string) => messages.push(JSON.parse(s)),
      close: () => {
        messages.push({ type: "socket-close" });
        socket.readyState = 3;
      },
    });
    const config: any = {
      origin: "https://exam.invalid",
      agent: {
        id: "class",
        signingKey: dir + "/key",
        callbackPublicKey: dir + "/pub",
      },
      browserSSH: { relay: "wss://relay.invalid", audience: "relay" },
      jump: { host: "jump" },
      class: { host: "class" },
    };
    const conn = new BrowserConnection(
      "student",
      "exam",
      config,
      new Agent(config.agent),
      socket as any,
    );
    const request = vi
      .spyOn(conn as any, "request")
      .mockImplementation(async (...args: any[]) => {
        if (args[0] === "connect" && authenticated) return { connected: true };
        if (args[0] === "command")
          return { error: "account not locally approved" };
        throw Error("UNTRUSTED-REMOTE-DETAIL shared-secret");
      });
    try {
      await expect(conn.connect(async () => [])).rejects.toMatchObject({
        authenticationStage: authenticated
          ? "exam-admission"
          : "ssh-authentication",
      });
      expect(messages.map((m) => m.type)).toEqual([
        "error",
        "browser-notify",
        "socket-close",
      ]);
      expect(messages[0].error).toContain(
        authenticated ? "SSH sign-in succeeded" : "SSH sign-in failed",
      );
      expect(JSON.stringify(messages)).not.toMatch(
        /UNTRUSTED|shared-secret|account not locally approved/,
      );
      expect(conn.alive).toBe(false);
      expect(socket.readyState).toBe(3);
    } finally {
      request.mockRestore();
      conn.close();
      rmSync(dir, { recursive: true, force: true });
    }
  },
);
