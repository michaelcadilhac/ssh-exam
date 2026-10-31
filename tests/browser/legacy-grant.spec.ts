import { instructorSignIn } from "./prof-workflow-fixture.js";
import { test, expect } from "@playwright/test";
import { selectedAction } from "./prof-workflow-fixture.js";
import { simulatedMedia, ready } from "./transition-fixture.js";

test("reviewed NEW legacy grants survive a lost confirmation reply and start their full saved allowance through WASM SSH", async ({
  page,
}, testInfo) => {
  test.setTimeout(60000);
  page.setDefaultTimeout(10000);
  await page.setViewportSize({ width: 430, height: 1000 });
  await simulatedMedia(page);
  await instructorSignIn(page, "prof_initial");
  await page.getByLabel("Selected exam").selectOption("legacy-grant");
  const dialog = await selectedAction(
    page,
    ["legacy01", "legacy02"],
    "Allow first attempt",
  );
  await dialog
    .getByLabel("Reason", { exact: true })
    .fill("Review NEW grants for existing unused browser enrollments");
  await dialog.getByRole("button", { name: "Review", exact: true }).click();
  await expect(
    dialog.getByRole("heading", { name: "legacy01", exact: true }),
  ).toBeVisible();
  await expect(dialog).toContainText("90 min · Webcam optional");
  await expect(dialog).toContainText("75 min · Webcam required");
  await expect(dialog).toContainText("Review attempts");
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
    .getByRole("button", { name: "Allow attempts", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Retry same request", exact: true }),
  ).toBeEnabled();
  await dialog
    .getByRole("button", { name: "Retry same request", exact: true })
    .click();
  await expect(dialog).toContainText("Attempts allowed");
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
  await page.getByLabel("Username").fill("legacy01");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByLabel("Password", { exact: true }).fill("shared-password");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Reviewed browser grant", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Check setup and practice", exact: true })
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
  await page.getByRole("button", { name: "Start exam", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Start exam", exact: true })
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
    page.getByRole("heading", { name: "Sign in to your exam", exact: true }),
  ).toBeVisible();
});
