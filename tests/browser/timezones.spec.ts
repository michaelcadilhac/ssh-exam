import { test, expect, request } from "@playwright/test";
import { publishedSource } from "./prof-workflow-fixture.js";
import { randomUUID } from "node:crypto";
import { simulatedMedia, ready } from "./transition-fixture.js";

const zones = [
  ["UTC", "2026-07-17T09:15:00Z"],
  ["America/Los_Angeles", "2026-07-17T16:15:00Z"],
  ["America/New_York", "2026-07-17T13:15:00Z"],
  ["Europe/London", "2026-07-17T08:15:00Z"],
  ["Asia/Kathmandu", "2026-07-17T03:30:00Z"],
  ["Pacific/Honolulu", "2026-07-17T19:15:00Z"],
  ["Pacific/Kiritimati", "2026-07-16T19:15:00Z"],
];
for (const [index, [timezoneId, localStartUTC]] of zones.entries()) {
  test.describe(timezoneId, () => {
    test.use({ timezoneId });
    test("exam settings convert device-local start times to absolute instants", async ({
      page,
    }) => {
      let saved: any;
      await page.route("**/api/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path === "/api/session")
          return route.fulfill({
            json: { role: "admin", username: "instructor", csrf: "fixture" },
          });
        if (path === "/api/login-test")
          return route.fulfill({ json: { loginOnly: false } });
        if (path === "/api/admin/templates")
          return route.fulfill({
            json: {
              agent: "class",
              sources: [publishedSource()],
              next: null,
              observed: Date.now(),
              note: "Synthetic published metadata",
            },
          });
        if (
          path === "/api/admin/exams" ||
          path === "/api/admin/exams/versioned"
        ) {
          if (route.request().method() === "POST") {
            saved = route.request().postDataJSON();
            return route.fulfill({ json: saved });
          }
          return route.fulfill({ json: saved ? [saved] : [] });
        }
        return route.fulfill({
          json: {
            students: [],
            incidents: [],
            counts: {},
            total: 0,
            serverNow: Date.now(),
          },
        });
      });
      await page.routeWebSocket("**/api/admin/events", () => {});
      await page.goto("/admin");
      await page.getByRole("button", { name: "New exam", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await dialog
        .getByLabel("Exam ID", { exact: true })
        .fill(`zone-settings-${index}`);
      await dialog
        .getByRole("combobox", { name: "Exam files", exact: true })
        .selectOption(`sample-exam@${"a".repeat(64)}`);
      await dialog
        .getByLabel("Opens", { exact: true })
        .fill("2026-07-17T09:15");
      await dialog
        .getByLabel("Closes", { exact: true })
        .fill("2026-07-17T10:15");
      await dialog
        .getByRole("button", { name: "Save exam", exact: true })
        .click();
      await expect(dialog).toHaveCount(0);
      expect(saved.earliest).toBe(Date.parse(localStartUTC));
      expect(saved.latest - saved.earliest).toBe(3600000);
    });

    test("student SSH login, start, individual timing, clock changes and collection ignore the browser timezone", async ({
      page,
      baseURL,
    }) => {
      test.setTimeout(45000);
      let terminalAdmitted = false;
      page.on("websocket", (socket) =>
        socket.on("framereceived", ({ payload }) => {
          if (typeof payload !== "string") return;
          try {
            if (JSON.parse(payload).type === "opened") terminalAdmitted = true;
          } catch {
            /* Binary SSH and non-session frames are not admission. */
          }
        }),
      );
      const origin = baseURL!,
        exam = `timezone-${index + 1}`,
        username = `timezone${index + 1}`;
      const admin = await request.newContext({
        baseURL,
        extraHTTPHeaders: {
          Origin: origin,
          "X-Forwarded-For": `198.51.100.${60 + index}`,
        },
      });
      try {
        const login = await admin.post("/api/admin/login", {
          data: { username: "instructor", password: "fixture-password" },
        });
        expect(login.ok()).toBe(true);
        const { csrf } = await login.json(),
          headers = { "X-CSRF-Token": csrf };
        const configured = {
          id: exam,
          name: "Timezone test",
          duration: 5400,
          webcam: false,
          terminals: 4,
          template: "sample-exam",
          template_version: "a".repeat(64),
          earliest: Date.now() - 60000,
          latest: Date.now() + 3600000,
        };
        expect(
          (
            await admin.post("/api/admin/exams/versioned", {
              headers,
              data: configured,
            })
          ).ok(),
        ).toBe(true);
        expect(
          (
            await admin.post(`/api/admin/exams/${exam}/roster/add`, {
              headers,
              data: { username, duration: index % 2 ? 7200 : null },
            })
          ).ok(),
        ).toBe(true);
        await simulatedMedia(page);
        await page.goto("/");
        expect(
          await page.evaluate(
            () => Intl.DateTimeFormat().resolvedOptions().timeZone,
          ),
        ).toBe(timezoneId === "Asia/Kathmandu" ? "Asia/Katmandu" : timezoneId);
        await page.getByLabel("Exam ID", { exact: true }).fill(exam);
        await page.getByLabel("Username").fill(username);
        await page
          .getByRole("button", { name: "Sign in", exact: true })
          .click();
        await page
          .getByLabel("Password", { exact: true })
          .fill("shared-password");
        await page
          .getByRole("button", { name: "Continue", exact: true })
          .click();
        await expect(
          page.getByLabel("Host authentication messages"),
        ).toContainText("Enter number 42");
        await expect(
          page.getByRole("button", {
            name: "Check setup and practice",
            exact: true,
          }),
        ).toBeVisible();
        const startWindow = page.locator("details").filter({
          has: page.getByText("Start window", { exact: true }),
        });
        await expect(startWindow).toHaveCount(0);
        await expect(page.locator("main")).toContainText(
          `${index % 2 ? "120" : "90"} min · Webcam: Optional`,
        );
        await page
          .getByRole("button", {
            name: "Check setup and practice",
            exact: true,
          })
          .click();
        await ready(page);
        await page
          .getByRole("button", { name: "Start exam", exact: true })
          .click();
        await page
          .getByRole("dialog")
          .getByRole("button", { name: "Start exam", exact: true })
          .click();
        await expect(page.locator(".winbox")).toHaveCount(1);
        // A window exists before its signed pane ACK. Clock edits must test an
        // admitted live terminal, rather than race a legitimately stale launch.
        await expect
          .poll(() => terminalAdmitted, { timeout: 10000 })
          .toBe(true);
        const initial = (
          await (await page.request.get("/api/student/exam")).json()
        ).attempt;
        const allowance = index % 2 ? 7200000 : 5400000;
        expect(initial.deadline - initial.start).toBe(allowance);
        expect(initial.start).toBeGreaterThanOrEqual(configured.earliest);
        expect(initial.start).toBeLessThanOrEqual(configured.latest);
        await expect(page.locator(".exam-toolbar b")).toHaveText(
          index % 2 ? /^(2:00:00|1:59:\d\d)$/ : /^(1:30:00|1:29:\d\d)$/,
        );
        const reset = await admin.post(
          `/api/admin/attempts/${initial.id}/reset-clock`,
          {
            headers,
            data: { minutes: 90, revision: 0, requestID: randomUUID() },
          },
        );
        expect(reset.ok()).toBe(true);
        const current = (
          await (await page.request.get("/api/student/exam")).json()
        ).attempt;
        expect(current.clock_revision).toBe(1);
        expect(current.original_deadline).toBe(initial.deadline);
        expect(current.deadline).toBeGreaterThan(Date.now() + 89 * 60000);
        await expect(page.locator(".exam-toolbar b")).toHaveText(
          /^(1:30:00|1:29:\d\d)$/,
        );
        const extended = await admin.post(
          `/api/admin/exams/${exam}/attempts/clocks`,
          {
            headers,
            data: {
              action: "extend",
              minutes: 7,
              targets: [
                { id: initial.id, revision: 1, requestID: randomUUID() },
              ],
            },
          },
        );
        expect(extended.ok()).toBe(true);
        await expect
          .poll(
            async () =>
              (await (await page.request.get("/api/student/exam")).json())
                .attempt.clock_revision,
          )
          .toBe(2);
        const after = await (
          await page.request.get("/api/student/exam")
        ).json();
        expect(after.attempt.deadline).toBe(current.deadline + 420000);
        expect(after.attempt.original_deadline).toBe(initial.deadline);
        expect(after.sshConnected).toBe(true);
        await expect(page.locator(".exam-toolbar b")).toHaveText(
          /^(1:37:00|1:36:\d\d)$/,
        );
        if (process.env.EXAM_BROWSER_SSH === "1")
          expect(
            JSON.parse(after.attempt.registered_owner).clock_revision,
          ).toBe(2);
        await page.locator(".winbox .xterm-helper-textarea").focus();
        await page.keyboard.type("timezone-clock-probe");
        await page.keyboard.press("Enter");
        await expect(page.locator(".xterm-rows")).toContainText(
          "Echo: timezone-clock-probe",
        );
        await page
          .getByRole("button", { name: "Finish exam", exact: true })
          .click();
        await page
          .getByRole("dialog")
          .getByRole("button", { name: "Finish exam", exact: true })
          .click();
        await expect(
          page.getByRole("heading", {
            name: "Sign in to your exam",
            exact: true,
          }),
        ).toBeVisible();
        const history = (
          await (await admin.get(`/api/admin/exams/${exam}/dashboard`)).json()
        ).students[0].attempts[0];
        expect(history.state).toBe("COMPLETED");
        expect(history.protected).toBe(1);
        expect(history.original_deadline).toBe(initial.deadline);
      } finally {
        await admin.dispose();
      }
    });
  });
}
