import {
  mkdirSync,
  writeFileSync,
  renameSync,
  rmSync,
  appendFileSync,
  existsSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { Store, hash, now, type Attempt } from "./db.js";
export class Monitoring {
  private inflight = 0;
  private instance = randomUUID();
  async frame(a: Attempt, input: any, page: string) {
    if (this.inflight >= 16)
      throw Error("Image worker capacity exceeded; retry within bounded grace");
    this.inflight++;
    try {
      return await this.accept(a, input, page);
    } finally {
      this.inflight--;
    }
  }
  constructor(private store: Store) {
    for (const d of ["monitoring", "submissions"])
      mkdirSync(`${store.dir}/${d}`, { recursive: true, mode: 0o700 });
  }
  private async accept(a: Attempt, input: any, page: string) {
    if (
      this.store.db
        .prepare("SELECT 1 FROM tombstones WHERE attempt=?")
        .get(a.id)
    )
      throw Error("Monitoring deleted");
    if (
      !["ACTIVE", "LOCKED", "PREPARING"].includes(a.state) &&
      !(a.ended && now() - a.ended < 30000)
    )
      throw Error("Capture period ended");
    const { source, seq, captured, monotonic, data } = input;
    if (
      !["screen", "webcam"].includes(source) ||
      !Number.isSafeInteger(seq) ||
      seq < 0 ||
      !Number.isSafeInteger(captured) ||
      Math.abs(captured - now()) > 120000 ||
      !Number.isFinite(monotonic) ||
      monotonic < 0 ||
      typeof data !== "string" ||
      data.length > 2100000
    )
      throw Error("Invalid image metadata");
    if (source === "webcam" && !JSON.parse(a.settings).webcam)
      throw Error("Webcam not requested");
    const bytes = Buffer.from(data, "base64");
    if (bytes.length > 1500000 || bytes.length < 32)
      throw Error("Image size invalid");
    const image = sharp(bytes, { limitInputPixels: 12000000 });
    const m = await image.metadata();
    if (
      m.format !== "jpeg" ||
      !m.width ||
      !m.height ||
      m.width > 2560 ||
      m.height > 2560
    )
      throw Error("Only bounded JPEG images accepted");
    await image.clone().raw().toBuffer();
    const digest = hash(bytes);
    const previous = this.store.db
      .prepare(
        "SELECT * FROM frames WHERE attempt=? AND source=? AND seq=? AND page_hash=?",
      )
      .get(a.id, source, seq, page) as any;
    if (previous) {
      if (previous.hash !== digest) throw Error("Conflicting duplicate image");
      return previous;
    }
    const thumb = await image
      .resize({ width: 400, withoutEnlargement: true })
      .jpeg()
      .toBuffer();
    if (
      this.store.db
        .prepare("SELECT 1 FROM tombstones WHERE attempt=?")
        .get(a.id)
    )
      throw Error("Monitoring deleted during upload");
    const id = randomUUID(),
      dir = `${this.store.dir}/monitoring/${a.id}`;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(`${dir}/${id}.tmp`, bytes, { mode: 0o600, flag: "wx" });
    renameSync(`${dir}/${id}.tmp`, `${dir}/${id}.jpg`);
    try {
      writeFileSync(`${dir}/${id}.thumb.jpg`, thumb, {
        mode: 0o600,
        flag: "wx",
      });
      this.store.db
        .prepare("INSERT INTO frames VALUES(?,?,?,?,?,?,?,?,?,?,?)")
        .run(
          id,
          a.id,
          source,
          seq,
          page,
          captured,
          monotonic,
          now(),
          m.width,
          m.height,
          digest,
        );
    } catch (e) {
      rmSync(`${dir}/${id}.jpg`, { force: true });
      rmSync(`${dir}/${id}.thumb.jpg`, { force: true });
      throw e;
    }
    return { id, hash: digest };
  }
  record(a: string, pane: string, event: object) {
    const dir = `${this.store.dir}/monitoring/${a}`;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const path = `${dir}/${pane}.ndjson`;
    if (!existsSync(path))
      this.store.db
        .prepare("INSERT OR IGNORE INTO recordings VALUES(?,?,?,?)")
        .run(randomUUID(), a, pane, now());
    appendFileSync(
      path,
      JSON.stringify({
        at: now(),
        monotonic_ms: performance.now(),
        gateway_instance: this.instance,
        ...event,
      }) + "\n",
      {
        mode: 0o600,
      },
    );
  }
  delete(id: string, actor: string) {
    this.store.db.transaction(() => {
      this.store.db
        .prepare("INSERT OR REPLACE INTO tombstones VALUES(?,?)")
        .run(id, now());
      this.store.db.prepare("DELETE FROM frames WHERE attempt=?").run(id);
      this.store.db.prepare("DELETE FROM recordings WHERE attempt=?").run(id);
      this.store.db
        .prepare(
          "UPDATE incidents SET events='[]',message=NULL WHERE attempt=?",
        )
        .run(id);
      this.store.audit(actor, "delete-monitoring", id);
    })();
    rmSync(`${this.store.dir}/monitoring/${id}`, {
      recursive: true,
      force: true,
    });
  }
  cleanup() {
    const rows = this.store.db
      .prepare(
        "SELECT id FROM attempts WHERE ended IS NOT NULL AND ended<? AND id NOT IN (SELECT attempt FROM tombstones)",
      )
      .all(now() - 60 * 86400000) as any[];
    for (const r of rows) this.delete(r.id, "retention");
    for (const r of this.store.db
      .prepare("SELECT attempt FROM tombstones")
      .all() as any[])
      rmSync(`${this.store.dir}/monitoring/${r.attempt}`, {
        recursive: true,
        force: true,
      });
  }
}
