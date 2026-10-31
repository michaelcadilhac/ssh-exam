import { randomUUID } from "node:crypto";
import { z } from "zod";
import { username, examSchema } from "../../../packages/protocol/index.js";
import { isSandbox, sandboxExam } from "../../../packages/protocol/sandbox.js";
import { hash, now, type Store } from "./db.js";
import { exportRoster, parseRosterAsync, type RosterRow } from "./roster.js";
import { recoveryAllowanceEdit } from "../../../packages/protocol/recovery-allowance.js";
import { AttemptGrants } from "./attempt-grants.js";
import { ExamDefinitions } from "./exam-definitions.js";

const examID = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const allowance = z.number().int().min(60).max(21600).multipleOf(60).nullable();
const windowFields = {
  earliest: z.number().int().safe().positive().max(8639999999999999).optional(),
  latest: z.number().int().safe().positive().max(8639999999999999).optional(),
};
const checkWindow = (
  value: { earliest?: number; latest?: number },
  context: z.RefinementCtx,
) => {
  if ((value.earliest === undefined) !== (value.latest === undefined))
    context.addIssue({
      code: "custom",
      message:
        "Choose both opening and closing times, or omit both to use Exam defaults.",
    });
  else if (value.earliest !== undefined && value.latest! <= value.earliest)
    context.addIssue({
      code: "custom",
      message: "The closing time must be after the opening time.",
    });
};
const enrollmentWindow = z.object(windowFields).superRefine(checkWindow);
export const rosterAdd = z
  .object({
    username,
    webcam: z.boolean().nullable().default(null),
    duration: allowance.default(null),
    ...windowFields,
    definition_revision: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .superRefine(checkWindow);
export const rosterRemove = z.object({ username, confirm: z.literal(true) });
export const rosterSettings = z
  .object({
    usernames: z.array(username).min(1).max(1000),
    duration: allowance.optional(),
    webcam: z.boolean().nullable().optional(),
  })
  .refine(
    (b) => b.duration !== undefined || b.webcam !== undefined,
    "Choose a setting to change",
  );
export const rosterPreview = z
  .object({
    text: z.string(),
    mode: z.enum(["csv", "lines"]).default("csv"),
    ...windowFields,
  })
  .superRefine(checkWindow);

// Shared web/root roster authority. Never treats a caller-provided UID as a
// trusted identity; only the student's authenticated native SSH may resolve it.
export class RosterManagement {
  constructor(
    private store: Store,
    private describe: (a: any) => any = (a) => a,
    private agent?: string,
  ) {}
  private findExam(id: string) {
    examID.parse(id);
    if (!this.store.db.prepare("SELECT 1 FROM exams WHERE id=?").get(id))
      throw Error("Exam not found");
  }
  private duration(id: string, value: number | null | undefined) {
    if (isSandbox(id) && value !== undefined && value !== null && value !== 300)
      throw Error("Sandbox attempts always start with five minutes");
  }
  private window(id: string, input: unknown) {
    const selected = enrollmentWindow.parse(input);
    if (selected.earliest === undefined) return undefined;
    if (isSandbox(id))
      throw Error(
        "Practice dates come from Exam defaults. Enrollment cannot change them.",
      );
    return { earliest: selected.earliest, latest: selected.latest! };
  }
  allowanceEdit(id: string, name: string) {
    const row = this.store.db
      .prepare(
        "SELECT revision,duration,actor,at FROM recovery_allowance_edits WHERE exam=? AND username=? ORDER BY revision DESC LIMIT 1",
      )
      .get(id, name);
    return row ? recoveryAllowanceEdit.parse(row) : null;
  }
  private authorizeAllowance(
    id: string,
    name: string,
    duration: number | null,
    actor: string,
  ) {
    if (isSandbox(id)) return;
    const configured = JSON.parse(
      (
        this.store.db
          .prepare("SELECT config FROM exams WHERE id=?")
          .get(id) as any
      ).config,
    );
    const effective = allowance.parse(duration ?? configured.duration);
    if (effective === null)
      throw Error("Configure an exam allowance before choosing inheritance");
    const at = now();
    this.store.db
      .prepare(
        "INSERT INTO recovery_allowance_edits(exam,username,duration,actor,at) VALUES(?,?,?,?,?)",
      )
      .run(id, name, effective, actor, at);
    this.store.audit(
      actor,
      "authorize-recovery-allowance",
      id,
      JSON.stringify({ username: name, ...this.allowanceEdit(id, name) }),
    );
  }
  list(id: string, after = "", limit = -1) {
    this.findExam(id);
    return (
      this.store.db
        .prepare(
          "SELECT exam,username,webcam,duration,uid FROM enrollments WHERE exam=? AND username>? ORDER BY username LIMIT ?",
        )
        .all(id, after, limit) as any[]
    ).map((row) => {
      const a = this.store.db
        .prepare(
          "SELECT * FROM attempts WHERE exam=? AND username=? ORDER BY state IN ('ACTIVE','LOCKED','PREPARING') DESC,rowid DESC LIMIT 1",
        )
        .get(id, row.username);
      return {
        ...row,
        attempt: a ? this.describe(a) : null,
        recovery_allowance_edit: this.allowanceEdit(id, row.username),
      };
    });
  }
  page(id: string, after: string, limit: number) {
    const rows = this.list(id, after, limit + 1);
    return {
      students: rows.slice(0, limit),
      next: rows.length > limit ? rows[limit - 1].username : null,
      capabilities: ["enrollment-dates-v1"],
    };
  }
  add(id: string, input: unknown, actor: string) {
    this.findExam(id);
    const b = rosterAdd.parse(input);
    const window = this.window(id, b);
    this.duration(id, b.duration);
    this.store.db.transaction(() => {
      const definition = new ExamDefinitions(
        this.store,
        this.agent,
      ).requireActive(id);
      if (
        b.definition_revision &&
        b.definition_revision !== definition.revision
      )
        throw Object.assign(
          Error(
            "Exam defaults changed. Review the current defaults and try again; no student was added.",
          ),
          { statusCode: 409 },
        );
      if (
        this.store.db
          .prepare("SELECT 1 FROM enrollments WHERE exam=? AND username=?")
          .get(id, b.username)
      )
        throw Error("Student is already enrolled in this exam");
      if (!isSandbox(id)) {
        if (!this.agent)
          throw Error(
            "Configured class agent identity required for initial grant issuance; no enrollment committed",
          );
        new AttemptGrants(this.store, this.agent).initial(
          id,
          b.username,
          b.duration,
          b.webcam,
          actor,
          window,
        );
      }
      this.store.db
        .prepare(
          "INSERT INTO enrollments(exam,username,webcam,duration,uid) VALUES(?,?,?,?,?)",
        )
        .run(
          id,
          b.username,
          b.webcam === null ? null : Number(b.webcam),
          b.duration,
          0,
        );
      this.store.audit(actor, "enroll-student", id, b.username);
      if (b.duration !== null)
        this.authorizeAllowance(id, b.username, b.duration, actor);
    })();
    return { ok: true };
  }
  remove(id: string, input: unknown, actor: string) {
    this.findExam(id);
    const b = rosterRemove.parse(input);
    this.store.db.transaction(() => {
      this.store.db
        .prepare("DELETE FROM enrollments WHERE exam=? AND username=?")
        .run(id, b.username);
      this.store.audit(actor, "remove-enrollment", id, b.username);
    })();
    return { ok: true };
  }
  settings(id: string, input: unknown, actor: string) {
    this.findExam(id);
    const b = rosterSettings.parse(input);
    if (new Set(b.usernames).size !== b.usernames.length)
      throw Error("Duplicate student selection");
    this.duration(id, b.duration);
    this.store.db.transaction(() => {
      new ExamDefinitions(this.store, this.agent).requireActive(id);
      for (const name of b.usernames) {
        const r = this.store.db
          .prepare(
            "SELECT exam,username,webcam,duration,uid FROM enrollments WHERE exam=? AND username=?",
          )
          .get(id, name) as any;
        if (!r)
          throw Error(
            `${name} is no longer enrolled; refresh the student list`,
          );
        if (b.duration !== undefined)
          this.authorizeAllowance(id, name, b.duration, actor);
        this.store.db
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
            id,
            name,
          );
      }
      this.store.audit(actor, "student-settings", id, JSON.stringify(b));
    })();
    return { updated: b.usernames.length };
  }
  async preview(id: string, input: unknown, actor: string) {
    const b = rosterPreview.parse(input);
    const rows = await parseRosterAsync(b.text, b.mode);
    return this.previewRows(id, rows, hash(b.text), actor, b);
  }
  // Parsing is pure/async and must happen before entering a management SQLite
  // transaction. Dependency reads and preview publication are synchronous here.
  previewRows(
    id: string,
    rows: RosterRow[],
    checksum: string,
    actor: string,
    input: unknown = {},
  ) {
    this.findExam(id);
    const selectedWindow = this.window(id, input);
    for (const row of rows) this.duration(id, row.duration);
    return this.store.db.transaction(() => {
      const definition = new ExamDefinitions(
        this.store,
        this.agent,
      ).requireActive(id);
      // Enrollment does not authorize practice. Preserve legacy closed/unset
      // sandbox dates while using its fixed five-minute/no-webcam defaults.
      const configured = isSandbox(id)
        ? sandboxExam(definition.exam.template, definition.exam)
        : examSchema.parse(definition.exam);
      const window = selectedWindow ?? {
        earliest: configured.earliest,
        latest: configured.latest,
      };
      const defaults = {
        duration: configured.duration,
        webcam: configured.webcam,
      };
      const existing = new Map(
        (
          this.store.db
            .prepare(
              "SELECT exam,username,webcam,duration,uid FROM enrollments WHERE exam=?",
            )
            .all(id) as any[]
        ).map((r) => [r.username, r]),
      );
      const result = rows.map((r, index) => ({
        ...r,
        uid: existing.get(r.username)?.uid ?? 0,
        action: !existing.has(r.username)
          ? "add"
          : (
                [
                  ["webcam", r.webcam],
                  ["duration", r.duration],
                ] as const
              ).some(
                ([key, value]) =>
                  value !== undefined &&
                  (key === "webcam" && value !== null
                    ? Number(value)
                    : value) !== existing.get(r.username)[key],
              )
            ? "update"
            : "unchanged",
        activeAttempt: !!this.store.db
          .prepare(
            "SELECT 1 FROM attempts WHERE exam=? AND username=? AND state IN ('PREPARING','ACTIVE','LOCKED','FINALIZING')",
          )
          .get(id, r.username),
        rowNumber: index + 2,
        previous: existing.get(r.username) || null,
      }));
      const preview = randomUUID();
      this.store.db
        .prepare("INSERT INTO previews(id,exam,rows,created) VALUES(?,?,?,?)")
        .run(
          preview,
          id,
          JSON.stringify({
            version: 2,
            agent: this.agent ?? null,
            definition_revision: definition.revision,
            window,
            defaults,
            rows: result,
            checksum,
          }),
          now(),
        );
      this.store.audit(
        actor,
        "roster-preview",
        id,
        JSON.stringify({
          preview,
          rows: result.length,
          checksum,
          window,
          definition_revision: definition.revision,
        }),
      );
      return {
        id: preview,
        total: result.length,
        rows: result,
        checksum,
        earliest: window.earliest,
        latest: window.latest,
        defaults,
        summary: {
          added: result.filter((r) => r.action === "add").length,
          changed: result.filter((r) => r.action === "update").length,
          unchanged: result.filter((r) => r.action === "unchanged").length,
        },
      };
    })();
  }
  confirm(id: string, preview: string, actor: string) {
    this.findExam(id);
    z.string().uuid().parse(preview);
    const reviewRequired = (message: string): never => {
      throw Object.assign(Error(message), { code: "ROSTER_REVIEW_REQUIRED" });
    };
    return this.store.db.transaction(() => {
      const definition = new ExamDefinitions(
        this.store,
        this.agent,
      ).requireActive(id);
      const p = this.store.db
        .prepare("SELECT * FROM previews WHERE id=? AND exam=?")
        .get(preview, id) as any;
      if (!p)
        return reviewRequired(
          "Review not found. Review the CSV again for this exam.",
        );
      if (p.consumed) return { ok: true };
      if (now() - p.created > 600000)
        return reviewRequired("Review expired. Review the CSV again.");
      const imported = JSON.parse(p.rows);
      if (
        imported?.version !== 2 ||
        !Array.isArray(imported.rows) ||
        !(typeof imported.agent === "string" || imported.agent === null) ||
        !/^[a-f0-9]{64}$/.test(imported.definition_revision ?? "") ||
        !Number.isSafeInteger(imported.window?.earliest) ||
        !Number.isSafeInteger(imported.window?.latest) ||
        (!isSandbox(id) && imported.window.latest <= imported.window.earliest)
      )
        return reviewRequired(
          "This review has outdated settings. Review the CSV again.",
        );
      if (imported.agent !== (this.agent ?? null))
        return reviewRequired(
          "The class server changed since preview. Review the CSV again.",
        );
      if (imported.definition_revision !== definition.revision)
        return reviewRequired(
          "Exam defaults changed since preview. Review the CSV again.",
        );
      const rows = imported.rows;
      // Validate every target before any grant/enrollment/allowance mutation.
      for (const r of rows) {
        const previous = this.store.db
          .prepare(
            "SELECT exam,username,webcam,duration,uid FROM enrollments WHERE exam=? AND username=?",
          )
          .get(id, r.username) as any;
        if (
          JSON.stringify(previous || null) !==
          JSON.stringify(r.previous || null)
        )
          return reviewRequired("Roster changed since preview; validate again");
      }
      for (const r of rows) {
        const previous = r.previous;
        if (!previous && !isSandbox(id)) {
          if (!this.agent)
            throw Error(
              "Configured class agent identity required for initial grant issuance; no import committed",
            );
          new AttemptGrants(this.store, this.agent).initial(
            id,
            r.username,
            r.duration ?? null,
            r.webcam ?? null,
            actor,
            imported.window,
          );
        }
        this.store.db
          .prepare(
            "INSERT INTO enrollments(exam,username,webcam,duration,uid) VALUES(?,?,?,?,?) ON CONFLICT(exam,username) DO UPDATE SET webcam=excluded.webcam,duration=excluded.duration,uid=excluded.uid",
          )
          .run(
            id,
            r.username,
            r.webcam === undefined
              ? (previous?.webcam ?? null)
              : r.webcam === null
                ? null
                : Number(r.webcam),
            r.duration === undefined
              ? (previous?.duration ?? null)
              : r.duration,
            previous?.uid ?? 0,
          );
        if (r.duration !== undefined && (previous || r.duration !== null))
          this.authorizeAllowance(id, r.username, r.duration, actor);
      }
      this.store.db
        .prepare("UPDATE previews SET consumed=1 WHERE id=?")
        .run(preview);
      this.store.audit(
        actor,
        "roster-import",
        id,
        JSON.stringify({
          rows: rows.length,
          checksum: imported.checksum || null,
          activeSnapshotsUnchanged: true,
          window: imported.window,
          definition_revision: imported.definition_revision,
        }),
      );
      return { ok: true };
    })();
  }
  export(id: string) {
    this.findExam(id);
    return exportRoster(
      this.store.db
        .prepare(
          "SELECT exam,username,webcam,duration,uid FROM enrollments WHERE exam=? ORDER BY username",
        )
        .all(id),
    );
  }
  example(id: string) {
    this.findExam(id);
    return exportRoster([
      { username: "student01", webcam: null, duration: null },
      { username: "student02", webcam: true, duration: null },
      { username: "student03", webcam: false, duration: null },
    ]);
  }
}
