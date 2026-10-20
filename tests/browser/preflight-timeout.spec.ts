import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Exam ID", { exact: true }).fill("preflight-limit");
  await page.getByLabel("Enrolled username").fill("student04");
  await page.getByRole("button", { name: "Start SSH sign-in" }).click();
  await page.getByLabel("Shared SSH password").fill("shared-password");
  await page.getByRole("button", { name: "Respond to this host" }).click();
  await page.getByRole("button", { name: "Open preflight & practice" }).click();
  await expect(
    page.getByRole("button", { name: "Practice terminal", exact: true }),
  ).toBeEnabled();
}

test("five-minute age ends a connected preflight, closes SSH and practice, then permits a fresh login", async ({
  page,
}) => {
  test.setTimeout(45000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await signIn(page);
  await expect(
    page.getByText("Preflight expires after 5 minutes; you can sign in again."),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Practice terminal", exact: true })
    .click();
  await expect(page.locator(".winbox")).toHaveCount(1);
  const old = (await (await page.request.get("/api/student/exam")).json())
    .attempt;
  const session = await (await page.request.get("/api/session")).json();
  expect(
    (
      await page.request.post("/api/fixture/age-preflight", {
        headers: {
          origin: "http://localhost:3100",
          "x-csrf-token": session.csrf,
        },
        data: { id: old.id },
      })
    ).ok(),
  ).toBe(true);
  await expect(
    page.getByRole("heading", { name: "Preflight ended before starting" }),
  ).toBeVisible({ timeout: 15000 });
  await expect(page.locator(".lock-overlay")).toContainText(
    "Preflight expired after 5 minutes",
  );
  await expect(page.locator(".lock-overlay")).toContainText(
    "no exam time was consumed",
  );
  await expect
    .poll(
      async () =>
        (await (await page.request.get("/api/student/exam")).json())
          .sshConnected,
    )
    .toBe(false);
  const ended = (await (await page.request.get("/api/student/exam")).json())
    .attempt;
  expect(ended).toMatchObject({
    state: "CANCELLED_BEFORE_START",
    start: null,
    deadline: null,
  });
  await page.screenshot({
    path: "docs/screenshots/preflight-five-minute-timeout.png",
    fullPage: true,
  });
  await page
    .locator(".lock-overlay")
    .getByRole("button", { name: "Sign out", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Start SSH sign-in" }),
  ).toBeVisible();
  await signIn(page);
  const fresh = (await (await page.request.get("/api/student/exam")).json())
    .attempt;
  expect(fresh.id).not.toBe(old.id);
  expect(fresh).toMatchObject({
    state: "PREPARING",
    start: null,
    deadline: null,
  });
  expect(errors).toEqual([]);
});
