import { Readable } from "node:stream";
import { setImmediate as yieldIO } from "node:timers/promises";
import { z } from "zod";
import type { Store } from "./db.js";
import { hash, now } from "./db.js";
import { MonitoringMedia, MonitoringMediaError } from "./monitoring-media.js";
import {
  monitoringExportChunk,
  monitoringExportPayload,
  monitoringExportPurpose,
  monitoringExportRequest,
  monitoringExportSections,
  type MonitoringExportInventory,
  type MonitoringExportSection,
} from "../../../packages/protocol/monitoring-export.js";

type Signer = (body: object) => { payload: string; signature: string };
type Scope = { agent: string; request: string; nonce: string };
type Event = { kind: string; [key: string]: unknown };
const descriptions = {
  frames: {
    table: "frames",
    fields:
      "attempt,id,source,seq,captured,monotonic,received,width,height,hash",
    limit: 50,
  },
  terminals: {
    table: "recordings",
    fields: "attempt,id,pane,created",
    limit: 50,
  },
  incidents: {
    table: "incidents",
    fields:
      "attempt,id,generation,opened,CASE WHEN length(CAST(events AS BLOB))<=1048576 THEN events END events,CASE WHEN message IS NULL OR length(CAST(message AS BLOB))<=1048576 THEN message END message,(message IS NOT NULL AND length(CAST(message AS BLOB))>1048576) oversized_message,review_at",
    limit: 1,
  },
  interruptions: {
    table: "attempt_interruptions",
    fields:
      "attempt,id,opened,generation,CASE WHEN length(CAST(events AS BLOB))<=1048576 THEN events END events,CASE WHEN length(CAST(authorizations AS BLOB))<=1048576 THEN authorizations END authorizations,ended,outcome,historical",
    limit: 1,
  },
} as const;

class ExportError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode = 409,
  ) {
    super(
      `Monitoring export ${code}; output is incomplete. Inspect fresh examctl web monitoring show/list and private gateway storage diagnostics; preserve tombstones/protected submissions and retry using a NEW output directory`,
    );
  }
}

export function monitoringExportFailure(error: unknown) {
  const code =
    error instanceof ExportError
      ? error.code
      : error instanceof MonitoringMediaError
        ? `media-${error.reason}`
        : (error as any)?.statusCode === 410
          ? "deleted"
          : (error as any)?.exportCode === "cleanup"
            ? "cleanup"
            : "storage-or-protocol";
  return {
    code,
    status:
      error instanceof ExportError
        ? error.statusCode
        : (error as any)?.statusCode === 410
          ? 410
          : 503,
    message: new ExportError(code).message,
  };
}

// One actual stream/cleanup owner per HTTP application's shared reader. No disk
// archive or private payload cache; only fixed inventory metadata is persisted.
export class MonitoringExport {
  private active = false;
  private cleanupUnknown = false;
  constructor(
    private store: Store,
    private media: MonitoringMedia,
  ) {}

  assertRetained(id: string) {
    try {
      if (!this.store.db.prepare("SELECT 1 FROM attempts WHERE id=?").get(id))
        throw new ExportError("attempt-not-found", 404);
      this.media.assertRetained(id);
    } catch (error) {
      if (
        error instanceof ExportError ||
        error instanceof MonitoringMediaError ||
        (error as any)?.statusCode === 410
      )
        throw error;
      throw new ExportError("inventory-unavailable", 503);
    }
  }

  receipt(input: unknown) {
    const { id } = monitoringExportRequest.parse(input);
    this.assertRetained(id);
    const inventory = {} as MonitoringExportInventory;
    for (const section of monitoringExportSections) {
      const table = descriptions[section].table;
      const row = this.store.db
        .prepare(
          `SELECT COALESCE(MAX(rowid),0) through,COUNT(*) count FROM ${table} WHERE attempt=?`,
        )
        .get(id) as any;
      if (
        !Number.isSafeInteger(row.through) ||
        row.through < 0 ||
        !Number.isSafeInteger(row.count) ||
        row.count < 0
      )
        throw new ExportError("inventory-unavailable", 503);
      inventory[section] = { through: row.through, count: row.count };
    }
    return { id, inventory, transient: true };
  }

  private checkedReceipt(input: unknown, receipt: any) {
    const { id } = monitoringExportRequest.parse(input);
    this.assertRetained(id);
    if (
      receipt?.id !== id ||
      receipt.transient !== true ||
      !receipt.inventory ||
      Object.keys(receipt.inventory).sort().join(",") !==
        [...monitoringExportSections].sort().join(",")
    )
      throw new ExportError("receipt-scope-rejected");
    const inventory = {} as MonitoringExportInventory;
    for (const section of monitoringExportSections) {
      const value = receipt.inventory[section];
      if (
        !value ||
        Object.keys(value).sort().join(",") !== "count,through" ||
        !Number.isSafeInteger(value.through) ||
        value.through < 0 ||
        !Number.isSafeInteger(value.count) ||
        value.count < 0
      )
        throw new ExportError("receipt-watermark-rejected");
      inventory[section] = { ...value };
    }
    return { id, inventory };
  }

  async open(
    input: unknown,
    receipt: any,
    actor: string,
    scope: Scope,
    signing: () => Promise<Signer>,
    signal: AbortSignal,
  ) {
    const { id, inventory } = this.checkedReceipt(input, receipt);
    if (this.active || this.cleanupUnknown)
      throw new ExportError(
        this.cleanupUnknown ? "previous-cleanup-unconfirmed" : "busy",
        503,
      );
    this.active = true;
    let sign: Signer;
    try {
      sign = await signing();
      if (signal.aborted) throw new ExportError("canceled");
      this.assertRetained(id);
      this.store.audit(
        actor,
        "export-monitoring",
        id,
        JSON.stringify({ request: scope.request, inventory }),
      );
    } catch (error) {
      if ((error as any)?.exportCode === "cleanup") this.cleanupUnknown = true;
      if (!this.cleanupUnknown) this.active = false;
      throw error;
    }
    let started = false,
      sequence = 0;
    const self = this;
    async function* packets() {
      started = true;
      try {
        for await (const event of self.events(id, inventory, actor, signal)) {
          if (signal.aborted) throw new ExportError("canceled");
          // Async iteration/signing preparation can yield after a media read.
          // This is the final synchronous fence before private publication.
          self.assertRetained(id);
          const packet = {
            version: 1,
            purpose: monitoringExportPurpose,
            audience: scope.agent,
            request: scope.request,
            nonce: scope.nonce,
            id,
            sequence: ++sequence,
            at: now(),
            event,
          };
          if (
            Buffer.byteLength(JSON.stringify(packet)) > monitoringExportPayload
          )
            throw new ExportError("metadata-record-too-large", 503);
          yield Buffer.from(JSON.stringify(sign(packet)) + "\n");
          await yieldIO();
        }
      } catch (error) {
        if (error instanceof MonitoringMediaError && error.reason === "cleanup")
          self.cleanupUnknown = true;
        if (!signal.aborted) {
          const failure = monitoringExportFailure(error);
          yield Buffer.from(
            JSON.stringify(
              sign({
                version: 1,
                purpose: monitoringExportPurpose,
                audience: scope.agent,
                request: scope.request,
                nonce: scope.nonce,
                id,
                sequence: ++sequence,
                at: now(),
                event: {
                  kind: "error",
                  code: failure.code,
                  message: failure.message,
                },
              }),
            ) + "\n",
          );
        }
      } finally {
        if (!self.cleanupUnknown) self.active = false;
      }
    }
    const stream = Readable.from(packets(), {
      objectMode: false,
      highWaterMark: 64 * 1024,
    });
    const abort = () => stream.destroy();
    signal.addEventListener("abort", abort, { once: true });
    stream.once("close", () => {
      signal.removeEventListener("abort", abort);
      // Suspended-start generators do not execute finally on return(). Once
      // started, only actual generator/descriptor cleanup can release the slot.
      if (!started && !self.cleanupUnknown) self.active = false;
    });
    if (signal.aborted) stream.destroy();
    return stream;
  }

  private async *events(
    id: string,
    inventory: MonitoringExportInventory,
    actor: string,
    signal: AbortSignal,
  ): AsyncGenerator<Event> {
    const attempt = this.store.db
      .prepare(
        "SELECT id,exam,username,state,start,deadline,original_deadline,ended,protected,checksum FROM attempts WHERE id=?",
      )
      .get(id);
    yield {
      kind: "begin",
      inventory,
      attempt,
      observed: now(),
      note: "Append-watermarked inventory; each recording uses its initial pinned byte prefix, including incomplete tails. Not a globally atomic snapshot or protection/permission proof. Downloaded copies have independent operator retention",
    };
    const counts = { frames: 0, terminals: 0, incidents: 0, interruptions: 0 };
    let files = 0,
      bytes = 0;
    for (const section of monitoringExportSections) {
      const description = descriptions[section];
      let after = 0;
      for (;;) {
        if (signal.aborted) throw new ExportError("canceled");
        this.assertRetained(id);
        const rows = this.store.db
          .prepare(
            `SELECT rowid cursor,${description.fields} FROM ${description.table} WHERE attempt=? AND rowid>? AND rowid<=? ORDER BY rowid LIMIT ?`,
          )
          .all(
            id,
            after,
            inventory[section].through,
            description.limit,
          ) as any[];
        if (!rows.length) break;
        for (const row of rows) {
          if (
            row.cursor <= after ||
            row.cursor > inventory[section].through ||
            !Number.isSafeInteger(row.cursor)
          )
            throw new ExportError("inventory-changed");
          after = row.cursor;
          if (!z.string().uuid().safeParse(row.id).success)
            throw new ExportError("invalid-metadata-identity");
          if (
            row.oversized_message ||
            ((section === "incidents" || section === "interruptions") &&
              row.events === null) ||
            (section === "interruptions" && row.authorizations === null)
          )
            throw new ExportError("metadata-record-too-large", 503);
          delete row.oversized_message;
          counts[section]++;
          yield { kind: "metadata", section, entry: row };
          if (section === "frames") {
            for (const thumbnail of [false, true]) {
              const image = await this.media.read(row.id, thumbnail, actor, id);
              const area = thumbnail ? "thumbnails" : "frames",
                sha256 = hash(image.data);
              if (!thumbnail && sha256 !== row.hash)
                throw new ExportError("source-changed");
              yield {
                kind: "file-begin",
                area,
                file: row.id,
                bytes: image.data.length,
                sha256,
              };
              for (
                let offset = 0;
                offset < image.data.length;
                offset += monitoringExportChunk
              ) {
                const part = image.data.subarray(
                  offset,
                  offset + monitoringExportChunk,
                );
                yield {
                  kind: "file-data",
                  area,
                  file: row.id,
                  offset,
                  data: part.toString("base64"),
                };
              }
              yield {
                kind: "file-end",
                area,
                file: row.id,
                bytes: image.data.length,
                sha256,
              };
              files++;
              bytes += image.data.length;
            }
          } else if (section === "terminals") {
            if (!z.string().uuid().safeParse(row.pane).success)
              throw new ExportError("invalid-pane-identity");
            for await (const part of this.media.recording(
              id,
              row.pane,
              row.id,
              actor,
              signal,
            )) {
              if (part.kind === "begin")
                yield {
                  kind: "file-begin",
                  area: "terminals",
                  file: row.pane,
                  bytes: part.bytes,
                };
              else if (part.kind === "data")
                yield {
                  kind: "file-data",
                  area: "terminals",
                  file: row.pane,
                  offset: part.offset,
                  data: part.data.toString("base64"),
                };
              else if (part.kind === "verify")
                yield {
                  kind: "file-verify",
                  area: "terminals",
                  file: row.pane,
                  offset: part.offset,
                  bytes: part.bytes,
                };
              else {
                yield {
                  kind: "file-end",
                  area: "terminals",
                  file: row.pane,
                  bytes: part.bytes,
                  sha256: part.sha256,
                };
                files++;
                bytes += part.bytes;
              }
            }
          }
          if (!Number.isSafeInteger(bytes) || !Number.isSafeInteger(files))
            throw new ExportError("size-bound", 503);
        }
      }
      if (counts[section] !== inventory[section].count)
        throw new ExportError("inventory-changed");
    }
    this.assertRetained(id);
    yield { kind: "end", inventory, counts, files, bytes, observed: now() };
  }
}
