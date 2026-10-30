import { test, expect, type Page } from "@playwright/test";
test.use({ timezoneId: "America/Chicago" });

async function fixture(
  page: Page,
  mode: "normal" | "partial" | "source" | "setup" = "normal",
  sandbox = false,
) {
  page.setDefaultTimeout(7000);
  const exam = sandbox ? "sandbox" : "prof-unused",
    now = Date.now();
  const settings = {
    id: exam,
    name: "Midterm",
    template: "sample-exam",
    template_version: "a".repeat(64),
    duration: sandbox ? 300 : 95,
    webcam: sandbox ? false : true,
    terminals: 4,
    collection_file_mib: 128,
    collection_total_mib: 512,
    earliest: now - 100000 + 123,
    latest: now + 3600000 + 456,
  };
  const users = ["amy", "bob", "carol"],
    source = {
      id: "33333333-3333-4333-8333-333333333333",
      exam,
      username: "amy",
      uid: 10001,
      state: "COMPLETED",
      protected: 1,
      checksum: "b".repeat(64),
      start: now - 7200000,
      original_deadline: now - 3600000,
      settings,
      attempt_number: 1,
    };
  const grants = users.map((username, i) => ({
    id: `11111111-1111-4111-8111-${String(i + 1).padStart(12, "0")}`,
    exam,
    username,
    revision: 1,
    status:
      i === 2
        ? "CONSUMED"
        : mode === "setup" && i === 0
          ? "PENDING_NATIVE"
          : "AVAILABLE",
    actor: mode === "setup" ? "another_instructor" : "instructor",
    claims: i === 2 ? [{ state: "CONSUMED" }] : [],
    issuance: "ADDITIONAL_TEMPLATE",
    issuance_order: i + 1,
    issued_at: now - 60000,
    settings: {
      ...settings,
      duration: i === 1 && !sandbox ? 900 : settings.duration,
    },
    work:
      ["source", "setup"].includes(mode) && i === 0
        ? { kind: "saved", attempt: source.id, checksum: source.checksum }
        : { kind: "template", name: "sample-exam", hash: "a".repeat(64) },
  }));
  const state = {
    grants,
    writes: [] as any[],
    statusReads: 0,
    setupStatus: "NOT_QUEUED",
    setupRetries: [] as any[],
    individualSetupReads: 0,
    failSource: false,
    failExams: false,
    historyReads: 0,
    defaultWrites: [] as any[],
    dropped: false,
  };
  const results = new Map<string, any>();
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname;
    if (path === "/api/session")
      return route.fulfill({
        json: { role: "admin", username: "instructor", csrf: "fixture" },
      });
    if (path === "/api/login-test")
      return route.fulfill({ json: { loginOnly: false, browserSSH: true } });
    if (path === "/api/admin/exams")
      return state.failExams
        ? route.fulfill({
            status: 503,
            json: { error: "Synthetic exam-list unavailable" },
          })
        : route.fulfill({ json: [{ ...settings, revision: "c".repeat(64) }] });
    if (path.endsWith("/dashboard"))
      return route.fulfill({
        json: {
          serverNow: now,
          students: users.map((username) => ({
            username,
            enrollment: { duration: null, webcam: null },
            attempts: [],
          })),
          total: 3,
          counts: { students: 3 },
          incidents: [],
        },
      });
    if (path.endsWith("/roster/settings")) {
      state.defaultWrites.push(route.request().postDataJSON());
      return route.fulfill({ json: { ok: true } });
    }
    if (path.endsWith("/grants"))
      return route.fulfill({
        json: {
          grants: grants.filter(
            (g) => g.username === url.searchParams.get("username"),
          ),
          next: null,
        },
      });
    if (path.endsWith("/source-setup")) {
      if (route.request().method() !== "POST") {
        state.individualSetupReads++;
        return route.fulfill({
          json: { error: "Unexpected individual status request" },
        });
      }
      state.setupRetries.push(route.request().postDataJSON());
      state.setupStatus = "QUEUED";
      return route.fulfill({
        json: {
          id: grants[0].id,
          revision: 1,
          status: "QUEUED",
          grant_status: "PENDING_NATIVE",
        },
      });
    }
    if (path.endsWith("/grants/status")) {
      state.statusReads++;
      return route.fulfill({
        json: {
          rows: route
            .request()
            .postDataJSON()
            .rows.map((ref: any) => {
              const g = grants.find((g) => g.id === ref.id)!;
              return {
                id: g.id,
                revision: ref.revision,
                current_revision: g.revision,
                grant_status: g.status,
                status:
                  mode === "setup" && g.username === "amy"
                    ? state.setupStatus
                    : g.work.kind === "saved"
                      ? "READY"
                      : "NOT_QUEUED",
                tries: 0,
                error: "",
                grant: g,
                source: g.work.kind === "saved" ? source : null,
              };
            }),
        },
      });
    }
    if (path.endsWith("/grants/change")) {
      const body = route.request().postDataJSON();
      state.writes.push(body);
      const rows = body.rows.map((r: any) => {
        if (results.has(r.body.request)) return results.get(r.body.request);
        const g = grants.find((g) => g.id === r.id)!;
        if (mode === "partial" && g.username === "bob")
          return {
            id: g.id,
            request: r.body.request,
            outcome: "refused",
            code: 409,
            error: "Setup started; the original attempt remains protected.",
          };
        if (r.operation === "revoke") g.status = "REVOKED";
        else {
          g.settings = { ...g.settings, ...r.body.changes };
          g.revision++;
          if (r.body.work) g.work = r.body.work;
        }
        const result = {
          id: g.id,
          request: r.body.request,
          outcome: "saved",
          grant: structuredClone(g),
        };
        results.set(r.body.request, result);
        return result;
      });
      if (mode === "partial" && !state.dropped) {
        state.dropped = true;
        return route.abort("failed");
      }
      return route.fulfill({ json: { results: rows } });
    }
    if (path.endsWith("/attempts"))
      return state.failSource
        ? route.fulfill({
            status: 503,
            json: { error: "Synthetic saved-work list unavailable" },
          })
        : route.fulfill({
            json: { attempts: [source], scanned: 1, next: null },
          });
    if (path.startsWith("/api/admin/grants/")) {
      state.historyReads++;
      const g = grants.find((g) => path.endsWith(g.id))!;
      return route.fulfill({
        json: {
          ...g,
          history: [
            {
              revision: 1,
              settings: g.settings,
              actor: "instructor",
              reason: "Original synthetic settings",
            },
          ],
          history_next: null,
        },
      });
    }
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto("/admin");
  const open = async () => {
    await page.getByLabel("Selected exam").selectOption(exam);
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
      .getByRole("menuitem", { name: "Change unused attempts", exact: true })
      .click();
    return page.getByRole("dialog", {
      name: "Change unused attempts",
      exact: true,
    });
  };
  return { state, open, original: structuredClone(grants), settings };
}

test("an inherited exact-second default can be saved without rounding or invalid minute input", async ({
  page,
}) => {
  const f = await fixture(page);
  await page.getByLabel("Selected exam").selectOption(f.settings.id);
  await page
    .getByRole("button", {
      name: "Edit future time limit for amy",
      exact: true,
    })
    .click();
  const form = page.getByRole("form", {
    name: "Edit future time limit for amy",
    exact: true,
  });
  await expect(
    form.getByRole("spinbutton", { name: "Minutes", exact: true }),
  ).toBeDisabled();
  await expect(
    form.getByRole("checkbox", {
      name: "Exam default (1 min 35 sec)",
      exact: true,
    }),
  ).toBeFocused();
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await expect(form).toHaveCount(0);
  expect(f.state.defaultWrites).toEqual([
    { usernames: ["amy"], duration: null },
  ]);
  await expect(
    page.getByRole("button", {
      name: "Edit future time limit for amy",
      exact: true,
    }),
  ).toContainText("1 min 35 sec");
  expect(f.state.grants).toEqual(f.original);
});

test("unused settings skip no-ops and change only named fields without rounding exact values", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 430, height: 1000 });
  const f = await fixture(page),
    dialog = await f.open();
  await dialog
    .getByRole("button", { name: "Select unused attempts", exact: true })
    .click();
  await expect(dialog).toContainText("No unused attempts for: carol.");
  await expect(
    dialog.getByRole("spinbutton", {
      name: "Time limit (minutes)",
      exact: true,
    }),
  ).toHaveValue("");
  await dialog
    .getByRole("button", { name: "Review changes", exact: true })
    .click();
  await expect(dialog.getByText("No changes", { exact: true })).toHaveCount(2);
  await expect(
    dialog.getByRole("button", { name: "Apply changes", exact: true }),
  ).toHaveCount(0);
  expect(f.state.writes).toHaveLength(0);
  await dialog
    .getByRole("button", { name: "Edit remaining changes", exact: true })
    .click();
  await dialog
    .getByRole("combobox", { name: "Webcam", exact: true })
    .selectOption("false");
  await dialog
    .getByRole("button", { name: "Review changes", exact: true })
    .click();
  await expect(dialog).toContainText("Webcam: Required → Optional");
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await page.screenshot({
    path: info.outputPath("unused-settings-review-mobile.png"),
    fullPage: true,
  });
  await dialog
    .getByRole("button", { name: "Apply changes", exact: true })
    .click();
  await expect(dialog.getByText("Settings saved", { exact: true })).toHaveCount(
    2,
  );
  expect(f.state.writes).toHaveLength(1);
  for (const row of f.state.writes[0].rows)
    expect(row.body.changes).toEqual({ webcam: false });
  for (let i = 0; i < 2; i++) {
    expect(f.state.grants[i].settings.duration).toBe(
      f.original[i].settings.duration,
    );
    expect(f.state.grants[i].settings.earliest).toBe(
      f.original[i].settings.earliest,
    );
    expect(f.state.grants[i].settings.latest).toBe(
      f.original[i].settings.latest,
    );
    expect(f.state.grants[i].work).toEqual(f.original[i].work);
  }
  expect(f.state.grants[2]).toEqual(f.original[2]);
});

test("unknown unused changes survive reload, inspect current state and retry the original per-row identities", async ({
  page,
}, info) => {
  const f = await fixture(page, "partial"),
    dialog = await f.open();
  await dialog
    .getByRole("button", { name: "Select unused attempts", exact: true })
    .click();
  await dialog
    .getByRole("spinbutton", { name: "Time limit (minutes)", exact: true })
    .fill("30");
  await dialog
    .getByRole("button", { name: "Review changes", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Apply changes", exact: true })
    .click();
  await expect(
    dialog.getByText("Change unconfirmed", { exact: true }),
  ).toHaveCount(2);
  const before = f.state.statusReads;
  await dialog
    .getByRole("button", { name: "Refresh status", exact: true })
    .click();
  await expect.poll(() => f.state.statusReads).toBeGreaterThan(before);
  await expect(
    dialog.getByText("Change unconfirmed", { exact: true }),
  ).toHaveCount(2);
  await page.reload();
  await f.open();
  await expect(
    dialog.getByRole("button", {
      name: "Retry unconfirmed changes",
      exact: true,
    }),
  ).toBeEnabled();
  await dialog
    .getByRole("button", { name: "Retry unconfirmed changes", exact: true })
    .click();
  await expect(dialog.getByText("Settings saved", { exact: true })).toHaveCount(
    1,
  );
  await expect(
    dialog.getByText("Change unconfirmed", { exact: true }),
  ).toHaveCount(1);
  expect(f.state.writes[1]).toEqual(f.state.writes[0]);
  expect(f.state.grants[0].revision).toBe(2);
  expect(f.state.grants[1].revision).toBe(1);
  await page.screenshot({
    path: info.outputPath("unused-settings-partial-desktop.png"),
    fullPage: true,
  });
});

test("editing only a closing time uses the chosen repeated hour and preserves every other setting", async ({
  page,
}) => {
  const f = await fixture(page),
    dialog = await f.open();
  await dialog
    .getByRole("button", { name: "Select unused attempts", exact: true })
    .click();
  await dialog
    .getByRole("combobox", { name: "Start window", exact: true })
    .selectOption("set");
  await dialog
    .getByRole("textbox", { name: "Closes", exact: true })
    .fill("2026-11-01T01:30");
  await dialog
    .getByRole("combobox", { name: "Occurrence for Closes", exact: true })
    .selectOption("1");
  await dialog
    .getByRole("button", { name: "Review changes", exact: true })
    .click();
  await expect(dialog).toContainText("UTC−06:00");
  await dialog
    .getByRole("button", { name: "Apply changes", exact: true })
    .click();
  await expect(dialog.getByText("Settings saved", { exact: true })).toHaveCount(
    2,
  );
  const latest = Date.UTC(2026, 10, 1, 7, 30);
  for (const row of f.state.writes[0].rows)
    expect(row.body.changes).toEqual({ latest });
  for (let i = 0; i < 2; i++)
    expect(f.state.grants[i].settings).toEqual({
      ...f.original[i].settings,
      latest,
    });
  expect(f.state.grants[2]).toEqual(f.original[2]);
});

test("a storage failure after dispatch keeps received results usable in the same dialog", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (
        key.startsWith("exam-admin-unused:") &&
        value.includes('"state":"saved"')
      )
        throw new DOMException(
          "Synthetic post-response storage failure",
          "QuotaExceededError",
        );
      return original.call(this, key, value);
    };
  });
  const f = await fixture(page),
    dialog = await f.open();
  await dialog
    .getByRole("button", { name: "Select unused attempts", exact: true })
    .click();
  await dialog
    .getByRole("combobox", { name: "Webcam", exact: true })
    .selectOption("false");
  await dialog
    .getByRole("button", { name: "Review changes", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Apply changes", exact: true })
    .click();
  await expect(dialog.getByText("Settings saved", { exact: true })).toHaveCount(
    2,
  );
  await expect(dialog).toContainText(
    "Results are shown, but this browser could not save them for reopening.",
  );
  await expect(dialog.getByText("Applying…", { exact: true })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(f.state.writes).toHaveLength(1);
});

test("saved-work retrieval is retryable and sandbox fixed settings cannot be changed", async ({
  page,
}) => {
  const f = await fixture(page, "source", true),
    dialog = await f.open();
  await dialog
    .getByRole("button", { name: "Select unused attempts", exact: true })
    .click();
  await expect(
    dialog.getByRole("spinbutton", {
      name: "Time limit (minutes)",
      exact: true,
    }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("combobox", { name: "Webcam", exact: true }),
  ).toBeDisabled();
  f.state.failSource = true;
  await dialog
    .getByRole("combobox", { name: "Starting files", exact: true })
    .selectOption("saved");
  await expect(
    dialog.getByRole("combobox", { name: "Saved work for amy", exact: true }),
  ).toBeDisabled();
  await expect(
    dialog.getByRole("button", { name: "Review changes", exact: true }),
  ).toBeDisabled();
  await expect(dialog).toContainText("Could not load saved work.");
  f.state.failSource = false;
  await dialog
    .getByRole("button", { name: "Refresh saved work", exact: true })
    .click();
  await expect(
    dialog.getByRole("combobox", { name: "Saved work for amy", exact: true }),
  ).toBeEnabled();
  await expect(
    dialog.getByRole("combobox", { name: "Saved work for amy", exact: true }),
  ).toContainText("Attempt 1");
  await dialog.getByText("More settings", { exact: true }).click();
  await expect(
    dialog.getByRole("spinbutton", { name: "Terminals", exact: true }),
  ).toBeDisabled();
  expect(f.state.writes).toHaveLength(0);
});

test("an older saved-work attempt retries setup in its own screen and only native-confirmed availability shows Ready", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 430, height: 1000 });
  const f = await fixture(page, "setup"),
    dialog = await f.open();
  const row = dialog
    .getByRole("region", { name: "Attempts for amy", exact: true })
    .getByRole("article");
  await row.getByRole("checkbox").check();
  await expect(
    row.getByRole("button", { name: "Retry setup", exact: true }),
  ).toBeEnabled();
  f.state.setupStatus = "FAILED";
  await dialog.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(row).toContainText(
    "Saved-work setup failed. The attempt cannot start yet.",
  );
  await page.screenshot({
    path: info.outputPath("saved-work-retry-mobile.png"),
    fullPage: true,
  });
  await row.getByRole("button", { name: "Retry setup", exact: true }).click();
  await expect.poll(() => f.state.setupRetries.length).toBe(1);
  expect(f.state.setupRetries[0]).toEqual({
    revision: 1,
    request: expect.stringMatching(/^[a-f0-9-]{36}$/),
  });
  await expect(
    row.getByRole("button", { name: "Retry setup", exact: true }),
  ).toHaveCount(0);
  f.state.setupStatus = "READY";
  await dialog.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(row.getByRole("status")).toHaveText("Preparing saved work");
  await expect(row.getByText("Ready", { exact: true })).toHaveCount(0);
  expect(f.state.grants).toEqual(f.original);
  f.state.grants[0].status = "AVAILABLE";
  await dialog.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(row.getByRole("status")).toHaveText("Ready");
  await expect(row).not.toContainText("Preparing saved work");
  expect(f.state.writes).toHaveLength(0);
  expect(f.state.setupRetries).toHaveLength(1);
  expect(f.state.individualSetupReads).toBe(0);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({
    path: info.outputPath("saved-work-ready-desktop.png"),
    fullPage: true,
  });
  expect({ ...f.state.grants[0], status: f.original[0].status }).toEqual(
    f.original[0],
  );
  await expect(page.getByRole("dialog")).toHaveCount(1);
});
