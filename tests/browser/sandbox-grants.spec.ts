import { test, expect } from "@playwright/test";
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
    await page.getByLabel("Enrolled username").fill("practice01");
    await page
      .getByRole("button", { name: "Start SSH sign-in", exact: true })
      .click();
    await page.getByLabel("Shared SSH password").fill("shared-password");
    await page
      .getByRole("button", { name: "Respond to this host", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "sandbox", exact: true }),
    ).toBeVisible();
  };
  const admin = async () => {
    await page.goto("/admin");
    await page.getByLabel("Username", { exact: true }).fill("instructor");
    await page.getByLabel("Password", { exact: true }).fill("fixture-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
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
      .getByRole("button", { name: "Open preflight & practice", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Practice terminal", exact: true }),
    ).toBeEnabled();
    return (await portal()).attempt;
  };
  const begin = async () => {
    await ready(page);
    await page.getByRole("button", { name: "Begin exam", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Begin exam", exact: true })
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
      page.getByRole("heading", { name: "Connect to your exam", exact: true }),
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
    page.getByRole("heading", { name: "Connect to your exam", exact: true }),
  ).toBeVisible();
  await admin();
  await page
    .getByRole("button", {
      name: "Actions for student practice01",
      exact: true,
    })
    .click();
  await page
    .getByRole("menuitem", { name: "Attempt grants…", exact: true })
    .click();
  let dialog = page.getByRole("dialog", {
    name: "Attempt grants for practice01",
    exact: true,
  });
  await expect(dialog).toContainText("Saved allowance: 5 minutes");
  await dialog
    .getByLabel("Reason", { exact: true })
    .fill("Explicit withdrawal of unused practice after logout");
  await dialog
    .getByRole("button", { name: "Revoke unused grant", exact: true })
    .click();
  await expect(dialog).toContainText("REVOKED");
  await dialog
    .getByRole("button", { name: "Close grants", exact: true })
    .click();
  await adminOut();
  await student();
  await expect(page.locator("main")).toContainText(
    "Your unused practice grant is expired or revoked",
  );
  await expect(
    page.getByRole("button", {
      name: "Open preflight & practice",
      exact: true,
    }),
  ).toBeDisabled();
  expect((await portal()).practice_blocked).toMatchObject({
    id: abandoned.grant_id,
    status: "REVOKED",
  });
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await admin();
  await page
    .getByRole("button", { name: "Authorize practice grant", exact: true })
    .click();
  dialog = page.getByRole("dialog", {
    name: "Authorize practice grant",
    exact: true,
  });
  await dialog
    .getByLabel("Additional attempt students", { exact: true })
    .fill("practice01");
  await expect(dialog.getByLabel("Additional allowance seconds")).toHaveValue(
    "300",
  );
  await expect(
    dialog.getByLabel("Additional allowance seconds"),
  ).toHaveAttribute("readonly", "");
  await dialog
    .getByLabel("Earliest Begin (RFC3339 with zone)")
    .fill(new Date(Date.now() - 60000).toISOString());
  await dialog
    .getByLabel("Latest Begin (RFC3339 with zone)")
    .fill(new Date(Date.now() + 600000).toISOString());
  await dialog
    .getByLabel("Reason for additional attempt")
    .fill("Reviewed NEW finite practice grant after revocation");
  await dialog
    .getByRole("button", { name: "Preview practice grant", exact: true })
    .click();
  await expect(dialog).toContainText("5 minutes · Webcam not required");
  expect(
    await dialog.evaluate(
      (el) => el.getBoundingClientRect().right <= innerWidth + 1,
    ),
  ).toBe(true);
  await dialog
    .getByRole("heading", { name: "Authorize practice grant", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath("practice-grant-review-430.png"),
    fullPage: true,
  });
  await dialog
    .getByRole("button", { name: "Confirm practice grant", exact: true })
    .click();
  await expect(dialog).toContainText("Status: CONFIRMED");
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
