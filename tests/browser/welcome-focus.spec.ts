import { test, expect } from "@playwright/test";

for (const scenario of [
  {
    name: "student exam sign-in",
    path: "/",
    loginOnly: false,
    heading: "Sign in to your exam",
    first: "Exam ID",
    value: "midterm",
    second: "Username",
    secondValue: "student01",
  },
  {
    name: "SSH login test",
    path: "/",
    loginOnly: true,
    heading: "Test your SSH login",
    first: "Username",
    value: "student01",
    second: null,
    secondValue: "",
  },
  {
    name: "instructor sign-in",
    path: "/admin",
    loginOnly: false,
    heading: "Instructor sign-in",
    first: "Username",
    value: "instructor",
    second: "Password",
    secondValue: "synthetic-focus-check",
  },
]) {
  test(`${scenario.name} focuses the first field after loading and accepts immediate typing`, async ({
    page,
  }) => {
    let release!: () => void;
    const configured = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "keyboard", {
        configurable: true,
        value: { lock: async () => {}, unlock: () => {} },
      });
      Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", {
        configurable: true,
        value: async () => {
          throw Error("Capture is not used by this focus test");
        },
      });
    });
    await page.route("**/api/session", (route) =>
      route.fulfill({
        status: 401,
        json: { error: "Authentication required" },
      }),
    );
    await page.route("**/api/login-test", async (route) => {
      await configured;
      await route.fulfill({
        json: {
          loginOnly: scenario.loginOnly,
          jump: "jump.example.edu",
          class: "class.example.edu",
        },
      });
    });
    try {
      await page.goto(scenario.path);
      await expect(page.getByRole("status")).toHaveText("Loading…");
      await expect(page.locator("form input")).toHaveCount(0);
      release();
      await expect(
        page.getByRole("heading", { name: scenario.heading, exact: true }),
      ).toBeVisible();
      const first = page.getByLabel(scenario.first, { exact: true });
      await expect(first).toBeFocused();
      // Deliberately type without selecting a field: load must have placed focus.
      await page.keyboard.insertText(scenario.value);
      await expect(first).toHaveValue(scenario.value);
      await expect(first).toBeFocused();
      if (scenario.second) {
        const second = page.getByLabel(scenario.second, { exact: true });
        await second.focus();
        // Controlled-input updates rerender the form; initial focus must not run again.
        await page.keyboard.insertText(scenario.secondValue);
        await expect(second).toHaveValue(scenario.secondValue);
        await expect(second).toBeFocused();
        await expect(first).toHaveValue(scenario.value);
      } else {
        await expect(page.getByLabel("Exam ID", { exact: true })).toHaveCount(
          0,
        );
      }
    } finally {
      release();
    }
  });
}
