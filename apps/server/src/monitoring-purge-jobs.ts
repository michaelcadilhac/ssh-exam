import { randomUUID } from "node:crypto";
import { now, type Store } from "./db.js";
import {
  MonitoringPurgeProcess,
  MonitoringPurgeError,
} from "./monitoring-purge-process.js";

// Must run in the same metadata transaction as the tombstone and scrubbing.
export function enqueueMonitoringPurge(store: Store, id: string) {
  store.db
    .prepare(
      `INSERT INTO monitoring_purges(attempt,status,next,updated)
    SELECT attempt,'pending',?,? FROM tombstones WHERE attempt=?
    ON CONFLICT(attempt) DO UPDATE SET
      status=CASE WHEN status='running' THEN status ELSE 'pending' END,
      next=CASE WHEN status='running' THEN next ELSE excluded.next END,
      updated=excluded.updated`,
    )
    .run(now(), now(), id);
}

export function monitoringPurgeStatus(store: Store, id: string) {
  const job = store.db
    .prepare(
      `SELECT status,tries,next,updated,verified,error
    FROM monitoring_purges WHERE attempt=?`,
    )
    .get(id) as any;
  if (!job) return { status: "not-verified", verified: null };
  return {
    ...job,
    scope:
      "current private monitoring directory only; not backup or secure disk erasure",
    guidance: job.error
      ? "Deletion remains in force. Inspect private storage permissions/capacity and worker diagnostics; automatic retry preserves tombstones"
      : "Logical deletion is immediate; physical removal is verified separately and periodically rechecked",
  };
}

// One gateway is supported. The persistent worker flock additionally prevents
// overlap with an orphaned pre-restart worker; SQL owner UUIDs fence late replies.
export class MonitoringPurgeJobs {
  private process: MonitoringPurgeProcess;
  private active?: Promise<void>;
  private stopped = false;
  private backfillAfter = "";
  private unsettled?: { attempt: string; owner: string };
  constructor(
    private store: Store,
    private options: {
      entry?: URL;
      timeoutMs?: number;
      onFailure?: (code: string) => void;
    } = {},
  ) {
    this.process = new MonitoringPurgeProcess(store, options);
    // Restart never means erasure succeeded. A surviving worker still owns the
    // kernel lock; a new attempt gets busy until its actual exit, not a lease timeout.
    store.db
      .prepare(
        `UPDATE monitoring_purges SET status='pending',owner=NULL,next=?,updated=?,error='coordinator-restarted'
      WHERE status='running'`,
      )
      .run(now(), now());
  }
  kick() {
    if (this.stopped) return Promise.resolve();
    if (this.active) return this.active;
    const task = this.runOne().catch(() => {
      // DB/inventory faults must not escape a timer or expose private SQL/paths.
      this.report("job-store-unavailable");
    });
    this.active = task;
    void task.finally(() => {
      if (this.active === task) this.active = undefined;
    });
    return task;
  }
  private report(code: string) {
    try {
      this.options.onFailure?.(code);
    } catch {
      /* Diagnostics cannot become an unhandled timer rejection. */
    }
  }
  private async runOne() {
    if (this.unsettled) {
      // A previous worker exited but recording its result failed. Retry only
      // this exact ownership claim; never clear a newer coordinator's claim.
      this.store.db
        .prepare(
          `UPDATE monitoring_purges SET status='pending',owner=NULL,next=?,updated=?,error='metadata-commit-unconfirmed'
        WHERE attempt=? AND owner=? AND status='running'`,
        )
        .run(now(), now(), this.unsettled.attempt, this.unsettled.owner);
      this.unsettled = undefined;
    }
    const owner = randomUUID();
    let nextAfter = this.backfillAfter;
    const job = this.store.db.transaction(() => {
      // Bounded backfill for old ledgers, including deleted preparation rows.
      const rows = this.store.db
        .prepare(
          "SELECT attempt FROM tombstones WHERE attempt>? ORDER BY attempt LIMIT 100",
        )
        .all(this.backfillAfter) as { attempt: string }[];
      const insert = this.store.db.prepare(
        `INSERT OR IGNORE INTO monitoring_purges(attempt,status,next,updated) VALUES(?,'pending',?,?)`,
      );
      for (const row of rows) insert.run(row.attempt, now(), now());
      nextAfter = rows.length === 100 ? rows.at(-1)!.attempt : "";
      const row = this.store.db
        .prepare(
          `SELECT attempt,tries FROM monitoring_purges
        WHERE status!='running' AND next<=?
        AND attempt IN (SELECT attempt FROM tombstones)
        ORDER BY next,attempt LIMIT 1`,
        )
        .get(now()) as { attempt: string; tries: number } | undefined;
      if (!row) return;
      this.store.db
        .prepare(
          `UPDATE monitoring_purges SET status='running',owner=?,tries=MIN(tries+1,2147483647),updated=?,error=NULL
        WHERE attempt=?`,
        )
        .run(owner, now(), row.attempt);
      return row;
    })();
    this.backfillAfter = nextAfter; // Advance only after successful transaction commit.
    if (!job) return;
    this.unsettled = { attempt: job.attempt, owner };
    try {
      await this.process.run(job.attempt); // NO worker/FS IO inside SQLite transaction.
      const at = now();
      this.store.db
        .prepare(
          `UPDATE monitoring_purges SET status='verified-absent',owner=NULL,verified=?,updated=?,next=?,error=NULL
        WHERE attempt=? AND owner=? AND status='running'`,
        )
        .run(at, at, at + 3600000, job.attempt, owner);
      this.unsettled = undefined;
    } catch (error) {
      const code =
        error instanceof MonitoringPurgeError
          ? error.code
          : "worker-unavailable";
      const delay =
        code === "busy"
          ? 5000
          : Math.min(3600000, 10000 * 2 ** Math.min(job.tries, 9));
      this.store.db
        .prepare(
          `UPDATE monitoring_purges SET status='retry',owner=NULL,updated=?,next=?,error=?
        WHERE attempt=? AND owner=? AND status='running'`,
        )
        .run(now(), now() + delay, code, job.attempt, owner);
      this.unsettled = undefined;
      this.report(code);
    }
  }
  async close() {
    this.stopped = true;
    await this.process.close();
    await this.active;
  }
}
