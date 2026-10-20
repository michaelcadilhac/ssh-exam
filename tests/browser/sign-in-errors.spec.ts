import { test, expect } from "@playwright/test";

test("DePaul number matching requires an explicit phone approval acknowledgment and sends an empty Code response", async ({
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
  const answers: string[][] = [];
  await page.routeWebSocket("**/api/auth/dialogue", (ws) => {
    ws.onMessage((raw) => {
      const m = JSON.parse(String(raw));
      if (m.type === "start")
        ws.send(
          JSON.stringify({
            type: "challenge",
            host: "sshjump.depaul.edu",
            instruction: "Please enter your password.",
            round: "password",
            prompts: [{ prompt: "Shared SSH password", echo: false }],
          }),
        );
      if (m.type === "answers") {
        answers.push(m.answers);
        if (m.round === "password")
          ws.send(
            JSON.stringify({
              type: "challenge",
              host: "sshjump.depaul.edu",
              instruction:
                "Open your Authenticator app, and enter the number '59' to sign in.",
              round: "phone",
              prompts: [{ prompt: "Code:", echo: false }],
            }),
          );
      }
    });
  });
  await page.goto("/");
  await page.getByLabel("Exam ID", { exact: true }).fill("test");
  await page.getByLabel("Enrolled username", { exact: true }).fill("student01");
  await page
    .getByRole("button", { name: "Start SSH sign-in", exact: true })
    .click();
  await page
    .getByLabel("Shared SSH password", { exact: true })
    .fill("fixture-secret");
  await page
    .getByRole("button", { name: "Respond to this host", exact: true })
    .click();
  const approve = page.getByRole("button", {
    name: "Continue after phone approval",
    exact: true,
  });
  await expect(approve).toBeEnabled();
  await expect(page.getByLabel("Code:", { exact: true })).toHaveCount(0);
  expect(answers).toEqual([["fixture-secret"]]);
  await approve.click();
  await expect.poll(() => answers.length).toBe(2);
  expect(answers[1]).toEqual([""]);
  await expect(
    page.getByRole("button", { name: "Waiting for host…", exact: true }),
  ).toBeDisabled();
  await expect(page.locator("body")).not.toContainText("fixture-secret");
});
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

for (const explicit of [true, false]) {
  test(`failed sign-in preserves escaped host details, clears answers, and clears details on retry (${explicit ? "error" : "disconnect"})`, async ({
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
    let starts = 0;
    await page.routeWebSocket("**/api/auth/dialogue", (ws) => {
      ws.onMessage((raw) => {
        const message = JSON.parse(String(raw));
        if (message.type === "start") {
          starts++;
          ws.send(
            JSON.stringify({
              type: "challenge",
              host: "jump.example.edu",
              instruction: starts === 1 ? "Initial host notice" : "Fresh login",
              round: `password-${starts}`,
              prompts: [{ prompt: "Shared SSH password", echo: false }],
            }),
          );
        } else if (message.type === "answers") {
          ws.send(
            JSON.stringify({
              type: "notice",
              host: "jump.example.edu",
              instruction:
                "AADSTS90055: TenantThrottlingError <script>unsafe</script>",
              round: "failure-notice",
              prompts: [],
            }),
          );
          if (explicit)
            ws.send(
              JSON.stringify({
                type: "error",
                error: "SSH sign-in failed. No new exam was started.",
              }),
            );
          ws.close();
        }
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
    await page
      .getByLabel("Shared SSH password", { exact: true })
      .fill("test-secret-must-disappear");
    await page
      .getByRole("button", { name: "Respond to this host", exact: true })
      .click();
    const alert = page.getByRole("alert");
    await expect(alert).toBeVisible();
    const details = alert.getByLabel("SSH sign-in details", { exact: true });
    await expect(details).not.toBeVisible();
    await alert.getByText("SSH sign-in details", { exact: true }).click();
    await expect(details).toContainText(
      "AADSTS90055: TenantThrottlingError <script>unsafe</script>",
    );
    await expect(alert).toContainText("jump.example.edu");
    await expect(details.locator("script")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(
      "test-secret-must-disappear",
    );
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    await page.setViewportSize({ width: 420, height: 900 });
    expect(await alert.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
      true,
    );
    if (explicit) {
      await alert.getByRole("button", { name: "Dismiss", exact: true }).click();
      await expect(
        page.getByLabel("SSH sign-in details", { exact: true }),
      ).toHaveCount(0);
    }
    await page
      .getByRole("button", { name: "Start SSH sign-in", exact: true })
      .click();
    await expect(
      page.getByLabel("Shared SSH password", { exact: true }),
    ).toHaveValue("");
    await expect(
      page.getByLabel("SSH sign-in details", { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByLabel("Host authentication messages", { exact: true }),
    ).toHaveText("Fresh login");
    await page.keyboard.press("Escape");
    await expect(
      page.getByLabel("Host authentication messages", { exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);
  });
}
