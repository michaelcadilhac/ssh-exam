import { now, type Store } from "./db.js";
import type { Monitoring } from "./monitoring.js";
import { monitoringPurgeStatus } from "./monitoring-purge-jobs.js";
import {
  monitoringList,
  monitoringReplay,
  parseMonitoring,
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
