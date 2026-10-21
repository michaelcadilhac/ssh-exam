import { test, expect, type Page } from "@playwright/test";

const outbox = "11111111-1111-4111-8111-111111111111";
const episode = "22222222-2222-4222-8222-222222222222";
const reminder = "33333333-3333-4333-8333-333333333333";
async function fixture(page: Page) {
  const state = {
    row: {
      id: outbox,
      subject: "Synthetic collection failure",
      status: "failed",
      tries: 10,
      next: Date.now(),
      smtpConfigured: true,
      remindable: true,
      refusal: null as string | null,
      episode: {
        id: episode,
        event: "collection-failure",
        generation: 2,
        resolved: null as number | null,
        revision: "a".repeat(64),
        reminderCount: 0,
        reminders: [],
      },
    },
    reminders: [] as any[],
    tests: [] as any[],
    failRead: false,
    rejectReminder: false,
  };
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === "/api/session")
      return route.fulfill({
        json: { role: "admin", username: "teacher", csrf: "fixture" },
      });
    if (path === "/api/login-test") return route.fulfill({ json: {} });
    if (path === "/api/admin/exams") return route.fulfill({ json: [] });
    if (path === "/api/admin/notifications") {
      if (state.failRead)
        return route.fulfill({
          status: 503,
          json: { error: "Delivery inspection unavailable" },
        });
      return route.fulfill({
        json: { alerts: [state.row], next: null, smtpConfigured: true },
      });
    }
    if (path === `/api/admin/notifications/${outbox}`)
      return route.fulfill({ json: state.row });
    if (path === `/api/admin/notifications/${episode}/remind`) {
      const b = route.request().postDataJSON();
      state.reminders.push(b);
      if (state.rejectReminder)
        return route.fulfill({
          status: 409,
          json: {
            error:
              "Alert episode changed; review resolution/reminders and use a new intent",
          },
        });
      state.row.episode.revision = "b".repeat(64);
      state.row.episode.reminderCount = 1;
      state.row.remindable = false;
      state.row.refusal = "A message is pending";
      if (state.reminders.length === 1) return route.abort("failed");
      return route.fulfill({
        json: { queued: true, delivered: false, outbox: reminder },
      });
    }
    if (path === "/api/admin/notifications/test") {
      state.tests.push(route.request().postDataJSON());
      if (state.tests.length === 1) return route.abort("failed");
      return route.fulfill({
        json: { queued: true, delivered: false, outbox: reminder },
      });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Administration", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Alerts", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Email delivery" }),
  ).toBeVisible();
  return state;
}

for (const width of [1280, 430])
  test(`lost reminder reply retains reviewed revision and intent through polling at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const state = await fixture(page);
    const dialog = page.getByRole("dialog", { name: "Alerts", exact: true });
    await dialog
      .getByRole("button", {
        name: "Remind: Synthetic collection failure",
        exact: true,
      })
      .click();
    await dialog
      .getByLabel("Reminder reason")
      .fill("Explicit instructor reminder after review");
    await dialog
      .getByRole("button", { name: "Queue reminder", exact: true })
      .click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    await dialog
      .getByRole("button", { name: "Refresh delivery", exact: true })
      .click();
    await expect(dialog.getByText(/1 manual reminders/)).toBeVisible();
    await dialog
      .getByRole("button", { name: "Queue reminder", exact: true })
      .click();
    await expect(
      dialog.getByText(/Email queued, not confirmed delivered/),
    ).toBeVisible();
    expect(state.reminders).toHaveLength(2);
    expect(state.reminders[1]).toEqual(state.reminders[0]);
    expect(state.reminders[0]).toMatchObject({
      revision: "a".repeat(64),
      reason: "Explicit instructor reminder after review",
    });
    expect(state.reminders[0].requestID).toMatch(/^[a-f0-9-]{36}$/);
    await expect(dialog.getByLabel("Reminder reason")).toHaveCount(0);
    expect(
      await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    ).toBe(true);
  });

test("resolved/stale reminder stays fenced, retains edits and can be cancelled", async ({
  page,
}) => {
  const state = await fixture(page);
  const dialog = page.getByRole("dialog", { name: "Alerts", exact: true });
  await dialog
    .getByRole("button", {
      name: "Remind: Synthetic collection failure",
      exact: true,
    })
    .click();
  await dialog
    .getByLabel("Reminder reason")
    .fill("Retain this reviewed reason");
  state.rejectReminder = true;
  state.row.episode.resolved = Date.now();
  state.row.episode.revision = "b".repeat(64);
  state.row.remindable = false;
  state.row.refusal = "Episode is resolved";
  await dialog
    .getByRole("button", { name: "Queue reminder", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("episode changed");
  await expect(dialog.getByLabel("Reminder reason")).toHaveValue(
    "Retain this reviewed reason",
  );
  await dialog
    .getByRole("button", { name: "Cancel reminder", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Refresh delivery", exact: true })
    .click();
  await expect(
    dialog.getByText("Episode is resolved", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", {
      name: "Remind: Synthetic collection failure",
      exact: true,
    }),
  ).toBeDisabled();
  expect(state.reminders).toHaveLength(1);
});

test("test email retries one intent and delivery inspection recovers without claiming delivery", async ({
  page,
}) => {
  const state = await fixture(page);
  const dialog = page.getByRole("dialog", { name: "Alerts", exact: true });
  await dialog
    .getByRole("button", { name: "Test email alert", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog
    .getByRole("button", { name: "Test email alert", exact: true })
    .click();
  await expect(
    dialog.getByText(/Email queued, not confirmed delivered/),
  ).toBeVisible();
  expect(state.tests).toHaveLength(2);
  expect(state.tests[1]).toEqual(state.tests[0]);
  state.failRead = true;
  await dialog
    .getByRole("button", { name: "Refresh delivery", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "inspection unavailable",
  );
  await expect(
    dialog.getByRole("button", {
      name: "Remind: Synthetic collection failure",
      exact: true,
    }),
  ).toBeDisabled();
  state.failRead = false;
  await dialog
    .getByRole("button", { name: "Refresh delivery", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect(
    dialog.getByRole("button", {
      name: "Remind: Synthetic collection failure",
      exact: true,
    }),
  ).toBeEnabled();
});

test("inspects an exact outbox ID without relying on the current history page", async ({
  page,
}) => {
  const state = await fixture(page);
  const dialog = page.getByRole("dialog", { name: "Alerts", exact: true });
  await dialog.getByLabel("Outbox ID", { exact: true }).fill(outbox);
  await dialog
    .getByRole("button", { name: "Inspect message", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", {
      name: "Return to delivery list",
      exact: true,
    }),
  ).toBeVisible();
  await expect(dialog.getByText(new RegExp(`${outbox}: failed`))).toBeVisible();
  state.row.status = "sent";
  await dialog
    .getByRole("button", { name: "Refresh delivery", exact: true })
    .click();
  await expect(dialog.getByText(new RegExp(`${outbox}: sent`))).toBeVisible();
});
