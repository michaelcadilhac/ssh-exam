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
import { randomUUID, randomBytes } from "node:crypto";
import sharp from "sharp";
import { Store, hash, now, type Attempt } from "./db.js";
import { enqueueMonitoringPurge } from "./monitoring-purge-jobs.js";
import {
  MonitoringChallengeError,
  MonitoringReadiness,
  type CaptureReadinessSnapshot,
} from "./monitoring-readiness.js";
import {
  MonitoringEvidenceLedger,
  MonitoringEvidenceUnavailable,
  type MonitoringEvidenceBinding,
} from "./monitoring-evidence-ledger.js";
import {
  monitoringOwner,
  nativeMonitoringChallenge,
  nativeMonitoringContinuation,
  type MonitoringOwner,
  type MonitoringBootstrap,
} from "../../../packages/protocol/monitoring-evidence.js";
import { monitoringBootTimeMS } from "./monitoring-clock.js";
import { nativeContinuationOutcomeRecorded } from "./native-monitoring-state.js";
export class Monitoring {
  // Application wires the existing durable policy-lock workflow. Positive
  // proof is unavailable without it; an in-memory negative must not disappear
  // on restart and allow a genuine policy violation to bypass approval.
  onLivePolicyLoss?: (a: Attempt) => void;
  private readiness = new MonitoringReadiness();
  private liveLedger: MonitoringEvidenceLedger;
  private pendingBegins = new Map<
    string,
    {
      bootstrap: MonitoringBootstrap;
      snapshot: CaptureReadinessSnapshot;
      intent: string;
      grant: string;
      until: number;
      authorization?: string;
    }
  >();
  private live = new Map<
    string,
    {
      owner: string;
      settings: string;
      binding: MonitoringEvidenceBinding;
      tickets: Map<string, { challenge: string; accepted: boolean }>;
    }
  >();
  private currentLiveOwner(a: Attempt, page: string) {
    const nativePendingAcknowledgment =
      a.state === "LOCKED" &&
      nativeContinuationOutcomeRecorded(a) &&
      !!this.store.db
        .prepare(
          "SELECT 1 FROM continuations WHERE attempt=? AND generation=? AND consumed=1",
        )
        .get(a.id, a.generation);
    if (
      (a.state !== "ACTIVE" && !nativePendingAcknowledgment) ||
      !a.registered_owner ||
      !a.start ||
      !a.deadline ||
      !a.original_deadline ||
      a.protected ||
      a.checksum ||
      a.page_hash !== page
    )
      return undefined;
    let raw: unknown;
    try {
      raw = JSON.parse(a.registered_owner);
    } catch {
      return undefined;
    }
    const result = monitoringOwner.safeParse(raw);
    if (!result.success) return undefined;
    const owner = result.data;
    return owner.attempt === a.id &&
      owner.exam === a.exam &&
      owner.username === a.username &&
      owner.uid === a.uid &&
      owner.page_epoch === page &&
      owner.generation === a.generation &&
      owner.clock_revision === a.clock_revision
      ? owner
      : undefined;
  }
  private liveBinding(a: Attempt, page: string) {
    const owner = this.currentLiveOwner(a, page);
    if (!owner) return undefined;
    const encoded = JSON.stringify(owner),
      previous = this.live.get(a.id);
    if (previous?.owner === encoded && previous.settings === a.settings)
      return previous;
    // Current native ACTIVE identity comes only from the accepted signed native
    // outcome in Store. Disk identity starts an EMPTY ledger, never permission.
    // Retire closed/replaced owners rather than evicting a live owner's facts.
    for (const [id, entry] of this.live) {
      const current = this.store.attempt(id);
      if (
        !current ||
        current.settings !== entry.settings ||
        JSON.stringify(
          this.currentLiveOwner(current, current.page_hash ?? ""),
        ) !== entry.owner ||
        this.store.db
          .prepare("SELECT 1 FROM tombstones WHERE attempt=?")
          .get(id)
      ) {
        this.liveLedger.retire(entry.binding);
        this.live.delete(id);
      }
    }
    const entry = {
      owner: encoded,
      settings: a.settings,
      binding: this.liveLedger.registerTrustedOwner(
        owner,
        !!JSON.parse(a.settings).webcam,
      ),
      tickets: new Map<string, { challenge: string; accepted: boolean }>(),
    };
    const pending = this.pendingBegins.get(encoded);
    if (pending && monitoringBootTimeMS() >= pending.until)
      this.pendingBegins.delete(encoded);
    if (
      pending &&
      this.pendingBegins.has(encoded) &&
      pending.intent === a.grant_begin_intent &&
      pending.grant === a.grant_hash &&
      pending.snapshot.settings === a.settings &&
      (!pending.authorization ||
        pending.authorization === this.continuationIdentity(a, true))
    ) {
      try {
        this.liveLedger.seedValidatedBegin(
          entry.binding,
          pending.snapshot,
          pending.bootstrap.coverage_epoch,
        );
      } catch (error) {
        this.liveLedger.retire(entry.binding);
        throw error;
      }
      for (const [key, value] of this.pendingBegins)
        if (value.bootstrap.owner.attempt === a.id)
          this.pendingBegins.delete(key);
    }
    this.live.set(a.id, entry);
    return entry;
  }
  captureChallenge(a: Attempt, page: string, source: unknown) {
    a = this.currentCapture(a, page);
    const row = this.store.db
      .prepare(
        "SELECT MAX(seq) seq FROM frames WHERE attempt=? AND source=? AND page_hash=?",
      )
      .get(a.id, source, page) as { seq: number | null };
    const ticket = this.readiness.issue(a, page, source, row.seq ?? 0),
      live = this.liveBinding(a, page);
    if (live) {
      const challenge = this.liveLedger.issueBrowserChallenge(
        live.binding,
        ticket.source,
      );
      live.tickets.set(ticket.challenge, { challenge, accepted: false });
      if (live.tickets.size > 32)
        live.tickets.delete(live.tickets.keys().next().value!);
    }
    return ticket;
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
  beginBootstrap(a: Attempt, owner: MonitoringOwner) {
    const current = this.currentCapture(a, owner.page_epoch),
      snapshot = this.readiness.snapshotBeforeStart(current, owner.page_epoch);
    return this.captureBootstrap(current, owner, snapshot);
  }
  private continuationIdentity(a: Attempt, consumed: boolean) {
    const row = this.store.db
      .prepare(
        "SELECT generation,expires,consumed FROM continuations WHERE attempt=?",
      )
      .get(a.id) as
      | { generation: number; expires: number; consumed: number }
      | undefined;
    if (
      !row ||
      row.generation !== a.generation ||
      !!row.consumed !== consumed ||
      (!consumed && row.expires <= now())
    )
      return undefined;
    const issuance = this.store.db
      .prepare(
        "SELECT rowid identity FROM audit WHERE target=? AND action IN ('authorize-continuation','automatic-continuation') ORDER BY rowid DESC LIMIT 1",
      )
      .get(a.id) as { identity: number } | undefined;
    if (!issuance) return undefined;
    return JSON.stringify([row.generation, row.expires, issuance.identity]);
  }
  continueBootstrap(input: unknown, agent: string) {
    const request = nativeMonitoringContinuation.parse(input),
      a = this.store.attempt(request.owner.attempt);
    if (
      !a ||
      request.agent !== agent ||
      a.state !== "LOCKED" ||
      !a.start ||
      !a.deadline ||
      a.deadline <= now() ||
      !a.original_deadline ||
      a.protected ||
      a.checksum ||
      !a.registered_owner ||
      !this.onLivePolicyLoss
    )
      throw new MonitoringEvidenceUnavailable("ownership");
    const previous = monitoringOwner.parse(JSON.parse(a.registered_owner)),
      owner = request.owner;
    if (
      JSON.stringify(previous) !== JSON.stringify(request.previous_owner) ||
      owner.attempt !== a.id ||
      owner.exam !== a.exam ||
      owner.username !== a.username ||
      owner.uid !== a.uid ||
      owner.page_epoch !== a.page_hash ||
      owner.page_epoch !== previous.page_epoch ||
      owner.transport_hash !== previous.transport_hash ||
      owner.boot !== previous.boot ||
      owner.generation !== a.generation ||
      owner.generation <= previous.generation ||
      owner.clock_revision !== a.clock_revision ||
      owner.input_epoch === previous.input_epoch
    )
      throw new MonitoringEvidenceUnavailable("ownership");
    const authorization = this.continuationIdentity(a, false);
    if (!authorization)
      throw new MonitoringEvidenceUnavailable("policy-blocked");
    const expires = (JSON.parse(authorization) as [number, number])[1],
      snapshot = this.readiness.snapshotForContinuation(
        this.currentCapture(a, owner.page_epoch),
        owner.page_epoch,
      ),
      result = this.captureBootstrap(a, owner, snapshot, authorization);
    return {
      type: "monitoring-continue/v1",
      audience: agent,
      nonce: request.nonce,
      previous_owner: previous,
      owner,
      authorization_expires: expires,
      expires: Math.min(expires, now() + 30000),
      capture_valid_for_ms: result.remainingMS,
      bootstrap: result.bootstrap,
    };
  }
  private captureBootstrap(
    current: Attempt,
    owner: MonitoringOwner,
    snapshot: CaptureReadinessSnapshot,
    authorization?: string,
  ) {
    const encoded = JSON.stringify(owner),
      now = monitoringBootTimeMS();
    if (!current.grant_begin_intent || !current.grant_hash)
      throw new MonitoringEvidenceUnavailable("ownership");
    for (const [key, pending] of this.pendingBegins)
      if (now >= pending.until) this.pendingBegins.delete(key);
    let pending = this.pendingBegins.get(encoded);
    if (
      pending &&
      (pending.intent !== current.grant_begin_intent ||
        pending.grant !== current.grant_hash ||
        pending.authorization !== authorization ||
        pending.snapshot.settings !== current.settings)
    )
      throw new MonitoringEvidenceUnavailable("conflict");
    if (!pending) {
      if (this.pendingBegins.size >= 512)
        throw new MonitoringEvidenceUnavailable("capacity");
      pending = {
        bootstrap: Object.freeze({
          type: "monitoring-bootstrap/v1",
          owner: Object.freeze({ ...owner }),
          coverage_epoch: randomBytes(32).toString("hex"),
          sequence: 1,
        }),
        snapshot,
        intent: current.grant_begin_intent,
        grant: current.grant_hash,
        until:
          Math.min(
            snapshot.policy.issued,
            ...snapshot.frames.map((f) => f.issued),
          ) + 15000,
        authorization,
      };
      this.pendingBegins.set(encoded, pending);
    }
    const remainingMS = pending.until - now;
    if (
      !Number.isSafeInteger(remainingMS) ||
      remainingMS <= 0 ||
      remainingMS > 15000
    )
      throw new MonitoringEvidenceUnavailable("technical-gap");
    return { remainingMS, bootstrap: pending.bootstrap };
  }
  executionEvidence(input: unknown) {
    const request = nativeMonitoringChallenge.parse(input),
      a = this.store.attempt(request.owner.attempt);
    if (!a || !this.onLivePolicyLoss)
      throw new MonitoringEvidenceUnavailable("ownership");
    this.currentCapture(a, request.owner.page_epoch);
    const entry = this.liveBinding(a, request.owner.page_epoch);
    if (!entry) throw new MonitoringEvidenceUnavailable("ownership");
    try {
      return this.liveLedger.issueForNativeChallenge(entry.binding, request);
    } catch (error) {
      if (
        error instanceof MonitoringEvidenceUnavailable &&
        error.kind === "policy-blocked"
      )
        this.onLivePolicyLoss(a);
      throw error;
    }
  }
  private confirmCapture(
    a: Attempt,
    page: string,
    input: any,
    frame: { id: string; hash: string },
  ) {
    const observation = this.readiness.confirm(a, page, input, frame),
      entry = this.live.get(a.id),
      ticket = entry?.tickets.get(input.challenge);
    if (
      entry &&
      ticket &&
      !ticket.accepted &&
      a.settings === entry.settings &&
      JSON.stringify(this.currentLiveOwner(a, page)) === entry.owner
    ) {
      let blocked = false;
      try {
        this.liveLedger.confirmValidatedCapture(
          entry.binding,
          ticket.challenge,
          input.source,
          input.seq,
          input.readiness,
        );
        blocked =
          this.liveLedger.inspect(entry.binding).state === "policy-blocked";
      } catch (error) {
        // Keep the validated JPEG for review even after permission was blocked.
        // No late/replayed image can replace missing live proof with readiness.
        if (!(error instanceof MonitoringEvidenceUnavailable)) throw error;
        blocked = error.kind === "policy-blocked";
      }
      ticket.accepted = true; // Exact image retry never refreshes live evidence.
      if (blocked) this.onLivePolicyLoss?.(a);
    }
    return observation;
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
    agent = "class",
  ) {
    this.liveLedger = new MonitoringEvidenceLedger(agent, undefined, 512);
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
          monitoring: this.confirmCapture(current, page, input, previous),
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
          monitoring: this.confirmCapture(
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
