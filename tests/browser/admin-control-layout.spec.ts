import { expect, test, type Locator, type Page } from "@playwright/test";
import { publishedSource } from "./prof-workflow-fixture.js";
import { templateCatalogPageResult } from "../../packages/protocol/template-catalog.js";

async function fixture(page: Page) {
  page.setDefaultTimeout(7000);
  const now = Date.now(),
    exam = "control-layout",
    username = "layout_student",
    settings = {
      id: exam,
      name: "Programming systems midterm with a deliberately long published exam description",
      template: "programming-starter-files-for-systems-midterm",
      template_version: "a".repeat(64),
      duration: 5400,
      webcam: true,
      terminals: 4,
      collection_file_mib: 128,
      collection_total_mib: 512,
      earliest: now - 60000,
      latest: now + 3600000,
      revision: "c".repeat(64),
    },
    grant = {
      id: "11111111-1111-4111-8111-111111111111",
      exam,
      username,
      revision: 1,
      status: "AVAILABLE",
      actor: "layout_instructor",
      claims: [],
      issuance: "ADDITIONAL_TEMPLATE",
      issuance_order: 1,
      issued_at: now - 60000,
      settings,
      work: {
        kind: "template",
        name: settings.template,
        hash: settings.template_version,
      },
    },
    sources = [1, 2].map((number) => ({
      id: `22222222-2222-4222-8222-${String(number).padStart(12, "0")}`,
      exam,
      username,
      uid: 10001,
      state: "COMPLETED",
      protected: 1,
      checksum: "b".repeat(64),
      start: now - 7200000 + number * 1000,
      deadline: now - 3600000 + number * 1000,
      original_deadline: now - 3600000 + number * 1000,
      settings,
      attempt_number: number,
    }));
  const state = {
    sourceReads: 0,
    statusReads: 0,
    mutations: [] as string[],
    sourceGate: null as Promise<void> | null,
  };
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname;
    if (path === "/api/session")
      return route.fulfill({
        json: { role: "admin", username: "layout_instructor", csrf: "fixture" },
      });
    if (path === "/api/login-test")
      return route.fulfill({ json: { loginOnly: false, browserSSH: true } });
    if (path === "/api/admin/exams")
      return route.fulfill({
        json: [
          settings,
          {
            ...settings,
            id: "earlier-control-layout",
            name: "A second archived programming systems exam with long starter-file descriptions",
            lifecycle: "archived",
          },
        ],
      });
    if (path === "/api/admin/templates")
      return route.fulfill({
        json: templateCatalogPageResult.parse({
          agent: "class",
          sources: [publishedSource(settings.template)],
          next: null,
          observed: now,
          note: "Synthetic authenticated source metadata for layout checks.",
        }),
      });
    if (path.endsWith("/dashboard"))
      return route.fulfill({
        json: {
          serverNow: now,
          students: [
            {
              username,
              enrollment: { duration: null, webcam: null },
              attempts: [],
            },
          ],
          total: 1,
          counts: { students: 1 },
          incidents: [],
        },
      });
    if (path.endsWith("/grants"))
      return route.fulfill({ json: { grants: [grant], next: null } });
    if (path.endsWith("/grants/status")) {
      state.statusReads++;
      return route.fulfill({
        json: {
          rows: request.postDataJSON().rows.map((ref: any) => ({
            id: grant.id,
            revision: ref.revision,
            current_revision: 1,
            grant_status: "AVAILABLE",
            status: "NOT_QUEUED",
            tries: 0,
            error: "",
            grant,
            source: null,
          })),
        },
      });
    }
    if (path.endsWith("/attempts")) {
      state.sourceReads++;
      const gate = state.sourceGate;
      state.sourceGate = null;
      if (gate) await gate;
      return route.fulfill({
        json: { attempts: sources, scanned: sources.length, next: null },
      });
    }
    if (path === `/api/admin/grants/${grant.id}`)
      return route.fulfill({
        json: { ...grant, history: [], history_next: null },
      });
    if (path.endsWith("/grant-reviews"))
      return route.fulfill({ json: { rows: [], next: null } });
    if (request.method() !== "GET") state.mutations.push(path);
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto("/admin");
  await page
    .getByRole("combobox", { name: "Selected exam", exact: true })
    .selectOption(exam);
  const personal = async () => {
    await page
      .getByRole("button", {
        name: `Actions for student ${username}`,
        exact: true,
      })
      .click({ timeout: 3000 });
    await page
      .getByRole("menuitem", { name: "Allowed attempts…", exact: true })
      .click({ timeout: 3000 });
    const dialog = page.getByRole("dialog", {
      name: `Allowed attempts for ${username}`,
      exact: true,
    });
    await dialog
      .getByRole("button", { name: "Edit settings", exact: true })
      .click({ timeout: 3000 });
    await expect(
      dialog.getByRole("combobox", { name: "Webcam", exact: true }),
    ).toBeVisible();
    return dialog;
  };
  return { username, state, personal };
}

async function contained(dialog: Locator) {
  const overflow = await dialog.evaluate((root) => {
    const problems: string[] = [];
    for (const region of [
      root,
      ...root.querySelectorAll<HTMLElement>(
        ".grant-dialog-content, form, fieldset",
      ),
    ]) {
      if (!region.getClientRects().length) continue;
      if (region.scrollWidth > region.clientWidth + 1)
        problems.push(
          `${region.tagName}: ${region.scrollWidth}>${region.clientWidth}`,
        );
    }
    const bounds = root.getBoundingClientRect();
    if (bounds.left < -1 || bounds.right > innerWidth + 1)
      problems.push("Dialog outside viewport");
    for (const field of root.querySelectorAll<HTMLElement>(
      "input, select, textarea, fieldset",
    )) {
      if (!field.getClientRects().length) continue;
      const rect = field.getBoundingClientRect();
      if (rect.left < bounds.left - 1 || rect.right > bounds.right + 1)
        problems.push(`${field.tagName}: outside dialog`);
    }
    for (const label of root.querySelectorAll("label")) {
      const select = label.querySelector(":scope > select");
      if (!select?.getClientRects().length) continue;
      const text = [...label.childNodes].find(
        (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
      );
      if (!text) continue;
      const range = document.createRange();
      range.selectNodeContents(text);
      if (
        range.getBoundingClientRect().bottom >
        select.getBoundingClientRect().top + 1
      )
        problems.push(`Label beside select: ${text.textContent?.trim()}`);
    }
    return problems;
  });
  expect(overflow).toEqual([]);
}

for (const width of [320, 375, 430])
  test(`instructor attempt controls and nested file/date fields fit ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const f = await fixture(page),
      dialog = await f.personal();
    await expect(dialog.getByLabel("Opens", { exact: true })).toBeVisible();
    await dialog
      .getByText("More settings", { exact: true })
      .click({ timeout: 3000 });
    await dialog
      .getByRole("combobox", { name: "Starting files", exact: true })
      .selectOption("saved");
    await expect(
      dialog.getByRole("combobox", {
        name: `Saved work for ${f.username}`,
        exact: true,
      }),
    ).toBeVisible();
    const selectedFiles = dialog
      .locator("p")
      .filter({ hasText: /^Selected files:/ });
    await expect(selectedFiles).toBeVisible();
    await expect(selectedFiles).toContainText("control-layout");
    await expect(selectedFiles).toContainText("Attempt 2");
    expect(
      await selectedFiles.evaluate(
        (element) =>
          element.scrollWidth <= element.clientWidth + 1 &&
          element.scrollHeight <= element.clientHeight + 1,
      ),
    ).toBe(true);
    await contained(dialog);
    await page.screenshot({
      path: info.outputPath(`attempt-controls-${width}.png`),
      fullPage: true,
    });
    await selectedFiles.scrollIntoViewIfNeeded({ timeout: 3000 });
    await expect(selectedFiles).toBeInViewport({ timeout: 3000 });
    await page.screenshot({
      path: info.outputPath(`selected-files-${width}.png`),
      fullPage: true,
    });
    expect(f.state.mutations).toEqual([]);
  });

test("narrow additional-attempt form controls fit without changing permissions", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 900 });
  const f = await fixture(page);
  await page
    .getByRole("checkbox", {
      name: `Select student ${f.username}`,
      exact: true,
    })
    .check({ timeout: 3000 });
  await page
    .getByRole("button", { name: "Selected students", exact: true })
    .click({ timeout: 3000 });
  await page
    .getByRole("menuitem", { name: "Allow another attempt", exact: true })
    .click({ timeout: 3000 });
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Opens", { exact: true })).toBeVisible();
  await contained(dialog);
  expect(f.state.mutations).toEqual([]);
});

test("refresh icon has a readable name and touch target, supports keyboard and never submits its form", async ({
  page,
}) => {
  const f = await fixture(page),
    dialog = await f.personal();
  await dialog
    .getByRole("combobox", { name: "Starting files", exact: true })
    .selectOption("saved");
  await expect(
    dialog.getByRole("combobox", {
      name: `Saved work for ${f.username}`,
      exact: true,
    }),
  ).toBeVisible();
  const refresh = dialog.getByRole("button", {
    name: "Refresh saved work",
    exact: true,
  });
  await expect(refresh).toHaveAttribute("title", "Refresh saved work");
  await expect(refresh).toHaveAttribute("type", "button");
  await expect(refresh.locator("svg[aria-hidden='true']")).toHaveCount(1);
  await expect(refresh).toHaveText("");
  const size = await refresh.boundingBox();
  expect(size?.width).toBeGreaterThanOrEqual(44);
  expect(size?.height).toBeGreaterThanOrEqual(44);
  await refresh.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(refresh).toBeFocused();
  await expect(refresh).toHaveCSS("outline-style", "solid");
  const reads = f.state.sourceReads,
    statuses = f.state.statusReads;
  let release!: () => void;
  f.state.sourceGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.keyboard.press("Enter");
  await expect.poll(() => f.state.sourceReads).toBe(reads + 1);
  await expect(refresh).toBeDisabled();
  await page.keyboard.press("Enter");
  release();
  await expect(refresh).toBeEnabled();
  expect(f.state.sourceReads).toBe(reads + 1);
  expect(f.state.statusReads).toBe(statuses);
  expect(f.state.mutations).toEqual([]);
  await expect(
    dialog.getByRole("region", { name: "Review unused changes", exact: true }),
  ).toHaveCount(0);
});
