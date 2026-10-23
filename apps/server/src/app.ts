import type { Writable } from "node:stream";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import staticPlugin from "@fastify/static";
import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import argon2 from "argon2";
import { mailTransport } from "./mail.js";
import { signInAlertContext } from "./alerts.js";
import {
  AlertManagement,
  alertPage,
  alertReminder,
} from "./alert-management.js";
import { collectionSettings } from "../../../packages/protocol/collection-limits.js";
import {
  recoveryAllowanceReply,
  recoveryPreflight,
} from "../../../packages/protocol/recovery-allowance.js";
import { z } from "zod";
import {
  examSchema,
  readySchema,
  readinessMessage,
  messageSchema,
  authMessage,
} from "../../../packages/protocol/index.js";
import {
  productionReadinessIssues,
  type Config,
} from "../../../packages/config/index.js";
import { Store, hash, secret, now, type Attempt } from "./db.js";
import { Agent } from "./agent.js";
import { RecoverySources } from "./recovery-source.js";
import { AttemptGrants } from "./attempt-grants.js";
import { GrantIssuance } from "./grant-issuance.js";
import { grantBinding } from "../../../packages/protocol/grants.js";
import type { ConnectionHandle as Connection } from "./connection-process.js";
import {
  IsolatedConnection,
  IsolatedBrowserConnection as BrowserConnection,
} from "./connection-process.js";
import { wipeAuthPacket } from "./login-password.js";
import { Monitoring } from "./monitoring.js";
import { MonitoringMedia, MonitoringMediaError } from "./monitoring-media.js";
import {
  MonitoringPurgeJobs,
  monitoringPurgeStatus,
} from "./monitoring-purge-jobs.js";
import { MonitoringManagement } from "./monitoring-management.js";
import {
  monitoringList,
  monitoringShow,
  monitoringPurges,
} from "../../../packages/protocol/monitoring-management.js";
import { ClockControl } from "./clock-control.js";
import { InterruptionManagement } from "./interruption-management.js";
import { studentContinuationStatus } from "./continuation-status.js";
import { assertClockCapabilities } from "./clock-management.js";
import { registerExamAdmin } from "./exam-admin.js";
import { registerTemplateAdmin } from "./template-admin.js";
import { registerAgentManagement } from "./agent-management.js";
import { ExamDefinitions } from "./exam-definitions.js";
import { AdministratorManagement } from "./administrator-management.js";
import { reportFocus } from "./focus-grace.js";
import { Lifecycle } from "./lifecycle.js";
import { RosterManagement } from "./roster-management.js";
import {
  isSandbox,
  sandboxExam,
  hasSandboxWindow,
} from "../../../packages/protocol/sandbox.js";
import {
  PREFLIGHT_TIMEOUT_MS,
  PREFLIGHT_EXPIRED_REASON,
  preflightExpired,
} from "../../../packages/protocol/preflight.js";
export async function createApp(
  config: Config,
  options: {
    logStream?: Writable;
    connectionWorkerEntry?: URL;
    purgeWorkerEntry?: URL;
    purgeTimeoutMs?: number;
    onConnection?: (connection: IsolatedConnection) => void;
  } = {},
) {
  if (
    (options.purgeWorkerEntry || options.purgeTimeoutMs !== undefined) &&
    config.mode !== "development"
  )
    throw Error("Purge worker test overrides require development mode");
  if (config.loginOnly && config.mode !== "development")
    throw Error("Login-only testing requires development mode");
  if (config.functionalTest && config.mode !== "development")
    throw Error("Privileged functional testing requires development mode");
  const app = Fastify({
    logger: {
      level: "info",
      ...(options.logStream ? { stream: options.logStream } : {}),
      redact: [
        "req.headers.cookie",
        "req.headers.authorization",
        "req.body",
        "res.headers.set-cookie",
      ],
    },
    bodyLimit: 12 * 1024 * 1024,
    trustProxy: "127.0.0.1",
  });
  await app.register(cookie);
  await app.register(rateLimit, {
    max: 180,
    timeWindow: "1 minute",
    keyGenerator: (req) => {
      const token = req.cookies.session;
      const session = token
        ? (store.db
            .prepare(
              "SELECT role,username FROM sessions WHERE token=? AND expires>?",
            )
            .get(hash(token), now()) as any)
        : null;
      return session ? session.role + ":" + session.username : req.ip;
    },
  });
  const store = new Store(config.data),
    agent = new Agent(config.agent, store),
    monitoring = new Monitoring(store, config.terminalRecordingLimitMiB),
    life = new Lifecycle(store, agent, monitoring);
  const media = new MonitoringMedia(store);
  const purges = new MonitoringPurgeJobs(store, {
    entry: options.purgeWorkerEntry,
    timeoutMs: options.purgeTimeoutMs,
    onFailure: (code) =>
      app.log.warn(
        { event: "monitoring-purge-incomplete", code },
        "Monitoring physical purge unverified; deletion remains in force and durable retry is scheduled",
      ),
  });
  life.onPreflightFailure = (details) =>
    app.log.warn(details, "Preflight cleanup failed");
  const clocks = new ClockControl(store, agent, life);
  const monitoringManagement = new MonitoringManagement(
    store,
    monitoring,
    media,
  );
  const interruptionManagement = new InterruptionManagement(store);
  const alertManagement = new AlertManagement(store, () => !!config.smtp);
  const administratorManagement = new AdministratorManagement(store);
  const authAttempts = new Map<string, { at: number; count: number }>();
  store.db
    .prepare("INSERT OR IGNORE INTO exams VALUES(?,?)")
    .run("sandbox", JSON.stringify(sandboxExam()));
  const requireBeginWindow = (
    exam: string,
    settings: { earliest: number; latest: number },
  ) => {
    if (isSandbox(exam) && !hasSandboxWindow(settings))
      throw Error(
        "Sandbox practice needs an operator-configured finite Begin window. Ask your instructor to configure Exam settings; an old unstarted preparation must be cancelled and recreated, not silently revised.",
      );
    const at = now();
    if (at < settings.earliest || at > settings.latest)
      throw Error(
        "Outside allowed start window; a window controls Begin, not an existing attempt's deadline.",
      );
  };
  const requireSandboxAgent = (exam: string, h: any) => {
    if (
      isSandbox(exam) &&
      !h.capabilities?.includes("sandbox-begin-window-v1") &&
      !(config.mode === "development" && h.fixture)
    )
      throw Error(
        "Class server lacks finite sandbox Begin-window enforcement; ask the operator to verify matching native roles before new practice. No exam clock has started.",
      );
  };
  const requireTemplateAgent = (settings: any, h: any) => {
    if (
      settings.template_version &&
      ![
        "immutable-template-versions-v1",
        "exact-template-begin-v1",
        "private-workspace-staging",
      ].every((cap) => h.capabilities?.includes(cap))
    )
      throw Error(
        "Class server lacks exact-template Begin enforcement; ask the operator to verify matching native roles. No new Begin was requested by this check; preserve the preparation and inspect its status.",
      );
  };
  const requireTemplateSnapshot = (
    settings: any,
    remote: any,
    expected: { id: string; username: string; uid: number },
  ) => {
    if (
      settings.template_version &&
      (!remote ||
        remote.id !== expected.id ||
        remote.username !== expected.username ||
        remote.uid !== expected.uid ||
        remote.settings?.template !== settings.template ||
        remote.settings?.template_version !== settings.template_version)
    )
      throw Error(
        "Class server did not retain the selected exact template; no new Begin requested by this check. Preserve the preparation and inspect its saved settings; never substitute a mutable source.",
      );
  };
  const autoAuthorizeSandbox = async (id: string, gap = false) => {
    let a = store.attempt(id);
    if (!isSandbox(a.exam)) return;
    if (a.state === "ACTIVE") {
      await life.lock(id, "Sandbox reconnection");
      a = store.attempt(id);
    }
    if (a.state !== "LOCKED" || !a.deadline || a.deadline <= now()) return;
    const grant = store.db
      .prepare("SELECT * FROM continuations WHERE attempt=?")
      .get(id) as any;
    if (
      !grant ||
      grant.consumed ||
      grant.generation !== a.generation ||
      grant.expires <= now()
    ) {
      const expires = Math.min(a.deadline, now() + 300000);
      store.db.transaction(() => {
        store.db
          .prepare("INSERT OR REPLACE INTO continuations VALUES(?,?,?,0)")
          .run(id, a.generation, expires);
        store.interruptions.authorize(a, "sandbox", expires, true);
        store.audit("sandbox", "automatic-continuation", id);
      })();
    }
    if (gap) store.audit(a.username, "authorized-authentication-gap", id);
  };
  const connections = new Map<string, Connection>();
  const attemptConnections = new Map<string, Connection>();
  const pending = new Map<
    string,
    {
      created: number;
      connection?: Connection;
      username?: string;
      exam?: string;
      done?: boolean;
    }
  >();
  const sockets = new Map<string, WebSocket>();
  const sessionTasks = new Set<Promise<void>>();
  let closingSessions = false;
  life.onEnd = (a) => {
    const ws = sockets.get(a.id);
    if (ws) send(ws, { type: "state", attempt: a, serverNow: now() });
    if (a.state === "CANCELLED_BEFORE_START") life.onSecured(a);
  };
  life.onClockChanged = life.onEnd;
  // Do not deliver PTY hangup/signals before the agent has secured its frozen file view.
  life.onSecured = (a) => {
    const connection = attemptConnections.get(a.id);
    if (connection) {
      connection.onLoss = () => {};
      connection.close();
      if (connections.get(`${a.exam}:${a.username}`) === connection)
        connections.delete(`${a.exam}:${a.username}`);
    }
    attemptConnections.delete(a.id);
  };
  life.onPaused = (a) => {
    const c = attemptConnections.get(a.id);
    if (c) {
      c.onLoss = () => {};
      c.close();
      if (connections.get(`${a.exam}:${a.username}`) === c)
        connections.delete(`${a.exam}:${a.username}`);
      attemptConnections.delete(a.id);
    }
    const ws = sockets.get(a.id);
    if (ws)
      send(ws, {
        type: "state",
        attempt: a,
        serverNow: now(),
        authenticationGap: true,
      });
  };
  const busy = new Set<string>();
  const leases = new Set<string>();
  const principal = (req: any, role?: string) => {
    const token = req.cookies.session;
    const s = token
      ? (store.db
          .prepare("SELECT * FROM sessions WHERE token=? AND expires>?")
          .get(hash(token), now()) as any)
      : null;
    if (!s || (role && s.role !== role))
      throw Object.assign(Error("Authentication required"), {
        statusCode: 401,
      });
    return s;
  };
  const studentAttempt = (req: any) => {
    const s = principal(req, "student");
    const a = store.attempt(req.params.id);
    if (a.username !== s.username || a.exam !== s.exam)
      throw Object.assign(Error("Forbidden"), { statusCode: 403 });
    return a;
  };
  const page = (req: any, a: Attempt) => {
    if (
      !req.headers["x-page-instance"] ||
      hash(String(req.headers["x-page-instance"])) !== a.page_hash
    )
      throw Object.assign(Error("Current page required"), { statusCode: 403 });
  };
  const requirePreflightTime = async (a: Attempt) => {
    if (!preflightExpired(a, now())) return;
    await life.cancelPreflight(a.id, PREFLIGHT_EXPIRED_REASON).catch(() => {});
    throw Error(PREFLIGHT_EXPIRED_REASON);
  };
  const authenticationGap = (id: string) => {
    const a = store.attempt(id);
    if (
      ["PREPARING", "LOCKED"].includes(a.state) &&
      !connections.get(`${a.exam}:${a.username}`)?.alive
    )
      return true;
    const last = store.db
      .prepare(
        "SELECT action FROM audit WHERE target=? AND action IN ('reauthentication-required','authorized-authentication-gap','authentication-gap-ended') ORDER BY rowid DESC LIMIT 1",
      )
      .get(id) as any;
    return !!last && last.action !== "authentication-gap-ended";
  };
  const healthy = (a: Attempt) => {
    const settings = JSON.parse(a.settings);
    for (const source of settings.webcam ? ["screen", "webcam"] : ["screen"]) {
      const f = store.db
        .prepare(
          "SELECT received FROM frames WHERE attempt=? AND source=? AND page_hash=? ORDER BY received DESC LIMIT 1",
        )
        .get(a.id, source, a.page_hash) as any;
      if (!f || now() - f.received > 15000) return false;
    }
    return true;
  };
  const send = (ws: WebSocket, data: any) => {
    if (ws.readyState === WebSocket.OPEN) {
      if (ws.bufferedAmount > 1024 * 1024) {
        ws.close(1013, "Slow client");
        return;
      }
      ws.send(JSON.stringify({ v: 1, ...data }));
    }
  };
  const setSession = (reply: any, s: { token: string; csrf: string }) => {
    reply.setCookie("session", s.token, {
      httpOnly: true,
      secure: config.mode === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 28800,
    });
    return { csrf: s.csrf };
  };
  app.addHook("onRequest", async (req, reply) => {
    reply
      .header("Cache-Control", "no-store")
      .header("X-Content-Type-Options", "nosniff")
      .header(
        "Content-Security-Policy",
        `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self' ${config.browserSSH ? new URL(config.browserSSH.relay).origin : ""}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`,
      );
    if (
      config.loginOnly &&
      ((req.url.startsWith("/api/student/") &&
        req.url !== "/api/student/exam") ||
        (req.url.startsWith("/api/admin/") &&
          !["/api/admin/login", "/api/admin/logout"].includes(req.url)))
    )
      throw Error("Exam operations are unavailable during login-only testing.");
    if (req.url.startsWith("/api/agent/submissions/"))
      throw Object.assign(
        Error(
          "Archive transfers are disabled; submissions remain on the SSH server",
        ),
        { statusCode: 410 },
      );
    if (req.url.startsWith("/api/agent/")) return; // Each callback verifies the pinned agent signature.
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      if (req.headers.origin !== config.origin)
        throw Object.assign(Error("Origin rejected"), { statusCode: 403 });
      if (
        req.url.startsWith("/api/") &&
        !["/api/auth/start", "/api/auth/complete", "/api/admin/login"].includes(
          req.url,
        )
      ) {
        const s = principal(req);
        if (req.headers["x-csrf-token"] !== s.csrf)
          throw Object.assign(Error("CSRF check failed"), { statusCode: 403 });
      }
    }
  });
  app.setErrorHandler((error, req, reply) => {
    const err = error as Error & { statusCode?: number };
    const status = err.statusCode || 400;
    reply.code(status).send({
      error:
        status >= 500
          ? error instanceof MonitoringMediaError
            ? error.message
            : "Operation failed; consult operator diagnostics"
          : err.message,
    });
  });
  registerAgentManagement(
    app,
    store,
    agent,
    config,
    (a) => describeAttempt(a),
    clocks,
    monitoringManagement,
    administratorManagement,
  );
  app.addContentTypeParser(
    "application/vnd.ssh-exam-event",
    { parseAs: "buffer" },
    (_req, body, done) => done(null, body),
  );
  app.addContentTypeParser(
    "application/gzip",
    { parseAs: "buffer" },
    (_req, body, done) => done(null, body),
  );
  app.post(
    "/api/agent/grant-begin",
    { config: { rateLimit: false } },
    async (req) => {
      const payload = req.body as Buffer;
      if (!Buffer.isBuffer(payload))
        throw Error("Raw signed grant Begin verification required");
      agent.verifyCallback(
        payload,
        String(req.headers["x-exam-signature"] || ""),
      );
      return agent.signTiming(
        grants.verifyBegin(JSON.parse(payload.toString())),
      );
    },
  );
  app.post(
    "/api/agent/timing",
    { config: { rateLimit: false } },
    async (req) => {
      const payload = req.body as Buffer;
      if (!Buffer.isBuffer(payload))
        throw Error("Raw signed timing request required");
      agent.verifyCallback(
        payload,
        String(req.headers["x-exam-signature"] || ""),
      );
      const request = z
        .object({
          agent: z.literal(config.agent.id),
          nonce: z.string().regex(/^[a-f0-9]{64}$/),
          at: z.number().int(),
          attempt: z
            .object({
              id: z.string().uuid(),
              deadline: z.number().int(),
              clock_revision: z.number().int().optional(),
            })
            .passthrough(),
        })
        .parse(JSON.parse(payload.toString()));
      if (Math.abs(now() - request.at) > 30000)
        throw Error("Stale timing request");
      life.acceptRemote(request.attempt);
      const a = store.attempt(request.attempt.id);
      if (
        a.deadline !== request.attempt.deadline ||
        a.clock_revision !== (request.attempt.clock_revision || 0)
      )
        throw Error("Timing snapshot mismatch");
      const reset = clocks.pending(a.id);
      return agent.signTiming({
        type: "deadline-timing",
        audience: config.agent.id,
        id: a.id,
        nonce: request.nonce,
        expires: now() + 30000,
        deadline: a.deadline,
        clock_revision: a.clock_revision,
        collect: !reset && !!a.deadline && now() >= a.deadline,
        ...(reset ? { reset } : {}),
      });
    },
  );
  app.post(
    "/api/agent/events",
    { config: { rateLimit: false } },
    async (req) => {
      const payload = req.body as Buffer;
      if (!Buffer.isBuffer(payload))
        throw Error("Raw signed callback required");
      agent.verifyCallback(
        payload,
        String(req.headers["x-exam-signature"] || ""),
      );
      const event = JSON.parse(payload.toString());
      if (
        event.agent !== config.agent.id ||
        !Number.isSafeInteger(event.sequence) ||
        event.sequence < 1
      )
        throw Error("Callback scope rejected");
      const digest = hash(payload);
      store.db.transaction(() => {
        const prior = store.db
          .prepare(
            "SELECT digest FROM agent_events WHERE agent=? AND sequence=?",
          )
          .get(event.agent, event.sequence) as any;
        if (prior) {
          if (prior.digest !== digest)
            throw Error("Conflicting callback replay");
          return;
        }
        if (event.health) {
          if (
            typeof event.health.ready !== "boolean" ||
            !event.accounts ||
            Object.values(event.accounts).some(
              (uid: any) => !Number.isSafeInteger(uid) || uid < 1000,
            )
          )
            throw Error("Invalid agent registry");
          store.db
            .prepare(
              "INSERT INTO agent_snapshot VALUES(?,?,?) ON CONFLICT(agent) DO UPDATE SET sequence=excluded.sequence,payload=excluded.payload WHERE excluded.sequence>agent_snapshot.sequence",
            )
            .run(event.agent, event.sequence, JSON.stringify(event));
        }
        if (event.attempt) {
          const remote = event.attempt;
          const a = store.db
            .prepare("SELECT id FROM attempts WHERE id=?")
            .get(remote.id);
          const prior = store.db
            .prepare(
              "SELECT sequence FROM agent_attempt_sequence WHERE attempt=?",
            )
            .get(remote.id) as any;
          if (a && (!prior || event.sequence > prior.sequence)) {
            life.acceptRemote(remote, event.manifest);
            store.db
              .prepare(
                "INSERT INTO agent_attempt_sequence VALUES(?,?) ON CONFLICT(attempt) DO UPDATE SET sequence=excluded.sequence",
              )
              .run(remote.id, event.sequence);
          } else if (!a)
            store.audit("class-agent", "unknown-attempt-status", remote.id);
        }
        store.db
          .prepare("INSERT INTO agent_events VALUES(?,?,?)")
          .run(event.agent, event.sequence, digest);
      })();
      return { ok: true };
    },
  );
  app.post(
    "/api/agent/recordings",
    { bodyLimit: 512 * 1024, config: { rateLimit: false } },
    async (req) => {
      const payload = req.body as Buffer;
      if (!Buffer.isBuffer(payload))
        throw Error("Raw recording callback required");
      agent.verifyCallback(
        payload,
        String(req.headers["x-exam-signature"] || ""),
      );
      const b = z
        .object({
          agent: z.literal(config.agent.id),
          attempt: z.string().uuid(),
          pane: z.string().uuid(),
          offset: z.number().int().min(0),
          data: z.string().max(512 * 1024),
        })
        .parse(JSON.parse(payload.toString()));
      const a = store.attempt(b.attempt);
      if (!a.start) throw Error("Recording before exam start rejected");
      monitoring.receiveRecording(
        b.attempt,
        b.pane,
        b.offset,
        Buffer.from(b.data, "base64"),
      );
      return { ok: true };
    },
  );
  app.get("/health/live", async () => ({ ok: true }));
  app.get("/api/login-test", async () => ({
    maintenance: config.maintenance,
    loginOnly: !!config.loginOnly,
    functionalTest: !!config.functionalTest,
    browserSSH: !!config.browserSSH,
    ...(config.loginOnly
      ? { jump: config.jump.host, class: config.class.host }
      : {}),
  }));
  app.get("/health/ready", async (_req, reply) => {
    const issues = productionReadinessIssues(config);
    if (config.maintenance || issues.length) {
      reply.code(503);
      return {
        ready: false,
        maintenance: config.maintenance,
        mode: config.mode,
        productionReady: false,
        reason: config.maintenance
          ? "Exam starts paused for maintenance"
          : issues.join("; "),
      };
    }
    if (config.loginOnly)
      return {
        ready: true,
        mode: "development",
        loginOnly: true,
        examReady: false,
      };
    try {
      const h = await agent.call("health");
      const ready =
        !!h.ready &&
        (!h.functional_test || !!config.functionalTest) &&
        (config.mode !== "production" ||
          (!h.functional_test &&
            h.production_ready !== false &&
            [
              "interval-access-hold",
              "all-session-channel-gate",
              "signed-ssh-control",
              "durable-status-callbacks",
              "server-only-submissions",
              "clock-reset",
              "deadline-timing-check",
              "private-workspace-staging",
              "collection-limits-v1",
            ].every((cap) => h.capabilities?.includes(cap))));
      if (!ready) reply.code(503);
      return {
        ready,
        maintenance: config.maintenance,
        notifications: !!config.smtp,
        mode: config.mode,
        functionalTest: !!h.functional_test,
        productionReady:
          !h.functional_test && h.production_ready !== false && ready,
      };
    } catch {
      reply.code(503);
      return {
        ready: false,
        reason: "Class agent configuration has not been reported",
      };
    }
  });
  app.get("/api/session", async (req) => {
    const s = principal(req);
    return { role: s.role, username: s.username, exam: s.exam, csrf: s.csrf };
  });
  app.post(
    "/api/auth/start",
    { config: { rateLimit: { max: 300, timeWindow: "1 minute" } } },
    async (_req, reply) => {
      const id = secret();
      pending.set(hash(id), { created: now() });
      reply.setCookie("dialogue", id, {
        httpOnly: true,
        secure: config.mode === "production",
        sameSite: "strict",
        path: "/",
        maxAge: 600,
      });
      return { ok: true };
    },
  );
  app.post("/api/auth/complete", async (req, reply) => {
    const p = pending.get(hash(req.cookies.dialogue || ""));
    if (!p?.done || !p.username || !p.exam || !p.connection)
      throw Error("SSH authentication incomplete");
    if (config.loginOnly) {
      p.connection.close();
      pending.delete(hash(req.cookies.dialogue || ""));
      reply.clearCookie("dialogue", { path: "/" });
      return setSession(reply, store.session("student", p.username, p.exam));
    }
    const old = connections.get(`${p.exam}:${p.username}`);
    if (old && old !== p.connection) old.close();
    connections.set(`${p.exam}:${p.username}`, p.connection);
    const active = store.db
      .prepare(
        "SELECT id,state FROM attempts WHERE username=? AND state IN ('ACTIVE','LOCKED')",
      )
      .get(p.username) as any;
    if (active && (active.state === "ACTIVE" || !authenticationGap(active.id)))
      await life.lock(active.id, "Second authenticated page attempted access");
    pending.delete(hash(req.cookies.dialogue || ""));
    reply.clearCookie("dialogue", { path: "/" });
    return setSession(reply, store.session("student", p.username, p.exam));
  });
  app.post(
    "/api/admin/login",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const b = z
        .object({
          username: z.string().max(64),
          password: z.string().max(1024),
        })
        .parse(req.body);
      const admin = store.db
        .prepare("SELECT * FROM admins WHERE username=?")
        .get(b.username) as any;
      if (!admin || !(await argon2.verify(admin.hash, b.password)))
        throw Object.assign(Error("Invalid credentials"), { statusCode: 401 });
      b.password = "";
      store.audit(admin.username, "login", "admin");
      return setSession(reply, store.session("admin", admin.username, null));
    },
  );
  app.post(
    "/api/admin/administrators",
    {
      bodyLimit: 8192,
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      const actor = principal(req, "admin");
      try {
        const result = await administratorManagement.browserCreate(
          req.body,
          actor.username,
          () => {
            principal(req, "admin");
          },
        );
        reply.code(201);
        return result;
      } finally {
        if (req.body && typeof req.body === "object")
          (req.body as any).password = "";
      }
    },
  );
  const logout = async (req: any, reply: any) => {
    const s = principal(req);
    if (s.role === "student") {
      const attempts = store.db
        .prepare(
          "SELECT * FROM attempts WHERE exam=? AND username=? AND state IN ('PREPARING','ACTIVE','LOCKED')",
        )
        .all(s.exam, s.username) as Attempt[];
      for (const a of attempts) {
        if (a.state === "PREPARING")
          await life
            .cancelPreflight(a.id, "Signed out before starting")
            .catch(() => {});
        // Activation may have committed while cancellation was in flight.
        if (["ACTIVE", "LOCKED"].includes(store.attempt(a.id).state))
          await life.lock(
            a.id,
            "Student signed out; instructor review required",
          );
        sockets.get(a.id)?.close(1008, "Signed out");
        sockets.delete(a.id);
      }
      connections.get(`${s.exam}:${s.username}`)?.close();
      connections.delete(`${s.exam}:${s.username}`);
    }
    store.db
      .prepare("DELETE FROM sessions WHERE token=?")
      .run(hash(req.cookies.session!));
    reply.clearCookie("session", { path: "/" });
    store.audit(s.username, "logout", s.role);
    return { ok: true };
  };
  app.post("/api/logout", logout);
  app.post("/api/admin/logout", logout);
  app.get("/api/student/exam", async (req) => {
    const s = principal(req, "student");
    if (config.loginOnly)
      return {
        loginOnly: true,
        jump: config.jump.host,
        class: config.class.host,
      };
    const exam = store.db
      .prepare("SELECT config FROM exams WHERE id=?")
      .get(s.exam) as any;
    const row = store.db
      .prepare(
        "SELECT exam,username,webcam,duration,uid FROM enrollments WHERE exam=? AND username=?",
      )
      .get(s.exam, s.username) as any;
    if (!exam || !row) throw Error("Enrollment not found");
    const latest = store.db
      .prepare(
        "SELECT * FROM attempts WHERE exam=? AND username=? ORDER BY rowid DESC LIMIT 1",
      )
      .get(s.exam, s.username) as Attempt | undefined;
    const availableGrants = grants.available(s.exam!, s.username);
    const selectedID = z
      .object({ grant: z.string().uuid().optional() })
      .strict()
      .parse(req.query).grant;
    const selectedGrant = selectedID
      ? grants.select(s.exam!, s.username, selectedID)
      : availableGrants.length === 1
        ? availableGrants[0]
        : null;
    const repeat =
      (isSandbox(s.exam) || availableGrants.length > 0) &&
      latest?.state === "COMPLETED" &&
      latest.protected &&
      ["RELEASED", "OVERRIDDEN"].includes(latest.access_state);
    const practiceGrant = isSandbox(s.exam)
      ? grants.lastPracticeFor(s.username)
      : null;
    const initialGrant = isSandbox(s.exam)
      ? practiceGrant?.status === "CONSUMED"
        ? null
        : practiceGrant
      : grants.initialFor(s.exam!, s.username);
    const settings =
      latest && !repeat && latest.state !== "CANCELLED_BEFORE_START"
        ? JSON.parse(latest.settings)
        : (selectedGrant?.settings ??
          initialGrant?.settings ?? {
            ...JSON.parse(exam.config),
            duration: row.duration ?? JSON.parse(exam.config).duration,
            webcam:
              row.webcam === null
                ? JSON.parse(exam.config).webcam
                : !!row.webcam,
          });
    return {
      exam: JSON.parse(exam.config),
      settings,
      enrollment: row,
      sshConnected: !!connections.get(`${s.exam}:${s.username}`)?.alive,
      attempt: repeat ? null : latest || null,
      grants: availableGrants,
      selected_grant: selectedGrant?.id ?? null,
      practice_blocked:
        isSandbox(s.exam) &&
        !availableGrants.length &&
        initialGrant &&
        initialGrant.status !== "CONSUMED"
          ? {
              id: initialGrant.id,
              status: initialGrant.status,
              message:
                "Your unused practice grant is expired or revoked. Ask your instructor to inspect and explicitly revise it or authorize NEW practice; changing defaults does not replace this grant.",
            }
          : null,
      previous_attempt:
        repeat && latest
          ? {
              id: latest.id,
              state: latest.state,
              start: latest.start,
              deadline: latest.deadline,
              protected: latest.protected,
            }
          : null,
    };
  });
  app.post("/api/student/preflight", async (req) => {
    if (config.maintenance)
      throw Error("Exam starts are paused for maintenance.");
    if (productionReadinessIssues(config).length)
      throw Error("Production exam setup is awaiting operator verification.");
    const s = principal(req, "student");
    const conn = connections.get(`${s.exam}:${s.username}`);
    if (!conn?.alive) throw Error("Authenticate SSH first");
    const chosenGrant = z
      .object({ grant: z.string().uuid().optional() })
      .strict()
      .parse(req.body ?? {}).grant;
    const exam = JSON.parse(
      (
        store.db
          .prepare("SELECT config FROM exams WHERE id=?")
          .get(s.exam) as any
      ).config,
    );
    const enrollment = store.db
      .prepare(
        "SELECT exam,username,webcam,duration,uid FROM enrollments WHERE exam=? AND username=?",
      )
      .get(s.exam, s.username) as any;
    if (!enrollment) throw Error("Enrollment unavailable");
    if (!Number.isSafeInteger(enrollment.uid) || enrollment.uid < 1000)
      throw Error(
        "Sign in through SSH again to verify your course-server identity.",
      );
    const h = await conn.command("health");
    if (
      config.browserSSH &&
      ![
        "browser-ssh-receipts",
        "agent-terminal-recording",
        "signed-pane-close",
      ].every((cap) => h.capabilities?.includes(cap)) &&
      !h.fixture
    )
      throw Error(
        "Class server lacks trusted browser SSH monitoring; update the agent first.",
      );
    if (!h.ready) throw Error("Class server guards not ready");
    requireSandboxAgent(s.exam, h);
    if (
      isSandbox(s.exam) &&
      ![
        "unified-sandbox-grants-v1",
        "verified-preflight-cancellation-v1",
        "ordered-template-grants-v1",
        "sandbox-begin-window-v1",
        "immutable-template-versions-v1",
        "exact-template-begin-v1",
        "private-workspace-staging",
      ].every((cap) => h.capabilities?.includes(cap))
    )
      throw Error(
        "Class server lacks saved practice grant admission and fresh Begin verification; verify matching native roles before preflight. No grant, account or clock reserved.",
      );
    if (
      h.functional_test &&
      (!config.functionalTest || config.mode !== "development")
    )
      throw Error(
        "Trusted functional-test agent cannot run a production or ordinary student exam.",
      );
    if (
      config.mode === "production" &&
      ![
        "interval-access-hold",
        "all-session-channel-gate",
        "signed-ssh-control",
        "durable-status-callbacks",
        "server-only-submissions",
        "clock-reset",
        "deadline-timing-check",
        "private-workspace-staging",
        "collection-limits-v1",
      ].every((cap) => h.capabilities?.includes(cap))
    )
      throw Error(
        "Class server lacks original-deadline account isolation; update and verify the agent before running exams.",
      );
    let previous = store.db
      .prepare(
        "SELECT * FROM attempts WHERE exam=? AND username=? ORDER BY rowid DESC LIMIT 1",
      )
      .get(s.exam, s.username) as Attempt | undefined;
    if (previous?.state === "PREPARING") {
      if (preflightExpired(previous, now()))
        await life.cancelPreflight(previous.id, PREFLIGHT_EXPIRED_REASON);
      await life.reconcile(previous.id).catch(() => {});
      previous = store.attempt(previous.id);
    }
    if (previous?.state === "CANCELLED_BEFORE_START") {
      await life.retirePreflight(previous.id);
      previous = undefined;
    }
    if (previous && isSandbox(s.exam) && previous.state === "COMPLETED") {
      await life.reconcile(previous.id);
      previous = store.attempt(previous.id);
      if (
        previous.protected &&
        ["RELEASED", "OVERRIDDEN"].includes(previous.access_state)
      )
        previous = undefined;
    }
    if (isSandbox(s.exam)) {
      if (previous?.state === "PREPARING" && !previous.grant_id)
        throw Error(
          "This legacy unstarted practice retains its old snapshot. Sign out to positively cancel it, then reopen preflight for a NEW saved practice grant; no old clock is reopened.",
        );
      if (!previous && !chosenGrant) grants.practice(s.username);
    }
    const choices = grants.available(s.exam!, s.username);
    let initialGrant =
      previous?.state === "PREPARING"
        ? previous.grant_id
          ? grants.select(s.exam!, s.username, previous.grant_id)
          : null
        : chosenGrant
          ? grants.select(s.exam!, s.username, chosenGrant)
          : choices.length === 1
            ? choices[0]
            : null;
    if (
      previous?.state === "PREPARING" &&
      chosenGrant &&
      chosenGrant !== previous.grant_id
    )
      throw Error(
        "An existing preparation retains its original grant; positively cancel it before selecting another allowance",
      );
    if (!previous && !initialGrant && choices.length > 1)
      throw Error(
        "Choose the exact grant on your waiting page before opening preflight; no account or allowance reserved",
      );
    if (
      !previous &&
      !initialGrant &&
      store.db
        .prepare(
          "SELECT 1 FROM attempt_grants WHERE agent=? AND exam=? AND username=?",
        )
        .get(config.agent.id, s.exam, s.username)
    )
      throw Error(
        "No unused grant has an available finite Begin window. Ask your instructor to inspect examctl web grants list; existing consumption and history are preserved.",
      );
    if (previous?.state === "COMPLETED" && initialGrant) {
      await life.reconcile(previous.id);
      previous = store.attempt(previous.id);
      if (
        !previous.protected ||
        !["RELEASED", "OVERRIDDEN"].includes(previous.access_state)
      )
        throw Error(
          "Previous protected submission/access release is not confirmed; the additional grant cannot bypass its original restrictions",
        );
      previous = undefined;
    }
    if (previous && previous.state !== "PREPARING")
      throw Error("An attempt already exists; instructor review required");
    const id = previous?.id || randomUUID(),
      pageSecret = secret();
    if (initialGrant && !h.capabilities?.includes("ordered-template-grants-v1"))
      throw Error(
        "Class server lacks ordered grant authority/type support; verify matching native roles before preflight. No grant or clock consumed.",
      );
    if (
      initialGrant &&
      !h.capabilities?.includes("verified-preflight-cancellation-v1")
    )
      throw Error(
        "Class server lacks verified grant cancellation/cleanup receipts; verify matching native roles before preflight. No claim or clock consumed.",
      );
    if (
      initialGrant &&
      grants.binding(initialGrant).work &&
      !h.capabilities?.includes("independent-workspace-grants-v1")
    )
      throw Error(
        "Class server lacks independent grant workspace enforcement; verify matching native roles before preflight. No account, grant or clock consumed.",
      );
    if (initialGrant && !h.capabilities?.includes("unified-initial-grants-v1"))
      throw Error(
        "Class server requires matching grant-aware preparation and fresh outbound Begin verification; no grant or clock consumed. Inspect examctl web grants show GRANT and update matching roles.",
      );
    if (
      initialGrant?.issuance === "REVIEWED_NEW" &&
      !h.capabilities?.includes("reviewed-initial-grants-v1")
    )
      throw Error(
        "Class server lacks reviewed-initial native history fences; update matching roles before this NEW grant can prepare. No clock or grant consumed.",
      );
    const settings = previous
      ? JSON.parse(previous.settings)
      : initialGrant
        ? { ...initialGrant.settings }
        : {
            ...exam,
            ...collectionSettings(exam),
            duration: enrollment.duration ?? exam.duration,
            webcam:
              enrollment.webcam === null ? exam.webcam : !!enrollment.webcam,
          };
    const allowanceEdit = new RosterManagement(store).allowanceEdit(
      s.exam!,
      s.username,
    );
    const recoverySources = new RecoverySources(store, config.agent.id);
    const knownRecovery = recoverySources.known(s.exam!, s.username);
    let recovery = previous?.recovery_preflight
      ? recoveryPreflight.parse(JSON.parse(previous.recovery_preflight))
      : null;
    if (
      !initialGrant &&
      !isSandbox(s.exam) &&
      (allowanceEdit || recovery || knownRecovery) &&
      !h.capabilities?.includes("recovery-allowance-sync-v1")
    )
      throw Error(
        "Class server lacks recovery allowance synchronization; update matching native roles before retrying. No grant or clock was consumed.",
      );
    if (
      !initialGrant &&
      !isSandbox(s.exam) &&
      !recovery &&
      h.capabilities?.includes("recovery-allowance-sync-v1")
    ) {
      const result = recoveryAllowanceReply.parse(
        await conn.command("reconcile-recovery-allowance", {
          id,
          exam: s.exam,
          username: s.username,
          uid: enrollment.uid,
          transport: conn.transport,
          ...(allowanceEdit ? { allowance_edit: allowanceEdit } : {}),
        }),
      );
      if (result.recovery) {
        const value = result.recovery;
        if (
          value.exam !== s.exam ||
          value.username !== s.username ||
          value.uid !== enrollment.uid
        )
          throw Error(
            "Class server recovery source identity reply differs from the authenticated enrollment",
          );
        recoverySources.remember(value);
      } else if (knownRecovery) {
        throw Error(
          "Expected saved-work recovery grant is missing. Preserve the retained source/archive and restore matching native authorization before retrying; starter-file fallback is forbidden.",
        );
      }
      const currentEnrollment = store.db
        .prepare(
          "SELECT exam,username,webcam,duration,uid FROM enrollments WHERE exam=? AND username=?",
        )
        .get(s.exam, s.username);
      const currentEdit = new RosterManagement(store).allowanceEdit(
        s.exam!,
        s.username,
      );
      if (
        JSON.stringify(currentEnrollment) !== JSON.stringify(enrollment) ||
        JSON.stringify(currentEdit) !== JSON.stringify(allowanceEdit) ||
        connections.get(`${s.exam}:${s.username}`) !== conn ||
        !conn.alive
      )
        throw Error(
          "Enrollment, allowance or SSH ownership changed during recovery checks; retry preflight. No clock has started.",
        );
      recovery = result.recovery;
      if (recovery) {
        if (
          recovery.exam !== s.exam ||
          recovery.username !== s.username ||
          recovery.uid !== enrollment.uid ||
          (allowanceEdit && recovery.duration !== allowanceEdit.duration)
        )
          throw Error(
            "Class server recovery allowance/identity reply differs from the explicit setting; preserve grant/source and inspect matching roles before retrying",
          );
        if (
          !allowanceEdit &&
          enrollment.duration !== null &&
          enrollment.duration !== recovery.duration
        )
          throw Error(
            "Enrollment and unused recovery grant allowances differ. Explicitly save the intended student allowance in web admin or examctl web students settings, then retry preflight; no clock has started.",
          );
        if (previous && settings.duration !== recovery.duration)
          throw Error(
            "The allowance changed after this web preparation. Sign out to confirm cancellation, then retry a fresh preflight; the saved preparation and clock were not changed.",
          );
        settings.duration = recovery.duration;
      }
    }
    if (
      recovery &&
      allowanceEdit &&
      allowanceEdit.duration !== settings.duration
    )
      throw Error(
        "Allowance edit is pending: this preparation keeps its saved allowance. Sign out and confirm cancellation before a fresh preflight; prepared grants are not revised.",
      );
    if (isSandbox(s.exam)) {
      const {
        collection_file_mib: _file,
        collection_total_mib: _total,
        ...policy
      } = sandboxExam(settings.template, settings);
      // Preserve even legacy preparation limit snapshots and template choice.
      Object.assign(settings, policy);
      requireBeginWindow(s.exam, settings);
    }
    requireTemplateAgent(settings, h);
    store.db.transaction(() => {
      if (initialGrant) {
        const current = grants.claim(initialGrant.id, id, enrollment.uid);
        if (
          current.hash !== initialGrant.hash ||
          current.revision !== initialGrant.revision
        )
          throw Error(
            "Grant revised during preflight; reload the saved settings and choose again. No allowance consumed.",
          );
      }
      if (!previous)
        store.db
          .prepare(
            "INSERT INTO attempts(id,exam,username,uid,state,settings,page_hash,last_contact,preflight_started_at,recovery_preflight,grant_id,grant_revision,grant_hash,grant_kind,grant_issued_order,grant_initial,grant_work) VALUES(?,?,?,?,'PREPARING',?,?,?,?,?,?,?,?,?,?,?,?)",
          )
          .run(
            id,
            s.exam,
            s.username,
            enrollment.uid,
            JSON.stringify(settings),
            hash(pageSecret),
            now(),
            now(),
            recovery ? JSON.stringify(recovery) : null,
            initialGrant?.id ?? null,
            initialGrant?.revision ?? null,
            initialGrant?.hash ?? null,
            initialGrant ? (grants.binding(initialGrant).kind ?? null) : null,
            initialGrant?.issuance_order ?? null,
            initialGrant?.initial_grant ?? null,
            initialGrant && grants.binding(initialGrant).work
              ? JSON.stringify(initialGrant.work)
              : null,
          );
      else
        store.db
          .prepare(
            "UPDATE attempts SET page_hash=?,last_contact=?,recovery_preflight=? WHERE id=?",
          )
          .run(
            hash(pageSecret),
            now(),
            recovery ? JSON.stringify(recovery) : null,
            id,
          );
    })();
    attemptConnections.set(id, conn);
    const expectedGrant = initialGrant ? grants.binding(initialGrant) : null;
    const prepared = await agent.call(
      expectedGrant
        ? expectedGrant.kind === "PRACTICE"
          ? "prepare-practice-grant-attempt"
          : expectedGrant.kind === "ADDITIONAL"
            ? "prepare-additional-grant-attempt"
            : "prepare-grant-attempt"
        : recovery
          ? "prepare-recovery-attempt"
          : "prepare-attempt",
      {
        id,
        exam: s.exam,
        username: s.username,
        uid: enrollment.uid,
        settings,
        transport: conn.transport,
        browser_ssh: conn instanceof BrowserConnection,
        ...(recovery ? { expected_recovery: recovery.grant_hash } : {}),
        ...(expectedGrant ? { grant: expectedGrant } : {}),
      },
    );
    if (prepared.state && prepared.state !== "PREPARING") {
      life.acceptRemote(prepared, undefined, id);
      throw Error(
        prepared.state === "CANCELLED_BEFORE_START"
          ? PREFLIGHT_EXPIRED_REASON
          : "Preparation status changed; check the current attempt before continuing.",
      );
    }
    const expectedPreparation = {
      id,
      username: s.username,
      uid: enrollment.uid,
    };
    requireTemplateSnapshot(settings, prepared, expectedPreparation);
    if (
      expectedGrant &&
      JSON.stringify(grantBinding.parse(prepared.grant)) !==
        JSON.stringify(expectedGrant)
    )
      throw Error(
        "Native preparation did not retain its exact grant binding; no Begin authorized",
      );
    if (recovery && prepared.expected_recovery !== recovery.grant_hash)
      throw Error(
        "Class server did not retain the exact saved-work grant binding; preserve source and use matching recovery-aware roles before retrying",
      );
    store.db
      .prepare("UPDATE attempts SET work_path=?,functional_test=? WHERE id=?")
      .run(prepared.work_path || "/work", prepared.functional_test ? 1 : 0, id);
    // Large copies/verifications belong to isolated native preflight workers,
    // never Begin. A lost/failed staging reply consumes neither time nor grant;
    // preflight retry adopts its durable, attempt/source-bound private receipt.
    if (h.capabilities?.includes("private-workspace-staging")) {
      const staged = await conn.command("prepare-workspace", { id });
      if (staged.state !== "PREPARING" || !staged.workspace) {
        life.acceptRemote(staged, undefined, id);
        throw Error(
          "Workspace preparation changed; check status before beginning.",
        );
      }
      requireTemplateSnapshot(settings, staged, expectedPreparation);
      if (
        expectedGrant &&
        JSON.stringify(grantBinding.parse(staged.grant)) !==
          JSON.stringify(expectedGrant)
      )
        throw Error(
          "Native staged workspace lost its exact grant binding; no Begin authorized",
        );
      if (recovery && staged.expected_recovery !== recovery.grant_hash)
        throw Error(
          "Staged recovery lost its exact grant binding; no Begin is authorized; preserve saved work and inspect matching native roles",
        );
      if (expectedGrant?.work) grants.accept(staged, store.attempt(id));
    }
    return {
      id,
      page: pageSecret,
      settings,
      work_path: prepared.work_path || "/work",
      functionalTest: !!h.functional_test,
      administratorSandbox: !!prepared.administrator_sandbox,
      username: s.username,
      notice:
        "Preflight images retained with this attempt if started; abandoned preflight images are deleted.",
    };
  });
  app.post("/api/student/attempts/:id/practice", async (req) => {
    const a = studentAttempt(req);
    page(req, a);
    await requirePreflightTime(a);
    if (a.state !== "PREPARING") throw Error("Practice only before starting");
    const conn = connections.get(`${a.exam}:${a.username}`)!;
    for (const c of conn.panes.values()) await c.close();
    const pane = randomUUID();
    const c = await conn.open(a.id, pane, "practice");
    c.on("data", () => {});
    c.resume();
    return { pane };
  });
  app.post("/api/student/attempts/:id/begin", async (req) => {
    let a = studentAttempt(req);
    page(req, a);
    await requirePreflightTime(a);
    const readiness = readinessMessage(
      req.body,
      JSON.parse(a.settings).webcam,
      "starting the exam",
    );
    if (readiness) throw Error(readiness);
    if (a.state !== "PREPARING") return { attempt: a };
    if (
      !store.db
        .prepare("SELECT 1 FROM enrollments WHERE exam=? AND username=?")
        .get(a.exam, a.username)
    )
      throw Error("Enrollment removed; this attempt cannot begin");
    if (config.maintenance) throw Error("Maintenance prevents new starts");
    if (productionReadinessIssues(config).length)
      throw Error("Production exam setup is awaiting operator verification.");
    const settings = JSON.parse(a.settings);
    requireBeginWindow(a.exam, settings);
    if ((settings.webcam && !(req.body as any).webcam) || !healthy(a))
      throw Error("Current required images missing");
    const conn = connections.get(`${a.exam}:${a.username}`);
    if (!conn?.alive) throw Error("SSH transports lost");
    if (busy.has(a.id) || life.isBusy(a.id))
      throw Error("Preparation is changing; check status before starting.");
    busy.add(a.id);
    try {
      if (isSandbox(a.exam))
        requireSandboxAgent(a.exam, await conn.command("health"));
      const prepared = await conn.command("inspect-attempt", { id: a.id });
      if (
        a.recovery_preflight &&
        prepared.expected_recovery !==
          recoveryPreflight.parse(JSON.parse(a.recovery_preflight)).grant_hash
      )
        throw Error(
          "Saved-work grant binding is unavailable or changed; preserve the preparation/source and inspect matching recovery-aware native roles before Begin",
        );
      if (
        prepared.account_policy_required &&
        prepared.policy_transport !== conn.transport
      ) {
        if (!conn.supportsAutomaticHandoff)
          throw Error(
            "Automatic exam setup requires browser SSH. Your exam clock has not started.",
          );
        const h = await conn.command("health");
        if (!h.fixture && !h.capabilities?.includes("single-sign-in-handoff"))
          throw Error(
            "Class server requires the single-sign-in update before starting.",
          );
        for (const c of conn.panes.values()) await c.close();
        conn.panes.clear();
        const secured = await conn.command("prepare-account-policy", {
          id: a.id,
        });
        life.syncAccess(a.id, secured);
        await conn.secureAccess(a.id, a.exam);
        if (!conn.alive || !healthy(store.attempt(a.id)))
          throw Error(
            "Connection or required monitoring changed during setup. Your exam clock has not started.",
          );
      }
      for (const c of conn.panes.values()) await c.close();
      conn.panes.clear();
      // Account handoff/pane closure may outlive this page or preparation.
      // Never let the old page's asynchronous Begin start its replacement.
      a = store.attempt(a.id);
      page(req, a);
      await requirePreflightTime(a);
      if (
        a.state !== "PREPARING" ||
        connections.get(`${a.exam}:${a.username}`) !== conn ||
        !conn.alive ||
        !healthy(a)
      )
        throw Error(
          "Preparation, connection or monitoring changed during setup; inspect status before beginning. No new clock was requested.",
        );
      requireBeginWindow(a.exam, JSON.parse(a.settings));
      const currentSettings = JSON.parse(a.settings);
      if (currentSettings.template_version) {
        requireTemplateAgent(currentSettings, await conn.command("health"));
        requireTemplateSnapshot(
          currentSettings,
          await conn.command("inspect-attempt", { id: a.id }),
          { id: a.id, username: a.username, uid: a.uid },
        );
      }
      // Those source checks await SSH. Recheck actual current page/settings/
      // connection/window immediately before dispatch, not their old copies.
      const checkedSettings = a.settings;
      const currentPreparation = store.attempt(a.id);
      if (!currentPreparation)
        throw Error(
          "Preparation retired during Begin checks; no new Begin requested; inspect current status",
        );
      a = currentPreparation;
      page(req, a);
      if (
        a.state !== "PREPARING" ||
        a.settings !== checkedSettings ||
        preflightExpired(a, now()) ||
        connections.get(`${a.exam}:${a.username}`) !== conn ||
        !conn.alive ||
        !healthy(a)
      )
        throw Error(
          "Preparation or required monitoring changed during Begin checks; no new Begin requested; inspect current status",
        );
      requireBeginWindow(a.exam, JSON.parse(a.settings));
      const recovery = a.recovery_preflight
        ? recoveryPreflight.parse(JSON.parse(a.recovery_preflight))
        : null;
      const initialGrant = a.grant_id ? grants.bindingForAttempt(a) : null;
      const beginIntent = initialGrant
        ? grants.begin(
            a,
            conn.transport,
            conn instanceof BrowserConnection && a.uid >= 1000
              ? (a.page_hash ?? undefined)
              : undefined,
          )
        : null;
      const result = await agent.call(
        initialGrant
          ? initialGrant.kind === "PRACTICE"
            ? "activate-practice-grant-attempt"
            : initialGrant.kind === "ADDITIONAL"
              ? "activate-additional-grant-attempt"
              : "activate-grant-attempt"
          : recovery
            ? "activate-recovery-attempt"
            : currentSettings.template_version
              ? "activate-versioned-attempt"
              : "activate-attempt",
        {
          id: a.id,
          ...(initialGrant || recovery || currentSettings.template_version
            ? { settings: currentSettings }
            : {}),
          ...(recovery ? { expected_recovery: recovery.grant_hash } : {}),
          ...(initialGrant
            ? { grant: initialGrant, grant_begin_intent: beginIntent }
            : {}),
        },
      );
      if (result.state !== "ACTIVE") {
        const manifest = result.protected
          ? await conn.command("submission-manifest", { id: a.id })
          : undefined;
        life.acceptRemote(result, manifest, a.id);
        return { attempt: store.attempt(a.id), serverNow: now() };
      }
      life.syncAccess(a.id, result);
      store.db.transaction(() => {
        grants.accept(result, store.attempt(a.id));
        store.db
          .prepare(
            "UPDATE attempts SET state='ACTIVE',start=?,deadline=?,original_deadline=?,work_path=?,last_contact=? WHERE id=? AND state='PREPARING'",
          )
          .run(
            result.start,
            result.deadline,
            result.original_deadline || result.deadline,
            result.work_path,
            now(),
            a.id,
          );
      })();
      return { attempt: store.attempt(a.id), serverNow: now() };
    } catch (e) {
      const reason = (e as Error).message.slice(0, 500);
      store.audit("gateway", "activation-failed", a.id, reason);
      app.log.warn(
        { attempt: a.id, exam: a.exam, username: a.username, reason },
        "Exam activation failed",
      );
      await life.reconcile(a.id).catch(() => {});
      throw Error(
        "Exam setup could not be confirmed. Check the current attempt status before retrying; your instructor can review the recorded failure.",
      );
    } finally {
      busy.delete(a.id);
    }
  });
  app.get("/api/student/attempts/:id/status", async (req) => {
    return store.db.transaction(() => {
      const a = studentAttempt(req),
        at = now();
      const authorization = store.db
        .prepare(
          "SELECT generation,expires,consumed FROM continuations WHERE attempt=?",
        )
        .get(a.id) as
        | { generation: number; expires: number; consumed: number }
        | undefined;
      return {
        attempt: a,
        serverNow: at,
        authenticationGap: authenticationGap(a.id),
        authorization: authorization || null,
        continuation: studentContinuationStatus(store, a, authorization, at),
      };
    })();
  });
  app.post(
    "/api/student/attempts/:id/frames",
    { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } },
    async (req) => {
      const a = studentAttempt(req);
      page(req, a);
      if (authenticationGap(a.id))
        throw Error("Capture suspended for authorized authentication gap");
      return monitoring.frame(a, req.body, a.page_hash!);
    },
  );
  app.post(
    "/api/student/attempts/:id/review-request",
    { config: { rateLimit: { max: 2, timeWindow: "1 minute" } } },
    async (req) => {
      const a = studentAttempt(req);
      if (a.state !== "LOCKED") throw Error("Attempt is not locked");
      const message = z
        .object({ message: z.string().max(1000) })
        .parse(req.body).message;
      store.db.transaction(() => {
        store.db
          .prepare(
            "UPDATE incidents SET message=?,review_at=? WHERE attempt=? AND generation=?",
          )
          .run(message, now(), a.id, a.generation);
        store.audit(
          a.username,
          "review-request",
          a.id,
          JSON.stringify({ generation: a.generation, message }),
        );
        // Each distinct trimmed message notifies once per interruption. Requests
        // remain auditable; no automatic reminders or continued-work permission.
        life.notifyAttempt(
          a,
          `review-request:${hash(message.trim())}`,
          `Review requested: ${a.username}`,
          `Student message: ${JSON.stringify(message)}\nClock continues. Open the authenticated dashboard.`,
          message.trim(),
        );
      })();
      return { ok: true };
    },
  );
  app.post("/api/student/attempts/:id/recover-page", async (req) => {
    let a = studentAttempt(req);
    if (a.state === "ACTIVE") {
      await life.lock(a.id, "Page reloaded; fresh SSH authentication required");
      a = store.attempt(a.id);
    }
    if (a.state === "LOCKED") {
      // Reload cannot prove ownership of the previous page-instance secret.
      // Preserve any existing instructor grant for this locked generation.
      const old = sockets.get(a.id);
      sockets.delete(a.id);
      old?.close(1008, "Page reloaded");
      if (a.page_hash || !authenticationGap(a.id)) {
        store.db
          .prepare("UPDATE attempts SET page_hash=NULL WHERE id=?")
          .run(a.id);
        store.audit(
          "gateway",
          "reauthentication-required",
          a.id,
          "Page reloaded",
        );
        life.onPaused(store.attempt(a.id));
      }
    }
    return { attempt: store.attempt(a.id), serverNow: now() };
  });
  app.post("/api/student/attempts/:id/reauth", async (req, reply) => {
    let a = studentAttempt(req);
    await autoAuthorizeSandbox(a.id, true);
    a = store.attempt(a.id);
    const auth = store.db
      .prepare("SELECT * FROM continuations WHERE attempt=?")
      .get(a.id) as any;
    if (
      a.state !== "LOCKED" ||
      !auth ||
      auth.consumed ||
      auth.generation !== a.generation ||
      auth.expires <= now()
    )
      throw Error(
        "Instructor authorization required for an authentication gap",
      );
    connections.get(`${a.exam}:${a.username}`)?.close();
    store.db
      .prepare("DELETE FROM sessions WHERE token=?")
      .run(hash(req.cookies.session!));
    reply.clearCookie("session", { path: "/" });
    store.audit(a.username, "authorized-authentication-gap", a.id);
    return { ok: true };
  });
  app.post("/api/student/attempts/:id/claim", async (req) => {
    let a = studentAttempt(req);
    await autoAuthorizeSandbox(a.id);
    a = store.attempt(a.id);
    const auth = store.db
      .prepare("SELECT * FROM continuations WHERE attempt=?")
      .get(a.id) as any;
    if (
      a.state !== "LOCKED" ||
      !auth ||
      auth.consumed ||
      auth.generation !== a.generation ||
      auth.expires <= now()
    )
      throw Error("Instructor authorization required before replacing a page");
    const conn = connections.get(`${a.exam}:${a.username}`);
    if (!conn?.alive)
      throw Error(
        "Authenticate the same SSH account after instructor approval",
      );
    await conn.command("attach-transport", {
      id: a.id,
      username: a.username,
      transport: conn.transport,
      generation: a.generation,
    });
    attemptConnections.set(a.id, conn);
    await clocks.deliver(a.id);
    const pageSecret = secret();
    sockets.get(a.id)?.close(1008, "Authorized replacement page");
    sockets.delete(a.id);
    store.db
      .prepare("UPDATE attempts SET page_hash=? WHERE id=?")
      .run(hash(pageSecret), a.id);
    store.audit(a.username, "authorized-page-replacement", a.id);
    store.audit(a.username, "authentication-gap-ended", a.id);
    return {
      id: a.id,
      page: pageSecret,
      settings: JSON.parse(a.settings),
      attempt: store.attempt(a.id),
      panes: [...conn.panes.keys()],
    };
  });
  app.post("/api/student/attempts/:id/continue", async (req) => {
    const a = studentAttempt(req);
    page(req, a);
    if (
      !a.deadline ||
      a.deadline <= now() ||
      ["COMPLETED", "FINALIZING", "COLLECTION_FAILED"].includes(a.state)
    )
      throw Error("Your exam has ended. It can no longer be continued.");
    if (a.state !== "LOCKED")
      throw Error("Your exam is not waiting for continuation.");
    const readiness = readinessMessage(req.body, JSON.parse(a.settings).webcam);
    if (readiness) throw Error(readiness);
    await autoAuthorizeSandbox(a.id);
    const auth = store.db
      .prepare("SELECT * FROM continuations WHERE attempt=?")
      .get(a.id) as any;
    if (
      !auth ||
      auth.consumed ||
      auth.generation !== a.generation ||
      auth.expires <= now()
    )
      throw Error(
        "Instructor authorization is required. Request review and wait for approval before continuing.",
      );
    if (authenticationGap(a.id))
      throw Error("Reconnect SSH and restore your page before continuing");
    if (!healthy(a))
      throw Error(
        "Waiting for current screen or camera images. Keep sharing and try again in a few seconds.",
      );
    const conn = connections.get(`${a.exam}:${a.username}`);
    if (!conn?.alive)
      throw Error("Instructor-approved reauthentication required");
    if (JSON.parse(a.settings).webcam && !(req.body as any).webcam)
      throw Error("Camera required");
    try {
      await agent.call("consume-continuation", {
        id: a.id,
        generation: a.generation,
      });
    } catch (error) {
      await life.lock(
        a.id,
        "Continuation acknowledgment lost; instructor review required",
      );
      await life.reconcile(a.id).catch(() => {});
      throw error;
    }
    life.confirmContinuation(a.id, a.generation);
    return { attempt: store.attempt(a.id), serverNow: now() };
  });
  app.post("/api/student/attempts/:id/finish", async (req) => {
    const a = studentAttempt(req);
    await life.finish(a.id, "student finish");
    return { attempt: store.attempt(a.id), serverNow: now() };
  });
  app.get("/api/admin/exams", async (req) => {
    principal(req, "admin");
    const { lifecycle } = z
      .object({
        lifecycle: z.enum(["active", "archived", "all"]).default("active"),
      })
      .strict()
      .parse(req.query);
    return new ExamDefinitions(store, config.agent.id).all(lifecycle);
  });
  const saveExamDefinition = async (req: any) => {
    const s = principal(req, "admin");
    const body = z
      .object({
        revision: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
        reason: z.string().optional(),
        requestID: z.string().uuid().optional(),
      })
      .passthrough()
      .parse(req.body);
    const definitions = new ExamDefinitions(store, config.agent.id);
    const { requestID, ...intent } = body;
    const result = definitions.withRequest(s.username, requestID, intent, () =>
      body.revision
        ? definitions.update(
            String(body.id),
            Object.fromEntries(
              Object.entries(body).filter(
                ([key]) =>
                  ![
                    "id",
                    "revision",
                    "reason",
                    "requestID",
                    "lifecycle",
                  ].includes(key),
              ),
            ),
            body.revision,
            s.username,
            body.reason,
          )
        : definitions.create(body, s.username, body.reason),
    );
    return { ...result.exam, revision: result.revision };
  };
  app.post("/api/admin/exams", saveExamDefinition);
  // Older gateways strip unknown create fields. Their missing versioned route
  // must refuse BEFORE they could create an unintended mutable default.
  app.post("/api/admin/exams/versioned", async (req) => {
    principal(req, "admin");
    z.object({ template_version: z.string().regex(/^[a-f0-9]{64}$/) })
      .passthrough()
      .parse(req.body);
    return saveExamDefinition(req);
  });
  app.post("/api/admin/exams/:exam/retirement-preview", async (req: any) => {
    principal(req, "admin");
    return new ExamDefinitions(store, config.agent.id).retirementPreview(
      req.params.exam,
      req.body,
    );
  });
  app.post("/api/admin/exams/:exam/retire", async (req: any) => {
    const actor = principal(req, "admin");
    const { requestID, ...intent } = z
      .object({
        requestID: z.string().uuid(),
        action: z.enum(["delete", "archive", "unarchive"]),
        revision: z.string().regex(/^[a-f0-9]{64}$/),
        review: z.string().regex(/^[a-f0-9]{64}$/),
        reason: z.string().trim().min(8).max(1000),
      })
      .strict()
      .parse(req.body);
    return new ExamDefinitions(store, config.agent.id).retire(
      req.params.exam,
      intent,
      actor.username,
      requestID,
    );
  });
  const describeAttempt = (a: any) => {
    const conn = attemptConnections.get(a.id);
    const connected =
      !!conn?.alive &&
      sockets.get(a.id)?.readyState === WebSocket.OPEN &&
      now() - (a.last_contact || 0) <= 15000;
    return {
      ...a,
      pendingClockReset: clocks.pending(a.id),
      connected,
      working: a.state === "ACTIVE" && connected && a.deadline > now(),
      terminalCount: conn?.alive ? conn.panes.size : 0,
    };
  };
  registerExamAdmin(app, store, agent, clocks, principal, describeAttempt);
  registerTemplateAdmin(app, store, config.agent.id, principal);
  const roster = new RosterManagement(store, describeAttempt, config.agent.id);
  const grants = new AttemptGrants(store, config.agent.id);
  const grantIssuance = new GrantIssuance(store, config.agent.id);
  app.post("/api/admin/exams/:exam/grants/issue-preview", async (req: any) => {
    const actor = principal(req, "admin");
    return grantIssuance.preview(
      { ...req.body, exam: req.params.exam },
      actor.username,
    );
  });
  app.post(
    "/api/admin/exams/:exam/grants/additional-preview",
    async (req: any) => {
      const actor = principal(req, "admin");
      return grantIssuance.additional(
        { ...req.body, exam: req.params.exam },
        actor.username,
      );
    },
  );
  app.get("/api/admin/grant-issuance/:id", async (req: any) => {
    const actor = principal(req, "admin");
    return grantIssuance.show(req.params.id, actor.username);
  });
  app.post("/api/admin/grant-issuance/:id/:operation", async (req: any) => {
    const actor = principal(req, "admin");
    const operation = z.enum(["confirm", "cancel"]).parse(req.params.operation);
    return grantIssuance.change(
      req.params.id,
      req.body,
      actor.username,
      operation,
    );
  });
  app.get("/api/admin/exams/:exam/grants", async (req: any) => {
    principal(req, "admin");
    return grants.list({
      ...req.query,
      exam: req.params.exam,
      ...(req.query.limit ? { limit: Number(req.query.limit) } : {}),
    });
  });
  app.get("/api/admin/grants/:id", async (req: any) => {
    principal(req, "admin");
    return grants.show({
      id: req.params.id,
      ...(req.query.before ? { before: Number(req.query.before) } : {}),
    });
  });
  app.post("/api/admin/grants/:id/revise", async (req: any) => {
    const actor = principal(req, "admin");
    return grants.revise(req.params.id, req.body, actor.username);
  });
  app.post("/api/admin/grants/:id/revoke", async (req: any) => {
    const actor = principal(req, "admin");
    return grants.revoke(req.params.id, req.body, actor.username);
  });
  app.get("/api/admin/exams/:exam/roster", async (req: any) => {
    principal(req, "admin");
    return roster.list(req.params.exam);
  });
  app.post("/api/admin/exams/:exam/roster/add", async (req: any) => {
    const actor = principal(req, "admin");
    return roster.add(req.params.exam, req.body, actor.username);
  });
  app.post("/api/admin/exams/:exam/roster/remove", async (req: any) => {
    const actor = principal(req, "admin");
    return roster.remove(req.params.exam, req.body, actor.username);
  });
  app.post("/api/admin/exams/:exam/roster/import-preview", async (req: any) => {
    const actor = principal(req, "admin");
    return roster.preview(req.params.exam, req.body, actor.username);
  });
  app.post("/api/admin/exams/:exam/roster/import-confirm", async (req: any) => {
    const actor = principal(req, "admin");
    const { id } = z.object({ id: z.string().uuid() }).parse(req.body);
    return roster.confirm(req.params.exam, id, actor.username);
  });
  app.get("/api/admin/exams/:exam/roster/example", async (req: any, reply) => {
    principal(req, "admin");
    return reply
      .type("text/csv")
      .header(
        "Content-Disposition",
        'attachment; filename="example-roster.csv"',
      )
      .send(roster.example(req.params.exam));
  });
  app.get("/api/admin/exams/:exam/roster/export", async (req: any, reply) => {
    principal(req, "admin");
    return reply
      .type("text/csv")
      .header("Content-Disposition", 'attachment; filename="roster.csv"')
      .send(roster.export(req.params.exam));
  });
  app.get("/api/admin/attempts", async (req: any) => {
    principal(req, "admin");
    const { q = "", state = "", offset = "0", webcam = "" } = req.query;
    return {
      serverNow: now(),
      attempts: store.db
        .prepare(
          "SELECT * FROM attempts WHERE username LIKE ? AND (?='' OR state=?) AND (?='' OR json_extract(settings,'$.webcam')=?) ORDER BY state='ACTIVE' DESC,state='LOCKED' DESC,rowid DESC LIMIT 100 OFFSET ?",
        )
        .all(
          `%${String(q).slice(0, 32)}%`,
          state,
          state,
          webcam,
          Number(webcam),
          Math.max(0, Number(offset) || 0),
        )
        .map((a: any) => ({
          ...describeAttempt(a),
          latestFrames: store.db
            .prepare(
              "SELECT source,id,received,captured FROM frames WHERE attempt=? AND id IN (SELECT id FROM frames WHERE attempt=? GROUP BY source HAVING received=MAX(received))",
            )
            .all(a.id, a.id),
        })),
      incidents: store.db
        .prepare("SELECT * FROM incidents ORDER BY opened DESC LIMIT 100")
        .all(),
      outbox: store.db
        .prepare(
          "SELECT id,subject,status,tries FROM outbox ORDER BY rowid DESC LIMIT 30",
        )
        .all(),
    };
  });
  app.post("/api/admin/attempts/:id/reset-clock", async (req: any) => {
    const s = principal(req, "admin");
    const body = z
      .object({
        minutes: z.number().int().min(1).max(360),
        revision: z.number().int().min(0),
        requestID: z.string().uuid(),
      })
      .parse(req.body);
    const health = await agent.call("health");
    assertClockCapabilities(health, false);
    return clocks.reset(
      req.params.id,
      body.minutes,
      s.username,
      body.revision,
      body.requestID,
    );
  });
  app.post("/api/admin/attempts/:id/authorize", async (req: any) => {
    const s = principal(req, "admin");
    return interruptionManagement.authorize(
      { ...req.body, id: req.params.id },
      s.username,
    );
  });
  app.get("/api/admin/attempts/:id/interruption", async (req: any) => {
    principal(req, "admin");
    return interruptionManagement.show({ id: req.params.id });
  });
  app.post("/api/admin/attempts/:id/delete-monitoring", async (req: any) => {
    const s = principal(req, "admin");
    const result = monitoringManagement.delete(
      { ...req.body, id: req.params.id },
      s.username,
    );
    void purges.kick();
    return result;
  });
  app.get("/api/admin/attempts/:id/recordings", async (req: any) => {
    const s = principal(req, "admin");
    store.attempt(req.params.id);
    store.audit(s.username, "view-monitoring", req.params.id);
    const manifestPath = `${store.dir}/receipts/${req.params.id}.manifest.json`;
    const monitoringDeleted = !!store.db
      .prepare("SELECT 1 FROM tombstones WHERE attempt=?")
      .get(req.params.id);
    return {
      manifest: existsSync(manifestPath)
        ? JSON.parse(readFileSync(manifestPath, "utf8"))
        : null,
      monitoringDeleted,
      physicalPurge: monitoringPurgeStatus(store, req.params.id),
      deletionReview: monitoringManagement.deletionReview(req.params.id),
      frames: monitoringDeleted
        ? []
        : store.db
            .prepare(
              "SELECT * FROM frames WHERE attempt=? ORDER BY received DESC, id DESC LIMIT 10000",
            )
            .all(req.params.id)
            .reverse(),
      incidents: monitoringDeleted
        ? []
        : store.db
            .prepare(
              "SELECT * FROM incidents WHERE attempt=? ORDER BY opened DESC",
            )
            .all(req.params.id),
      terminals: monitoringDeleted
        ? []
        : store.db
            .prepare("SELECT * FROM recordings WHERE attempt=?")
            .all(req.params.id),
    };
  });
  app.get("/api/admin/attempts/:id/monitoring", async (req: any) => {
    const s = principal(req, "admin");
    const body = monitoringShow.parse({ id: req.params.id });
    const receipt = monitoringManagement.receipt("monitoring.show", body);
    return monitoringManagement.read(
      "monitoring.show",
      body,
      receipt,
      s.username,
    );
  });
  app.get("/api/admin/monitoring/purges", async (req: any) => {
    const s = principal(req, "admin");
    const query = z
      .object({
        limit: z
          .string()
          .regex(/^[1-9][0-9]*$/)
          .transform(Number)
          .optional(),
        after: z.string().optional(),
        status: z.string().optional(),
      })
      .strict()
      .parse(req.query);
    return monitoringManagement.purges(
      monitoringPurges.parse(query),
      s.username,
    );
  });
  app.get("/api/admin/monitoring/purges/:id", async (req: any) => {
    const s = principal(req, "admin");
    return monitoringManagement.purge({ id: req.params.id }, s.username);
  });
  app.get("/api/admin/attempts/:id/monitoring/entries", async (req: any) => {
    const s = principal(req, "admin");
    const integer = z
      .string()
      .regex(/^(0|[1-9][0-9]*)$/)
      .transform(Number);
    const query = z
      .object({
        section: z.enum(["frames", "terminals"]).optional(),
        limit: integer.optional(),
        after: integer.optional(),
        through: integer.optional(),
      })
      .strict()
      .parse(req.query);
    const body = monitoringList.parse({ ...query, id: req.params.id });
    const receipt = monitoringManagement.receipt("monitoring.list", body);
    return monitoringManagement.read(
      "monitoring.list",
      body,
      receipt,
      s.username,
    );
  });
  app.get("/api/admin/attempts/:id/recordings/:pane", async (req: any) => {
    const s = principal(req, "admin");
    z.string().uuid().parse(req.params.pane);
    const offset =
      req.query.offset !== undefined
        ? z
            .string()
            .regex(/^(0|[1-9][0-9]*)$/)
            .transform(Number)
            .parse(req.query.offset)
        : 0;
    const body = { id: req.params.id, pane: req.params.pane, offset };
    const receipt = monitoringManagement.receipt("monitoring.replay", body);
    const result = monitoringManagement.read(
      "monitoring.replay",
      body,
      receipt,
      s.username,
    ) as any;
    if (req.query.offset !== undefined) return result;
    if (result.nextOffset !== result.availableBytes)
      throw Error(
        "Recording exceeds a complete replay batch; reload the review interface or use ?offset=0 and follow nextOffset",
      );
    return result.text;
  });
  app.get("/api/admin/media/:id", async (req: any, reply) => {
    const s = principal(req, "admin");
    const query = z
      .object({ thumbnail: z.enum(["0", "1"]).optional() })
      .strict()
      .parse(req.query);
    try {
      const image = await media.read(
        req.params.id,
        query.thumbnail === "1",
        s.username,
      );
      // Closing descriptors and resuming this continuation both yield to other
      // requests. Fence deletion again immediately before publishing private bytes.
      media.assertRetained(image.attempt);
      return reply.type("image/jpeg").send(image.data);
    } catch (error) {
      if (error instanceof MonitoringMediaError)
        app.log.warn(
          {
            event: "monitoring-media-unavailable",
            reason: error.reason,
            id: req.params.id,
          },
          "Monitoring image read refused; inspect private storage without altering deletion records",
        );
      throw error;
    }
  });
  app.get("/api/admin/notifications", async (req) => {
    principal(req, "admin");
    const q = alertPage
      .extend({ limit: z.coerce.number().int().min(1).max(200).default(50) })
      .parse(req.query);
    return alertManagement.page(q);
  });
  app.get("/api/admin/notifications/:id", async (req: any) => {
    principal(req, "admin");
    return alertManagement.show(req.params.id);
  });
  app.post("/api/admin/notifications/test", async (req) => {
    const s = principal(req, "admin");
    const b = z
      .object({ requestID: z.string().uuid() })
      .strict()
      .parse(req.body);
    return alertManagement.withRequest(
      s.username,
      b.requestID,
      { operation: "test" },
      () => alertManagement.test(s.username),
    );
  });
  app.post("/api/admin/notifications/:id/remind", async (req: any) => {
    const s = principal(req, "admin");
    const b = z
      .object({
        requestID: z.string().uuid(),
        revision: z.string(),
        reason: z.string(),
      })
      .strict()
      .parse(req.body);
    const intent = alertReminder.parse({
      id: req.params.id,
      revision: b.revision,
      reason: b.reason,
    });
    return alertManagement.withRequest(s.username, b.requestID, intent, () =>
      alertManagement.remind(intent, s.username),
    );
  });
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 8 * 1024 * 1024,
  });
  app.server.on("upgrade", (req, socket, head) => {
    if (req.headers.origin !== config.origin) {
      socket.destroy();
      return;
    }
    const pathname = new URL(req.url!, config.origin).pathname;
    if (config.loginOnly && pathname !== "/api/auth/dialogue") {
      socket.destroy();
      return;
    }
    if (
      ![
        "/api/auth/dialogue",
        "/api/student/session",
        "/api/admin/events",
        "/api/browser/ssh",
      ].includes(pathname)
    ) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) =>
      wss.emit("connection", ws, req),
    );
  });
  wss.on("connection", (ws, raw) => {
    ws.on("error", () => ws.terminate());
    const cookies = app.parseCookie(raw.headers.cookie || "");
    const pathname = new URL(raw.url!, config.origin).pathname;
    let session: any;
    try {
      if (pathname !== "/api/auth/dialogue")
        session = principal(
          { cookies },
          pathname === "/api/admin/events" ? "admin" : "student",
        );
    } catch {
      ws.close(1008);
      return;
    }
    let living = true;
    ws.on("pong", () => (living = true));
    const ping = setInterval(() => {
      if (
        session &&
        !store.db
          .prepare("SELECT 1 FROM sessions WHERE token=? AND expires>?")
          .get(session.token, now())
      ) {
        ws.close(1008, "Session ended");
        return;
      }
      if (!living) {
        ws.terminate();
        return;
      }
      living = false;
      ws.ping();
    }, 20000);
    ws.on("close", () => clearInterval(ping));
    if (pathname === "/api/admin/events") {
      const timer = setInterval(
        () =>
          send(ws, {
            type: "update",
            at: now(),
            attention: store.db
              .prepare(
                "SELECT count(*) n FROM attempts WHERE state IN ('LOCKED','COLLECTION_FAILED') OR access_error IS NOT NULL OR policy_error IS NOT NULL",
              )
              .get(),
          }),
        2000,
      );
      ws.on("close", () => clearInterval(timer));
      return;
    }
    if (pathname === "/api/browser/ssh") {
      const conn = connections.get(`${session.exam}:${session.username}`);
      if (!(conn instanceof BrowserConnection) || !conn.alive) {
        ws.close(1008);
        return;
      }
      let bound = false;
      let controls = Promise.resolve();
      let controlQueue = 0,
        controlBytes = 0;
      ws.on("message", (data) => {
        const bytes = Array.isArray(data)
          ? data.reduce((n, b) => n + b.length, 0)
          : data.byteLength;
        if (ws.readyState !== WebSocket.OPEN) return;
        if (++controlQueue > 64 || controlBytes + bytes > 16 * 1024 * 1024) {
          ws.close(1008, "Control queue exceeded");
          return;
        }
        controlBytes += bytes;
        controls = controls.then(async () => {
          try {
            const m = JSON.parse(data.toString());
            if (!bound) {
              if (
                m.type !== "browser-bind" ||
                m.controlToken !== conn.controlToken
              )
                throw Error("Invalid browser SSH binding");
              await conn.attach(ws);
              bound = true;
              send(ws, { type: "browser-bound" });
              return;
            }
            if (!conn.receive(m)) throw Error("Invalid browser SSH message");
          } catch {
            ws.close(1008);
          } finally {
            controlQueue--;
            controlBytes -= bytes;
          }
        });
      });
      return;
    }
    if (pathname === "/api/auth/dialogue") {
      const p = pending.get(hash(cookies.dialogue || ""));
      if (!p || p.connection) {
        ws.close(1008);
        return;
      }
      let waiting: {
        round: string;
        count: number;
        resolve: (a: string[]) => void;
        reject: (e: Error) => void;
        timer: NodeJS.Timeout;
      } | null = null;
      const dialogue = (host: string, instruction: string, prompts: any[]) =>
        new Promise<string[]>((resolve, reject) => {
          if (!prompts.length) {
            send(ws, {
              type: waiting ? "notice" : "challenge",
              host,
              instruction,
              prompts,
              round: randomUUID(),
            });
            resolve([]);
            return;
          }
          if (waiting) {
            reject(Error("Overlapping authentication challenge"));
            return;
          }
          const round = randomUUID();
          waiting = {
            round,
            count: prompts.length,
            resolve,
            reject,
            timer: setTimeout(() => {
              waiting = null;
              reject(Error("Authentication timed out"));
            }, 120000),
          };
          send(ws, { type: "challenge", host, instruction, prompts, round });
        });
      const signInError = (message: string) =>
        Object.assign(Error(message), { publicMessage: message });
      ws.on("message", async (data) => {
        let m: ReturnType<typeof authMessage.parse> | undefined;
        let handedOff = false;
        try {
          if (p.connection instanceof BrowserConnection) {
            const rawMessage = JSON.parse(data.toString());
            if (p.connection.receive(rawMessage)) return;
          }
          let parsed = JSON.parse(data.toString());
          try {
            m = authMessage.parse(parsed);
          } finally {
            if (Array.isArray(parsed?.answers)) parsed.answers.fill("");
            parsed = undefined;
            wipeAuthPacket(data);
          }
          if (m.type === "cancel") {
            p.connection?.close();
            ws.close();
            return;
          }
          if (m.type === "answers") {
            if (
              !waiting ||
              waiting.round !== m.round ||
              waiting.count !== m.answers.length
            )
              throw Error("Invalid challenge round");
            const w = waiting;
            waiting = null;
            clearTimeout(w.timer);
            handedOff = true;
            w.resolve(m.answers);
            return;
          }
          if (p.connection) throw Error("Authentication already in progress");
          if (
            config.maintenance &&
            !store.db
              .prepare(
                "SELECT 1 FROM attempts WHERE exam=? AND username=? AND start IS NOT NULL AND state IN ('ACTIVE','LOCKED')",
              )
              .get(m.exam, m.username)
          )
            throw signInError(
              "Exam starts are paused for maintenance. Instructor sign-in remains available.",
            );
          const key = m.exam + ":" + m.username;
          const previous = authAttempts.get(key);
          if (!isSandbox(m.exam) && previous && now() - previous.at < 60000) {
            if (previous.count >= 5) {
              const seconds = Math.max(
                1,
                Math.ceil((previous.at + 60000 - now()) / 1000),
              );
              throw Object.assign(
                signInError(
                  `Too many SSH sign-in attempts for this exam and account. Wait ${seconds} seconds before trying again. No new exam was started; an existing exam clock continues.`,
                ),
                { authenticationStage: "rate-limit" },
              );
            }
            previous.count++;
          } else authAttempts.set(key, { at: now(), count: 1 });
          if (!config.loginOnly && isSandbox(m.exam)) {
            const latest = store.db
              .prepare(
                "SELECT * FROM attempts WHERE exam=? AND username=? ORDER BY rowid DESC LIMIT 1",
              )
              .get(m.exam, m.username) as Attempt | undefined;
            if (latest) {
              await life.reconcile(latest.id).catch(() => {});
              await autoAuthorizeSandbox(latest.id, true);
            }
          }
          if (!config.loginOnly) {
            const row = store.db
              .prepare("SELECT 1 FROM enrollments WHERE exam=? AND username=?")
              .get(m.exam, m.username);
            if (!row && !isSandbox(m.exam))
              throw signInError(
                "This account is not enrolled in the selected exam. Check the exam ID and username, or contact your instructor.",
              );
            const existing = store.db
              .prepare(
                "SELECT state FROM attempts WHERE exam=? AND username=? ORDER BY rowid DESC LIMIT 1",
              )
              .get(m.exam, m.username) as { state: string } | undefined;
            const initialGrant = grants.initialFor(m.exam, m.username);
            if (
              initialGrant &&
              initialGrant.status !== "AVAILABLE" &&
              !existing &&
              !grants.available(m.exam, m.username).length
            )
              throw signInError(
                "The initial grant is revoked or consumed. Contact your instructor to inspect its original grant/attempt history; no new exam started.",
              );
            if (
              existing?.state === "COMPLETED" &&
              !isSandbox(m.exam) &&
              !grants.available(m.exam, m.username).length
            )
              throw signInError(
                "Your exam is already completed. Contact your instructor if you need help with your submission.",
              );
            if (
              existing &&
              ["FINALIZING", "COLLECTION_FAILED"].includes(existing.state)
            )
              throw signInError(
                existing.state === "FINALIZING"
                  ? "Your exam has ended and your submission is being collected."
                  : "This attempt cannot be restarted. Contact your instructor for recovery.",
              );
            const busyAttempt = store.db
              .prepare(
                "SELECT * FROM attempts WHERE username=? AND (state IN ('ACTIVE','LOCKED','FINALIZING','COLLECTION_FAILED') OR (start IS NOT NULL AND access_state NOT IN ('RELEASED','OVERRIDDEN')))",
              )
              .get(m.username) as Attempt | undefined;
            if (busyAttempt) {
              if (busyAttempt.state === "COMPLETED")
                throw signInError(
                  "Your completed exam still restricts server access until its original deadline and secured collection. Finished attempts cannot reopen.",
                );
              const authorization = store.db
                .prepare(
                  "SELECT * FROM continuations WHERE attempt=? AND consumed=0 AND expires>?",
                )
                .get(busyAttempt.id, now()) as any;
              if (
                busyAttempt.state !== "LOCKED" ||
                !authorization ||
                authorization.generation !== busyAttempt.generation ||
                !authenticationGap(busyAttempt.id)
              )
                throw signInError(
                  "Your exam is locked or already in progress. Ask your instructor to authorize continuation before signing in again. The clock continues.",
                );
            }
          }
          p.username = m.username;
          p.exam = m.exam;
          p.connection = config.browserSSH
            ? new BrowserConnection(
                m.username,
                m.exam,
                config,
                agent,
                ws,
                options.connectionWorkerEntry,
              )
            : new IsolatedConnection(
                m.username,
                m.exam,
                config,
                agent,
                false,
                undefined,
                options.connectionWorkerEntry,
              );
          const isolated = p.connection as IsolatedConnection;
          isolated.onFailure = (failure) => {
            if (!store.db.open) return;
            const owned = [...attemptConnections].find(
              ([, c]) => c === isolated,
            );
            const context = owned
              ? store.attempt(owned[0])
              : (store.db
                  .prepare(
                    "SELECT * FROM attempts WHERE exam=? AND username=? AND state IN ('PREPARING','ACTIVATING','ACTIVE','LOCKED') ORDER BY rowid DESC LIMIT 1",
                  )
                  .get(p.exam, p.username) as Attempt | undefined);
            const event = randomUUID();
            const detail = JSON.stringify({ event, ...failure });
            store.audit(
              "supervisor",
              "attempt-worker-failed",
              context?.id || "",
              detail,
            );
            app.log.error(
              {
                username: p.username,
                exam: p.exam,
                attempt: context?.id,
                event,
                ...failure,
              },
              "Attempt connection process failed",
            );
            const reason = context?.start
              ? "Exam connection process failed. Recovery authorization and fresh SSH sign-in are required."
              : "SSH sign-in/preflight process failed. Sign in again; the exam clock has not started.";
            const subject = "Exam connection failure: " + p.username;
            const body = `${reason}\nDiagnostic: ${detail}`;
            if (context)
              life.notifyAttempt(
                context,
                "connection-process",
                subject,
                body,
                event,
              );
            else
              life.alert(
                subject,
                [...signInAlertContext(p.username!, p.exam!), body].join("\n"),
                { coalesce: false },
              );
            if (
              owned &&
              ["ACTIVE", "LOCKED"].includes(store.attempt(owned[0]).state)
            ) {
              void life
                .lock(owned[0], reason, { notify: false })
                .catch(() => {});
            }
          };
          isolated.onLoss = () => {
            const owned = [...attemptConnections].find(
              ([, c]) => c === isolated,
            );
            if (owned)
              void life.lock(owned[0], "SSH transport lost").catch(() => {});
          };
          options.onConnection?.(isolated);
          p.connection.onDiagnostic = (host, detail) => {
            store.audit("gateway", "ssh-diagnostic", host, detail);
            life.alert(
              "SSH host-key verification failed",
              [
                ...signInAlertContext(p.username!, p.exam!),
                `Reported SSH host: ${JSON.stringify(host)}`,
                `Diagnostic: ${JSON.stringify(detail)}`,
                "The pinned SSH host identity was not verified; sign-in was refused. Verify the host key through trusted institutional administration before changing any pin. Do not bypass verification or reset an existing attempt.",
              ].join("\n"),
            );
          };
          const held = store.db
            .prepare(
              "SELECT * FROM attempts WHERE username=? AND state='LOCKED' ORDER BY rowid DESC LIMIT 1",
            )
            .get(m.username) as Attempt | undefined;
          const grant =
            held &&
            (store.db
              .prepare(
                "SELECT * FROM continuations WHERE attempt=? AND consumed=0 AND expires>?",
              )
              .get(held.id, now()) as any);
          await p.connection.connect(dialogue, {
            exam: m.exam,
            continuation: grant
              ? {
                  id: held!.id,
                  generation: grant.generation,
                  expires: grant.expires,
                }
              : undefined,
          });
          if (!config.loginOnly) {
            // Resolve identity through the live, signed student SSH channel, never
            // from an enrollment/import field or an advertised account snapshot.
            const accounts = await p.connection.command(
              "resolve-course-accounts",
              {
                usernames: [m.username],
                exam: m.exam,
              },
            );
            const uid = accounts[m.username];
            if (!Number.isSafeInteger(uid) || uid < 1000)
              throw Error("Account not approved by the class server");
            if (isSandbox(m.exam))
              store.db
                .prepare(
                  "INSERT OR IGNORE INTO enrollments(exam,username,uid) VALUES(?,?,?)",
                )
                .run(m.exam, m.username, uid);
            const enrolled = store.db
              .prepare(
                "UPDATE enrollments SET uid=? WHERE exam=? AND username=?",
              )
              .run(uid, m.exam, m.username);
            if (!enrolled.changes)
              throw signInError(
                "This account is no longer enrolled in the selected exam.",
              );
          }
          p.done = true;
          send(ws, { type: "authenticated" });
        } catch (e) {
          // Log only a bounded stage code; SSH output and credentials never enter audit.
          if (store.db.open)
            store.audit(
              p.username || "gateway",
              "student-sign-in-failed",
              p.exam || "",
              ["exam-admission", "rate-limit"].includes(
                (e as any).authenticationStage,
              )
                ? (e as any).authenticationStage
                : "authentication-or-eligibility",
            );
          send(ws, {
            type: "error",
            error:
              (e as Error & { publicMessage?: string }).publicMessage ||
              "SSH sign-in failed. Check your shared password and challenge approval. If it still fails, contact your instructor to check the server connection.",
          });
          p.connection?.close();
          ws.close();
        } finally {
          if (!handedOff && m?.type === "answers") m.answers.fill("");
          wipeAuthPacket(data);
        }
      });
      ws.on("close", () => {
        if (waiting) {
          clearTimeout(waiting.timer);
          waiting.reject(Error("Authentication cancelled"));
          waiting = null;
        }
        if (
          !p.done &&
          !(p.connection instanceof BrowserConnection && p.connection.alive)
        )
          p.connection?.close();
      });
      return;
    }
    let boundAttemptID: string | undefined;
    let boundPageHash: string | undefined;
    let owned = false;
    let outstanding = 0;
    let messageChain = Promise.resolve();
    const handleMessage = async (rawMessage: any) => {
      // Each handler owns its snapshot. An old awaited command must not replace
      // another handler's identity, generation or error/revocation fence.
      let a: Attempt | undefined;
      let openingPane: string | undefined;
      // Only these verified gateway checks may classify ownership loss. Never
      // infer a policy event from native/filesystem diagnostic wording.
      let pageOwnershipFailure = false;
      try {
        if (closingSessions) return;
        a = boundAttemptID ? store.attempt(boundAttemptID) : undefined;
        if (!a) {
          const bind = z
            .object({
              v: z.literal(1),
              type: z.literal("bind"),
              attempt: z.string().uuid(),
              page: z.string().length(64),
              binding: z.string().uuid().optional(),
            })
            .parse(rawMessage);
          a = store.attempt(bind.attempt);
          if (
            a.username !== session.username ||
            a.exam !== session.exam ||
            a.page_hash !== hash(bind.page)
          ) {
            pageOwnershipFailure = true;
            throw Error("Page does not own attempt");
          }
          const old = sockets.get(a.id);
          if (old && old !== ws) {
            await life.lock(a.id, "Second page attempted WebSocket takeover");
            pageOwnershipFailure = true;
            throw Error("Existing page owns attempt");
          }
          if (
            a.last_contact &&
            now() - a.last_contact > 15000 &&
            a.state === "ACTIVE"
          )
            await life.lock(a.id, "Connection grace expired");
          sockets.set(a.id, ws);
          boundAttemptID = a.id;
          boundPageHash = a.page_hash!;
          owned = true;
          send(ws, {
            type: "state",
            binding: bind.binding,
            attempt: store.attempt(a.id),
            serverNow: now(),
            authenticationGap: authenticationGap(a.id),
          });
          return;
        }
        if (sockets.get(a.id) !== ws || ws.readyState !== WebSocket.OPEN)
          return;
        a = store.attempt(a.id);
        if (a.page_hash !== boundPageHash) {
          pageOwnershipFailure = true;
          throw Error(
            "Page no longer owns attempt; reconnect with authorization",
          );
        }
        const m = messageSchema.parse(rawMessage);
        if (m.type === "open") openingPane = m.pane;
        const conn = connections.get(`${a.exam}:${a.username}`);
        if (m.type === "incident") {
          app.log.warn(
            {
              attempt: a.id,
              exam: a.exam,
              username: a.username,
              reason: m.reason,
              diagnostics: m.diagnostics,
            },
            "Student exam paused",
          );
          if (m.diagnostics)
            store.audit(
              "browser",
              "monitoring-diagnostics",
              a.id,
              JSON.stringify(m.diagnostics),
            );
          await life.lock(a.id, m.reason);
          send(ws, {
            type: "state",
            attempt: store.attempt(a.id),
            serverNow: now(),
            authenticationGap: authenticationGap(a.id),
          });
          return;
        }
        if (m.type === "focus") {
          await reportFocus(life, a.id, m.focused);
          send(ws, {
            type: "state",
            attempt: store.attempt(a.id),
            serverNow: now(),
            authenticationGap: authenticationGap(a.id),
          });
          return;
        }
        if (m.type === "preflight-contact") {
          if (a.state === "PREPARING" && conn?.alive)
            store.db
              .prepare("UPDATE attempts SET last_contact=? WHERE id=?")
              .run(now(), a.id);
          send(ws, {
            type: "state",
            confirmation: m.confirmation,
            attempt: store.attempt(a.id),
            serverNow: now(),
            authenticationGap: authenticationGap(a.id),
          });
          return;
        }
        if (m.type === "heartbeat") {
          // Receipt is not execution authorization. Do not make browser
          // contact wait for SSH, a clock reset or a native commit/reply.
          // Old clients ignore this distinct type and still receive state.
          if (a.state === "ACTIVE" && m.confirmation)
            send(ws, {
              type: "monitoring-contact",
              attempt: a.id,
              confirmation: m.confirmation,
            });
          if (!life.expireDeadline(a.id))
            await reportFocus(life, a.id, m.ready.focus);
          if (closingSessions) return;
          a = store.attempt(a.id);
          if (
            sockets.get(a.id) !== ws ||
            a.page_hash !== boundPageHash ||
            connections.get(`${a.exam}:${a.username}`) !== conn
          )
            return;
          if (a.state === "PREPARING")
            store.db
              .prepare("UPDATE attempts SET last_contact=? WHERE id=?")
              .run(now(), a.id);
          if (a.state === "ACTIVE") {
            if (
              !conn?.alive ||
              !healthy(a) ||
              (JSON.parse(a.settings).webcam && !m.ready.webcam)
            ) {
              await life.lock(a.id, "Required SSH/capture health lost");
            } else {
              store.db
                .prepare("UPDATE attempts SET last_contact=? WHERE id=?")
                .run(now(), a.id);
              if (!leases.has(a.id)) {
                leases.add(a.id);
                let renewing = a;
                try {
                  const reset = clocks.pending(a.id);
                  if (reset) {
                    try {
                      life.acceptRemote(await agent.call("reset-clock", reset));
                    } catch {
                      /* Remains queued for authenticated timing recovery. */
                    }
                  }
                  renewing = store.attempt(a.id);
                  if (renewing.state === "ACTIVE" && !life.expireDeadline(a.id))
                    await agent.call("renew-execution-lease", { id: a.id });
                } catch (error) {
                  if (closingSessions) return;
                  // A failed worker already paused this generation. A late lease
                  // failure must neither repeat its pause nor interrupt a new login.
                  await life.renewalFailed(
                    renewing,
                    () =>
                      connections.get(
                        `${renewing.exam}:${renewing.username}`,
                      ) === conn && sockets.get(renewing.id) === ws,
                    error,
                  );
                } finally {
                  leases.delete(a.id);
                }
              }
            }
          }
          send(ws, {
            type: "state",
            confirmation: m.confirmation,
            attempt: store.attempt(a.id),
            serverNow: now(),
            authenticationGap: authenticationGap(a.id),
          });
          return;
        }
        if (
          !["ACTIVE", "PREPARING"].includes(a.state) ||
          (a.state === "ACTIVE" &&
            (!a.deadline ||
              a.deadline <= now() ||
              now() - (a.last_contact || 0) > 15000)) ||
          !conn?.alive
        ) {
          // Window layout/close events can arrive after pause or finalization.
          // They are harmless housekeeping; input/open still fail closed.
          if (m.type === "resize" || m.type === "close") return;
          throw Error("Terminal interaction disabled");
        }
        if (m.type === "open") {
          if (
            conn.panes.size >= JSON.parse(a.settings).terminals ||
            conn.panes.has(m.pane)
          )
            throw Error("Terminal limit exceeded");
          const practice = a.state === "PREPARING";
          const c = await conn.open(
            a.id,
            m.pane,
            practice ? "practice" : "exam",
          );
          if (closingSessions) return;
          if (!conn.panes.has(m.pane)) {
            if (c.inputEpoch)
              send(ws, {
                type: "opened",
                pane: m.pane,
                input: { protocol: "v1", epoch: c.inputEpoch },
              });
            send(ws, {
              type: "closed",
              pane: m.pane,
              input_epoch: c.inputEpoch,
            });
            return;
          }
          if (!practice && !(conn instanceof BrowserConnection))
            monitoring.record(a.id, m.pane, { event: "open" });
          c.on("data", (bytes: Buffer) => {
            const current = store.attempt(a!.id);
            try {
              if (!practice)
                monitoring.record(a!.id, m.pane, {
                  event: "output",
                  data: bytes.toString("base64"),
                });
            } catch {
              void life.lock(a!.id, "Recording storage failure");
              return;
            }
            if (
              (current.state === "PREPARING" ||
                (current.state === "ACTIVE" && current.deadline! > now())) &&
              sockets.get(current.id)?.readyState === WebSocket.OPEN
            )
              send(sockets.get(current.id)!, {
                type: "output",
                pane: m.pane,
                data: bytes.toString("base64"),
                input_epoch: c.inputEpoch,
              });
          });
          c.on("close", () => {
            const target = sockets.get(a!.id);
            if (target)
              send(target, {
                type: "closed",
                pane: m.pane,
                input_epoch: c.inputEpoch,
              });
          });
          send(ws, {
            type: "opened",
            pane: m.pane,
            input: c.inputEpoch
              ? { protocol: "v1", epoch: c.inputEpoch }
              : undefined,
          });
          c.resume();
        } else {
          const c = conn.panes.get(m.pane);
          if (!c) {
            if (m.type === "resize" || m.type === "close") return;
            throw Error("Unknown pane");
          }
          if (m.type === "input") {
            if (m.generation !== a.generation)
              throw Error("Stale input generation");
            if (c.writableLength > 65536) throw Error("PTY backpressure");
            if (c.inputEpoch) {
              if (m.input?.epoch !== c.inputEpoch) return;
              if (!c.writeInputFrame)
                throw Error(
                  "Native framed input handler unavailable; preserve this pane and inspect matching loaded versions",
                );
              c.writeInputFrame(m.input, m.data);
            } else {
              if (m.input) return; // Stale framed packet cannot become raw input.
              c.write(m.data);
            }
          }
          if (m.type === "resize") {
            if (c.inputEpoch) {
              // The optimistic window can resize before its native context
              // arrives. Discard that captured packet without a false modal,
              // ownership incident, permission change or later relabelling.
              if (m.input?.epoch !== c.inputEpoch) return;
              if (!c.resizeInputFrame)
                throw Error(
                  "Native framed resize handler unavailable; preserve this pane and inspect matching loaded versions",
                );
              c.resizeInputFrame(m.input, m.rows, m.cols);
            } else {
              if (m.input) return;
              c.setWindow(m.rows, m.cols, 0, 0);
            }
            if (a.state === "ACTIVE" && !(conn instanceof BrowserConnection))
              monitoring.record(a.id, m.pane, {
                event: "resize",
                cols: m.cols,
                rows: m.rows,
              });
          }
          if (m.type === "close") {
            await c.close();
            if (a.state === "ACTIVE" && !(conn instanceof BrowserConnection))
              monitoring.record(a.id, m.pane, { event: "close" });
          }
        }
      } catch (e) {
        if (closingSessions) return;
        // Finalization/pause may close SSH while an open request awaits
        // admission. Remove its optimistic window without covering the receipt.
        if (
          openingPane &&
          a &&
          !["ACTIVE", "PREPARING"].includes(store.attempt(a.id).state)
        ) {
          send(ws, { type: "closed", pane: openingPane });
          return;
        }
        send(ws, {
          type: "error",
          code: pageOwnershipFailure ? "page-ownership" : undefined,
          error: (e as Error).message,
          pane: openingPane,
        });
      } finally {
        outstanding--;
      }
    };
    ws.on("message", (data) => {
      if (++outstanding > 64) {
        ws.close(1008, "Input queue exceeded");
        return;
      }
      let rawMessage: any;
      try {
        rawMessage = JSON.parse(data.toString());
      } catch {
        outstanding--;
        send(ws, { type: "error", error: "Invalid session message JSON" });
        return;
      }
      // Binding and terminal operations keep their order. Monitoring and policy
      // reports must not queue behind an SSH renewal, pane open/close or PTY I/O.
      // Full schema, current socket/page ownership and policy checks still run
      // inside the handler; one native renewal per attempt remains in flight.
      let task: Promise<void>;
      if (
        owned &&
        boundAttemptID &&
        ["heartbeat", "preflight-contact", "focus", "incident"].includes(
          rawMessage?.type,
        )
      )
        task = handleMessage(rawMessage);
      else
        task = messageChain = messageChain.then(() =>
          handleMessage(rawMessage),
        );
      sessionTasks.add(task);
      void task.then(
        () => sessionTasks.delete(task),
        () => {
          sessionTasks.delete(task);
          if (!closingSessions)
            app.log.error(
              { event: "session-handler-failed", attempt: boundAttemptID },
              "Session processing failed; native execution authorization remains authoritative",
            );
        },
      );
    });
    ws.on("close", () => {
      if (boundAttemptID && owned && sockets.get(boundAttemptID) === ws)
        sockets.delete(boundAttemptID);
    });
  });
  for (const row of store.db
    .prepare("SELECT id FROM attempts WHERE state='ACTIVE'")
    .all() as any[])
    await life.lock(
      row.id,
      "Exam webserver restarted. Reconnect SSH to resume.",
    );
  const tick = setInterval(() => {
    if (!config.loginOnly) void life.tick().catch(() => {});
  }, 1000);
  let retentionBacklog = false;
  const cleanupMonitoring = () => {
    try {
      const result = monitoring.cleanup();
      retentionBacklog = result.more;
      if (result.failed)
        app.log.warn(
          { event: "monitoring-retention-incomplete", failed: result.failed },
          "Monitoring logical retention incomplete; preserve records for retry",
        );
    } catch {
      // Even a database/inventory failure must not escape an interval callback
      // and take unrelated SSH/monitoring sessions down with the gateway.
      app.log.error(
        { event: "monitoring-retention-unavailable" },
        "Monitoring retention unavailable; preserve data and retry",
      );
    }
  };
  const cleanup = setInterval(cleanupMonitoring, 3600000);
  cleanupMonitoring();
  const purgeTick = setInterval(() => {
    if (retentionBacklog) cleanupMonitoring();
    void purges.kick();
  }, 1000);
  void purges.kick();
  const housekeeping = setInterval(() => {
    for (const [key, a] of authAttempts)
      if (now() - a.at > 60000) authAttempts.delete(key);
    store.db
      .prepare("DELETE FROM previews WHERE created<?")
      .run(now() - 600000);
    for (const [id, p] of pending)
      if (now() - p.created > 600000) {
        p.connection?.close();
        pending.delete(id);
      }
    for (const a of store.db
      .prepare(
        "SELECT * FROM attempts WHERE state='PREPARING' AND start IS NULL AND deadline IS NULL AND original_deadline IS NULL AND (preflight_started_at<=? OR (last_contact IS NOT NULL AND last_contact<?))",
      )
      .all(
        now() - PREFLIGHT_TIMEOUT_MS,
        now() - (config.preflightIdleMs ?? PREFLIGHT_TIMEOUT_MS),
      ) as Attempt[]) {
      if (busy.has(a.id) || life.isBusy(a.id)) continue;
      void life
        .cancelPreflight(
          a.id,
          preflightExpired(a, now())
            ? PREFLIGHT_EXPIRED_REASON
            : "Preflight expired after losing contact",
        )
        .then(() => {
          if (store.attempt(a.id).state !== "CANCELLED_BEFORE_START") return;
          const key = `${a.exam}:${a.username}`;
          connections.get(key)?.close();
          connections.delete(key);
          sockets.get(a.id)?.close(1000, "Preflight expired");
          sockets.delete(a.id);
        })
        .catch(() => {});
    }
  }, 10000);
  let mailBusy = false;
  const mail = setInterval(async () => {
    if (mailBusy || !config.smtp) return;
    mailBusy = true;
    try {
      const smtp = config.smtp;
      const rows = store.db
        .prepare(
          "SELECT * FROM outbox WHERE status='pending' AND next<=? LIMIT 10",
        )
        .all(now()) as any[];
      for (const r of rows)
        try {
          if (
            !alertManagement.prepareForDelivery(r.id) ||
            !life.preparePreflightNotification(r.id)
          )
            continue;
          const transport = mailTransport(smtp);
          try {
            await transport.sendMail({
              messageId: `<${r.id}@ssh-exam.local>`,
              from: smtp.from,
              to: smtp.to,
              subject: r.subject,
              text: r.body + "\n" + config.origin + "/admin",
            });
          } finally {
            transport.close();
          }
          store.db
            .prepare("UPDATE outbox SET status='sent' WHERE id=?")
            .run(r.id);
        } catch {
          store.db
            .prepare(
              "UPDATE outbox SET tries=tries+1,next=?,status=? WHERE id=? AND status='pending'",
            )
            .run(
              now() + Math.min(3600000, 30000 * 2 ** r.tries),
              r.tries >= 9 ? "failed" : "pending",
              r.id,
            );
        }
    } finally {
      mailBusy = false;
    }
  }, 5000);
  const web = path.resolve("dist/web");
  if (existsSync(web)) {
    await app.register(staticPlugin, { root: web });
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith("/api")
        ? reply.code(404).send({ error: "Not found" })
        : reply.sendFile("index.html"),
    );
  }
  app.addHook("preClose", async () => {
    closingSessions = true;
    // Close pending authentication before HTTP shutdown waits for upgraded sockets.
    for (const p of pending.values()) p.connection?.close();
    for (const client of wss.clients) client.terminate();
  });
  app.addHook("onClose", async () => {
    for (const t of [tick, cleanup, housekeeping, mail, purgeTick])
      clearInterval(t);
    await purges.close();
    for (const a of store.db
      .prepare("SELECT id FROM attempts WHERE state='ACTIVE'")
      .all() as any[])
      await life.lock(a.id, "Gateway shutting down");
    for (const c of connections.values()) c.close();
    for (const client of wss.clients) client.terminate();
    wss.close();
    agent.close();
    // Connection.close rejects in-flight IPC/SSH operations. Drain their bounded
    // handlers before closing SQLite; late replies must not use a closed DB.
    await Promise.allSettled([...sessionTasks]);
    store.close();
  });
  return { app, store, life };
}
