import { test, expect, type Page } from "@playwright/test";
import { simulatedMedia, ready } from "./transition-fixture.js";
async function login(page: Page, username: string) {
  await page.goto("/");
  await page.getByLabel("Exam ID", { exact: true }).fill("sandbox");
  await page.getByLabel("Enrolled username").fill(username);
  await page.getByRole("button", { name: "Start SSH sign-in" }).click();
  await page.getByLabel("Shared SSH password").fill("shared-password");
  await page.getByRole("button", { name: "Respond to this host" }).click();
  await page.getByRole("button", { name: "Open preflight & practice" }).click();
  await expect(
    page.getByRole("button", { name: "Practice terminal", exact: true }),
  ).toBeEnabled();
}
async function command(page: Page, text: string) {
  await page
    .locator(".winbox")
    .last()
    .locator(".xterm-helper-textarea")
    .focus();
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
}
async function start(page: Page) {
  await ready(page);
  await page.getByRole("button", { name: "Begin exam", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Begin exam", exact: true })
    .click();
  await expect(page.locator(".winbox")).toHaveCount(1);
}
test("real SSH shells can exit repeatedly, close one pane, log out, log back in and finish without stale sessions", async ({
  page,
}) => {
  test.setTimeout(60000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await simulatedMedia(page);
  await login(page, "student09");
  for (let i = 0; i < 6; i++) {
    await page
      .getByRole("button", { name: "Practice terminal", exact: true })
      .click();
    await expect(page.locator(".winbox")).toHaveCount(1);
    await command(page, "exit");
    await expect(page.locator(".winbox")).toHaveCount(0);
  }
  await page
    .getByRole("button", { name: "Practice terminal", exact: true })
    .click();
  await expect(page.locator(".winbox")).toHaveCount(1);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Sign out", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Connect to your exam" }),
  ).toBeVisible();
  expect((await page.request.get("/api/session")).status()).toBe(401);
  await login(page, "student09");
  await start(page);
  await page.getByRole("button", { name: "New terminal", exact: true }).click();
  await expect(page.locator(".winbox")).toHaveCount(2);
  await page.getByRole("button", { name: "Arrange terminals" }).click();
  await page.locator(".winbox").first().locator(".wb-close").click();
  await page
    .getByRole("button", { name: "Close terminal", exact: true })
    .click();
  await expect(page.locator(".winbox")).toHaveCount(1);
  await command(page, "pwd");
  await expect(page.locator(".xterm-rows")).toContainText("/work");
  expect(
    (await (await page.request.get("/api/student/exam")).json()).sshConnected,
  ).toBe(true);
  await page.getByRole("button", { name: "Finish exam", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Finish exam", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Connect to your exam" }),
  ).toBeVisible();
  await expect(page.locator(".winbox")).toHaveCount(0);
  expect((await page.request.get("/api/session")).status()).toBe(401);
  expect(errors).toEqual([]);
});
test("direct logout with active SSH panes pauses the attempt and preserves its deadline", async ({
  page,
  request,
}) => {
  await simulatedMedia(page);
  await login(page, "student10");
  await start(page);
  await page.getByRole("button", { name: "New terminal", exact: true }).click();
  await expect(page.locator(".winbox")).toHaveCount(2);
  const session = await (await page.request.get("/api/session")).json();
  const before = (await (await page.request.get("/api/student/exam")).json())
    .attempt;
  const logout = await page.request.post("/api/logout", {
    headers: { origin: "http://localhost:3100", "x-csrf-token": session.csrf },
    data: {},
  });
  expect(logout.ok()).toBe(true);
  expect((await page.request.get("/api/session")).status()).toBe(401);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Connect to your exam" }),
  ).toBeVisible();
  const admin = await request.post("/api/admin/login", {
    headers: { origin: "http://localhost:3100" },
    data: { username: "instructor", password: "fixture-password" },
  });
  expect(admin.ok()).toBe(true);
  const attempts = await (await request.get("/api/admin/attempts")).json();
  expect(attempts.attempts.find((a: any) => a.id === before.id)).toMatchObject({
    state: "LOCKED",
    deadline: before.deadline,
    original_deadline: before.original_deadline,
  });
  expect((await request.get("/health/live")).ok()).toBe(true);
});
