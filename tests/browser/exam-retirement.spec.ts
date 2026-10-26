import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { randomUUID } from "node:crypto";

// Reuse this file's authenticated session instead of spending four real login
// attempts in the shared server's five-per-minute instructor limit.
let adminCookies: Awaited<ReturnType<BrowserContext["cookies"]>> = [];
test.beforeEach(async ({ context }) => {
  if (adminCookies.length) await context.addCookies(adminCookies);
});

async function admin(page: Page) {
  page.setDefaultTimeout(10000);
  await page.goto("/admin");
  if ((await page.request.get("/api/session")).status() !== 200) {
    await page.getByLabel("Username", { exact: true }).fill("instructor");
    await page.getByLabel("Password", { exact: true }).fill("fixture-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
  await expect(page.getByLabel("Selected exam")).toBeVisible();
  adminCookies = await page.context().cookies();
  const session = await (await page.request.get("/api/session")).json();
  return async (url: string, data: any) => {
    const reply = await page.request.post(url, {
      data,
      headers: {
        origin: "http://localhost:3100",
        "x-csrf-token": session.csrf,
      },
    });
    expect(reply.status(), await reply.text()).toBe(200);
    return reply.json();
  };
}
async function create(page: Page, post: Awaited<ReturnType<typeof admin>>) {
  const id = "retire-" + randomUUID().slice(0, 8);
  const definition = await post("/api/admin/exams", {
    id,
    name: "Synthetic retirement exam",
    template: "sample-exam",
    template_version: "a".repeat(64),
    duration: 600,
    webcam: false,
    terminals: 2,
    earliest: Date.now() - 1000,
    latest: Date.now() + 3600000,
    requestID: randomUUID(),
  });
  await page.reload();
  await page.getByLabel("Selected exam").selectOption(id);
  return definition;
}
async function open(
  page: Page,
  action: "Delete unused exam" | "Archive exam" | "Restore archived exam",
) {
  await page.getByRole("button", { name: "Exam actions", exact: true }).click();
  await page.getByRole("menuitem", { name: action, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: action, exact: true });
  await expect(dialog.getByRole("status")).toHaveCount(0);
  return dialog;
}

test("mobile unused deletion retries the identical reviewed request after the real server commits but its reply is lost", async ({
  page,
}) => {
  await page.setViewportSize({ width: 430, height: 1000 });
  const post = await admin(page),
    definition = await create(page, post),
    writes: any[] = [];
  await page.route(
    `**/api/admin/exams/${definition.id}/retire`,
    async (route) => {
      writes.push(route.request().postDataJSON());
      const response = await route.fetch();
      if (writes.length === 1) return route.abort("failed");
      await route.fulfill({ response });
    },
  );
  const dialog = await open(page, "Delete unused exam");
  await dialog
    .getByLabel("Reason", { exact: true })
    .fill("Remove reviewed synthetic unused exam");
  await dialog
    .getByRole("button", { name: "Delete unused definition", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  const list = await (
    await page.request.get("/api/admin/exams?lifecycle=all")
  ).json();
  expect(list.some((e: any) => e.id === definition.id)).toBe(false);
  await dialog
    .getByRole("button", { name: "Delete unused definition", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(writes).toHaveLength(2);
  expect(writes[1]).toEqual(writes[0]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("stale review requires explicit refresh and a failed refresh cannot submit the obsolete review", async ({
  page,
}) => {
  const post = await admin(page),
    definition = await create(page, post);
  const dialog = await open(page, "Delete unused exam");
  await dialog
    .getByLabel("Reason", { exact: true })
    .fill("Remove explicitly reviewed unused exam");
  await post("/api/admin/exams", {
    id: definition.id,
    revision: definition.revision,
    name: "Concurrent synthetic edit",
    requestID: randomUUID(),
  });
  await dialog
    .getByRole("button", { name: "Delete unused definition", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("changed");
  await page.route(
    `**/api/admin/exams/${definition.id}/retirement-preview`,
    (route) =>
      route.fulfill({
        status: 503,
        json: { error: "Synthetic review temporarily unavailable" },
      }),
  );
  await dialog
    .getByRole("button", { name: "Refresh review", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "temporarily unavailable",
  );
  await expect(
    dialog.getByRole("button", {
      name: "Delete unused definition",
      exact: true,
    }),
  ).toBeDisabled();
  await page.unroute(`**/api/admin/exams/${definition.id}/retirement-preview`);
  await dialog
    .getByRole("button", { name: "Refresh review", exact: true })
    .click();
  await expect(dialog).toContainText("Concurrent synthetic edit");
  await dialog
    .getByRole("button", { name: "Delete unused definition", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
});

test("archive and restoration retain real historical attempts and disable new-authority controls while archived", async ({
  page,
}) => {
  await admin(page);
  const url = "/api/admin/exams/retirement-history/dashboard",
    original = (await (await page.request.get(url)).json()).students[0]
      .attempts[0];
  await page.getByLabel("Selected exam").selectOption("retirement-history");
  let dialog = await open(page, "Delete unused exam");
  await expect(dialog.getByRole("alert")).toContainText("history");
  await expect(
    dialog.getByRole("button", {
      name: "Delete unused definition",
      exact: true,
    }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  dialog = await open(page, "Archive exam");
  await dialog
    .getByLabel("Reason", { exact: true })
    .fill("Archive protected synthetic exam history");
  await dialog
    .getByRole("button", { name: "Archive definition", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await page.getByLabel("Exam visibility").selectOption("archived");
  await page.getByLabel("Selected exam").selectOption("retirement-history");
  await expect(
    page.getByRole("button", { name: "Add student", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Exam settings", exact: true }),
  ).toBeDisabled();
  const retained = (await (await page.request.get(url)).json()).students[0]
    .attempts[0];
  for (const key of [
    "id",
    "state",
    "settings",
    "start",
    "deadline",
    "original_deadline",
    "protected",
    "access_state",
    "checksum",
  ])
    expect(retained[key]).toEqual(original[key]);
  dialog = await open(page, "Restore archived exam");
  await dialog
    .getByLabel("Reason", { exact: true })
    .fill("Restore visibility preserving all original history");
  await dialog
    .getByRole("button", { name: "Restore definition", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await page.getByLabel("Exam visibility").selectOption("active");
  await page.getByLabel("Selected exam").selectOption("retirement-history");
  await expect(
    page.getByRole("button", { name: "Add student", exact: true }),
  ).toBeEnabled();
  expect(
    (await (await page.request.get(url)).json()).students[0].attempts[0]
      .deadline,
  ).toBe(original.deadline);
});

test("legacy retirement exposes native review status and archives native-only history without enabling deletion", async ({
  page,
}) => {
  await admin(page);
  await page
    .getByLabel("Selected exam")
    .selectOption("retirement-legacy-required");
  let dialog = await open(page, "Delete unused exam");
  await expect(dialog.getByText("Required", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("alert")).toContainText("native-review");
  await expect(
    dialog.getByRole("button", {
      name: "Delete unused definition",
      exact: true,
    }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .getByLabel("Selected exam")
    .selectOption("retirement-legacy-native");
  dialog = await open(page, "Delete unused exam");
  await expect(
    dialog.getByText("Verified for this review", { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByRole("alert")).toContainText(
    "native permission history",
  );
  await expect(
    dialog.getByRole("button", {
      name: "Delete unused definition",
      exact: true,
    }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  dialog = await open(page, "Archive exam");
  await expect(
    dialog.getByText("Verified for this review", { exact: true }),
  ).toBeVisible();
  await dialog
    .getByLabel("Reason", { exact: true })
    .fill("Archive native-only protected history without removing records");
  await page.screenshot({
    path: test.info().outputPath("native-retirement-review.png"),
  });
  await dialog
    .getByRole("button", { name: "Archive definition", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await page.getByLabel("Exam visibility").selectOption("archived");
  await page
    .getByLabel("Selected exam")
    .selectOption("retirement-legacy-native");
  await expect(
    page.getByRole("button", { name: "Exam settings", exact: true }),
  ).toBeDisabled();
});

test("unused grants block archive without silently cancelling or consuming them", async ({
  page,
}) => {
  const post = await admin(page),
    definition = await create(page, post);
  await post(`/api/admin/exams/${definition.id}/roster/add`, {
    username: "retirewait",
  });
  const before = await (
    await page.request.get(`/api/admin/exams/${definition.id}/grants`)
  ).json();
  const dialog = await open(page, "Archive exam");
  await expect(dialog.getByRole("alert")).toContainText("Unused grants remain");
  await expect(
    dialog.getByRole("button", { name: "Archive definition", exact: true }),
  ).toBeDisabled();
  expect(
    await (
      await page.request.get(`/api/admin/exams/${definition.id}/grants`)
    ).json(),
  ).toEqual(before);
});
