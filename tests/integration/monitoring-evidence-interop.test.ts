import { expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { MonitoringEvidenceLedger } from "../../apps/server/src/monitoring-evidence-ledger.js";

const run = promisify(execFile);
it("gateway ledger proofs cross the real native test-binary verifier without refreshing retries, ownership or a prior coverage gap", async () => {
  const dir = mkdtempSync(tmpdir() + "/monitoring-evidence-interop-");
  const binary = dir + "/native-evidence.test";
  const owner = JSON.parse(
    readFileSync(
      new URL("../fixtures/monitoring-evidence.json", import.meta.url),
      "utf8",
    ),
  ).owner;
  const ready = {
    fullscreen: true,
    visible: true,
    keyboard: true,
    screen: true,
    webcam: true,
    focus: true,
  };
  let now = 0,
    seq = 0,
    vector = 0;
  const ledger = new MonitoringEvidenceLedger("class", () => now);
  const binding = ledger.registerTrustedOwner(owner, true);
  const full = () => {
    for (const source of ["screen", "webcam"] as const)
      ledger.confirmValidatedFrame(
        binding,
        ledger.issueBrowserChallenge(binding, source),
        source,
        ++seq,
      );
    ledger.confirmPolicy(
      binding,
      ledger.issueBrowserChallenge(binding, "policy"),
      ready,
    );
  };
  const request = () => ({
    type: "monitoring-execution-challenge-v1",
    agent: "class",
    nonce: randomBytes(32).toString("hex"),
    owner,
    after_sequence: 0,
    coverage_epoch: "",
  });
  const key = generateKeyPairSync("ed25519"),
    jwk = key.publicKey.export({ format: "jwk" });
  if (!jwk.x) throw Error("Synthetic Ed25519 public key unavailable");
  const pub = Buffer.from(jwk.x, "base64url").toString("base64");
  const verify = async (
    proof: any,
    challenge: any,
    nativeNow: number,
    signatureKey = key.privateKey,
  ) => {
    const bytes = Buffer.from(JSON.stringify(proof));
    const path = dir + `/vector-${++vector}.json`;
    writeFileSync(
      path,
      JSON.stringify({
        public: pub,
        frame: {
          payload: bytes.toString("base64"),
          signature: sign(null, bytes, signatureKey).toString("base64"),
        },
        challenge,
        now: nativeNow,
      }),
      { mode: 0o600 },
    );
    const response = await run(
      binary,
      ["-test.run=^TestMonitoringEvidenceInteropHelper$"],
      {
        env: { ...process.env, EXAM_MONITORING_EVIDENCE_VECTOR: path },
        timeout: 5000,
        maxBuffer: 8192,
      },
    );
    const line = response.stdout
      .split("\n")
      .find((s) => s.startsWith('{"accepted":'));
    if (!line) throw Error("Native evidence helper omitted its bounded result");
    return JSON.parse(line);
  };
  try {
    await run("go", ["test", "-c", "-o", binary, "./internal/core"], {
      cwd: "ssh-server",
      env: process.env,
      timeout: 30000,
      maxBuffer: 65536,
    });
    full();
    now = 2000;
    const r = request(),
      first = ledger.issueForNativeChallenge(binding, r);
    const challenge = {
      Agent: "class",
      Nonce: r.nonce,
      Owner: owner,
      IssuedUptimeMS: 20000,
      ExpiresUptimeMS: 25000,
      AuthorityUntilMS: 26000,
      DeadlineUptimeMS: 100000,
      AfterSequence: 0,
      CoverageEpoch: "",
    };
    expect(await verify(first, challenge, 22000)).toMatchObject({
      accepted: true,
      until: 33000,
      sequence: first.sequence,
      coverage_epoch: first.coverage_epoch,
    });
    now = 3000;
    full();
    const retry = ledger.issueForNativeChallenge(binding, r);
    expect(retry).toBe(first);
    expect(await verify(retry, challenge, 24000)).toMatchObject({
      accepted: true,
      until: 33000,
    });
    expect(await verify(retry, challenge, 25000)).toMatchObject({
      accepted: false,
      until: 0,
    });
    expect(
      await verify(
        retry,
        { ...challenge, Owner: { ...owner, generation: 1 } },
        22000,
      ),
    ).toMatchObject({ accepted: false });
    expect(
      await verify(
        retry,
        challenge,
        22000,
        generateKeyPairSync("ed25519").privateKey,
      ),
    ).toMatchObject({ accepted: false });
    now = 18000;
    full();
    const after = ledger.issueForNativeChallenge(binding, request());
    expect(after.coverage_epoch).not.toBe(first.coverage_epoch);
    const current = {
      ...challenge,
      Nonce: after.nonce,
      CoverageEpoch: first.coverage_epoch,
      AfterSequence: first.sequence,
    };
    expect(await verify(after, current, 22000)).toMatchObject({
      accepted: false,
    });
    expect(ledger.inspect(binding)).toMatchObject({ state: "fresh", gaps: 1 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 45000);
