import { test, expect, type Page } from "@playwright/test";
import { join } from "node:path";

const source = (n: number, name = "midterm") => ({
  schema: 1,
  agent: "class",
  name,
  hash: n.toString(16).padStart(64, "0"),
  entries: 4,
  files: 2,
  bytes: 30,
  max_file_bytes: 20,
  first_native_created: 1000,
  last_native_created: 1000,
  first_acknowledged_at: 0,
  last_attested_at: Date.UTC(2026, 9, 22, 14),
  last_acknowledged_at: Date.UTC(2026, 9, 22, 14, 0, 1),
  last_request: "12345678-1234-4234-8234-123456789abc",
  revision: "b".repeat(64),
});
const key = (s: ReturnType<typeof source>) => s.name + "@" + s.hash;
async function fixture(
  page: Page,
  options: { many?: boolean; wrongDetail?: boolean; empty?: boolean } = {},
) {
  const state = { writes: [] as string[], reads: [] as string[], fail: false };
  const sources = options.empty
    ? []
    : options.many
      ? Array.from({ length: 51 }, (_, i) => source(i + 1))
      : [source(1, "final"), source(2)];
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname;
    if (request.method() !== "GET") state.writes.push(path);
    if (path === "/api/session")
      return route.fulfill({
        json: { role: "admin", username: "instructor", csrf: "fixture" },
      });
    if (path === "/api/login-test")
      return route.fulfill({ json: { loginOnly: false } });
    if (path === "/api/admin/exams")
      return route.fulfill({ json: [{ id: "sandbox", name: "Sandbox" }] });
    if (path === "/api/admin/templates") {
      state.reads.push(request.url());
      if (state.fail)
        return route.fulfill({
          status: 503,
          json: { error: "Synthetic catalog unavailable" },
        });
      const filtered = sources.filter(
        (s) =>
          (!url.searchParams.get("name") ||
            s.name === url.searchParams.get("name")) &&
          key(s) > (url.searchParams.get("after") || ""),
      );
      const limit = Number(url.searchParams.get("limit"));
      const rows = filtered.slice(0, limit);
      return route.fulfill({
        json: {
          agent: "class",
          sources: rows,
          next: filtered.length > limit ? key(rows.at(-1)!) : null,
          observed: Date.UTC(2026, 9, 22, 14, 1),
          note: "Timestamped metadata, not a live filesystem probe",
        },
      });
    }
    if (path.startsWith("/api/admin/templates/")) {
      state.reads.push(request.url());
      const parts = path.split("/");
      const item = sources.find(
        (s) => s.name === parts[4] && s.hash === parts[5],
      )!;
      return route.fulfill({
        json: {
          agent: "class",
          source: {
            ...item,
            ...(options.wrongDetail ? { hash: "f".repeat(64) } : {}),
          },
          observed: Date.UTC(2026, 9, 22, 14, 2),
          note: "As-of source attestation",
        },
      });
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
    .getByRole("button", { name: "Administration", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Starter files", exact: true })
    .click();
  return {
    state,
    sources,
    dialog: page.getByRole("dialog", { name: "Starter files", exact: true }),
  };
}

test("catalog inspection is read-only, exact-version scoped, timestamped and accessible without changing exam defaults", async ({
  page,
}) => {
  const { state, sources, dialog } = await fixture(page);
  await expect(dialog.getByRole("table")).toBeVisible();
  await expect(dialog).toContainText(
    "Starter files are verified again before an exam starts",
  );
  expect(state.writes).toEqual([]);
  await dialog
    .getByRole("button", {
      name: new RegExp(`^Details for ${sources[1].name} published `),
      exact: true,
    })
    .click();
  const detail = dialog.getByRole("region", { name: "Starter details" });
  await expect(detail).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Back", exact: true }),
  ).toBeFocused();
  await expect(
    detail.getByRole("heading", { name: "midterm", exact: true }),
  ).toBeInViewport();
  await detail.getByText("Technical details", { exact: true }).click();
  await expect(detail).toContainText(sources[1].hash);
  await expect(detail).toContainText("1969");
  await expect(detail).toContainText("CDT");
  await expect(detail).toContainText(
    `sudo examctl templates sync midterm ${sources[1].hash}`,
  );
  const screenshots = process.env.EXAM_CATALOG_SCREENSHOT_DIR;
  if (screenshots) {
    expect(screenshots).toMatch(/^\/tmp\/ssh-exam-catalog-ui-/);
    await page.screenshot({ path: join(screenshots, "desktop.png") });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(391);
  if (screenshots)
    await page.screenshot({ path: join(screenshots, "mobile.png") });
  await dialog.getByRole("button", { name: "Back", exact: true }).click();
  await expect(
    dialog.getByRole("button", {
      name: new RegExp(`^Details for ${sources[1].name} published `),
      exact: true,
    }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Administration", exact: true }),
  ).toBeFocused();
  expect(state.writes).toEqual([]);
});

test("source pages retain exact cursor/filter and return to earlier pages without selection or writes", async ({
  page,
}) => {
  const { state, dialog } = await fixture(page, { many: true });
  await expect(dialog.getByRole("row")).toHaveCount(51);
  await dialog.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(dialog.getByRole("row")).toHaveCount(2);
  await expect(dialog).toContainText("Page 2");
  expect(state.reads.at(-1)).toContain("after=midterm%40");
  await dialog
    .getByRole("button", { name: "Previous page", exact: true })
    .click();
  await expect(dialog.getByRole("row")).toHaveCount(51);
  await dialog.getByLabel("Starter name", { exact: true }).fill("bad/name");
  await dialog.getByRole("button", { name: "Filter", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "letters, numbers, underscores or hyphens",
  );
  await dialog.getByLabel("Starter name", { exact: true }).fill("absent");
  await dialog.getByRole("button", { name: "Filter", exact: true }).click();
  await expect(dialog).toContainText(
    "No published starter files match this name",
  );
  expect(state.reads.at(-1)).toContain("name=absent");
  expect(state.reads.at(-1)).not.toContain("after=");
  expect(state.writes).toEqual([]);
});

test("wrong-target details refuse without exposing an unrelated source", async ({
  page,
}) => {
  const { sources, dialog } = await fixture(page, { wrongDetail: true });
  await dialog
    .getByRole("button", {
      name: new RegExp(`^Details for ${sources[0].name} published `),
      exact: true,
    })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "does not match the selected exact source",
  );
  await expect(
    dialog.getByRole("region", { name: "Starter details" }),
  ).toHaveCount(0);
  await expect(dialog).not.toContainText("f".repeat(64));
});

test("unavailable metadata can be retried and empty state distinguishes local installation from acknowledgement", async ({
  page,
}) => {
  const { state, dialog } = await fixture(page, { empty: true });
  await expect(dialog).toContainText("No published starter files yet");
  state.fail = true;
  await dialog.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Synthetic catalog unavailable",
  );
  state.fail = false;
  await dialog.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect(dialog).toContainText("No published starter files yet");
  expect(state.writes).toEqual([]);
});
