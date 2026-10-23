import { test, expect } from "@playwright/test";
import { simulatedMedia, ready } from "./transition-fixture.js";

test("additional grants outside expired defaults support reviewed recovery, multiple-grant management and explicit student selection through fresh Begin", async ({
  page,
}, testInfo) => {
  test.setTimeout(90000);
  page.setDefaultTimeout(10000);
  await page.setViewportSize({ width: 430, height: 1000 });
  await simulatedMedia(page);
  const admin = async () => {
    await page.goto("/admin");
    await page.getByLabel("Username", { exact: true }).fill("instructor");
    await page.getByLabel("Password", { exact: true }).fill("fixture-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByLabel("Selected exam").selectOption("additional-template");
  };
  await admin();
  const dashboard = async () =>
    await (
      await page.request.get("/api/admin/exams/additional-template/dashboard")
    ).json();
  const original = (await dashboard()).students.find(
    (s: any) => s.username === "extra01",
  ).attempts[0];
  expect(original).toMatchObject({
    id: "aaaaaaaa-1234-4234-8234-123456789abc",
    state: "COMPLETED",
    start: expect.any(Number),
    deadline: expect.any(Number),
  });
  expect(original.deadline - original.start).toBe(5400000);
  const from = new Date(Date.now() - 60000).toISOString(),
    until = new Date(Date.now() + 600000).toISOString();
  const draft = async (seconds: string) => {
    await page
      .getByRole("button", {
        name: "Authorize additional attempts",
        exact: true,
      })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Authorize additional attempts",
      exact: true,
    });
    await dialog
      .getByLabel("Additional attempt students", { exact: true })
      .fill("extra01");
    await dialog.getByLabel("Additional allowance seconds").fill(seconds);
    await dialog
      .getByRole("combobox", { name: "Workspace initialization", exact: true })
      .selectOption("empty");
    await dialog.getByLabel("Earliest Begin (RFC3339 with zone)").fill(from);
    await dialog.getByLabel("Latest Begin (RFC3339 with zone)").fill(until);
    await dialog
      .getByLabel("Reason for additional attempt")
      .fill(
        "Explicit additional template allowance after original completed exam",
      );
    await dialog
      .getByRole("button", { name: "Preview additional grants", exact: true })
      .click();
    await expect(dialog).toContainText("Status: REVIEW");
    return dialog;
  };
  let dialog = await draft("5400");
  await expect(dialog).toContainText("90 minutes · Webcam not required");
  await expect(dialog).toContainText("Workspace: Empty workspace");
  const reviewID = await dialog.getByLabel("Saved review ID").inputValue();
  let lost = 0;
  await page.route(
    `**/api/admin/grant-issuance/${reviewID}/confirm`,
    async (route) => {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      lost++;
      await route.abort("failed");
    },
  );
  await dialog
    .getByRole("button", { name: "Confirm additional grants", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Retry confirm", exact: true }),
  ).toBeEnabled();
  await page.reload();
  await page.getByLabel("Selected exam").selectOption("additional-template");
  await page
    .getByRole("button", { name: "Authorize additional attempts", exact: true })
    .click();
  dialog = page.getByRole("dialog", {
    name: "Authorize additional attempts",
    exact: true,
  });
  await dialog.getByLabel("Saved review ID").fill(reviewID);
  await dialog
    .getByRole("button", { name: "Inspect saved review", exact: true })
    .click();
  await expect(dialog).toContainText("Status: CONFIRMED");
  expect(lost).toBe(1);
  const receipt = await (
      await page.request.get(`/api/admin/grant-issuance/${reviewID}`)
    ).json(),
    ninety = receipt.issued[0].grant;
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.unroute(`**/api/admin/grant-issuance/${reviewID}/confirm`);
  dialog = await draft("4500");
  await expect(dialog).toContainText("1 existing unused or pending grants");
  await dialog
    .getByRole("button", { name: "Confirm additional grants", exact: true })
    .click();
  await expect(dialog).toContainText("Status: CONFIRMED");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  const records = (
    await (
      await page.request.get(
        "/api/admin/exams/additional-template/grants?username=extra01",
      )
    ).json()
  ).grants;
  expect(records).toHaveLength(2);
  const other = records.find((g: any) => g.id !== ninety);
  await page
    .getByRole("button", { name: "Actions for student extra01", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Attempt grants…", exact: true })
    .click();
  const grants = page.getByRole("dialog", {
    name: "Attempt grants for extra01",
    exact: true,
  });
  await grants
    .getByRole("combobox", { name: "Saved grant", exact: true })
    .selectOption(other.id);
  await expect(grants).toContainText("Saved allowance: 75 minutes");
  await grants.getByLabel("Allowance seconds", { exact: true }).fill("3600");
  await grants
    .getByRole("combobox", { name: "Workspace initialization", exact: true })
    .selectOption("template");
  await grants.getByLabel("Starter template name", { exact: true }).fill("v1");
  await grants
    .getByLabel("Starter template version", { exact: true })
    .fill("a".repeat(64));
  await grants
    .getByLabel("Reason", { exact: true })
    .fill("Explicit revision of this selected unused additional grant");
  await grants
    .getByRole("button", { name: "Revise unused grant", exact: true })
    .click();
  await expect(grants.getByRole("alert")).toContainText(
    "No authenticated source attestation",
  );
  await expect(
    grants.getByLabel("Starter template name", { exact: true }),
  ).toBeEnabled();
  await expect(grants).toContainText("Saved allowance: 75 minutes");
  await grants
    .getByLabel("Starter template name", { exact: true })
    .fill("sample-exam");
  await grants
    .getByRole("button", { name: "Revise unused grant", exact: true })
    .click();
  await expect(grants).toContainText("Saved allowance: 60 minutes");
  await expect(grants).toContainText(
    `Saved workspace: sample-exam · ${"a".repeat(64)}`,
  );
  await expect(
    grants.getByRole("combobox", { name: "Saved grant", exact: true }),
  ).toHaveValue(other.id);
  await grants
    .getByRole("combobox", { name: "Saved grant", exact: true })
    .selectOption(ninety);
  await expect(grants).toContainText("Saved allowance: 90 minutes");
  expect(
    await grants.evaluate(
      (el) => el.getBoundingClientRect().right <= innerWidth + 1,
    ),
  ).toBe(true);
  await grants
    .getByRole("heading", { name: "Attempt grants for extra01", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath("additional-grants-management-430.png"),
    fullPage: true,
  });
  await grants
    .getByRole("button", { name: "Close grants", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Administration", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
  await page.goto("/");
  await page.getByLabel("Exam ID", { exact: true }).fill("additional-template");
  await page.getByLabel("Enrolled username").fill("extra01");
  await page
    .getByRole("button", { name: "Start SSH sign-in", exact: true })
    .click();
  await page.getByLabel("Shared SSH password").fill("shared-password");
  // SSH authentication, HTTP session completion and destination loading are
  // separate stages. Bound the actual summary response before asserting its
  // controls; the default five-second visibility wait is not a sign-in bound.
  const summaryReady = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/student/exam",
    { timeout: 15000 },
  );
  await page
    .getByRole("button", { name: "Respond to this host", exact: true })
    .click();
  const summaryResponse = await summaryReady;
  expect(summaryResponse.status()).toBe(200);
  const summary = await summaryResponse.json();
  expect(summary.grants.map((grant: any) => grant.id).sort()).toEqual(
    [ninety, other.id].sort(),
  );
  await expect(
    page.getByRole("combobox", { name: "Attempt authorization", exact: true }),
  ).toBeVisible();
  const open = page.getByRole("button", {
    name: "Open preflight & practice",
    exact: true,
  });
  await expect(open).toBeDisabled();
  await page
    .getByRole("combobox", { name: "Attempt authorization", exact: true })
    .selectOption(ninety);
  await expect(open).toBeEnabled();
  await expect(page.locator("main")).toContainText(
    "90 minutes · Webcam: Not required",
  );
  await open.click();
  await expect(
    page.getByRole("button", { name: "Practice terminal", exact: true }),
  ).toBeEnabled();
  const before = (await (await page.request.get("/api/student/exam")).json())
    .attempt;
  expect(before).toMatchObject({
    state: "PREPARING",
    start: null,
    deadline: null,
    grant_id: ninety,
    grant_kind: "ADDITIONAL",
    grant_work: '{"kind":"empty"}',
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
  expect(active).toMatchObject({ state: "ACTIVE", grant_id: ninety });
  expect(active.deadline - active.start).toBe(5400000);
  expect(active.id).not.toBe(original.id);
  await page.getByRole("button", { name: "Finish exam", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Finish exam", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Connect to your exam", exact: true }),
  ).toBeVisible();
  await admin();
  const kept = (await dashboard()).students
    .find((s: any) => s.username === "extra01")
    .attempts.find((a: any) => a.id === original.id);
  for (const key of [
    "id",
    "state",
    "start",
    "deadline",
    "original_deadline",
    "protected",
  ])
    expect(kept[key], key).toEqual(original[key]);
});
