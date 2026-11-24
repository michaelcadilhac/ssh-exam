import { expect, it, vi } from "vitest";
import { DisplayVerification } from "../../apps/web/src/display-verification.js";
import { examConditionsVerdict } from "../../packages/protocol/focus-grace.js";
import { readinessMessage } from "../../packages/protocol/readiness.js";
import {
  examSchema,
  examDefinitionSchema,
} from "../../packages/protocol/index.js";

function fixture(count = 1) {
  const first = {},
    details = Object.assign(new EventTarget(), {
      screens: Array.from({ length: count }, (_, i) => (i ? {} : first)),
      currentScreen: first,
    });
  const permission = Object.assign(new EventTarget(), { state: "granted" });
  const browser = {
    getScreenDetails: vi.fn(async () => details),
    navigator: { permissions: { query: vi.fn(async () => permission) } },
  };
  const notify = vi.fn(),
    verifier = new DisplayVerification(notify, browser as any);
  return { browser, details, permission, notify, verifier };
}
it.each([
  [1, "single"],
  [2, "multiple"],
  [0, "unavailable"],
] as const)("verifies %s active displays as %s", async (count, expected) => {
  const f = fixture(count);
  expect(await f.verifier.verify()).toBe(expected);
  expect(f.browser.getScreenDetails).toHaveBeenCalledOnce();
  f.verifier.dispose();
});
it("detects topology changes and revocation, requiring a fresh check after permission returns", async () => {
  const f = fixture();
  await f.verifier.verify();
  f.details.screens.push({});
  f.details.dispatchEvent(new Event("screenschange"));
  expect(f.notify).toHaveBeenLastCalledWith("multiple");
  f.permission.state = "denied";
  f.permission.dispatchEvent(new Event("change"));
  expect(f.notify).toHaveBeenLastCalledWith("unavailable");
  f.permission.state = "granted";
  f.permission.dispatchEvent(new Event("change"));
  expect(f.verifier.status()).toBe("unavailable");
  f.details.screens.pop();
  expect(await f.verifier.verify()).toBe("single");
  f.verifier.dispose();
  const calls = f.notify.mock.calls.length;
  f.details.dispatchEvent(new Event("screenschange"));
  expect(f.notify).toHaveBeenCalledTimes(calls);
});
it("unsupported API and rejected permission stay unavailable without an automatic retry", async () => {
  const unsupported = new DisplayVerification(vi.fn(), {
    screen: { isExtended: false },
  } as any);
  expect(await unsupported.verify()).toBe("unavailable");
  const f = fixture();
  f.browser.getScreenDetails.mockRejectedValueOnce(
    new DOMException("Denied", "NotAllowedError"),
  );
  expect(await f.verifier.verify()).toBe("unavailable");
  expect(f.browser.getScreenDetails).toHaveBeenCalledOnce();
});
it("ignores older or disposed permission requests", async () => {
  const f = fixture(2);
  let resolve!: (value: typeof f.details) => void;
  f.browser.getScreenDetails.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const older = f.verifier.verify();
  f.details.screens.pop();
  expect(await f.verifier.verify()).toBe("single");
  f.verifier.dispose();
  resolve(f.details);
  expect(await older).toBe("unavailable");
  expect(f.verifier.status()).toBe("unavailable");
});
it("bounds an unanswered permission prompt and ignores its late result", async () => {
  vi.useFakeTimers();
  try {
    const f = fixture();
    let resolve!: (value: typeof f.details) => void;
    f.browser.getScreenDetails.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const pending = f.verifier.verify();
    await vi.advanceTimersByTimeAsync(60000);
    expect(await pending).toBe("unavailable");
    resolve(f.details);
    await Promise.resolve();
    expect(f.verifier.status()).toBe("unavailable");
    f.verifier.dispose();
  } finally {
    vi.useRealTimers();
  }
});
const ready = {
  fullscreen: true,
  focus: true,
  visible: true,
  keyboard: true,
  screen: true,
  webcam: false,
};
it("distinguishes additional displays from unknown topology without hiding other condition failures", () => {
  expect(examConditionsVerdict(ready, false, true)).toBeNull();
  expect(
    examConditionsVerdict({ ...ready, display: "multiple" }, false, true),
  ).toBe(false);
  expect(
    examConditionsVerdict({ ...ready, display: "single" }, false, true),
  ).toBe(true);
  expect(examConditionsVerdict({ ...ready, visible: false }, false, true)).toBe(
    false,
  );
  expect(examConditionsVerdict(ready, false)).toBe(true);
  expect(readinessMessage(ready, false, "starting", true)).toMatch(
    /Verify.*one display/,
  );
});
it("keeps the exam-wide policy outside immutable grant settings", () => {
  const definition = {
    id: "test",
    name: "Test",
    template: "sample",
    earliest: 1,
    latest: 2,
    single_display: true,
  };
  expect(examDefinitionSchema.parse(definition).single_display).toBe(true);
  expect(examSchema.parse(definition)).not.toHaveProperty("single_display");
});
