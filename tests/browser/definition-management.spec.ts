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
    .getByRole("button", { name: "Exam settings", exact: true })
    .click();
  return state;
}

test("sandbox exposes an explicit finite window without inventing legacy defaults", async ({
  page,
}) => {
  const s = await fixture(page, false, "sandbox", true);
  const dialog = page.getByRole("dialog", {
    name: "Exam settings",
    exact: true,
  });
  await expect(dialog.getByLabel("Earliest start")).toHaveValue("");
  await expect(dialog.getByLabel("Latest start")).toHaveValue("");
  await expect(
    dialog.getByLabel("Default webcam requirement"),
  ).not.toBeChecked();
  await expect(dialog.getByLabel("Default webcam requirement")).toBeDisabled();
  await dialog.getByLabel("Earliest start").fill("2026-10-22T09:00");
  await dialog.getByLabel("Latest start").fill("2026-10-22T17:00");
  await dialog.getByRole("button", { name: "Save exam", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog.getByRole("button", { name: "Save exam", exact: true }).click();
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
  let dialog = page.getByRole("dialog", { name: "Exam settings", exact: true });
  await dialog.getByLabel("Immutable template hash (optional)").fill(hash);
  await dialog.getByRole("button", { name: "Save exam", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(
    dialog.getByLabel("Immutable template hash (optional)"),
  ).toHaveValue(hash);
  await dialog.getByRole("button", { name: "Save exam", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(s.paths).toEqual([
    "/api/admin/exams/versioned",
    "/api/admin/exams/versioned",
  ]);
  expect(s.writes[1]).toEqual(s.writes[0]);
  await page
    .getByRole("button", { name: "Exam settings", exact: true })
    .click();
  dialog = page.getByRole("dialog", { name: "Exam settings", exact: true });
  await expect(
    dialog.getByLabel("Immutable template hash (optional)"),
  ).toHaveValue(hash);
  await dialog
    .getByLabel("Materials template", { exact: true })
    .fill("different-name");
  await dialog.getByRole("button", { name: "Save exam", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("exact name/hash");
  await expect(
    dialog.getByLabel("Immutable template hash (optional)"),
  ).toHaveValue(hash);
  expect(s.paths.at(-1)).toBe("/api/admin/exams/versioned");
  expect(s.definition.template).toBe("v1");
});

test("explicit legacy default selection clears only the future hash and stays retryable", async ({
  page,
}) => {
  const s = await fixture(page, false, "midterm", false, "c".repeat(64));
  const dialog = page.getByRole("dialog", {
    name: "Exam settings",
    exact: true,
  });
  await dialog.getByLabel("Immutable template hash (optional)").fill("");
  await dialog.getByRole("button", { name: "Save exam", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog.getByRole("button", { name: "Save exam", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(s.writes[0].template_version).toBe("");
  expect(s.writes[1]).toEqual(s.writes[0]);
  expect(s.paths).toEqual(["/api/admin/exams", "/api/admin/exams"]);
  expect(s.definition).not.toHaveProperty("template_version");
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
  await dialog.getByLabel("Materials template", { exact: true }).fill("v1");
  await dialog
    .getByLabel("Immutable template hash (optional)")
    .fill("c".repeat(64));
  await dialog.getByRole("button", { name: "Save exam", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("matching gateway");
  expect(s.paths).toEqual(["/api/admin/exams/versioned"]);
  expect(s.definition.id).toBe("midterm");
  await expect(
    dialog.getByLabel("Immutable template hash (optional)"),
  ).toHaveValue("c".repeat(64));
});

test("lost definition reply preserves form and reuses the same revision/request on retry", async ({
  page,
}) => {
  const s = await fixture(page);
  const dialog = page.getByRole("dialog", {
    name: "Exam settings",
    exact: true,
  });
  await dialog.getByLabel("Name", { exact: true }).fill("Edited midterm");
  await expect(dialog.getByLabel("Maximum file (MiB)")).toHaveValue("128");
  await expect(dialog.getByLabel("Maximum submission (MiB)")).toHaveValue(
    "512",
  );
  await dialog.getByLabel("Maximum file (MiB)").fill("256");
  await dialog.getByLabel("Maximum submission (MiB)").fill("1024");
  await dialog.getByRole("button", { name: "Save exam", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue(
    "Edited midterm",
  );
  await dialog.getByRole("button", { name: "Save exam", exact: true }).click();
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
    name: "Exam settings",
    exact: true,
  });
  await dialog.getByLabel("Name", { exact: true }).fill("Unsaved edit");
  await dialog.getByRole("button", { name: "Save exam", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "reload current settings",
  );
  await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue(
    "Unsaved edit",
  );
  await dialog.getByLabel("Name", { exact: true }).fill("Reviewed edit");
  await dialog.getByRole("button", { name: "Save exam", exact: true }).click();
  await expect.poll(() => s.writes.length).toBe(2);
  expect(s.writes[1].requestID).not.toBe(s.writes[0].requestID);
  expect(s.writes[1].revision).toBe("a".repeat(64));
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.reload();
  await page
    .getByLabel("Selected exam", { exact: true })
    .selectOption("midterm");
  await page
    .getByRole("button", { name: "Exam settings", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByLabel("Name", { exact: true }),
  ).toHaveValue("Remote edit");
});
