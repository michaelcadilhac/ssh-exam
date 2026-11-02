import {
  expect,
  type Page,
  type Locator,
  type BrowserContext,
} from "@playwright/test";
import { localDateTime } from "../../apps/web/src/local-date-time.js";

export async function selectedAction(
  page: Page,
  names: string[],
  action: string,
) {
  for (const box of await page
    .getByRole("checkbox", { name: /^Select student / })
    .all())
    await box.uncheck();
  for (const name of names)
    await page
      .getByRole("checkbox", { name: `Select student ${name}`, exact: true })
      .check();
  await page
    .getByRole("button", { name: "Selected students", exact: true })
    .click();
  await page.getByRole("menuitem", { name: action, exact: true }).click();
  return page.getByRole("dialog");
}
export async function additionalDraft(
  page: Page,
  names: string[],
  minutes = "90",
  work = "empty",
) {
  const dialog = await selectedAction(page, names, "Add next attempts");
  if (minutes)
    await dialog
      .getByLabel("Time limit (minutes)", { exact: true })
      .fill(minutes);
  await dialog
    .getByRole("combobox", { name: "Start with", exact: true })
    .selectOption(work);
  await dialog
    .getByLabel("Opens", { exact: true })
    .fill(localDateTime(Date.now() - 60000));
  await dialog
    .getByLabel("Closes", { exact: true })
    .fill(localDateTime(Date.now() + 600000));
  await expect(dialog.getByLabel("Reason", { exact: true })).toHaveCount(0);
  return dialog;
}
export async function previewAdditional(page: Page, dialog: Locator) {
  const response = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname.endsWith("/grants/additional-preview") &&
      r.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "Review", exact: true }).click();
  const reply = await response;
  expect(reply.status()).toBe(200);
  return { reply, review: await reply.json() };
}
export async function editNextField(
  page: Page,
  username: string,
  field: "time limit" | "webcam" | "start dates" | "starting files",
) {
  await page
    .getByRole("button", {
      name: `Change ${field} for ${username}`,
      exact: true,
    })
    .click();
  const name = `${field[0].toUpperCase()}${field.slice(1)} for ${username}`;
  return field === "starting files"
    ? page.getByRole("dialog", { name, exact: true })
    : page.getByRole("region", { name, exact: true });
}

export async function cancelNext(page: Page, username: string) {
  await page
    .getByRole("button", {
      name: `Cancel next attempt for ${username}`,
      exact: true,
    })
    .click();
  const dialog = page.getByRole("dialog", {
    name: `Cancel next attempt for ${username}?`,
    exact: true,
  });
  await expect(dialog).toContainText(
    "Previous attempts and saved files are kept.",
  );
  await dialog
    .getByRole("button", { name: "Cancel attempt", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
}
export function publishedSource(name = "sample-exam", hash = "a".repeat(64)) {
  return {
    schema: 1,
    agent: "class",
    name,
    hash,
    entries: 4,
    files: 2,
    bytes: 30,
    max_file_bytes: 20,
    first_native_created: 1000,
    last_native_created: 1000,
    first_acknowledged_at: 1000,
    last_attested_at: 2000,
    last_acknowledged_at: 2000,
    last_request: "12345678-1234-4234-8234-123456789abc",
    revision: "b".repeat(64),
  };
}

export async function chooseSavedSource(
  dialog: Locator,
  username: string,
  attempt: string,
) {
  const choice = dialog.getByRole("combobox", {
    name: `Starting files for ${username}`,
    exact: true,
  });
  const summary = dialog
    .locator("summary")
    .filter({ hasText: "Individual starting files" });
  await expect(choice.or(summary).first()).toBeVisible();
  if (!(await choice.isVisible())) {
    await expect(summary).toBeVisible();
    if (
      !(await summary.evaluate(
        (el) => (el.parentElement as HTMLDetailsElement).open,
      ))
    )
      await summary.click();
  }
  await expect(choice).toBeVisible();
  await choice.selectOption(attempt);
}

const instructorCookies = new Map<
  string,
  Awaited<ReturnType<BrowserContext["cookies"]>>
>();
const instructorAddresses = {
  prof_additional: 210,
  prof_initial: 211,
  prof_practice: 212,
  prof_enrollment: 213,
  prof_additional_review: 214,
  prof_additional_saved: 215,
  prof_additional_bulk: 216,
} as const;
// Each independent workflow has its own ordinary synthetic instructor. Reuse
// still-valid sessions; logout invalidates them normally. Never reset/bypass
// real login/actor limits, authentication, CSRF or request auditing.
export async function instructorSignIn(
  page: Page,
  username: keyof typeof instructorAddresses,
) {
  const cookies = instructorCookies.get(username);
  if (cookies) await page.context().addCookies(cookies);
  await page.setExtraHTTPHeaders({
    "X-Forwarded-For": `198.51.100.${instructorAddresses[username]}`,
  });
  await page.goto("/admin");
  const response = await page.request.get("/api/session");
  const session = response.status() === 200 ? await response.json() : null;
  if (session?.role !== "admin" || session?.username !== username) {
    await page.getByLabel("Username", { exact: true }).fill(username);
    await page.getByLabel("Password", { exact: true }).fill("fixture-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
  }
  await expect(
    page.getByRole("combobox", { name: "Selected exam", exact: true }),
  ).toBeVisible();
  instructorCookies.set(username, await page.context().cookies());
}
