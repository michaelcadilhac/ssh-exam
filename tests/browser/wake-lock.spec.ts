import { test, expect, type Page } from "@playwright/test";
import { fixture, openPreflight, ready, begin } from "./transition-fixture.js";

async function wakeAPI(page: Page, mode = "normal") {
  await page.addInitScript((mode) => {
    const state = ((window as any).__wake = {
      requests: 0,
      releases: 0,
      locks: [] as any[],
      grant: undefined as undefined | (() => void),
    });
    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value:
        mode === "unsupported"
          ? undefined
          : {
              request: async (type: string) => {
                if (type !== "screen") throw Error("Wrong wake lock type");
                state.requests++;
                if (mode === "denied")
                  throw new DOMException("Battery policy", "NotAllowedError");
                if (mode === "pending")
                  await new Promise<void>((r) => {
                    state.grant = r;
                  });
                const lock = Object.assign(new EventTarget(), {
                  released: false,
                  type: "screen",
                  release: async () => {
                    if (lock.released) return;
                    lock.released = true;
                    state.releases++;
                    lock.dispatchEvent(new Event("release"));
                  },
                });
                state.locks.push(lock);
                return lock;
              },
            },
    });
  }, mode);
}

test("workspace keeps the screen awake, reacquires on return and releases at finish", async ({
  page,
}) => {
  const f = await fixture(page);
  await wakeAPI(page);
  await openPreflight(page, f);
  await expect
    .poll(() => page.evaluate(() => (window as any).__wake.requests))
    .toBe(1);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect
    .poll(() => page.evaluate(() => (window as any).__wake.releases))
    .toBe(1);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
  });
  await expect
    .poll(() => page.evaluate(() => (window as any).__wake.requests))
    .toBe(2);
  await ready(page);
  await page.getByRole("button", { name: "Start exam", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Start exam", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Finish exam", exact: true }),
  ).toBeEnabled();
  expect(await page.evaluate(() => (window as any).__wake.requests)).toBe(2);
  await page.evaluate(() => (window as any).__wake.locks[1].release());
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect
    .poll(() => page.evaluate(() => (window as any).__wake.requests))
    .toBe(3);
  expect(f.model.messages.filter((m) => m.type === "incident")).toEqual([]);
  f.model.attempt.state = "FINALIZING";
  f.send();
  await expect(
    page.getByRole("heading", { name: "Saving your files" }),
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => (window as any).__wake.releases))
    .toBe(3);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  expect(await page.evaluate(() => (window as any).__wake.requests)).toBe(3);
});

for (const mode of ["denied", "unsupported"])
  test(`wake lock ${mode} does not block Start or weaken fullscreen enforcement`, async ({
    page,
  }) => {
    const f = await fixture(page);
    await wakeAPI(page, mode);
    await begin(page, f);
    expect(f.model.attempt.start).toBeGreaterThan(0);
    expect(f.model.messages.filter((m) => m.type === "incident")).toEqual([]);
    await page.evaluate(() => document.exitFullscreen());
    await expect
      .poll(() =>
        f.model.messages
          .filter((m) => m.type === "incident")
          .map((m) => m.reason),
      )
      .toContain("Workspace exited fullscreen");
    await expect(
      page.getByRole("heading", { name: "Work paused" }),
    ).toBeVisible();
  });

test("a wake lock granted after sign-out is released immediately", async ({
  page,
}) => {
  const f = await fixture(page);
  await wakeAPI(page, "pending");
  await openPreflight(page, f);
  await expect
    .poll(() => page.evaluate(() => (window as any).__wake.requests))
    .toBe(1);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Sign out", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Sign in to your exam" }),
  ).toBeVisible();
  await page.evaluate(() => (window as any).__wake.grant());
  await expect
    .poll(() => page.evaluate(() => (window as any).__wake.releases))
    .toBe(1);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  expect(await page.evaluate(() => (window as any).__wake.requests)).toBe(1);
});
