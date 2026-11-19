import { expect, it } from "vitest";
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { browserGatewayProcess } from "../fixtures/browser-gateway-process.js";

it("a slow complete fleet observation survives its private HTTP adapter while ordinary fixture routes still expire", async () => {
  const data = mkdtempSync(tmpdir() + "/fleet-route-deadline-");
  const keys = generateKeyPairSync("ed25519");
  writeFileSync(
    data + "/gateway.key",
    keys.privateKey.export({ format: "pem", type: "pkcs8" }),
    { mode: 0o600 },
  );
  writeFileSync(
    data + "/agent.pub",
    keys.publicKey.export({ format: "pem", type: "spki" }),
  );
  const gateway = browserGatewayProcess(
    {
      mode: "development",
      origin: "http://localhost:3000",
      data,
      port: 0,
      maintenance: false,
      jump: { host: "localhost", port: 2222, pins: ["0".repeat(64)] },
      class: { host: "localhost", port: 2223, pins: ["1".repeat(64)] },
      agent: {
        id: "synthetic",
        signingKey: data + "/gateway.key",
        callbackPublicKey: data + "/agent.pub",
      },
    },
    new URL("../fixtures/faulting-connection-worker.ts", import.meta.url),
  );
  const payload = "x".repeat(2_184_550);
  const delayed = async () => {
    await new Promise((resolve) => setTimeout(resolve, 10_300));
    return { students: 35, payload };
  };
  gateway.app.post("/api/fixture/native-fleet", delayed);
  gateway.app.get("/api/fixture/ordinary-slow", delayed);
  gateway.app.get("/api/fixture/healthy", async () => ({ healthy: true }));
  try {
    await gateway.initialized;
    const session = gateway.store.session("admin", "synthetic", null);
    const address = await gateway.app.listen({ port: 0 });
    const [fleet, ordinary] = await Promise.all([
      fetch(address + "/api/fixture/native-fleet", {
        method: "POST",
        headers: {
          origin: "http://localhost:3000",
          cookie: `session=${session.token}`,
          "x-csrf-token": session.csrf,
        },
        signal: AbortSignal.timeout(20_000),
      }),
      fetch(address + "/api/fixture/ordinary-slow", {
        signal: AbortSignal.timeout(20_000),
      }),
    ]);
    expect(ordinary.status).toBe(400);
    expect((await ordinary.json()).error).toBe("Private fixture route timed out");
    const result = await fleet.json();
    expect(fleet.status, JSON.stringify({ error: result.error })).toBe(200);
    expect(result.students).toBe(35);
    const digest = (value: string) =>
      createHash("sha256").update(value).digest("hex");
    expect(digest(result.payload)).toBe(digest(payload));
    expect(
      await (await fetch(address + "/api/fixture/healthy")).json(),
    ).toEqual({ healthy: true });
    expect(
      gateway.store.db.prepare("SELECT count(*) n FROM attempts").get(),
    ).toEqual({ n: 0 });
  } finally {
    await gateway.app.close();
    rmSync(data, { recursive: true, force: true });
  }
}, 30_000);
