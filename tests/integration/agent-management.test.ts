import { expect, it, vi } from "vitest";
import * as rosterParser from "../../apps/server/src/roster.js";
import { qualifyClockCLI } from "../fixtures/management-clocks.js";
import { qualifyInterruptionCLI } from "../fixtures/management-interruptions.js";
import { qualifyMonitoringCLI } from "../fixtures/management-monitoring.js";
import { qualifyTemplateCLI } from "../fixtures/management-templates.js";
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
import https from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { createApp } from "../../apps/server/src/app.js";
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
  let current = await createApp(config);
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
      });
      let corruptCatalog: string | null = null;
      let corruptImage: string | null = null;
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
                  (corruptCatalog || corruptImage) &&
                  req.url === "/api/agent/management"
                ) {
                  const frame = JSON.parse(raw.toString());
                  const payload = JSON.parse(
                    Buffer.from(frame.payload, "base64").toString(),
                  );
                  let changed = false;
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
      f.current.store.db
        .prepare("INSERT INTO exams VALUES(?,?)")
        .run("midterm", JSON.stringify({ id: "midterm", name: "Original" }));
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
        .run(JSON.stringify({ id: "midterm", name: "Changed" }));
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
      const creation = [
        "create",
        "cli-exam",
        "--name",
        "CLI exam",
        "--template",
        "v1",
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
      f.config.agent.managementOperations = [...managementOperations];
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
      await qualifyClockCLI(f, invoke);
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
      f.config.agent.managementOperations = [];
      await expect(cli(["show", "midterm"])).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining("managementOperations"),
      });
      expect(existsSync(f.dir + "/unused-native-state")).toBe(false);
      expect(
        f.current.store.db.prepare("SELECT count(*) n FROM attempts").get(),
      ).toEqual({ n: 4 });
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
    const exam = {
      id: "roster",
      name: "Roster",
      template: "v1",
      earliest: Date.now() - 1000,
      latest: Date.now() + 3600000,
      duration: 5400,
      webcam: true,
      terminals: 4,
    };
    expect((await root("exams.create", { exam })).ok).toBe(true);
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
    f.current.store.db
      .prepare(
        "INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline,access_state) VALUES('active-roster','roster','learner01',29999,'ACTIVE',?,100,200,200,'HELD')",
      )
      .run(JSON.stringify(exam));
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
