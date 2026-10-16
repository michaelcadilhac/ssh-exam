import { it, expect } from "vitest";
import {
  mkdtempSync,
  rmSync,
  existsSync,
  writeFileSync,
  readFileSync,
  truncateSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { Store } from "../../apps/server/src/db.js";
import { Monitoring } from "../../apps/server/src/monitoring.js";
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
