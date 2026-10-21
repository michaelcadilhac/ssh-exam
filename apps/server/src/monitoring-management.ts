import { hash, now, type Store } from "./db.js";
import type { Monitoring } from "./monitoring.js";
import { monitoringPurgeStatus } from "./monitoring-purge-jobs.js";
import {
  monitoringList,
  monitoringReplay,
  parseMonitoring,
  monitoringDelete,
  monitoringShow,
  monitoringPurges,
} from "../../../packages/protocol/monitoring-management.js";

const refuse = (message: string, statusCode = 409): never => {
  throw Object.assign(Error(message), { statusCode });
};
const retention =
  "transient private read; permanent retry receipt contains no monitoring payload; deletion is rechecked on every retry";

export class MonitoringManagement {
  constructor(
    private store: Store,
    private monitoring: Monitoring,
  ) {}

  private inventoryRead<T>(read: () => T): T {
    try {
      return read();
    } catch (error) {
      if ((error as any)?.statusCode) throw error;
      return refuse(
        "Purge metadata unavailable; preserve tombstones/jobs and inspect private database/storage diagnostics. Use a NEW --request for a fresh inventory retry",
        503,
      );
    }
  }

  purge(input: unknown, actor: string) {
    const { id } = monitoringShow.parse(input);
    return this.inventoryRead(() => {
      const tombstone = this.store.db
        .prepare("SELECT deleted FROM tombstones WHERE attempt=?")
        .get(id) as any;
      if (!tombstone)
        return refuse(
          `No durable monitoring deletion record; inspect examctl web monitoring show ${id}`,
          404,
        );
      const attempt =
        this.store.db
          .prepare(
            "SELECT id,exam,username,state,ended FROM attempts WHERE id=?",
          )
          .get(id) ?? null;
      this.store.audit(actor, "view-monitoring-purge", id);
      return {
        id,
        deleted: tombstone.deleted,
        attempt,
        job: monitoringPurgeStatus(this.store, id),
        observed: now(),
        note: "Metadata snapshot, not a new filesystem verification. Use a NEW --request for fresh status. A retired preparation may have no attempt row; keep its tombstone/job",
      };
    });
  }

  purges(input: unknown, actor: string) {
    const b = monitoringPurges.parse(input);
    return this.inventoryRead(() => {
      const fields = `SELECT t.attempt id,t.deleted,COALESCE(p.status,'not-verified') status,p.updated,p.verified,p.next,p.error,p.tries,
      a.exam,a.username,a.state `;
      const rows = (
        b.status
          ? this.store.db
              .prepare(
                fields +
                  `FROM monitoring_purges p JOIN tombstones t ON t.attempt=p.attempt LEFT JOIN attempts a ON a.id=t.attempt
        WHERE p.status=? AND p.attempt>? ORDER BY p.attempt LIMIT ?`,
              )
              .all(b.status, b.after ?? "", b.limit + 1)
          : this.store.db
              .prepare(
                fields +
                  `FROM tombstones t LEFT JOIN monitoring_purges p ON p.attempt=t.attempt LEFT JOIN attempts a ON a.id=t.attempt
        WHERE t.attempt>? ORDER BY t.attempt LIMIT ?`,
              )
              .all(b.after ?? "", b.limit + 1)
      ) as any[];
      const entries = rows.slice(0, b.limit);
      this.store.audit(
        actor,
        "list-monitoring-purges",
        "monitoring",
        JSON.stringify({
          after: b.after ?? null,
          limit: b.limit,
          status: b.status ?? null,
        }),
      );
      return {
        entries,
        next: rows.length > b.limit ? entries.at(-1)!.id : null,
        observed: now(),
        note: "Bounded live metadata inventory, not a stable export or fresh filesystem proof. New/changed rows may require restarting the list. Use NEW --request IDs for fresh pages; purge-status ATTEMPT inspects even retired preparation jobs",
      };
    });
  }

  deletionReview(id: string) {
    const a = this.attempt(id, false);
    const revision = (
      this.store.db
        .prepare("SELECT continuation_revision FROM attempts WHERE id=?")
        .get(id) as any
    ).continuation_revision;
    return {
      id,
      confirm: a.username,
      revision: hash(JSON.stringify({ ...a, revision })),
      eligible: a.ended !== null,
      consequence:
        "Deletes all monitoring and rejects future late callbacks for this attempt. Protected submissions, receipts, clocks and account restrictions are unchanged. Physical purge is separate and asynchronous",
    };
  }

  delete(input: unknown, actor: string) {
    if ((input as any)?.confirm === true)
      return refuse(
        "Deletion requires a named target, reviewed revision, reason and intent. Reload web review or use examctl web monitoring show ATTEMPT then delete --confirm USERNAME --revision HASH --reason TEXT",
        400,
      );
    const b = monitoringDelete.parse(input),
      fingerprint = hash(JSON.stringify(b));
    try {
      return this.store.db.transaction(() => {
        const prior = this.store.db
          .prepare(
            "SELECT fingerprint,result FROM monitoring_deletion_requests WHERE actor=? AND request=?",
          )
          .get(actor, b.requestID) as any;
        if (prior) {
          if (prior.fingerprint !== fingerprint)
            return refuse(
              "Deletion intent conflicts with different arguments; inspect monitoring show and deliberately review a new intent",
            );
          return JSON.parse(prior.result);
        }
        const review = this.deletionReview(b.id);
        if (b.confirm !== review.confirm)
          return refuse(
            `Named confirmation does not match this attempt; use examctl web monitoring show ${b.id} and confirm the displayed student`,
          );
        if (b.revision !== review.revision)
          return refuse(
            `Monitoring deletion target changed after review; cancel, run examctl web monitoring show ${b.id} and deliberately use a NEW request/intent with the current deletionReview.revision`,
          );
        if (!review.eligible)
          return refuse(
            `Monitoring cannot be deleted before this attempt ends (current state ${this.store.attempt(b.id).state}). Inspect examctl web attempts show ${b.id}; deleting monitoring does not Finish, release access or collect saved files`,
          );
        this.monitoring.delete(b.id, actor);
        const result = {
          id: b.id,
          requestID: b.requestID,
          status: "logical-deletion-accepted",
          logicalDeleted: true,
          physicalPurge: "pending-verification",
          note: `Accepted intent, not a current physical-erasure receipt. Use examctl web monitoring show ${b.id} for fresh job status; protected submissions and account holds are unchanged`,
        };
        this.store.audit(
          actor,
          "monitoring-delete-intent",
          b.id,
          JSON.stringify({
            requestID: b.requestID,
            revision: b.revision,
            reason: b.reason,
          }),
        );
        this.store.db
          .prepare("INSERT INTO monitoring_deletion_requests VALUES(?,?,?,?,?)")
          .run(actor, b.requestID, fingerprint, JSON.stringify(result), now());
        return result;
      })();
    } catch (error) {
      if ((error as any)?.statusCode) throw error;
      return refuse(
        "Deletion result is not confirmed; preserve the intent and arguments, inspect fresh monitoring status and private database/storage diagnostics. Retry the same intent (CLI: NEW --request, SAME --intent). Do not remove deletion records",
        503,
      );
    }
  }

  private attempt(id: string, requireRetained = true) {
    const a = this.store.db
      .prepare(
        "SELECT id,exam,username,state,start,deadline,original_deadline,ended,protected,checksum FROM attempts WHERE id=?",
      )
      .get(id) as any;
    if (!a)
      return refuse(
        "Attempt not found; use examctl web attempts list EXAM",
        404,
      );
    const deletion = this.store.db
      .prepare("SELECT deleted FROM tombstones WHERE attempt=?")
      .get(id) as any;
    if (deletion && requireRetained)
      return refuse(
        "Monitoring was deleted; it cannot be replayed or exported. Protected submissions have independent retention",
        410,
      );
    return { ...a, monitoringDeleted: deletion?.deleted ?? null };
  }

  // Runs in the short management transaction. Never cache text or inventories;
  // no filesystem/native/network IO belongs in this receipt transaction.
  receipt(operation: string, input: unknown) {
    const b = parseMonitoring(operation, input);
    this.attempt(b.id, operation !== "monitoring.show");
    if (operation === "monitoring.list") {
      const page = monitoringList.parse(input);
      const table = page.section === "frames" ? "frames" : "recordings";
      const maximum = (
        this.store.db
          .prepare(
            `SELECT COALESCE(MAX(rowid),0) last FROM ${table} WHERE attempt=?`,
          )
          .get(b.id) as any
      ).last;
      if (page.through !== undefined && page.through > maximum)
        return refuse(
          "Monitoring watermark is unavailable; restart from list without --after/--through",
        );
      const through = page.through ?? maximum;
      if (page.after > through)
        return refuse(
          "Cursor is beyond the reviewed watermark; restart monitoring list",
        );
      return { id: b.id, section: page.section, through, transient: true };
    }
    if (operation === "monitoring.replay") {
      const { pane } = monitoringReplay.parse(input);
      if (
        !this.store.db
          .prepare("SELECT 1 FROM recordings WHERE attempt=? AND pane=?")
          .get(b.id, pane)
      )
        return refuse(
          "Recording not found; use examctl web monitoring list ATTEMPT --section terminals",
          404,
        );
    }
    return { id: b.id, transient: true };
  }

  // Called only after durable request storage. A cached receipt authorizes a
  // fresh retained read, never resurrection from a permanent payload cache.
  read(operation: string, input: unknown, receipt: any, actor: string) {
    const b = parseMonitoring(operation, input);
    if (receipt.id !== b.id || receipt.transient !== true)
      return refuse("Monitoring receipt scope mismatch");
    const a = this.attempt(b.id, operation !== "monitoring.show");
    const audit = () =>
      this.store.audit(
        actor,
        operation === "monitoring.replay"
          ? "terminal-replay"
          : "view-monitoring",
        b.id,
        JSON.stringify({
          operation,
          ...(operation === "monitoring.list"
            ? { section: (b as any).section }
            : {}),
        }),
      );
    if (operation === "monitoring.show") {
      const frames = this.store.db
        .prepare(
          "SELECT source,count(*) count FROM frames WHERE attempt=? GROUP BY source",
        )
        .all(b.id);
      const terminals = (
        this.store.db
          .prepare("SELECT count(*) count FROM recordings WHERE attempt=?")
          .get(b.id) as any
      ).count;
      audit();
      return {
        id: b.id,
        current: a,
        frames: a.monitoringDeleted !== null ? [] : frames,
        terminals: a.monitoringDeleted !== null ? 0 : terminals,
        physicalPurge: monitoringPurgeStatus(this.store, b.id),
        deletionReview: this.deletionReview(b.id),
        serverNow: now(),
        retention,
      };
    }
    if (operation === "monitoring.list") {
      const page = monitoringList.parse(input);
      if (
        receipt.section !== page.section ||
        !Number.isSafeInteger(receipt.through)
      )
        return refuse("Monitoring page receipt mismatch");
      const frames = page.section === "frames";
      const fields = frames
        ? "id,source,seq,captured,received,width,height"
        : "id,pane,created";
      const rows = this.store.db
        .prepare(
          `SELECT rowid cursor,${fields} FROM ${frames ? "frames" : "recordings"} WHERE attempt=? AND rowid>? AND rowid<=? ORDER BY rowid LIMIT ?`,
        )
        .all(b.id, page.after, receipt.through, page.limit + 1) as any[];
      const entries = rows.slice(0, page.limit);
      audit();
      return {
        id: b.id,
        section: page.section,
        through: receipt.through,
        entries,
        next: rows.length > page.limit ? entries.at(-1)!.cursor : null,
        retention,
      };
    }
    const replay = monitoringReplay.parse(input);
    if (
      !this.store.db
        .prepare("SELECT 1 FROM recordings WHERE attempt=? AND pane=?")
        .get(b.id, replay.pane)
    )
      return refuse(
        "Recording not found; use examctl web monitoring list ATTEMPT --section terminals",
        404,
      );
    let value: ReturnType<Monitoring["replay"]>;
    try {
      value = this.monitoring.replay(b.id, replay.pane, replay.offset);
    } catch (error) {
      // Do not persist or forward arbitrary paths/exception text from private IO.
      const message = (error as Error).message;
      if (
        /^(Invalid recording offset|Recording offset (exceeds available data|must follow a complete event)|Recording event exceeds replay batch limit)/.test(
          message,
        )
      )
        return refuse(
          message +
            "; inspect fresh terminal metadata/restart at a complete byte cursor",
        );
      return refuse(
        "Recording bytes unavailable; preserve monitoring and inspect gateway storage/permissions before retrying",
        503,
      );
    }
    this.attempt(b.id); // Retention fence even if the storage reader changes later.
    audit();
    return {
      id: b.id,
      pane: replay.pane,
      offset: replay.offset,
      format: "ndjson",
      ...value!,
      retention,
    };
  }
}
