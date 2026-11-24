import type { Lifecycle } from "./lifecycle.js";
import { now } from "./db.js";
import {
  FOCUS_GRACE_MS,
  FOCUS_GRACE_REASON,
} from "../../../packages/protocol/focus-grace.js";

// Also used for required-condition observations. The historical storage name is
// retained: one interval covers ALL overlapping failures, not one per condition.
// Only page-bound authenticated observations reach this entry. Repeated losses
// cannot restart the interval, and a late recovery cannot unlock it.
export async function reportFocus(
  life: Lifecycle,
  id: string,
  focused: boolean | null,
  observation?: Record<string, unknown>,
) {
  const a = life.store.attempt(id);
  if (a.state !== "ACTIVE") return;
  if (focused === null) {
    // An unavailable display check cannot prove continuous non-compliance.
    // Challenged monitoring evidence separately prevents execution until fresh
    // positive checks return. Do not expire grace into a policy accusation.
    if (a.focus_lost_at !== null) {
      life.store.db
        .prepare(
          "UPDATE attempts SET focus_lost_at=NULL WHERE id=? AND state='ACTIVE'",
        )
        .run(id);
      life.store.audit(
        "browser",
        "interruption-verification-unavailable",
        id,
        JSON.stringify(observation ?? {}),
      );
    }
    return;
  }
  if (a.focus_lost_at !== null && now() - a.focus_lost_at >= FOCUS_GRACE_MS) {
    await life.lock(id, FOCUS_GRACE_REASON);
    return;
  }
  if (
    (focused && a.focus_lost_at === null) ||
    (!focused && a.focus_lost_at !== null)
  )
    return;
  life.store.db.transaction(() => {
    life.store.db
      .prepare(
        focused
          ? "UPDATE attempts SET focus_lost_at=NULL WHERE id=? AND state='ACTIVE'"
          : "UPDATE attempts SET focus_lost_at=COALESCE(focus_lost_at,?) WHERE id=? AND state='ACTIVE'",
      )
      .run(...(focused ? [id] : [now(), id]));
    life.store.audit(
      "browser",
      focused ? "interruption-grace-cleared" : "interruption-grace-started",
      id,
      observation ? JSON.stringify(observation) : "",
    );
  })();
}
