import { test, expect } from "@playwright/test";
for (const explicit of [true, false]) {
  test(`sign-in keeps a visible ${explicit ? "admission error" : "unexpected-disconnection error"} after the socket closes`, async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "keyboard", {
        configurable: true,
        value: { lock: async () => {}, unlock: () => {} },
      });
      Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", {
        configurable: true,
        value: async () => {
          throw Error("Not used");
        },
      });
    });
    await page.route("**/api/session", (r) =>
      r.fulfill({ status: 401, json: { error: "Authentication required" } }),
    );
    await page.route("**/api/login-test", (r) =>
      r.fulfill({ json: { loginOnly: false } }),
    );
    await page.route("**/api/auth/start", (r) =>
      r.fulfill({ json: { ok: true } }),
    );
    await page.routeWebSocket("**/api/auth/dialogue", (ws) => {
      ws.onMessage(() => {
        if (explicit)
          ws.send(
            JSON.stringify({
              type: "error",
              error:
                "SSH sign-in succeeded, but the exam server could not admit this account. Contact your instructor to check the account’s exam-server setup. No new exam was started.",
            }),
          );
        ws.close();
      });
    });
    await page.goto("/");
    await page.getByLabel("Exam ID", { exact: true }).fill("test");
    await page
      .getByLabel("Enrolled username", { exact: true })
      .fill("student01");
    await page
      .getByRole("button", { name: "Start SSH sign-in", exact: true })
      .click();
    const alert = page.getByRole("alert");
    await expect(alert).toContainText(
      explicit
        ? "SSH sign-in succeeded"
        : "connection closed before exam sign-in completed",
    );
    await expect(alert).toContainText("No new exam was started");
    await expect(page.getByLabel("Exam ID", { exact: true })).toHaveValue(
      "test",
    );
    await expect(
      page.getByLabel("Enrolled username", { exact: true }),
    ).toHaveValue("student01");
    await expect(
      page.getByRole("button", { name: "Start SSH sign-in", exact: true }),
    ).toBeEnabled();
  });
}
