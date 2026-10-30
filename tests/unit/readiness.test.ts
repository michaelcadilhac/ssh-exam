import { it, expect } from "vitest";
import { readinessMessage } from "../../packages/protocol/readiness.js";
const ready = {
  fullscreen: true,
  keyboard: true,
  screen: true,
  focus: true,
  visible: true,
  webcam: false,
};
it("names missing fullscreen and keyboard lock without schema diagnostics", () => {
  expect(
    readinessMessage({ ...ready, fullscreen: false, keyboard: false }, false),
  ).toBe("Restore fullscreen and keyboard lock before resuming.");
});
it("requires camera sharing only for webcam-required students", () => {
  expect(readinessMessage(ready, false)).toBeNull();
  expect(readinessMessage(ready, true)).toBe(
    "Restore webcam sharing before resuming.",
  );
});
it("gives readable start and capture instructions", () => {
  expect(
    readinessMessage({ ...ready, screen: false }, false, "starting the exam"),
  ).toBe("Restore screen sharing before starting the exam.");
});
