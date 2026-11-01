import {
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
  verify,
} from "node:crypto";
import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { mediaFixture } from "./monitoring-media.js";
import { Monitoring } from "../../apps/server/src/monitoring.js";
import { managementPurpose } from "../../packages/protocol/management.js";
import { monitoringExportPurpose } from "../../packages/protocol/monitoring-export.js";
import type { Config } from "../../packages/config/index.js";

export async function exportFixture(
  options: { origin?: string; transcriptBytes?: number } = {},
) {
  const dir = mkdtempSync(tmpdir() + "/monitoring-export-");
  const keys = () =>
    generateKeyPairSync("ed25519", {
      publicKeyEncoding: { format: "pem", type: "spki" },
      privateKeyEncoding: { format: "pem", type: "pkcs8" },
    });
  const agent = keys(),
    gateway = keys(),
    origin = options.origin ?? "https://exam.test";
  writeFileSync(dir + "/gateway.key", gateway.privateKey, { mode: 0o600 });
  writeFileSync(dir + "/agent.pub", agent.publicKey, { mode: 0o600 });
  const agentConfig: Config["agent"] = {
    id: "class",
    signingKey: dir + "/gateway.key",
    callbackPublicKey: dir + "/agent.pub",
    managementOperations: ["monitoring.export"],
  };
  const f = await mediaFixture(dir, {
    origin,
    agent: agentConfig,
  });
  const monitoring = new Monitoring(f.store),
    pane = randomUUID();
  monitoring.record("a", pane, {
    event: "output",
    data: "PRIVATE-EXPORTED-TERMINAL-日本語",
  });
  const path = `${dir}/monitoring/a/${pane}.ndjson`;
  if (options.transcriptBytes)
    appendFileSync(path, Buffer.alloc(options.transcriptBytes, 65));
  appendFileSync(path, Buffer.from([123, 255, 0])); // A deliberately incomplete raw tail.
  const prefix = readFileSync(path);
  const incident = randomUUID(),
    interruption = randomUUID();
  f.store.db
    .prepare(
      "INSERT INTO incidents(id,attempt,generation,opened,events,message) VALUES(?,'a',0,1,?,?)",
    )
    .run(incident, '[{"reason":"PRIVATE-INCIDENT"}]', "PRIVATE-STUDENT-REVIEW");
  f.store.db
    .prepare(
      "INSERT INTO attempt_interruptions(id,attempt,generation,opened,events,authorizations,ended,outcome) VALUES(?,'a',0,1,?,'[]',2,'resumed')",
    )
    .run(interruption, '[{"reason":"PRIVATE-HISTORY"}]');
  const before = f.store.attempt("a");
  const request = (id = randomUUID(), body: object = { id: "a" }) => ({
    version: 1,
    purpose: managementPurpose,
    audience: origin,
    agent: "class",
    actor: "agent-root",
    request: id,
    nonce: randomBytes(32).toString("hex"),
    issued: Date.now(),
    expires: Date.now() + 20000,
    operation: "monitoring.export",
    body,
  });
  const signed = (value: object) => {
    const payload = Buffer.from(JSON.stringify(value));
    return {
      payload,
      headers: {
        "content-type": "application/vnd.ssh-exam-management",
        "x-exam-signature": sign(null, payload, agent.privateKey).toString(
          "base64",
        ),
      },
    };
  };
  const post = (value: ReturnType<typeof request>) =>
    f.app.inject({
      method: "POST",
      url: "/api/agent/management",
      ...signed(value),
    });
  const unpack = (line: string) => {
    const envelope = JSON.parse(line),
      bytes = Buffer.from(envelope.payload, "base64");
    if (
      !verify(
        null,
        bytes,
        gateway.publicKey,
        Buffer.from(envelope.signature, "base64"),
      )
    )
      throw Error("Invalid fixture export signature");
    return JSON.parse(bytes.toString());
  };
  const packets = (response: any, value: ReturnType<typeof request>) => {
    const all: any[] = response.rawPayload
      .toString()
      .trim()
      .split("\n")
      .map(unpack);
    for (let index = 0; index < all.length; index++) {
      const p = all[index];
      if (
        p.version !== 1 ||
        p.purpose !== monitoringExportPurpose ||
        p.audience !== "class" ||
        p.request !== value.request ||
        p.nonce !== value.nonce ||
        p.id !== "a" ||
        p.sequence !== index + 1
      )
        throw Error("Fixture export scope/sequence mismatch");
    }
    return all;
  };
  return {
    ...f,
    dir,
    agent,
    gateway,
    agentConfig,
    origin,
    pane,
    prefix,
    transcript: path,
    monitoring,
    before,
    request,
    signed,
    post,
    unpack,
    packets,
    async close() {
      await f.app.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
