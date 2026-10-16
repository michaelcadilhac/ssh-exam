import type { Lifecycle } from "./lifecycle.js";
import { now } from "./db.js";
import {
  FOCUS_GRACE_MS,
  FOCUS_GRACE_REASON,
} from "../../../packages/protocol/focus-grace.js";

// Only page-bound, authenticated messages reach this function. Repeated blur
// reports cannot restart a grace interval, and a late focus report cannot unlock it.
export async function reportFocus(
  life: Lifecycle,
  id: string,
  focused: boolean,
) {
  const a = life.store.attempt(id);
  if (a.state !== "ACTIVE") return;
  if (a.focus_lost_at !== null && now() - a.focus_lost_at >= FOCUS_GRACE_MS) {
    await life.lock(id, FOCUS_GRACE_REASON);
    return;
  }
  if (
    (focused && a.focus_lost_at === null) ||
    (!focused && a.focus_lost_at !== null)
  )
    return;
  life.store.db
    .prepare(
      focused
        ? "UPDATE attempts SET focus_lost_at=NULL WHERE id=? AND state='ACTIVE'"
        : "UPDATE attempts SET focus_lost_at=COALESCE(focus_lost_at,?) WHERE id=? AND state='ACTIVE'",
    )
    .run(...(focused ? [id] : [now(), id]));
}
