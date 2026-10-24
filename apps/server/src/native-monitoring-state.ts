import type { Attempt, Store } from "./db.js";
import { monitoringOwner } from "../../../packages/protocol/monitoring-evidence.js";

// Only accepted native signatures/SSH outcomes call this. These are version and
// pending-operation observations, never permission reconstructed from SQLite.
export function observeNativeMonitoring(store: Store, a: Attempt, remote: any) {
  if (remote.monitoring_mode === undefined) {
    if (
      a.monitoring_mode === "v1" &&
      ["ACTIVE", "LOCKED"].includes(remote.state)
    )
      throw Error(
        "Native monitoring role is missing or changed. Preserve the original attempt and inspect matching loaded roles; no legacy continuation is authorized.",
      );
    if (remote.start && !a.monitoring_mode)
      store.db
        .prepare(
          "UPDATE attempts SET monitoring_mode='legacy' WHERE id=? AND monitoring_mode IS NULL",
        )
        .run(a.id);
    return;
  }
  if (
    remote.monitoring_mode !== "v1" ||
    !remote.start ||
    remote.browser_ssh !== true ||
    remote.terminal_supervised !== true
  )
    throw Error(
      "Unsupported native monitoring runtime observation; preserve the original attempt and inspect matching roles.",
    );
  const owner = monitoringOwner.parse(remote.registered_owner);
  if (
    remote.id !== a.id ||
    owner.attempt !== a.id ||
    owner.exam !== a.exam ||
    owner.username !== a.username ||
    owner.uid !== a.uid ||
    owner.boot !== remote.boot ||
    owner.clock_revision !== (remote.clock_revision || 0)
  )
    throw Error(
      "Native monitoring owner does not match the original attempt/clock.",
    );
  if (a.monitoring_mode === "legacy")
    throw Error(
      "An already-started legacy attempt cannot be converted to retained monitoring; preserve its original workflow.",
    );
  const hold = remote.retained_hold || null,
    kind = remote.monitoring_hold_kind || null;
  if (
    (hold !== null &&
      !["pending", "unverified", "held", "resuming"].includes(hold)) ||
    (kind !== null && !["policy", "technical"].includes(kind)) ||
    (hold === "resuming" && remote.state !== "ACTIVE")
  )
    throw Error(
      "Invalid native monitoring hold observation; no resume permission accepted.",
    );
  store.db
    .prepare("UPDATE attempts SET monitoring_mode='v1' WHERE id=?")
    .run(a.id);
  if (
    (remote.generation || 0) >= a.generation &&
    (remote.clock_revision || 0) >= a.clock_revision
  )
    store.db
      .prepare(
        "UPDATE attempts SET retained_hold=?,monitoring_hold_kind=? WHERE id=?",
      )
      .run(hold, kind, a.id);
}

// Recorded native outcome identity only. A caller still needs the current
// authenticated native operation before exposing new input epochs or Continue.
export function nativeContinuationOutcomeRecorded(a: Attempt) {
  if (
    a.monitoring_mode !== "v1" ||
    a.retained_hold ||
    !a.registered_owner ||
    !a.start
  )
    return false;
  let raw: unknown;
  try {
    raw = JSON.parse(a.registered_owner);
  } catch {
    return false;
  }
  const parsed = monitoringOwner.safeParse(raw);
  return (
    parsed.success &&
    parsed.data.attempt === a.id &&
    parsed.data.exam === a.exam &&
    parsed.data.username === a.username &&
    parsed.data.uid === a.uid &&
    parsed.data.page_epoch === a.page_hash &&
    parsed.data.generation === a.generation &&
    parsed.data.clock_revision === a.clock_revision
  );
}
