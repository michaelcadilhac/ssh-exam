import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  checkExamBrowser,
  examBrowserIssue,
} from "../../apps/web/src/browser-support.js";

let documentMock: any;
let navigatorMock: any;
beforeEach(() => {
  documentMock = {
    fullscreenEnabled: true,
    documentElement: { requestFullscreen: vi.fn() },
  };
  navigatorMock = {
    mediaDevices: { getDisplayMedia: vi.fn() },
    keyboard: { lock: vi.fn(), unlock: vi.fn() },
    permissions: {
      query: vi.fn().mockRejectedValue(Error("Unsupported permission name")),
    },
  };
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("document", documentMock);
  vi.stubGlobal("navigator", navigatorMock);
});
afterEach(() => vi.unstubAllGlobals());

it("accepts supported APIs without requesting fullscreen, capture or keyboard lock", async () => {
  expect(await checkExamBrowser()).toBeNull();
  expect(documentMock.documentElement.requestFullscreen).not.toHaveBeenCalled();
  expect(navigatorMock.mediaDevices.getDisplayMedia).not.toHaveBeenCalled();
  expect(navigatorMock.keyboard.lock).not.toHaveBeenCalled();
});
it.each(["fullscreen", "screen sharing", "keyboard lock", "secure connection"])(
  "rejects missing %s before authentication",
  (missing) => {
    if (missing === "fullscreen") documentMock.fullscreenEnabled = false;
    if (missing === "screen sharing") navigatorMock.mediaDevices = undefined;
    if (missing === "keyboard lock") navigatorMock.keyboard = undefined;
    if (missing === "secure connection")
      vi.stubGlobal("isSecureContext", false);
    expect(examBrowserIssue()).toContain(missing);
  },
);
it("honors policy restrictions but ignores unrecognized policy feature names", () => {
  documentMock.featurePolicy = {
    features: () => ["fullscreen"],
    allowsFeature: vi.fn().mockReturnValue(true),
  };
  expect(examBrowserIssue()).toBeNull();
  expect(
    documentMock.featurePolicy.allowsFeature,
  ).toHaveBeenCalledExactlyOnceWith("fullscreen");
  documentMock.featurePolicy.allowsFeature.mockReturnValue(false);
  expect(examBrowserIssue()).toContain("Unavailable here: fullscreen");
});
it("rejects an already-denied keyboard permission and allows a later settings change", async () => {
  navigatorMock.permissions.query.mockResolvedValue({ state: "denied" });
  expect(await checkExamBrowser()).toContain(
    "Permission denied: keyboard lock",
  );
  navigatorMock.permissions.query.mockResolvedValue({ state: "prompt" });
  expect(await checkExamBrowser()).toBeNull();
});
