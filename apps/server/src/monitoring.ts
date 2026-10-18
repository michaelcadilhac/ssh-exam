import {
  mkdirSync,
  writeFileSync,
  renameSync,
  rmSync,
  appendFileSync,
  existsSync,
  openSync,
  closeSync,
  fstatSync,
  fsyncSync,
  readSync,
  statSync,
  readdirSync,
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
  constructor(
    private store: Store,
    private terminalRecordingLimitMiB = 2048,
  ) {
    if (
      !Number.isSafeInteger(terminalRecordingLimitMiB) ||
      terminalRecordingLimitMiB < 1 ||
      terminalRecordingLimitMiB > 1048576
    )
      throw Error("Invalid terminal recording limit");
    for (const d of ["monitoring", "receipts", "submissions"])
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
  private checkRecordingBudget(dir: string, extra: number) {
    const total = readdirSync(dir)
      .filter((name) => name.endsWith(".ndjson"))
      .reduce((sum, name) => sum + statSync(`${dir}/${name}`).size, 0);
    if (total + extra > this.terminalRecordingLimitMiB * 1024 * 1024)
      throw Error("Terminal recording size limit reached");
  }
  record(a: string, pane: string, event: object) {
    const dir = `${this.store.dir}/monitoring/${a}`;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const path = `${dir}/${pane}.ndjson`;
    if (!existsSync(path))
      this.store.db
        .prepare("INSERT OR IGNORE INTO recordings VALUES(?,?,?,?)")
        .run(randomUUID(), a, pane, now());
    const line =
      JSON.stringify({
        at: now(),
        monotonic_ms: performance.now(),
        gateway_instance: this.instance,
        ...event,
      }) + "\n";
    this.checkRecordingBudget(dir, Buffer.byteLength(line));
    appendFileSync(path, line, { mode: 0o600 });
  }

  receiveRecording(a: string, pane: string, offset: number, bytes: Buffer) {
    if (
      this.store.db.prepare("SELECT 1 FROM tombstones WHERE attempt=?").get(a)
    )
      return;
    if (bytes.length > 256 * 1024 || !bytes.length || bytes.at(-1) !== 10)
      throw Error("Invalid recording batch");
    for (const line of bytes.toString().trimEnd().split("\n")) {
      const e = JSON.parse(line);
      if (
        e.source !== "class-agent" ||
        !Number.isSafeInteger(e.at) ||
        !["open", "output", "resize", "close"].includes(e.event)
      )
        throw Error("Invalid trusted recording event");
    }
    const dir = `${this.store.dir}/monitoring/${a}`;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const path = `${dir}/${pane}.ndjson`;
    const size = existsSync(path) ? statSync(path).size : 0;
    if (offset > size) throw Error("Recording offset gap");
    const overlap = Math.min(size - offset, bytes.length);
    if (overlap) {
      const old = Buffer.alloc(overlap),
        fd = openSync(path, "r");
      try {
        if (
          readSync(fd, old, 0, overlap, offset) !== overlap ||
          !old.equals(bytes.subarray(0, overlap))
        )
          throw Error("Conflicting recording retry");
      } finally {
        closeSync(fd);
      }
    }
    if (overlap < bytes.length) {
      this.checkRecordingBudget(dir, bytes.length - overlap);
      appendFileSync(path, bytes.subarray(overlap), { mode: 0o600 });
      const fd = openSync(path, "r");
      try {
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      for (const directory of [dir, `${this.store.dir}/monitoring`]) {
        const fd = openSync(directory, "r");
        try {
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
      }
    }
    if (
      !this.store.db
        .prepare("SELECT 1 FROM recordings WHERE attempt=? AND pane=?")
        .get(a, pane)
    )
      this.store.db
        .prepare("INSERT INTO recordings VALUES(?,?,?,?)")
        .run(randomUUID(), a, pane, now());
  }
  replay(attempt: string, pane: string, offset: number) {
    if (!Number.isSafeInteger(offset) || offset < 0)
      throw Error("Invalid recording offset");
    const fd = openSync(
      `${this.store.dir}/monitoring/${attempt}/${pane}.ndjson`,
      "r",
    );
    try {
      const size = fstatSync(fd).size;
      if (offset > size) throw Error("Recording offset exceeds available data");
      if (offset) {
        const previous = Buffer.alloc(1);
        readSync(fd, previous, 0, 1, offset - 1);
        if (previous[0] !== 10)
          throw Error("Recording offset must follow a complete event");
      }
      const bytes = Buffer.alloc(Math.min(size - offset, 1024 * 1024));
      const count = readSync(fd, bytes, 0, bytes.length, offset);
      const complete = bytes.subarray(0, count).lastIndexOf(10) + 1;
      if (!complete && size - offset >= 1024 * 1024)
        throw Error("Recording event exceeds replay batch limit");
      const nextOffset = offset + complete;
      return {
        text: bytes.subarray(0, complete).toString("utf8"),
        nextOffset,
        // A partial last event will be retried on the next refresh.
        more: count === 1024 * 1024 && nextOffset < size,
      };
    } finally {
      closeSync(fd);
    }
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
