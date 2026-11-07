import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Store } from "./db.js";
import { Agent } from "./agent.js";
import { ClockControl } from "./clock-control.js";
import { username } from "../../../packages/protocol/index.js";
import {
  dashboardViews,
  dashboardFilters,
  dashboardSorts,
  matchesDashboardStudent,
  compareDashboardStudents,
  needsAttention,
} from "../../../packages/protocol/admin.js";
import { isSandbox } from "../../../packages/protocol/sandbox.js";
import { RosterManagement } from "./roster-management.js";
import { AttemptGrants } from "./attempt-grants.js";
import { AttemptManagement } from "./attempt-management.js";
import { ExamStudents } from "./exam-students.js";
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
  const attempts = new AttemptManagement(store, clocks, describe, agent.id);
  const grants = new AttemptGrants(store, agent.id);
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
      filter = "",
      sort = "username",
    } = z
      .object({
        q: z.string().max(64).optional(),
        offset: z.string().optional(),
        view: z.enum(dashboardViews).optional(),
        filter: z.enum(dashboardFilters).optional(),
        sort: z.enum(dashboardSorts).optional(),
        review: z.string().uuid().optional(),
      })
      .parse(req.query);
    const start = Math.max(0, Math.floor(Number(offset) || 0));
    const catalog = new ExamStudents(store, agent.id);
    const allUsers = catalog.names(req.params.exam);
    const users = catalog.names(req.params.exam, { search: q });
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
      grantContext: grants.forAttempt(a),
      interruptions: interruptionHistory.get(a.id) || [],
      interruptionHistoryDeleted: deletedHistory.has(a.id),
    }));
    const grouped = new Map<string, any[]>();
    for (const attempt of all) {
      if (!grouped.has(attempt.username)) grouped.set(attempt.username, []);
      grouped.get(attempt.username)!.push(attempt);
    }
    // One bounded-shape SQL read avoids projecting every student's entire grant
    // history merely to filter before pagination. Contradictory grants fail closed.
    const available = new Set(
      (
        store.db
          .prepare(
            `
      SELECT g.username FROM attempt_grants g LEFT JOIN grant_revisions r ON r.grant_id=g.id AND r.revision=g.revision
      WHERE g.agent=? AND g.exam=? AND g.status IN ('AVAILABLE','PENDING_NATIVE')
      GROUP BY g.username HAVING count(*)=1 AND sum(CASE WHEN g.status='AVAILABLE' AND json_valid(r.settings)
        THEN CASE WHEN json_extract(r.settings,'$.latest')>=?
        AND NOT EXISTS(SELECT 1 FROM grant_claims c WHERE c.grant_id=g.id AND c.state<>'CANCELLED') THEN 1 ELSE 0 END ELSE 0 END)=1
    `,
          )
          .all(agent.id, req.params.exam, Date.now()) as { username: string }[]
      ).map((s) => s.username),
    );
    const matches = users
      .map((username) => {
        const attempts = grouped.get(username) || [];
        return {
          username,
          availableNextAttempt: available.has(username),
          attempts: attempts.map((a, i) => ({
            ...a,
            attempt_number: attempts.length - i,
          })),
        };
      })
      .filter((s) => matchesDashboardStudent(s, view, filter))
      .sort((a, b) => compareDashboardStudents(a, b, sort));
    const students = matches.slice(start, start + 100).map((s) => ({
      ...s,
      removable: catalog.removable(req.params.exam, s.username),
      hasCurrentAttempt: (grouped.get(s.username) ?? []).some((a) =>
        ["PREPARING", "ACTIVATING", "ACTIVE", "LOCKED", "FINALIZING"].includes(
          a.state,
        ),
      ),
      ...(() => {
        try {
          const unused = grants.unusedFor(req.params.exam, s.username);
          let sourceAttempt;
          if (unused?.work.kind === "saved") {
            const source = store.db
              .prepare(
                `SELECT a.id,a.exam,a.username,a.start,e.config,
              (SELECT count(*) FROM attempts p WHERE p.exam=a.exam AND p.username=a.username AND p.rowid<=a.rowid) attempt_number
              FROM attempts a JOIN exams e ON e.id=a.exam WHERE a.id=?`,
              )
              .get(unused.work.attempt) as any;
            if (!source || source.username !== s.username)
              throw Error("Saved files are unavailable for this student");
            sourceAttempt = {
              id: source.id,
              exam: source.exam,
              exam_name: JSON.parse(source.config).name,
              attempt_number: source.attempt_number,
              start: source.start,
            };
          }
          return {
            hasNextAttempt: !!grants.current(req.params.exam, s.username),
            grant: grants.initialFor(req.params.exam, s.username),
            unusedGrants: grants.unusedSummary(req.params.exam, s.username),
            unusedAttempt: unused
              ? { ...unused, ...(sourceAttempt ? { sourceAttempt } : {}) }
              : null,
            latestSettings: grants.latestSettingsFor(
              req.params.exam,
              s.username,
            ).settings,
          };
        } catch {
          return {
            hasNextAttempt: true,
            grant: null,
            unusedAttempt: null,
            latestSettings: null,
            grantError: true,
          };
        }
      })(),
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
        working: [...grouped.values()].filter((attempts) =>
          attempts.some((a) => a.working),
        ).length,
        attention: [...grouped.values()].filter((attempts) =>
          attempts.some(needsAttention),
        ).length,
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
    return new RosterManagement(store, describe, agent.id).settings(
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
