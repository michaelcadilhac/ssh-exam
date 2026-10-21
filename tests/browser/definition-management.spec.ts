import { test, expect, type Page } from "@playwright/test";

async function fixture(page: Page, conflict = false) {
  const state = {
    definition: {
      id: "midterm",
      name: "Midterm",
      template: "v1",
      duration: 7200,
      webcam: false,
      terminals: 2,
      earliest: Date.now() - 60000,
      latest: Date.now() + 3600000,
      revision: "a".repeat(64),
    },
    writes: [] as any[],
  };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/session")
      return route.fulfill({
        json: { role: "admin", username: "instructor", csrf: "fixture" },
      });
    if (path === "/api/login-test")
      return route.fulfill({ json: { loginOnly: false } });
    if (path === "/api/admin/exams") {
      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON();
        state.writes.push(body);
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
  await page
    .getByLabel("Selected exam", { exact: true })
    .selectOption("midterm");
  await page
    .getByRole("button", { name: "Exam settings", exact: true })
    .click();
  return state;
}

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
