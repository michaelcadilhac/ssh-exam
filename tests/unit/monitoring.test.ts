import { it, expect } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  existsSync,
  writeFileSync,
  readFileSync,
  truncateSync,
  statSync,
  chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { Store } from "../../apps/server/src/db.js";
import { Monitoring } from "../../apps/server/src/monitoring.js";
it("never resurrects deleted monitoring from late legacy callbacks or orphan replay files", () => {
  const s = new Store(mkdtempSync(tmpdir() + "/exam-tombstone-")),
    m = new Monitoring(s);
  try {
    s.db.exec(
      "INSERT INTO exams VALUES('e','{}');INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline) VALUES('a','e','student',1001,'COMPLETED','{}',100,200,200)",
    );
    m.record("a", "pane", { event: "open" });
    writeFileSync(`${s.dir}/receipts/a.manifest.json`, "immutable receipt");
    const authority = s.attempt("a");
    m.delete("a", "instructor");
    m.record("a", "pane", { event: "output", data: "cHJpdmF0ZQ==" });
    expect(
      s.db.prepare("SELECT * FROM recordings WHERE attempt='a'").all(),
    ).toEqual([]);
    expect(existsSync(`${s.dir}/monitoring/a`)).toBe(false);
    expect(s.attempt("a")).toEqual(authority);
    expect(readFileSync(`${s.dir}/receipts/a.manifest.json`, "utf8")).toBe(
      "immutable receipt",
    );
    // A physical purge may have failed or await retry. Tombstones must still
    // prevent direct replay of any retained bytes, even without a DB row.
    const sibling = new Monitoring(s);
    const fs = `${s.dir}/monitoring/a`;
    // Create an orphan only as synthetic failed-purge evidence.
    mkdirSync(fs, { mode: 0o700 });
    writeFileSync(`${fs}/pane.ndjson`, '{"event":"output","data":"private"}\n');
    expect(() => sibling.replay("a", "pane", 0)).toThrow("deleted");
  } finally {
    s.close();
    rmSync(s.dir, { recursive: true, force: true });
  }
});
it.skipIf(process.getuid?.() === 0)(
  "retention survives a real purge permission failure, continues other attempts and retries durable tombstones",
  () => {
    const s = new Store(mkdtempSync(tmpdir() + "/exam-retention-failure-")),
      m = new Monitoring(s);
    try {
      s.db.exec("INSERT INTO exams VALUES('e','{}')");
      for (const id of ["a", "b"]) {
        s.db
          .prepare(
            "INSERT INTO attempts(id,exam,username,uid,state,settings,ended) VALUES(?,'e',?,1001,'COMPLETED','{}',?)",
          )
          .run(id, id, Date.now() - 61 * 86400000);
        m.record(id, "pane", { event: "open" });
      }
      chmodSync(`${s.dir}/monitoring/a`, 0o500);
      expect(() => m.cleanup()).not.toThrow();
      expect(
        s.db.prepare("SELECT attempt FROM tombstones ORDER BY attempt").all(),
      ).toEqual([{ attempt: "a" }, { attempt: "b" }]);
      expect(existsSync(`${s.dir}/monitoring/a/pane.ndjson`)).toBe(true);
      expect(existsSync(`${s.dir}/monitoring/b`)).toBe(false);
      chmodSync(`${s.dir}/monitoring/a`, 0o700);
      expect(m.cleanup().failed).toBe(0);
      expect(existsSync(`${s.dir}/monitoring/a`)).toBe(false);
    } finally {
      if (existsSync(`${s.dir}/monitoring/a`))
        chmodSync(`${s.dir}/monitoring/a`, 0o700);
      s.close();
      rmSync(s.dir, { recursive: true, force: true });
    }
  },
);
it("validates images, rejects conflicting duplicates, and deletes monitoring without submissions", async () => {
  const s = new Store(mkdtempSync(tmpdir() + "/exam-media-")),
    m = new Monitoring(s);
  try {
    s.db.prepare("INSERT INTO exams VALUES(?,?)").run("exam", "{}");
    s.db
      .prepare(
        "INSERT INTO attempts(id,exam,username,uid,state,settings) VALUES('attempt','exam','a',1001,'ACTIVE','{\"webcam\":false}')",
      )
      .run();
    const a = s.attempt("attempt");
    const bytes = await sharp({
      create: { width: 40, height: 30, channels: 3, background: "white" },
    })
      .jpeg()
      .toBuffer();
    const frame = {
      source: "screen",
      seq: 1,
      captured: Date.now(),
      monotonic: 1,
      data: bytes.toString("base64"),
    };
    const first = await m.frame(a, frame, "page");
    expect((await m.frame(a, frame, "page")).id).toBe(first.id);
    const altered = await sharp({
      create: { width: 40, height: 30, channels: 3, background: "black" },
    })
      .jpeg()
      .toBuffer();
    await expect(
      m.frame(a, { ...frame, data: altered.toString("base64") }, "page"),
    ).rejects.toThrow("Conflicting");
    await expect(
      m.frame(a, { ...frame, source: "webcam" }, "page"),
    ).rejects.toThrow("not requested");
    await expect(
      m.frame(
        a,
        {
          ...frame,
          seq: 2,
          data: Buffer.from("not an image").toString("base64"),
        },
        "page",
      ),
    ).rejects.toThrow();
    writeFileSync(`${s.dir}/submissions/attempt.tar.gz`, "protected");
    m.delete(a.id, "admin");
    expect(existsSync(`${s.dir}/monitoring/attempt`)).toBe(false);
    expect(existsSync(`${s.dir}/submissions/attempt.tar.gz`)).toBe(true);
    await expect(m.frame(a, frame, "page")).rejects.toThrow("deleted");
  } finally {
    s.close();
    rmSync(s.dir, { recursive: true, force: true });
  }
});
it("receives trusted terminal batches idempotently, rejects conflicts, and honors monitoring tombstones", () => {
  const s = new Store(mkdtempSync(tmpdir() + "/exam-record-batch-")),
    m = new Monitoring(s);
  try {
    s.db.exec(
      `INSERT INTO exams VALUES('e','{}');INSERT INTO attempts(id,exam,username,uid,state,settings) VALUES('a','e','student',1001,'ACTIVE','{}')`,
    );
    const first = Buffer.from(
      JSON.stringify({ source: "class-agent", at: Date.now(), event: "open" }) +
        "\n",
    );
    const next = Buffer.from(
      JSON.stringify({
        source: "class-agent",
        at: Date.now(),
        event: "output",
        data: Buffer.from("root-recorded").toString("base64"),
      }) + "\n",
    );
    m.receiveRecording("a", "pane", 0, first);
    m.receiveRecording("a", "pane", 0, first);
    m.receiveRecording("a", "pane", first.length, next);
    expect(readFileSync(`${s.dir}/monitoring/a/pane.ndjson`)).toEqual(
      Buffer.concat([first, next]),
    );
    expect(s.db.prepare("SELECT * FROM recordings").all()).toHaveLength(1);
    expect(() => m.receiveRecording("a", "pane", 0, next)).toThrow(
      "Conflicting",
    );
    expect(() => m.receiveRecording("a", "pane", 999999, next)).toThrow("gap");
    m.delete("a", "instructor");
    m.receiveRecording("a", "pane", 0, first);
    expect(existsSync(`${s.dir}/monitoring/a/pane.ndjson`)).toBe(false);
  } finally {
    s.close();
    rmSync(s.dir, { recursive: true, force: true });
  }
});

it("uses a larger default and enforces a persistent shared recording budget without counting images", () => {
  const s = new Store(mkdtempSync(tmpdir() + "/exam-record-quota-"));
  try {
    s.db.exec(
      `INSERT INTO exams VALUES('e','{}');INSERT INTO attempts(id,exam,username,uid,state,settings) VALUES('a','e','student',1001,'ACTIVE','{}')`,
    );
    const defaults = new Monitoring(s);
    defaults.record("a", "pane1", { event: "open" });
    const dir = `${s.dir}/monitoring/a`;
    truncateSync(`${dir}/pane1.ndjson`, 64 * 1024 * 1024);
    expect(() =>
      defaults.record("a", "pane1", { event: "output", data: "bW9yZQ==" }),
    ).not.toThrow();
    truncateSync(`${dir}/pane1.ndjson`, 1024 * 1024 - 50);
    writeFileSync(`${dir}/image.jpg`, "");
    truncateSync(`${dir}/image.jpg`, 2 * 1024 * 1024);
    const limited = new Monitoring(s, 1);
    const batch = Buffer.from(
      JSON.stringify({ source: "class-agent", at: Date.now(), event: "open" }) +
        "\n",
    );
    // The receiving cap includes other panes, not just the file being appended.
    expect(() => limited.receiveRecording("a", "pane2", 0, batch)).toThrow(
      "size limit",
    );
    expect(() => limited.record("a", "pane2", { event: "open" })).toThrow(
      "size limit",
    );
    truncateSync(`${dir}/pane1.ndjson`, 100);
    limited.receiveRecording("a", "pane2", 0, batch);
    // Retries at the boundary consume no extra quota.
    truncateSync(`${dir}/pane1.ndjson`, 1024 * 1024 - batch.length);
    new Monitoring(s, 1).receiveRecording("a", "pane2", 0, batch);
    expect(statSync(`${dir}/pane2.ndjson`).size).toBe(batch.length);
    expect(() => limited.record("a", "pane3", { event: "open" })).toThrow(
      "size limit",
    );
  } finally {
    s.close();
    rmSync(s.dir, { recursive: true, force: true });
  }
});

it("reads bounded replay batches with byte cursors and waits for incomplete events", () => {
  const s = new Store(mkdtempSync(tmpdir() + "/exam-replay-")),
    m = new Monitoring(s);
  try {
    s.db.exec(
      "INSERT INTO exams VALUES('e','{}');INSERT INTO attempts(id,exam,username,uid,state,settings) VALUES('a','e','student',1001,'ACTIVE','{}')",
    );
    m.record("a", "pane", { event: "open", note: "日本語" });
    const path = `${s.dir}/monitoring/a/pane.ndjson`;
    const first = m.replay("a", "pane", 0);
    expect(first.text).toBe(readFileSync(path, "utf8"));
    expect(first.nextOffset).toBe(Buffer.byteLength(first.text));
    expect(first.more).toBe(false);
    expect(m.replay("a", "pane", first.nextOffset)).toEqual({
      text: "",
      nextOffset: first.nextOffset,
      availableBytes: first.availableBytes,
      more: false,
    });
    m.record("a", "pane", { event: "output", data: "bmV3" });
    const appended = m.replay("a", "pane", first.nextOffset);
    expect(appended.text.trim().split("\n")).toHaveLength(1);
    expect(JSON.parse(appended.text).data).toBe("bmV3");
    for (const offset of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
      expect(() => m.replay("a", "pane", offset)).toThrow(
        "Invalid recording offset",
      );
    expect(() => m.replay("a", "pane", appended.nextOffset + 1)).toThrow(
      "exceeds",
    );
    expect(() => m.replay("a", "pane", 2)).toThrow("complete event");
    writeFileSync(path, '{"event":"open"}');
    expect(m.replay("a", "pane", 0)).toEqual({
      text: "",
      nextOffset: 0,
      availableBytes: Buffer.byteLength('{"event":"open"}'),
      more: false,
    });
    writeFileSync(path, '{"event":"open"}\n');
    expect(JSON.parse(m.replay("a", "pane", 0).text)).toEqual({
      event: "open",
    });
    const line =
      JSON.stringify({ event: "output", data: "a".repeat(10000) }) + "\n";
    writeFileSync(path, line.repeat(150));
    let cursor = 0,
      combined = "",
      batches = 0;
    do {
      const batch = m.replay("a", "pane", cursor);
      expect(Buffer.byteLength(batch.text)).toBeLessThanOrEqual(1024 * 1024);
      expect(batch.text.endsWith("\n")).toBe(true);
      combined += batch.text;
      cursor = batch.nextOffset;
      batches++;
      if (!batch.more) break;
    } while (batches < 5);
    expect(batches).toBe(2);
    expect(combined).toBe(line.repeat(150));
    writeFileSync(path, "x".repeat(1024 * 1024));
    expect(() => m.replay("a", "pane", 0)).toThrow("batch limit");
  } finally {
    s.close();
    rmSync(s.dir, { recursive: true, force: true });
  }
});
