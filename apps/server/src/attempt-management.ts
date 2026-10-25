import { Store, now } from "./db.js";
import { ClockControl } from "./clock-control.js";
import {
  attemptPage,
  attemptReference,
  clockIntentMetadata,
} from "../../../packages/protocol/clock-management.js";
import { matchesDashboardView } from "../../../packages/protocol/admin.js";
import { AttemptGrants } from "./attempt-grants.js";

// Read bounded current metadata, not page hashes, sessions, interruption/student
// text, media or unbounded reset history into permanent management outcomes.
const columns = `id,exam,username,uid,state,substr(settings,1,16385) settings,
preflight_started_at,start,deadline,original_deadline,clock_revision,ended,generation,
last_contact,substr(reason,1,1000) reason,work_path,export_status,checksum,protected,
completed_at,collected_at,secured_at,policy_state,policy_expires,
substr(policy_error,1,1500) policy_error,access_state,access_held_at,
access_released_at,substr(access_override,1,1000) access_override,
access_checked_at,substr(access_error,1,1500) access_error,functional_test,
grant_id,grant_revision,grant_hash,
(SELECT COUNT(*) FROM attempts earlier WHERE earlier.exam=attempts.exam
 AND earlier.username=attempts.username AND earlier.rowid<=attempts.rowid) attempt_number`;
export class AttemptManagement {
  private grants: AttemptGrants;
  constructor(
    private store: Store,
    private clocks: ClockControl,
    private describe: (a: any) => any,
    agent: string,
  ) {
    this.grants = new AttemptGrants(store, agent);
  }
  private project(row: any) {
    if (row.settings.length > 16384)
      throw Error(
        "Attempt settings exceed inspection bounds; preserve history and inspect native examctl info",
      );
    const raw = JSON.parse(row.settings);
    const settings = Object.fromEntries(
      [
        "id",
        "name",
        "duration",
        "webcam",
        "template",
        "template_version",
        "terminals",
        "earliest",
        "latest",
        "collection_file_mib",
        "collection_total_mib",
      ]
        .filter((k) => raw[k] !== undefined)
        .map((k) => [k, raw[k]]),
    );
    const described = this.describe({
      ...row,
      settings: JSON.stringify(settings),
    });
    return {
      ...row,
      settings,
      connected: !!described.connected,
      working: !!described.working,
      terminalCount: Number(described.terminalCount) || 0,
      grantContext: this.grants.forAttempt(row),
      pendingClockReset: clockIntentMetadata(this.clocks.pending(row.id)),
    };
  }
  show(id: string) {
    attemptReference.parse(id);
    const row = this.store.db
      .prepare(`SELECT ${columns} FROM attempts WHERE id=?`)
      .get(id);
    if (!row)
      throw Object.assign(
        Error(
          "Attempt not found; use examctl web attempts list EXAM or native examctl list",
        ),
        { statusCode: 404 },
      );
    return {
      attempt: this.project(row),
      serverNow: now(),
      source: "gateway metadata, not a fresh native verification",
    };
  }
  page(input: unknown) {
    const b = attemptPage.parse(input);
    if (!this.store.db.prepare("SELECT 1 FROM exams WHERE id=?").get(b.exam))
      throw Object.assign(Error("Exam not found; use examctl web exams list"), {
        statusCode: 404,
      });
    const rows = this.store.db
      .prepare(
        `SELECT ${columns} FROM attempts WHERE exam=? AND id>? AND username LIKE ? ORDER BY id LIMIT ?`,
      )
      .all(b.exam, b.after || "", `%${b.q}%`, b.limit + 1) as any[];
    const scanned = rows.slice(0, b.limit);
    return {
      attempts: scanned
        .map((r) => this.project(r))
        .filter((a) => matchesDashboardView(a, b.view)),
      scanned: scanned.length,
      next: rows.length > b.limit ? scanned.at(-1)!.id : null,
      serverNow: now(),
      source: "gateway metadata, not a fresh native verification",
      note: "limit bounds scanned rows; filtered pages may be empty with a next cursor. Historical reset detail remains in native examctl info.",
    };
  }
}
