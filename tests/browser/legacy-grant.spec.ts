import { test, expect } from "@playwright/test";
import { simulatedMedia, ready } from "./transition-fixture.js";

test("reviewed NEW legacy grants survive a lost confirmation reply and start their full saved allowance through WASM SSH", async ({
  page,
}, testInfo) => {
  test.setTimeout(60000);
  await page.setViewportSize({ width: 430, height: 1000 });
  await simulatedMedia(page);
  await page.goto("/admin");
  await page.getByLabel("Username", { exact: true }).fill("instructor");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByLabel("Selected exam").selectOption("legacy-grant");
  await page
    .getByRole("button", { name: "Issue legacy grants", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Issue legacy grants",
    exact: true,
  });
  await dialog
    .getByLabel("Legacy unused students", { exact: true })
    .fill("legacy01\nlegacy02");
  await dialog
    .getByLabel("Reason for NEW issuance")
    .fill("Review NEW grants for existing unused browser enrollments");
  await dialog
    .getByRole("button", { name: "Preview NEW grants", exact: true })
    .click();
  await expect(
    dialog.getByRole("heading", { name: "legacy01", exact: true }),
  ).toBeVisible();
  await expect(dialog).toContainText("90 minutes · Webcam not required");
  await expect(dialog).toContainText("75 minutes · Webcam required");
  await expect(dialog).toContainText("Status: REVIEW");
  expect(
    await dialog.evaluate(
      (el) => el.getBoundingClientRect().right <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("legacy-grant-review-430.png"),
    fullPage: true,
  });
  let firstBody: any,
    confirmations = 0;
  await page.route("**/api/admin/grant-issuance/*/confirm", async (route) => {
    const body = route.request().postDataJSON();
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    confirmations++;
    if (confirmations === 1) {
      firstBody = body;
      await route.abort("failed");
    } else {
      expect(body).toEqual(firstBody);
      await route.fulfill({ response });
    }
  });
  await dialog
    .getByRole("button", { name: "Confirm NEW grants", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Retry confirm", exact: true }),
  ).toBeEnabled();
  await dialog
    .getByRole("button", { name: "Retry confirm", exact: true })
    .click();
  await expect(dialog).toContainText("Status: CONFIRMED");
  expect(confirmations).toBe(2);
  const grants = await (
    await page.request.get("/api/admin/exams/legacy-grant/grants")
  ).json();
  expect(grants.grants).toHaveLength(2);
  expect(grants.grants.every((g: any) => g.claims.length === 0)).toBe(true);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page
    .getByRole("button", { name: "Administration", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
  await page.goto("/");
  await page.getByLabel("Exam ID", { exact: true }).fill("legacy-grant");
  await page.getByLabel("Enrolled username").fill("legacy01");
  await page
    .getByRole("button", { name: "Start SSH sign-in", exact: true })
    .click();
  await page.getByLabel("Shared SSH password").fill("shared-password");
  await page
    .getByRole("button", { name: "Respond to this host", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Reviewed browser grant", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Open preflight & practice", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Practice terminal", exact: true }),
  ).toBeEnabled();
  const before = (await (await page.request.get("/api/student/exam")).json())
    .attempt;
  expect(before).toMatchObject({
    start: null,
    deadline: null,
    state: "PREPARING",
    grant_id: expect.any(String),
  });
  await ready(page);
  await page.getByRole("button", { name: "Begin exam", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Begin exam", exact: true })
    .click();
  await expect(page.locator(".winbox")).toHaveCount(1);
  const active = (await (await page.request.get("/api/student/exam")).json())
    .attempt;
  expect(active).toMatchObject({ state: "ACTIVE", grant_id: before.grant_id });
  expect(active.deadline - active.start).toBe(5400000);
  await page.getByRole("button", { name: "Finish exam", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Finish exam", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Connect to your exam", exact: true }),
  ).toBeVisible();
});
