import { expect, it, vi } from "vitest";
import * as rosterParser from "../../apps/server/src/roster.js";
import { qualifyClockCLI } from "../fixtures/management-clocks.js";
import { qualifyProvenanceCLI } from "../fixtures/management-provenance.js";
import { qualifyInterruptionCLI } from "../fixtures/management-interruptions.js";
import { qualifyMonitoringCLI } from "../fixtures/management-monitoring.js";
import { qualifyTemplateCLI } from "../fixtures/management-templates.js";
import { qualifyAdministratorCLI } from "../fixtures/management-administrators.js";
import { qualifyNativeRetirementCLI } from "../fixtures/management-native-retirement.js";
import { Monitoring } from "../../apps/server/src/monitoring.js";
import { MonitoringManagement } from "../../apps/server/src/monitoring-management.js";
import sharp from "sharp";
import {
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
  verify,
} from "node:crypto";
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  readFileSync,
  existsSync,
} from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Writable } from "node:stream";
import argon2 from "argon2";
import https from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { createApp } from "../../apps/server/src/app.js";
import { TemplateCatalog } from "../../apps/server/src/template-catalog.js";
import { ExamDefinitions } from "../../apps/server/src/exam-definitions.js";
import {
  managementPurpose,
  managementOperations,
} from "../../packages/protocol/management.js";

async function setup() {
  const dir = mkdtempSync(tmpdir() + "/management-");
  const keys = () =>
    generateKeyPairSync("ed25519", {
      publicKeyEncoding: { format: "pem", type: "spki" },
      privateKeyEncoding: { format: "pem", type: "pkcs8" },
    });
  const agent = keys(),
    gateway = keys();
  writeFileSync(dir + "/agent.pub", agent.publicKey);
  writeFileSync(dir + "/gateway.key", gateway.privateKey, { mode: 0o600 });
  const config: any = {
    mode: "development",
    origin: "https://exam.test",
    data: dir,
    port: 0,
    maintenance: false,
    jump: { host: "localhost", port: 2222, pins: ["0".repeat(64)] },
    class: { host: "localhost", port: 2223, pins: ["1".repeat(64)] },
    agent: {
      id: "class",
      signingKey: dir + "/gateway.key",
      callbackPublicKey: dir + "/agent.pub",
      managementOperations: ["exams.list", "exams.show"],
    },
  };
  let logs = "";
  const appOptions = () => ({
    logStream: new Writable({
      write(chunk, _encoding, done) {
        logs += chunk.toString();
        done();
      },
    }),
  });
  let current = await createApp(config, appOptions());
  const request = (extra: object = {}) => ({
    version: 1,
    purpose: managementPurpose,
    audience: config.origin,
    agent: "class",
    actor: "agent-root",
    request: randomUUID(),
    nonce: randomBytes(32).toString("hex"),
    issued: Date.now(),
    expires: Date.now() + 20000,
    operation: "exams.list",
    body: { limit: 1 },
    ...extra,
  });
  const post = async (r: any, wrongKey = false) => {
    const payload = Buffer.from(JSON.stringify(r));
    return current.app.inject({
      method: "POST",
      url: "/api/agent/management",
      headers: {
        "content-type": "application/vnd.ssh-exam-management",
        "x-exam-signature": sign(
          null,
          payload,
          wrongKey ? gateway.privateKey : agent.privateKey,
        ).toString("base64"),
      },
      payload,
    });
  };
  const unpack = (response: any) => {
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
    dir,
    agentKeys: agent,
    gatewayKeys: gateway,
    config,
    request,
    post,
    unpack,
    logs: () => logs,
    get current() {
      return current;
    },
    async restart() {
      await current.app.close();
      current = await createApp(config, appOptions());
    },
    async close() {
      await current.app.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

it("creates administrators through explicitly authorized root-agent intents with strong secret-safe retries across restart", async () => {
  const f = await setup(),
    password = "root-agent-synthetic-password";
  try {
    f.config.agent.managementOperations = [
      "administrators.list",
      "administrators.show",
      "administrators.create",
    ];
    const request = f.request({
      operation: "administrators.create",
      body: { username: "root-created-admin", password },
    });
    const first = f.unpack(await f.post(request));
    expect(first).toMatchObject({
      ok: true,
      result: { username: "root-created-admin" },
    });
    const original = f.current.store.db
      .prepare("SELECT * FROM admins WHERE username='root-created-admin'")
      .get() as any;
    expect(await argon2.verify(original.hash, password)).toBe(true);
    const receipt = f.current.store.db
      .prepare(
        "SELECT fingerprint,outcome FROM agent_management_requests WHERE request=?",
      )
      .get(request.request) as any;
    expect(JSON.parse(receipt.fingerprint)).toEqual({
      purpose: "ssh-exam-administrator-intent/v1",
      username: "root-created-admin",
      verifier: original.hash,
    });
    expect(receipt.outcome).not.toContain(original.hash);
    expect(receipt.outcome).not.toContain(password);
    await f.restart();
    const retry = () => ({
      ...request,
      nonce: randomBytes(32).toString("hex"),
      issued: Date.now(),
      expires: Date.now() + 20000,
    });
    expect(f.unpack(await f.post(retry())).result).toEqual({
      username: "root-created-admin",
    });
    expect(
      f.unpack(
        await f.post({
          ...retry(),
          body: {
            username: "root-created-admin",
            password: "different-root-synthetic-password",
          },
        }),
      ),
    ).toMatchObject({ ok: false, status: 409 });
    expect(
      f.unpack(
        await f.post({
          ...retry(),
          body: { username: "another-admin", password },
        }),
      ),
    ).toMatchObject({ ok: false, status: 409 });
    expect(f.current.store.db.prepare("SELECT * FROM admins").all()).toEqual([
      original,
    ]);
    expect(
      f.current.store.db
        .prepare("SELECT actor FROM audit WHERE action='create-admin'")
        .all(),
    ).toEqual([{ actor: "agent:class:root" }]);
    expect(
      f.unpack(
        await f.post(
          f.request({ operation: "administrators.list", body: { limit: 1 } }),
        ),
      ).result,
    ).toEqual({
      administrators: [{ username: "root-created-admin" }],
      next: null,
    });
    expect(
      f.unpack(
        await f.post(
          f.request({
            operation: "administrators.show",
            body: { username: "root-created-admin" },
          }),
        ),
      ).result,
    ).toEqual({ username: "root-created-admin", role: "admin" });
    f.config.agent.managementOperations = [];
    expect(f.unpack(await f.post(retry()))).toMatchObject({
      ok: false,
      status: 403,
    });
    expect(
      f.current.store.db.prepare("SELECT * FROM attempts").all(),
    ).toHaveLength(0);
    expect(f.logs()).not.toContain(password);
    expect(f.logs()).not.toContain(original.hash);
    const actor = f.current.store.session("admin", "browser-owner", null);
    const login = await f.current.app.inject({
      method: "POST",
      url: "/api/admin/login",
      headers: { origin: f.config.origin },
      payload: { username: "root-created-admin", password },
    });
    expect(login.statusCode).toBe(200);
    expect(actor.csrf).toBeTruthy();
  } finally {
    await f.close();
  }
});

it("never fingerprints invalid credentials and redacts malformed signed credential requests and corrupt receipts", async () => {
  const f = await setup(),
    password = "malformed-credential-synthetic-secret";
  try {
    f.config.agent.managementOperations = ["administrators.create"];
    for (const body of [
      { username: "helper", password: "short" },
      { username: "bad name", password },
      { username: "helper", password, unexpected: "field" },
    ]) {
      const r = f.request({ operation: "administrators.create", body });
      const response = f.unpack(await f.post(r));
      expect(response).toMatchObject({ ok: false, status: 400 });
      expect(JSON.stringify(response)).not.toContain(password);
      expect(
        f.current.store.db
          .prepare("SELECT * FROM agent_management_requests WHERE request=?")
          .get(r.request),
      ).toBeUndefined();
    }
    const malformed = [
      `{"password":"${password}","operation":`,
      JSON.stringify(f.request({ operation: password, body: { password } })),
    ];
    for (const raw of malformed) {
      const payload = Buffer.from(raw);
      const response = await f.current.app.inject({
        method: "POST",
        url: "/api/agent/management",
        headers: {
          "content-type": "application/vnd.ssh-exam-management",
          "x-exam-signature": sign(
            null,
            payload,
            f.agentKeys.privateKey,
          ).toString("base64"),
        },
        payload,
      });
      expect(response.statusCode).toBe(400);
      expect(response.body).not.toContain(password);
    }
    const r = f.request({
      operation: "administrators.create",
      body: { username: "helper", password },
    });
    expect(f.unpack(await f.post(r)).ok).toBe(true);
    const original = f.current.store.db
      .prepare("SELECT * FROM admins")
      .get() as any;
    f.current.store.db
      .prepare(
        "UPDATE agent_management_requests SET fingerprint=? WHERE request=?",
      )
      .run(
        JSON.stringify({
          purpose: "ssh-exam-administrator-intent/v1",
          username: "helper",
          verifier:
            "$argon2id$v=19$m=999999999,t=3,p=1$" +
            "a".repeat(22) +
            "$" +
            "a".repeat(43),
        }),
        r.request,
      );
    const result = f.unpack(
      await f.post({ ...r, nonce: randomBytes(32).toString("hex") }),
    );
    expect(result).toMatchObject({ ok: false, status: 409 });
    expect(f.current.store.db.prepare("SELECT * FROM admins").all()).toEqual([
      original,
    ]);
    expect(f.logs()).not.toContain(password);
    expect(f.logs()).not.toContain(original.hash);
  } finally {
    await f.close();
  }
});

it("refuses corrupt root credential outcomes and never fast-fingerprints a password on a different operation", async () => {
  const f = await setup(),
    password = "credential-outcome-synthetic-password";
  try {
    f.config.agent.managementOperations = [
      "administrators.create",
      "exams.list",
    ];
    const r = f.request({
      operation: "administrators.create",
      body: { username: "helper", password },
    });
    expect(f.unpack(await f.post(r)).ok).toBe(true);
    const row = f.current.store.db.prepare("SELECT * FROM admins").get() as any;
    const original = f.current.store.db
      .prepare("SELECT outcome FROM agent_management_requests WHERE request=?")
      .get(r.request) as any;
    for (const result of [
      { username: "other" },
      { username: "helper", hash: row.hash },
    ]) {
      f.current.store.db
        .prepare(
          "UPDATE agent_management_requests SET outcome=? WHERE request=?",
        )
        .run(
          JSON.stringify({ ...JSON.parse(original.outcome), result }),
          r.request,
        );
      const response = f.unpack(
        await f.post({ ...r, nonce: randomBytes(32).toString("hex") }),
      );
      expect(response).toMatchObject({ ok: false, status: 409 });
      expect(JSON.stringify(response)).not.toContain(row.hash);
    }
    const misplaced = f.request({
      operation: "exams.list",
      body: { limit: 1, password },
    });
    const refused = await f.post(misplaced);
    expect(refused.statusCode).toBe(400);
    expect(
      f.current.store.db
        .prepare("SELECT * FROM agent_management_requests WHERE request=?")
        .get(misplaced.request),
    ).toBeUndefined();
    expect(f.current.store.db.prepare("SELECT * FROM admins").all()).toEqual([
      row,
    ]);
  } finally {
    await f.close();
  }
});

it("rechecks root credential authorization after asynchronous work and keeps SQLite available", async () => {
  const f = await setup(),
    password = "pending-credential-synthetic-secret";
  const digest = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1,
    hashLength: 32,
  });
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered!: () => void;
  const began = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const spy = vi.spyOn(argon2, "hash").mockImplementation(async () => {
    expect(f.current.store.db.inTransaction).toBe(false);
    entered();
    await waiting;
    return digest;
  });
  try {
    f.config.agent.managementOperations = ["administrators.create"];
    const r = f.request({
      operation: "administrators.create",
      body: { username: "revoked-admin", password },
    });
    const pending = f.post(r);
    await began;
    expect(f.current.store.db.prepare("SELECT 1 AS available").get()).toEqual({
      available: 1,
    });
    f.config.agent.managementOperations = [];
    release();
    expect(f.unpack(await pending)).toMatchObject({ ok: false, status: 403 });
    expect(
      f.current.store.db.prepare("SELECT * FROM admins").all(),
    ).toHaveLength(0);
    expect(
      f.current.store.db
        .prepare("SELECT * FROM agent_management_requests WHERE request=?")
        .get(r.request),
    ).toBeUndefined();
  } finally {
    release();
    spy.mockRestore();
    await f.close();
  }
});

it("requires explicit root-agent management purpose, audience, freshness, pinned key and operation authorization", async () => {
  const f = await setup();
  try {
    for (const bad of [
      { purpose: "status-callback" },
      { audience: "https://elsewhere.test" },
      { agent: "other" },
      { actor: "teacher" },
      { human: "claimed-admin" },
      { issued: Date.now() - 60000 },
      { expires: Date.now() - 1 },
      { expires: Date.now() + 60000 },
      { operation: "arbitrary.command" },
    ]) {
      const response = await f.post(f.request(bad));
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
    }
    expect((await f.post(f.request(), true)).statusCode).toBe(403);
    for (const operation of [
      "alerts.list",
      "alerts.show",
      "alerts.test",
      "alerts.remind",
      "attempts.list",
      "attempts.show",
      "clocks.show",
      "clocks.preview",
      "clocks.reset",
      "clocks.extend",
      "clocks.batch",
      "interruptions.show",
      "interruptions.review",
      "interruptions.authorize",
      "monitoring.show",
      "monitoring.list",
      "monitoring.replay",
      "monitoring.image",
      "monitoring.delete",
      "monitoring.purge",
      "monitoring.purges",
    ]) {
      expect(
        f.unpack(await f.post(f.request({ operation, body: {} }))).status,
      ).toBe(403);
    }
    expect(
      f.current.store.db.prepare("SELECT count(*) n FROM outbox").get(),
    ).toEqual({ n: 0 });
    expect(
      f.current.store.db
        .prepare("SELECT count(*) n FROM agent_management_requests")
        .get(),
    ).toEqual({ n: 0 });
    f.config.agent.managementOperations = [];
    const refused = f.unpack(await f.post(f.request()));
    expect(refused).toMatchObject({ ok: false, status: 403 });
    expect(refused.error).toContain("managementOperations");
    expect(
      f.current.store.db
        .prepare("SELECT actor FROM audit WHERE action='management-refused'")
        .get(),
    ).toEqual({ actor: "agent:class:root" });
    f.config.agent.managementOperations = ["exams.list"];
    expect(
      f.unpack(
        await f.post(
          f.request({ operation: "exams.show", body: { id: "sandbox" } }),
        ),
      ).status,
    ).toBe(403);
    f.config.loginOnly = true;
    expect(f.unpack(await f.post(f.request())).error).toContain("login-only");
  } finally {
    await f.close();
  }
});

it("binds native reconciliation to terminal web history, exact source identity, current review and atomic audit", async () => {
  const f = await setup();
  try {
    f.config.agent.managementOperations = [
      "exams.retire-preview",
      "exams.native-reconcile",
    ];
    const exam = "native-ack",
      id = randomUUID(),
      start = Date.now() - 1200000;
    const settings = {
      id: exam,
      name: "Synthetic legacy reconciliation",
      template: "v1",
      duration: 600,
      webcam: false,
      terminals: 2,
      earliest: start,
      latest: start + 600000,
    };
    f.current.store.db
      .prepare("INSERT INTO exams VALUES(?,?)")
      .run(exam, JSON.stringify(settings));
    f.current.store.db
      .prepare("UPDATE exam_lifecycle SET legacy_unreconciled=1 WHERE exam=?")
      .run(exam);
    f.current.store.db
      .prepare(
        "INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline,protected,access_state,checksum) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        id,
        exam,
        "synthetic",
        29999,
        "COMPLETED",
        JSON.stringify(settings),
        start,
        start + 600000,
        start + 600000,
        1,
        "RELEASED",
        "a".repeat(64),
      );
    const original = f.current.store.attempt(id);
    const call = async (operation: string, body: any, request = randomUUID()) =>
      f.unpack(await f.post(f.request({ operation, body, request })));
    const reviewReply = await call("exams.retire-preview", {
      id: exam,
      action: "archive",
    });
    expect(reviewReply.ok, JSON.stringify(reviewReply)).toBe(true);
    const review = reviewReply.result;
    expect(review.allowed).toBe(false);
    const evidence = {
      version: 1,
      agent: "class",
      exam,
      observed_at: Date.now(),
      state_hash: "b".repeat(64),
      attempts: [
        {
          id,
          username: "synthetic",
          uid: 29999,
          state: "COMPLETED",
          start,
          deadline: start + 600000,
          original_deadline: start + 600000,
          protected: true,
          checksum: "a".repeat(64),
          access_state: "RELEASED",
        },
      ],
      permissions: [],
      released_retentions: 0,
    };
    const body = {
      id: exam,
      action: "archive",
      revision: review.revision,
      review: review.review,
      reason: "Reviewed matching immutable native history",
      evidence,
    };
    for (const kind of [
      "missing",
      "clock",
      "account",
      "checksum",
      "held",
      "duplicate",
      "agent",
      "exam",
      "future",
      "expired",
      "extra",
    ]) {
      const invalid = structuredClone(body);
      switch (kind) {
        case "missing":
          invalid.evidence.attempts = [];
          break;
        case "clock":
          invalid.evidence.attempts[0].original_deadline++;
          break;
        case "account":
          invalid.evidence.attempts[0].uid++;
          break;
        case "checksum":
          invalid.evidence.attempts[0].checksum = "c".repeat(64);
          break;
        case "held":
          invalid.evidence.attempts[0].access_state = "HELD";
          break;
        case "duplicate":
          invalid.evidence.attempts.push({ ...invalid.evidence.attempts[0] });
          break;
        case "agent":
          invalid.evidence.agent = "elsewhere";
          break;
        case "exam":
          invalid.evidence.exam = "elsewhere";
          break;
        case "future":
          invalid.evidence.observed_at = Date.now() + 10000;
          break;
        case "expired":
          invalid.evidence.observed_at = Date.now() - 600001;
          break;
        case "extra":
          (invalid.evidence as any).permission = true;
          break;
      }
      const refused = await call("exams.native-reconcile", invalid);
      expect(refused.ok, kind).toBe(false);
      expect(
        f.current.store.db
          .prepare("SELECT * FROM exam_native_reconciliations WHERE exam=?")
          .get(exam),
        kind,
      ).toBeUndefined();
      expect(f.current.store.attempt(id), kind).toEqual(original);
    }
    const request = randomUUID();
    f.current.store.db.exec(
      "CREATE TRIGGER synthetic_native_audit_failure BEFORE INSERT ON audit WHEN NEW.action='reconcile-native-exam' BEGIN SELECT RAISE(ABORT,'synthetic native audit unavailable'); END",
    );
    const failed = await call("exams.native-reconcile", body, request);
    expect(failed.ok).toBe(false);
    expect(failed.error).toContain("synthetic native audit unavailable");
    expect(
      f.current.store.db
        .prepare("SELECT * FROM exam_native_reconciliations WHERE exam=?")
        .get(exam),
    ).toBeUndefined();
    expect(
      f.current.store.db
        .prepare("SELECT * FROM exam_definition_requests WHERE request=?")
        .get(request),
    ).toBeUndefined();
    f.current.store.db.exec("DROP TRIGGER synthetic_native_audit_failure");
    // Named management caches authenticated refusals as well as successes.
    // Repair then uses a new intent; an uncertain/lost reply retries the old one.
    expect(await call("exams.native-reconcile", body, request)).toMatchObject({
      ok: false,
      error: failed.error,
    });
    const acceptedRequest = randomUUID();
    const accepted = await call(
      "exams.native-reconcile",
      body,
      acceptedRequest,
    );
    expect(accepted.ok, JSON.stringify(accepted)).toBe(true);
    expect(
      (await call("exams.retire-preview", { id: exam, action: "archive" }))
        .result.allowed,
    ).toBe(true);
    await f.restart();
    expect(
      (await call("exams.native-reconcile", body, acceptedRequest)).result,
    ).toEqual(accepted.result);
    // A changed definition invalidates the acknowledgement, even if all native
    // terminal records are unchanged. It does not undo the history fence.
    f.current.store.db
      .prepare("UPDATE exams SET config=? WHERE id=?")
      .run(
        JSON.stringify({ ...settings, name: "Changed current defaults" }),
        exam,
      );
    expect(
      (await call("exams.retire-preview", { id: exam, action: "archive" }))
        .result.allowed,
    ).toBe(false);
    expect((await call("exams.native-reconcile", body)).ok).toBe(false);
    expect(f.current.store.attempt(id)).toEqual(original);
    // Web no-start projections use NULL and UNKNOWN. Positive native cancellation
    // uses zero intervals and its verified restored policy; normalize only that
    // representation, without rewriting either side or treating a HELD row as clear.
    const cancelledExam = "native-cancelled",
      cancelledID = randomUUID();
    f.current.store.db
      .prepare("INSERT INTO exams VALUES(?,?)")
      .run(cancelledExam, JSON.stringify({ ...settings, id: cancelledExam }));
    f.current.store.db
      .prepare("UPDATE exam_lifecycle SET legacy_unreconciled=1 WHERE exam=?")
      .run(cancelledExam);
    f.current.store.db
      .prepare(
        "INSERT INTO attempts(id,exam,username,uid,state,settings) VALUES(?,?,?,?,?,?)",
      )
      .run(
        cancelledID,
        cancelledExam,
        "synthetic",
        29999,
        "CANCELLED_BEFORE_START",
        JSON.stringify({ ...settings, id: cancelledExam }),
      );
    const cancellation = f.current.store.attempt(cancelledID);
    const cancelReview = (
      await call("exams.retire-preview", {
        id: cancelledExam,
        action: "archive",
      })
    ).result;
    const cancelEvidence = {
      ...evidence,
      exam: cancelledExam,
      attempts: [
        {
          id: cancelledID,
          username: "synthetic",
          uid: 29999,
          state: "CANCELLED_BEFORE_START",
          start: 0,
          deadline: 0,
          original_deadline: 0,
          protected: false,
          checksum: "",
          access_state: "",
        },
      ],
    };
    const cancelReply = await call("exams.native-reconcile", {
      ...body,
      id: cancelledExam,
      revision: cancelReview.revision,
      review: cancelReview.review,
      evidence: cancelEvidence,
    });
    expect(cancelReply.ok, JSON.stringify(cancelReply)).toBe(true);
    expect(
      (
        await call("exams.retire-preview", {
          id: cancelledExam,
          action: "archive",
        })
      ).result.allowed,
    ).toBe(true);
    expect(f.current.store.attempt(cancelledID)).toEqual(cancellation);
  } finally {
    await f.close();
  }
});

it.skipIf(process.env.EXAM_MANAGEMENT_USERNS !== "1")(
  "runs actual root-mapped examctl against the real gateway through local TLS, including replay-safe restart retry",
  async () => {
    const f = await setup();
    const run = promisify(execFile);
    let server: https.Server | undefined;
    try {
      const key = f.dir + "/tls.key",
        cert = f.dir + "/tls.crt",
        binary = f.dir + "/examctl";
      await run("/usr/bin/openssl", [
        "req",
        "-x509",
        "-newkey",
        "ed25519",
        "-nodes",
        "-keyout",
        key,
        "-out",
        cert,
        "-subj",
        "/CN=localhost",
        "-addext",
        "subjectAltName=IP:127.0.0.1",
        "-days",
        "1",
      ]);
      await run("go", ["build", "-o", binary, "./cmd/examctl"], {
        cwd: "ssh-server",
        timeout: 30000,
        env: { ...process.env, CGO_ENABLED: "0" },
      });
      let corruptCatalog: string | null = null;
      let corruptImage: string | null = null;
      let corruptRetirement: "drop" | "scope" | null = null;
      let corruptNativeRetirement: "drop" | "scope" | null = null;
      let corruptAdministrator: "drop" | "scope" | "refusal" | null = null;
      let corruptSavedSelection: "swap" | "drop-confirm" | null = null;
      server = https.createServer(
        { key: readFileSync(key), cert: readFileSync(cert) },
        (req, res) => {
          const chunks: Buffer[] = [];
          req.on("data", (chunk) => chunks.push(chunk));
          req.on("end", () => {
            void f.current.app
              .inject({
                method: req.method as any,
                url: req.url!,
                headers: req.headers as any,
                payload: Buffer.concat(chunks),
              })
              .then((reply) => {
                let raw = reply.rawPayload;
                if (
                  (corruptCatalog ||
                    corruptImage ||
                    corruptAdministrator ||
                    corruptRetirement ||
                    corruptNativeRetirement ||
                    corruptSavedSelection) &&
                  req.url === "/api/agent/management"
                ) {
                  const frame = JSON.parse(raw.toString());
                  const payload = JSON.parse(
                    Buffer.from(frame.payload, "base64").toString(),
                  );
                  let changed = false;
                  if (
                    corruptSavedSelection === "drop-confirm" &&
                    payload.operation === "grants.issue-confirm" &&
                    payload.ok
                  ) {
                    res.destroy();
                    return;
                  }
                  if (
                    corruptSavedSelection === "swap" &&
                    payload.operation === "grants.additional-preview" &&
                    payload.ok &&
                    payload.result.rows.length === 2
                  ) {
                    [payload.result.rows[0].work, payload.result.rows[1].work] =
                      [
                        payload.result.rows[1].work,
                        payload.result.rows[0].work,
                      ];
                    changed = true;
                  }
                  if (
                    corruptNativeRetirement &&
                    payload.operation === "exams.native-reconcile" &&
                    payload.ok
                  ) {
                    if (corruptNativeRetirement === "drop") {
                      res.destroy();
                      return;
                    }
                    payload.result.id = "elsewhere";
                    payload.result.private =
                      "PRIVATE-NATIVE-EVIDENCE-MUST-NOT-PRINT";
                    changed = true;
                  }
                  if (
                    corruptRetirement === "drop" &&
                    payload.operation === "exams.delete" &&
                    payload.ok
                  ) {
                    res.destroy();
                    return;
                  }
                  if (
                    corruptRetirement === "scope" &&
                    payload.operation === "exams.retire-preview" &&
                    payload.ok
                  ) {
                    payload.result.id = "elsewhere";
                    payload.result.private =
                      "PRIVATE-RETIREMENT-DATA-MUST-NOT-PRINT";
                    changed = true;
                  }
                  if (
                    corruptAdministrator &&
                    payload.operation === "administrators.create" &&
                    payload.ok
                  ) {
                    if (corruptAdministrator === "drop") {
                      res.destroy();
                      return;
                    }
                    if (corruptAdministrator === "scope")
                      payload.result = {
                        username: "wrong_account",
                        hash: "PRIVATE-ADMIN-PASSWORD-MUST-NOT-PRINT",
                      };
                    if (corruptAdministrator === "refusal") {
                      payload.ok = false;
                      payload.status = 409;
                      payload.error = "PRIVATE-ADMIN-PASSWORD-MUST-NOT-PRINT";
                      delete payload.result;
                    }
                    changed = true;
                  }
                  if (
                    payload.operation === corruptCatalog &&
                    payload.ok &&
                    payload.result?.source
                  ) {
                    payload.result.source.hash = "f".repeat(64);
                    payload.result.note =
                      "PRIVATE-TEMPLATE-SCOPE-DATA-MUST-NOT-PRINT";
                    changed = true;
                  }
                  if (
                    corruptImage &&
                    payload.operation === "monitoring.image" &&
                    payload.ok
                  ) {
                    if (corruptImage === "frame")
                      payload.result.frame = randomUUID();
                    if (corruptImage === "variant")
                      payload.result.thumbnail = !payload.result.thumbnail;
                    if (corruptImage === "digest")
                      payload.result.sha256 = "a".repeat(64);
                    payload.result.note =
                      "PRIVATE-IMAGE-SCOPE-DATA-MUST-NOT-PRINT";
                    changed = true;
                  }
                  if (changed) {
                    const bytes = Buffer.from(JSON.stringify(payload));
                    raw = Buffer.from(
                      JSON.stringify({
                        payload: bytes.toString("base64"),
                        signature: sign(
                          null,
                          bytes,
                          f.gatewayKeys.privateKey,
                        ).toString("base64"),
                      }),
                    );
                  }
                }
                res.writeHead(reply.statusCode, {
                  ...reply.headers,
                  "content-length": raw.length,
                } as any);
                res.end(raw);
              })
              .catch(() => {
                res.writeHead(500);
                res.end();
              });
          });
        },
      );
      await new Promise<void>((resolve) =>
        server!.listen(0, "127.0.0.1", resolve),
      );
      f.config.origin =
        "https://127.0.0.1:" + (server.address() as AddressInfo).port;
      writeFileSync(f.dir + "/cli-agent.key", f.agentKeys.privateKey, {
        mode: 0o600,
      });
      writeFileSync(f.dir + "/gateway.pub", f.gatewayKeys.publicKey, {
        mode: 0o600,
      });
      const configPath = f.dir + "/cli.json";
      writeFileSync(
        configPath,
        JSON.stringify({
          state: f.dir + "/unused-native-state",
          work: f.dir + "/unused-work",
          rootfs: f.dir,
          accounts: {
            synthetic: {
              uid: 29999,
              gid: 29999,
              home: f.dir,
              shell: "/bin/bash",
            },
          },
          agent_id: "class",
          gateway_public_key: f.dir + "/gateway.pub",
          callback_key: f.dir + "/cli-agent.key",
          callback_url: f.config.origin,
          callback_ca: cert,
        }),
        { mode: 0o600 },
      );
      const midterm = {
        id: "midterm",
        name: "Original",
        template: "v1",
        duration: 5400,
        webcam: true,
        terminals: 4,
        earliest: 0,
        latest: 8640000000000000,
      };
      f.current.store.db
        .prepare("INSERT INTO exams VALUES(?,?)")
        .run("midterm", JSON.stringify(midterm));
      const invoke = (category: string, args: string[]) =>
        run(
          "/usr/bin/unshare",
          [
            "--user",
            "--map-root-user",
            binary,
            "--config",
            configPath,
            "web",
            category,
            ...args,
          ],
          { timeout: 20000 },
        );
      const cli = (args: string[]) => invoke("exams", args);
      const students = (args: string[]) => invoke("students", args);
      f.config.agent.managementOperations = [
        "exams.list",
        "exams.show",
        "exams.update",
      ];
      const sandbox = JSON.parse(
        (await cli(["show", "sandbox"])).stdout,
      ).result;
      const practiceWindow = [
        "update",
        "sandbox",
        "--revision",
        sandbox.revision,
        "--earliest",
        "2026-10-22T09:00:00-05:00",
        "--latest",
        "2026-10-22T17:00:00-05:00",
        "--reason",
        "Configure finite synthetic practice window",
      ];
      const practice = JSON.parse((await cli(practiceWindow)).stdout).result;
      expect(practice.exam).toMatchObject({
        earliest: Date.parse("2026-10-22T09:00:00-05:00"),
        latest: Date.parse("2026-10-22T17:00:00-05:00"),
        duration: 300,
        webcam: false,
      });
      const id = randomUUID();
      const first = JSON.parse(
        (await cli(["show", "midterm", "--request", id])).stdout,
      );
      expect(first).toMatchObject({
        request: id,
        operation: "exams.show",
        confirmed: true,
        result: { exam: { name: "Original" } },
      });
      await f.restart();
      f.current.store.db
        .prepare("UPDATE exams SET config=? WHERE id='midterm'")
        .run(JSON.stringify({ ...midterm, name: "Changed" }));
      expect(
        JSON.parse((await cli(["show", "midterm", "--request", id])).stdout)
          .result,
      ).toEqual(first.result);
      expect(
        JSON.parse((await cli(["show", "midterm"])).stdout).result.exam.name,
      ).toBe("Changed");
      expect(
        JSON.parse((await cli(["list", "--limit", "1"])).stdout).result.next,
      ).toBe("midterm");
      f.config.agent.managementOperations = [
        "exams.list",
        "exams.show",
        "exams.create",
        "exams.update",
      ];
      new TemplateCatalog(f.current.store, "class").sync(
        {
          version: {
            schema: 1,
            name: "v1",
            hash: "a".repeat(64),
            entries: 4,
            files: 2,
            bytes: 30,
            max_file_bytes: 20,
            created: 1000,
          },
          reason: "Synthetic exact source for initial CLI grants",
        },
        {
          agent: "class",
          actor: "agent:class:root",
          request: randomUUID(),
          issued: 1000,
          observed: 1001,
        },
      );
      const creation = [
        "create",
        "cli-exam",
        "--name",
        "CLI exam",
        "--template",
        "v1",
        "--template-version",
        "a".repeat(64),
        "--earliest",
        "2026-10-22T09:00:00-05:00",
        "--latest",
        "2026-10-22T09:30:00-05:00",
        "--duration-seconds",
        "7200",
        "--webcam",
        "optional",
        "--terminals",
        "2",
        "--collection-file-mib",
        "256",
        "--collection-total-mib",
        "1024",
        "--reason",
        "Create via supported flags",
      ];
      const made = JSON.parse((await cli(creation)).stdout);
      expect(made).toMatchObject({
        operation: "exams.create",
        confirmed: true,
        result: {
          exam: {
            id: "cli-exam",
            duration: 7200,
            webcam: false,
            terminals: 2,
            collection_file_mib: 256,
            collection_total_mib: 1024,
            earliest: Date.parse("2026-10-22T09:00:00-05:00"),
          },
        },
      });
      const updateID = randomUUID();
      const update = [
        "--name",
        "help",
        "update",
        "cli-exam",
        "--revision",
        made.result.revision,
        "--request",
        updateID,
      ];
      const edited = JSON.parse((await cli(update)).stdout);
      expect(edited.result.exam).toEqual({ ...made.result.exam, name: "help" });
      await f.restart();
      expect(JSON.parse((await cli(update)).stdout).result).toEqual(
        edited.result,
      );
      await expect(
        cli([
          "update",
          "cli-exam",
          "--revision",
          made.result.revision,
          "--duration-seconds",
          "5400",
        ]),
      ).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining("changed"),
      });
      await expect(cli(creation)).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining("already exists"),
      });
      await expect(
        cli(["retire-preview", "cli-exam", "--action", "delete"]),
      ).rejects.toMatchObject({ code: 1 });
      f.config.agent.managementOperations = [...managementOperations];
      // Actual root-mapped process -> signed TLS -> shared retirement service.
      const unusedCreation = creation.map((v) =>
        v === "cli-exam" ? "retire-unused" : v,
      );
      await cli(unusedCreation);
      const unusedReview = JSON.parse(
        (await cli(["retire-preview", "retire-unused", "--action", "delete"]))
          .stdout,
      ).result;
      expect(unusedReview).toMatchObject({
        id: "retire-unused",
        allowed: true,
        counts: { attempts: 0, grants: 0 },
      });
      corruptRetirement = "scope";
      await expect(
        cli(["retire-preview", "retire-unused", "--action", "delete"]),
      ).rejects.toMatchObject({
        code: 1,
        stdout: "",
        stderr: expect.stringContaining("scope/review mismatch"),
      });
      corruptRetirement = "drop";
      const deleteRequest = randomUUID(),
        remove = [
          "delete",
          "retire-unused",
          "--revision",
          unusedReview.revision,
          "--review",
          unusedReview.review,
          "--reason",
          "Reviewed synthetic unused definition",
          "--request",
          deleteRequest,
        ];
      await expect(cli(remove)).rejects.toMatchObject({ code: 1, stdout: "" });
      expect(
        f.current.store.db
          .prepare("SELECT id FROM exams WHERE id='retire-unused'")
          .get(),
      ).toBeUndefined();
      corruptRetirement = null;
      await f.restart();
      const removed = JSON.parse((await cli(remove)).stdout).result;
      expect(removed).toMatchObject({
        action: "delete",
        lifecycle: "deleted",
        revision: null,
      });
      await f.restart();
      await cli(unusedCreation);
      expect(JSON.parse((await cli(remove)).stdout).result).toEqual(removed);
      await expect(
        cli(remove.filter((v) => v !== "--request" && v !== deleteRequest)),
      ).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining("changed"),
      });
      expect(
        JSON.parse((await cli(["show", "retire-unused"])).stdout).result.exam
          .id,
      ).toBe("retire-unused");
      expect(
        JSON.parse(
          (
            await students([
              "add",
              "cli-exam",
              "learner01",
              "--duration-minutes",
              "120",
              "--webcam",
              "optional",
            ])
          ).stdout,
        ).result.ok,
      ).toBe(true);
      const roster = JSON.parse(
        (await students(["list", "cli-exam", "--limit", "1"])).stdout,
      ).result;
      expect(roster.students[0]).toMatchObject({
        username: "learner01",
        duration: 7200,
        webcam: 0,
        uid: 0,
      });
      expect(roster.students[0].recovery_allowance_edit).toMatchObject({
        duration: 7200,
        actor: expect.stringContaining("agent:"),
      });
      const grantsCLI = async (args: string[]) =>
        JSON.parse((await invoke("grants", args)).stdout).result;
      const initial = (
        await grantsCLI(["list", "cli-exam", "--username", "learner01"])
      ).grants[0];
      expect(initial).toMatchObject({
        status: "AVAILABLE",
        revision: 1,
        settings: {
          duration: 7200,
          webcam: false,
          template_version: "a".repeat(64),
        },
      });
      expect((await grantsCLI(["show", initial.id])).history).toHaveLength(1);
      const grantRequest = randomUUID(),
        grantArgs = [
          "revise",
          initial.id,
          "--revision",
          "1",
          "--duration-minutes",
          "75",
          "--reason",
          "Explicit unused initial CLI revision",
          "--request",
          grantRequest,
        ];
      const revised = await grantsCLI(grantArgs);
      expect(revised).toMatchObject({
        revision: 2,
        settings: { duration: 4500, webcam: false },
      });
      await f.restart();
      expect(await grantsCLI(grantArgs)).toEqual(revised);
      await expect(
        grantsCLI([
          "revise",
          initial.id,
          "--revision",
          "1",
          "--webcam",
          "required",
          "--reason",
          "Stale unused initial CLI revision",
        ]),
      ).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining("revision changed"),
      });
      expect(
        (
          await grantsCLI([
            "revoke",
            initial.id,
            "--revision",
            "2",
            "--reason",
            "Withdraw this unused CLI authorization",
          ])
        ).status,
      ).toBe("REVOKED");
      const allowanceRequest = randomUUID();
      f.current.store.db
        .prepare("INSERT INTO exams VALUES('legacy-cli',?)")
        .run(JSON.stringify({ ...made.result.exam, id: "legacy-cli" }));
      f.current.store.db
        .prepare(
          "INSERT INTO enrollments(exam,username,uid,duration,webcam) VALUES('legacy-cli','old01',0,4500,1),('legacy-cli','old02',0,NULL,NULL)",
        )
        .run();
      const legacyDefinition = JSON.parse(
        (await cli(["show", "legacy-cli"])).stdout,
      ).result;
      const reviewArgs = [
        "issue-preview",
        "legacy-cli",
        "old01",
        "old02",
        "--definition-revision",
        legacyDefinition.revision,
        "--template-version",
        "a".repeat(64),
        "--earliest",
        new Date(Date.now() + 3600000).toISOString(),
        "--latest",
        new Date(Date.now() + 7200000).toISOString(),
        "--reason",
        "Reviewed NEW unused CLI grants",
        "--request",
        randomUUID(),
      ];
      const review = await grantsCLI(reviewArgs);
      expect(review).toMatchObject({
        status: "REVIEW",
        kind: "NEW_LEGACY_INITIAL_GRANTS",
        rows: [
          { username: "old01", settings: { duration: 4500, webcam: true } },
          { username: "old02", settings: { duration: 7200, webcam: false } },
        ],
      });
      expect(await grantsCLI(reviewArgs)).toEqual(review);
      expect((await grantsCLI(["issue-show", review.id])).status).toBe(
        "REVIEW",
      );
      const abandonedArgs = [...reviewArgs];
      abandonedArgs[abandonedArgs.length - 1] = randomUUID();
      const abandonedReview = await grantsCLI(abandonedArgs);
      expect(
        (
          await grantsCLI([
            "issue-cancel",
            abandonedReview.id,
            "--revision",
            abandonedReview.revision,
          ])
        ).status,
      ).toBe("CANCELLED");
      const confirmArgs = [
        "issue-confirm",
        review.id,
        "--revision",
        review.revision,
        "--request",
        randomUUID(),
      ];
      const issuedLegacy = await grantsCLI(confirmArgs);
      expect(issuedLegacy.status).toBe("CONFIRMED");
      expect(issuedLegacy.issued).toHaveLength(2);
      await f.restart();
      expect(await grantsCLI(confirmArgs)).toEqual(issuedLegacy);
      await expect(
        grantsCLI(["issue-cancel", review.id, "--revision", review.revision]),
      ).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining("already confirmed"),
      });
      expect(
        (await grantsCLI(["show", issuedLegacy.issued[0].grant])).settings
          .duration,
      ).toBe(4500);
      const extraArgs = [
        "additional-preview",
        "legacy-cli",
        "old01",
        "old02",
        "--duration-minutes",
        "90",
        "--definition-revision",
        legacyDefinition.revision,
        "--template-version",
        "a".repeat(64),
        "--earliest",
        new Date(Date.now() + 10800000).toISOString(),
        "--latest",
        new Date(Date.now() + 14400000).toISOString(),
        "--reason",
        "Explicit separate additional template attempts",
        "--work",
        "empty",
        "--request",
        randomUUID(),
      ];
      const extraReview = await grantsCLI(extraArgs);
      expect(extraReview).toMatchObject({
        kind: "NEW_ADDITIONAL_TEMPLATE_GRANTS",
        status: "REVIEW",
        rows: [
          {
            username: "old01",
            existing_grants: 1,
            settings: { duration: 5400, webcam: true },
            work: { kind: "empty" },
          },
          {
            username: "old02",
            existing_grants: 1,
            settings: { duration: 5400, webcam: false },
            work: { kind: "empty" },
          },
        ],
      });
      const extraConfirm = [
        "issue-confirm",
        extraReview.id,
        "--revision",
        extraReview.revision,
        "--request",
        randomUUID(),
      ];
      const extraIssued = await grantsCLI(extraConfirm);
      expect(extraIssued.issued).toHaveLength(2);
      await f.restart();
      expect(await grantsCLI(extraConfirm)).toEqual(extraIssued);
      const extraGrant = await grantsCLI(["show", extraIssued.issued[0].grant]);
      expect(extraGrant).toMatchObject({
        issuance: "ADDITIONAL_TEMPLATE",
        initial_grant: issuedLegacy.issued[0].grant,
        issuance_order: expect.any(Number),
        settings: { duration: 5400, webcam: true },
      });
      const extraRev = await grantsCLI([
        "revise",
        extraGrant.id,
        "--revision",
        "1",
        "--duration-minutes",
        "75",
        "--reason",
        "Explicit unused additional allowance revision",
      ]);
      expect(extraRev.settings.duration).toBe(4500);
      expect(extraRev.work).toEqual({ kind: "empty" });
      const sourceRev = await grantsCLI([
        "revise",
        extraIssued.issued[1].grant,
        "--revision",
        "1",
        "--work",
        "template",
        "--work-template",
        "v1",
        "--work-template-version",
        "a".repeat(64),
        "--reason",
        "Explicit independently selected starter",
      ]);
      expect(sourceRev.work).toEqual({
        kind: "template",
        name: "v1",
        hash: "a".repeat(64),
      });
      expect(
        (
          await grantsCLI([
            "revoke",
            extraGrant.id,
            "--revision",
            "2",
            "--reason",
            "Withdraw unused additional authorization",
          ])
        ).status,
      ).toBe("REVOKED");
      const sandboxBefore = JSON.parse(
        (await cli(["show", "sandbox"])).stdout,
      ).result;
      const practiceFrom = new Date(Date.now() - 60000).toISOString(),
        practiceUntil = new Date(Date.now() + 600000).toISOString();
      const sandboxSaved = JSON.parse(
        (
          await cli([
            "update",
            "sandbox",
            "--revision",
            sandboxBefore.revision,
            "--template",
            "v1",
            "--template-version",
            "a".repeat(64),
            "--earliest",
            practiceFrom,
            "--latest",
            practiceUntil,
            "--reason",
            "Configure finite exact CLI practice window",
          ])
        ).stdout,
      ).result;
      expect(sandboxSaved.exam).toMatchObject({
        id: "sandbox",
        duration: 300,
        webcam: false,
        terminals: 4,
        template_version: "a".repeat(64),
      });
      expect(
        JSON.parse((await students(["add", "sandbox", "practicecli"])).stdout)
          .result.ok,
      ).toBe(true);
      const practiceReviewArgs = [
        "additional-preview",
        "sandbox",
        "practicecli",
        "--duration-minutes",
        "5",
        "--definition-revision",
        sandboxSaved.revision,
        "--template-version",
        "a".repeat(64),
        "--earliest",
        practiceFrom,
        "--latest",
        practiceUntil,
        "--reason",
        "Explicit NEW CLI practice allowance",
        "--request",
        randomUUID(),
      ];
      const practiceReview = await grantsCLI(practiceReviewArgs);
      expect(practiceReview).toMatchObject({
        kind: "NEW_SANDBOX_PRACTICE_GRANTS",
        status: "REVIEW",
        rows: [
          {
            username: "practicecli",
            settings: { duration: 300, webcam: false, terminals: 4 },
          },
        ],
      });
      expect(await grantsCLI(practiceReviewArgs)).toEqual(practiceReview);
      const practiceConfirm = [
        "issue-confirm",
        practiceReview.id,
        "--revision",
        practiceReview.revision,
        "--request",
        randomUUID(),
      ];
      const practiceIssued = await grantsCLI(practiceConfirm);
      await f.restart();
      expect(await grantsCLI(practiceConfirm)).toEqual(practiceIssued);
      const practiceGrant = await grantsCLI([
        "show",
        practiceIssued.issued[0].grant,
      ]);
      expect(practiceGrant).toMatchObject({
        issuance: "PRACTICE",
        status: "AVAILABLE",
        settings: { duration: 300, webcam: false, terminals: 4 },
      });
      await expect(
        grantsCLI([
          "revise",
          practiceGrant.id,
          "--revision",
          "1",
          "--duration-minutes",
          "6",
          "--reason",
          "Refuse changing fixed practice allowance",
        ]),
      ).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining("five minutes"),
      });
      expect((await grantsCLI(["show", practiceGrant.id])).revision).toBe(1);
      const practiceRevised = await grantsCLI([
        "revise",
        practiceGrant.id,
        "--revision",
        "1",
        "--latest",
        new Date(Date.now() + 720000).toISOString(),
        "--reason",
        "Explicit unused practice window revision",
      ]);
      expect(practiceRevised).toMatchObject({
        revision: 2,
        settings: { duration: 300, webcam: false, terminals: 4 },
      });
      expect(
        (
          await grantsCLI([
            "revoke",
            practiceGrant.id,
            "--revision",
            "2",
            "--reason",
            "Withdraw unused CLI practice grant",
          ])
        ).status,
      ).toBe("REVOKED");
      const practiceCancelled = await grantsCLI([
        ...practiceReviewArgs.slice(0, -2),
        "--request",
        randomUUID(),
      ]);
      expect(
        (
          await grantsCLI([
            "issue-cancel",
            practiceCancelled.id,
            "--revision",
            practiceCancelled.revision,
          ])
        ).status,
      ).toBe("CANCELLED");
      expect(
        (await grantsCLI(["list", "sandbox", "--username", "practicecli"]))
          .grants,
      ).toHaveLength(1);
      const allowanceArgs = [
        "settings",
        "cli-exam",
        "learner01",
        "--duration-minutes",
        "120",
        "--request",
        allowanceRequest,
      ];
      await students(allowanceArgs);
      const allowance = JSON.parse(
        (await students(["list", "cli-exam"])).stdout,
      ).result.students[0].recovery_allowance_edit;
      expect(allowance.revision).toBeGreaterThan(
        roster.students[0].recovery_allowance_edit.revision,
      );
      await f.restart();
      await students(allowanceArgs);
      expect(
        JSON.parse((await students(["list", "cli-exam"])).stdout).result
          .students[0].recovery_allowance_edit,
      ).toEqual(allowance);
      expect(
        JSON.parse(
          (
            await students([
              "settings",
              "cli-exam",
              "learner01",
              "--webcam",
              "inherit",
            ])
          ).stdout,
        ).result.updated,
      ).toBe(1);
      const csv = f.dir + "/roster.csv";
      writeFileSync(csv, "username\nlearner01\nlearner02\n");
      const preview = JSON.parse(
        (await students(["import-preview", "cli-exam", "--file", csv])).stdout,
      ).result;
      expect(preview.summary).toEqual({ added: 1, changed: 0, unchanged: 1 });
      expect(
        JSON.parse(
          (await students(["import-confirm", "cli-exam", preview.id])).stdout,
        ).result.ok,
      ).toBe(true);
      f.current.store.db
        .prepare("UPDATE previews SET created=0 WHERE id=?")
        .run(preview.id);
      expect(
        JSON.parse(
          (await students(["import-confirm", "cli-exam", preview.id])).stdout,
        ).result.ok,
      ).toBe(true);
      expect((await students(["example", "cli-exam"])).stdout).toContain(
        "username,require_webcam,duration_minutes",
      );
      const destination = f.dir + "/export.csv";
      await students(["export", "cli-exam", "--output", destination]);
      const exported = readFileSync(destination, "utf8");
      expect(exported).toContain("learner01,inherit,120");
      await expect(
        students(["export", "cli-exam", "--output", destination]),
      ).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining("never overwrite"),
      });
      expect(readFileSync(destination, "utf8")).toBe(exported);
      expect(
        JSON.parse(
          (
            await students([
              "remove",
              "cli-exam",
              "learner02",
              "--confirm",
              "learner02",
            ])
          ).stdout,
        ).result.ok,
      ).toBe(true);
      f.config.agent.managementOperations = [...managementOperations];
      const alertsCLI = async (args: string[]) =>
        JSON.parse((await invoke("alerts", args)).stdout);
      expect((await alertsCLI(["list"])).result.alerts).toEqual([]);
      await expect(alertsCLI(["test"])).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining("SMTP is not configured"),
      });
      // Only a synthetic local delivery configuration; actual SMTP delivery and
      // retry/restart are separately exercised in alert-delivery.test.ts.
      f.config.smtp = {
        socket: f.dir + "/synthetic-not-listening.sock",
        from: "exam@example.edu",
        to: ["teacher@example.edu"],
      };
      const notice = f.current.life.alert(
        "Synthetic CLI failure",
        "PRIVATE NOTICE BODY NOT FOR MANAGEMENT CACHE",
        {
          key: {
            attempt: "synthetic-native-history",
            event: "collection-failure",
            generation: 0,
            cause: "test-cause",
          },
        },
      );
      f.current.store.db
        .prepare("UPDATE outbox SET status='sent' WHERE id=?")
        .run(notice);
      const shown = (await alertsCLI(["show", notice])).result;
      expect(shown).toMatchObject({ status: "sent", remindable: true });
      expect(JSON.stringify(shown)).not.toContain("PRIVATE NOTICE BODY");
      const reminderRequest = randomUUID();
      const reminderArgs = [
        "remind",
        shown.episode.id,
        "--revision",
        shown.episode.revision,
        "--reason",
        "Explicit synthetic operator follow-up",
        "--request",
        reminderRequest,
      ];
      const queued = (await alertsCLI(reminderArgs)).result;
      expect(queued).toMatchObject({ queued: true, delivered: false });
      await f.restart();
      expect((await alertsCLI(reminderArgs)).result).toEqual(queued);
      const testRequest = randomUUID();
      const tested = (await alertsCLI(["test", "--request", testRequest]))
        .result;
      expect(
        (await alertsCLI(["test", "--request", testRequest])).result,
      ).toEqual(tested);
      expect((await alertsCLI(["show", tested.outbox])).result).toMatchObject({
        status: "pending",
        episode: null,
      });
      expect(
        (await alertsCLI(["list", "--status", "pending"])).result.alerts.map(
          (a: any) => a.id,
        ),
      ).toEqual(expect.arrayContaining([tested.outbox, queued.outbox]));
      expect(
        f.current.store.db
          .prepare("SELECT count(*) n FROM alert_reminders")
          .get(),
      ).toEqual({ n: 1 });
      expect(
        JSON.stringify(
          f.current.store.db
            .prepare(
              "SELECT outcome FROM agent_management_requests WHERE outcome LIKE '%outbox%'",
            )
            .all(),
        ),
      ).not.toContain("PRIVATE NOTICE BODY");
      expect(
        f.current.store.db.prepare("SELECT count(*) n FROM attempts").get(),
      ).toEqual({ n: 0 });
      delete f.config.smtp;
      await qualifyAdministratorCLI(f, binary, configPath, invoke, (mode) => {
        corruptAdministrator = mode;
      });
      await qualifyClockCLI(f, invoke);
      await qualifyProvenanceCLI(f, invoke);
      await qualifyInterruptionCLI(f, invoke);
      await qualifyMonitoringCLI(f, invoke, (kind) => {
        corruptImage = kind;
      });
      await qualifyTemplateCLI(
        f,
        binary,
        configPath,
        invoke,
        run,
        (operation) => {
          corruptCatalog = operation;
        },
      );
      const savedSourceID = randomUUID(),
        savedSourceEnded = Date.now() - 3600000;
      const savedDefinition = new ExamDefinitions(
        f.current.store,
        "class",
      ).create(
        {
          ...legacyDefinition.exam,
          id: "saved-cli",
          name: "Saved source CLI fixture",
          earliest: savedSourceEnded - 5400000,
          latest: savedSourceEnded - 1000,
        },
        "synthetic-fixture",
      );
      f.current.store.db
        .prepare(
          "INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline,protected,checksum,access_state) VALUES(?,'saved-cli','saved01',10001,'COMPLETED',?,?,?,?,1,?,'RELEASED')",
        )
        .run(
          savedSourceID,
          JSON.stringify(savedDefinition.exam),
          savedSourceEnded - 5400000,
          savedSourceEnded,
          savedSourceEnded,
          "b".repeat(64),
        );
      f.current.store.db
        .prepare(
          "INSERT INTO enrollments(exam,username,uid,webcam) VALUES('saved-cli','saved01',10001,1)",
        )
        .run();
      // Both protected histories precede activation of this synthetic namespace's
      // grant mode. Never insert grantless history after the first issuance.
      const secondSavedSource = randomUUID();
      f.current.store.db
        .prepare(
          "INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline,protected,checksum,access_state) VALUES(?,'saved-cli','saved02',10002,'COMPLETED',?,?,?,?,1,?,'RELEASED')",
        )
        .run(
          secondSavedSource,
          JSON.stringify(savedDefinition.exam),
          savedSourceEnded - 5400000,
          savedSourceEnded,
          savedSourceEnded,
          "c".repeat(64),
        );
      f.current.store.db
        .prepare(
          "INSERT INTO enrollments(exam,username,uid,webcam) VALUES('saved-cli','saved02',10002,0)",
        )
        .run();
      const savedHistory = f.current.store.attempt(savedSourceID),
        secondSavedHistory = f.current.store.attempt(secondSavedSource);
      const savedReview = await grantsCLI([
        "additional-preview",
        "saved-cli",
        "saved01",
        "--duration-minutes",
        "90",
        "--definition-revision",
        savedDefinition.revision,
        "--template-version",
        "a".repeat(64),
        "--earliest",
        new Date(Date.now() - 1000).toISOString(),
        "--latest",
        new Date(Date.now() + 600000).toISOString(),
        "--work",
        "saved",
        "--work-attempt",
        savedSourceID,
        "--work-checksum",
        "b".repeat(64),
        "--reason",
        "Explicit fixed saved-work CLI grant pending durable native protection",
      ]);
      expect(savedReview.rows[0]).toMatchObject({
        work: {
          kind: "saved",
          attempt: savedSourceID,
          checksum: "b".repeat(64),
        },
        settings: { duration: 5400, webcam: true },
      });
      const savedIssued = await grantsCLI([
        "issue-confirm",
        savedReview.id,
        "--revision",
        savedReview.revision,
      ]);
      const savedGrant = await grantsCLI(["show", savedIssued.issued[0].grant]);
      expect(savedGrant).toMatchObject({
        status: "PENDING_NATIVE",
        work: {
          kind: "saved",
          attempt: savedSourceID,
          checksum: "b".repeat(64),
        },
      });
      await f.restart();
      expect(await grantsCLI(["show", savedGrant.id])).toEqual(savedGrant);
      expect(
        (
          await grantsCLI([
            "revoke",
            savedGrant.id,
            "--revision",
            "1",
            "--reason",
            "Cancel saved-work source confirmation without reserving account",
          ])
        ).status,
      ).toBe("REVOKED");
      expect(f.current.store.attempt(savedSourceID)).toEqual(savedHistory);
      const savedCSV = f.dir + "/saved-sources.csv";
      writeFileSync(
        savedCSV,
        `username,attempt,checksum\nsaved01,${savedSourceID},${"b".repeat(64)}\nsaved02,${secondSavedSource},${"c".repeat(64)}\n`,
        { mode: 0o600 },
      );
      const bulkSavedArgs = [
        "additional-preview",
        "saved-cli",
        "--saved-sources",
        savedCSV,
        "--duration-minutes",
        "90",
        "--definition-revision",
        savedDefinition.revision,
        "--template-version",
        "a".repeat(64),
        "--earliest",
        new Date(Date.now() - 1000).toISOString(),
        "--latest",
        new Date(Date.now() + 600000).toISOString(),
        "--reason",
        "Explicit bulk protected sources chosen separately per student",
      ];
      corruptSavedSelection = "swap";
      await expect(invoke("grants", bulkSavedArgs)).rejects.toMatchObject({
        code: 1,
        stdout: "",
        stderr: expect.stringContaining(
          "Unconfirmed issuance reply scope/schema",
        ),
      });
      corruptSavedSelection = null;
      const bulkSavedReview = await grantsCLI(bulkSavedArgs);
      expect(bulkSavedReview.rows).toHaveLength(2);
      expect(bulkSavedReview.rows[0]).toMatchObject({
        username: "saved01",
        work: {
          kind: "saved",
          attempt: savedSourceID,
          checksum: "b".repeat(64),
        },
        settings: { duration: 5400, webcam: true },
      });
      expect(bulkSavedReview.rows[1]).toMatchObject({
        username: "saved02",
        work: {
          kind: "saved",
          attempt: secondSavedSource,
          checksum: "c".repeat(64),
        },
        settings: { duration: 5400, webcam: false },
      });
      const bulkConfirm = [
        "issue-confirm",
        bulkSavedReview.id,
        "--revision",
        bulkSavedReview.revision,
        "--request",
        randomUUID(),
      ];
      corruptSavedSelection = "drop-confirm";
      await expect(invoke("grants", bulkConfirm)).rejects.toMatchObject({
        code: 1,
        stdout: "",
      });
      await f.restart();
      corruptSavedSelection = null;
      const bulkSavedIssued = await grantsCLI(bulkConfirm);
      expect(bulkSavedIssued.status).toBe("CONFIRMED");
      expect((await grantsCLI(bulkConfirm)).issued).toEqual(
        bulkSavedIssued.issued,
      );
      expect(
        (await grantsCLI(["issue-show", bulkSavedReview.id])).rows,
      ).toEqual(bulkSavedReview.rows);
      for (const [index, source] of [
        savedSourceID,
        secondSavedSource,
      ].entries()) {
        const grantID = bulkSavedIssued.issued.find(
          (g: any) => g.username === `saved0${index + 1}`,
        ).grant;
        const result = await grantsCLI(["show", grantID]);
        expect(result).toMatchObject({
          status: "PENDING_NATIVE",
          work: { kind: "saved", attempt: source },
          settings: { duration: 5400, webcam: index === 0 },
        });
        expect(
          f.current.store.db
            .prepare("SELECT count(*) n FROM grant_claims WHERE grant_id=?")
            .get(grantID),
        ).toEqual({ n: 0 });
      }
      const badCSV = f.dir + "/bad-saved-sources.csv";
      for (const contents of [
        "username,attempt,checksum\nsaved01,invalid,not-a-hash\n",
        `username,attempt,checksum\nsaved01,${savedSourceID},${"b".repeat(64)}\nsaved01,${secondSavedSource},${"c".repeat(64)}\n`,
        "attempt,username,checksum\ninvalid,saved01,not-a-hash\n",
        "x".repeat(65537),
      ]) {
        writeFileSync(badCSV, contents, { mode: 0o600 });
        await expect(
          invoke(
            "grants",
            bulkSavedArgs.map((v) => (v === savedCSV ? badCSV : v)),
          ),
        ).rejects.toMatchObject({
          code: 2,
          stdout: "",
          stderr: expect.stringMatching(/saved.sources/),
        });
      }
      await expect(
        invoke("grants", [
          ...bulkSavedArgs.slice(0, 2),
          "saved01",
          ...bulkSavedArgs.slice(2),
        ]),
      ).rejects.toMatchObject({
        code: 2,
        stdout: "",
        stderr: expect.stringContaining("map every selected student"),
      });
      await expect(
        invoke("grants", [...bulkSavedArgs, "--work", "empty"]),
      ).rejects.toMatchObject({
        code: 2,
        stdout: "",
        stderr: expect.stringContaining("never both"),
      });
      expect(f.current.store.attempt(savedSourceID)).toEqual(savedHistory);
      const historyMade = JSON.parse(
        (
          await cli(
            creation.map((v) => (v === "cli-exam" ? "retire-history" : v)),
          )
        ).stdout,
      ).result;
      const historicalID = randomUUID(),
        historicalStart = Date.now() - 9000000;
      f.current.store.db
        .prepare(
          "INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline,protected,access_state,checksum) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          historicalID,
          "retire-history",
          "synthetic",
          29999,
          "COMPLETED",
          JSON.stringify(historyMade.exam),
          historicalStart,
          historicalStart + 7200000,
          historicalStart + 7200000,
          1,
          "RELEASED",
          "b".repeat(64),
        );
      const originalHistory = f.current.store.attempt(historicalID);
      const cannotDelete = JSON.parse(
        (await cli(["retire-preview", "retire-history", "--action", "delete"]))
          .stdout,
      ).result;
      expect(cannotDelete.allowed).toBe(false);
      await expect(
        cli([
          "delete",
          "retire-history",
          "--revision",
          cannotDelete.revision,
          "--review",
          cannotDelete.review,
          "--reason",
          "History must remain protected",
        ]),
      ).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining("archive"),
      });
      const archiveReview = JSON.parse(
        (await cli(["retire-preview", "retire-history", "--action", "archive"]))
          .stdout,
      ).result;
      const archive = JSON.parse(
        (
          await cli([
            "archive",
            "retire-history",
            "--revision",
            archiveReview.revision,
            "--review",
            archiveReview.review,
            "--reason",
            "Archive protected synthetic history",
          ])
        ).stdout,
      ).result;
      expect(archive.lifecycle).toBe("archived");
      expect(
        JSON.parse((await cli(["list", "--lifecycle", "archived"])).stdout)
          .result.exams,
      ).toMatchObject([
        { exam: { id: "retire-history" }, lifecycle: "archived" },
      ]);
      await expect(
        cli([
          "update",
          "retire-history",
          "--revision",
          archive.revision,
          "--duration-seconds",
          "9000",
        ]),
      ).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining("unarchive"),
      });
      const restoration = JSON.parse(
        (
          await cli([
            "retire-preview",
            "retire-history",
            "--action",
            "unarchive",
          ])
        ).stdout,
      ).result;
      expect(
        JSON.parse(
          (
            await cli([
              "unarchive",
              "retire-history",
              "--revision",
              restoration.revision,
              "--review",
              restoration.review,
              "--reason",
              "Restore visibility without changing history",
            ])
          ).stdout,
        ).result.lifecycle,
      ).toBe("active");
      expect(f.current.store.attempt(historicalID)).toEqual(originalHistory);
      f.config.agent.managementOperations = [];
      await expect(cli(["show", "midterm"])).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining("managementOperations"),
      });
      expect(existsSync(f.dir + "/unused-native-state")).toBe(false);
      expect(f.current.store.attempt(secondSavedSource)).toEqual(
        secondSavedHistory,
      );
      expect(
        f.current.store.db.prepare("SELECT count(*) n FROM attempts").get(),
        "Management must retain exactly the nine explicitly authored synthetic histories, including both saved sources and both cancelled grant preparations",
      ).toEqual({ n: 9 });
      await qualifyNativeRetirementCLI(
        f,
        binary,
        configPath,
        creation,
        run,
        (mode) => {
          corruptNativeRetirement = mode;
        },
      );
    } finally {
      if (server)
        await new Promise<void>((resolve) => server!.close(() => resolve()));
      await f.close();
    }
  },
  45000,
);

it("keeps signed image retries payload-free, scopes reads and fences deletion after an async result before publication", async () => {
  const f = await setup();
  try {
    f.config.agent.managementOperations = ["monitoring.image"];
    f.current.store.db.exec(
      "INSERT INTO exams VALUES('images','{}'); INSERT INTO attempts(id,exam,username,uid,state,settings) VALUES('image-a','images','synthetic',1001,'LOCKED','{}'),('image-b','images','other',1002,'LOCKED','{}')",
    );
    const data = await sharp({
      create: { width: 40, height: 30, channels: 3, background: "white" },
    })
      .jpeg()
      .toBuffer();
    const frame = await new Monitoring(f.current.store).frame(
      f.current.store.attempt("image-a"),
      {
        source: "screen",
        seq: 1,
        captured: Date.now(),
        monotonic: 1,
        data: data.toString("base64"),
      },
      "page",
    );
    const before = f.current.store.attempt("image-a");
    const request = randomUUID(),
      body = { id: "image-a", frame: frame.id };
    const read = async (b: object = body, r = request) =>
      f.unpack(
        await f.post(
          f.request({ operation: "monitoring.image", body: b, request: r }),
        ),
      );
    const initial = await read();
    expect(initial.ok).toBe(true);
    expect(Buffer.from(initial.result.data, "base64")).toEqual(data);
    expect((await read({ ...body, id: "image-b" }, randomUUID())).status).toBe(
      404,
    );
    expect((await read({ ...body, extra: true }, randomUUID())).ok).toBe(false);
    const stored = f.current.store.db
      .prepare("SELECT outcome FROM agent_management_requests WHERE request=?")
      .get(request) as any;
    expect(JSON.parse(stored.outcome).result).toEqual({
      ...body,
      thumbnail: false,
      transient: true,
    });
    expect(stored.outcome).not.toContain(data.toString("base64"));
    await f.restart();
    expect((await read()).result).toEqual(initial.result);
    const original = MonitoringManagement.prototype.image;
    const spy = vi
      .spyOn(MonitoringManagement.prototype, "image")
      .mockImplementationOnce(async function (
        this: MonitoringManagement,
        ...args
      ) {
        const value = await original.apply(this, args);
        new Monitoring(f.current.store).delete("image-a", "teacher");
        return value;
      });
    try {
      const refused = await read();
      expect(refused).toMatchObject({ ok: false, status: 410 });
      expect(JSON.stringify(refused)).not.toContain(data.toString("base64"));
    } finally {
      spy.mockRestore();
    }
    expect((await read()).status).toBe(410);
    expect(f.current.store.attempt("image-a")).toEqual(before);
  } finally {
    await f.close();
  }
});

it("persists replay/idempotency and scope-bound results across restart without repeating management reads", async () => {
  const f = await setup();
  try {
    f.current.store.db
      .prepare("INSERT INTO exams VALUES(?,?)")
      .run("midterm", JSON.stringify({ id: "midterm", name: "Original" }));
    const r = f.request({ operation: "exams.show", body: { id: "midterm" } });
    const first = f.unpack(await f.post(r));
    expect(first).toMatchObject({
      version: 1,
      purpose: managementPurpose,
      audience: "class",
      request: r.request,
      nonce: r.nonce,
      operation: "exams.show",
      ok: true,
      result: { exam: { name: "Original" } },
    });
    expect(first.result.revision).toMatch(/^[a-f0-9]{64}$/);
    await f.restart();
    expect(f.unpack(await f.post(r)).error).toContain("replay");
    f.current.store.db
      .prepare("UPDATE exams SET config=? WHERE id='midterm'")
      .run(JSON.stringify({ id: "midterm", name: "Changed" }));
    const retry = f.unpack(
      await f.post(
        f.request({ request: r.request, operation: r.operation, body: r.body }),
      ),
    );
    expect(retry.result).toEqual(first.result);
    expect(retry.nonce).not.toBe(first.nonce);
    expect(
      f.unpack(
        await f.post(
          f.request({
            request: r.request,
            operation: r.operation,
            body: { id: "sandbox" },
          }),
        ),
      ).status,
    ).toBe(409);
    const refreshed = f.unpack(
      await f.post(f.request({ operation: r.operation, body: r.body })),
    );
    expect(refreshed.result.exam.name).toBe("Changed");
    expect(refreshed.result.revision).not.toBe(first.result.revision);
    expect(
      f.current.store.db
        .prepare(
          "SELECT count(*) n FROM audit WHERE action='management-exams.show'",
        )
        .get(),
    ).toEqual({ n: 2 });
    expect(
      f.current.store.db
        .prepare(
          "SELECT detail FROM audit WHERE action='management-exams.show' LIMIT 1",
        )
        .get(),
    ).toMatchObject({ detail: expect.stringContaining('"target":"midterm"') });
  } finally {
    await f.close();
  }
});

it("paginates definitions, refuses invalid/missing targets and does not change student attempts or browser authentication", async () => {
  const f = await setup();
  try {
    f.current.store.db
      .prepare("INSERT INTO exams VALUES(?,?)")
      .run("midterm", JSON.stringify({ id: "midterm" }));
    const page = f.unpack(await f.post(f.request()));
    expect(page.result.exams).toHaveLength(1);
    expect(page.result.next).toBe("midterm");
    const next = f.unpack(
      await f.post(f.request({ body: { after: page.result.next } })),
    );
    expect(next.result.exams).toHaveLength(1);
    expect(next.result.next).toBeNull();
    expect(
      f.unpack(await f.post(f.request({ body: { limit: 201 } }))).status,
    ).toBe(400);
    expect(
      f.unpack(
        await f.post(
          f.request({ operation: "exams.show", body: { id: "absent" } }),
        ),
      ).status,
    ).toBe(404);
    expect(
      (await f.current.app.inject({ url: "/api/admin/exams" })).statusCode,
    ).toBe(401);
    expect(
      f.current.store.db.prepare("SELECT count(*) n FROM attempts").get(),
    ).toEqual({ n: 0 });
  } finally {
    await f.close();
  }
});

it("requires a recognized source-selection protocol before signed root create/update can mutate definitions", async () => {
  const f = await setup();
  try {
    f.config.agent.managementOperations = [
      "templates.sync",
      "exams.create",
      "exams.update",
    ];
    const digest = "a".repeat(64);
    const synced = f.unpack(
      await f.post(
        f.request({
          operation: "templates.sync",
          body: {
            version: {
              schema: 1,
              name: "v1",
              hash: digest,
              entries: 4,
              files: 2,
              bytes: 30,
              max_file_bytes: 20,
              created: 1000,
            },
            reason: "Verify synthetic reviewed source selection",
          },
        }),
      ),
    );
    expect(synced.ok).toBe(true);
    const exam = {
      id: "exact",
      name: "Exact source",
      template: "v1",
      template_version: digest,
      earliest: Date.now() - 60000,
      latest: Date.now() + 3600000,
    };
    for (const marker of [undefined, "template-version/v2"]) {
      const refused = f.unpack(
        await f.post(
          f.request({
            operation: "exams.create",
            body: { exam, ...(marker ? { source_selection: marker } : {}) },
          }),
        ),
      );
      expect(refused.ok).toBe(false);
      expect(
        f.current.store.db
          .prepare("SELECT id FROM exams WHERE id='exact'")
          .get(),
      ).toBeUndefined();
    }
    const selected = f.unpack(
      await f.post(
        f.request({
          operation: "exams.create",
          body: { exam, source_selection: "template-version/v1" },
        }),
      ),
    );
    expect(selected.ok).toBe(true);
    expect(selected.result.exam.template_version).toBe(digest);
    for (const value of [digest, ""]) {
      const refused = f.unpack(
        await f.post(
          f.request({
            operation: "exams.update",
            body: {
              id: exam.id,
              revision: selected.result.revision,
              changes: { template_version: value },
            },
          }),
        ),
      );
      expect(refused.ok).toBe(false);
      expect(refused.error).toContain("source-selection protocol marker");
      expect(
        JSON.parse(
          (
            f.current.store.db
              .prepare("SELECT config FROM exams WHERE id='exact'")
              .get() as { config: string }
          ).config,
        ).template_version,
      ).toBe(digest);
    }
  } finally {
    await f.close();
  }
});

it("shares revision-checked definition writes across web and root CLI without resetting omitted settings or historical attempts", async () => {
  const f = await setup();
  try {
    f.config.agent.managementOperations = [
      "exams.list",
      "exams.show",
      "exams.create",
      "exams.update",
    ];
    const exam = {
      id: "programming",
      name: "Programming",
      template: "v1",
      earliest: Date.now() - 1000,
      latest: Date.now() + 3600000,
      duration: 7200,
      webcam: false,
      terminals: 2,
      collection_file_mib: 128,
      collection_total_mib: 512,
    };
    const created = f.unpack(
      await f.post(
        f.request({
          operation: "exams.create",
          body: { exam, reason: "Create synthetic definition" },
        }),
      ),
    );
    expect(created.ok).toBe(true);
    const session = f.current.store.session("admin", "instructor", null);
    const headers = {
      cookie: `session=${session.token}`,
      origin: f.config.origin,
      "x-csrf-token": session.csrf,
    };
    const web = (body: object) =>
      f.current.app.inject({
        method: "POST",
        url: "/api/admin/exams",
        headers,
        payload: body,
      });
    const list = await f.current.app.inject({
      url: "/api/admin/exams",
      headers,
    });
    expect(list.json()).toContainEqual({
      ...exam,
      revision: created.result.revision,
      lifecycle: "active",
    });
    const snapshot = JSON.stringify(exam);
    f.current.store.db
      .prepare(
        "INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline,protected,access_state) VALUES('history','programming','synthetic',29999,'COMPLETED',?,100,200,200,1,'RELEASED')",
      )
      .run(snapshot);
    const oldAttempt = f.current.store.attempt("history");
    const webIntent = {
      ...exam,
      name: "Web edit",
      revision: created.result.revision,
      requestID: randomUUID(),
    };
    const changed = await web(webIntent);
    expect(changed.statusCode).toBe(200);
    const revision = changed.json().revision;
    expect(revision).not.toBe(created.result.revision);
    const stale = f.unpack(
      await f.post(
        f.request({
          operation: "exams.update",
          body: {
            id: exam.id,
            changes: { name: "Stale root edit" },
            revision: created.result.revision,
          },
        }),
      ),
    );
    expect(stale.status).toBe(409);
    expect(stale.error).toContain("reload");
    const intent = f.request({
      operation: "exams.update",
      body: {
        id: exam.id,
        changes: { name: "Root edit" },
        revision,
        reason: "Change the display name",
      },
    });
    const updated = f.unpack(await f.post(intent));
    expect(updated.result.exam).toEqual({ ...exam, name: "Root edit" });
    expect(
      f.unpack(
        await f.post(
          f.request({
            request: intent.request,
            operation: intent.operation,
            body: intent.body,
          }),
        ),
      ).result,
    ).toEqual(updated.result);
    expect(
      (await web({ ...exam, revision, name: "Stale web edit" })).statusCode,
    ).toBe(409);
    expect(
      (await web({ ...exam, name: "Unversioned overwrite" })).statusCode,
    ).toBe(409);
    const invalid = f.unpack(
      await f.post(
        f.request({
          operation: "exams.update",
          body: {
            id: exam.id,
            changes: { duration: 59 },
            revision: updated.result.revision,
          },
        }),
      ),
    );
    expect(invalid.status).toBe(400);
    const duplicate = f.unpack(
      await f.post(f.request({ operation: "exams.create", body: { exam } })),
    );
    expect(duplicate.status).toBe(409);
    expect(f.current.store.attempt("history")).toEqual(oldAttempt);
    await f.restart();
    const retriedWeb = await web(webIntent);
    expect(retriedWeb.statusCode).toBe(200);
    expect(retriedWeb.json()).toEqual(changed.json());
    expect(
      (await web({ ...webIntent, name: "Different intent" })).statusCode,
    ).toBe(409);
    expect(
      f.current.store.db
        .prepare("SELECT count(*) n FROM audit WHERE action='configure-exam'")
        .get(),
    ).toEqual({ n: 3 });
    expect(
      f.unpack(
        await f.post(
          f.request({ operation: "exams.show", body: { id: exam.id } }),
        ),
      ).result.exam.name,
    ).toBe("Root edit");
  } finally {
    await f.close();
  }
});

it("shares roster/CSV validation, inheritance, verified UID and snapshot fences with root management without holding SQLite during parsing", async () => {
  const f = await setup();
  const originalParser = rosterParser.parseRosterAsync;
  const parser = vi
    .spyOn(rosterParser, "parseRosterAsync")
    .mockImplementation(async (...args) => {
      expect(f.current.store.db.inTransaction).toBe(false);
      return originalParser(...args);
    });
  try {
    f.config.agent.managementOperations = [...managementOperations];
    const root = async (operation: string, body: object, request?: string) =>
      f.unpack(
        await f.post(
          f.request({ operation, body, ...(request ? { request } : {}) }),
        ),
      );
    new TemplateCatalog(f.current.store, "class").sync(
      {
        version: {
          schema: 1,
          name: "v1",
          hash: "a".repeat(64),
          entries: 4,
          files: 2,
          bytes: 30,
          max_file_bytes: 20,
          created: 1000,
        },
        reason: "Synthetic reviewed source for initial CSV grants",
      },
      {
        agent: "class",
        actor: "agent:class:root",
        request: randomUUID(),
        issued: 1000,
        observed: 1001,
      },
    );
    const exam = {
      id: "roster",
      name: "Roster",
      template: "v1",
      template_version: "a".repeat(64),
      earliest: Date.now() - 1000,
      latest: Date.now() + 3600000,
      duration: 5400,
      webcam: true,
      terminals: 4,
    };
    expect(
      (
        await root("exams.create", {
          exam,
          source_selection: "template-version/v1",
        })
      ).ok,
    ).toBe(true);
    // Existing legacy history must not be retroactively issued an initial grant
    // by re-enrollment. New CSV students below still exercise real issuance.
    f.current.store.db
      .prepare(
        "INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline,access_state) VALUES('active-roster','roster','learner01',29999,'ACTIVE',?,100,200,200,'HELD')",
      )
      .run(JSON.stringify(exam));
    const addedID = randomUUID();
    expect(
      (
        await root(
          "students.add",
          {
            exam: "roster",
            username: "learner01",
            duration: 7200,
            webcam: false,
            uid: 29999,
          },
          addedID,
        )
      ).ok,
    ).toBe(true);
    expect(
      (
        await root(
          "students.add",
          {
            exam: "roster",
            username: "learner01",
            duration: 7200,
            webcam: false,
            uid: 29999,
          },
          addedID,
        )
      ).ok,
    ).toBe(true);
    expect(
      f.current.store.db
        .prepare("SELECT uid FROM enrollments WHERE exam='roster'")
        .get(),
    ).toEqual({ uid: 0 });
    f.current.store.db
      .prepare(
        "UPDATE enrollments SET uid=29999 WHERE exam='roster' AND username='learner01'",
      )
      .run();
    const snapshot = f.current.store.attempt("active-roster");
    const preview = await root("students.import-preview", {
      exam: "roster",
      text: "username\nlearner01\nlearner02\n",
    });
    expect(preview.result.rows[0]).toMatchObject({
      username: "learner01",
      uid: 29999,
      activeAttempt: true,
      previous: { duration: 7200, webcam: 0 },
    });
    expect(
      (
        await root("students.import-confirm", {
          exam: "roster",
          id: preview.result.id,
        })
      ).ok,
    ).toBe(true);
    expect(
      f.current.store.db
        .prepare(
          "SELECT duration,webcam,uid FROM enrollments WHERE exam='roster' AND username='learner01'",
        )
        .get(),
    ).toEqual({ duration: 7200, webcam: 0, uid: 29999 });
    const inherited = await root("students.import-preview", {
      exam: "roster",
      text: "username,require_webcam,duration_minutes\nlearner01,inherit,\n",
    });
    expect(
      (
        await root("students.import-confirm", {
          exam: "roster",
          id: inherited.result.id,
        })
      ).ok,
    ).toBe(true);
    expect(
      f.current.store.db
        .prepare(
          "SELECT duration,webcam,uid FROM enrollments WHERE exam='roster' AND username='learner01'",
        )
        .get(),
    ).toEqual({ duration: null, webcam: null, uid: 29999 });
    const stale = await root("students.import-preview", {
      exam: "roster",
      text: "username,require_webcam\nlearner01,true\n",
    });
    await root("students.settings", {
      exam: "roster",
      usernames: ["learner01"],
      duration: 3600,
    });
    expect(
      (
        await root("students.import-confirm", {
          exam: "roster",
          id: stale.result.id,
        })
      ).error,
    ).toContain("changed since preview");
    const failedBatch = await root("students.settings", {
      exam: "roster",
      usernames: ["learner01", "absent"],
      duration: 1800,
    });
    expect(failedBatch.ok).toBe(false);
    expect(
      f.current.store.db
        .prepare(
          "SELECT duration FROM enrollments WHERE exam='roster' AND username='learner01'",
        )
        .get(),
    ).toEqual({ duration: 3600 });
    expect(
      (
        await root("students.settings", {
          exam: "roster",
          usernames: ["learner01", "learner01"],
          webcam: true,
        })
      ).error,
    ).toContain("Duplicate");
    expect(
      (
        await root("students.add", {
          exam: "sandbox",
          username: "learner03",
          duration: 600,
        })
      ).error,
    ).toContain("five minutes");
    const secretLike =
      "SensitiveInputThatMustNotBeEchoedBeyondThirtyTwoCharacters";
    const badID = randomUUID();
    const rejected = await root(
      "students.import-preview",
      { exam: "roster", mode: "lines", text: secretLike },
      badID,
    );
    expect(rejected.error).toContain("Line 1: invalid username");
    expect(rejected.error).not.toContain(secretLike);
    expect(
      f.current.store.db
        .prepare(
          "SELECT outcome FROM agent_management_requests WHERE request=?",
        )
        .get(badID),
    ).toEqual({ outcome: expect.not.stringContaining(secretLike) });
    const page = await root("students.list", { exam: "roster", limit: 1 });
    expect(page.result.next).toBe("learner01");
    const next = await root("students.list", {
      exam: "roster",
      after: page.result.next,
    });
    expect(next.result.students.map((s: any) => s.username)).toEqual([
      "learner02",
    ]);
    expect(
      (
        await root("students.remove", {
          exam: "roster",
          username: "learner02",
          confirm: true,
        })
      ).ok,
    ).toBe(true);
    expect(f.current.store.attempt("active-roster")).toEqual(snapshot);
    expect(parser).toHaveBeenCalled();
  } finally {
    parser.mockRestore();
    await f.close();
  }
});
