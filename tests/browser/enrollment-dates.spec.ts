import {
  test,
  expect,
  type Page,
  type Locator,
  type TestInfo,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import { publishedSource } from "./prof-workflow-fixture.js";
import { templateCatalogPageResult } from "../../packages/protocol/template-catalog.js";

test.use({ timezoneId: "UTC" });

async function fixture(page: Page, overrides: Record<string, unknown> = {}) {
  const definition = {
    id: "enrollment-dates",
    name: "Midterm",
    duration: 5400,
    webcam: true,
    terminals: 4,
    template: "sample-exam",
    template_version: "a".repeat(64),
    earliest: Date.UTC(2020, 0, 2, 13, 14, 23, 456),
    latest: Date.UTC(2020, 0, 3, 17, 18, 34, 567),
    collection_file_mib: 128,
    collection_total_mib: 512,
    revision: "c".repeat(64),
    ...overrides,
  };
  const state = {
    adds: [] as any[],
    previews: [] as any[],
    previewIds: [] as string[],
    confirms: [] as any[],
    confirmMode: "normal" as "normal" | "review-required" | "lost-reply",
    committed: new Set<string>(),
    defaults: { duration: 7200, webcam: false },
  };
  await page.routeWebSocket("**/api/admin/events", () => {});
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/session")
      return route.fulfill({
        json: { role: "admin", username: "instructor", csrf: "fixture" },
      });
    if (path === "/api/login-test")
      return route.fulfill({ json: { loginOnly: false } });
    if (path === "/api/admin/exams")
      return route.fulfill({ json: [definition] });
    if (path === "/api/admin/templates")
      return route.fulfill({
        json: templateCatalogPageResult.parse({
          agent: "class",
          sources: [publishedSource()],
          next: null,
          observed: Date.now(),
          note: "Synthetic published files for enrollment date review",
        }),
      });
    if (path.endsWith("/dashboard"))
      return route.fulfill({
        json: {
          serverNow: Date.now(),
          students: [],
          total: 0,
          counts: { students: 0 },
          incidents: [],
        },
      });
    if (path.endsWith("/roster/add")) {
      state.adds.push(route.request().postDataJSON());
      return route.fulfill({ json: { ok: true } });
    }
    if (path.endsWith("/roster/import-preview")) {
      const body = route.request().postDataJSON(),
        id = randomUUID();
      state.previews.push(body);
      state.previewIds.push(id);
      return route.fulfill({
        json: {
          id,
          total: 1,
          rows: [
            {
              username: "newstudent",
              duration: null,
              webcam: null,
              uid: 0,
              action: "add",
              activeAttempt: false,
              rowNumber: 2,
              previous: null,
            },
          ],
          checksum: "b".repeat(64),
          summary: { added: 1, changed: 0, unchanged: 0 },
          earliest: body.earliest ?? definition.earliest,
          latest: body.latest ?? definition.latest,
          defaults: state.defaults,
        },
      });
    }
    if (path.endsWith("/roster/import-confirm")) {
      const body = route.request().postDataJSON();
      state.confirms.push(body);
      if (state.confirmMode === "review-required") {
        state.confirmMode = "normal";
        return route.fulfill({
          status: 400,
          json: {
            code: "ROSTER_REVIEW_REQUIRED",
            error: "Exam defaults changed since preview. Review the CSV again.",
          },
        });
      }
      state.committed.add(body.id);
      if (state.confirmMode === "lost-reply") {
        state.confirmMode = "normal";
        return route.abort("connectionreset");
      }
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({
      status: 404,
      json: { error: "Unexpected fixture request" },
    });
  });
  await page.goto("/admin");
  await page
    .getByLabel("Selected exam", { exact: true })
    .selectOption(String(definition.id));
  return { definition, state };
}

async function addStudents(page: Page) {
  await page
    .getByRole("button", { name: "Add student", exact: true })
    .click({ timeout: 3000 });
  return page.getByRole("dialog", { name: "Add students", exact: true });
}

async function captureDatesDialog(
  page: Page,
  dialog: Locator,
  info: TestInfo,
  prefix: string,
  groupName = "First attempt start dates",
) {
  const dates = dialog.getByRole("group", { name: groupName, exact: true });
  for (const width of [1280, 430]) {
    await page.setViewportSize({ width, height: 900 });
    for (const target of [
      dialog,
      dates,
      dates.getByLabel("Opens", { exact: true }),
      dates.getByLabel("Closes", { exact: true }),
    ]) {
      await expect(target).toBeVisible();
      const box = await target.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(-1);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
    }
    await page.screenshot({
      path: info.outputPath(`${prefix}-${width}.png`),
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}

test("the existing-exam editor clearly marks exam defaults and their date scope", async ({
  page,
}, info) => {
  await fixture(page);
  const open = page.getByRole("button", { name: "Exam defaults", exact: true });
  await expect(open).toBeVisible();
  await open.click({ timeout: 3000 });
  const dialog = page.getByRole("dialog", {
    name: "Exam defaults",
    exact: true,
  });
  await expect(
    dialog
      .getByRole("combobox", { name: "Exam files", exact: true })
      .getByRole("option", { name: /^sample-exam ·/ }),
  ).toHaveCount(1);
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect(
    dialog.getByRole("group", { name: "Default start dates", exact: true }),
  ).toBeVisible();
  await expect(dialog.getByLabel("Opens", { exact: true })).toHaveValue(
    "2020-01-02T13:14:23.456",
  );
  await expect(dialog.getByLabel("Closes", { exact: true })).toHaveValue(
    "2020-01-03T17:18:34.567",
  );
  await expect(dialog).toContainText(
    "Used for new attempts unless you choose different settings. Existing allowed attempts keep their saved settings.",
  );
  await expect(
    dialog.getByRole("button", { name: "Save defaults", exact: true }),
  ).toBeVisible();
  await captureDatesDialog(
    page,
    dialog,
    info,
    "exam-defaults",
    "Default start dates",
  );
});

test("new first attempts inherit exact exam dates until the instructor changes them", async ({
  page,
}, info) => {
  const { definition, state } = await fixture(page);
  let dialog = await addStudents(page);
  await expect(dialog.getByLabel("Opens", { exact: true })).toHaveValue(
    "2020-01-02T13:14:23.456",
  );
  await expect(dialog.getByLabel("Closes", { exact: true })).toHaveValue(
    "2020-01-03T17:18:34.567",
  );
  await expect(dialog.getByLabel("Opens", { exact: true })).toHaveAttribute(
    "step",
    "0.001",
  );
  await expect(dialog).toContainText(
    "These dates apply only to new first attempts.",
  );
  await captureDatesDialog(page, dialog, info, "add-student-dates");
  await dialog.getByLabel("Username", { exact: true }).fill("newstudent");
  await dialog
    .getByRole("button", { name: "Add student", exact: true })
    .click({ timeout: 3000 });
  await expect(dialog).toHaveCount(0);
  expect(state.adds).toEqual([
    {
      username: "newstudent",
      webcam: null,
      duration: null,
      earliest: definition.earliest,
      latest: definition.latest,
      definition_revision: definition.revision,
    },
  ]);
  dialog = await addStudents(page);
  await dialog.getByLabel("Username", { exact: true }).fill("newstudent2");
  await dialog.getByLabel("Opens", { exact: true }).fill("2028-08-10T08:45");
  await dialog.getByLabel("Closes", { exact: true }).fill("2028-08-12T23:42");
  await dialog
    .getByRole("button", { name: "Add student", exact: true })
    .click({ timeout: 3000 });
  await expect(dialog).toHaveCount(0);
  expect(state.adds[1]).toMatchObject({
    username: "newstudent2",
    earliest: Date.UTC(2028, 7, 10, 8, 45),
    latest: Date.UTC(2028, 7, 12, 23, 42),
  });
});

test("changing first-attempt dates requires a fresh CSV review without uploading again", async ({
  page,
}, info) => {
  const { definition, state } = await fixture(page),
    dialog = await addStudents(page);
  await dialog
    .getByRole("button", { name: "CSV file", exact: true })
    .click({ timeout: 3000 });
  const text = "username,require_webcam,duration_minutes\nnewstudent,inherit,";
  await dialog.getByLabel("CSV file", { exact: true }).setInputFiles({
    name: "new-students.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(text),
  });
  const confirm = dialog.getByRole("button", {
    name: "Confirm import",
    exact: true,
  });
  await expect(confirm).toBeEnabled();
  await expect(dialog.locator(".preview")).toContainText(
    "time limit 120 min (exam default) · webcam optional (exam default)",
  );
  expect(state.previews[0]).toEqual({
    text,
    mode: "csv",
    earliest: definition.earliest,
    latest: definition.latest,
  });
  await dialog.getByLabel("Closes", { exact: true }).fill("2028-08-12T23:42");
  await expect(confirm).toBeDisabled();
  await expect(dialog.locator(".preview")).toHaveCount(0);
  expect(state.confirms).toHaveLength(0);
  await dialog
    .getByRole("button", { name: "Review CSV", exact: true })
    .click({ timeout: 3000 });
  await expect(confirm).toBeEnabled();
  expect(state.previews).toHaveLength(2);
  expect(state.previews[1]).toEqual({
    text,
    mode: "csv",
    earliest: definition.earliest,
    latest: Date.UTC(2028, 7, 12, 23, 42),
  });
  expect(state.previewIds[1]).not.toBe(state.previewIds[0]);
  await captureDatesDialog(page, dialog, info, "csv-date-review");
  await confirm.click({ timeout: 3000 });
  await expect(dialog).toHaveCount(0);
  expect(state.confirms).toEqual([{ id: state.previewIds[1] }]);
});

test("a stale CSV confirmation exposes cached re-review without re-uploading", async ({
  page,
}) => {
  const { state } = await fixture(page),
    dialog = await addStudents(page);
  await dialog
    .getByRole("button", { name: "CSV file", exact: true })
    .click({ timeout: 3000 });
  await dialog.getByLabel("CSV file", { exact: true }).setInputFiles({
    name: "new-students.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "username,require_webcam,duration_minutes\nnewstudent,inherit,",
    ),
  });
  const confirm = dialog.getByRole("button", {
    name: "Confirm import",
    exact: true,
  });
  await expect(confirm).toBeEnabled();
  state.confirmMode = "review-required";
  await confirm.click({ timeout: 3000 });
  await expect(dialog.getByRole("alert")).toContainText(
    "Exam defaults changed since preview. Review the CSV again.",
  );
  await expect(confirm).toBeDisabled();
  await expect(dialog.locator(".preview")).toHaveCount(0);
  expect(state.committed.size).toBe(0);
  state.defaults = { duration: 3600, webcam: true };
  await dialog
    .getByRole("button", { name: "Review CSV", exact: true })
    .click({ timeout: 3000 });
  await expect(confirm).toBeEnabled();
  await expect(dialog.locator(".preview")).toContainText(
    "time limit 60 min (exam default) · webcam required (exam default)",
  );
  expect(state.previews).toHaveLength(2);
  expect(state.previews[1]).toEqual(state.previews[0]);
  expect(state.previewIds[1]).not.toBe(state.previewIds[0]);
  await confirm.click({ timeout: 3000 });
  await expect(dialog).toHaveCount(0);
  expect(state.confirms).toEqual([
    { id: state.previewIds[0] },
    { id: state.previewIds[1] },
  ]);
  expect([...state.committed]).toEqual([state.previewIds[1]]);
});

test("a lost CSV confirmation reply retries the same reviewed import", async ({
  page,
}) => {
  const { state } = await fixture(page),
    dialog = await addStudents(page);
  await dialog
    .getByRole("button", { name: "CSV file", exact: true })
    .click({ timeout: 3000 });
  await dialog.getByLabel("CSV file", { exact: true }).setInputFiles({
    name: "new-students.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "username,require_webcam,duration_minutes\nnewstudent,inherit,",
    ),
  });
  const confirm = dialog.getByRole("button", {
    name: "Confirm import",
    exact: true,
  });
  await expect(confirm).toBeEnabled();
  state.confirmMode = "lost-reply";
  await confirm.click({ timeout: 3000 });
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(confirm).toBeEnabled();
  await expect(dialog.locator(".preview")).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Review CSV", exact: true }),
  ).toHaveCount(0);
  expect(state.previews).toHaveLength(1);
  expect([...state.committed]).toEqual([state.previewIds[0]]);
  await confirm.click({ timeout: 3000 });
  await expect(dialog).toHaveCount(0);
  expect(state.previews).toHaveLength(1);
  expect(state.confirms).toEqual([
    { id: state.previewIds[0] },
    { id: state.previewIds[0] },
  ]);
  expect([...state.committed]).toEqual([state.previewIds[0]]);
});

test("sandbox enrollment uses practice dates instead of pretending to override them", async ({
  page,
}) => {
  const { state } = await fixture(page, {
      id: "sandbox",
      duration: 300,
      webcam: false,
    }),
    dialog = await addStudents(page);
  await expect(dialog.getByLabel("Opens", { exact: true })).toHaveCount(0);
  await expect(dialog.getByLabel("Closes", { exact: true })).toHaveCount(0);
  await expect(dialog).toContainText("Practice dates come from Exam defaults.");
  await dialog.getByLabel("Username", { exact: true }).fill("practiceuser");
  await dialog
    .getByRole("button", { name: "Add student", exact: true })
    .click({ timeout: 3000 });
  await expect(dialog).toHaveCount(0);
  expect(state.adds).toHaveLength(1);
  expect(state.adds[0]).not.toHaveProperty("earliest");
  expect(state.adds[0]).not.toHaveProperty("latest");
});

test.describe("repeated local hour", () => {
  test.use({ timezoneId: "America/New_York" });
  test("first-attempt dates preserve exact milliseconds and the default repeated-hour occurrence", async ({
    page,
  }) => {
    const { definition, state } = await fixture(page, {
        earliest: Date.UTC(2026, 10, 1, 6, 30, 12, 345),
        latest: Date.UTC(2026, 10, 1, 7, 30, 34, 567),
      }),
      dialog = await addStudents(page);
    await expect(dialog.getByLabel("Opens", { exact: true })).toHaveValue(
      "2026-11-01T01:30:12.345",
    );
    await expect(
      dialog.getByRole("combobox", {
        name: "Occurrence for Opens",
        exact: true,
      }),
    ).toHaveValue("1");
    await dialog.getByLabel("Username", { exact: true }).fill("dststudent");
    await dialog
      .getByRole("button", { name: "Add student", exact: true })
      .click({ timeout: 3000 });
    await expect(dialog).toHaveCount(0);
    expect(state.adds[0]).toMatchObject({
      earliest: definition.earliest,
      latest: definition.latest,
    });
  });
});
