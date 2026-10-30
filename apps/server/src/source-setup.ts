import { randomUUID } from "node:crypto";
import { z } from "zod";
import { now, type Store } from "./db.js";
import { grantSourceRequest } from "../../../packages/protocol/grants.js";

const conflict = (message: string): never => {
  throw Object.assign(Error(message), { statusCode: 409 });
};
export function enqueueSourceSetup(
  store: Store,
  agent: string,
  id: string,
  revision: number,
) {
  const at = now();
  store.db
    .prepare(
      "INSERT INTO grant_source_setup(grant_id,revision,agent,confirm_request,status,created,updated) VALUES(?,?,?,?,'QUEUED',?,?) ON CONFLICT(grant_id,revision) DO NOTHING",
    )
    .run(id, revision, agent, randomUUID(), at, at);
}

// Shared authenticated web/root inspection and retry, plus root-only worker
// leases. These records are NOT retention proof or permission to begin.
export class SourceSetup {
  constructor(
    private store: Store,
    private agent: string,
  ) {}
  private grant(id: string) {
    const row = this.store.db
      .prepare(
        "SELECT g.*,r.hash,r.work,r.settings,m.archived,m.deleted FROM attempt_grants g JOIN grant_revisions r ON r.grant_id=g.id AND r.revision=g.revision JOIN exam_lifecycle m ON m.exam=g.exam WHERE g.id=? AND g.agent=?",
      )
      .get(id, this.agent) as any;
    if (!row)
      return conflict(
        "Attempt permission unavailable. Refresh the selected exam.",
      );
    return row;
  }
  private reconcile(id: string, revision: number) {
    const row = this.grant(id),
      task = this.store.db
        .prepare(
          "SELECT * FROM grant_source_setup WHERE grant_id=? AND revision=? AND agent=?",
        )
        .get(id, revision, this.agent) as any;
    if (!task) return null;
    const proof = this.store.db
      .prepare(
        "SELECT 1 FROM grant_source_retentions WHERE grant_id=? AND revision=? AND grant_hash=? AND state='RETAINED'",
      )
      .get(id, revision, row.hash);
    const status =
      row.revision !== revision || row.status === "REVOKED"
        ? "CANCELLED"
        : proof && ["AVAILABLE", "CONSUMED"].includes(row.status)
          ? "READY"
          : row.archived ||
              row.deleted ||
              JSON.parse(row.settings).latest <= now()
            ? "CANCELLED"
            : null;
    if (status && status !== task.status) {
      this.store.db
        .prepare(
          "UPDATE grant_source_setup SET status=?,lease=NULL,lease_until=NULL,error=CASE WHEN ?='READY' THEN '' ELSE error END,updated=? WHERE grant_id=? AND revision=?",
        )
        .run(status, status, now(), id, revision);
      task.status = status;
      task.lease = null;
      task.lease_until = null;
      task.updated = now();
      if (status === "READY") task.error = "";
    }
    return task;
  }
  show(input: unknown) {
    const b = grantSourceRequest.parse(input),
      grant = this.grant(b.id),
      task = this.reconcile(b.id, b.revision);
    return {
      id: b.id,
      revision: b.revision,
      current_revision: grant.revision,
      grant_status: grant.status,
      status: task?.status ?? "NOT_QUEUED",
      tries: task?.tries ?? 0,
      error: task?.error ?? "",
      updated: task?.updated ?? null,
    };
  }
  private source(work: any, username: string) {
    if (work.kind !== "saved") return null;
    const source = this.store.db
      .prepare(
        "SELECT a.id,a.exam,a.start,a.settings,(SELECT COUNT(*) FROM attempts earlier WHERE earlier.exam=a.exam AND earlier.username=a.username AND earlier.rowid<=a.rowid) attempt_number FROM attempts a WHERE a.id=? AND a.username=? AND a.checksum=?",
      )
      .get(work.attempt, username, work.checksum) as any;
    if (!source) return null;
    let name = source.exam;
    try {
      name = JSON.parse(source.settings).name || name;
    } catch {
      /* Earlier display name only; the exam ID remains available. */
    }
    return {
      id: source.id,
      exam: source.exam,
      start: source.start,
      attempt_number: source.attempt_number,
      settings: { name },
    };
  }
  sources(rows: { username: string; work: any }[]) {
    return Object.fromEntries(
      rows
        .filter((row) => row.work.kind === "saved")
        .map((row) => [row.work.attempt, this.source(row.work, row.username)]),
    );
  }
  presentation(input: unknown) {
    const b = grantSourceRequest.parse(input);
    return this.store.db.transaction(() => {
      const setup = this.show(b),
        row = this.grant(b.id),
        settings = JSON.parse(row.settings);
      const claims = this.store.db
        .prepare(
          "SELECT state FROM grant_claims WHERE grant_id=? AND state<>'CANCELLED' LIMIT 1",
        )
        .all(b.id);
      const saved = this.store.db
        .prepare(
          "SELECT work FROM grant_revisions WHERE grant_id=? AND revision=?",
        )
        .get(b.id, b.revision) as any;
      if (!saved)
        return conflict(
          "Saved settings are unavailable for this revision. Inspect the attempt history.",
        );
      const work = JSON.parse(saved.work);
      return {
        ...setup,
        grant: {
          id: b.id,
          revision: row.revision,
          status: row.status,
          claims,
          settings: { earliest: settings.earliest, latest: settings.latest },
        },
        source: this.source(work, row.username),
      };
    })();
  }
  cohort(rows: { username: string; grant: string }[]) {
    return this.store.db.transaction(() =>
      rows.map((row) => ({
        username: row.username,
        ...this.presentation({ id: row.grant, revision: 1 }),
      })),
    )();
  }
  retry(input: unknown, actor: string) {
    const b = grantSourceRequest
      .extend({ request: z.string().uuid().optional() })
      .strict()
      .parse(input);
    return this.store.db.transaction(() => {
      const row = this.grant(b.id),
        old = this.reconcile(b.id, b.revision);
      if (old?.status === "READY")
        return this.show({ id: b.id, revision: b.revision });
      if (
        row.revision !== b.revision ||
        row.status !== "PENDING_NATIVE" ||
        row.archived ||
        row.deleted ||
        JSON.parse(row.settings).latest <= now() ||
        JSON.parse(row.work).kind !== "saved"
      )
        return conflict(
          "Saved-work setup is no longer applicable. Refresh the attempt's current settings.",
        );
      if (!old) enqueueSourceSetup(this.store, this.agent, b.id, b.revision);
      else if (
        old.status === "FAILED" ||
        (old.status === "RUNNING" && old.lease_until <= now())
      )
        this.store.db
          .prepare(
            "UPDATE grant_source_setup SET status='QUEUED',lease=NULL,lease_until=NULL,error='',updated=? WHERE grant_id=? AND revision=?",
          )
          .run(now(), b.id, b.revision);
      this.store.audit(
        actor,
        "retry-saved-work-setup",
        b.id,
        JSON.stringify({ revision: b.revision }),
      );
      return this.show({ id: b.id, revision: b.revision });
    })();
  }
  next(input: unknown, actor: string) {
    z.object({}).strict().parse(input);
    return this.store.db.transaction(() => {
      // At most 32 stale tasks are reconciled per poll; no archive IO in gateway.
      const tasks = this.store.db
        .prepare(
          "SELECT * FROM grant_source_setup WHERE agent=? AND (status='QUEUED' OR (status='RUNNING' AND lease_until<=?)) ORDER BY updated,grant_id,revision LIMIT 32",
        )
        .all(this.agent, now()) as any[];
      for (const candidate of tasks) {
        const task = this.reconcile(candidate.grant_id, candidate.revision);
        if (!task || !["QUEUED", "RUNNING"].includes(task.status)) continue;
        const lease = randomUUID(),
          until = now() + 180000;
        this.store.db
          .prepare(
            "UPDATE grant_source_setup SET status='RUNNING',lease=?,lease_until=?,tries=tries+1,updated=? WHERE grant_id=? AND revision=?",
          )
          .run(lease, until, now(), task.grant_id, task.revision);
        this.store.audit(
          actor,
          "start-saved-work-setup",
          task.grant_id,
          JSON.stringify({ revision: task.revision }),
        );
        return {
          task: {
            id: task.grant_id,
            revision: task.revision,
            request: task.confirm_request,
            lease,
            lease_until: until,
          },
        };
      }
      return { task: null };
    })();
  }
  report(input: unknown, actor: string) {
    const b = grantSourceRequest
      .extend({ lease: z.string().uuid(), error: z.string().max(4096) })
      .strict()
      .parse(input);
    return this.store.db.transaction(() => {
      const task = this.reconcile(b.id, b.revision);
      // Fresh positive native confirmation wins over a lost/reordered failure.
      if (task && ["READY", "CANCELLED"].includes(task.status))
        return this.show({ id: b.id, revision: b.revision });
      if (
        !task ||
        task.status !== "RUNNING" ||
        task.lease !== b.lease ||
        task.lease_until <= now()
      )
        return conflict(
          "Saved-work lease changed. Inspect current status; no completion was recorded.",
        );
      this.store.db
        .prepare(
          "UPDATE grant_source_setup SET status='FAILED',error=?,lease=NULL,lease_until=NULL,updated=? WHERE grant_id=? AND revision=?",
        )
        .run(
          b.error ||
            "File protection was not confirmed. Check the source and retry setup.",
          now(),
          b.id,
          b.revision,
        );
      this.store.audit(
        actor,
        "failed-saved-work-setup",
        b.id,
        JSON.stringify({ revision: b.revision, error: b.error }),
      );
      return this.show({ id: b.id, revision: b.revision });
    })();
  }
}
