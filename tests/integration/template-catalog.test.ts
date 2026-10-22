import { expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
  verify,
} from "node:crypto";
import { createApp } from "../../apps/server/src/app.js";
import { managementPurpose } from "../../packages/protocol/management.js";

async function fixture() {
  const dir = mkdtempSync(tmpdir() + "/catalog-http-");
  const keys = () =>
    generateKeyPairSync("ed25519", {
      publicKeyEncoding: { format: "pem", type: "spki" },
      privateKeyEncoding: { format: "pem", type: "pkcs8" },
    });
  const root = keys(),
    gateway = keys();
  writeFileSync(dir + "/root.pub", root.publicKey);
  writeFileSync(dir + "/gateway.key", gateway.privateKey, { mode: 0o600 });
  const config: any = {
    mode: "development",
    origin: "https://catalog.test",
    data: dir,
    port: 0,
    maintenance: false,
    jump: { host: "localhost", port: 2222, pins: ["0".repeat(64)] },
    class: { host: "localhost", port: 2223, pins: ["1".repeat(64)] },
    agent: {
      id: "class",
      signingKey: dir + "/gateway.key",
      callbackPublicKey: dir + "/root.pub",
      managementOperations: [],
    },
  };
  let current = await createApp(config);
  const request = (
    operation: string,
    body: unknown,
    id = randomUUID(),
    issued = Date.now(),
  ) => ({
    version: 1,
    purpose: managementPurpose,
    audience: config.origin,
    agent: "class",
    actor: "agent-root",
    request: id,
    nonce: randomBytes(32).toString("hex"),
    issued,
    expires: issued + 30000,
    operation,
    body,
  });
  const post = async (r: any) => {
    const payload = Buffer.from(JSON.stringify(r));
    const response = await current.app.inject({
      method: "POST",
      url: "/api/agent/management",
      headers: {
        "content-type": "application/vnd.ssh-exam-management",
        "x-exam-signature": sign(null, payload, root.privateKey).toString(
          "base64",
        ),
      },
      payload,
    });
    expect(response.statusCode).toBe(200);
    const frame = response.json();
    const bytes = Buffer.from(frame.payload, "base64");
    expect(
      verify(
        null,
        bytes,
        gateway.publicKey,
        Buffer.from(frame.signature, "base64"),
      ),
    ).toBe(true);
    return JSON.parse(bytes.toString());
  };
  return {
    config,
    request,
    post,
    get current() {
      return current;
    },
    async restart() {
      await current.app.close();
      current = await createApp(config);
    },
    async close() {
      await current.app.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
const version = (h = "a".repeat(64)) => ({
  schema: 1,
  name: "midterm",
  hash: h,
  entries: 4,
  files: 2,
  bytes: 30,
  max_file_bytes: 20,
  created: 1000,
});
const syncBody = () => ({
  version: version(),
  reason: "Reviewed synthetic installed source",
});

it("uses named default-deny signed root authorization, immutable metadata and durable exact retries across restart", async () => {
  const f = await fixture();
  try {
    for (const op of ["templates.sync", "templates.list", "templates.show"])
      expect((await f.post(f.request(op, {}))).status).toBe(403);
    f.config.agent.managementOperations = [
      "templates.sync",
      "templates.list",
      "templates.show",
    ];
    const id = randomUUID();
    const r = f.request("templates.sync", syncBody(), id);
    const first = await f.post(r);
    expect(first).toMatchObject({
      ok: true,
      result: {
        agent: "class",
        updated: true,
        source: { name: "midterm", hash: version().hash, last_request: id },
        acknowledgement: { request: id, attested_at: r.issued },
      },
    });
    expect((await f.post(r)).error).toContain("nonce replay");
    await f.restart();
    const retry = await f.post(f.request("templates.sync", syncBody(), id));
    expect(retry.result).toEqual(first.result);
    expect(
      (
        await f.post(
          f.request(
            "templates.sync",
            { ...syncBody(), reason: "Different deliberate intent" },
            id,
          ),
        )
      ).error,
    ).toContain("conflicts");
    const bad = syncBody();
    bad.version.bytes = 31;
    expect((await f.post(f.request("templates.sync", bad))).error).toContain(
      "retained logical metadata",
    );
    expect(
      f.current.store.db
        .prepare("SELECT count(*) n FROM agent_template_versions")
        .get(),
    ).toEqual({ n: 1 });
    const audits = f.current.store.db
      .prepare(
        "SELECT actor,detail FROM audit WHERE action='template-source-attested'",
      )
      .all() as any[];
    expect(audits).toHaveLength(1);
    expect(audits[0].actor).toBe("agent:class:root");
    expect(audits[0].detail).toContain("Reviewed synthetic installed source");
    const privateRequest = f.request("templates.sync", {
      ...syncBody(),
      source_path: "PRIVATE-SOURCE-MUST-NOT-CACHE",
    });
    expect((await f.post(privateRequest)).ok).toBe(false);
    expect(
      JSON.stringify(
        f.current.store.db
          .prepare(
            "SELECT outcome FROM agent_management_requests WHERE request=?",
          )
          .get(privateRequest.request),
      ),
    ).not.toContain("PRIVATE-SOURCE-MUST-NOT-CACHE");
  } finally {
    await f.close();
  }
});

it("shares root and administrator bounded reads, denies student/anonymous access, and has no browser source-attestation mutation", async () => {
  const f = await fixture();
  try {
    f.config.agent.managementOperations = [
      "templates.sync",
      "templates.list",
      "templates.show",
    ];
    const first = await f.post(f.request("templates.sync", syncBody()));
    expect(first.ok).toBe(true);
    const admin = f.current.store.session("admin", "instructor", null),
      student = f.current.store.session("student", "synthetic", "sandbox");
    for (const cookie of ["", `session=${student.token}`]) {
      const denied = await f.current.app.inject({
        url: "/api/admin/templates",
        headers: { cookie },
      });
      expect(denied.statusCode).toBeGreaterThanOrEqual(400);
    }
    const headers = {
      cookie: `session=${admin.token}`,
      origin: f.config.origin,
      "x-csrf-token": admin.csrf,
    };
    const web = await f.current.app.inject({
      url: "/api/admin/templates?limit=1&name=midterm",
      headers,
    });
    expect(web.statusCode).toBe(200);
    expect(web.headers["cache-control"]).toBe("no-store");
    const root = await f.post(
      f.request("templates.list", { limit: 1, name: "midterm" }),
    );
    expect(root.result.sources).toEqual(web.json().sources);
    const shown = await f.current.app.inject({
      url: `/api/admin/templates/midterm/${version().hash}`,
      headers,
    });
    const rootShown = await f.post(
      f.request("templates.show", { name: "midterm", hash: version().hash }),
    );
    expect(rootShown.result.source).toEqual(shown.json().source);
    expect(shown.json().note).toContain("NOT a live filesystem probe");
    expect(
      (
        await f.current.app.inject({
          method: "POST",
          url: "/api/admin/templates",
          headers,
          payload: syncBody(),
        })
      ).statusCode,
    ).toBe(404);
    for (const query of [
      "limit=201",
      "limit=NaN",
      "after=bad",
      "name=../bad",
      "path=/private",
    ])
      expect(
        (
          await f.current.app.inject({
            url: "/api/admin/templates?" + query,
            headers,
          })
        ).statusCode,
      ).toBeGreaterThanOrEqual(400);
    expect(
      (
        await f.current.app.inject({
          url: "/api/admin/templates/midterm/" + "b".repeat(64),
          headers,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      f.current.store.db.prepare("SELECT count(*) n FROM attempts").get(),
    ).toEqual({ n: 0 });
  } finally {
    await f.close();
  }
});
