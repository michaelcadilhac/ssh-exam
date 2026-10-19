import { cleanupDiagnostic } from "./cleanup-diagnostic.js";
import { formatDuration } from "../../../packages/protocol/time.js";
import {
  FOCUS_GRACE_MS,
  FOCUS_GRACE_REASON,
} from "../../../packages/protocol/focus-grace.js";
import { isDeepStrictEqual } from "node:util";
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
import { Agent, AgentCommandDisconnectedError } from "./agent.js";
import { Monitoring } from "./monitoring.js";
// Collection metadata is immutable; connection bookkeeping is not part of the
// submission. SSH replies and callbacks must compare the same public snapshot.
function manifestSnapshot(manifest: any) {
  const snapshot = { ...manifest, attempt: { ...manifest.attempt } };
  for (const key of [
    "transport",
    "resume_transport",
    "authorization",
    "lease",
    "units",
  ])
    delete snapshot.attempt[key];
  const ordered = (value: any): any =>
    Array.isArray(value)
      ? value.map(ordered)
      : value !== null && typeof value === "object"
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, ordered(value[key])]),
          )
        : value;
  return JSON.stringify(ordered(snapshot), null, 2);
}
// Only routine Emacs lock links for a file actually present in this submission
// are notification noise. Do not alter the signed manifest or relax collection.
function hasUnexpectedOmissions(manifest: {
  files?: unknown;
  omissions?: unknown;
}) {
  if (manifest.omissions === undefined || manifest.omissions === null)
    return false;
  if (!Array.isArray(manifest.omissions)) return true;
  if (manifest.omissions.length === 0) return false;
  const savedFiles = new Set(
    Array.isArray(manifest.files)
      ? manifest.files.flatMap((file) =>
          typeof file?.path === "string" ? [file.path] : [],
        )
      : [],
  );
  const suffix = ": symlink omitted (never dereferenced)";
  return manifest.omissions.some((omission) => {
    if (typeof omission !== "string" || !omission.endsWith(suffix)) return true;
    const omittedPath = omission.slice(0, -suffix.length);
    const name = path.posix.basename(omittedPath);
    if (!name.startsWith(".#") || name.length <= 2) return true;
    const savedPath = path.posix.join(
      path.posix.dirname(omittedPath),
      name.slice(2),
    );
    return !savedFiles.has(savedPath);
  });
}
export class Lifecycle {
  private busy = new Set<string>();
  onEnd = (_attempt: Attempt) => {};
  onSecured = (_attempt: Attempt) => {};
  onPaused = (_attempt: Attempt) => {};
  onClockChanged = (_attempt: Attempt) => {};
  onPreflightFailure = (_details: Record<string, unknown>) => {};
  constructor(
    public store: Store,
    public agent: Agent,
    public monitoring: Monitoring,
  ) {}
  alert(subject: string, body: string, options: { coalesce?: boolean } = {}) {
    const pending = (
      options.coalesce === false
        ? this.store.db
            .prepare(
              "SELECT id,body FROM outbox WHERE subject=? AND body=? AND status='pending' AND next>? LIMIT 1",
            )
            .get(subject, body, now() - 60000)
        : this.store.db
            .prepare(
              "SELECT id,body FROM outbox WHERE subject=? AND status='pending' AND next>? LIMIT 1",
            )
            .get(subject, now() - 60000)
    ) as any;
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
  async lock(id: string, reason: string, options: { notify?: boolean } = {}) {
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
      this.store.interruptions.pause(b, reason);
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
        if (options.notify !== false)
          this.alert(
            `Exam interrupted: ${a.username}`,
            `${a.exam}: ${reason}. Remaining ${formatDuration(((a.deadline || now()) - now()) / 1000)}. Open the authenticated instructor dashboard.`,
          );
      }
      this.store.audit("gateway", "lock", id, reason);
    });
    transaction();
    this.store.audit("gateway", "reauthentication-required", id);
    const generation = this.store.attempt(id).generation;
    const locking = this.agent.call("lock-attempt", { id, reason, generation });
    this.onPaused(this.store.attempt(id));
    await locking
      .then((remote) => {
        if (remote?.generation > this.store.attempt(id).generation) {
          this.store.db
            .prepare("UPDATE attempts SET generation=? WHERE id=?")
            .run(remote.generation, id);
          this.store.interruptions.pause(this.store.attempt(id), reason);
          this.store.db
            .prepare("DELETE FROM continuations WHERE attempt=?")
            .run(id);
        }
      })
      .catch((error) => {
        const disconnected = error instanceof AgentCommandDisconnectedError;
        // Pausing deliberately closes student SSH, including pending command replies.
        // Keep the uncertainty visible without misreporting that as an agent outage.
        this.store.audit(
          "gateway",
          "lock-acknowledgment-pending",
          id,
          JSON.stringify({
            generation,
            cause: disconnected ? "ssh-disconnected" : "command-failed",
          }),
        );
        if (!disconnected)
          this.alert(
            "Exam pause confirmation pending",
            `${a.exam}: ${a.username}, attempt ${id}. Exam access is blocked at the gateway, but the class-server pause command was not confirmed. The local watchdog enforces expired execution leases. Review the authenticated dashboard and class-server status. A missing confirmation does not establish an agent outage.`,
          );
      });
  }
  confirmContinuation(id: string, generation: number) {
    this.store.db.transaction(() => {
      const a = this.store.attempt(id),
        at = now();
      const grant = this.store.db
        .prepare("SELECT * FROM continuations WHERE attempt=?")
        .get(id) as any;
      // Native consumption awaits SSH. A new violation, expiry or completion may
      // have superseded that approval before the reply arrived.
      if (
        a.state !== "LOCKED" ||
        a.generation !== generation ||
        !a.deadline ||
        a.deadline <= at ||
        !grant ||
        grant.generation !== generation ||
        grant.consumed ||
        grant.expires <= at
      )
        throw Error(
          "The pause or authorization changed. Instructor review is required before continuing.",
        );
      this.store.db
        .prepare("UPDATE continuations SET consumed=1 WHERE attempt=?")
        .run(id);
      this.store.transition(id, ["LOCKED"], "ACTIVE");
      this.store.interruptions.resume(a, at);
      this.store.audit(
        a.username,
        "resume-continuation",
        id,
        String(generation),
      );
      this.store.db
        .prepare(
          "UPDATE attempts SET focus_lost_at=NULL,last_contact=? WHERE id=?",
        )
        .run(at, id);
    })();
  }
  async reconcile(id: string) {
    const remote = await this.agent.call("inspect-attempt", { id });
    let manifest;
    if (remote.protected)
      manifest = await this.agent.call("submission-manifest", { id });
    this.acceptRemote(remote, manifest, id);
    return remote;
  }
  // Only authenticated SSH responses or pinned agent signatures reach this method.
  acceptRemote(remote: any, manifest?: any, id = remote.id) {
    const a = this.store.attempt(id);
    if (
      remote.id &&
      (remote.id !== id ||
        remote.exam !== a.exam ||
        remote.username !== a.username ||
        remote.uid !== a.uid)
    )
      throw Error("Agent attempt identity mismatch");
    const currentRevision = a.clock_revision || 0;
    const revision = remote.clock_revision || 0;
    if (!Number.isSafeInteger(revision) || revision < 0)
      throw Error("Invalid clock revision");
    if (revision < currentRevision) return; // A queued pre-reset status cannot end the new interval.
    if (a.start && remote.start) {
      if (a.start !== remote.start)
        throw Error("Original exam interval cannot change");
      const original = a.original_deadline || a.deadline;
      if (!original) throw Error("Original deadline missing");
      if ((remote.original_deadline || remote.deadline) !== original)
        throw Error("Original exam interval cannot change");
      if (revision === currentRevision && a.deadline !== remote.deadline)
        throw Error("Deadline changed without an instructor clock reset");
      if (revision > currentRevision) {
        if (a.protected || a.state === "COMPLETED")
          throw Error("Secured clock cannot change");
        const resets = remote.clock_resets;
        if (!Array.isArray(resets) || resets.length !== revision)
          throw Error("Clock reset history required");
        let deadline = original;
        for (let i = 0; i < resets.length; i++) {
          const reset = resets[i];
          if (
            reset.revision !== i + 1 ||
            reset.previous_deadline !== deadline ||
            typeof reset.actor !== "string" ||
            !reset.actor ||
            !Number.isSafeInteger(reset.applied_at) ||
            reset.applied_at < a.start ||
            !Number.isSafeInteger(reset.requested_at) ||
            reset.requested_at < a.start ||
            reset.requested_at >= reset.previous_deadline ||
            reset.requested_at > reset.applied_at + 1000 ||
            !Number.isSafeInteger(reset.remaining_seconds) ||
            (reset.extend_seconds
              ? !Number.isSafeInteger(reset.extend_seconds) ||
                reset.extend_seconds < 60 ||
                reset.extend_seconds > 21600 ||
                reset.extend_seconds % 60 !== 0 ||
                reset.remaining_seconds !== 0 ||
                reset.deadline !==
                  reset.previous_deadline + reset.extend_seconds * 1000
              : reset.remaining_seconds < 60 ||
                reset.remaining_seconds > 21600 ||
                reset.remaining_seconds % 60 !== 0 ||
                reset.deadline !==
                  reset.requested_at + reset.remaining_seconds * 1000)
          )
            throw Error("Invalid clock reset history");
          deadline = reset.deadline;
        }
        const prior = JSON.parse(a.clock_resets || "[]");
        if (
          !isDeepStrictEqual(resets.slice(0, currentRevision), prior) ||
          deadline !== remote.deadline
        )
          throw Error("Conflicting clock reset history");
        this.store.db
          .prepare(
            "UPDATE attempts SET original_deadline=?,deadline=?,clock_revision=?,clock_resets=? WHERE id=?",
          )
          .run(original, deadline, revision, JSON.stringify(resets), id);
        this.store.audit(
          "class-agent",
          "clock-reset-confirmed",
          id,
          JSON.stringify(resets.slice(currentRevision)),
        );
        for (const reset of resets)
          this.store.db
            .prepare(
              "UPDATE clock_reset_requests SET status='applied' WHERE id=? AND attempt=?",
            )
            .run(reset.id, id);
        if (
          a.state === "FINALIZING" &&
          [
            "expiration",
            "Collection pending: deadline timing verification unavailable",
          ].includes(a.reason || "") &&
          !a.protected &&
          !a.ended &&
          deadline > now()
        ) {
          this.store.db
            .prepare(
              "UPDATE attempts SET state='LOCKED',reason='Clock reset confirmed; reconnect with authorization',generation=MAX(generation,?) WHERE id=?",
            )
            .run(remote.generation || 0, id);
          this.store.db
            .prepare("DELETE FROM continuations WHERE attempt=?")
            .run(id);
        }
        this.onClockChanged(this.store.attempt(id));
      }
    }
    // Command responses may already have advanced state before older queued callbacks arrive.
    if (
      (a.state === "COMPLETED" && remote.state !== "COMPLETED") ||
      (a.start && !remote.start)
    )
      return;
    if (
      !["RELEASED", "OVERRIDDEN"].includes(a.access_state) ||
      ["RELEASED", "OVERRIDDEN"].includes(remote.access_state)
    )
      this.syncAccess(id, remote);
    if (remote.start && a.start === null) {
      this.store.db
        .prepare(
          "UPDATE attempts SET start=?,deadline=?,original_deadline=?,clock_revision=?,clock_resets=?,work_path=? WHERE id=?",
        )
        .run(
          remote.start,
          remote.deadline,
          remote.original_deadline || remote.deadline,
          revision,
          JSON.stringify(remote.clock_resets || []),
          remote.work_path,
          id,
        );
      // A recovered start has consumed time; it is never a fresh preparation.
      if (["ACTIVE", "ACTIVATING"].includes(remote.state)) {
        this.store.db
          .prepare(
            "UPDATE attempts SET state='LOCKED',reason='Activation acknowledgment lost',generation=generation+1 WHERE id=?",
          )
          .run(id);
        this.store.interruptions.pause(
          this.store.attempt(id),
          "Activation acknowledgment lost",
        );
        this.onPaused(this.store.attempt(id));
      }
    }
    if (
      remote.state === "CANCELLED_BEFORE_START" &&
      !remote.start &&
      !a.start
    ) {
      this.store.db
        .prepare(
          "UPDATE attempts SET state='CANCELLED_BEFORE_START',ended=COALESCE(ended,?) WHERE id=?",
        )
        .run(now(), id);
      this.monitoring.delete(id, "unstarted-preparation");
    }
    if (remote.timing_pending_since && !remote.protected) {
      this.store.db
        .prepare(
          "UPDATE attempts SET state='FINALIZING',reason='Collection pending: deadline timing verification unavailable' WHERE id=?",
        )
        .run(id);
      if (
        !this.store.db
          .prepare(
            "SELECT 1 FROM audit WHERE action='timing-pending-alert' AND target=?",
          )
          .get(id)
      ) {
        this.alert(
          "Collection timing requires recovery",
          `Attempt ${id}: work is frozen; collection awaits authenticated timing verification.`,
        );
        this.store.audit("class-agent", "timing-pending-alert", id);
      }
      this.onEnd(this.store.attempt(id));
      return;
    }
    const consumed = this.store.db
      .prepare(
        "SELECT 1 FROM continuations WHERE attempt=? AND generation=? AND consumed=1",
      )
      .get(id, a.generation);
    if (
      remote.state === "LOCKED" &&
      (remote.generation || 0) >= a.generation &&
      !(
        a.state === "ACTIVE" &&
        (remote.generation || 0) === a.generation &&
        consumed
      ) &&
      !["COMPLETED", "FINALIZING", "COLLECTION_FAILED"].includes(a.state)
    ) {
      // A watchdog acknowledgement of the same pause must not hide the initiating
      // browser/gateway failure. Retain both causes in the durable audit trail.
      const detail = JSON.stringify({
        generation: remote.generation || 0,
        reason: remote.reason || "Monitoring authorization expired",
      });
      if (
        !this.store.db
          .prepare(
            "SELECT 1 FROM audit WHERE target=? AND action='agent-lock' AND detail=?",
          )
          .get(id, detail)
      )
        this.store.audit("class-agent", "agent-lock", id, detail);
      const reason =
        a.state === "LOCKED" &&
        (remote.generation || 0) === a.generation &&
        a.reason
          ? a.reason
          : remote.reason ||
            "Monitoring authorization expired; instructor authorization required";
      this.store.db
        .prepare(
          "UPDATE attempts SET state='LOCKED',generation=MAX(generation,?),reason=? WHERE id=?",
        )
        .run(remote.generation || 0, reason, id);
      this.store.interruptions.pause(this.store.attempt(id), reason);
      if (remote.reason && remote.reason !== reason)
        this.store.interruptions.pause(
          this.store.attempt(id),
          `Class server: ${remote.reason}`,
        );
      if ((remote.generation || 0) > a.generation)
        this.store.db
          .prepare("DELETE FROM continuations WHERE attempt=?")
          .run(id);
      if (a.state !== "LOCKED" || (remote.generation || 0) > a.generation)
        this.onPaused(this.store.attempt(id));
    }
    if (
      ["FINALIZING", "COLLECTION_FAILED", "COMPLETED"].includes(remote.state)
    ) {
      if (remote.access_error && !manifest && remote.protected) {
        if (!a.protected)
          this.store.db
            .prepare(
              "UPDATE attempts SET state='COLLECTION_FAILED',reason='Protected artifact verification requires recovery' WHERE id=?",
            )
            .run(id);
        this.onEnd(this.store.attempt(id));
        return;
      }
      if (remote.protected && manifest) {
        const identity = manifest?.attempt;
        if (
          !identity ||
          identity.id !== id ||
          identity.exam !== a.exam ||
          identity.username !== a.username ||
          identity.uid !== a.uid ||
          identity.start !== this.store.attempt(id).start ||
          identity.deadline !== this.store.attempt(id).deadline ||
          (identity.original_deadline || identity.deadline) !==
            (this.store.attempt(id).original_deadline ||
              this.store.attempt(id).deadline) ||
          (identity.clock_revision || 0) !==
            this.store.attempt(id).clock_revision ||
          !/^[a-f0-9]{64}$/.test(remote.checksum || "") ||
          manifest.checksum !== remote.checksum
        )
          throw Error("Protected manifest verification failed");
        if (a.checksum && a.checksum !== remote.checksum)
          throw Error("Secured submission cannot be replaced");
        const legacy = `${this.store.dir}/submissions/${id}.manifest.json`;
        if (
          existsSync(legacy) &&
          manifestSnapshot(JSON.parse(readFileSync(legacy, "utf8"))) !==
            manifestSnapshot(manifest)
        )
          throw Error("Existing collection receipt cannot be replaced");
        this.publish(
          `${this.store.dir}/receipts/${id}.manifest.json`,
          Buffer.from(manifestSnapshot(manifest)),
          (existing) =>
            manifestSnapshot(JSON.parse(existing.toString())) ===
            manifestSnapshot(manifest),
        );
        this.store.db
          .prepare(
            "UPDATE attempts SET protected=1,checksum=?,export_status='server-only',completed_at=?,collected_at=?,secured_at=? WHERE id=?",
          )
          .run(
            remote.checksum,
            remote.completed_at || null,
            manifest.collected || null,
            manifest.secured || null,
            id,
          );

        const cancelled = this.store.db
          .prepare(
            "UPDATE clock_reset_requests SET status='closed' WHERE attempt=? AND status='pending'",
          )
          .run(id);
        if (cancelled.changes) {
          this.store.audit(
            "class-agent",
            "clock-change-not-applied",
            id,
            "Attempt finalized before pending clock change was applied",
          );
          this.alert(
            "Clock change not applied",
            `Attempt ${id} was finalized; pending clock changes cannot reopen it.`,
          );
        }
        this.onSecured(this.store.attempt(id));
        if (hasUnexpectedOmissions(manifest)) {
          const omissions = Array.isArray(manifest.omissions)
            ? manifest.omissions
            : [manifest.omissions];
          this.alert(
            `Submission entries omitted: ${a.username} (${a.exam})`,
            [
              `Student: ${a.username}`,
              `Exam: ${a.exam}`,
              `Attempt: ${id}`,
              "",
              "Omitted entries and reasons:",
              // Quote filenames/reasons so a student-controlled newline cannot
              // impersonate another student or another notification field.
              ...omissions.map(
                (entry: unknown) => `- ${JSON.stringify(entry)}`,
              ),
              "",
              "Review the protected manifest in the authenticated instructor dashboard.",
            ].join("\n"),
            // Keep complete reports for separate attempts rather than truncating a summary.
            { coalesce: false },
          );
        }
      } else if (remote.state === "COMPLETED")
        throw Error("Completion requires verified protected collection");
      if (a.state === "COMPLETED" && remote.state !== "COMPLETED") return;
      this.store.db
        .prepare("UPDATE attempts SET state=?,ended=?,reason=? WHERE id=?")
        .run(remote.state, remote.ended || null, remote.reason || null, id);
      this.store.interruptions.end(this.store.attempt(id));
      if (remote.state === "COLLECTION_FAILED")
        this.alert(
          "Collection requires recovery",
          `Attempt ${id}: ${remote.errors?.join("; ") || "collection failed"}. Account remains blocked.`,
        );
      this.onEnd(this.store.attempt(id));
    }
  }
  syncAccess(id: string, remote: any) {
    const a = this.store.attempt(id);
    const identity = [
      `Student: ${a.username}`,
      `Exam: ${a.exam}`,
      `Attempt: ${id}`,
    ];
    if (
      remote.policy_error &&
      remote.policy_error !== this.store.attempt(id).policy_error
    )
      this.alert(
        "Account policy requires recovery",
        [
          ...identity,
          "",
          "Account policy enforcement or restoration needs attention.",
          `Reason: ${JSON.stringify(remote.policy_error)}`,
        ].join("\n"),
        { coalesce: false },
      );
    this.store.db
      .prepare(
        "UPDATE attempts SET policy_state=?,policy_expires=?,policy_error=? WHERE id=?",
      )
      .run(
        remote.policy_state || null,
        remote.policy_expires || null,
        remote.policy_error || null,
        id,
      );
    if (
      remote.access_error &&
      remote.access_error !== this.store.attempt(id).access_error
    )
      this.alert(
        "Account access release requires recovery",
        [
          ...identity,
          "",
          (remote.protected && remote.state === "COMPLETED") ||
          (a.protected && a.state === "COMPLETED")
            ? "The submission is already secured. Ordinary account access has not yet been restored."
            : "Submission protection or workload termination has not been confirmed. Ordinary account access remains restricted.",
          `Restoration check: ${JSON.stringify(String(remote.access_error).replace("collection refused until all writers are quiesced", "account restoration blocked until all writers are quiesced"))}`,
          "The class server retries restoration; inspect its status if this persists.",
        ].join("\n"),
        { coalesce: false },
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
    let stage = "cancel-attempt";
    const confirmed = () => {
      if (this.store.attempt(id).state !== "CANCELLED_BEFORE_START")
        return false;
      this.store.db
        .prepare("UPDATE attempts SET reason=? WHERE id=?")
        .run(reason, id);
      this.store.audit("gateway", "cancel-preflight", id, reason);
      return true;
    };
    try {
      await this.agent.call("cancel-attempt", { id });
      stage = "confirm-cancellation";
      await this.reconcile(id);
      if (!confirmed())
        throw Error(
          "Preflight cancellation was not confirmed by the class server",
        );
    } catch (error) {
      // The cancellation reply may be lost even after the root agent committed it.
      // Never retry a preparation whose activation actually committed remotely.
      await this.reconcile(id).catch(() => {});
      const diagnostic = cleanupDiagnostic(error);
      const current = this.store.attempt(id);
      const outcome = confirmed()
        ? "cancellation-confirmed"
        : current.start !== null
          ? "attempt-started"
          : "cleanup-pending";
      const detail = { stage, ...diagnostic, outcome };
      const prior = this.store.db
        .prepare(
          "SELECT action,detail FROM audit WHERE target=? AND action IN ('preflight-cleanup-failed','cancel-preflight') ORDER BY rowid DESC LIMIT 1",
        )
        .get(id) as { action: string; detail: string } | undefined;
      const signature = JSON.stringify(detail);
      if (
        prior?.action !== "preflight-cleanup-failed" ||
        prior.detail !== signature
      ) {
        this.store.audit("gateway", "preflight-cleanup-failed", id, signature);
        this.onPreflightFailure({
          attempt: id,
          username: a.username,
          exam: a.exam,
          ...detail,
        });
        if (outcome === "cleanup-pending")
          this.alert(
            `Preflight cleanup pending: ${a.username} (${a.exam})`,
            [
              `Student: ${a.username}`,
              `Exam: ${a.exam}`,
              `Attempt: ${id}`,
              "",
              "Cancellation of this unstarted preflight could not be confirmed.",
              `Stage: ${stage}`,
              `Reason: ${diagnostic.reason}`,
              `Cause: ${diagnostic.cause}`,
              diagnostic.cause === "ssh-disconnected"
                ? "The student's SSH command connection is unavailable. This does not establish a class-agent outage."
                : "The cancellation command or confirmation failed; this does not establish a class-agent outage.",
              "Cleanup will be retried when an authenticated student SSH connection is available. Check the class-server status before resetting this preparation.",
            ].join("\n"),
            { coalesce: false },
          );
      }
      if (outcome !== "cancellation-confirmed") throw error;
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
      remote.start ||
      remote.deadline ||
      remote.original_deadline
    ) {
      await this.reconcile(id);
      throw Error(
        "The previous preparation cannot be retried until its start status is confirmed.",
      );
    }
    if (remote.account_policy_required && remote.policy_state !== "NORMAL") {
      await this.reconcile(id);
      this.store.audit(
        "gateway",
        "preflight-retry-blocked",
        id,
        `Account restoration: ${remote.policy_state || "unconfirmed"}`,
      );
      throw Error(
        "The previous preparation was cancelled, but account access restoration is not yet confirmed. Retry shortly; contact your instructor if this continues.",
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
      this.store.db
        .prepare(
          "SELECT 1 FROM clock_reset_requests WHERE attempt=? AND status='pending'",
        )
        .get(id)
    )
      throw Error(
        "Clock reset is awaiting agent confirmation; try finishing again shortly",
      );
    const a = this.store.attempt(id);
    if (!a.start || a.state === "CANCELLED_BEFORE_START")
      throw Error(
        "The exam has not started; there is no submission to collect.",
      );
    if (["COMPLETED", "FINALIZING", "COLLECTION_FAILED"].includes(a.state))
      return;
    if (a.state !== "ACTIVE" || this.agent.connected?.(a.username) === false)
      throw Error(
        "Finish requires an active SSH connection. Saved files will still be collected at the original deadline.",
      );
    if (this.busy.has(id)) return;
    this.busy.add(id);
    this.store.db
      .prepare("UPDATE attempts SET state='FINALIZING',reason=? WHERE id=?")
      .run(reason, id);
    this.onEnd(this.store.attempt(id));
    try {
      const remote = await this.agent.call("finalize-attempt", { id, reason });
      const manifest = remote.protected
        ? await this.agent.call("submission-manifest", { id })
        : undefined;
      this.acceptRemote(remote, manifest, id);
    } catch {
      if (this.store.attempt(id).protected) return;
      // A lost acknowledgment is pending, not proof that collection failed. The local
      // watchdog and durable callback recover it even when this SSH connection ends.
      this.alert(
        "Collection acknowledgment pending",
        `Attempt ${id}: awaiting class-server status. The original deadline remains enforced locally.`,
      );
    } finally {
      this.busy.delete(id);
    }
  }
  receiveArchive(_id: string, _checksum: string, _bytes: Buffer): never {
    throw Error(
      "Submissions are retained on the SSH server; archive transfers are disabled",
    );
  }
  private publish(
    file: string,
    bytes: Buffer,
    equivalent: (existing: Buffer) => boolean = (existing) =>
      hash(existing) === hash(bytes),
  ) {
    const syncDirectory = () => {
      const directory = openSync(path.dirname(file), "r");
      try {
        fsyncSync(directory);
      } finally {
        closeSync(directory);
      }
    };
    const verifyExisting = () => {
      if (!equivalent(readFileSync(file)))
        throw Error("Existing submission artifact cannot be replaced");
      syncDirectory();
    };
    if (existsSync(file)) {
      verifyExisting();
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
      try {
        linkSync(temporary, file);
        syncDirectory();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        verifyExisting();
      }
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
    }
  }
  async tick() {
    const rows = this.store.db
      .prepare("SELECT * FROM attempts WHERE state IN ('ACTIVE','LOCKED')")
      .all() as Attempt[];
    for (const a of rows) {
      if (a.deadline && now() >= a.deadline) {
        this.store.db
          .prepare(
            "UPDATE attempts SET state='FINALIZING',reason='expiration' WHERE id=?",
          )
          .run(a.id);
        this.onEnd(this.store.attempt(a.id));
      } else if (
        a.state === "ACTIVE" &&
        a.focus_lost_at !== null &&
        now() - a.focus_lost_at >= FOCUS_GRACE_MS
      )
        await this.lock(a.id, FOCUS_GRACE_REASON);
      else if (a.state === "ACTIVE" && now() - (a.last_contact || 0) > 15000)
        await this.lock(a.id, "Client contact exceeded 15 seconds");
    }
    // There is no disconnected command polling. The agent reports authoritative results.
  }
}
