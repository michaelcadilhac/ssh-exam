import { expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { exportFixture } from "../fixtures/monitoring-export.js";
import { MonitoringMedia } from "../../apps/server/src/monitoring-media.js";
import { hash } from "../../apps/server/src/db.js";
import {
  monitoringExportChunk,
  monitoringExportContentType,
} from "../../packages/protocol/monitoring-export.js";

it("exports complete signed bounded media/history and raw transcript tails with metadata-only durable receipts", async () => {
  const f = await exportFixture();
  try {
    const request = f.request(),
      response = await f.post(request);
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain(
      monitoringExportContentType,
    );
    expect(response.headers["cache-control"]).toContain("no-store");
    const packets = f.packets(response, request),
      events = packets.map((p) => p.event);
    expect(events[0]).toMatchObject({
      kind: "begin",
      attempt: { id: "a" },
      inventory: {
        frames: { count: 1 },
        terminals: { count: 1 },
        incidents: { count: 1 },
        interruptions: { count: 1 },
      },
    });
    const files = new Map<
      string,
      { bytes: number; data: Buffer[]; next: number; hash?: string }
    >();
    for (const event of events) {
      const name = event.area + "/" + event.file;
      if (event.kind === "file-begin")
        files.set(name, {
          bytes: event.bytes,
          data: [],
          next: 0,
          hash: event.sha256,
        });
      if (event.kind === "file-data") {
        const file = files.get(name)!;
        expect(event.offset).toBe(file.next);
        const data = Buffer.from(event.data, "base64");
        expect(data.length).toBeLessThanOrEqual(monitoringExportChunk);
        file.data.push(data);
        file.next += data.length;
      }
      if (event.kind === "file-end") {
        const file = files.get(name)!,
          data = Buffer.concat(file.data);
        expect(data.length).toBe(file.bytes);
        expect(hash(data)).toBe(event.sha256);
        if (file.hash) expect(event.sha256).toBe(file.hash);
      }
    }
    expect(Buffer.concat(files.get("frames/" + f.frame.id)!.data)).toEqual(
      f.data,
    );
    expect(Buffer.concat(files.get("thumbnails/" + f.frame.id)!.data)).toEqual(
      readFileSync(f.thumbnail),
    );
    expect(Buffer.concat(files.get("terminals/" + f.pane)!.data)).toEqual(
      f.prefix,
    );
    expect(events.at(-1)).toMatchObject({
      kind: "end",
      files: 3,
      counts: { frames: 1, terminals: 1, incidents: 1, interruptions: 1 },
      bytes: [...files.values()].reduce((sum, file) => sum + file.bytes, 0),
    });
    const outcome = (
      f.store.db
        .prepare(
          "SELECT outcome FROM agent_management_requests WHERE request=?",
        )
        .get(request.request) as any
    ).outcome;
    expect(JSON.parse(outcome).result).toEqual({
      id: "a",
      inventory: events[0].inventory,
      transient: true,
    });
    expect(outcome).not.toContain(f.data.toString("base64"));
    expect(outcome).not.toContain("PRIVATE");
    expect(JSON.stringify(events)).not.toContain("page_hash");
    expect(f.store.attempt("a")).toEqual(f.before);
  } finally {
    await f.close();
  }
});

it("retains an original inventory watermark on retry and rechecks tombstones after async media before signed publication", async () => {
  const f = await exportFixture();
  try {
    const initial = f.request(),
      first = f.packets(await f.post(initial), initial);
    await f.monitoring.frame(
      f.store.attempt("a"),
      {
        source: "screen",
        seq: 2,
        captured: Date.now(),
        monotonic: 2,
        data: f.data.toString("base64"),
      },
      "page",
    );
    const retry = f.request(initial.request),
      retried = f.packets(await f.post(retry), retry);
    expect(retried[0].event.inventory).toEqual(first[0].event.inventory);
    expect(
      retried.filter(
        (p) => p.event.kind === "metadata" && p.event.section === "frames",
      ),
    ).toHaveLength(1);
    const fresh = f.request(),
      freshPackets = f.packets(await f.post(fresh), fresh);
    expect(freshPackets[0].event.inventory.frames.count).toBe(2);
    expect(f.store.attempt("a")).toEqual(f.before);
    let afterDeletion = f.before;
    const original = MonitoringMedia.prototype.read;
    const spy = vi
      .spyOn(MonitoringMedia.prototype, "read")
      .mockImplementationOnce(async function (this: MonitoringMedia, ...args) {
        const image = await original.apply(this, args);
        f.monitoring.delete("a", "teacher");
        afterDeletion = f.store.attempt("a"); // Intentional tombstone/history triggers.
        return image;
      });
    try {
      const late = f.request(),
        events = f.packets(await f.post(late), late).map((p) => p.event);
      expect(events.at(-1)).toMatchObject({ kind: "error", code: "deleted" });
      expect(
        events.some((e) => e.kind === "file-data" || e.kind === "end"),
      ).toBe(false);
      expect(JSON.stringify(events)).not.toContain(f.data.toString("base64"));
    } finally {
      spy.mockRestore();
    }
    const refused = f.unpack((await f.post(f.request(initial.request))).body);
    expect(refused).toMatchObject({ ok: false, status: 410 });
    expect(f.store.attempt("a")).toEqual(afterDeletion);
  } finally {
    await f.close();
  }
});

it("refuses unauthorized/incorrect export scope and unavailable media without emitting a successful end", async () => {
  const f = await exportFixture();
  try {
    const missing = f.unpack(
      (await f.post(f.request(randomUUID(), { id: "missing" }))).body,
    );
    expect(missing).toMatchObject({ ok: false, status: 404 });
    const invalid = f.unpack(
      (await f.post(f.request(randomUUID(), { id: "a", file: "/private" })))
        .body,
    );
    expect(invalid.ok).toBe(false);
    f.store.db
      .prepare("UPDATE frames SET hash=? WHERE id=?")
      .run("a".repeat(64), f.frame.id);
    const request = f.request(),
      events = f.packets(await f.post(request), request).map((p) => p.event);
    expect(events.at(-1)).toMatchObject({
      kind: "error",
      code: "media-digest",
    });
    expect(events.some((e) => e.kind === "file-data" || e.kind === "end")).toBe(
      false,
    );
  } finally {
    await f.close();
  }
});

it("fails explicitly on oversized history instead of silently exporting a truncated record", async () => {
  const f = await exportFixture();
  try {
    f.store.db
      .prepare("UPDATE incidents SET message=? WHERE attempt='a'")
      .run("PRIVATE-OVERSIZE".repeat(75000));
    const before = f.store.attempt("a"),
      request = f.request(),
      events = f.packets(await f.post(request), request).map((p) => p.event);
    expect(events.at(-1)).toMatchObject({
      kind: "error",
      code: "metadata-record-too-large",
    });
    expect(events.some((e) => e.kind === "end")).toBe(false);
    expect(JSON.stringify(events)).not.toContain("PRIVATE-OVERSIZE");
    expect(f.store.attempt("a")).toEqual(before);
  } finally {
    await f.close();
  }
});

it("uses a pinned raw recording prefix, excludes later appends and refuses observed overwrite before completion", async () => {
  const original = MonitoringMedia.prototype.recording;
  for (const overwrite of [false, true]) {
    const f = await exportFixture({
      transcriptBytes: monitoringExportChunk + 7,
    });
    const spy = vi
      .spyOn(MonitoringMedia.prototype, "recording")
      .mockImplementation(async function* (this: MonitoringMedia, ...args) {
        let changed = false;
        for await (const event of original.apply(this, args)) {
          yield event;
          if (!changed && event.kind === (overwrite ? "data" : "begin")) {
            changed = true;
            if (overwrite)
              writeFileSync(f.transcript, Buffer.alloc(f.prefix.length, 66));
            else appendFileSync(f.transcript, "EXCLUDED-LATER-APPEND");
          }
        }
      });
    try {
      const request = f.request(),
        events = f.packets(await f.post(request), request).map((p) => p.event);
      if (overwrite) {
        expect(events.at(-1)).toMatchObject({
          kind: "error",
          code: "media-changed",
        });
        expect(events.some((e) => e.kind === "end")).toBe(false);
      } else {
        expect(events.at(-1).kind).toBe("end");
        const data = events
          .filter((e) => e.kind === "file-data" && e.area === "terminals")
          .map((e) => Buffer.from(e.data, "base64"));
        expect(Buffer.concat(data)).toEqual(f.prefix);
      }
      expect(f.store.attempt("a")).toEqual(f.before);
    } finally {
      spy.mockRestore();
      await f.close();
    }
  }
});

it("rechecks retention after the final async recording event before signing successful completion", async () => {
  const f = await exportFixture(),
    original = MonitoringMedia.prototype.recording;
  let afterDeletion = f.before;
  const spy = vi
    .spyOn(MonitoringMedia.prototype, "recording")
    .mockImplementation(async function* (this: MonitoringMedia, ...args) {
      for await (const event of original.apply(this, args)) {
        yield event;
        if (event.kind === "end") {
          f.monitoring.delete("a", "teacher");
          afterDeletion = f.store.attempt("a");
        }
      }
    });
  try {
    const request = f.request(),
      events = f.packets(await f.post(request), request).map((p) => p.event);
    expect(events.at(-1)).toMatchObject({ kind: "error", code: "deleted" });
    expect(events.some((e) => e.kind === "end")).toBe(false);
    expect(f.store.attempt("a")).toEqual(afterDeletion);
  } finally {
    spy.mockRestore();
    await f.close();
  }
});
