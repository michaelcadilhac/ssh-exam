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
        ? "Continuation approved. SSH is disconnected: reconnect first, then restore monitoring and choose Continue. The clock continues."
        : "Continuation approved. Restore any missing conditions below, then choose Continue. Reconnect SSH only if it is actually disconnected; approval alone does not enable input.";
    case "expired":
      return "Your continuation approval has expired. Request a new instructor review before continuing; no time is added.";
    case "revoked":
      return "Your earlier approval is no longer valid. Request a new review for the current interruption.";
    case "superseded":
      return "An earlier approval does not cover this interruption. Request a new instructor review.";
    case "used":
      return "Your earlier approval has already been used. This interruption needs a new instructor review.";
    case "unknown":
      return "Checking the current approval. Keep this page open; if this persists, ask your instructor to inspect the current interruption.";
    case "resumed":
      return "Exam resumed. The clock continues.";
    case "not-paused":
      return "Checking the current attempt state; this message does not enable input.";
    case "unavailable":
      return "This attempt cannot continue in its current state. Check the current exam status with your instructor; approval cannot reopen ended work or add time.";
    default:
      return "Waiting for instructor approval. You can request review below; your exam clock continues.";
  }
}
