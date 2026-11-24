import { test, expect, type Page } from "@playwright/test";
import { begin, fixture, openPreflight, ready } from "./transition-fixture.js";

test.beforeEach(async ({ page }) => {
  const status = await page.request.get("/api/login-test");
  expect(status.ok()).toBe(true);
  expect((await status.json()).browserSSH).toBe(true);
});

async function displays(page: Page, count = 1, mode = "supported") {
  await page.addInitScript(
    ({ count, mode }) => {
      const primary = {},
        details = Object.assign(new EventTarget(), {
          screens: Array.from({ length: count }, (_, i) => (i ? {} : primary)),
          currentScreen: primary,
        });
      const permission = Object.assign(new EventTarget(), { state: "granted" });
      Object.defineProperty(window, "getScreenDetails", {
        configurable: true,
        value:
          mode === "unsupported"
            ? undefined
            : async () => {
                if (mode === "denied" || permission.state !== "granted")
                  throw new DOMException("Denied", "NotAllowedError");
                return details;
              },
      });
      const query = navigator.permissions.query.bind(navigator.permissions);
      navigator.permissions.query = ((descriptor: PermissionDescriptor) =>
        descriptor.name === ("window-management" as PermissionName)
          ? Promise.resolve(permission)
          : query(descriptor)) as typeof navigator.permissions.query;
      (window as any).__displays = (n: number) => {
        details.screens = Array.from({ length: n }, (_, i) =>
          i ? {} : primary,
        );
        details.dispatchEvent(new Event("screenschange"));
      };
      (window as any).__displayPermission = (state: string) => {
        permission.state = state;
        permission.dispatchEvent(new Event("change"));
      };
    },
    { count, mode },
  );
}
async function start(page: Page, f: Awaited<ReturnType<typeof fixture>>) {
  await openPreflight(page, f);
  await page
    .getByRole("button", { name: "Check displays", exact: true })
    .click();
  await ready(page);
  await page.getByRole("button", { name: "Start exam", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Start exam", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Finish exam", exact: true }),
  ).toBeEnabled();
}
test("real Chromium Window Management API verifies its actual single headless display through the preflight button", async ({
  page,
  context,
}) => {
  const cdp = await context.newCDPSession(page);
  const { targetInfo } = await cdp.send("Target.getTargetInfo");
  await cdp.send("Browser.setPermission", {
    permission: { name: "window-management" },
    setting: "granted",
    origin: "http://localhost:3100",
    browserContextId: targetInfo.browserContextId,
  });
  const f = await fixture(page, "NONE", "student", "sandbox", 300, false, true);
  await openPreflight(page, f);
  await page
    .getByRole("button", { name: "Check displays", exact: true })
    .click();
  await expect(page.locator(".display-verification")).toContainText(
    "One display detected",
  );
  expect(f.model.attempt.start).toBeFalsy();
});

test("enabling the exam-wide policy during work requires verification without changing the attempt", async ({
  page,
}) => {
  await displays(page);
  const f = await fixture(page);
  await begin(page, f);
  const deadline = f.model.attempt.deadline,
    settings = f.model.attempt.settings;
  f.model.singleDisplayRequired = true;
  f.send();
  await expect(
    page.getByRole("button", { name: "Check displays", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".workspace .window-area")).toHaveAttribute(
    "inert",
    "",
  );
  await page
    .getByRole("button", { name: "Check displays", exact: true })
    .click();
  await expect(page.locator(".workspace .window-area")).not.toHaveAttribute(
    "inert",
    "",
  );
  expect(f.model.attempt.deadline).toBe(deadline);
  expect(f.model.attempt.settings).toBe(settings);
});

test("preflight requires a positive display check without starting time; disconnecting the extra display enables Start", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await displays(page, 2);
  const f = await fixture(page, "NONE", "student", "sandbox", 300, false, true);
  await openPreflight(page, f);
  await ready(page);
  await expect(
    page.getByRole("button", { name: "Start exam", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Check displays", exact: true })
    .click();
  await expect(page.locator(".display-verification")).toContainText(
    "Disconnect or disable extra displays",
  );
  expect(
    await page
      .locator(".display-verification")
      .evaluate((e) => e.scrollWidth <= e.clientWidth),
  ).toBe(true);
  await expect(
    page.getByRole("button", { name: "Start exam", exact: true }),
  ).toBeDisabled();
  expect(f.model.attempt.start).toBeFalsy();
  await page.evaluate(() => (window as any).__displays(1));
  await expect(page.locator(".display-verification")).toContainText(
    "One display detected",
  );
  await expect(
    page.getByRole("button", { name: "Start exam", exact: true }),
  ).toBeEnabled();
  await page.screenshot({ path: info.outputPath("preflight-one-display.png") });
});
for (const mode of ["denied", "unsupported"])
  test(`${mode} verification explains how to proceed and never starts time`, async ({
    page,
  }) => {
    await displays(page, 1, mode);
    const f = await fixture(
      page,
      "NONE",
      "student",
      "sandbox",
      300,
      false,
      true,
    );
    await openPreflight(page, f);
    await page
      .getByRole("button", { name: "Check displays", exact: true })
      .click();
    await expect(page.locator(".display-verification")).toContainText(
      "desktop Chrome or Edge",
    );
    await expect(
      page.getByRole("button", { name: "Start exam", exact: true }),
    ).toBeDisabled();
    expect(f.model.attempt.start).toBeFalsy();
    expect(f.model.messages.filter((m) => m.type === "incident")).toHaveLength(
      0,
    );
  });
test("a short extra-display interruption pauses typing and restores it on fresh verification, preserving the same clock", async ({
  page,
}) => {
  await displays(page);
  const f = await fixture(page, "NONE", "student", "sandbox", 300, false, true);
  await start(page, f);
  const original = { ...f.model.attempt };
  await page.evaluate(() => (window as any).__displays(2));
  await expect(page.locator(".focus-warning")).toBeVisible();
  await expect(page.locator(".workspace .window-area")).toHaveAttribute(
    "inert",
    "",
  );
  await expect
    .poll(() =>
      f.model.messages.some(
        (m) => m.type === "conditions" && m.ready.display === "multiple",
      ),
    )
    .toBe(true);
  await page.evaluate(() => (window as any).__displays(1));
  await expect(page.locator(".focus-warning")).toHaveCount(0);
  await expect(page.locator(".workspace .window-area")).not.toHaveAttribute(
    "inert",
    "",
  );
  expect(f.model.attempt.deadline).toBe(original.deadline);
  expect(f.model.attempt.id).toBe(original.id);
  expect(f.model.messages.filter((m) => m.type === "incident")).toHaveLength(0);
});
test("permission revocation cannot turn an earlier extra display into an accusation; fresh checking restores input", async ({
  page,
}) => {
  test.setTimeout(45000);
  await displays(page);
  const f = await fixture(page, "NONE", "student", "sandbox", 300, false, true);
  await start(page, f);
  const deadline = f.model.attempt.deadline;
  await page.evaluate(() => (window as any).__displays(2));
  await expect(page.locator(".focus-warning")).toBeVisible();
  await page.evaluate(() => (window as any).__displayPermission("denied"));
  await expect(page.locator(".focus-warning")).toHaveCount(0);
  await page.waitForTimeout(16000);
  expect(f.model.messages.filter((m) => m.type === "incident")).toHaveLength(0);
  await expect(page.locator(".workspace .window-area")).toHaveAttribute(
    "inert",
    "",
  );
  await page.evaluate(() => {
    (window as any).__displays(1);
    (window as any).__displayPermission("granted");
  });
  await expect(
    page.getByRole("button", { name: "Check displays", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Check displays", exact: true })
    .click();
  await expect(page.locator(".workspace .window-area")).not.toHaveAttribute(
    "inert",
    "",
  );
  expect(f.model.attempt.deadline).toBe(deadline);
});
test("a persistently detected extra display uses the shared grace and cannot restore work after expiry", async ({
  page,
}) => {
  test.setTimeout(40000);
  await displays(page);
  const f = await fixture(page, "NONE", "student", "sandbox", 300, false, true);
  await start(page, f);
  await page.evaluate(() => (window as any).__displays(2));
  await expect
    .poll(() => f.model.messages.filter((m) => m.type === "incident").length, {
      timeout: 18000,
    })
    .toBe(1);
  await page.evaluate(() => (window as any).__displays(1));
  await expect(page.locator(".workspace .window-area")).toHaveAttribute(
    "inert",
    "",
  );
});
