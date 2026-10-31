import { test, expect, type Page } from "@playwright/test";

async function fixture(
  page: Page,
  conflict = false,
  examID = "midterm",
  unconfigured = false,
  version = "",
) {
  const state = {
    definition: {
      id: examID,
      name: "Midterm",
      template: "v1",
      ...(version ? { template_version: version } : {}),
      duration: 7200,
      webcam: false,
      terminals: 2,
      earliest: unconfigured ? 0 : Date.now() - 60000,
      latest: unconfigured ? 8640000000000000 : Date.now() + 3600000,
      revision: "a".repeat(64),
    },
    writes: [] as any[],
    paths: [] as string[],
    oldGateway: false,
  };
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
          next: null,
          observed: Date.now(),
          note: "Synthetic published metadata",
          sources: [
            ["v1", "c"],
            ["v1", "d"],
            ["different-name", "e"],
          ].map(([name, digit]) => ({
            schema: 1,
            agent: "class",
            name,
            hash: digit.repeat(64),
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
          })),
        },
      });
    if (path === "/api/admin/exams" || path === "/api/admin/exams/versioned") {
      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON();
        state.writes.push(body);
        state.paths.push(path);
        if (state.oldGateway && path.endsWith("/versioned"))
          return route.fulfill({
            status: 404,
            json: {
              error:
                "Versioned definition workflow unavailable; update matching gateway before retrying",
            },
          });
        if (body.template_version && body.template !== "v1")
          return route.fulfill({
            status: 404,
            json: {
              error:
                "No authenticated source attestation for this exact name/hash",
            },
          });
        if (conflict) {
          state.definition = {
            ...state.definition,
            name: "Remote edit",
            revision: "b".repeat(64),
          };
          return route.fulfill({
            status: 409,
            json: {
              error:
                "Exam definition changed; reload current settings and review differences",
            },
          });
        }
        if (state.writes.length === 1) return route.abort("failed");
        const { requestID: _request, ...saved } = body;
        if (!saved.template_version) delete saved.template_version;
        state.definition = { ...saved, revision: "b".repeat(64) };
        return route.fulfill({ json: state.definition });
      }
      return route.fulfill({ json: [state.definition] });
    }
    return route.fulfill({
      json: {
        serverNow: Date.now(),
        students: [],
        total: 0,
        counts: {
          students: 0,
          working: 0,
          attention: 0,
          active: 0,
          locked: 0,
          protected: 0,
        },
        incidents: [],
      },
    });
  });
  await page.goto("/");
  await page.getByLabel("Selected exam", { exact: true }).selectOption(examID);
  await page
    .getByRole("button", { name: "Exam defaults", exact: true })
    .click();
  if (!version)
    await page
      .getByRole("dialog")
      .getByRole("combobox", { name: "Exam files", exact: true })
      .selectOption(`v1@${"c".repeat(64)}`);
  return state;
}

test("sandbox exposes an explicit finite window without inventing legacy defaults", async ({
  page,
}) => {
  const s = await fixture(page, false, "sandbox", true);
  const dialog = page.getByRole("dialog", {
    name: "Exam defaults",
    exact: true,
  });
  await expect(dialog.getByLabel("Opens")).toHaveValue("");
  await expect(dialog.getByLabel("Closes")).toHaveValue("");
  await expect(
    dialog.getByLabel("Default webcam requirement"),
  ).not.toBeChecked();
  await expect(dialog.getByLabel("Default webcam requirement")).toBeDisabled();
  await dialog.getByLabel("Opens").fill("2026-10-22T09:00");
  await dialog.getByLabel("Closes").fill("2026-10-22T17:00");
  await dialog
    .getByRole("button", { name: "Save defaults", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog
    .getByRole("button", { name: "Save defaults", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(s.writes[0].earliest).toBeGreaterThan(0);
  expect(s.writes[0].latest - s.writes[0].earliest).toBe(8 * 3600000);
  expect(s.writes[1]).toEqual(s.writes[0]);
});

test("exact source survives a lost save and name edits never silently clear the hash", async ({
  page,
}) => {
  const s = await fixture(page),
    hash = "c".repeat(64);
  let dialog = page.getByRole("dialog", { name: "Exam defaults", exact: true });
  await dialog
    .getByRole("combobox", { name: "Exam files", exact: true })
    .selectOption(`v1@${hash}`);
  await dialog
    .getByRole("button", { name: "Save defaults", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(
    dialog.getByRole("combobox", { name: "Exam files", exact: true }),
  ).toHaveValue(`v1@${hash}`);
  await dialog
    .getByRole("button", { name: "Save defaults", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(s.paths).toEqual([
    "/api/admin/exams/versioned",
    "/api/admin/exams/versioned",
  ]);
  expect(s.writes[1]).toEqual(s.writes[0]);
  await page
    .getByRole("button", { name: "Exam defaults", exact: true })
    .click();
  dialog = page.getByRole("dialog", { name: "Exam defaults", exact: true });
  await expect(
    dialog.getByRole("combobox", { name: "Exam files", exact: true }),
  ).toHaveValue(`v1@${hash}`);
  await dialog
    .getByRole("combobox", { name: "Exam files", exact: true })
    .selectOption(`different-name@${"e".repeat(64)}`);
  await dialog
    .getByRole("button", { name: "Save defaults", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("exact name/hash");
  await expect(
    dialog.getByRole("combobox", { name: "Exam files", exact: true }),
  ).toHaveValue(`different-name@${"e".repeat(64)}`);
  expect(s.paths.at(-1)).toBe("/api/admin/exams/versioned");
  expect(s.definition.template).toBe("v1");
});

test("selecting a different published version changes only the future source and stays retryable", async ({
  page,
}) => {
  const s = await fixture(page, false, "midterm", false, "c".repeat(64));
  const dialog = page.getByRole("dialog", {
    name: "Exam defaults",
    exact: true,
  });
  await dialog
    .getByRole("combobox", { name: "Exam files", exact: true })
    .selectOption(`v1@${"d".repeat(64)}`);
  await dialog
    .getByRole("button", { name: "Save defaults", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog
    .getByRole("button", { name: "Save defaults", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(s.writes[0].template_version).toBe("d".repeat(64));
  expect(s.writes[1]).toEqual(s.writes[0]);
  expect(s.paths).toEqual([
    "/api/admin/exams/versioned",
    "/api/admin/exams/versioned",
  ]);
  expect(s.definition.template_version).toBe("d".repeat(64));
});

test("versioned creation refuses an old gateway without falling back to mutable creation", async ({
  page,
}) => {
  const s = await fixture(page);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  s.oldGateway = true;
  await page.getByRole("button", { name: "New exam", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New exam", exact: true });
  await dialog.getByLabel("Exam ID", { exact: true }).fill("new-versioned");
  await dialog
    .getByRole("combobox", { name: "Exam files", exact: true })
    .selectOption(`v1@${"c".repeat(64)}`);
  await dialog.getByRole("button", { name: "Save exam", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("matching gateway");
  expect(s.paths).toEqual(["/api/admin/exams/versioned"]);
  expect(s.definition.id).toBe("midterm");
  await expect(
    dialog.getByRole("combobox", { name: "Exam files", exact: true }),
  ).toHaveValue(`v1@${"c".repeat(64)}`);
});

test("lost definition reply preserves form and reuses the same revision/request on retry", async ({
  page,
}) => {
  const s = await fixture(page);
  const dialog = page.getByRole("dialog", {
    name: "Exam defaults",
    exact: true,
  });
  await dialog.getByLabel("Name", { exact: true }).fill("Edited midterm");
  await dialog.getByText("File limits", { exact: true }).first().click();
  await expect(dialog.getByLabel("Maximum file size (MiB)")).toHaveValue("128");
  await expect(dialog.getByLabel("Maximum total size (MiB)")).toHaveValue(
    "512",
  );
  await dialog.getByLabel("Maximum file size (MiB)").fill("256");
  await dialog.getByLabel("Maximum total size (MiB)").fill("1024");
  await dialog
    .getByRole("button", { name: "Save defaults", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue(
    "Edited midterm",
  );
  await dialog
    .getByRole("button", { name: "Save defaults", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(s.writes).toHaveLength(2);
  expect(s.writes[1]).toEqual(s.writes[0]);
  expect(s.writes[0].requestID).toMatch(/^[a-f0-9-]{36}$/);
  expect(s.writes[0]).toMatchObject({
    revision: "a".repeat(64),
    duration: 7200,
    webcam: false,
    terminals: 2,
    collection_file_mib: 256,
    collection_total_mib: 1024,
  });
});

test("stale revision leaves edits visible and changed input gets a new intent without silently adopting a newer revision", async ({
  page,
}) => {
  const s = await fixture(page, true);
  const dialog = page.getByRole("dialog", {
    name: "Exam defaults",
    exact: true,
  });
  await dialog.getByLabel("Name", { exact: true }).fill("Unsaved edit");
  await dialog
    .getByRole("button", { name: "Save defaults", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "reload current settings",
  );
  await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue(
    "Unsaved edit",
  );
  await dialog.getByLabel("Name", { exact: true }).fill("Reviewed edit");
  await dialog
    .getByRole("button", { name: "Save defaults", exact: true })
    .click();
  await expect.poll(() => s.writes.length).toBe(2);
  expect(s.writes[1].requestID).not.toBe(s.writes[0].requestID);
  expect(s.writes[1].revision).toBe("a".repeat(64));
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.reload();
  await page
    .getByLabel("Selected exam", { exact: true })
    .selectOption("midterm");
  await page
    .getByRole("button", { name: "Exam defaults", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByLabel("Name", { exact: true }),
  ).toHaveValue("Remote edit");
});
