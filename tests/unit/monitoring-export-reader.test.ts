import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  unlinkSync,
  symlinkSync,
  linkSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { Store, hash } from "../../apps/server/src/db.js";
import { Monitoring } from "../../apps/server/src/monitoring.js";
import { MonitoringMedia } from "../../apps/server/src/monitoring-media.js";
import { monitoringExportChunk } from "../../packages/protocol/monitoring-export.js";

function fixture(data: Buffer) {
  const store = new Store(mkdtempSync(tmpdir() + "/export-reader-"));
  store.db.exec(
    "INSERT INTO exams VALUES('e','{}'); INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline,protected,checksum) VALUES('a','e','synthetic',1001,'LOCKED','{}',1,2,3,1,'protected')",
  );
  const monitoring = new Monitoring(store),
    media = new MonitoringMedia(store),
    pane = randomUUID();
  monitoring.record("a", pane, { event: "open" });
  const recording = (
    store.db
      .prepare("SELECT id FROM recordings WHERE attempt='a' AND pane=?")
      .get(pane) as any
  ).id;
  const path = `${store.dir}/monitoring/a/${pane}.ndjson`;
  writeFileSync(path, data, { mode: 0o600 });
  const before = store.attempt("a");
  return {
    store,
    monitoring,
    media,
    pane,
    recording,
    path,
    stream: (signal?: AbortSignal) =>
      media.recording("a", pane, recording, "teacher", signal),
    close() {
      expect(store.attempt("a")).toEqual(before);
      store.close();
      rmSync(store.dir, { recursive: true, force: true });
    },
  };
}

it("exports every selected prefix byte including a partial binary tail, excluding later appends and without proportional chunks", async () => {
  const original = Buffer.concat([
    Buffer.alloc(monitoringExportChunk + 17, 65),
    Buffer.from([255, 0, 10, 123]),
  ]);
  const f = fixture(original);
  try {
    const stream = f.stream();
    expect((await stream.next()).value).toEqual({
      kind: "begin",
      bytes: original.length,
    });
    appendFileSync(f.path, "LATER-APPEND");
    const chunks: Buffer[] = [];
    let offset = 0,
      last: any;
    for await (const event of stream) {
      if (event.kind === "data") {
        expect(event.offset).toBe(offset);
        expect(event.data.length).toBeLessThanOrEqual(monitoringExportChunk);
        chunks.push(event.data);
        offset += event.data.length;
      }
      last = event;
    }
    expect(Buffer.concat(chunks)).toEqual(original);
    expect(last).toEqual({
      kind: "end",
      bytes: original.length,
      sha256: hash(original),
    });
    expect(readFileSync(f.path)).toEqual(
      Buffer.concat([original, Buffer.from("LATER-APPEND")]),
    );
    const audits = JSON.stringify(
      f.store.db.prepare("SELECT * FROM audit").all(),
    );
    expect(audits).not.toContain("LATER-APPEND");
  } finally {
    f.close();
  }
});

it("refuses an observed source-prefix overwrite or truncation before declaring a file complete", async () => {
  for (const replacement of [Buffer.alloc(40, 66), Buffer.alloc(0)]) {
    const f = fixture(Buffer.alloc(40, 65));
    try {
      const stream = f.stream();
      await stream.next();
      expect((await stream.next()).value).toMatchObject({
        kind: "data",
        offset: 0,
      });
      writeFileSync(f.path, replacement);
      await expect(stream.next()).rejects.toMatchObject({
        reason: "changed",
        statusCode: 503,
      });
      // No secret positive cache; a new read observes the actual new source.
      const events = [];
      for await (const event of f.stream()) events.push(event);
      expect(events.at(-1)).toEqual({
        kind: "end",
        bytes: replacement.length,
        sha256: hash(replacement),
      });
    } finally {
      f.close();
    }
  }
});

it("rechecks deletion/abort after an opened prefix and cannot read another recording identity", async () => {
  const f = fixture(Buffer.from("PRIVATE-TERMINAL-PREFIX"));
  try {
    await expect(
      f.media.recording("a", f.pane, randomUUID(), "teacher").next(),
    ).rejects.toMatchObject({ statusCode: 404 });
    await expect(
      f.media.recording("b", f.pane, f.recording, "teacher").next(),
    ).rejects.toMatchObject({ statusCode: 404 });
    const abort = new AbortController(),
      cancel = f.stream(abort.signal);
    await cancel.next();
    abort.abort();
    await expect(cancel.next()).rejects.toMatchObject({ statusCode: 409 });
    const deleted = f.stream();
    await deleted.next();
    f.monitoring.delete("a", "teacher");
    await expect(deleted.next()).rejects.toMatchObject({ statusCode: 410 });
  } finally {
    f.close();
  }
});

it("refuses linked and real FIFO transcripts without following protected bytes or blocking", async () => {
  for (const kind of ["symlink", "hardlink", "fifo"]) {
    const f = fixture(Buffer.from("original"));
    try {
      const outside = `${f.store.dir}/protected-fixture`;
      writeFileSync(outside, "PRIVATE-PROTECTED-BYTES", { mode: 0o600 });
      unlinkSync(f.path);
      if (kind === "symlink") symlinkSync(outside, f.path);
      if (kind === "hardlink") linkSync(outside, f.path);
      if (kind === "fifo") execFileSync("mkfifo", [f.path]);
      await expect(f.stream().next()).rejects.toMatchObject({
        statusCode: 503,
      });
      expect(readFileSync(outside, "utf8")).toBe("PRIVATE-PROTECTED-BYTES");
    } finally {
      f.close();
    }
  }
});
