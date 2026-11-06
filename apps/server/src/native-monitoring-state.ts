import type { Attempt, Store } from "./db.js";
import { monitoringOwner } from "../../../packages/protocol/monitoring-evidence.js";
import { isDeepStrictEqual } from "node:util";

// Only a negative SSH-exit fact may span clock revisions. Every immutable
// connection/page/input identity remains exact; this never authorizes work.
export function sameExitedLifetime(
  exited: ReturnType<typeof monitoringOwner.parse>,
  current: ReturnType<typeof monitoringOwner.parse>,
) {
  return (
    exited.clock_revision <= current.clock_revision &&
    isDeepStrictEqual(
      { ...exited, clock_revision: 0 },
      { ...current, clock_revision: 0 },
    )
  );
}

export function hasRecordedSSHExit(store: Store, a: Attempt) {
  if (a.monitoring_mode !== "v1" || !a.registered_owner) return false;
  try {
    const owner = monitoringOwner.parse(JSON.parse(a.registered_owner));
    if (
      owner.attempt !== a.id ||
      owner.exam !== a.exam ||
      owner.username !== a.username ||
      owner.uid !== a.uid
    )
      return false;
    for (const row of store.db
      .prepare(
        "SELECT detail FROM audit WHERE target=? AND actor='class-agent' AND action='native-ssh-exited' ORDER BY rowid DESC",
      )
      .iterate(a.id) as Iterable<{ detail: string }>) {
      const exited = monitoringOwner.safeParse(JSON.parse(row.detail));
      if (exited.success && sameExitedLifetime(exited.data, owner)) return true;
    }
  } catch {
    /* Unknown metadata is not proven SSH loss. */
  }
  return false;
}

// A negative recovery fact, never proof that another session is usable. Unknown
// transport state and delayed heartbeats do not establish an SSH disconnect.
export function needsFilesOnlyResume(store: Store, a: Attempt) {
  if (a.state !== "LOCKED" || a.monitoring_mode !== "v1") return false;
  if (a.page_hash === null) return true;
  return hasRecordedSSHExit(store, a);
}

// Signed status order is not ownership order: a queued LOCKED generation N
// still names the pre-Continue owner N-1. Once owner N committed, that retired
// observation cannot re-hold it or invalidate its already-consumed operation.
export function retiredNativeMonitoringObservation(a: Attempt, remote: any) {
  if (
    a.monitoring_mode !== "v1" ||
    !a.start ||
    !a.registered_owner ||
    remote.monitoring_mode !== "v1" ||
    !["ACTIVE", "LOCKED"].includes(remote.state) ||
    !Number.isSafeInteger(remote.generation || 0) ||
    (remote.generation || 0) > a.generation
  )
    return false;
  let stored: unknown;
  try {
    stored = JSON.parse(a.registered_owner);
  } catch {
    return false;
  }
  const current = monitoringOwner.safeParse(stored),
    previous = monitoringOwner.safeParse(remote.registered_owner);
  return (
    current.success &&
    previous.success &&
    current.data.attempt === a.id &&
    previous.data.attempt === a.id &&
    (previous.data.generation < current.data.generation ||
      (previous.data.generation === current.data.generation &&
        previous.data.clock_revision < current.data.clock_revision) ||
      (remote.retained_hold === "resuming" &&
        JSON.stringify(previous.data) === JSON.stringify(current.data) &&
        nativeContinuationOutcomeRecorded(a)))
  );
}

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
    kind = remote.monitoring_hold_kind || null,
    resumeKind = remote.monitoring_resume_kind || null,
    resumeNonce = remote.monitoring_resume_nonce || null;
  if (
    (hold !== null &&
      !["pending", "unverified", "held", "resuming"].includes(hold)) ||
    (kind !== null && !["policy", "technical"].includes(kind)) ||
    (hold === "resuming" && remote.state !== "ACTIVE") ||
    (resumeKind !== null && !["reviewed", "technical"].includes(resumeKind)) ||
    (resumeNonce !== null &&
      (typeof resumeNonce !== "string" ||
        !/^[a-f0-9]{64}$/.test(resumeNonce))) ||
    (resumeKind !== null && resumeNonce === null)
  )
    throw Error(
      "Invalid native monitoring hold observation; no resume permission accepted.",
    );
  if (retiredNativeMonitoringObservation(a, remote)) return;
  store.db
    .prepare("UPDATE attempts SET monitoring_mode='v1' WHERE id=?")
    .run(a.id);
  if (
    (remote.generation || 0) >= a.generation &&
    (remote.clock_revision || 0) >= a.clock_revision
  )
    store.db
      .prepare(
        "UPDATE attempts SET retained_hold=?,monitoring_hold_kind=?,native_resume_kind=?,native_resume_nonce=? WHERE id=?",
      )
      .run(hold, kind, resumeKind, resumeNonce, a.id);
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
