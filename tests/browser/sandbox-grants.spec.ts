import { instructorSignIn } from "./prof-workflow-fixture.js";
import { test, expect } from "@playwright/test";
import {
  additionalDraft,
  manageStudent,
  cancelUnused,
} from "./prof-workflow-fixture.js";
import { simulatedMedia, ready } from "./transition-fixture.js";

test("saved practice grants support cancellation, explicit revocation/new review and separate full repeat attempts through WASM SSH", async ({
  page,
}, testInfo) => {
  test.setTimeout(120000);
  page.setDefaultTimeout(10000);
  await page.setViewportSize({ width: 430, height: 1000 });
  await simulatedMedia(page);
  const student = async () => {
    await page.goto("/");
    await page.getByLabel("Exam ID", { exact: true }).fill("sandbox");
    await page.getByLabel("Username").fill("practice01");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByLabel("Shared SSH password").fill("shared-password");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "sandbox", exact: true }),
    ).toBeVisible();
  };
  const admin = async () => {
    await instructorSignIn(page, "prof_practice");
    await page.getByLabel("Selected exam").selectOption("sandbox");
  };
  const adminOut = async () => {
    await page
      .getByRole("button", { name: "Administration", exact: true })
      .click();
    await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
  };
  const portal = async () =>
    (await page.request.get("/api/student/exam")).json();
  const preflight = async () => {
    await page
      .getByRole("button", { name: "Check setup and practice", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Practice terminal", exact: true }),
    ).toBeEnabled();
    return (await portal()).attempt;
  };
  const begin = async () => {
    await ready(page);
    await page.getByRole("button", { name: "Start exam", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Start exam", exact: true })
      .click();
    await expect(page.locator(".winbox")).toHaveCount(1);
    return (await portal()).attempt;
  };
  const finish = async () => {
    await page
      .getByRole("button", { name: "Finish exam", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Finish exam", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Sign in to your exam", exact: true }),
    ).toBeVisible();
  };
  await student();
  expect((await portal()).grants).toHaveLength(0);
  const abandoned = await preflight();
  expect(abandoned).toMatchObject({
    grant_kind: "PRACTICE",
    start: null,
    deadline: null,
    grant_id: expect.any(String),
  });
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Sign out", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Sign in to your exam", exact: true }),
  ).toBeVisible();
  await admin();
  let dialog = await manageStudent(page, "practice01");
  await expect(dialog).toContainText("5 min");
  await cancelUnused(dialog);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await adminOut();
  await student();
  await expect(page.locator("main")).toContainText(
    "Your unused practice grant is expired or revoked",
  );
  await expect(
    page.getByRole("button", {
      name: "Check setup and practice",
      exact: true,
    }),
  ).toBeDisabled();
  expect((await portal()).practice_blocked).toMatchObject({
    id: abandoned.grant_id,
    status: "REVOKED",
  });
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await admin();
  dialog = await additionalDraft(page, ["practice01"], "", "materials");
  await expect(dialog).toContainText(
    "Five minutes · Webcam optional · Four terminals",
  );
  await expect(
    dialog.getByLabel("Time limit (minutes)", { exact: true }),
  ).toHaveCount(0);
  await dialog.getByRole("button", { name: "Review", exact: true }).click();
  await expect(dialog).toContainText("5 min · Webcam optional");
  expect(
    await dialog.evaluate(
      (el) => el.getBoundingClientRect().right <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("practice-grant-review-430.png"),
    fullPage: true,
  });
  await dialog
    .getByRole("button", { name: "Allow attempt", exact: true })
    .click();
  await expect(dialog).toContainText("Attempt allowed");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await adminOut();
  await student();
  const prepared = await preflight();
  expect(prepared.grant_id).not.toBe(abandoned.grant_id);
  const first = await begin();
  expect(first.deadline - first.start).toBe(300000);
  expect(first.original_deadline).toBe(first.deadline);
  await finish();
  await student();
  const repeated = await preflight();
  expect(repeated.id).not.toBe(first.id);
  expect(repeated.grant_id).not.toBe(first.grant_id);
  const second = await begin();
  expect(second.deadline - second.start).toBe(300000);
  await finish();
  await admin();
  const grants = (
    await (
      await page.request.get(
        "/api/admin/exams/sandbox/grants?username=practice01",
      )
    ).json()
  ).grants;
  expect(grants).toHaveLength(3);
  expect(grants.map((g: any) => g.issuance)).toEqual([
    "PRACTICE",
    "PRACTICE",
    "PRACTICE",
  ]);
  expect(grants.find((g: any) => g.id === abandoned.grant_id).status).toBe(
    "REVOKED",
  );
  const records = (
    await (await page.request.get("/api/admin/exams/sandbox/dashboard")).json()
  ).students.find((s: any) => s.username === "practice01").attempts;
  expect(records).toHaveLength(2);
  for (const saved of [first, second])
    expect(records.find((a: any) => a.id === saved.id)).toMatchObject({
      state: "COMPLETED",
      protected: 1,
      start: saved.start,
      deadline: saved.deadline,
      original_deadline: saved.original_deadline,
    });
});
