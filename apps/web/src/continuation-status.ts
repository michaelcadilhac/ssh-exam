import {
  continuationStatus,
  type ContinuationStatus,
} from "../../../packages/protocol/continuation-status.js";

type Scope = { id: string; generation: number; continuation_revision?: number };
export type ContinuationView = {
  state: ContinuationStatus["state"];
  expires: number | null;
};

// Presentation only. No method binds a page, opens SSH, changes an attempt,
// requests approval/Continue or arms input. Counters fence delayed status replies.
export class ContinuationStatusTracker {
  private scope?: { id: string; generation: number; revision: number };
  private cached?: Readonly<ContinuationStatus>;
  private presentationClock = 0;
  observeAttempt(a: Scope) {
    const revision = a.continuation_revision ?? 0;
    if (
      !Number.isSafeInteger(a.generation) ||
      a.generation < 0 ||
      !Number.isSafeInteger(revision) ||
      revision < 0
    )
      return;
    if (
      !this.scope ||
      a.id !== this.scope.id ||
      a.generation > this.scope.generation
    )
      this.scope = { id: a.id, generation: a.generation, revision };
    else if (a.generation === this.scope.generation)
      this.scope.revision = Math.max(this.scope.revision, revision);
  }
  accept(raw: unknown, a: Scope, serverNow: number): boolean {
    const parsed = continuationStatus.safeParse(raw);
    if (!parsed.success) return false;
    const s = parsed.data,
      scope = this.scope;
    if (
      !scope ||
      s.attempt !== a.id ||
      s.attempt !== scope.id ||
      s.generation !== a.generation ||
      s.generation !== scope.generation ||
      s.revision < scope.revision ||
      s.observedAt !== serverNow
    )
      return false;
    const old = this.cached;
    if (
      old &&
      old.attempt === s.attempt &&
      old.generation === s.generation &&
      (s.revision < old.revision ||
        (s.revision === old.revision && s.observedAt < old.observedAt))
    )
      return false;
    scope.revision = s.revision;
    this.presentationClock =
      old &&
      old.attempt === s.attempt &&
      old.generation === s.generation &&
      old.revision === s.revision
        ? Math.max(this.presentationClock, s.observedAt)
        : s.observedAt;
    this.cached = Object.freeze(s);
    return true;
  }
  view(a: Scope, serverClock: number): ContinuationView {
    const old = this.cached,
      scope = this.scope;
    if (!scope || scope.id !== a.id || scope.generation !== a.generation)
      return { state: "unknown", expires: null };
    if (!old || old.attempt !== a.id)
      return { state: "waiting", expires: null };
    if (old.generation !== a.generation)
      return { state: "superseded", expires: null };
    if (old.revision < scope.revision || !Number.isFinite(serverClock))
      return { state: "unknown", expires: null };
    this.presentationClock = Math.max(
      this.presentationClock,
      serverClock,
      old.observedAt,
    );
    return {
      state:
        old.state === "approved" && old.expires! <= this.presentationClock
          ? "expired"
          : old.state,
      expires: old.expires,
    };
  }
}

export function continuationNotice(
  view: ContinuationView,
  authenticationGap: boolean,
): string {
  switch (view.state) {
    case "approved":
      return authenticationGap
        ? "Resume approved. Sign in again, restore the checks, then choose Resume exam. The clock keeps running."
        : "Resume approved. Restore any missing checks, then choose Resume exam.";
    case "completing":
      return "Resume approved. Keep this page open and choose Resume exam to finish reconnecting. Input stays paused until it succeeds.";
    case "expired":
      return "Approval expired. Ask your instructor to approve resuming again. No time is added.";
    case "revoked":
      return "Approval was cancelled. Ask your instructor to review this interruption.";
    case "superseded":
      return "This interruption needs a new instructor approval.";
    case "used":
      return "The earlier approval was used. This interruption needs a new instructor approval.";
    case "unknown":
      return "Checking approval… Keep this page open. Ask your instructor if this continues.";
    case "resumed":
      return "Exam resumed. The clock keeps running.";
    case "not-paused":
      return "Checking exam status… Input remains paused.";
    case "unavailable":
      return "This attempt cannot resume. Ask your instructor to check its status. Approval cannot reopen it or add time.";
    default:
      return "Waiting for instructor approval. The clock keeps running.";
  }
}
