export function readinessMessage(
  input: unknown,
  requireWebcam: boolean,
  action = "continuing",
) {
  const ready = (input && typeof input === "object" ? input : {}) as Record<
    string,
    unknown
  >;
  const required = [
    ["fullscreen", "fullscreen"],
    ["keyboard", "keyboard lock"],
    ["screen", "screen sharing"],
    ["focus", "browser focus"],
    ["visible", "a visible exam page"],
    ...(requireWebcam ? [["webcam", "camera sharing"]] : []),
  ];
  const missing = required
    .filter(([key]) => ready[key] !== true)
    .map(([, label]) => label);
  if (!missing.length) return null;
  const list =
    missing.length === 1
      ? missing[0]
      : missing.slice(0, -1).join(", ") + " and " + missing.at(-1);
  return `Restore ${list} before ${action}.`;
}
