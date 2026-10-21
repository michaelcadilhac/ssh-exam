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
import { RosterManagement } from "./roster-management.js";
import { AttemptManagement } from "./attempt-management.js";
import {
  ClockManagement,
  assertClockCapabilities,
} from "./clock-management.js";
import { clockBatchBody } from "../../../packages/protocol/clock-management.js";

export function registerExamAdmin(
  app: FastifyInstance,
  store: Store,
  agent: Agent,
  clocks: ClockControl,
  principal: (req: any, role: string) => any,
  describe: (a: any) => any,
) {
  const attempts = new AttemptManagement(store, clocks, describe);
  const clockManagement = new ClockManagement(store, clocks, attempts);
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
    const interruptionHistory = store.interruptions.forExam(req.params.exam);
    const deletedHistory = new Set(
      (
        store.db
          .prepare(
            "SELECT t.attempt FROM tombstones t JOIN attempts a ON a.id=t.attempt WHERE a.exam=?",
          )
          .all(req.params.exam) as any[]
      ).map((r) => r.attempt),
    );
    const all = (
      store.db
        .prepare("SELECT * FROM attempts WHERE exam=? ORDER BY rowid DESC")
        .all(req.params.exam) as any[]
    ).map((a) => ({
      ...describe(a),
      interruptions: interruptionHistory.get(a.id) || [],
      interruptionHistoryDeleted: deletedHistory.has(a.id),
    }));
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
    return new RosterManagement(store, describe).settings(
      req.params.exam,
      req.body,
      actor.username,
    );
  });
  app.post("/api/admin/exams/:exam/attempts/clocks", async (req: any) => {
    const actor = principal(req, "admin");
    const b = clockBatchBody.parse(req.body);
    const health = await agent.call("health");
    assertClockCapabilities(health, b.action === "extend");
    return clockManagement.batch(
      { ...b, exam: req.params.exam },
      actor.username,
    );
  });
}
