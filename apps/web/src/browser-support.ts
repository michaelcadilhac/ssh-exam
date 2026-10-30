const requirement = "Use desktop Chrome, Edge or Chromium for this exam.";

function deniedByPolicy(feature: string) {
  const policy =
    (document as any).permissionsPolicy || (document as any).featurePolicy;
  // Unknown policy names can report false even when an API is supported.
  return (
    !!policy?.features?.().includes(feature) && !policy.allowsFeature(feature)
  );
}

export function examBrowserIssue(): string | null {
  const missing = [];
  if (!globalThis.isSecureContext) missing.push("a secure connection");
  if (
    !document.fullscreenEnabled ||
    typeof document.documentElement.requestFullscreen !== "function" ||
    deniedByPolicy("fullscreen")
  )
    missing.push("fullscreen");
  if (
    typeof navigator.mediaDevices?.getDisplayMedia !== "function" ||
    deniedByPolicy("display-capture")
  )
    missing.push("screen sharing");
  if (
    typeof (navigator as any).keyboard?.lock !== "function" ||
    typeof (navigator as any).keyboard?.unlock !== "function" ||
    deniedByPolicy("keyboard-lock")
  )
    missing.push("keyboard lock");
  return missing.length
    ? `${requirement} Unavailable: ${missing.join(", ")}.`
    : null;
}

export async function checkExamBrowser(): Promise<string | null> {
  const issue = examBrowserIssue();
  if (issue) return issue;
  for (const [name, label] of [
    ["keyboard-lock", "keyboard lock"],
    ["display-capture", "screen sharing"],
  ]) {
    try {
      // Query only; actual capture/fullscreen still requires a preflight gesture.
      const permission = await navigator.permissions.query({
        name: name as PermissionName,
      });
      if (permission.state === "denied")
        return `${requirement} Allow ${label} in browser settings, then reload.`;
    } catch {
      // Unsupported permission queries do not mean an otherwise supported API
      // is denied. Preflight still checks the actual grant before Begin.
    }
  }
  return null;
}
