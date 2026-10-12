import { randomUUID } from "node:crypto";
import {
  openSync,
  closeSync,
  writeFileSync,
  fsyncSync,
  linkSync,
  unlinkSync,
  existsSync,
  readFileSync,
} from "node:fs";
import path from "node:path";
import { Store, now, hash, type Attempt } from "./db.js";
import { Agent } from "./agent.js";
import { Monitoring } from "./monitoring.js";
export class Lifecycle {
  private busy = new Set<string>();
  onEnd = (_attempt: Attempt) => {};
  onSecured = (_attempt: Attempt) => {};
  onPaused = (_attempt: Attempt) => {};
  private inspected = new Map<string, number>();
  constructor(
    public store: Store,
    public agent: Agent,
    public monitoring: Monitoring,
  ) {}
  alert(subject: string, body: string) {
    const pending = this.store.db
      .prepare(
        "SELECT id,body FROM outbox WHERE subject=? AND status='pending' AND next>? LIMIT 1",
      )
      .get(subject, now() - 60000) as any;
    if (pending) {
      if (!pending.body.includes(body))
        this.store.db
          .prepare("UPDATE outbox SET body=? WHERE id=?")
          .run((pending.body + "\n" + body).slice(0, 12000), pending.id);
      return;
    }
    this.store.db
      .prepare("INSERT INTO outbox(id,subject,body,next) VALUES(?,?,?,?)")
      .run(randomUUID(), subject, body, now());
  }
  async lock(id: string, reason: string) {
    const a = this.store.attempt(id);
    if (!["ACTIVE", "LOCKED"].includes(a.state)) return;
    const transaction = this.store.db.transaction(() => {
      const granted = this.store.db
        .prepare(
          "SELECT 1 FROM continuations WHERE attempt=? AND consumed=0 AND expires>?",
        )
        .get(id, now());
      if (a.state === "ACTIVE" || granted)
        this.store.db
          .prepare(
            "UPDATE attempts SET state='LOCKED',generation=generation+1,reason=? WHERE id=?",
          )
          .run(reason, id);
      if (granted)
        this.store.db
          .prepare("DELETE FROM continuations WHERE attempt=?")
          .run(id);
      const b = this.store.attempt(id);
      const prior = this.store.db
        .prepare("SELECT * FROM incidents WHERE attempt=? AND generation=?")
        .get(id, b.generation) as any;
      const events = prior ? JSON.parse(prior.events) : [];
      events.push({ at: now(), reason });
      if (prior)
        this.store.db
          .prepare("UPDATE incidents SET events=? WHERE id=?")
          .run(JSON.stringify(events.slice(-100)), prior.id);
      else {
        this.store.db
          .prepare(
            "INSERT INTO incidents(id,attempt,generation,opened,events) VALUES(?,?,?,?,?)",
          )
          .run(randomUUID(), id, b.generation, now(), JSON.stringify(events));
        this.alert(
          `Exam interrupted: ${a.username}`,
          `${a.exam}: ${reason}. Remaining ${Math.max(0, Math.floor(((a.deadline || now()) - now()) / 1000))} seconds. Open the authenticated instructor dashboard.`,
        );
      }
      this.store.audit("gateway", "lock", id, reason);
    });
    transaction();
    this.store.audit("gateway", "reauthentication-required", id);
    this.onPaused(this.store.attempt(id));
    await this.agent
      .call("lock-attempt", {
        id,
        reason,
        generation: this.store.attempt(id).generation,
      })
      .then((remote) => {
        if (remote?.generation > this.store.attempt(id).generation) {
          this.store.db
            .prepare("UPDATE attempts SET generation=? WHERE id=?")
            .run(remote.generation, id);
          this.store.db
            .prepare("DELETE FROM continuations WHERE attempt=?")
            .run(id);
        }
      })
      .catch(() =>
        this.alert(
          "Class agent unavailable",
          `Attempt ${id} is locked at the gateway. Local execution lease must expire.`,
        ),
      );
  }
  async reconcile(id: string) {
    const remote = await this.agent.call("inspect-attempt", { id });
    this.syncAccess(id, remote);
    const a = this.store.attempt(id);
    if (remote.start && a.start === null) {
      this.store.db
        .prepare(
          "UPDATE attempts SET start=?,deadline=?,work_path=?,state='ACTIVE' WHERE id=?",
        )
        .run(remote.start, remote.deadline, remote.work_path, id);
      await this.lock(id, "Activation acknowledgment lost");
    }
    if (
      remote.state === "CANCELLED_BEFORE_START" &&
      !remote.start &&
      a.start === null
    ) {
      this.store.db
        .prepare(
          "UPDATE attempts SET state='CANCELLED_BEFORE_START',ended=COALESCE(ended,?),reason=COALESCE(?,reason) WHERE id=?",
        )
        .run(
          now(),
          remote.reason || "Preparation cancelled before activation",
          id,
        );
      this.monitoring.delete(id, "preflight-cancelled");
    }
    if (remote.state === "LOCKED" && a.state === "ACTIVE")
      await this.lock(id, "Local execution lease expired");
    if (
      remote.state === "LOCKED" &&
      remote.generation > this.store.attempt(id).generation
    ) {
      this.store.db
        .prepare("UPDATE attempts SET generation=? WHERE id=?")
        .run(remote.generation, id);
      this.store.db
        .prepare("DELETE FROM continuations WHERE attempt=?")
        .run(id);
      this.store.audit("gateway", "remote-generation-reconciled", id);
    }
    if (["COMPLETED", "COLLECTION_FAILED", "FINALIZING"].includes(remote.state))
      await this.finish(id, remote.reason || "expiration");
    return remote;
  }
  syncAccess(id: string, remote: any) {
    if (
      remote.access_error &&
      remote.access_error !== this.store.attempt(id).access_error
    )
      this.alert(
        "Account access release requires recovery",
        `Attempt ${id}: ${remote.access_error}. Account remains restricted.`,
      );
    const state = ["HELD", "RELEASED", "OVERRIDDEN"].includes(
      remote.access_state,
    )
      ? remote.access_state
      : remote.start
        ? "HELD"
        : "UNKNOWN";
    this.store.db
      .prepare(
        "UPDATE attempts SET access_state=?,access_held_at=?,access_released_at=?,access_override=?,access_checked_at=?,access_error=? WHERE id=?",
      )
      .run(
        state,
        remote.access_held_at || remote.start || null,
        remote.access_released_at || null,
        remote.access_override || null,
        now(),
        remote.access_error || null,
        id,
      );
  }
  async cancelPreflight(id: string, reason: string) {
    if (this.busy.has(id)) return;
    const a = this.store.attempt(id);
    if (a.state !== "PREPARING" || a.start !== null) return;
    this.busy.add(id);
    try {
      await this.agent.call("cancel-attempt", { id });
      await this.reconcile(id);
      if (this.store.attempt(id).state === "CANCELLED_BEFORE_START") {
        this.store.db
          .prepare("UPDATE attempts SET reason=? WHERE id=?")
          .run(reason, id);
        this.store.audit("gateway", "cancel-preflight", id, reason);
      }
    } catch (e) {
      // A lost activation response must never become a fresh attempt.
      await this.reconcile(id).catch(() => {});
      throw e;
    } finally {
      this.busy.delete(id);
    }
  }
  async retirePreflight(id: string) {
    const a = this.store.attempt(id);
    const remote = await this.agent.call("inspect-attempt", { id });
    if (
      a.state !== "CANCELLED_BEFORE_START" ||
      a.start !== null ||
      a.deadline !== null ||
      remote.state !== "CANCELLED_BEFORE_START" ||
      remote.start
    ) {
      await this.reconcile(id);
      throw Error(
        "The previous preparation cannot be retried until its start status is confirmed.",
      );
    }
    this.monitoring.delete(id, "preflight-retry");
    this.store.db.transaction(() => {
      const current = this.store.attempt(id);
      if (current.state !== "CANCELLED_BEFORE_START" || current.start !== null)
        throw Error("Preparation state changed");
      this.store.audit(
        "gateway",
        "retire-preflight",
        id,
        JSON.stringify(current),
      );
      this.store.db.prepare("DELETE FROM incidents WHERE attempt=?").run(id);
      this.store.db
        .prepare("DELETE FROM continuations WHERE attempt=?")
        .run(id);
      this.store.db.prepare("DELETE FROM attempts WHERE id=?").run(id);
    })();
  }
  isBusy(id: string) {
    return this.busy.has(id);
  }
  async finish(id: string, reason: string) {
    if (
      !this.store.attempt(id).start ||
      this.store.attempt(id).state === "CANCELLED_BEFORE_START"
    )
      throw Error(
        "The exam has not started; there is no submission to collect.",
      );
    if (this.busy.has(id)) return;
    this.busy.add(id);
    try {
      let a = this.store.attempt(id);
      if (
        a.state === "COMPLETED" &&
        ["ready", "deleted"].includes(a.export_status || "")
      )
        return;
      if (!["COMPLETED", "FINALIZING", "COLLECTION_FAILED"].includes(a.state))
        this.store.db
          .prepare(
            "UPDATE attempts SET state='FINALIZING',reason=?,ended=COALESCE(ended,?) WHERE id=?",
          )
          .run(reason, reason === "expiration" ? a.deadline : now(), id);
      this.onEnd(this.store.attempt(id));
      let result;
      try {
        result = await this.agent.call(
          a.state === "COMPLETED" ? "submission-status" : "finalize-attempt",
          { id, reason },
        );
      } catch (error) {
        result = await this.agent
          .call("submission-status", { id })
          .catch(() => {
            throw error;
          });
      }
      this.syncAccess(id, result);
      if (!result.protected || !/^[a-f0-9]{64}$/.test(result.checksum || ""))
        throw Error("Protected collection not confirmed");
      const manifest = await this.agent.call("submission-manifest", { id });
      const identity = manifest.attempt;
      if (
        manifest.checksum !== result.checksum ||
        !identity ||
        identity.id !== id ||
        identity.exam !== a.exam ||
        identity.username !== a.username ||
        identity.uid !== a.uid ||
        identity.start !== a.start ||
        identity.deadline !== a.deadline
      )
        throw Error("Protected manifest verification failed");
      if (a.checksum && a.checksum !== result.checksum)
        throw Error("Secured submission cannot be replaced");
      this.store.db
        .prepare(
          "UPDATE attempts SET state=?,protected=1,checksum=?,export_status='pending',ended=?,reason=?,completed_at=?,collected_at=?,secured_at=? WHERE id=?",
        )
        .run(
          result.state === "COMPLETED" ? "COMPLETED" : "COLLECTION_FAILED",
          result.checksum,
          result.ended,
          result.reason,
          result.completed_at || null,
          manifest.collected || null,
          manifest.secured || null,
          id,
        );
      this.onSecured(this.store.attempt(id));
      if (result.state !== "COMPLETED")
        this.alert(
          "Workload cleanup requires recovery",
          `Submission ${id} is secured; student workload termination is not confirmed.`,
        );
      if (manifest.omissions?.length)
        this.alert(
          "Submission entries omitted",
          `Attempt ${id}: review the protected manifest for ${manifest.omissions.length} omitted entries.`,
        );
      try {
        const bytes = await this.agent.archive(id);
        if (hash(bytes) !== result.checksum)
          throw Error("Submission transfer checksum mismatch");
        const archive = `${this.store.dir}/submissions/${id}.tar.gz`;
        this.publish(archive, bytes);
        this.publish(
          `${this.store.dir}/submissions/${id}.manifest.json`,
          Buffer.from(JSON.stringify(manifest, null, 2)),
        );
        this.store.db
          .prepare("UPDATE attempts SET export_status='ready' WHERE id=?")
          .run(id);
      } catch {
        this.alert(
          "Submission export pending",
          `Protected copy exists for ${id}; verified transfer will retry from that copy.`,
        );
      }
    } catch (e) {
      const a = this.store.attempt(id);
      if (a.state !== "COMPLETED")
        this.store.db
          .prepare(
            "UPDATE attempts SET state='COLLECTION_FAILED',ended=COALESCE(ended,?) WHERE id=?",
          )
          .run(now(), id);
      this.alert(
        "Collection requires recovery",
        `Attempt ${id}: protected collection not confirmed. Account remains blocked.`,
      );
    } finally {
      this.busy.delete(id);
    }
  }
  private publish(file: string, bytes: Buffer) {
    const syncDirectory = () => {
      const directory = openSync(path.dirname(file), "r");
      try {
        fsyncSync(directory);
      } finally {
        closeSync(directory);
      }
    };
    if (existsSync(file)) {
      if (hash(readFileSync(file)) !== hash(bytes))
        throw Error("Existing submission artifact cannot be replaced");
      syncDirectory();
      return;
    }
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      const fd = openSync(temporary, "wx", 0o600);
      try {
        writeFileSync(fd, bytes);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      linkSync(temporary, file);
      syncDirectory();
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
    }
  }
  async tick() {
    const rows = this.store.db
      .prepare(
        "SELECT * FROM attempts WHERE state IN ('PREPARING','ACTIVE','LOCKED','FINALIZING','COLLECTION_FAILED') OR (state='COMPLETED' AND (export_status NOT IN ('ready','deleted') OR access_state NOT IN ('RELEASED','OVERRIDDEN')))",
      )
      .all() as Attempt[];
    for (const a of rows) {
      if (
        a.state === "COMPLETED" &&
        now() - (this.inspected.get(a.id) || 0) > 10000
      ) {
        this.inspected.set(a.id, now());
        await this.reconcile(a.id).catch(() => {});
      }
      if (
        (a.deadline && now() >= a.deadline) ||
        ["FINALIZING", "COLLECTION_FAILED", "COMPLETED"].includes(a.state)
      ) {
        await this.finish(
          a.id,
          a.deadline && now() >= a.deadline
            ? "expiration"
            : a.reason || "expiration",
        );
        continue;
      }
      if (now() - (this.inspected.get(a.id) || 0) > 10000) {
        this.inspected.set(a.id, now());
        await this.reconcile(a.id).catch(() => {});
      }
      if (a.state === "ACTIVE" && now() - (a.last_contact || 0) > 15000)
        await this.lock(a.id, "Client contact exceeded 15 seconds");
    }
  }
}
