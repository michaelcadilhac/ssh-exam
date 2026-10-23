import {
  constants,
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
import { enqueueMonitoringPurge } from "./monitoring-purge-jobs.js";
import {
  MonitoringChallengeError,
  MonitoringReadiness,
} from "./monitoring-readiness.js";
export class Monitoring {
  private readiness = new MonitoringReadiness();
  captureChallenge(a: Attempt, page: string, source: unknown) {
    this.currentCapture(a, page);
    const row = this.store.db
      .prepare(
        "SELECT MAX(seq) seq FROM frames WHERE attempt=? AND source=? AND page_hash=?",
      )
      .get(a.id, source, page) as { seq: number | null };
    return this.readiness.issue(a, page, source, row.seq ?? 0);
  }
  challengedFrame(a: Attempt, input: any, page: string) {
    return this.frame(a, input, page, true);
  }
  private currentCapture(a: Attempt, page: string) {
    const current = this.store.attempt(a.id);
    if (
      !current ||
      current.page_hash !== page ||
      current.generation !== a.generation ||
      current.settings !== a.settings ||
      this.store.db
        .prepare("SELECT 1 FROM tombstones WHERE attempt=?")
        .get(a.id)
    )
      throw new MonitoringChallengeError("monitoring_challenge_scope");
    return current;
  }
  captureReadiness(a: Attempt, page: string) {
    return this.readiness.inspect(this.currentCapture(a, page), page);
  }
  requireBeginReadiness(a: Attempt) {
    const evidence = this.captureReadiness(a, a.page_hash ?? "");
    if (!evidence.complete || evidence.age_ms === null)
      throw new MonitoringChallengeError("monitoring_challenge_not_ready");
    return 15000 - evidence.age_ms;
  }
  private inflight = 0;
  private instance = randomUUID();
  async frame(a: Attempt, input: any, page: string, challenged = false) {
    if (this.inflight >= 16)
      throw Error("Image worker capacity exceeded; retry within bounded grace");
    this.inflight++;
    try {
      return await this.accept(a, input, page, challenged);
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
  private async accept(
    a: Attempt,
    input: any,
    page: string,
    challenged: boolean,
  ) {
    if (challenged)
      this.readiness.validate(this.currentCapture(a, page), page, input);
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
    if (challenged) {
      const { ticket } = this.readiness.validate(
        this.currentCapture(a, page),
        page,
        input,
      );
      if (ticket.recorded && ticket.recorded.hash !== digest)
        throw new MonitoringChallengeError("monitoring_challenge_conflict");
    }
    const previous = this.store.db
      .prepare(
        "SELECT * FROM frames WHERE attempt=? AND source=? AND seq=? AND page_hash=?",
      )
      .get(a.id, source, seq, page) as any;
    if (previous) {
      if (previous.hash !== digest) throw Error("Conflicting duplicate image");
      if (challenged) {
        const current = this.currentCapture(a, page),
          { ticket } = this.readiness.validate(current, page, input);
        if (!ticket.recorded)
          throw new MonitoringChallengeError("monitoring_challenge_conflict");
        return {
          ...previous,
          monitoring: this.readiness.confirm(current, page, input, previous),
        };
      }
      return previous;
    }
    const thumb = await image
      .resize({ width: 400, withoutEnlargement: true })
      .jpeg()
      .toBuffer();
    if (challenged) {
      const { ticket } = this.readiness.validate(
        this.currentCapture(a, page),
        page,
        input,
      );
      if (ticket.recorded)
        throw new MonitoringChallengeError("monitoring_challenge_conflict");
    }
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
    const result = { id, hash: digest };
    return challenged
      ? {
          ...result,
          monitoring: this.readiness.confirm(
            this.currentCapture(a, page),
            page,
            input,
            result,
          ),
        }
      : result;
  }
  private checkRecordingBudget(dir: string, extra: number) {
    const total = readdirSync(dir)
      .filter((name) => name.endsWith(".ndjson"))
      .reduce((sum, name) => sum + statSync(`${dir}/${name}`).size, 0);
    if (total + extra > this.terminalRecordingLimitMiB * 1024 * 1024)
      throw Error("Terminal recording size limit reached");
  }
  record(a: string, pane: string, event: object) {
    // Late legacy transport callbacks must obey the same durable deletion
    // fence as signed native batches; deletion must never recreate recordings.
    if (
      this.store.db.prepare("SELECT 1 FROM tombstones WHERE attempt=?").get(a)
    )
      return;
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
    if (
      this.store.db
        .prepare("SELECT 1 FROM tombstones WHERE attempt=?")
        .get(attempt)
    )
      throw Object.assign(
        Error("Monitoring deleted; retained files cannot be replayed"),
        { statusCode: 410 },
      );
    if (!Number.isSafeInteger(offset) || offset < 0)
      throw Error("Invalid recording offset");
    const fd = openSync(
      `${this.store.dir}/monitoring/${attempt}/${pane}.ndjson`,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const info = fstatSync(fd);
      if (!info.isFile() || info.nlink !== 1)
        throw Error("Recording must be a regular private file");
      const size = info.size;
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
        availableBytes: size,
        // A partial last event will be retried on the next refresh.
        more: count === 1024 * 1024 && nextOffset < size,
      };
    } finally {
      closeSync(fd);
    }
  }
  delete(id: string, actor: string) {
    if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(id))
      throw Error("Invalid monitoring target; use an attempt ID");
    this.store.db.transaction(() => {
      const first = this.store.db
        .prepare("INSERT OR IGNORE INTO tombstones VALUES(?,?)")
        .run(id, now());
      this.store.db
        .prepare("DELETE FROM attempt_interruptions WHERE attempt=?")
        .run(id);
      this.store.db.prepare("DELETE FROM frames WHERE attempt=?").run(id);
      this.store.db.prepare("DELETE FROM recordings WHERE attempt=?").run(id);
      this.store.db
        .prepare(
          "UPDATE incidents SET events='[]',message=NULL WHERE attempt=?",
        )
        .run(id);
      enqueueMonitoringPurge(this.store, id);
      if (first.changes) this.store.audit(actor, "delete-monitoring", id);
    })();
  }
  cleanup() {
    const attempted = new Set<string>(),
      failed = new Set<string>();
    const rows = this.store.db
      .prepare(
        "SELECT id FROM attempts WHERE ended IS NOT NULL AND ended<? AND id NOT IN (SELECT attempt FROM tombstones) ORDER BY ended,id LIMIT 100",
      )
      .all(now() - 60 * 86400000) as any[];
    for (const r of rows) {
      attempted.add(r.id);
      try {
        this.delete(r.id, "retention");
      } catch {
        failed.add(r.id);
      }
    }
    // Filesystem removal happens only in the separately supervised OS worker.
    // Bounded metadata batches let callers continue an existing backlog promptly.
    return {
      failed: failed.size,
      considered: attempted.size,
      more: rows.length === 100,
    };
  }
}
