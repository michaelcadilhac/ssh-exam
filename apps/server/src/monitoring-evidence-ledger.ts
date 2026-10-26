import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { monitoringBootTimeMS } from "./monitoring-clock.js";
import { FOCUS_GRACE_MS } from "../../../packages/protocol/focus-grace.js";
import {
  isCaptureReadinessSnapshot,
  type CaptureReadinessSnapshot,
} from "./monitoring-readiness.js";
import {
  MONITORING_CHALLENGE_WINDOW_MS,
  MONITORING_EVIDENCE_WINDOW_MS,
  monitoringOwner,
  monitoringEvidence,
  nativeMonitoringChallenge,
  type MonitoringOwner,
  type MonitoringEvidence,
} from "../../../packages/protocol/monitoring-evidence.js";

// Runtime Monitoring supplies authenticated current-page capture challenges and
// validated JPEG/policy observations; the native authenticated evidence route
// signs scoped replies. A signed observation is not native work permission.
// Supervisor authority/input/freeze consumption is a separate required boundary.
const bindingBrand = Symbol("monitoring-evidence-binding");
export type MonitoringEvidenceBinding = Readonly<{ [bindingBrand]: true }>;
type Purpose = "policy" | "screen" | "webcam";
type Challenge = { issued: number; ordinal: number; purpose: Purpose };
type AcceptanceAnchor = {
  owner: Readonly<MonitoringOwner>;
  nonce: string;
  sequence: number;
  coverage: string;
};
const readiness = z
  .object({
    fullscreen: z.boolean(),
    visible: z.boolean(),
    keyboard: z.boolean(),
    screen: z.boolean(),
    webcam: z.boolean(),
    focus: z.boolean(),
  })
  .strict();
type Entry = {
  binding: MonitoringEvidenceBinding;
  owner: Readonly<MonitoringOwner>;
  webcam: boolean;
  challenges: Map<string, Challenge>;
  challengeOrdinal: number;
  policy?: { issued: number; ordinal: number };
  focusLost?: number;
  focusUnverified: boolean;
  blocked: boolean;
  frames: Map<
    "screen" | "webcam",
    { sequence: number; ordinal: number; issued: number }
  >;
  sequence: number;
  nativeEstablished: boolean;
  bootstrapEstablished: boolean;
  technicalAnchor?: AcceptanceAnchor;
  clockAnchors: Map<string, AcceptanceAnchor>;
  restartAligned: boolean;
  coverageEpoch?: string;
  coverageUntil?: number;
  gaps: number;
  receipts: Map<
    string,
    { request: string; at: number; proof: Readonly<MonitoringEvidence> }
  >;
};
export class MonitoringEvidenceUnavailable extends Error {
  readonly statusCode = 409;
  constructor(
    readonly kind:
      | "ownership"
      | "capacity"
      | "challenge"
      | "technical-gap"
      | "policy-blocked"
      | "conflict"
      | "sequence"
      | "clock",
  ) {
    super(
      `Monitoring evidence ${kind}; no native permission or recovery was granted`,
    );
    this.name = "MonitoringEvidenceUnavailable";
  }
}
const refuse = (kind: MonitoringEvidenceUnavailable["kind"]): never => {
  throw new MonitoringEvidenceUnavailable(kind);
};
const counter = (n: unknown): n is number =>
  Number.isSafeInteger(n) && Number(n) > 0;

export class MonitoringEvidenceLedger {
  private entries = new Map<string, Entry>();
  private bindings = new WeakMap<MonitoringEvidenceBinding, Entry>();
  private lastClock = 0;
  constructor(
    private agent: string,
    private clock: () => number = monitoringBootTimeMS,
    private limit = 32,
  ) {
    if (
      !/^[a-zA-Z0-9_-]{1,64}$/.test(agent) ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 512
    )
      refuse("capacity");
  }
  private now() {
    let now: number;
    try {
      now = this.clock();
    } catch {
      return refuse("clock");
    }
    if (
      !Number.isFinite(now) ||
      now < this.lastClock ||
      now > Number.MAX_SAFE_INTEGER - FOCUS_GRACE_MS
    )
      refuse("clock");
    this.lastClock = now;
    return now;
  }
  private entry(binding: MonitoringEvidenceBinding) {
    const e = this.bindings.get(binding);
    if (!e || this.entries.get(e.owner.attempt) !== e)
      return refuse("ownership");
    return e;
  }
  // Register only a verified CURRENT native ACTIVE owner, never a browser's body.
  // Exact retry preserves evidence; replacement requires explicit retirement.
  registerTrustedOwner(
    raw: unknown,
    webcam: boolean,
  ): MonitoringEvidenceBinding {
    const parsed = monitoringOwner.safeParse(raw);
    if (!parsed.success || typeof webcam !== "boolean")
      return refuse("ownership");
    this.now();
    const old = this.entries.get(parsed.data.attempt);
    if (old) {
      if (
        JSON.stringify(old.owner) !== JSON.stringify(parsed.data) ||
        old.webcam !== webcam
      )
        return refuse("conflict");
      return old.binding;
    }
    if (this.entries.size >= this.limit) return refuse("capacity");
    const binding: MonitoringEvidenceBinding = Object.freeze({
      [bindingBrand]: true as const,
    });
    const e: Entry = {
      binding,
      owner: Object.freeze(parsed.data),
      webcam,
      challenges: new Map(),
      challengeOrdinal: 0,
      blocked: false,
      focusUnverified: false,
      frames: new Map(),
      sequence: 0,
      nativeEstablished: false,
      bootstrapEstablished: false,
      clockAnchors: new Map(),
      restartAligned: false,
      gaps: 0,
      receipts: new Map(),
    };
    this.entries.set(e.owner.attempt, e);
    this.bindings.set(binding, e);
    return binding;
  }
  // Called only for an accepted native clock outcome with otherwise identical
  // page/student/SSH/generation/settings. Preserve every original challenge
  // time, fact, coverage cutoff and sequence; a clock edit is not a capture.
  transferTrustedClock(binding: MonitoringEvidenceBinding, raw: unknown) {
    const e = this.entry(binding),
      parsed = monitoringOwner.safeParse(raw);
    this.touch(e, this.now());
    if (
      !parsed.success ||
      parsed.data.clock_revision !== e.owner.clock_revision + 1 ||
      JSON.stringify({
        ...parsed.data,
        clock_revision: e.owner.clock_revision,
      }) !== JSON.stringify(e.owner)
    )
      return refuse("ownership");
    e.owner = Object.freeze(parsed.data);
    // Preserve only historical acceptance identity for C9, never an old
    // challenge/reply in the new clock scope. Original signed receipts stay
    // immutable, and no observation time/cutoff/sequence is refreshed.
    for (const [nonce, receipt] of e.receipts) {
      e.clockAnchors.set(nonce, {
        owner: receipt.proof.owner,
        nonce,
        sequence: receipt.proof.sequence,
        coverage: receipt.proof.coverage_epoch,
      });
    }
    while (e.clockAnchors.size > 32)
      e.clockAnchors.delete(e.clockAnchors.keys().next().value!);
    e.receipts.clear(); // An old native challenge cannot acquire the new scope.
    return binding;
  }
  // Only after actual signed native ACTIVE ownership has been accepted. Preserve
  // original server challenge times; promotion cannot mint another15 seconds.
  seedValidatedBegin(
    binding: MonitoringEvidenceBinding,
    snapshot: CaptureReadinessSnapshot,
    coverage: string,
  ) {
    const e = this.entry(binding),
      now = this.now();
    if (
      !isCaptureReadinessSnapshot(snapshot) ||
      e.sequence !== 0 ||
      e.policy ||
      e.frames.size ||
      !/^[a-f0-9]{64}$/.test(coverage) ||
      snapshot.attempt !== e.owner.attempt ||
      snapshot.page !== e.owner.page_epoch ||
      snapshot.generation !== e.owner.generation ||
      snapshot.webcam !== e.webcam
    )
      return refuse("ownership");
    if (
      !readiness.safeParse(snapshot.policy.value).success ||
      !snapshot.policy.value.fullscreen ||
      !snapshot.policy.value.visible ||
      !snapshot.policy.value.focus ||
      !snapshot.policy.value.keyboard ||
      !snapshot.policy.value.screen ||
      (e.webcam && !snapshot.policy.value.webcam)
    )
      return refuse("policy-blocked");
    const required = e.webcam ? ["screen", "webcam"] : ["screen"],
      oldest = Math.min(
        snapshot.policy.issued,
        ...snapshot.frames.map((f) => f.issued),
      );
    if (
      snapshot.frames.length !== required.length ||
      new Set(snapshot.frames.map((f) => f.source)).size !== required.length ||
      snapshot.frames.some(
        (f) => !required.includes(f.source) || !counter(f.sequence),
      ) ||
      now < oldest ||
      now - oldest >= MONITORING_EVIDENCE_WINDOW_MS
    )
      return refuse("technical-gap");
    e.policy = {
      issued: snapshot.policy.issued,
      ordinal: snapshot.policy.ordinal,
    };
    e.challengeOrdinal = snapshot.policy.ordinal;
    for (const fact of snapshot.frames) {
      e.frames.set(fact.source, {
        issued: fact.issued,
        ordinal: fact.ordinal,
        sequence: fact.sequence,
      });
      e.challengeOrdinal = Math.max(e.challengeOrdinal, fact.ordinal);
    }
    e.sequence = 1;
    e.nativeEstablished = true;
    e.bootstrapEstablished = true;
    e.coverageEpoch = coverage;
    e.coverageUntil = oldest + MONITORING_EVIDENCE_WINDOW_MS;
  }
  // Called only for a known signed C9 proposal followed by native ownership
  // observation. This moves identity, not permission or sample freshness.
  transferTechnicalOwner(
    binding: MonitoringEvidenceBinding,
    raw: unknown,
    anchor: { nonce: string; sequence: number; coverage: string },
  ) {
    const e = this.entry(binding),
      next = monitoringOwner.parse(raw);
    this.touch(e, this.now());
    const sameOwner = JSON.stringify(next) === JSON.stringify(e.owner);
    if (
      (!sameOwner &&
        (next.generation <= e.owner.generation ||
          next.input_epoch === e.owner.input_epoch)) ||
      next.clock_revision < e.owner.clock_revision ||
      JSON.stringify({
        ...next,
        generation: e.owner.generation,
        input_epoch: e.owner.input_epoch,
        clock_revision: e.owner.clock_revision,
      }) !== JSON.stringify(e.owner) ||
      !/^[a-f0-9]{64}$/.test(anchor.nonce) ||
      !counter(anchor.sequence) ||
      !/^[a-f0-9]{64}$/.test(anchor.coverage)
    )
      return refuse("ownership");
    e.owner = Object.freeze(next);
    if (!sameOwner) {
      e.receipts.clear();
      e.clockAnchors.clear();
      e.bootstrapEstablished = false;
    }
    e.technicalAnchor = { owner: e.owner, ...anchor };
    return binding;
  }
  technicalSnapshot(
    binding: MonitoringEvidenceBinding,
    witness: {
      owner: MonitoringOwner;
      coverage_epoch: string;
      after_sequence: number;
      last_accepted_nonce: string;
    },
  ) {
    const e = this.entry(binding),
      now = this.now();
    this.touch(e, now);
    if (JSON.stringify(witness.owner) !== JSON.stringify(e.owner))
      return refuse("ownership");
    if (e.blocked) return refuse("policy-blocked");
    if (e.focusLost !== undefined && !e.focusUnverified)
      return refuse("challenge"); // Preserve the existing focus grace; wait, never invent a violation.
    if (
      e.focusUnverified ||
      e.gaps !== 0 ||
      !e.coverageUntil ||
      e.coverageEpoch !== witness.coverage_epoch ||
      e.coverageUntil <= now ||
      e.sequence < witness.after_sequence
    )
      return refuse("technical-gap");
    const nonce = witness.last_accepted_nonce;
    if (!nonce) {
      if (!e.bootstrapEstablished || witness.after_sequence !== 1)
        return refuse("technical-gap");
    } else {
      const receipt = e.receipts.get(nonce)?.proof;
      const candidate = receipt
        ? {
            nonce,
            owner: receipt.owner,
            sequence: receipt.sequence,
            coverage: receipt.coverage_epoch,
          }
        : e.technicalAnchor?.nonce === nonce
          ? e.technicalAnchor
          : e.clockAnchors.get(nonce);
      if (
        !candidate ||
        candidate.sequence !== witness.after_sequence ||
        candidate.coverage !== e.coverageEpoch ||
        candidate.owner.clock_revision > e.owner.clock_revision ||
        JSON.stringify({
          ...candidate.owner,
          clock_revision: e.owner.clock_revision,
        }) !== JSON.stringify(e.owner)
      )
        return refuse("technical-gap");
      e.technicalAnchor = { ...candidate, owner: e.owner }; // Pin the acknowledged history, not an expired permit.
    }
    return Object.freeze({
      coverageEpoch: e.coverageEpoch,
      sequence: e.sequence,
      remainingMS: Math.floor(e.coverageUntil - now),
    });
  }
  retire(binding: MonitoringEvidenceBinding) {
    const e = this.entry(binding);
    this.entries.delete(e.owner.attempt);
  }
  private gap(e: Entry) {
    if (e.coverageEpoch) e.gaps++;
    e.coverageEpoch = undefined;
    e.coverageUntil = undefined;
  }
  private componentUntil(e: Entry) {
    const required = e.webcam
      ? (["screen", "webcam"] as const)
      : (["screen"] as const);
    if (!e.policy || required.some((source) => !e.frames.has(source)))
      return -1;
    return Math.min(
      e.policy.issued + MONITORING_EVIDENCE_WINDOW_MS,
      ...required.map(
        (source) =>
          e.frames.get(source)!.issued + MONITORING_EVIDENCE_WINDOW_MS,
      ),
    );
  }
  private touch(e: Entry, now: number) {
    if (e.focusLost !== undefined) {
      const observedUntil = this.componentUntil(e);
      // An expired observation cannot prove continuous blur through an earlier
      // unknown interval. Keep work blocked, not a fabricated policy violation.
      if (observedUntil <= e.focusLost + FOCUS_GRACE_MS && now >= observedUntil)
        e.focusUnverified = true;
      if (!e.focusUnverified && now - e.focusLost >= FOCUS_GRACE_MS)
        e.blocked = true;
    }
    if (
      e.blocked ||
      e.focusUnverified ||
      (e.coverageUntil !== undefined && now >= e.coverageUntil)
    )
      this.gap(e);
  }
  issueBrowserChallenge(binding: MonitoringEvidenceBinding, purpose: Purpose) {
    const e = this.entry(binding),
      now = this.now();
    this.touch(e, now);
    if (
      !["policy", "screen", "webcam"].includes(purpose) ||
      (purpose === "webcam" && !e.webcam)
    )
      return refuse("challenge");
    if (e.blocked) return refuse("policy-blocked");
    for (const [id, c] of e.challenges)
      if (now - c.issued >= MONITORING_EVIDENCE_WINDOW_MS)
        e.challenges.delete(id);
    if (e.challengeOrdinal >= Number.MAX_SAFE_INTEGER)
      return refuse("sequence");
    const id = randomUUID();
    e.challenges.set(id, {
      issued: now,
      ordinal: ++e.challengeOrdinal,
      purpose,
    });
    if (e.challenges.size > 16)
      e.challenges.delete(e.challenges.keys().next().value!);
    return id;
  }
  private take(e: Entry, id: string, purpose: Purpose, now: number) {
    const c = e.challenges.get(id);
    if (!c || c.purpose !== purpose) return refuse("challenge");
    e.challenges.delete(id);
    if (now - c.issued >= MONITORING_EVIDENCE_WINDOW_MS)
      return refuse("challenge");
    return c;
  }
  private recompute(e: Entry, now: number) {
    if (e.blocked || e.focusUnverified) {
      this.gap(e);
      return;
    }
    const required = e.webcam
      ? (["screen", "webcam"] as const)
      : (["screen"] as const);
    if (!e.policy || required.some((s) => !e.frames.has(s))) {
      this.gap(e);
      return;
    }
    const until = Math.min(
      e.policy.issued + MONITORING_EVIDENCE_WINDOW_MS,
      ...required.map(
        (s) => e.frames.get(s)!.issued + MONITORING_EVIDENCE_WINDOW_MS,
      ),
      e.focusLost === undefined ? Infinity : e.focusLost + FOCUS_GRACE_MS,
    );
    if (until <= now) {
      this.gap(e);
      return;
    }
    if (e.sequence >= Number.MAX_SAFE_INTEGER) return refuse("sequence");
    e.sequence++;
    // A new positive observation after unknown coverage gets a NEW identity.
    // It must never retroactively repair the old continuous-coverage interval.
    e.coverageEpoch ??= randomBytes(32).toString("hex");
    e.coverageUntil = until;
  }
  confirmPolicy(
    binding: MonitoringEvidenceBinding,
    challenge: string,
    raw: unknown,
  ) {
    const e = this.entry(binding),
      now = this.now();
    this.touch(e, now);
    if (e.blocked) return refuse("policy-blocked");
    const c = this.take(e, challenge, "policy", now),
      parsed = readiness.safeParse(raw);
    if (!parsed.success || (e.policy && c.ordinal <= e.policy.ordinal))
      return refuse("challenge");
    const r = parsed.data;
    if (
      !r.fullscreen ||
      !r.visible ||
      !r.keyboard ||
      !r.screen ||
      (e.webcam && !r.webcam)
    ) {
      e.blocked = true;
      this.gap(e);
      return;
    }
    if (!r.focus) e.focusLost ??= now;
    else {
      e.focusLost = undefined;
      e.focusUnverified = false;
    }
    e.policy = { issued: c.issued, ordinal: c.ordinal };
    this.recompute(e, now);
  }
  // Only AFTER validated JPEG + current page/source/challenge association. The
  // server challenge's issue time bounds freshness; receipt cannot freshen it.
  confirmValidatedFrame(
    binding: MonitoringEvidenceBinding,
    challenge: string,
    source: "screen" | "webcam",
    sequence: number,
  ) {
    const e = this.entry(binding),
      now = this.now();
    this.touch(e, now);
    if (e.blocked) return refuse("policy-blocked");
    if (
      !["screen", "webcam"].includes(source) ||
      (source === "webcam" && !e.webcam)
    )
      return refuse("challenge");
    const c = this.take(e, challenge, source, now),
      old = e.frames.get(source);
    if (
      !counter(sequence) ||
      (old && (sequence <= old.sequence || c.ordinal <= old.ordinal))
    )
      return refuse("sequence");
    e.frames.set(source, { issued: c.issued, ordinal: c.ordinal, sequence });
    this.recompute(e, now);
  }
  // Runtime authenticated capture path: one challenge precedes both the JPEG
  // and its policy snapshot. Call only AFTER decoding and current-page checks.
  // Older positive policy cannot replace a newer observation; any genuine
  // fullscreen/capture/keyboard loss remains sticky even when delivered late.
  confirmValidatedCapture(
    binding: MonitoringEvidenceBinding,
    challenge: string,
    source: "screen" | "webcam",
    sequence: number,
    raw: unknown,
  ) {
    const e = this.entry(binding),
      now = this.now(),
      parsed = readiness.safeParse(raw);
    this.touch(e, now);
    if (e.blocked) return refuse("policy-blocked");
    if (!parsed.success || !counter(sequence)) return refuse("challenge");
    if (
      !["screen", "webcam"].includes(source) ||
      (source === "webcam" && !e.webcam)
    )
      return refuse("challenge");
    const c = this.take(e, challenge, source, now),
      old = e.frames.get(source),
      r = parsed.data;
    if (old && (sequence <= old.sequence || c.ordinal <= old.ordinal))
      return refuse("sequence");
    if (
      !r.fullscreen ||
      !r.visible ||
      !r.keyboard ||
      !r.screen ||
      (e.webcam && !r.webcam)
    ) {
      e.blocked = true;
      this.gap(e);
      return;
    }
    e.frames.set(source, { issued: c.issued, ordinal: c.ordinal, sequence });
    if (!e.policy || c.ordinal > e.policy.ordinal) {
      if (!r.focus) e.focusLost ??= now;
      else {
        e.focusLost = undefined;
        e.focusUnverified = false;
      }
      e.policy = { issued: c.issued, ordinal: c.ordinal };
    }
    this.recompute(e, now);
  }
  issueForNativeChallenge(
    binding: MonitoringEvidenceBinding,
    raw: unknown,
  ): Readonly<MonitoringEvidence> {
    const e = this.entry(binding),
      now = this.now();
    this.touch(e, now);
    if (e.blocked) return refuse("policy-blocked");
    const parsed = nativeMonitoringChallenge.safeParse(raw);
    if (!parsed.success) return refuse("challenge");
    const r = parsed.data;
    if (
      r.agent !== this.agent ||
      JSON.stringify(r.owner) !== JSON.stringify(e.owner)
    )
      return refuse("ownership");
    if (e.coverageUntil === undefined || !e.coverageEpoch)
      return refuse("technical-gap");
    const request = JSON.stringify(r),
      old = e.receipts.get(r.nonce);
    if (old) {
      if (old.request !== request) return refuse("conflict");
      if (old.proof.coverage_epoch !== e.coverageEpoch)
        return refuse("technical-gap");
      if (now - old.at >= MONITORING_CHALLENGE_WINDOW_MS)
        return refuse("challenge");
      return old.proof; // Original age/sequence; never a refreshed retry.
    }
    // Retain the last bounded identities across a proof-path outage so C9 can
    // match the native last-accepted nonce. Retry age is still checked above;
    // retaining an expired receipt never refreshes or authorizes it.
    if (e.receipts.size >= 32) {
      const oldest = e.receipts.entries().next().value!;
      if (now - oldest[1].at < MONITORING_CHALLENGE_WINDOW_MS)
        return refuse("capacity");
      e.receipts.delete(oldest[0]);
    }
    let sequence = e.sequence,
      coverage = e.coverageEpoch,
      aligned = e.restartAligned;
    if (
      r.policy_reports === "v1" &&
      r.coverage_epoch !== "" &&
      e.gaps === 0 &&
      e.focusLost === undefined &&
      (!e.nativeEstablished ||
        (e.restartAligned &&
          r.coverage_epoch === coverage &&
          r.after_sequence > sequence))
    ) {
      // The authenticated native challenge carries a cohort verified by signed
      // Begin/Continue. This EMPTY-incarnation stream has only newly challenged
      // complete facts, no negative or observed gap. Translate its counter into
      // the still-live native namespace; neither facts nor cutoff get refreshed.
      // A later native watermark greater than EVERY sequence issued here came
      // from the previous gateway (e.g. a late accepted reply), not a new sample.
      if (r.after_sequence >= Number.MAX_SAFE_INTEGER)
        return refuse("sequence");
      sequence = Math.max(sequence, r.after_sequence + 1);
      coverage = r.coverage_epoch;
      aligned = true;
    }
    if (r.coverage_epoch !== "" && r.coverage_epoch !== coverage)
      return refuse("technical-gap");
    if (sequence <= r.after_sequence) return refuse("sequence");
    const proof = monitoringEvidence.parse({
      type: "monitoring-execution-evidence-v1",
      audience: this.agent,
      nonce: r.nonce,
      owner: e.owner,
      coverage_epoch: coverage,
      sequence,
      age_ms: MONITORING_EVIDENCE_WINDOW_MS - Math.floor(e.coverageUntil - now),
      complete: true,
    });
    Object.freeze(proof.owner);
    Object.freeze(proof);
    e.sequence = sequence;
    e.coverageEpoch = coverage;
    e.nativeEstablished = true;
    e.restartAligned = aligned;
    e.receipts.set(r.nonce, { request, at: now, proof });
    return proof;
  }
  inspect(binding: MonitoringEvidenceBinding) {
    const e = this.entry(binding),
      now = this.now();
    this.touch(e, now);
    return Object.freeze({
      state: e.blocked
        ? "policy-blocked"
        : e.coverageUntil === undefined
          ? "technical-gap"
          : "fresh",
      sequence: e.sequence,
      gaps: e.gaps,
      coverageEpoch: e.coverageEpoch ?? null,
      remainingMS:
        e.coverageUntil === undefined ? 0 : Math.floor(e.coverageUntil - now),
      pendingChallenges: [...e.challenges.values()].filter(
        (c) => now - c.issued < MONITORING_EVIDENCE_WINDOW_MS,
      ).length,
      retainedNativeReceipts: e.receipts.size,
    });
  }
}
