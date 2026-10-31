import { test, expect } from "@playwright/test";

for (const width of [1280, 430])
  test(`DePaul number matching explains password wait and phone approval at ${width}px without automatic answers`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
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
    const banner = Array(12)
      .fill(
        "Synthetic university notice: this system is for authorized course work and activity is monitored. Keep your account details private.",
      )
      .join(" ");
    let showPhone: (() => void) | undefined;
    await page.routeWebSocket("**/api/auth/dialogue", (ws) => {
      ws.onMessage((raw) => {
        const m = JSON.parse(String(raw));
        if (m.type === "start")
          ws.send(
            JSON.stringify({
              type: "challenge",
              host: "sshjump.depaul.edu",
              instruction: `${banner}\n\nPlease enter your password.`,
              round: "password",
              prompts: [{ prompt: "Shared SSH password", echo: false }],
            }),
          );
        if (m.type === "answers") {
          answers.push(m.answers);
          if (m.round === "password")
            showPhone = () =>
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
    await page.getByLabel("Username", { exact: true }).fill("student01");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page
      .getByLabel("Shared SSH password", { exact: true })
      .fill("fixture-secret");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect.poll(() => !!showPhone).toBe(true);
    const progress = page.getByText(
      "Password sent. Waiting for the next sign-in step…",
      { exact: true },
    );
    await expect(progress).toBeVisible();
    await expect(progress).toBeInViewport();
    await expect(progress).toHaveAttribute("role", "status");
    await expect(
      page.getByLabel("Shared SSH password", { exact: true }),
    ).toHaveValue("");
    await expect(
      page.getByText(
        "Keep this page open. The number for your phone app may take a moment to appear.",
        { exact: true },
      ),
    ).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath(`password-wait-${width}.png`),
    });
    expect(answers).toEqual([["fixture-secret"]]);
    showPhone!();
    const approve = page.getByRole("button", {
      name: "I approved on my phone",
      exact: true,
    });
    await expect(
      page.getByRole("heading", {
        name: "Approve sign-in on your phone",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByLabel("Number for your Authenticator app", { exact: true }),
    ).toHaveText("59");
    await expect(
      page.getByLabel("Number for your Authenticator app", { exact: true }),
    ).toBeInViewport();
    await expect(approve).toBeInViewport();
    await expect(approve).toHaveCount(1);
    await expect(
      page.getByLabel("Host authentication messages", { exact: true }),
    ).toContainText(banner);
    await expect(
      page.getByText(
        "Enter this number in your Authenticator app on your phone, then approve sign-in.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(approve).toBeEnabled();
    await expect(page.getByLabel("Code:", { exact: true })).toHaveCount(0);
    expect(answers).toEqual([["fixture-secret"]]);
    await page.screenshot({
      path: test.info().outputPath(`phone-approval-${width}.png`),
    });
    await approve.click();
    await expect.poll(() => answers.length).toBe(2);
    expect(answers[1]).toEqual([""]);
    await expect(
      page.getByText("Waiting for sign-in confirmation…", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Waiting for server…", exact: true }),
    ).toBeDisabled();
    await expect(page.locator("body")).not.toContainText("fixture-secret");
  });
test("a genuine one-time password still requires its code and never claims phone approval", async ({
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
            instruction: "Enter your six-digit verification code.",
            round: "otp",
            prompts: [{ prompt: "One-time password:", echo: false }],
          }),
        );
      if (m.type === "answers") answers.push(m.answers);
    });
  });
  await page.goto("/");
  await page.getByLabel("Exam ID", { exact: true }).fill("test");
  await page.getByLabel("Username", { exact: true }).fill("student01");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "I approved on my phone", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByLabel("Number for your Authenticator app", { exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("One-time password:", { exact: true }).fill("123456");
  expect(answers).toEqual([]);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect.poll(() => answers).toEqual([["123456"]]);
  await expect(
    page.getByText("Waiting for sign-in confirmation…", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(/Password sent|number for your phone app/),
  ).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("123456");
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
    await page.getByLabel("Username", { exact: true }).fill("student01");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    const alert = page.getByRole("alert");
    await expect(alert).toContainText(
      explicit ? "SSH sign-in succeeded" : "Sign-in did not finish",
    );
    await expect(alert).toContainText(
      explicit ? "No new exam was started" : "No new attempt was started",
    );
    await expect(page.getByLabel("Exam ID", { exact: true })).toHaveValue(
      "test",
    );
    await expect(page.getByLabel("Username", { exact: true })).toHaveValue(
      "student01",
    );
    await expect(
      page.getByRole("button", { name: "Sign in", exact: true }),
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
    await page.getByLabel("Username", { exact: true }).fill("student01");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page
      .getByLabel("Shared SSH password", { exact: true })
      .fill("test-secret-must-disappear");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
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
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
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
