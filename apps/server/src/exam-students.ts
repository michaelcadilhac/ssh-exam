import type { Store } from "./db.js";
import { AttemptGrants } from "./attempt-grants.js";

export type ExamStudent = {
  exam: string;
  username: string;
  webcam: number | null;
  duration: number | null;
  uid: number;
};

// Shared read-only management membership. Admission remains a separate,
// explicitly reviewed operation: catalog reads must never restore sign-in.
// Callers: dashboard, roster/CSV, root management and reviewed grant issuance.
export class ExamStudents {
  constructor(
    private store: Store,
    private agent?: string,
  ) {}

  names(
    exam: string,
    options: { after?: string; search?: string; limit?: number } = {},
  ): string[] {
    return (
      this.store.db
        .prepare(
          `SELECT username FROM (
            SELECT username FROM enrollments WHERE exam=?
            UNION SELECT username FROM attempts WHERE exam=?
            UNION SELECT username FROM attempt_grants WHERE exam=? AND agent=?
          ) WHERE username>? AND username LIKE ? ORDER BY username LIMIT ?`,
        )
        .all(
          exam,
          exam,
          exam,
          this.agent ?? "",
          options.after ?? "",
          `%${options.search ?? ""}%`,
          options.limit ?? -1,
        ) as { username: string }[]
    ).map((row) => row.username);
  }

  has(exam: string, username: string): boolean {
    return !!this.store.db
      .prepare(
        `SELECT 1 FROM (
          SELECT username FROM enrollments WHERE exam=? AND username=?
          UNION ALL SELECT username FROM attempts WHERE exam=? AND username=?
          UNION ALL SELECT username FROM attempt_grants WHERE exam=? AND username=? AND agent=?
        ) LIMIT 1`,
      )
      .get(exam, username, exam, username, exam, username, this.agent ?? "");
  }

  get(exam: string, username: string): ExamStudent | undefined {
    const existing = this.store.db
      .prepare(
        "SELECT exam,username,webcam,duration,uid FROM enrollments WHERE exam=? AND username=?",
      )
      .get(exam, username) as ExamStudent | undefined;
    if (existing) return existing;
    if (!this.has(exam, username)) return undefined;
    const { settings } = new AttemptGrants(
      this.store,
      this.agent ?? "",
    ).latestSettingsFor(exam, username);
    return {
      exam,
      username,
      duration: settings.duration,
      webcam: Number(settings.webcam),
      // Snapshot metadata cannot establish a current authenticated NSS identity.
      uid: 0,
    };
  }

  hasHistory(exam: string, username: string): boolean {
    return !!this.store.db
      .prepare(
        `SELECT 1 FROM attempts WHERE exam=? AND username=?
         UNION ALL SELECT 1 FROM attempt_grants WHERE exam=? AND username=? LIMIT 1`,
      )
      .get(exam, username, exam, username);
  }

  removable(exam: string, username: string): boolean {
    return this.has(exam, username) && !this.hasHistory(exam, username);
  }
}
