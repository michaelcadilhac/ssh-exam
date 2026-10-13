import tar from "tar-stream";
import { pipeline } from "node:stream/promises";
import type { Writable } from "node:stream";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import staticPlugin from "@fastify/static";
import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import {
  readFileSync,
  existsSync,
  statSync,
  createReadStream,
  rmSync,
} from "node:fs";
import path from "node:path";
import argon2 from "argon2";
import nodemailer from "nodemailer";
import { z } from "zod";
import {
  examSchema,
  readySchema,
  readinessMessage,
  messageSchema,
  authMessage,
  username as usernameSchema,
} from "../../../packages/protocol/index.js";
import {
  productionReadinessIssues,
  type Config,
} from "../../../packages/config/index.js";
import { Store, hash, secret, now, type Attempt } from "./db.js";
import { Agent } from "./agent.js";
import { Connection } from "./ssh.js";
import { wipeAuthPacket } from "./login-password.js";
import { Monitoring } from "./monitoring.js";
import { Lifecycle } from "./lifecycle.js";
import { parseRosterAsync, exportRoster } from "./roster.js";
import { isSandbox, sandboxExam } from "../../../packages/protocol/sandbox.js";
export async function createApp(
  config: Config,
  options: { logStream?: Writable } = {},
) {
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
    monitoring = new Monitoring(store),
    life = new Lifecycle(store, agent, monitoring);
  const authAttempts = new Map<string, { at: number; count: number }>();
  store.db
    .prepare("INSERT OR IGNORE INTO exams VALUES(?,?)")
    .run("sandbox", JSON.stringify(sandboxExam()));
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
      store.db
        .prepare("INSERT OR REPLACE INTO continuations VALUES(?,?,?,0)")
        .run(id, a.generation, expires);
      store.audit("sandbox", "automatic-continuation", id);
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
  life.onEnd = (a) => {
    const ws = sockets.get(a.id);
    if (ws) send(ws, { type: "state", attempt: a, serverNow: now() });
  };
  // Do not deliver PTY hangup/signals before the agent has secured its frozen file view.
  life.onSecured = (a) => {
    attemptConnections.get(a.id)?.close();
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
  const recordingBytes = new Map<string, number>();
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
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      );
    if (
      config.loginOnly &&
      ((req.url.startsWith("/api/student/") &&
        req.url !== "/api/student/exam") ||
        (req.url.startsWith("/api/admin/") &&
          !["/api/admin/login", "/api/admin/logout"].includes(req.url)))
    )
      throw Error("Exam operations are unavailable during login-only testing.");
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
          ? "Operation failed; consult operator diagnostics"
          : err.message,
    });
  });
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
  const transferReceipt = (req: any) => {
    const encoded = String(req.headers["x-exam-receipt"] || "");
    if (encoded.length > 2048) throw Error("Invalid transfer receipt");
    const payload = Buffer.from(encoded, "base64");
    agent.verifyCallback(
      payload,
      String(req.headers["x-exam-signature"] || ""),
    );
    const receipt = JSON.parse(payload.toString());
    if (receipt.agent !== config.agent.id || receipt.attempt !== req.params.id)
      throw Error("Transfer scope rejected");
    const attempt = store.attempt(receipt.attempt);
    if (!attempt.protected || attempt.checksum !== receipt.checksum)
      throw Error("Protected transfer is not authorized");
    return receipt;
  };
  app.post(
    "/api/agent/submissions/:id",
    {
      bodyLimit: 128 * 1024 * 1024,
      config: { rateLimit: false },
      preParsing: async (req, _reply, payload) => {
        transferReceipt(req);
        return payload;
      },
    },
    async (req: any) => {
      // Authenticate the small signed receipt before accepting a large archive body.
      const receipt = transferReceipt(req);
      if (!Buffer.isBuffer(req.body)) throw Error("Raw archive required");
      life.receiveArchive(receipt.attempt, receipt.checksum, req.body);
      return { ok: true };
    },
  );
  app.get("/health/live", async () => ({ ok: true }));
  app.get("/api/login-test", async () => ({
    maintenance: config.maintenance,
    loginOnly: !!config.loginOnly,
    functionalTest: !!config.functionalTest,
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
            .catch(() =>
              life.alert(
                "Preflight cleanup pending",
                `Attempt ${a.id}: class agent unavailable; cleanup will retry.`,
              ),
            );
        else
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
      .prepare("SELECT * FROM enrollments WHERE exam=? AND username=?")
      .get(s.exam, s.username) as any;
    if (!exam || !row) throw Error("Enrollment not found");
    const latest = store.db
      .prepare(
        "SELECT * FROM attempts WHERE exam=? AND username=? ORDER BY rowid DESC LIMIT 1",
      )
      .get(s.exam, s.username) as Attempt | undefined;
    const repeat =
      isSandbox(s.exam) &&
      latest?.state === "COMPLETED" &&
      latest.protected &&
      ["RELEASED", "OVERRIDDEN"].includes(latest.access_state);
    return {
      exam: JSON.parse(exam.config),
      enrollment: row,
      sshConnected: !!connections.get(`${s.exam}:${s.username}`)?.alive,
      attempt: repeat ? null : latest || null,
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
    const exam = JSON.parse(
      (
        store.db
          .prepare("SELECT config FROM exams WHERE id=?")
          .get(s.exam) as any
      ).config,
    );
    const enrollment = store.db
      .prepare("SELECT * FROM enrollments WHERE exam=? AND username=?")
      .get(s.exam, s.username) as any;
    if (!enrollment) throw Error("Enrollment unavailable");
    const h = await conn.command("health");
    if (!h.ready) throw Error("Class server guards not ready");
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
    if (previous && previous.state !== "PREPARING")
      throw Error("An attempt already exists; instructor review required");
    const id = previous?.id || randomUUID(),
      pageSecret = secret();
    const settings = previous
      ? JSON.parse(previous.settings)
      : {
          ...exam,
          duration: enrollment.duration ?? exam.duration,
          webcam:
            enrollment.webcam === null ? exam.webcam : !!enrollment.webcam,
        };
    if (isSandbox(s.exam)) Object.assign(settings, sandboxExam(exam.template));
    if (!previous)
      store.db
        .prepare(
          "INSERT INTO attempts(id,exam,username,uid,state,settings,page_hash,last_contact) VALUES(?,?,?,?,'PREPARING',?,?,?)",
        )
        .run(
          id,
          s.exam,
          s.username,
          enrollment.uid,
          JSON.stringify(settings),
          hash(pageSecret),
          now(),
        );
    else
      store.db
        .prepare("UPDATE attempts SET page_hash=?,last_contact=? WHERE id=?")
        .run(hash(pageSecret), now(), id);
    attemptConnections.set(id, conn);
    const prepared = await agent.call("prepare-attempt", {
      id,
      exam: s.exam,
      username: s.username,
      uid: enrollment.uid,
      settings,
      transport: conn.transport,
    });
    store.db
      .prepare("UPDATE attempts SET work_path=?,functional_test=? WHERE id=?")
      .run(prepared.work_path || "/work", prepared.functional_test ? 1 : 0, id);
    return {
      id,
      page: pageSecret,
      settings,
      work_path: prepared.work_path || "/work",
      functionalTest: !!h.functional_test,
      notice:
        "Preflight images retained with this attempt if started; abandoned preflight images are deleted.",
    };
  });
  app.post("/api/student/attempts/:id/practice", async (req) => {
    const a = studentAttempt(req);
    page(req, a);
    if (a.state !== "PREPARING") throw Error("Practice only before starting");
    const conn = connections.get(`${a.exam}:${a.username}`)!;
    for (const c of conn.panes.values()) c.close();
    const pane = randomUUID();
    const c = await conn.open(a.id, pane, "practice");
    c.on("data", () => {});
    c.resume();
    return { pane };
  });
  app.post("/api/student/attempts/:id/begin", async (req) => {
    let a = studentAttempt(req);
    page(req, a);
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
    if (
      !isSandbox(a.exam) &&
      (now() < settings.earliest || now() > settings.latest)
    )
      throw Error("Outside allowed start window");
    if ((settings.webcam && !(req.body as any).webcam) || !healthy(a))
      throw Error("Current required images missing");
    const conn = connections.get(`${a.exam}:${a.username}`);
    if (!conn?.alive) throw Error("SSH transports lost");
    if (busy.has(a.id) || life.isBusy(a.id))
      throw Error("Preparation is changing; check status before starting.");
    busy.add(a.id);
    try {
      for (const c of conn.panes.values()) c.close();
      conn.panes.clear();
      const result = await agent.call("activate-attempt", { id: a.id });
      if (result.state !== "ACTIVE") {
        const manifest = result.protected
          ? await conn.command("submission-manifest", { id: a.id })
          : undefined;
        life.acceptRemote(result, manifest, a.id);
        return { attempt: store.attempt(a.id), serverNow: now() };
      }
      life.syncAccess(a.id, result);
      store.db
        .prepare(
          "UPDATE attempts SET state='ACTIVE',start=?,deadline=?,work_path=?,last_contact=? WHERE id=? AND state='PREPARING'",
        )
        .run(result.start, result.deadline, result.work_path, now(), a.id);
      return { attempt: store.attempt(a.id), serverNow: now() };
    } catch (e) {
      await life.reconcile(a.id).catch(() => {});
      throw Error(
        "Begin outcome requires reconciliation; do not create another attempt",
      );
    } finally {
      busy.delete(a.id);
    }
  });
  app.get("/api/student/attempts/:id/status", async (req) => {
    const a = studentAttempt(req);
    return {
      attempt: a,
      serverNow: now(),
      authenticationGap: authenticationGap(a.id),
      authorization:
        store.db
          .prepare(
            "SELECT generation,expires,consumed FROM continuations WHERE attempt=?",
          )
          .get(a.id) || null,
    };
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
      store.db
        .prepare(
          "UPDATE incidents SET message=?,review_at=? WHERE attempt=? AND generation=?",
        )
        .run(message, now(), a.id, a.generation);
      life.alert(
        `Review requested: ${a.username}`,
        `${a.exam}: ${message}. Clock continues. Open the authenticated dashboard.`,
      );
      return { ok: true };
    },
  );
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
    store.db.transaction(() => {
      store.db
        .prepare("UPDATE continuations SET consumed=1 WHERE attempt=?")
        .run(a.id);
      store.transition(a.id, ["LOCKED"], "ACTIVE");
      store.db
        .prepare("UPDATE attempts SET last_contact=? WHERE id=?")
        .run(now(), a.id);
    })();
    return { attempt: store.attempt(a.id), serverNow: now() };
  });
  app.post("/api/student/attempts/:id/finish", async (req) => {
    const a = studentAttempt(req);
    await life.finish(a.id, "student finish");
    return { attempt: store.attempt(a.id), serverNow: now() };
  });
  app.get("/api/admin/exams", async (req) => {
    principal(req, "admin");
    return store.db
      .prepare("SELECT config FROM exams ORDER BY (id='sandbox'),rowid")
      .all()
      .map((r: any) => JSON.parse(r.config));
  });
  app.post("/api/admin/exams", async (req) => {
    const s = principal(req, "admin"),
      parsed = examSchema.parse(req.body),
      e = isSandbox(parsed.id) ? sandboxExam(parsed.template) : parsed;
    store.db
      .prepare(
        "INSERT INTO exams VALUES(?,?) ON CONFLICT(id) DO UPDATE SET config=excluded.config",
      )
      .run(e.id, JSON.stringify(e));
    store.audit(s.username, "configure-exam", e.id);
    return e;
  });
  app.get("/api/admin/exams/:exam/roster", async (req: any) => {
    principal(req, "admin");
    return store.db
      .prepare("SELECT * FROM enrollments WHERE exam=? ORDER BY username")
      .all(req.params.exam);
  });
  app.post("/api/admin/exams/:exam/roster/add", async (req: any) => {
    const s = principal(req, "admin");
    const b = z
      .object({
        username: usernameSchema,
        webcam: z.boolean().nullable().default(null),
      })
      .parse(req.body);
    if (
      !store.db.prepare("SELECT 1 FROM exams WHERE id=?").get(req.params.exam)
    )
      throw Error("Exam not found");
    const accounts = await agent.call("resolve-course-accounts", {
      usernames: [b.username],
    });
    const uid = accounts[b.username];
    if (!Number.isSafeInteger(uid) || uid < 1000)
      throw Error("Student needs a root-approved course account");
    store.db.transaction(() => {
      if (
        store.db
          .prepare("SELECT 1 FROM enrollments WHERE exam=? AND username=?")
          .get(req.params.exam, b.username)
      )
        throw Error("Student is already enrolled in this exam");
      store.db
        .prepare("INSERT INTO enrollments VALUES(?,?,?,?,?,?)")
        .run(
          req.params.exam,
          b.username,
          b.webcam === null ? null : Number(b.webcam),
          null,
          null,
          uid,
        );
      store.audit(s.username, "enroll-student", req.params.exam, b.username);
    })();
    return { ok: true };
  });
  app.post("/api/admin/exams/:exam/roster/remove", async (req: any) => {
    const s = principal(req, "admin");
    const b = z
      .object({ username: usernameSchema, confirm: z.literal(true) })
      .parse(req.body);
    store.db.transaction(() => {
      store.db
        .prepare("DELETE FROM enrollments WHERE exam=? AND username=?")
        .run(req.params.exam, b.username);
      store.audit(s.username, "remove-enrollment", req.params.exam, b.username);
    })();
    return { ok: true };
  });
  app.post("/api/admin/exams/:exam/roster/import-preview", async (req: any) => {
    principal(req, "admin");
    const b = z
      .object({
        text: z.string(),
        mode: z.enum(["csv", "lines"]).default("csv"),
      })
      .parse(req.body);
    const rows = await parseRosterAsync(b.text, b.mode);
    const accounts = await agent.call("resolve-course-accounts", {
      usernames: rows.map((r) => r.username),
    });
    const existing = new Map(
      (
        store.db
          .prepare("SELECT * FROM enrollments WHERE exam=?")
          .all(req.params.exam) as any[]
      ).map((r) => [r.username, r]),
    );
    const result = rows.map((r, index) => ({
      ...r,
      uid: accounts[r.username],
      action: !existing.has(r.username)
        ? "add"
        : [
              ["webcam", r.webcam],
              ["duration", r.duration],
              ["display_name", r.display_name],
            ].some(
              ([k, v]) =>
                v !== undefined &&
                (k === "webcam" && v !== null ? Number(v) : v) !==
                  existing.get(r.username)[k as string],
            )
          ? "update"
          : "unchanged",
      activeAttempt: !!store.db
        .prepare(
          "SELECT 1 FROM attempts WHERE exam=? AND username=? AND state IN ('PREPARING','ACTIVE','LOCKED','FINALIZING')",
        )
        .get(req.params.exam, r.username),
      rowNumber: index + 2,
      previous: existing.get(r.username) || null,
    }));
    if (result.some((r) => !Number.isSafeInteger(r.uid) || r.uid < 1000))
      throw Error(
        "Every username requires root-approved course account provisioning",
      );
    const id = randomUUID();
    store.db
      .prepare("INSERT INTO previews(id,exam,rows,created) VALUES(?,?,?,?)")
      .run(
        id,
        req.params.exam,
        JSON.stringify({ rows: result, checksum: hash(b.text) }),
        now(),
      );
    return {
      id,
      total: result.length,
      rows: result,
      checksum: hash(b.text),
      summary: {
        added: result.filter((r) => r.action === "add").length,
        changed: result.filter((r) => r.action === "update").length,
        unchanged: result.filter((r) => r.action === "unchanged").length,
      },
    };
  });
  app.post("/api/admin/exams/:exam/roster/import-confirm", async (req: any) => {
    const s = principal(req, "admin");
    const { id } = z.object({ id: z.string().uuid() }).parse(req.body);
    const p = store.db
      .prepare("SELECT * FROM previews WHERE id=? AND exam=?")
      .get(id, req.params.exam) as any;
    if (!p || now() - p.created > 600000) throw Error("Preview expired");
    if (p.consumed) return { ok: true };
    const imported = JSON.parse(p.rows);
    const rows = Array.isArray(imported) ? imported : imported.rows;
    store.db.transaction(() => {
      for (const r of rows) {
        const prev = store.db
          .prepare("SELECT * FROM enrollments WHERE exam=? AND username=?")
          .get(p.exam, r.username) as any;
        if (JSON.stringify(prev || null) !== JSON.stringify(r.previous || null))
          throw Error("Roster changed since preview; validate again");
        store.db
          .prepare(
            "INSERT INTO enrollments VALUES(?,?,?,?,?,?) ON CONFLICT(exam,username) DO UPDATE SET webcam=excluded.webcam,duration=excluded.duration,display_name=excluded.display_name,uid=excluded.uid",
          )
          .run(
            p.exam,
            r.username,
            r.webcam === undefined
              ? (prev?.webcam ?? null)
              : r.webcam === null
                ? null
                : Number(r.webcam),
            r.duration === undefined ? (prev?.duration ?? null) : r.duration,
            r.display_name === undefined
              ? (prev?.display_name ?? null)
              : r.display_name,
            r.uid,
          );
      }
      store.db.prepare("UPDATE previews SET consumed=1 WHERE id=?").run(id);
      store.audit(
        s.username,
        "roster-import",
        p.exam,
        JSON.stringify({
          rows: rows.length,
          checksum: imported.checksum || null,
          activeSnapshotsUnchanged: true,
        }),
      );
    })();
    return { ok: true };
  });
  app.get("/api/admin/exams/:exam/roster/export", async (req: any, reply) => {
    principal(req, "admin");
    return reply
      .type("text/csv")
      .header("Content-Disposition", 'attachment; filename="roster.csv"')
      .send(
        exportRoster(
          store.db
            .prepare("SELECT * FROM enrollments WHERE exam=?")
            .all(req.params.exam),
        ),
      );
  });
  app.get("/api/admin/attempts", async (req: any) => {
    principal(req, "admin");
    const { q = "", state = "", offset = "0", webcam = "" } = req.query;
    return {
      serverNow: now(),
      attempts: store.db
        .prepare(
          "SELECT * FROM attempts WHERE username LIKE ? AND (?='' OR state=?) AND (?='' OR json_extract(settings,'$.webcam')=?) ORDER BY rowid DESC LIMIT 100 OFFSET ?",
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
          ...a,
          terminalCount:
            connections.get(a.exam + ":" + a.username)?.panes.size || 0,
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
  app.post("/api/admin/attempts/:id/authorize", async (req: any) => {
    const s = principal(req, "admin");
    const a = store.attempt(req.params.id);
    z.object({}).parse(req.body);
    if (a.state !== "LOCKED" || !a.deadline || a.deadline <= now())
      throw Error("Attempt cannot continue");
    const expires = Math.min(a.deadline, now() + 300000);
    store.db
      .prepare("INSERT OR REPLACE INTO continuations VALUES(?,?,?,0)")
      .run(a.id, a.generation, expires);
    store.audit(s.username, "authorize-continuation", a.id);
    store.audit(
      s.username,
      "authorized-authentication-gap",
      a.id,
      String(a.generation),
    );
    return { expires };
  });
  app.post("/api/admin/attempts/:id/delete-monitoring", async (req: any) => {
    const s = principal(req, "admin");
    const a = store.attempt(req.params.id);
    if (!a.ended) throw Error("Delete monitoring only after attempt ends");
    if ((req.body as any)?.confirm !== true)
      throw Error("Confirmation required");
    monitoring.delete(a.id, s.username);
    return { ok: true };
  });
  app.get("/api/admin/attempts/:id/submission", async (req: any, reply) => {
    const s = principal(req, "admin"),
      a = store.attempt(req.params.id);
    if (a.export_status !== "ready")
      throw Error("Protected archive not yet exported");
    store.audit(s.username, "download-submission", a.id);
    return reply
      .type("application/gzip")
      .header("Content-Disposition", `attachment; filename="${a.id}.tar.gz"`)
      .send(readFileSync(`${store.dir}/submissions/${a.id}.tar.gz`));
  });
  app.get("/api/admin/exams/:exam/submissions", async (req: any, reply) => {
    const s = principal(req, "admin");
    const rows = store.db
      .prepare(
        "SELECT id FROM attempts WHERE exam=? AND export_status='ready' ORDER BY username LIMIT 1000",
      )
      .all(req.params.exam) as any[];
    if (!rows.length) throw Error("No exported archives");
    const pack = tar.pack();
    store.audit(
      s.username,
      "bulk-submission-download",
      req.params.exam,
      `${rows.length} archives`,
    );
    void (async () => {
      try {
        for (const row of rows) {
          const file = `${store.dir}/submissions/${row.id}.tar.gz`;
          const entry = pack.entry({
            name: row.id + ".tar.gz",
            size: statSync(file).size,
            mode: 0o600,
          });
          await pipeline(createReadStream(file), entry);
        }
        pack.finalize();
      } catch {
        pack.destroy(Error("Bulk archive stream failed"));
      }
    })();
    reply.raw.once("close", () => pack.destroy());
    return reply
      .type("application/x-tar")
      .header("Content-Disposition", 'attachment; filename="submissions.tar"')
      .send(pack);
  });
  app.post("/api/admin/attempts/:id/delete-submission", async (req: any) => {
    const s = principal(req, "admin");
    const a = store.attempt(req.params.id);
    if (a.state !== "COMPLETED" || (req.body as any)?.confirm !== true)
      throw Error(
        "Completed attempt and explicit deletion confirmation required",
      );
    // The protected class-server original is retained; administrators delete it locally with examctl.
    rmSync(`${store.dir}/submissions/${a.id}.tar.gz`, { force: true });
    rmSync(`${store.dir}/submissions/${a.id}.manifest.json`, { force: true });
    store.db.transaction(() => {
      store.db
        .prepare("UPDATE attempts SET export_status='deleted' WHERE id=?")
        .run(a.id);
      store.audit(s.username, "delete-submission", a.id);
    })();
    return { ok: true };
  });
  app.get("/api/admin/attempts/:id/recordings", async (req: any) => {
    const s = principal(req, "admin");
    store.attempt(req.params.id);
    store.audit(s.username, "view-monitoring", req.params.id);
    const manifestPath = `${store.dir}/submissions/${req.params.id}.manifest.json`;
    return {
      manifest: existsSync(manifestPath)
        ? JSON.parse(readFileSync(manifestPath, "utf8"))
        : null,
      frames: store.db
        .prepare(
          "SELECT * FROM frames WHERE attempt=? ORDER BY received LIMIT 10000",
        )
        .all(req.params.id),
      terminals: store.db
        .prepare("SELECT * FROM recordings WHERE attempt=?")
        .all(req.params.id),
    };
  });
  app.get("/api/admin/attempts/:id/recordings/:pane", async (req: any) => {
    const s = principal(req, "admin");
    z.string().uuid().parse(req.params.pane);
    const r = store.db
      .prepare("SELECT * FROM recordings WHERE attempt=? AND pane=?")
      .get(req.params.id, req.params.pane);
    if (!r) throw Error("Recording unavailable");
    store.audit(s.username, "terminal-replay", req.params.id);
    return readFileSync(
      `${store.dir}/monitoring/${req.params.id}/${req.params.pane}.ndjson`,
      "utf8",
    );
  });
  app.get("/api/admin/media/:id", async (req: any, reply) => {
    const s = principal(req, "admin");
    const f = store.db
      .prepare("SELECT * FROM frames WHERE id=?")
      .get(req.params.id) as any;
    if (!f) throw Error("Media unavailable");
    store.audit(s.username, "view-media", f.attempt);
    return reply
      .type("image/jpeg")
      .send(
        readFileSync(
          `${store.dir}/monitoring/${f.attempt}/${f.id}${req.query.thumbnail === "1" ? ".thumb" : ""}.jpg`,
        ),
      );
  });
  app.post("/api/admin/notifications/test", async (req) => {
    principal(req, "admin");
    life.alert(
      "SSH Exam notification test",
      "Test notification. Sign in to the instructor dashboard to review delivery status.",
    );
    return { queued: true };
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 32768 });
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
                "SELECT count(*) n FROM attempts WHERE state IN ('LOCKED','COLLECTION_FAILED') OR access_error IS NOT NULL",
              )
              .get(),
          }),
        2000,
      );
      ws.on("close", () => clearInterval(timer));
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
            if (previous.count >= 5) throw Error("Authentication rate limit");
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
            if (existing?.state === "COMPLETED" && !isSandbox(m.exam))
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
          p.connection = new Connection(m.username, config, agent);
          p.connection.onDiagnostic = (host, detail) => {
            store.audit("gateway", "ssh-diagnostic", host, detail);
            life.alert(
              "SSH host-key verification failed",
              host + ": " + detail,
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
            continuation: grant
              ? {
                  id: held!.id,
                  generation: grant.generation,
                  expires: grant.expires,
                }
              : undefined,
          });
          if (!config.loginOnly && isSandbox(m.exam)) {
            const accounts = await p.connection.command(
              "resolve-course-accounts",
              {
                usernames: [m.username],
              },
            );
            const uid = accounts[m.username];
            if (!Number.isSafeInteger(uid) || uid < 1000)
              throw Error("Account not approved by the class server");
            store.db
              .prepare(
                "INSERT OR IGNORE INTO enrollments(exam,username,uid) VALUES(?,?,?)",
              )
              .run(m.exam, m.username, uid);
          }
          p.done = true;
          send(ws, { type: "authenticated" });
        } catch (e) {
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
        if (!p.done) p.connection?.close();
      });
      return;
    }
    let a: Attempt | undefined;
    let owned = false;
    let outstanding = 0;
    let messageChain = Promise.resolve();
    ws.on("message", (data) => {
      if (++outstanding > 64) {
        ws.close(1008, "Input queue exceeded");
        return;
      }
      messageChain = messageChain.then(async () => {
        let openingPane: string | undefined;
        try {
          const rawMessage = JSON.parse(data.toString());
          if (!a) {
            const bind = z
              .object({
                v: z.literal(1),
                type: z.literal("bind"),
                attempt: z.string().uuid(),
                page: z.string().length(64),
              })
              .parse(rawMessage);
            a = store.attempt(bind.attempt);
            if (
              a.username !== session.username ||
              a.exam !== session.exam ||
              a.page_hash !== hash(bind.page)
            )
              throw Error("Page does not own attempt");
            const old = sockets.get(a.id);
            if (old && old !== ws) {
              await life.lock(a.id, "Second page attempted WebSocket takeover");
              throw Error("Existing page owns attempt");
            }
            if (
              a.last_contact &&
              now() - a.last_contact > 15000 &&
              a.state === "ACTIVE"
            )
              await life.lock(a.id, "Connection grace expired");
            sockets.set(a.id, ws);
            owned = true;
            send(ws, {
              type: "state",
              attempt: store.attempt(a.id),
              serverNow: now(),
              authenticationGap: authenticationGap(a.id),
            });
            return;
          }
          if (sockets.get(a.id) !== ws || ws.readyState !== WebSocket.OPEN)
            return;
          a = store.attempt(a.id);
          const m = messageSchema.parse(rawMessage);
          if (m.type === "open") openingPane = m.pane;
          const conn = connections.get(`${a.exam}:${a.username}`);
          if (m.type === "incident") {
            await life.lock(a.id, m.reason);
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
              attempt: store.attempt(a.id),
              serverNow: now(),
              authenticationGap: authenticationGap(a.id),
            });
            return;
          }
          if (m.type === "heartbeat") {
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
                  try {
                    await agent.call("renew-execution-lease", { id: a.id });
                  } catch {
                    await life.lock(a.id, "Class-agent lease renewal failed");
                  } finally {
                    leases.delete(a.id);
                  }
                }
              }
            }
            send(ws, {
              type: "state",
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
            if (!practice) monitoring.record(a.id, m.pane, { event: "open" });
            c.on("data", (bytes: Buffer) => {
              const current = store.attempt(a!.id);
              const used = (recordingBytes.get(a!.id) || 0) + bytes.length;
              recordingBytes.set(a!.id, used);
              if (used > 64 * 1024 * 1024) {
                void life.lock(a!.id, "Terminal recording size limit reached");
                c.pause();
                return;
              }
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
                });
            });
            c.on("close", () => {
              const target = sockets.get(a!.id);
              if (target) send(target, { type: "closed", pane: m.pane });
            });
            send(ws, { type: "opened", pane: m.pane });
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
              c.write(m.data);
            }
            if (m.type === "resize") {
              c.setWindow(m.rows, m.cols, 0, 0);
              if (a.state === "ACTIVE")
                monitoring.record(a.id, m.pane, {
                  event: "resize",
                  cols: m.cols,
                  rows: m.rows,
                });
            }
            if (m.type === "close") {
              c.close();
              if (a.state === "ACTIVE")
                monitoring.record(a.id, m.pane, { event: "close" });
            }
          }
        } catch (e) {
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
            error: (e as Error).message,
            pane: openingPane,
          });
        } finally {
          outstanding--;
        }
      });
    });
    ws.on("close", () => {
      if (a && owned && sockets.get(a.id) === ws) sockets.delete(a.id);
    });
  });
  for (const row of store.db
    .prepare("SELECT id FROM attempts WHERE state='ACTIVE'")
    .all() as any[])
    await life.lock(
      row.id,
      "Gateway restarted; SSH connection objects were lost",
    );
  const tick = setInterval(() => {
    if (!config.loginOnly) void life.tick().catch(() => {});
  }, 1000);
  const cleanup = setInterval(() => monitoring.cleanup(), 3600000);
  monitoring.cleanup();
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
    for (const [key, c] of connections) {
      c.onLoss = () => {
        const a = store.db
          .prepare(
            "SELECT id FROM attempts WHERE username=? AND state='ACTIVE'",
          )
          .get(c.username) as any;
        if (a) void life.lock(a.id, "SSH transport lost");
      };
    }
    for (const a of store.db
      .prepare(
        "SELECT * FROM attempts WHERE state='PREPARING' AND COALESCE(last_contact,0)<?",
      )
      .all(now() - (config.preflightIdleMs ?? 600000)) as Attempt[]) {
      if (busy.has(a.id) || life.isBusy(a.id)) continue;
      void life
        .cancelPreflight(a.id, "Preflight expired after losing contact")
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
      const transport = nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        requireTLS: !smtp.secure,
        auth: smtp.user
          ? {
              user: smtp.user,
              pass: smtp.passwordFile
                ? readFileSync(smtp.passwordFile, "utf8").trim()
                : "",
            }
          : undefined,
      });
      const rows = store.db
        .prepare(
          "SELECT * FROM outbox WHERE status='pending' AND next<=? LIMIT 10",
        )
        .all(now()) as any[];
      for (const r of rows)
        try {
          await transport.sendMail({
            from: smtp.from,
            to: smtp.to,
            subject: r.subject,
            text: r.body + "\n" + config.origin + "/admin",
          });
          store.db
            .prepare("UPDATE outbox SET status='sent' WHERE id=?")
            .run(r.id);
        } catch {
          store.db
            .prepare(
              "UPDATE outbox SET tries=tries+1,next=?,status=? WHERE id=?",
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
    // Close pending authentication before HTTP shutdown waits for upgraded sockets.
    for (const p of pending.values()) p.connection?.close();
    for (const client of wss.clients) client.terminate();
  });
  app.addHook("onClose", async () => {
    for (const t of [tick, cleanup, housekeeping, mail]) clearInterval(t);
    for (const a of store.db
      .prepare("SELECT id FROM attempts WHERE state='ACTIVE'")
      .all() as any[])
      await life.lock(a.id, "Gateway shutting down");
    for (const c of connections.values()) c.close();
    for (const client of wss.clients) client.terminate();
    wss.close();
    agent.close();
    store.close();
  });
  return { app, store, life };
}
