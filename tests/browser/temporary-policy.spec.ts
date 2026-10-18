import { test, expect } from "@playwright/test";
import {
  fixture,
  openPreflight,
  ready,
  resetScreens,
  onlyScreens,
} from "./transition-fixture.js";

test("secure access explains fresh SSH and returns directly to sign-in without starting the clock", async ({
  page,
}) => {
  const f = await fixture(page);
  f.model.preflight = async (route) =>
    route.fulfill({
      json: {
        ...f.reservation(),
        requiresSecureAccess: true,
        username: "transition",
      },
    });
  await page.route("**/api/student/attempts/*/begin", (route) =>
    route.fulfill({
      json: { requiresReauthentication: true, ...f.snapshot() },
    }),
  );
  let detached = false;
  await page.route(
    "**/api/student/attempts/*/secure-access-reauth",
    async (route) => {
      detached = true;
      await route.fulfill({ json: { ok: true } });
    },
  );
  await openPreflight(page, f);
  await ready(page);
  await page
    .getByRole("button", { name: "Secure exam access", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(
    "sign in to SSH again before the exam clock starts",
  );
  await expect(dialog).toContainText("five minutes");
  await resetScreens(page);
  await dialog
    .getByRole("button", { name: "Secure exam access", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Connect to your exam" }),
  ).toBeVisible();
  await expect(page.getByRole("status")).toContainText(
    "Your exam clock has not started",
  );
  expect(detached).toBe(true);
  expect(f.model.attempt.start).toBeNull();
  await onlyScreens(page, [
    "Secure exam access?",
    "preflight",
    "Connect to your exam",
  ]);
});

// This uses the SSH fixture and HTTP routes rather than mocked transition replies.
test("student completes temporary access setup and fresh SSH before the original exam clock starts", async ({
  page,
}) => {
  test.setTimeout(45000);
  const { simulatedMedia } = await import("./transition-fixture.js");
  await simulatedMedia(page);
  await page.goto("/");
  await page.getByLabel("Exam ID", { exact: true }).fill("temporary-access");
  await page.getByLabel("Enrolled username").fill("policytest01");
  const signIn = async () => {
    await page
      .getByRole("button", { name: "Start SSH sign-in", exact: true })
      .click();
    await page.getByLabel("Shared SSH password").fill("shared-password");
    await page
      .getByRole("button", { name: "Respond to this host", exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Open preflight & practice",
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Open preflight & practice", exact: true })
      .click();
    await ready(page);
  };
  await signIn();
  const initial = (await (await page.request.get("/api/student/exam")).json())
    .attempt;
  expect(initial.start).toBeNull();
  await page
    .getByRole("button", { name: "Secure exam access", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Secure exam access", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Connect to your exam", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("status")).toContainText(
    "Your exam clock has not started",
  );
  const setup = (await (await page.request.get("/api/student/exam")).json())
    .attempt;
  expect(setup.start).toBeNull();
  expect(setup.deadline).toBeNull();
  expect(setup.policy_state).toBe("READY");
  await signIn();
  await expect(
    page.getByRole("button", { name: "Secure exam access", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Begin exam", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Begin exam", exact: true })
    .click();
  await expect(page.locator(".winbox")).toHaveCount(1);
  const active = (await (await page.request.get("/api/student/exam")).json())
    .attempt;
  expect(active.id).toBe(initial.id);
  expect(active.state).toBe("ACTIVE");
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
