import { expect, it } from "vitest";
import {
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign,
} from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { promisify } from "node:util";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { hash } from "../../apps/server/src/db.js";
import { AttemptGrants } from "../../apps/server/src/attempt-grants.js";
import { grantExam } from "../fixtures/grant-exam.js";
import { browserGatewayProcess } from "../fixtures/browser-gateway-process.js";

const run = promisify(execFile);

// Actual gateway restart, challenged JPEG ingestion, signed agent HTTP, native
// signature verification AND live authority acceptance. The native initial seal
// and native clock are synthetic: this does not qualify kernel freeze/thaw.
it("a restarted gateway renews only overlapping live native coverage, preserving ages and refusing expired authority", async () => {
  const data = mkdtempSync(tmpdir() + "/monitoring-restart-authority-"),
    origin = "http://localhost:3000",
    keys = generateKeyPairSync("ed25519"),
    binary = data + "/native-authority.test";
  writeFileSync(
    data + "/agent.pub",
    keys.publicKey.export({ format: "pem", type: "spki" }),
  );
  writeFileSync(
    data + "/gateway.key",
    keys.privateKey.export({ format: "pem", type: "pkcs8" }),
    { mode: 0o600 },
  );
  const config = {
    mode: "development" as const,
    origin,
    data,
    port: 0,
    maintenance: false,
    jump: { host: "localhost", port: 2222, pins: ["0".repeat(64)] },
    class: { host: "localhost", port: 2223, pins: ["1".repeat(64)] },
    agent: {
      id: "class",
      signingKey: data + "/gateway.key",
      callbackPublicKey: data + "/agent.pub",
    },
  };
  const gateway = browserGatewayProcess(
    config,
    new URL("../fixtures/faulting-connection-worker.ts", import.meta.url),
  );
  try {
    await gateway.initialized;
    const id = randomUUID(),
      page = randomUUID(),
      start = Date.now() - 1000,
      deadline = start + 5400000,
      owner = {
        attempt: id,
        exam: "restart",
        username: "synthetic",
        uid: 10001,
        transport_hash: "a".repeat(64),
        boot: "77777777-1234-4234-8234-123456789abc",
        page_epoch: hash(page),
        input_epoch: "b".repeat(64),
        generation: 0,
        clock_revision: 0,
      },
      { store } = gateway,
      grants = new AttemptGrants(store, "class");
    grantExam(store, "restart");
    const grant = store.db.transaction(() => {
      const issued = grants.initial(
        "restart",
        "synthetic",
        null,
        false,
        "synthetic-fixture",
      );
      if (!issued) throw Error("Initial synthetic grant unavailable");
      store.db
        .prepare(
          "INSERT INTO enrollments(exam,username,uid,webcam) VALUES('restart','synthetic',10001,0)",
        )
        .run();
      grants.claim(issued.id, id, 10001);
      store.db
        .prepare(
          "INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline,page_hash,monitoring_mode,registered_owner,grant_id,grant_revision,grant_hash,grant_issued_order) VALUES(?,'restart','synthetic',10001,'ACTIVE',?,?,?,?,?,'v1',?,?,?,?,?)",
        )
        .run(
          id,
          JSON.stringify(issued.settings),
          start,
          deadline,
          deadline,
          hash(page),
          JSON.stringify(owner),
          issued.id,
          issued.revision,
          issued.hash,
          issued.issuance_order,
        );
      return issued;
    })();
    const intent = grants.begin(
      store.attempt(id),
      owner.transport_hash,
      owner.page_epoch,
    );
    grants.accept(
      {
        ...store.attempt(id),
        settings: grant.settings,
        grant: grants.binding(grant),
        grant_begin_intent: intent,
        registered_owner: owner,
        boot: owner.boot,
        browser_ssh: true,
        terminal_supervised: true,
      },
      store.attempt(id),
    );
    const original = store.attempt(id),
      session = store.session("student", "synthetic", "restart"),
      headers = {
        origin,
        cookie: `session=${session.token}`,
        "x-csrf-token": session.csrf,
        "x-page-instance": page,
      },
      jpeg = await sharp({
        create: { width: 40, height: 30, channels: 3, background: "white" },
      })
        .jpeg()
        .toBuffer();
    let sequence = 0;
    const capture = async () => {
      const ticket = await gateway.app.inject({
        method: "POST",
        url: `/api/student/attempts/${id}/capture-challenges`,
        headers,
        payload: { source: "screen" },
      });
      expect(ticket.statusCode, ticket.body).toBe(200);
      const upload = await gateway.app.inject({
        method: "POST",
        url: `/api/student/attempts/${id}/frames/challenged`,
        headers,
        payload: {
          source: "screen",
          seq: ++sequence,
          captured: Date.now(),
          monotonic: sequence,
          challenge: ticket.json().challenge,
          data: jpeg.toString("base64"),
          readiness: {
            fullscreen: true,
            visible: true,
            keyboard: true,
            screen: true,
            webcam: false,
            focus: true,
          },
        },
      });
      expect(upload.statusCode, upload.body).toBe(200);
    };
    const evidence = async (body: unknown) => {
      const payload = Buffer.from(JSON.stringify(body));
      return gateway.app.inject({
        method: "POST",
        url: "/api/agent/monitoring-evidence",
        headers: {
          "content-type": "application/vnd.ssh-exam-event",
          "x-exam-signature": sign(null, payload, keys.privateKey).toString(
            "base64",
          ),
        },
        payload,
      });
    };
    const decode = (response: any) =>
      JSON.parse(Buffer.from(response.json().payload, "base64").toString());
    await run("go", ["test", "-c", "-o", binary, "./internal/core"], {
      cwd: "ssh-server",
      env: process.env,
      timeout: 30000,
      maxBuffer: 65536,
    });
    await capture();
    await capture();
    await capture();
    const initial = await evidence({
      type: "monitoring-execution-challenge-v1",
      agent: "class",
      nonce: randomBytes(32).toString("hex"),
      owner,
      after_sequence: 0,
      coverage_epoch: "",
    });
    expect(initial.statusCode, initial.body).toBe(200);
    const prior = decode(initial);
    expect(prior.sequence).toBeGreaterThan(1);
    const previous = gateway.pid;
    await gateway.restart();
    expect(gateway.pid).not.toBe(previous);
    const challenge = {
      type: "monitoring-execution-challenge-v1",
      agent: "class",
      nonce: randomBytes(32).toString("hex"),
      owner,
      after_sequence: prior.sequence,
      coverage_epoch: prior.coverage_epoch,
    };
    const empty = await evidence(challenge);
    expect(empty.statusCode).toBe(409); // Disk identity cannot reconstruct facts.
    await capture();

    for (const [index, nativeNow] of [3000, 7000, 12000].entries()) {
      const vector = data + `/authority-${index}.json`,
        jwk = keys.publicKey.export({ format: "jwk" });
      writeFileSync(
        vector,
        JSON.stringify({
          public: Buffer.from(jwk.x!, "base64url").toString("base64"),
          context: {
            Agent: "class",
            PolicyReports: "v1",
            Owner: owner,
            Sequence: prior.sequence,
            CoverageEpoch: prior.coverage_epoch,
            AuthorityUntilMS: 12000,
            DeadlineUptimeMS: 90000,
          },
          now: 2000,
        }),
        { mode: 0o600 },
      );
      const child = spawn(
          binary,
          ["-test.run=^TestMonitoringAuthorityHTTPInteropHelper$"],
          {
            env: { ...process.env, EXAM_MONITORING_AUTHORITY_VECTOR: vector },
            stdio: ["pipe", "pipe", "pipe"],
          },
        ),
        lines = createInterface({ input: child.stdout }),
        queue: any[] = [];
      let pending:
          | { resolve: (value: any) => void; reject: (error: Error) => void }
          | undefined,
        stderr = "",
        exited = false;
      child.stderr.on("data", (chunk) => {
        stderr = (stderr + chunk).slice(-4096);
      });
      lines.on("line", (line) => {
        if (!line.startsWith("{")) return;
        const value = JSON.parse(line);
        if (pending) {
          const p = pending;
          pending = undefined;
          p.resolve(value);
        } else queue.push(value);
      });
      const lifetime = setTimeout(() => child.kill("SIGKILL"), 15000);
      const closed = new Promise<number | null>((resolve) =>
        child.once("close", (code) => {
          exited = true;
          pending?.reject(Error("Native authority exited: " + stderr));
          pending = undefined;
          resolve(code);
        }),
      );
      const next = () => {
        if (queue.length) return Promise.resolve(queue.shift());
        if (exited)
          return Promise.reject(
            Error("Native authority already exited: " + stderr),
          );
        return new Promise<any>((resolve, reject) => {
          const timer = setTimeout(() => {
            pending = undefined;
            reject(
              Error("Native authority protocol boundary timed out: " + stderr),
            );
          }, 5000);
          pending = {
            resolve: (value) => {
              clearTimeout(timer);
              resolve(value);
            },
            reject: (error) => {
              clearTimeout(timer);
              reject(error);
            },
          };
        });
      };
      try {
        const issued = (await next()).challenge;
        expect(issued).toMatchObject({
          owner,
          after_sequence: prior.sequence,
          coverage_epoch: prior.coverage_epoch,
        });
        const response = await evidence(issued);
        expect(response.statusCode, response.body).toBe(200);
        const facts = decode(response);
        expect(facts).toMatchObject({
          coverage_epoch: prior.coverage_epoch,
          age_ms: expect.any(Number),
        });
        expect(facts.age_ms).toBeGreaterThanOrEqual(0);
        expect(facts.age_ms).toBeLessThan(5000);
        expect(facts.sequence).toBeGreaterThan(prior.sequence);
        await capture(); // New facts cannot refresh the old nonce's receipt.
        expect(decode(await evidence(issued))).toEqual(facts); // Exact retry, original age.
        child.stdin.end(
          JSON.stringify({ frame: response.json(), now: nativeNow }),
        );
        const result = await next();
        expect(result.accepted).toBe(index === 0);
        expect(result.view).toMatchObject({
          DeadlineUptimeMS: 90000,
          CoverageEpoch: prior.coverage_epoch,
          AuthorityUntilMS: index === 0 ? 17000 - facts.age_ms : 12000,
          ExecutionAuthorized: index < 2,
        });
        expect(await closed).toBe(0);
      } finally {
        if (!exited) child.kill("SIGKILL");
        await closed;
        clearTimeout(lifetime);
        lines.close();
      }
    }
    expect(gateway.store.attempt(id)).toMatchObject({
      id,
      start: original.start,
      deadline: original.deadline,
      original_deadline: original.original_deadline,
      grant_id: original.grant_id,
      generation: original.generation,
      clock_revision: original.clock_revision,
      registered_owner: original.registered_owner,
      state: "ACTIVE",
    });
  } finally {
    await gateway.app.close();
    rmSync(data, { recursive: true, force: true });
  }
}, 60000);
