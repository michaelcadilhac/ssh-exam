import { expect, test, type Page } from "@playwright/test";
import { publishedSource } from "./prof-workflow-fixture.js";

test.use({ timezoneId: "America/Chicago" });

async function fixture(
  page: Page,
  options: {
    dropFirst?: boolean;
    consumeAfterDrop?: boolean;
    seconds?: boolean;
    webcam?: boolean;
    history?: boolean;
    templateName?: string;
  } = {},
) {
  page.setDefaultTimeout(6000);
  const now = Date.now(),
    exam = "next-cell-editor",
    settings = {
      id: exam,
      name: "Midterm",
      template: options.templateName ?? "sample-exam",
      template_version: "a".repeat(64),
      duration: options.seconds ? 95 : 5400,
      webcam: options.webcam ?? true,
      terminals: 4,
      collection_file_mib: 128,
      collection_total_mib: 512,
      earliest: now - 60000 + 123,
      latest: now + 3600000 + 456,
    };
  const grant = {
    id: "11111111-1111-4111-8111-111111111111",
    exam,
    username: "amy",
    revision: 1,
    status: "AVAILABLE",
    issuance: "ADDITIONAL_TEMPLATE",
    issuance_order: 2,
    actor: "instructor",
    issued_at: now - 10000,
    settings,
    work: { kind: "template", name: settings.template, hash: "a".repeat(64) },
    claims: [] as { state: string }[],
  };
  const state = {
    grant,
    writes: [] as any[],
    mutations: 0,
    statusReads: 0,
    historyReads: 0,
    sourceReads: 0,
    actor: "instructor",
    failStatus: false,
    attempts: [] as any[],
  };
  const historicalGrant = {
    ...structuredClone(grant),
    id: "44444444-4444-4444-8444-444444444444",
    status: "CONSUMED",
    issuance_order: 1,
    issued_at: now - 7200000,
    claims: [{ state: "CONSUMED" }],
  };
  if (options.history)
    state.attempts.push({
      id: "55555555-5555-4555-8555-555555555555",
      exam,
      username: grant.username,
      uid: 10001,
      state: "COMPLETED",
      protected: 1,
      checksum: "c".repeat(64),
      settings: JSON.stringify(historicalGrant.settings),
      start: now - 7200000,
      deadline: now - 3600000,
      original_deadline: now - 3600000,
      ended: now - 3600000,
      preflight_started_at: now - 7210000,
      generation: 1,
      attempt_number: 1,
      access_state: "RELEASED",
      terminalCount: 0,
      grantContext: { ...historicalGrant, state: "recorded" },
    });
  const replies = new Map<string, any>();
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname;
    if (path === "/api/session")
      return route.fulfill({
        json: { role: "admin", username: state.actor, csrf: "fixture" },
      });
    if (path === "/api/login-test")
      return route.fulfill({ json: { loginOnly: false, browserSSH: false } });
    if (path === "/api/admin/exams")
      return route.fulfill({
        json: [{ ...settings, revision: "b".repeat(64), lifecycle: "active" }],
      });
    if (path === "/api/admin/templates")
      return route.fulfill({
        json: {
          agent: "class",
          sources: [publishedSource(settings.template)],
          next: null,
          observed: now,
          note: "Synthetic published files",
        },
      });
    if (path.endsWith("/dashboard"))
      return route.fulfill({
        json: {
          serverNow: now,
          students: [
            {
              username: grant.username,
              enrollment: {
                exam,
                username: grant.username,
                webcam: null,
                duration: null,
              },
              removable: false,
              hasNextAttempt: ["AVAILABLE", "PENDING_NATIVE"].includes(
                grant.status,
              ),
              latestSettings: grant.settings,
              unusedAttempt:
                ["AVAILABLE", "PENDING_NATIVE"].includes(grant.status) &&
                !grant.claims.length
                  ? grant
                  : null,
              attempts: state.attempts,
            },
          ],
          total: 1,
          counts: { students: 1 },
          incidents: [],
        },
      });
    if (path.endsWith("/grants"))
      return route.fulfill({
        json: {
          grants:
            url.searchParams.get("next_only") === "true" &&
            !["AVAILABLE", "PENDING_NATIVE"].includes(grant.status)
              ? []
              : [
                  grant,
                  ...(options.history &&
                  url.searchParams.get("next_only") !== "true"
                    ? [historicalGrant]
                    : []),
                ],
          next: null,
        },
      });
    if (path.endsWith("/grants/status")) {
      state.statusReads++;
      if (state.failStatus)
        return route.fulfill({
          status: 503,
          json: { error: "Synthetic fresh status unavailable" },
        });
      return route.fulfill({
        json: {
          rows: request.postDataJSON().rows.map((ref: any) => ({
            id: grant.id,
            revision: ref.revision,
            current_revision: grant.revision,
            grant_status: grant.status,
            status: "NOT_QUEUED",
            tries: 0,
            error: "",
            grant,
            source: null,
          })),
        },
      });
    }
    if (path.endsWith("/grants/change")) {
      const body = request.postDataJSON();
      state.writes.push(body);
      const results = body.rows.map((row: any) => {
        if (replies.has(row.body.request)) return replies.get(row.body.request);
        expect(row.id).toBe(grant.id);
        expect(row.body.revision).toBe(grant.revision);
        expect(grant.claims).toEqual([]);
        state.mutations++;
        if (row.operation === "revoke") grant.status = "REVOKED";
        else {
          grant.revision++;
          grant.settings = { ...grant.settings, ...row.body.changes };
          if (row.body.work) grant.work = row.body.work;
        }
        const result = {
          id: grant.id,
          request: row.body.request,
          outcome: "saved",
          grant: structuredClone(grant),
        };
        replies.set(row.body.request, result);
        return result;
      });
      if (options.dropFirst && state.writes.length === 1) {
        if (options.consumeAfterDrop) {
          grant.status = "CONSUMED";
          grant.claims = [{ state: "CONSUMED" }];
          state.attempts = [
            {
              id: "22222222-2222-4222-8222-222222222222",
              exam,
              username: grant.username,
              uid: 10001,
              state: "COMPLETED",
              protected: 1,
              checksum: "c".repeat(64),
              settings: JSON.stringify(grant.settings),
              start: now - 7200000,
              deadline: now - 3600000,
              original_deadline: now - 3600000,
              ended: now - 3600000,
              preflight_started_at: now - 7210000,
              generation: 1,
              attempt_number: 1,
              access_state: "RELEASED",
              terminalCount: 0,
              grantContext: { state: "legacy" },
            },
          ];
        }
        return route.abort("failed");
      }
      return route.fulfill({ json: { results } });
    }
    if (path.startsWith("/api/admin/grants/")) {
      state.historyReads++;
      return route.fulfill({
        json: {
          ...(path.endsWith(historicalGrant.id) ? historicalGrant : grant),
          history: [],
          history_next: null,
        },
      });
    }
    if (path.endsWith("/attempts")) {
      state.sourceReads++;
      return route.fulfill({
        json: {
          attempts: state.attempts,
          scanned: state.attempts.length,
          next: null,
        },
      });
    }
    return route.fulfill({
      status: 404,
      json: { error: "Unexpected synthetic request" },
    });
  });
  await page.goto("/admin");
  await page
    .getByRole("combobox", { name: "Selected exam", exact: true })
    .selectOption(exam);
  const edit = async (
    field: "time limit" | "webcam" | "start dates" | "starting files",
  ) => {
    await page
      .getByRole("button", { name: `Change ${field} for amy`, exact: true })
      .click();
    return field === "starting files"
      ? page.getByRole("dialog", {
          name: "Starting files for amy",
          exact: true,
        })
      : page.getByRole("region", {
          name: `${field[0].toUpperCase()}${field.slice(1)} for amy`,
          exact: true,
        });
  };
  return { state, edit, initial: structuredClone(grant) };
}

test("an inline time cell is prefilled, shows only time and saves one fresh change without a dialog", async ({
  page,
}) => {
  const f = await fixture(page),
    editor = await f.edit("time limit");
  await expect(
    editor.getByLabel("Time limit (minutes)", { exact: true }),
  ).toHaveValue("90");
  await expect(
    editor.getByRole("combobox", { name: "Webcam", exact: true }),
  ).toHaveCount(0);
  await expect(editor.getByLabel("Opens", { exact: true })).toHaveCount(0);
  await expect(
    editor.getByRole("combobox", { name: "Starting files", exact: true }),
  ).toHaveCount(0);
  await expect(editor.getByText("More settings", { exact: true })).toHaveCount(
    0,
  );
  await editor.getByLabel("Time limit (minutes)", { exact: true }).fill("75");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(f.state.statusReads).toBeGreaterThan(0);
  expect(f.state.writes).toHaveLength(1);
  expect(f.state.writes[0].rows[0].body.changes).toEqual({ duration: 4500 });
  expect(f.state.writes[0].rows[0].body.work).toBeUndefined();
  expect(f.state.grant.settings.earliest).toBe(f.initial.settings.earliest);
  expect(f.state.grant.settings.latest).toBe(f.initial.settings.latest);
  expect(f.state.sourceReads).toBe(0);
});

test("webcam Off saves only webcam and preserves exact seconds and dates", async ({
  page,
}) => {
  const f = await fixture(page, { seconds: true }),
    editor = await f.edit("webcam");
  await expect(
    editor.getByRole("combobox", { name: "Webcam", exact: true }),
  ).toHaveValue("true");
  await expect(
    editor.getByLabel("Time limit (minutes)", { exact: true }),
  ).toHaveCount(0);
  await editor
    .getByRole("combobox", { name: "Webcam", exact: true })
    .selectOption({ label: "Off" });
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor).toHaveCount(0);
  expect(f.state.writes[0].rows[0].body.changes).toEqual({ webcam: false });
  expect(f.state.grant.settings.duration).toBe(95);
  expect(f.state.grant.settings.earliest).toBe(f.initial.settings.earliest);
  expect(f.state.grant.settings.latest).toBe(f.initial.settings.latest);
});

test("start date cells save the chosen closing time without rounding the untouched opening time", async ({
  page,
}) => {
  const f = await fixture(page),
    editor = await f.edit("start dates"),
    close = `${new Date().getUTCFullYear() + 1}-01-15T18:30`;
  await expect(editor.getByLabel("Opens", { exact: true })).not.toHaveValue("");
  await expect(
    editor.getByRole("combobox", { name: "Webcam", exact: true }),
  ).toHaveCount(0);
  await editor.getByLabel("Closes", { exact: true }).fill(close);
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor).toHaveCount(0);
  expect(f.state.writes[0].rows[0].body.changes).toEqual({
    latest: Date.parse(close + "-06:00"),
  });
  expect(f.state.grant.settings.earliest).toBe(f.initial.settings.earliest);
});

test("starting files has a small prefilled picker and one review state without unrelated fields", async ({
  page,
}) => {
  const f = await fixture(page),
    picker = await f.edit("starting files");
  await expect(
    picker.getByRole("combobox", { name: "Starting files", exact: true }),
  ).toHaveValue("template");
  await expect(
    picker.getByLabel("Time limit (minutes)", { exact: true }),
  ).toHaveCount(0);
  await expect(
    picker.getByRole("combobox", { name: "Webcam", exact: true }),
  ).toHaveCount(0);
  await expect(
    picker.getByLabel("Maximum file size (MiB)", { exact: true }),
  ).toHaveCount(0);
  await picker
    .getByRole("combobox", { name: "Starting files", exact: true })
    .selectOption({ label: "Empty folder" });
  await picker
    .getByRole("button", { name: "Review changes", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(picker).toContainText("Starting files:");
  await picker
    .getByRole("button", { name: "Apply changes", exact: true })
    .click();
  await expect(picker).toHaveCount(0);
  expect(f.state.writes[0].rows[0].body.changes).toEqual({});
  expect(f.state.writes[0].rows[0].body.work).toEqual({ kind: "empty" });
});

test("fresh claim checks refuse an inline save without dispatching changes", async ({
  page,
}) => {
  const f = await fixture(page),
    editor = await f.edit("time limit");
  await editor.getByLabel("Time limit (minutes)", { exact: true }).fill("60");
  f.state.grant.claims = [{ state: "PREPARING" }];
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor.getByRole("alert")).toContainText("setup started");
  expect(f.state.writes).toEqual([]);
  expect(f.state.grant.settings.duration).toBe(5400);
});

test("fresh instructor identity is checked before an inline request is dispatched", async ({
  page,
}) => {
  const f = await fixture(page),
    editor = await f.edit("time limit");
  await editor.getByLabel("Time limit (minutes)", { exact: true }).fill("60");
  f.state.actor = "another_instructor";
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor.getByRole("alert")).toContainText(
    "Instructor sign-in changed",
  );
  expect(f.state.writes).toEqual([]);
});

test("an uncertain inline save remains exactly retryable after the permission is consumed and the page reloads", async ({
  page,
}) => {
  const f = await fixture(page, { dropFirst: true, consumeAfterDrop: true }),
    editor = await f.edit("time limit");
  await editor.getByLabel("Time limit (minutes)", { exact: true }).fill("60");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => f.state.writes.length).toBe(1);
  await expect(
    page.getByRole("row", { name: "Next attempt for amy", exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await page
    .getByRole("combobox", { name: "Selected exam", exact: true })
    .selectOption(f.initial.exam);
  await page.getByRole("button", { name: /^Resume saved changes/ }).click();
  const review = page.getByRole("dialog", { name: /Unfinished changes/ });
  await review
    .getByRole("button", { name: "Retry unconfirmed changes", exact: true })
    .click();
  await expect(review).toContainText("Settings saved");
  expect(f.state.writes).toHaveLength(2);
  expect(f.state.writes[1]).toEqual(f.state.writes[0]);
  expect(f.state.mutations).toBe(1);
  expect(f.state.grant.revision).toBe(2);
  expect(f.state.grant.status).toBe("CONSUMED");
});

test("the cancellation bin opens only a confirmation, keeps the attempt on dismissal and removes no student history", async ({
  page,
}) => {
  const f = await fixture(page);
  await page
    .getByRole("button", { name: "Cancel next attempt for amy", exact: true })
    .click();
  let confirmation = page.getByRole("dialog", {
    name: "Cancel next attempt for amy?",
    exact: true,
  });
  await expect(
    confirmation.getByLabel("Time limit (minutes)", { exact: true }),
  ).toHaveCount(0);
  await expect(
    confirmation.getByRole("combobox", { name: "Starting files", exact: true }),
  ).toHaveCount(0);
  await confirmation
    .getByRole("button", { name: "Keep attempt", exact: true })
    .click();
  await expect(confirmation).toHaveCount(0);
  expect(f.state.writes).toEqual([]);
  await page
    .getByRole("button", { name: "Cancel next attempt for amy", exact: true })
    .click();
  confirmation = page.getByRole("dialog", {
    name: "Cancel next attempt for amy?",
    exact: true,
  });
  await confirmation
    .getByRole("button", { name: "Cancel attempt", exact: true })
    .click();
  await expect(confirmation).toHaveCount(0);
  expect(f.state.writes[0].rows[0].operation).toBe("revoke");
  expect(f.state.grant.status).toBe("REVOKED");
  await expect(
    page.getByRole("button", {
      name: "Delete student amy",
      exact: true,
    }),
  ).toHaveCount(0);
});

test("opening cancellation cannot relabel or dispatch an older uncertain revision as a cancellation", async ({
  page,
}) => {
  const f = await fixture(page, { dropFirst: true }),
    editor = await f.edit("time limit");
  await editor.getByLabel("Time limit (minutes)", { exact: true }).fill("60");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    editor.getByRole("button", {
      name: "Retry unconfirmed changes",
      exact: true,
    }),
  ).toBeVisible();
  await editor.getByRole("button", { name: "Close", exact: true }).click();
  await expect(editor).toHaveCount(0);
  await page
    .getByRole("button", { name: "Cancel next attempt for amy", exact: true })
    .click();
  const review = page.getByRole("dialog", {
    name: "Unfinished changes for amy",
    exact: true,
  });
  await expect(review).toContainText("Time limit:");
  await expect(
    review.getByRole("button", { name: "Cancel attempt", exact: true }),
  ).toHaveCount(0);
  await expect(
    review.getByRole("button", {
      name: "Retry unconfirmed changes",
      exact: true,
    }),
  ).toBeVisible();
  expect(f.state.writes).toHaveLength(1);
  expect(f.state.writes[0].rows[0].operation).toBe("revise");
});

for (const width of [320, 430, 1280])
  test(`Prof checks cell editors, files and cancellation without clipping at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const f = await fixture(page, {
      webcam: false,
      history: true,
      templateName: "midterm-starter-files-with-a-long-published-folder-name",
    });
    const fits = async () => {
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      const row = page.getByRole("row", {
        name: "Next attempt for amy",
        exact: true,
      });
      const boxes = await row.locator(":scope > td").evaluateAll((cells) =>
        cells
          .filter((cell) => cell.getClientRects().length)
          .map((cell) => {
            const box = cell.getBoundingClientRect();
            return { x: box.x, y: box.y, right: box.right, bottom: box.bottom };
          }),
      );
      for (let i = 0; i < boxes.length; i++) {
        expect(boxes[i].right).toBeLessThanOrEqual(width + 1);
        for (let j = i + 1; j < boxes.length; j++) {
          const overlapX =
              Math.min(boxes[i].right, boxes[j].right) -
              Math.max(boxes[i].x, boxes[j].x),
            overlapY =
              Math.min(boxes[i].bottom, boxes[j].bottom) -
              Math.max(boxes[i].y, boxes[j].y);
          expect(overlapX <= 1 || overlapY <= 1).toBe(true);
        }
      }
    };
    await fits();
    for (const label of [
      "Change webcam for amy",
      "Cancel next attempt for amy",
    ]) {
      const box = await page
        .getByRole("button", { name: label, exact: true })
        .boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(box?.height).toBeGreaterThanOrEqual(44);
    }
    await expect(
      page.getByRole("button", { name: "Change webcam for amy", exact: true }),
    ).toHaveAttribute("aria-description", "Off");
    await expect(
      page.getByRole("button", { name: "Edit settings", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", {
        name: "Actions for student amy",
        exact: true,
      }),
    ).toHaveCount(0);
    await page.screenshot({
      path: info.outputPath("prof-overview.png"),
      fullPage: true,
    });
    for (const field of ["time limit", "webcam", "start dates"] as const) {
      const editor = await f.edit(field);
      await expect(editor).toBeVisible();
      if (field === "start dates") {
        await expect(editor.getByText(/^Times in /)).toHaveCount(0);
        await expect(
          editor.getByText("Start window", { exact: true }),
        ).toHaveCount(0);
      }
      await fits();
      const box = await editor.boundingBox();
      expect(box?.x).toBeGreaterThanOrEqual(0);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(width + 1);
      await page.screenshot({
        path: info.outputPath(`prof-${field.replaceAll(" ", "-")}.png`),
        fullPage: true,
      });
      await editor.getByRole("button", { name: "Cancel", exact: true }).click();
      await expect(
        page.getByRole("button", {
          name: `Change ${field} for amy`,
          exact: true,
        }),
      ).toBeFocused();
    }
    const picker = await f.edit("starting files");
    await expect(
      picker.getByRole("combobox", { name: "Starting files", exact: true }),
    ).toHaveValue("template");
    await expect(
      picker.getByRole("combobox", { name: "Starter files", exact: true }),
    ).toHaveCount(0);
    await expect(
      picker.getByText(f.initial.work.name, { exact: true }),
    ).toBeVisible();
    await expect(
      picker.getByText("Technical details", { exact: true }),
    ).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(1);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath("prof-files.png"),
      fullPage: true,
    });
    await picker.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(
      page.getByRole("button", {
        name: "Change starting files for amy",
        exact: true,
      }),
    ).toBeFocused();
    await page
      .getByRole("button", { name: "Cancel next attempt for amy", exact: true })
      .click();
    const confirmation = page.getByRole("dialog", {
      name: "Cancel next attempt for amy?",
      exact: true,
    });
    await expect(
      confirmation.getByRole("button", { name: "Keep attempt", exact: true }),
    ).toBeVisible();
    await expect(
      confirmation.getByRole("button", { name: "Cancel attempt", exact: true }),
    ).toBeEnabled();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath("prof-cancel.png"),
      fullPage: true,
    });
    await confirmation
      .getByRole("button", { name: "Keep attempt", exact: true })
      .click();
    expect(f.state.writes).toEqual([]);
  });

test("historical settings inspection stays read-only while preserving the current next attempt", async ({
  page,
}, info) => {
  const f = await fixture(page, { history: true });
  await page
    .getByRole("button", {
      name: "View settings for amy attempt 1",
      exact: true,
    })
    .click();
  const inspector = page.getByRole("dialog", {
    name: "Attempt settings for amy",
    exact: true,
  });
  await expect(inspector).toContainText("Starting files:");
  await expect(
    inspector.getByRole("button", { name: "Edit settings", exact: true }),
  ).toHaveCount(0);
  await expect(
    inspector.getByRole("button", { name: "Cancel attempt", exact: true }),
  ).toHaveCount(0);
  await expect(
    inspector.getByText("More settings", { exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: info.outputPath("prof-readonly-history.png"),
    fullPage: true,
  });
  expect(f.state.grant.status).toBe("AVAILABLE");
  expect(f.state.writes).toEqual([]);
});

test("a compact starter picker never replaces the current exact version with its sole differently published version", async ({
  page,
}) => {
  const f = await fixture(page);
  await page.route("**/api/admin/templates*", (route) =>
    route.fulfill({
      json: {
        agent: "class",
        sources: [publishedSource(f.initial.work.name, "b".repeat(64))],
        next: null,
        observed: Date.now(),
        note: "Synthetic newer published version",
      },
    }),
  );
  const picker = await f.edit("starting files");
  await expect(
    picker.getByRole("combobox", { name: "Starter files", exact: true }),
  ).toHaveValue(`${f.initial.work.name}@${f.initial.work.hash}`);
  await picker
    .getByRole("button", { name: "Review changes", exact: true })
    .click();
  await expect(picker.getByText("No changes", { exact: true })).toBeVisible();
  await expect(
    picker.getByRole("button", { name: "Apply changes", exact: true }),
  ).toHaveCount(0);
  expect(f.state.grant.work).toEqual(f.initial.work);
  expect(f.state.writes).toEqual([]);
});

async function dashboardStudents(
  page: Page,
  f: Awaited<ReturnType<typeof fixture>>,
) {
  const exam = f.initial.exam;
  const rows: any[] = [
    {
      username: "amy",
      hasNextAttempt: true,
      removable: false,
      unusedAttempt: f.state.grant,
    },
    {
      username: "bob",
      hasNextAttempt: true,
      removable: false,
      unusedAttempt: null,
    },
    {
      username: "cam",
      hasNextAttempt: false,
      removable: false,
      unusedAttempt: null,
    },
    {
      username: "eve",
      hasNextAttempt: false,
      removable: true,
      unusedAttempt: null,
    },
  ];
  await page.route(`**/api/admin/exams/${exam}/dashboard*`, (route) =>
    route.fulfill({
      json: {
        serverNow: Date.now(),
        students: rows.map((row) => ({
          enrollment: {
            exam,
            username: row.username,
            uid: 0,
            duration: null,
            webcam: null,
          },
          latestSettings: { ...f.initial.settings },
          attempts: [],
          ...row,
        })),
        total: rows.length,
        counts: { students: rows.length },
        incidents: [],
      },
    }),
  );
  await page.reload();
  await page
    .getByRole("combobox", { name: "Selected exam", exact: true })
    .selectOption(exam);
  await expect(
    page.getByRole("rowgroup", { name: "eve", exact: true }),
  ).toBeVisible();
  return { rows, exam };
}

test("student rows have only relevant plus and delete actions, including a claimed permission", async ({
  page,
}) => {
  const f = await fixture(page),
    group = await dashboardStudents(page, f);
  for (const username of ["amy", "bob"])
    await expect(
      page.getByRole("button", {
        name: `Add next attempt for ${username}`,
        exact: true,
      }),
    ).toHaveCount(0);
  for (const username of ["cam", "eve"])
    await expect(
      page.getByRole("button", {
        name: `Add next attempt for ${username}`,
        exact: true,
      }),
    ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /^Actions for student / }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Delete student cam", exact: true }),
  ).toHaveCount(0);
  const writes: any[] = [];
  await page.route(
    `**/api/admin/exams/${group.exam}/roster/remove`,
    async (route) => {
      writes.push(route.request().postDataJSON());
      group.rows.splice(
        group.rows.findIndex((row) => row.username === "eve"),
        1,
      );
      await route.fulfill({ json: { ok: true } });
    },
  );
  await page
    .getByRole("button", { name: "Delete student eve", exact: true })
    .click();
  const warning = page.getByRole("dialog", {
    name: "Delete eve from this exam?",
    exact: true,
  });
  await expect(warning).toContainText("add them again");
  expect(writes).toEqual([]);
  await warning
    .getByRole("button", { name: "Delete student", exact: true })
    .click();
  await expect(
    page.getByRole("rowgroup", { name: "eve", exact: true }),
  ).toHaveCount(0);
  expect(writes).toEqual([{ username: "eve", confirm: true }]);
  expect(f.state.mutations).toBe(0);
});

test("bulk Add targets only missing next attempts and names existing and claimed permissions", async ({
  page,
}) => {
  const f = await fixture(page),
    group = await dashboardStudents(page, f);
  const previews: any[] = [];
  await page.route(
    `**/api/admin/exams/${group.exam}/grants/additional-preview`,
    async (route) => {
      previews.push(route.request().postDataJSON());
      await route.fulfill({
        status: 503,
        json: { error: "Synthetic reviewed submission held" },
      });
    },
  );
  await page
    .getByRole("checkbox", {
      name: "Select all students on this page",
      exact: true,
    })
    .check();
  await page
    .getByRole("button", { name: "Selected students", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Add next attempts", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toHaveCount(1);
  await expect(dialog).toContainText("Already has a next attempt: amy, bob");
  await expect(
    dialog.getByRole("button", { name: "Review", exact: true }),
  ).toBeEnabled();
  await dialog.getByRole("button", { name: "Review", exact: true }).click();
  await expect.poll(() => previews.length).toBe(1);
  expect(previews[0].usernames).toEqual(["cam", "eve"]);
  await expect(dialog).toContainText("Synthetic reviewed submission held");
  expect(f.state.mutations).toBe(0);
});

test("bulk next-attempt editing exposes the same four field groups and no shared exam parameters", async ({
  page,
}) => {
  await fixture(page);
  await page
    .getByRole("checkbox", {
      name: "Select all students on this page",
      exact: true,
    })
    .check();
  await page
    .getByRole("button", { name: "Selected students", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Edit next attempts", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Change next attempts",
    exact: true,
  });
  await expect(
    dialog.getByRole("button", { name: "Review changes", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByLabel("Time limit (minutes)", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("combobox", { name: "Webcam", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("combobox", { name: "Start window", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("combobox", { name: "Starting files", exact: true }),
  ).toBeVisible();
  for (const label of [
    "Terminals",
    "Maximum file size (MiB)",
    "Maximum total size (MiB)",
    "Exam name",
  ])
    await expect(dialog.getByLabel(label, { exact: true })).toHaveCount(0);
  await expect(dialog.getByText("More settings", { exact: true })).toHaveCount(
    0,
  );
});
