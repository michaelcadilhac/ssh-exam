import { expect, it, vi } from "vitest";
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
    { profile: true },
  );
  const payload = "x".repeat(2_184_550);
  const delayed = async () => {
    await new Promise((resolve) => setTimeout(resolve, 10_300));
    return { students: 35, payload };
  };
  gateway.app.post("/api/fixture/native-fleet", delayed);
  gateway.app.get("/api/fixture/native-state", delayed);
  gateway.app.get("/api/fixture/ordinary-slow", delayed);
  gateway.app.get("/api/fixture/healthy", async () => ({ healthy: true }));
  try {
    await gateway.initialized;
    const session = gateway.store.session("admin", "synthetic", null);
    let address = await gateway.app.listen({ port: 0 });
    const [fleet, state, ordinary] = await Promise.all([
      fetch(address + "/api/fixture/native-fleet", {
        method: "POST",
        headers: {
          origin: "http://localhost:3000",
          cookie: `session=${session.token}`,
          "x-csrf-token": session.csrf,
        },
        signal: AbortSignal.timeout(20_000),
      }),
      fetch(address + "/api/fixture/native-state", {
        signal: AbortSignal.timeout(20_000),
      }),
      fetch(address + "/api/fixture/ordinary-slow", {
        signal: AbortSignal.timeout(20_000),
      }),
    ]);
    expect(ordinary.status).toBe(400);
    expect((await ordinary.json()).error).toBe(
      "Private fixture route timed out",
    );
    const result = await fleet.json();
    expect(fleet.status, JSON.stringify({ error: result.error })).toBe(200);
    expect(state.status).toBe(200);
    expect(result.students).toBe(35);
    const digest = (value: string) =>
      createHash("sha256").update(value).digest("hex");
    expect(digest(result.payload)).toBe(digest(payload));
    expect(digest((await state.json()).payload)).toBe(digest(payload));
    expect(
      await (await fetch(address + "/api/fixture/healthy")).json(),
    ).toEqual({ healthy: true });
    expect(
      gateway.store.db.prepare("SELECT count(*) n FROM attempts").get(),
    ).toEqual({ n: 0 });
    const profile = await gateway.profile();
    expect(profile).toMatchObject({
      version: 1,
      stageSupport: true,
      records: 0,
      failed: false,
      truncated: false,
    });
    const observeRefusal = async () => {
      const reply = await fetch(
        address +
          "/api/student/attempts/11111111-1111-4111-8111-111111111111/frames/binary",
        {
          method: "POST",
          headers: {
            origin: "http://localhost:3000",
            "content-type": "application/vnd.ssh-exam-capture",
          },
          body: "do-not-record-pixels-or-private-body",
        },
      );
      expect([401, 403]).toContain(reply.status);
      await reply.text();
    };
    await observeRefusal();
    await vi.waitFor(
      async () =>
        expect(await gateway.profile()).toMatchObject({
          records: 1,
          failed: false,
          truncated: false,
        }),
      { timeout: 3000 },
    );
    const prior = readFileSync(profile.path, "utf8");
    expect(JSON.parse(prior).stage).toBe("other");
    const restarted = await gateway.restart("graceful");
    address = restarted.address;
    expect(restarted.previous).not.toBe(restarted.current);
    await observeRefusal();
    await vi.waitFor(
      async () =>
        expect(await gateway.profile()).toMatchObject({
          records: 1,
          failed: false,
          truncated: false,
        }),
      { timeout: 3000 },
    );
    const retained = readFileSync(profile.path, "utf8");
    expect(retained.startsWith(prior)).toBe(true);
    expect(retained).not.toContain("do-not-record-pixels-or-private-body");
    const rows = retained
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(rows.map((row) => row.pid)).toEqual([
      restarted.previous,
      restarted.current,
    ]);
    expect(await gateway.profile()).toMatchObject({
      records: 1,
      failed: false,
      truncated: false,
    });
  } finally {
    await gateway.app.close();
    rmSync(data, { recursive: true, force: true });
  }
}, 30_000);
