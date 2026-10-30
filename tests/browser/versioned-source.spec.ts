import { test, expect } from "@playwright/test";
import { ready, simulatedMedia, confirmFinish } from "./transition-fixture.js";

test("actual WASM SSH preflight and Begin retain the selected hash with no legacy-purpose fallback", async ({
  page,
}) => {
  test.setTimeout(45000);
  test.skip(
    process.env.EXAM_BROWSER_SSH !== "1",
    "Requires the browser SSH relay fixture",
  );
  await simulatedMedia(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByLabel("Exam ID", { exact: true }).fill("versioned-source");
  await page.getByLabel("Username").fill("version01");
  await page
    .getByRole("button", { name: "Sign in", exact: true })
    .click();
  await page.getByLabel("Shared SSH password").fill("shared-password");
  await page
    .getByRole("button", { name: "Continue", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Check setup and practice", exact: true })
    .click();
  await ready(page);
  await page
    .getByRole("button", { name: "Practice terminal", exact: true })
    .click();
  await expect(page.locator(".winbox")).toHaveCount(1);
  const read = async () =>
    (await (await page.request.get("/api/student/exam")).json()).attempt;
  const before = await read();
  expect(before.start).toBeNull();
  expect(JSON.parse(before.settings).template_version).toBe("a".repeat(64));
  await page.getByRole("button", { name: "Start exam", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Start exam", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Finish exam", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".winbox")).toHaveCount(1);
  const active = await read();
  expect(active).toMatchObject({
    id: before.id,
    state: "ACTIVE",
    settings: before.settings,
  });
  expect(active.deadline - active.start).toBe(5400000);
  await confirmFinish(page);
  await expect(
    page.getByRole("heading", { name: "Sign in to your exam", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
