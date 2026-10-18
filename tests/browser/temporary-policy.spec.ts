import { test, expect } from "@playwright/test";
import {
  fixture,
  gate,
  openPreflight,
  ready,
  resetScreens,
  onlyScreens,
  simulatedMedia,
} from "./transition-fixture.js";

test("account setup stays in the same preflight without a second sign-in screen", async ({
  page,
}) => {
  const f = await fixture(page);
  const wait = gate();
  await page.route("**/api/student/attempts/*/begin", async (route) => {
    await wait.promise;
    f.model.state = "ACTIVE";
    Object.assign(f.model.attempt, {
      state: "ACTIVE",
      start: Date.now(),
      deadline: Date.now() + 300000,
    });
    await route.fulfill({ json: f.snapshot() });
  });
  await openPreflight(page, f);
  await ready(page);
  await page.getByRole("button", { name: "Begin exam", exact: true }).click();
  await resetScreens(page);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Begin exam", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Connect to your exam" }),
  ).toHaveCount(0);
  expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  wait.release();
  await expect(
    page.getByRole("button", { name: "Finish exam", exact: true }),
  ).toBeEnabled();
  await onlyScreens(page, ["Begin your timed exam?", "preflight", "active"]);
});

// Actual WASM SSH, signed receipts, certificate authentication and HTTP routes.
test("one password and MFA sign-in, one preflight, automatic protected SSH handoff", async ({
  page,
}) => {
  test.setTimeout(45000);
  test.skip(
    process.env.EXAM_BROWSER_SSH !== "1",
    "Requires the browser SSH relay fixture",
  );
  await simulatedMedia(page);
  let authStarts = 0;
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === "/api/auth/start") authStarts++;
  });
  await page.goto("/");
  await page.getByLabel("Exam ID", { exact: true }).fill("temporary-access");
  await page.getByLabel("Enrolled username").fill("policytest01");
  await page
    .getByRole("button", { name: "Start SSH sign-in", exact: true })
    .click();
  await page.getByLabel("Shared SSH password").fill("shared-password");
  await page
    .getByRole("button", { name: "Respond to this host", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Open preflight & practice", exact: true })
    .click();
  await ready(page);
  await page
    .getByRole("button", { name: "Practice terminal", exact: true })
    .click();
  await expect(page.locator(".winbox")).toHaveCount(1);
  const initial = (await (await page.request.get("/api/student/exam")).json())
    .attempt;
  expect(initial.start).toBeNull();
  await page.getByRole("button", { name: "Begin exam", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Begin exam", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Finish exam", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await expect(page.locator(".winbox")).toHaveCount(1);
  const active = (await (await page.request.get("/api/student/exam")).json())
    .attempt;
  expect(active.id).toBe(initial.id);
  expect(active.state).toBe("ACTIVE");
  expect(active.deadline - active.start).toBe(5400000);
  expect(authStarts).toBe(1);
  expect(
    await page.evaluate(() => (window as any).__screenCaptureRequests),
  ).toBe(1);
  expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await expect(page.getByLabel("Shared SSH password")).toHaveCount(0);
  await page.getByRole("button", { name: "Finish exam", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Finish exam", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Connect to your exam", exact: true }),
  ).toBeVisible();
});
