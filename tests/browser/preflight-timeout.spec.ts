import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Exam ID", { exact: true }).fill("preflight-limit");
  await page.getByLabel("Username").fill("preflight01");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("Password", { exact: true }).fill("shared-password");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Check setup and practice" }).click();
  await expect(
    page.getByRole("button", { name: "Practice terminal", exact: true }),
  ).toBeEnabled();
}

test("fifteen-minute age ends a connected preflight, closes SSH and practice, then permits a fresh login", async ({
  page,
}) => {
  test.setTimeout(45000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await signIn(page);
  await expect(
    page.getByText(
      "Setup expires after 15 minutes. You can sign in again.",
    ),
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
    page.getByRole("heading", { name: "Setup ended before starting" }),
  ).toBeVisible({ timeout: 15000 });
  await page.locator(".lock-overlay").getByText("Details",{exact:true}).click();
  await expect(page.locator(".lock-overlay")).toContainText("Preflight expired after 15 minutes");
  await expect(page.locator(".lock-overlay")).toContainText(
    "used no exam time",
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
    path: test.info().outputPath("preflight-fifteen-minute-timeout.png"),
    fullPage: true,
  });
  await page
    .locator(".lock-overlay")
    .getByRole("button", { name: "Sign out", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Sign in" }),
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
