import { expect, it, vi } from "vitest";
import {
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
  verify,
} from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { mediaFixture } from "../fixtures/monitoring-media.js";
import { managementPurpose } from "../../packages/protocol/management.js";

// Hold actual descriptor reads, not the HTTP loop or a fake capacity counter.
const hold = vi.hoisted(() => ({
  enabled: false,
  entered: 0,
  wait: Promise.resolve(),
}));
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: async (path: any, flags: any, mode?: any) => {
      const file = await actual.open(path, flags, mode);
      if (!hold.enabled || !String(path).endsWith(".jpg")) return file;
      return new Proxy(file, {
        get(target, property) {
          if (property === "read")
            return async (...args: any[]) => {
              hold.entered++;
              await hold.wait;
              return (target.read as any)(...args);
            };
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
  };
});

it("shares the same sixteen live image reads between root management and web review, outside SQLite", async () => {
  const dir = mkdtempSync(tmpdir() + "/monitoring-image-capacity-");
  const keys = () =>
    generateKeyPairSync("ed25519", {
      publicKeyEncoding: { format: "pem", type: "spki" },
      privateKeyEncoding: { format: "pem", type: "pkcs8" },
    });
  const agent = keys(),
    gateway = keys(),
    origin = "https://exam.test";
  writeFileSync(dir + "/gateway.key", gateway.privateKey, { mode: 0o600 });
  writeFileSync(dir + "/agent.pub", agent.publicKey, { mode: 0o600 });
  const f = await mediaFixture(dir, {
    origin,
    agent: {
      id: "class",
      signingKey: dir + "/gateway.key",
      callbackPublicKey: dir + "/agent.pub",
      managementOperations: ["monitoring.image"],
    },
  });
  let release = () => {};
  const pending: Promise<any>[] = [];
  const root = async () => {
    const payload = Buffer.from(
      JSON.stringify({
        version: 1,
        purpose: managementPurpose,
        audience: origin,
        agent: "class",
        actor: "agent-root",
        request: randomUUID(),
        nonce: randomBytes(32).toString("hex"),
        issued: Date.now(),
        expires: Date.now() + 20000,
        operation: "monitoring.image",
        body: { id: "a", frame: f.frame.id },
      }),
    );
    const response = await f.app.inject({
      method: "POST",
      url: "/api/agent/management",
      headers: {
        "content-type": "application/vnd.ssh-exam-management",
        "x-exam-signature": sign(null, payload, agent.privateKey).toString(
          "base64",
        ),
      },
      payload,
    });
    expect(response.statusCode).toBe(200);
    const envelope = response.json(),
      bytes = Buffer.from(envelope.payload, "base64");
    expect(
      verify(
        null,
        bytes,
        gateway.publicKey,
        Buffer.from(envelope.signature, "base64"),
      ),
    ).toBe(true);
    return JSON.parse(bytes.toString());
  };
  try {
    hold.enabled = true;
    hold.entered = 0;
    hold.wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    for (let i = 0; i < 8; i++) {
      pending.push(root());
      pending.push(f.app.inject({ url: f.url, headers: f.headers }));
    }
    await vi.waitFor(() => expect(hold.entered).toBe(16), { timeout: 3000 });
    expect(f.store.db.inTransaction).toBe(false);
    const extraWeb = await f.app.inject({ url: f.url, headers: f.headers });
    expect(extraWeb.statusCode).toBe(503);
    expect(extraWeb.json().error).toContain("capacity");
    const extraRoot = await root();
    expect(extraRoot).toMatchObject({ ok: false, status: 503 });
    expect(extraRoot.error).toContain("capacity");
    expect((await f.app.inject({ url: "/health/live" })).statusCode).toBe(200);
    release();
    hold.enabled = false;
    const completed = await Promise.all(pending);
    for (let i = 0; i < completed.length; i++) {
      if (i % 2 === 0) {
        expect(completed[i].ok).toBe(true);
        expect(Buffer.from(completed[i].result.data, "base64")).toEqual(f.data);
      } else {
        expect(completed[i].statusCode).toBe(200);
        expect(completed[i].rawPayload).toEqual(f.data);
      }
    }
  } finally {
    release();
    hold.enabled = false;
    await Promise.allSettled(pending);
    await f.app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
