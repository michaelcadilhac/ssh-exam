import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  begin,
  fixture,
  readyTerminal,
  simulatedMedia,
} from "./transition-fixture.js";

const blue = "rgb(0, 61, 165)",
  navy = "rgb(0, 32, 91)",
  white = "rgb(255, 255, 255)";

async function contrast(element: Locator, minimum = 4.5) {
  const colors = await element.evaluate((el) => {
    const foreground = getComputedStyle(el).color;
    let ancestor: Element | null = el;
    let background = "rgba(0, 0, 0, 0)";
    while (ancestor) {
      background = getComputedStyle(ancestor).backgroundColor;
      if (background !== "rgba(0, 0, 0, 0)" && background !== "transparent")
        break;
      ancestor = ancestor.parentElement;
    }
    return { foreground, background };
  });
  const luminance = (color: string) => {
    const channels = color
      .match(/[\d.]+/g)!
      .slice(0, 3)
      .map(Number)
      .map((c) => {
        const s = c / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const a = luminance(colors.foreground),
    b = luminance(colors.background);
  expect(
    (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
    JSON.stringify(colors),
  ).toBeGreaterThanOrEqual(minimum);
}

async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}

for (const width of [430, 1280]) {
  test(`DePaul sign-in uses light surfaces, blue actions and visible focus at ${width}px`, async ({
    page,
  }, info) => {
    page.setDefaultTimeout(6000);
    await page.setViewportSize({ width, height: 900 });
    await simulatedMedia(page);
    await page.route("**/api/session", (route) =>
      route.fulfill({
        status: 401,
        json: { error: "Authentication required" },
      }),
    );
    await page.route("**/api/login-test", (route) =>
      route.fulfill({ json: { loginOnly: false, browserSSH: false } }),
    );
    await page.goto("/");
    const exam = page.getByLabel("Exam ID", { exact: true });
    await expect(exam).toBeFocused();
    await expect(page.locator("html")).toHaveCSS("background-color", white);
    await expect(
      page.getByRole("heading", { name: "Sign in to your exam", exact: true }),
    ).toHaveCSS("color", navy);
    await expect(exam).toHaveCSS("outline-color", blue);
    await contrast(exam);
    await exam.fill("theme-exam");
    await page.getByLabel("Username", { exact: true }).fill("theme_student");
    const signIn = page.getByRole("button", { name: "Sign in", exact: true });
    await expect(signIn).toBeEnabled();
    await expect(signIn).toHaveCSS("background-color", blue);
    await expect(signIn).toHaveCSS("color", white);
    await contrast(signIn);
    await signIn.hover();
    await expect(signIn).toHaveCSS("background-color", "rgb(39, 87, 195)");
    await contrast(signIn);
    await noOverflow(page);
    await page.screenshot({
      path: info.outputPath("depaul-welcome.png"),
      fullPage: true,
    });
  });

  test(`DePaul instructor cells and cancellation use readable light controls at ${width}px`, async ({
    page,
  }, info) => {
    page.setDefaultTimeout(6000);
    await page.setViewportSize({ width, height: 900 });
    const now = Date.now(),
      settings = {
        id: "theme-exam",
        name: "Midterm",
        duration: 5400,
        webcam: false,
        terminals: 4,
        template: "sample-exam",
        template_version: "a".repeat(64),
        collection_file_mib: 128,
        collection_total_mib: 512,
        earliest: now - 60000,
        latest: now + 3600000,
      };
    const grant = {
      id: "11111111-1111-4111-8111-111111111111",
      username: "amy",
      exam: settings.id,
      settings,
      revision: 1,
      status: "AVAILABLE",
      claims: [],
      issuance: "ENROLLMENT",
      issuance_order: 1,
      issued_at: now,
      work: { kind: "template", name: "sample-exam", hash: "a".repeat(64) },
    };
    await page.routeWebSocket("**/api/admin/events", () => {});
    await page.route("**/api/**", (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/session")
        return route.fulfill({
          json: { role: "admin", username: "theme_prof", csrf: "fixture" },
        });
      if (path === "/api/login-test")
        return route.fulfill({ json: { loginOnly: false, browserSSH: false } });
      if (path === "/api/admin/exams")
        return route.fulfill({
          json: [{ ...settings, revision: "b".repeat(64) }],
        });
      if (path.endsWith("/dashboard"))
        return route.fulfill({
          json: {
            serverNow: now,
            total: 1,
            counts: { students: 1 },
            incidents: [],
            students: [
              {
                username: "amy",
                removable: false,
                hasNextAttempt: true,
                latestSettings: settings,
                enrollment: { duration: null, webcam: null },
                unusedAttempt: grant,
                attempts: [],
              },
            ],
          },
        });
      if (path.endsWith("/grants/status"))
        return route.fulfill({
          json: {
            rows: [
              {
                id: grant.id,
                revision: 1,
                current_revision: 1,
                grant_status: "AVAILABLE",
                status: "NOT_QUEUED",
                grant,
              },
            ],
          },
        });
      if (path.endsWith("/grants"))
        return route.fulfill({ json: { grants: [grant], next: null } });
      return route.fulfill({ json: {} });
    });
    await page.goto("/admin");
    await page
      .getByLabel("Selected exam", { exact: true })
      .selectOption(settings.id);
    await page
      .getByRole("button", { name: "Change webcam for amy", exact: true })
      .click();
    const editor = page.getByRole("region", {
      name: "Webcam for amy",
      exact: true,
    });
    const webcam = editor.getByRole("combobox", {
      name: "Webcam",
      exact: true,
    });
    await expect(webcam).toHaveValue("false");
    await contrast(webcam);
    await webcam.focus();
    await expect(webcam).toHaveCSS("outline-color", blue);
    const save = editor.getByRole("button", { name: "Save", exact: true });
    await expect(save).toHaveCSS("background-color", blue);
    await contrast(save);
    await noOverflow(page);
    await page.screenshot({
      path: info.outputPath("depaul-admin-inline.png"),
      fullPage: true,
    });
    await editor.getByRole("button", { name: "Cancel", exact: true }).click();
    await page
      .getByRole("button", { name: "Cancel next attempt for amy", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Cancel next attempt for amy?",
      exact: true,
    });
    await expect(dialog).toHaveCSS("background-color", white);
    const cancel = dialog.getByRole("button", {
      name: "Cancel attempt",
      exact: true,
    });
    await expect(cancel).toHaveCSS("color", "rgb(206, 17, 45)");
    await contrast(cancel);
    await contrast(dialog.getByRole("heading"));
    await noOverflow(page);
    await page.screenshot({
      path: info.outputPath("depaul-admin-cancel.png"),
      fullPage: true,
    });
  });
}

test("DePaul workspace chrome stays light while terminal content and window controls retain contrast", async ({
  page,
}, info) => {
  page.setDefaultTimeout(6000);
  const f = await fixture(page);
  await begin(page, f);
  const pane = await readyTerminal(page, 1);
  await expect(page.locator(".exam-toolbar")).toHaveCSS(
    "background-color",
    white,
  );
  await contrast(
    page.getByRole("button", { name: "New terminal", exact: true }),
  );
  await expect(pane).toHaveCSS("background-color", blue);
  await expect(pane.locator(".terminal[aria-busy]")).toHaveCSS(
    "background-color",
    "rgb(13, 20, 32)",
  );
  await expect(pane.locator(".wb-title")).toHaveCSS("color", white);
  await contrast(pane.locator(".wb-title"));
  await page.screenshot({
    path: info.outputPath("depaul-workspace.png"),
    fullPage: true,
  });
});
