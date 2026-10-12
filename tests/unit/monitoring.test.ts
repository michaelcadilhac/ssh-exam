import { it, expect } from "vitest";
import { mkdtempSync, rmSync, existsSync, writeFileSync } from "node:fs";
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
