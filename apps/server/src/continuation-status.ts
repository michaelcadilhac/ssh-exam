import type { Attempt, Store } from "./db.js";
import {
  continuationStatus,
  type ContinuationStatus,
} from "../../../packages/protocol/continuation-status.js";

type Grant = { generation: number; expires: number; consumed: number };

// Read-only, bounded, metadata-only student presentation. Authorization/Continue
// still uses the existing native/gateway checks. Never return actors/messages.
export function studentContinuationStatus(
  store: Store,
  a: Attempt,
  current: Grant | undefined,
  at: number,
): ContinuationStatus {
  let state: ContinuationStatus["state"] = "waiting",
    expires: number | null = null;
  if (a.state !== "LOCKED") {
    state =
      a.state === "ACTIVE" &&
      current?.generation === a.generation &&
      !!current.consumed
        ? "resumed"
        : "not-paused";
  } else if (
    !a.start ||
    a.ended ||
    a.protected ||
    !a.deadline ||
    a.deadline <= at
  ) {
    state = "unavailable";
  } else if (current) {
    expires = Math.min(current.expires, a.deadline!);
    state =
      current.generation !== a.generation
        ? "superseded"
        : current.consumed
          ? "used"
          : expires <= at
            ? "expired"
            : "approved";
  } else if (
    !store.db.prepare("SELECT 1 FROM tombstones WHERE attempt=?").get(a.id)
  ) {
    const row = store.db
      .prepare(
        "SELECT substr(authorizations,1,65537) authorizations FROM attempt_interruptions WHERE attempt=? AND outcome IS NULL",
      )
      .get(a.id) as { authorizations: string } | undefined;
    if (row) {
      try {
        if (Buffer.byteLength(row.authorizations) > 65536) throw Error();
        const history: unknown = JSON.parse(row.authorizations);
        if (!Array.isArray(history)) throw Error();
        const last = history.at(-1);
        if (last !== undefined) {
          if (
            !last ||
            !Number.isSafeInteger(last.generation) ||
            last.generation < 0 ||
            !Number.isSafeInteger(last.expires) ||
            last.expires <= 0
          )
            throw Error();
          expires = last.expires;
          state = last.revoked_at
            ? "revoked"
            : last.replaced_at || last.generation !== a.generation
              ? "superseded"
              : last.used_at || last.consumed
                ? "used"
                : last.expires <= at
                  ? "expired"
                  : "revoked";
        }
      } catch {
        state = "unknown";
        expires = null;
      }
    }
  }
  return continuationStatus.parse({
    v: 1,
    attempt: a.id,
    generation: a.generation,
    revision: a.continuation_revision,
    state,
    expires,
    observedAt: at,
    execution: false,
  });
}
