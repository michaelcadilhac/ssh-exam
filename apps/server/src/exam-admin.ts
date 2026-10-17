import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Store } from "./db.js";
import { Agent } from "./agent.js";
import { ClockControl } from "./clock-control.js";
import { username } from "../../../packages/protocol/index.js";
import {
  dashboardViews,
  matchesDashboardView,
  needsAttention,
} from "../../../packages/protocol/admin.js";
import { isSandbox } from "../../../packages/protocol/sandbox.js";

export function registerExamAdmin(
  app: FastifyInstance,
  store: Store,
  agent: Agent,
  clocks: ClockControl,
  principal: (req: any, role: string) => any,
  describe: (a: any) => any,
) {
  const findExam = (id: string) => {
    const row = store.db
      .prepare("SELECT config FROM exams WHERE id=?")
      .get(id) as any;
    if (!row) throw Error("Exam not found");
    return JSON.parse(row.config);
  };
  app.get("/api/admin/exams/:exam/dashboard", async (req: any) => {
    principal(req, "admin");
    findExam(req.params.exam);
    const {
      q = "",
      offset = "0",
      view = "",
    } = z
      .object({
        q: z.string().max(64).optional(),
        offset: z.string().optional(),
        view: z.enum(dashboardViews).optional(),
        review: z.string().uuid().optional(),
      })
      .parse(req.query);
    const start = Math.max(0, Math.floor(Number(offset) || 0));
    const allUsers = store.db
      .prepare(
        `SELECT username FROM (
      SELECT username FROM enrollments WHERE exam=? UNION SELECT username FROM attempts WHERE exam=?
    ) ORDER BY username`,
      )
      .all(req.params.exam, req.params.exam) as any[];
    const users = store.db
      .prepare(
        `SELECT username FROM (
      SELECT username FROM enrollments WHERE exam=? UNION SELECT username FROM attempts WHERE exam=?
    ) WHERE username LIKE ? ORDER BY username`,
      )
      .all(req.params.exam, req.params.exam, `%${q}%`) as any[];
    const all = (
      store.db
        .prepare("SELECT * FROM attempts WHERE exam=? ORDER BY rowid DESC")
        .all(req.params.exam) as any[]
    ).map(describe);
    const grouped = new Map<string, any[]>();
    for (const attempt of all) {
      if (!grouped.has(attempt.username)) grouped.set(attempt.username, []);
      grouped.get(attempt.username)!.push(attempt);
    }
    const matches = users
      .map(({ username }) => {
        const attempts = grouped.get(username) || [];
        return {
          username,
          attempts: attempts
            .map((a, i) => ({ ...a, attempt_number: attempts.length - i }))
            .filter((a) => matchesDashboardView(a, view)),
        };
      })
      .filter((s) => !view || s.attempts.length);
    const students = matches.slice(start, start + 100).map((s) => ({
      ...s,
      enrollment:
        store.db
          .prepare(
            "SELECT exam,username,webcam,duration,uid FROM enrollments WHERE exam=? AND username=?",
          )
          .get(req.params.exam, s.username) || null,
    }));
    return {
      serverNow: Date.now(),
      students,
      reviewAttempt: req.query.review
        ? (() => {
            const a = all.find((a) => a.id === req.query.review);
            if (!a) return null;
            const group = grouped.get(a.username)!;
            return { ...a, attempt_number: group.length - group.indexOf(a) };
          })()
        : null,
      total: matches.length,
      counts: {
        students: allUsers.length,
        working: all.filter((a) => a.working).length,
        attention: all.filter(needsAttention).length,
        active: all.filter((a) => a.state === "ACTIVE").length,
        locked: all.filter((a) => a.state === "LOCKED").length,
        collected: all.filter((a) => !!a.protected).length,
      },
      incidents: store.db
        .prepare(
          "SELECT incidents.* FROM incidents JOIN attempts ON attempts.id=incidents.attempt WHERE attempts.exam=? ORDER BY opened DESC LIMIT 100",
        )
        .all(req.params.exam),
    };
  });
  app.post("/api/admin/exams/:exam/roster/settings", async (req: any) => {
    const actor = principal(req, "admin");
    findExam(req.params.exam);
    const b = z
      .object({
        usernames: z.array(username).min(1).max(1000),
        duration: z
          .number()
          .int()
          .min(60)
          .max(21600)
          .multipleOf(60)
          .nullable()
          .optional(),
        webcam: z.boolean().nullable().optional(),
      })
      .refine(
        (b) => b.duration !== undefined || b.webcam !== undefined,
        "Choose a setting to change",
      )
      .parse(req.body);
    if (new Set(b.usernames).size !== b.usernames.length)
      throw Error("Duplicate student selection");
    if (
      isSandbox(req.params.exam) &&
      b.duration !== undefined &&
      b.duration !== null &&
      b.duration !== 300
    )
      throw Error("Sandbox attempts always start with five minutes");
    store.db.transaction(() => {
      for (const name of b.usernames) {
        const r = store.db
          .prepare(
            "SELECT exam,username,webcam,duration,uid FROM enrollments WHERE exam=? AND username=?",
          )
          .get(req.params.exam, name) as any;
        if (!r)
          throw Error(
            `${name} is no longer enrolled; refresh the student list`,
          );
        store.db
          .prepare(
            "UPDATE enrollments SET duration=?,webcam=? WHERE exam=? AND username=?",
          )
          .run(
            b.duration === undefined ? r.duration : b.duration,
            b.webcam === undefined
              ? r.webcam
              : b.webcam === null
                ? null
                : Number(b.webcam),
            req.params.exam,
            name,
          );
      }
      store.audit(
        actor.username,
        "student-settings",
        req.params.exam,
        JSON.stringify(b),
      );
    })();
    return { updated: b.usernames.length };
  });
  app.post("/api/admin/exams/:exam/attempts/clocks", async (req: any) => {
    const actor = principal(req, "admin");
    const exam = findExam(req.params.exam);
    const b = z
      .object({
        action: z.enum(["reset", "extend"]),
        minutes: z.number().int().min(1).max(360).optional(),
        targets: z
          .array(
            z.object({
              id: z.string().uuid(),
              revision: z.number().int().min(0),
              requestID: z.string().uuid(),
            }),
          )
          .min(1)
          .max(100),
      })
      .parse(req.body);
    if (b.action === "extend" && b.minutes === undefined)
      throw Error("Enter minutes to add");
    if (new Set(b.targets.map((t) => t.id)).size !== b.targets.length)
      throw Error("Duplicate attempt selection");
    for (const t of b.targets)
      if (store.attempt(t.id).exam !== req.params.exam)
        throw Object.assign(Error("Attempt is not in the selected exam"), {
          statusCode: 403,
        });
    const health = await agent.call("health");
    if (
      !health.fixture &&
      ![
        "clock-reset",
        "deadline-timing-check",
        ...(b.action === "extend" ? ["clock-extend"] : []),
      ].every((c) => health.capabilities?.includes(c))
    )
      throw Error("Update the class-server agent before changing clocks");
    const results = [];
    // Persist each request before returning; existing SSH heartbeat delivery and
    // the signed deadline check apply it even after this HTTP request ends.
    for (const t of b.targets) {
      try {
        const attempt = store.attempt(t.id);
        const row = store.db
          .prepare(
            "SELECT duration FROM enrollments WHERE exam=? AND username=?",
          )
          .get(req.params.exam, attempt.username) as any;
        const minutes =
          b.action === "extend"
            ? b.minutes!
            : (isSandbox(req.params.exam)
                ? 300
                : (row?.duration ?? exam.duration)) / 60;
        const result = await clocks.reset(
          t.id,
          minutes,
          actor.username,
          t.revision,
          t.requestID,
          true,
          b.action === "extend",
        );
        results.push({
          id: t.id,
          status: result.confirmed ? "confirmed" : "pending",
          ...result,
        });
      } catch (error) {
        results.push({
          id: t.id,
          status: "failed",
          error: (error as Error).message,
        });
      }
    }
    return { results };
  });
}
