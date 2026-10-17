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
export function needsAttention(a: any): boolean {
  return a.state === "LOCKED" || a.state === "COLLECTION_FAILED";
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
export function attemptStatus(a: any): { label: string; tone: string } {
  if (a.state === "ACTIVE")
    return {
      label: a.working ? "Working" : "Disconnected",
      tone: a.working ? "good" : "warning",
    };
  if (a.state === "LOCKED") return { label: "Paused", tone: "warning" };
  if (a.state === "COLLECTION_FAILED")
    return { label: "Collection failed", tone: "danger" };
  if (a.state === "COMPLETED")
    return {
      label: a.protected ? "Submission secured" : "Collection pending",
      tone: a.protected ? "good" : "warning",
    };
  return {
    label:
      (
        {
          PREPARING: "Preflight",
          ACTIVATING: "Starting",
          FINALIZING: "Collecting",
          CANCELLED_BEFORE_START: "Cancelled",
        } as Record<string, string>
      )[a.state] || "Status unavailable",
    tone: "neutral",
  };
}
export function clockEditable(a: any, now: number): boolean {
  return (
    ["ACTIVE", "LOCKED"].includes(a.state) &&
    a.deadline > now &&
    !a.protected &&
    !a.pendingClockReset
  );
}
