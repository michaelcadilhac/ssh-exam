import { test, expect } from "@playwright/test";

const message =
  "The exam website is temporarily unavailable. Please try again shortly. If your exam was already running, its countdown continues.";

for (const instructor of [false, true]) {
  test(`${instructor ? "instructor" : "student"} sign-in displays retryable maintenance without starting an exam`, async ({
    page,
  }) => {
    let calls = 0;
    let otherMutation = 0;
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "keyboard", {
        configurable: true,
        value: { lock: async () => {}, unlock() {} },
      });
      Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", {
        configurable: true,
        value: async () => {
          throw Error("Capture is not used");
        },
      });
    });
    await page.route("**/api/session", (route) =>
      route.fulfill({
        status: 401,
        json: { error: "Authentication required" },
      }),
    );
    await page.route("**/api/login-test", (route) =>
      route.fulfill({ json: { loginOnly: false } }),
    );
    await page.route(
      `**/api/${instructor ? "admin/login" : "auth/start"}`,
      (route) => {
        calls++;
        return route.fulfill({
          status: 503,
          headers: { "Retry-After": "60", "Cache-Control": "no-store" },
          json: { error: message, code: "SERVICE_UNAVAILABLE" },
        });
      },
    );
    page.on("request", (request) => {
      if (/\/api\/student\//.test(request.url()) && request.method() === "POST")
        otherMutation++;
    });
    await page.goto(instructor ? "/admin" : "/");
    if (!instructor)
      await page
        .getByLabel("Exam ID", { exact: true })
        .fill("synthetic-maintenance");
    await page
      .getByLabel("Username", { exact: true })
      .fill("synthetic-maintenance");
    if (instructor)
      await page
        .getByLabel("Password", { exact: true })
        .fill("synthetic-not-a-secret");
    await page
      .getByRole("button", { name: "Sign in", exact: true })
      .click({ timeout: 3000 });
    await expect(page.getByRole("alert")).toContainText(message);
    await expect(
      page.getByRole("button", { name: "Sign in", exact: true }),
    ).toBeEnabled();
    expect(calls).toBe(1);
    expect(otherMutation).toBe(0);
    await expect(
      page.getByRole("heading", { name: "Check your setup", exact: true }),
    ).toHaveCount(0);
  });
}
