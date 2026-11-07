import { effectiveDeadline, timerPaused } from "./timer.js";
// Presentation only. Authorization and clock changes remain server-controlled.
export const dashboardViews = [
  "",
  "working",
  "attention",
  "secured",
  "camera",
  "no-camera",
  "PREPARING",
  "ACTIVE",
  "LOCKED",
  "FINALIZING",
  "COMPLETED",
  "COLLECTION_FAILED",
  "CANCELLED_BEFORE_START",
] as const;
export type DashboardView = (typeof dashboardViews)[number];
export const dashboardFilters = [
  "",
  "available",
  "paused",
  "camera",
  "no-camera",
] as const;
export type DashboardFilter = (typeof dashboardFilters)[number];
export const dashboardSorts = ["username", "completed-desc"] as const;
export type DashboardSort = (typeof dashboardSorts)[number];

// Select STUDENTS, retaining their history. This projection is never admission.
export function matchesDashboardStudent(
  s: any,
  view: DashboardView = "",
  filter: DashboardFilter = "",
  at = Date.now(),
): boolean {
  if (view && !s.attempts.some((a: any) => matchesDashboardView(a, view)))
    return false;
  if (filter === "available") {
    if (typeof s.availableNextAttempt === "boolean")
      return s.availableNextAttempt;
    const grant = s.unusedAttempt;
    return (
      !!grant &&
      grant.status === "AVAILABLE" &&
      Number.isFinite(grant.settings?.latest) &&
      grant.settings.latest >= at &&
      Array.isArray(grant.claims) &&
      grant.claims.every((c: any) => c.state === "CANCELLED")
    );
  }
  if (filter === "paused")
    return s.attempts.some(
      (a: any) =>
        a.state === "LOCKED" ||
        (["ACTIVE", "LOCKED"].includes(a.state) && timerPaused(a)),
    );
  return (
    !filter || s.attempts.some((a: any) => matchesDashboardView(a, filter))
  );
}
export function compareDashboardStudents(
  a: any,
  b: any,
  sort: DashboardSort,
): number {
  const completed = (s: any) =>
    Math.max(
      0,
      ...s.attempts
        .filter((x: any) => x.state === "COMPLETED")
        .map(
          (x: any) => Number(x.ended || x.completed_at || x.collected_at) || 0,
        ),
    );
  return (
    (sort === "completed-desc" ? completed(b) - completed(a) : 0) ||
    (a.username < b.username ? -1 : a.username > b.username ? 1 : 0)
  );
}
export function needsAttention(a: any): boolean {
  return (
    a.state === "LOCKED" ||
    a.state === "COLLECTION_FAILED" ||
    !!a.policy_error ||
    !!a.access_error ||
    ["APPLY_FAILED", "RESTORE_FAILED"].includes(a.policy_state)
  );
}
export function webcamRequired(a: any): boolean | null {
  try {
    const settings =
      typeof a.settings === "string" ? JSON.parse(a.settings) : a.settings;
    return !!settings?.webcam;
  } catch {
    return null;
  }
}
export function matchesDashboardView(a: any, view: DashboardView): boolean {
  switch (view) {
    case "":
      return true;
    case "working":
      return !!a.working;
    case "attention":
      return needsAttention(a);
    case "secured":
      return !!a.protected;
    case "camera":
      return webcamRequired(a) === true;
    case "no-camera":
      return webcamRequired(a) === false;
    default:
      return a.state === view;
  }
}
// Presentation only: recognize an explicit protected marker in our projections.
// This does not verify an archive or authorize work.
export function hasProtectedFiles(
  attempt: { protected?: unknown } | null | undefined,
): boolean {
  return attempt?.protected === true || attempt?.protected === 1;
}
export function attemptStatus(a: any): { label: string; tone: string } {
  if (a.policy_state === "RESTORE_FAILED")
    return { label: "Server access needs attention", tone: "danger" };
  if (a.policy_state === "APPLY_FAILED")
    return { label: "Server setup failed", tone: "danger" };
  if (["RESTORE_PENDING", "RESTORING"].includes(a.policy_state))
    return { label: "Restoring server access", tone: "warning" };
  if (a.policy_state === "APPLYING")
    return { label: "Setting up server access", tone: "neutral" };
  if (a.state === "ACTIVE")
    return {
      label:
        a.working === true
          ? "Working"
          : a.connected === true
            ? "Status updating"
            : "Connection unconfirmed",
      tone: a.working === true ? "good" : "warning",
    };
  if (a.state === "LOCKED") return { label: "Work paused", tone: "warning" };
  if (a.state === "COLLECTION_FAILED")
    return {
      label: hasProtectedFiles(a)
        ? "Files saved; cleanup needs attention"
        : "File collection needs attention",
      tone: "danger",
    };
  if (a.state === "COMPLETED")
    return {
      label: hasProtectedFiles(a)
        ? "Files saved"
        : "File protection unconfirmed",
      tone: hasProtectedFiles(a) ? "good" : "warning",
    };
  return {
    label:
      (
        {
          PREPARING: "Setup",
          ACTIVATING: "Starting",
          FINALIZING: "Finishing",
          CANCELLED_BEFORE_START: "Setup cancelled",
        } as Record<string, string>
      )[a.state] || "Status unavailable",
    tone: "neutral",
  };
}
export function clockEditable(a: any, now: number): boolean {
  return (
    ["ACTIVE", "LOCKED"].includes(a.state) &&
    effectiveDeadline(a) > now &&
    !a.protected &&
    !a.pendingClockReset
  );
}

// Wall elapsed time includes countdown pauses. Never keep a
// finished attempt ticking, or count an unstarted preflight as exam time.
export function attemptElapsed(a: any, now: number): number | null {
  if (
    !a.start ||
    (["COMPLETED", "CANCELLED_BEFORE_START"].includes(a.state) && !a.ended)
  )
    return null;
  const end = a.ended || Math.min(now, effectiveDeadline(a) || now);
  return Math.max(0, (end - a.start) / 1000);
}
export function preflightElapsed(a: any, now: number): number | null {
  if (!a.preflight_started_at) return null;
  return Math.max(
    0,
    ((a.start || a.ended || now) - a.preflight_started_at) / 1000,
  );
}
