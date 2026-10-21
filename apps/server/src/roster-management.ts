import { randomUUID } from "node:crypto";
import { z } from "zod";
import { username } from "../../../packages/protocol/index.js";
import { isSandbox } from "../../../packages/protocol/sandbox.js";
import { hash, now, type Store } from "./db.js";
import { exportRoster, parseRosterAsync, type RosterRow } from "./roster.js";

const examID = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const allowance = z.number().int().min(60).max(21600).multipleOf(60).nullable();
export const rosterAdd = z.object({
  username,
  webcam: z.boolean().nullable().default(null),
  duration: allowance.default(null),
});
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
export const rosterPreview = z.object({
  text: z.string(),
  mode: z.enum(["csv", "lines"]).default("csv"),
});

// Shared web/root roster authority. Never treats a caller-provided UID as a
// trusted identity; only the student's authenticated native SSH may resolve it.
export class RosterManagement {
  constructor(
    private store: Store,
    private describe: (a: any) => any = (a) => a,
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
      return { ...row, attempt: a ? this.describe(a) : null };
    });
  }
  page(id: string, after: string, limit: number) {
    const rows = this.list(id, after, limit + 1);
    return {
      students: rows.slice(0, limit),
      next: rows.length > limit ? rows[limit - 1].username : null,
    };
  }
  add(id: string, input: unknown, actor: string) {
    this.findExam(id);
    const b = rosterAdd.parse(input);
    this.duration(id, b.duration);
    this.store.db.transaction(() => {
      if (
        this.store.db
          .prepare("SELECT 1 FROM enrollments WHERE exam=? AND username=?")
          .get(id, b.username)
      )
        throw Error("Student is already enrolled in this exam");
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
    return this.previewRows(id, rows, hash(b.text), actor);
  }
  // Parsing is pure/async and must happen before entering a management SQLite
  // transaction. Dependency reads and preview publication are synchronous here.
  previewRows(id: string, rows: RosterRow[], checksum: string, actor: string) {
    this.findExam(id);
    for (const row of rows) this.duration(id, row.duration);
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
                (key === "webcam" && value !== null ? Number(value) : value) !==
                  existing.get(r.username)[key],
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
    this.store.db.transaction(() => {
      this.store.db
        .prepare("INSERT INTO previews(id,exam,rows,created) VALUES(?,?,?,?)")
        .run(preview, id, JSON.stringify({ rows: result, checksum }), now());
      this.store.audit(
        actor,
        "roster-preview",
        id,
        JSON.stringify({ preview, rows: result.length, checksum }),
      );
    })();
    return {
      id: preview,
      total: result.length,
      rows: result,
      checksum,
      summary: {
        added: result.filter((r) => r.action === "add").length,
        changed: result.filter((r) => r.action === "update").length,
        unchanged: result.filter((r) => r.action === "unchanged").length,
      },
    };
  }
  confirm(id: string, preview: string, actor: string) {
    this.findExam(id);
    z.string().uuid().parse(preview);
    return this.store.db.transaction(() => {
      const p = this.store.db
        .prepare("SELECT * FROM previews WHERE id=? AND exam=?")
        .get(preview, id) as any;
      if (!p)
        throw Error("Preview not found; run import-preview for this exam");
      if (p.consumed) return { ok: true };
      if (now() - p.created > 600000)
        throw Error("Preview expired; run import-preview again");
      const imported = JSON.parse(p.rows);
      const rows = Array.isArray(imported) ? imported : imported.rows;
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
          throw Error("Roster changed since preview; validate again");
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
