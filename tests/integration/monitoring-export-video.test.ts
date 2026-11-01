import { expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { exportFixture } from "../fixtures/monitoring-export.js";
import {
  MonitoringMedia,
  type MonitoringImage,
} from "../../apps/server/src/monitoring-media.js";
import { hash } from "../../apps/server/src/db.js";
import { monitoringFrameProvenance } from "../../packages/protocol/monitoring-video.js";

async function fixture() {
  const f = await exportFixture();
  const capture = f.store.db
    .prepare("SELECT * FROM frames WHERE id=?")
    .get(f.frame.id) as any;
  const width = 20,
    height = 15,
    rgb = Buffer.alloc(width * height * 3, 95),
    data = await sharp(rgb, { raw: { width, height, channels: 3 } })
      .jpeg({ quality: 50 })
      .toBuffer(),
    provenance = monitoringFrameProvenance.parse({
      encoding: "vp9-webm-v1",
      capture_sha256: capture.hash,
      capture_width: capture.width,
      capture_height: capture.height,
      segment: randomUUID(),
      segment_sha256: "a".repeat(64),
      index: 0,
      decoded_sha256: hash(rgb),
    });
  // Model the verified reader boundary only. Real codec/queue qualification
  // independently proves that this RGB24 hash came from the retained segment.
  const original = MonitoringMedia.prototype.read;
  const createSession = MonitoringMedia.prototype.createReadSession,
    sessionClose = vi.fn(),
    sessionSpy = vi
      .spyOn(MonitoringMedia.prototype, "createReadSession")
      .mockImplementation(function (this: MonitoringMedia) {
        const session = createSession.call(this);
        return {
          ...session,
          close: () => {
            sessionClose();
            session.close();
          },
        };
      });
  const install = (change: Partial<MonitoringImage> = {}) =>
    vi
      .spyOn(MonitoringMedia.prototype, "read")
      .mockImplementation(async function (this: MonitoringMedia, ...args) {
        const image = await original.apply(this, args);
        return args[0] !== f.frame.id || args[1]
          ? image
          : { ...image, data, width, height, provenance, ...change };
      });
  return {
    ...f,
    capture,
    data,
    width,
    height,
    provenance,
    install,
    sessionClose,
    async close() {
      sessionSpy.mockRestore();
      await f.close();
    },
  };
}

it("exports derived JPEG hashes and strict video provenance while preserving original captures, timestamps and terminal bytes", async () => {
  const f = await fixture();
  const spy = f.install();
  try {
    const request = f.request(),
      response = await f.post(request),
      events = f.packets(response, request).map((packet) => packet.event);
    expect(events.at(-1)).toMatchObject({ kind: "end", files: 3 });
    expect(f.sessionClose).toHaveBeenCalledTimes(1);
    const metadata = events.find(
      (event) => event.kind === "metadata" && event.section === "frames",
    ).entry;
    expect(Object.keys(metadata).sort()).toEqual(
      [
        "cursor",
        "attempt",
        "id",
        "source",
        "seq",
        "captured",
        "monotonic",
        "received",
        "width",
        "height",
        "hash",
        "provenance",
      ].sort(),
    );
    expect(metadata).toMatchObject({
      id: f.frame.id,
      seq: f.capture.seq,
      captured: f.capture.captured,
      monotonic: f.capture.monotonic,
      received: f.capture.received,
      width: f.width,
      height: f.height,
      hash: hash(f.data),
      provenance: f.provenance,
    });
    expect(metadata.hash).not.toBe(f.capture.hash);
    expect(metadata.provenance.decoded_sha256).not.toBe(metadata.hash);
    const fileData = (area: string, file: string) =>
      Buffer.concat(
        events
          .filter(
            (event) =>
              event.kind === "file-data" &&
              event.area === area &&
              event.file === file,
          )
          .map((event) => Buffer.from(event.data, "base64")),
      );
    expect(fileData("frames", f.frame.id)).toEqual(f.data);
    expect(fileData("terminals", f.pane)).toEqual(f.prefix);
    expect(
      events.find(
        (event) => event.kind === "file-begin" && event.area === "frames",
      ).sha256,
    ).toBe(metadata.hash);
    expect(
      events.find(
        (event) => event.kind === "file-end" && event.area === "frames",
      ).sha256,
    ).toBe(metadata.hash);
    expect(
      f.store.db.prepare("SELECT * FROM frames WHERE id=?").get(f.frame.id),
    ).toEqual(f.capture);
    expect(f.store.attempt("a")).toEqual(f.before);
  } finally {
    spy.mockRestore();
    await f.close();
  }
});

it.each([
  "capture-hash",
  "capture-width",
  "capture-height",
  "frame-index",
  "private-field",
  "derived-width",
])("refuses %s before publishing derived frame metadata", async (fault) => {
  const f = await fixture();
  const provenance = { ...f.provenance } as Record<string, unknown>;
  if (fault === "capture-hash") provenance.capture_sha256 = "0".repeat(64);
  if (fault === "capture-width") provenance.capture_width = f.capture.width + 1;
  if (fault === "capture-height")
    provenance.capture_height = f.capture.height + 1;
  if (fault === "frame-index") provenance.index = 12;
  if (fault === "private-field")
    provenance.private = "NOT-A-PUBLIC-PROVENANCE-FIELD";
  // Deliberately violate the typed process boundary to exercise its refusal.
  const spy = f.install({
    provenance: provenance as MonitoringImage["provenance"],
    ...(fault === "derived-width" ? { width: 0 } : {}),
  });
  try {
    const request = f.request(),
      events = f.packets(await f.post(request), request).map((p) => p.event);
    expect(events.at(-1).kind).toBe("error");
    expect(f.sessionClose).toHaveBeenCalledTimes(1);
    expect(
      events.some(
        (event) => event.kind === "metadata" && event.section === "frames",
      ),
    ).toBe(false);
    expect(events.some((event) => event.kind === "file-data")).toBe(false);
    expect(JSON.stringify(events)).not.toContain(
      "NOT-A-PUBLIC-PROVENANCE-FIELD",
    );
    expect(
      f.store.db.prepare("SELECT * FROM frames WHERE id=?").get(f.frame.id),
    ).toEqual(f.capture);
  } finally {
    spy.mockRestore();
    await f.close();
  }
});

it("verifies legacy original JPEG bytes before publishing their unchanged metadata", async () => {
  const f = await fixture();
  const spy = f.install({ provenance: undefined });
  try {
    const request = f.request(),
      events = f.packets(await f.post(request), request).map((p) => p.event);
    expect(events.at(-1)).toMatchObject({
      kind: "error",
      code: "source-changed",
    });
    expect(f.sessionClose).toHaveBeenCalledTimes(1);
    expect(
      events.some(
        (event) => event.kind === "metadata" && event.section === "frames",
      ),
    ).toBe(false);
    expect(events.some((event) => event.kind === "file-data")).toBe(false);
  } finally {
    spy.mockRestore();
    await f.close();
  }
});

it("rechecks deletion after deriving a JPEG and before publishing its frame metadata", async () => {
  const f = await fixture();
  const original = MonitoringMedia.prototype.read;
  const spy = vi
    .spyOn(MonitoringMedia.prototype, "read")
    .mockImplementationOnce(async function (this: MonitoringMedia, ...args) {
      const image = await original.apply(this, args);
      f.monitoring.delete("a", "teacher");
      return {
        ...image,
        data: f.data,
        width: f.width,
        height: f.height,
        provenance: f.provenance,
      };
    });
  try {
    const request = f.request(),
      events = f.packets(await f.post(request), request).map((p) => p.event);
    expect(events.at(-1)).toMatchObject({ kind: "error", code: "deleted" });
    expect(f.sessionClose).toHaveBeenCalledTimes(1);
    expect(
      events.some(
        (event) => event.kind === "metadata" && event.section === "frames",
      ),
    ).toBe(false);
    expect(events.some((event) => event.kind === "file-data")).toBe(false);
    expect(f.store.attempt("a")).toMatchObject({
      settings: f.before.settings,
      deadline: f.before.deadline,
      original_deadline: f.before.original_deadline,
      checksum: f.before.checksum,
      protected: f.before.protected,
    });
  } finally {
    spy.mockRestore();
    await f.close();
  }
});
