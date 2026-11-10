import { test, expect, type Page } from "@playwright/test";
import {
  fixture,
  begin,
  openPreflight,
  readyTerminal,
} from "./transition-fixture.js";

test.use({ actionTimeout: 8000 });

async function origin(page: Page) {
  await page.route("**/navigation-origin", (route) =>
    route.fulfill({ contentType: "text/html", body: "<h1>Previous page</h1>" }),
  );
  await page.goto("/navigation-origin");
}

// CDP sends actual non-primary input through Chromium's browser navigation
// path. dispatchEvent alone cannot prove that the native Back default is stopped.
async function mouseHistory(page: Page, button: "back" | "forward") {
  const cdp = await page.context().newCDPSession(page);
  try {
    for (const type of ["mousePressed", "mouseReleased"] as const)
      await cdp.send("Input.dispatchMouseEvent", {
        type,
        x: 25,
        y: 120,
        button,
        buttons: type === "mouseReleased" ? 0 : button === "back" ? 8 : 16,
        clickCount: 1,
      });
  } finally {
    await cdp.detach();
  }
}

test("mouse Back and Forward preserve the active page and input without a warning or incident", async ({
  page,
}) => {
  const f = await fixture(page);
  await origin(page);
  await begin(page, f);
  await readyTerminal(page, 1);
  const deadline = f.model.attempt.deadline;
  await page.evaluate(() => ((window as any).__sameExamPage = true));
  let dialogs = 0;
  page.on("dialog", async (dialog) => {
    dialogs++;
    await dialog.dismiss();
  });
  await mouseHistory(page, "back");
  // Give a real browser navigation its event-loop opportunity before checking.
  await expect(
    page.getByRole("button", { name: "Finish exam", exact: true }),
  ).toBeEnabled();
  expect(await page.evaluate(() => (window as any).__sameExamPage)).toBe(true);
  // A forward entry in the SAME document also exercises a default that an
  // unload confirmation cannot catch. The guard must not alter history at all.
  await page.evaluate(async () => {
    const returned = new Promise<void>((resolve) =>
      window.addEventListener("popstate", () => resolve(), { once: true }),
    );
    history.pushState(null, "", "?future");
    history.back();
    await returned;
  });
  await mouseHistory(page, "forward");
  await expect(page).toHaveURL("/");
  expect(dialogs).toBe(0);
  expect(f.model.attempt.deadline).toBe(deadline);
  expect(f.model.messages.filter((m) => m.type === "incident")).toEqual([]);
  await readyTerminal(page, 1);
  await page.keyboard.type("echo still-here");
  await expect
    .poll(() => f.model.messages.filter((m) => m.type === "input").length)
    .toBeGreaterThan(0);
});

test("Stay on browser Back or reload retains fullscreen, page, terminals and monitoring", async ({
  page,
}) => {
  const f = await fixture(page);
  await origin(page);
  await begin(page, f);
  await readyTerminal(page, 1);
  const deadline = f.model.attempt.deadline;
  await page.evaluate(() => ((window as any).__sameExamPage = true));
  for (const action of ["back", "reload"] as const) {
    const cdp = await page.context().newCDPSession(page);
    try {
      const warned = page.waitForEvent("dialog", { timeout: 5000 });
      if (action === "back")
        await page.evaluate(() => {
          setTimeout(() => history.back(), 0);
        });
      else await cdp.send("Page.reload");
      const dialog = await warned;
      expect(dialog.type()).toBe("beforeunload");
      await dialog.dismiss();
      expect(await page.evaluate(() => (window as any).__sameExamPage)).toBe(
        true,
      );
      expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(
        true,
      );
      await readyTerminal(page, 1);
      expect(f.model.attempt.deadline).toBe(deadline);
      expect(f.model.messages.filter((m) => m.type === "incident")).toEqual([]);
    } finally {
      await cdp.detach();
    }
  }
  // Navigation protection cannot mask a real fullscreen departure.
  await page.evaluate(() => document.exitFullscreen());
  await expect
    .poll(() =>
      f.model.messages
        .filter((m) => m.type === "incident")
        .map((m) => m.reason),
    )
    .toContain("Workspace exited fullscreen");
});

test("accepting Leave still reports actual departure", async ({ page }) => {
  const f = await fixture(page);
  await origin(page);
  await begin(page, f);
  const warned = page.waitForEvent("dialog", { timeout: 5000 });
  await page.evaluate(() => {
    setTimeout(() => history.back(), 0);
  });
  const dialog = await warned;
  expect(dialog.type()).toBe("beforeunload");
  await dialog.accept();
  await expect(
    page.getByRole("heading", { name: "Previous page" }),
  ).toBeVisible();
  await expect
    .poll(() => f.model.messages.filter((m) => m.type === "incident").length)
    .toBe(1);
});

test("preflight sign-out removes the navigation guard", async ({ page }) => {
  const f = await fixture(page);
  await openPreflight(page, f);
  const cancelled = await page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(cancelled).toBe(true);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Sign out", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Sign in to your exam" }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    }),
  ).toBe(false);
});

test("completed attempts can navigate without an extra confirmation", async ({
  page,
}) => {
  const f = await fixture(page);
  await begin(page, f);
  f.model.attempt.state = "COMPLETED";
  f.model.attempt.protected = true;
  f.send();
  await expect(
    page.getByRole("heading", { name: "Files saved", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    }),
  ).toBe(false);
});
