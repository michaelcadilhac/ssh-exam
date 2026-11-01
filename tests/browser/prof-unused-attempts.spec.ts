import { test, expect, type Page, type Locator } from "@playwright/test";
import { publishedSource } from "./prof-workflow-fixture.js";
import { localDateTime } from "../../apps/web/src/local-date-time.js";
test.use({ timezoneId: "America/Chicago" });

async function fixture(
  page: Page,
  mode: "normal" | "partial" | "source" | "setup" = "normal",
  sandbox = false,
  examName = "Midterm",
) {
  page.setDefaultTimeout(7000);
  const exam = sandbox ? "sandbox" : "prof-unused",
    now = Date.now();
  const settings = {
    id: exam,
    name: examName,
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
    sourceAttempts: [source] as any[],
    sourceReads: 0,
    examDefinitions: [
      { ...settings, revision: "c".repeat(64), lifecycle: "active" },
    ] as any[],
    dashboardAttempts: [] as any[],
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
        : route.fulfill({ json: state.examDefinitions });
    if (path === "/api/admin/templates")
      return route.fulfill({
        json: {
          agent: "class",
          sources: [publishedSource()],
          next: null,
          observed: now,
          note: "Authenticated synthetic file metadata",
        },
      });
    if (path.endsWith("/dashboard"))
      return route.fulfill({
        json: {
          serverNow: now,
          students: users.map((username) => ({
            username,
            enrollment: { duration: null, webcam: null },
            attempts: state.dashboardAttempts.filter(
              (attempt) => attempt.username === username,
            ),
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
                source:
                  g.work.kind === "saved"
                    ? (state.sourceAttempts.find(
                        (attempt) => attempt.id === g.work.attempt,
                      ) ?? null)
                    : null,
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
          if (r.body.work) {
            g.work = r.body.work;
            if (g.work.kind === "saved") g.status = "PENDING_NATIVE";
          }
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
    if (path.endsWith("/attempts")) {
      state.sourceReads++;
      const requestedExam = decodeURIComponent(path.split("/")[4]),
        attempts = state.sourceAttempts.filter(
          (attempt) => attempt.exam === requestedExam,
        );
      return state.failSource
        ? route.fulfill({
            status: 503,
            json: { error: "Synthetic saved-work list unavailable" },
          })
        : route.fulfill({
            json: { attempts, scanned: attempts.length, next: null },
          });
    }
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
  const openPersonal = async (username = "amy", edit = true) => {
    await page.getByLabel("Selected exam").selectOption(exam);
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
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText("Loading allowed attempts…", { exact: true }),
    ).toHaveCount(0);
    const button = dialog.getByRole("button", {
      name: "Edit settings",
      exact: true,
    });
    if (edit && (await button.count()) === 1)
      await button.click({ timeout: 3000 });
    return dialog;
  };
  return {
    state,
    open,
    openPersonal,
    source,
    original: structuredClone(grants),
    settings,
  };
}

async function openStartingFiles(dialog: Locator) {
  await expect(
    dialog.getByRole("combobox", { name: "Starting files", exact: true }),
  ).toBeVisible();
}
async function chooseSavedFiles(dialog: Locator) {
  await openStartingFiles(dialog);
  await dialog
    .getByRole("combobox", { name: "Starting files", exact: true })
    .selectOption("saved");
}

test("personal editor opens on demand with saved values and cancelling only discards the draft", async ({
  page,
}, info) => {
  const f = await fixture(page);
  Object.assign(f.state.grants[0].settings, {
    duration: 5400,
    earliest: Date.parse("2026-11-01T01:15:30.123-06:00"),
    latest: Date.parse("2026-11-06T23:42:10.456-06:00"),
  });
  const before = structuredClone(f.state.grants[0]),
    dialog = await f.openPersonal("amy", false);
  await expect(
    dialog.getByRole("spinbutton", {
      name: "Time limit (minutes)",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Review changes", exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Close", exact: true }),
  ).toBeVisible();
  const edit = dialog.getByRole("button", {
    name: "Edit settings",
    exact: true,
  });
  await edit.click({ timeout: 3000 });
  await expect(edit).toHaveCount(0);
  const duration = dialog.getByRole("spinbutton", {
    name: "Time limit (minutes)",
    exact: true,
  });
  await expect(duration).toHaveValue("90");
  await expect(duration).toBeFocused();
  await expect(
    dialog.getByRole("combobox", { name: "Webcam", exact: true }),
  ).toHaveValue("true");
  await expect(dialog.getByLabel("Opens", { exact: true })).toHaveValue(
    localDateTime(before.settings.earliest),
  );
  await expect(
    dialog.getByRole("combobox", { name: "Occurrence for Opens", exact: true }),
  ).toHaveValue("1");
  await expect(dialog.getByLabel("Closes", { exact: true })).toHaveValue(
    localDateTime(before.settings.latest),
  );
  await expect(
    dialog.getByRole("combobox", { name: "Starting files", exact: true }),
  ).toHaveValue("template");
  await expect(
    dialog.getByRole("combobox", { name: "Starter files", exact: true }),
  ).toHaveValue(`sample-exam@${"a".repeat(64)}`);
  await dialog
    .getByText("More settings", { exact: true })
    .click({ timeout: 3000 });
  await expect(dialog.getByLabel("Terminals", { exact: true })).toHaveValue(
    "4",
  );
  await expect(
    dialog.getByLabel("Maximum file size (MiB)", { exact: true }),
  ).toHaveValue("128");
  await expect(dialog.getByLabel("Exam name", { exact: true })).toHaveCount(0);
  await expect(dialog.getByLabel("Reason", { exact: true })).toHaveCount(0);
  await duration.fill("120");
  await dialog
    .getByRole("button", { name: "Cancel editing", exact: true })
    .click({ timeout: 3000 });
  await expect(duration).toHaveCount(0);
  await expect(edit).toBeFocused();
  expect(f.state.grants[0]).toEqual(before);
  expect(f.state.writes).toHaveLength(0);
  await edit.click({ timeout: 3000 });
  await expect(duration).toHaveValue("90");
  await page.screenshot({
    path: info.outputPath("prefilled-editor-desktop.png"),
    fullPage: true,
  });
  await dialog
    .getByRole("button", { name: "Review changes", exact: true })
    .click({ timeout: 3000 });
  await expect(dialog.getByText("No changes", { exact: true })).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Apply changes", exact: true }),
  ).toHaveCount(0);
  expect(f.state.writes).toHaveLength(0);
  expect(f.state.grants[0]).toEqual(before);
});

test("personal saved-file prefill preserves an older exact source and seconds despite history lookup failure", async ({
  page,
}, info) => {
  const f = await fixture(page, "source", false, "Programming exam");
  f.state.sourceAttempts.push({
    ...f.source,
    id: "44444444-4444-4444-8444-444444444444",
    start: f.source.start + 10000,
    attempt_number: 2,
  });
  f.state.failSource = true;
  const before = structuredClone(f.state.grants[0]),
    dialog = await f.openPersonal();
  await expect(
    dialog.getByRole("combobox", { name: "Starting files", exact: true }),
  ).toHaveValue("saved");
  await expect(dialog).toContainText(
    /Current files: Saved files from Programming exam \(prof-unused\).*Attempt 1/,
  );
  await expect(
    dialog.getByLabel("Time limit (minutes)", { exact: true }),
  ).toHaveValue("");
  await expect(dialog).toContainText("Current time limit: 1 min 35 sec");
  await expect(
    dialog.getByText("Could not load saved work.", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Review changes", exact: true }),
  ).toBeEnabled();
  await dialog
    .getByRole("combobox", { name: "Webcam", exact: true })
    .selectOption("false");
  await page.setViewportSize({ width: 375, height: 900 });
  await page.screenshot({
    path: info.outputPath("prefilled-saved-source-mobile.png"),
    fullPage: true,
  });
  await dialog
    .getByRole("button", { name: "Review changes", exact: true })
    .click({ timeout: 3000 });
  await expect(
    dialog.getByRole("region", { name: "Review unused changes", exact: true }),
  ).toContainText("Webcam: Required → Optional");
  await expect(
    dialog.getByRole("button", { name: "Back to editing", exact: true }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Apply changes", exact: true })
    .click({ timeout: 3000 });
  await expect(
    dialog.getByText("Settings saved", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Back to editing", exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Done", exact: true }),
  ).toBeVisible();
  expect(f.state.writes[0].rows[0].body.changes).toEqual({ webcam: false });
  expect(f.state.writes[0].rows[0].body).not.toHaveProperty("work");
  expect(f.state.writes[0].rows[0].body.reason).toBe(
    "Change unused attempt settings",
  );
  expect(f.state.grants[0].settings).toEqual({
    ...before.settings,
    webcam: false,
  });
  expect(f.state.grants[0].work).toEqual(before.work);
});

test("personal refresh cannot turn untouched prefilled values into stale authority changes", async ({
  page,
}) => {
  const f = await fixture(page),
    dialog = await f.openPersonal();
  f.state.grants[0].revision++;
  f.state.grants[0].settings.webcam = false;
  const changed = structuredClone(f.state.grants[0]);
  await dialog
    .getByRole("button", { name: "Refresh", exact: true })
    .click({ timeout: 3000 });
  await expect(
    dialog.getByRole("combobox", { name: "Webcam", exact: true }),
  ).toHaveValue("true");
  await dialog
    .getByRole("button", { name: "Review changes", exact: true })
    .click({ timeout: 3000 });
  await expect(dialog.getByRole("alert")).toContainText(
    "Settings changed or setup started for amy",
  );
  expect(f.state.writes).toHaveLength(0);
  expect(f.state.grants[0]).toEqual(changed);
});

test("personal review returns to fresh settings with the explicit draft preserved, and cancellation returns to the overview", async ({
  page,
}) => {
  const f = await fixture(page),
    dialog = await f.openPersonal();
  await dialog
    .getByRole("combobox", { name: "Webcam", exact: true })
    .selectOption("false");
  await dialog
    .getByRole("button", { name: "Review changes", exact: true })
    .click({ timeout: 3000 });
  f.state.grants[0].revision++;
  f.state.grants[0].settings.duration = 5400;
  await dialog
    .getByRole("button", { name: "Back to editing", exact: true })
    .click({ timeout: 3000 });
  await expect(
    dialog.getByRole("combobox", { name: "Webcam", exact: true }),
  ).toHaveValue("false");
  await expect(
    dialog.getByLabel("Time limit (minutes)", { exact: true }),
  ).toHaveValue("90");
  await dialog
    .getByRole("button", { name: "Cancel editing", exact: true })
    .click({ timeout: 3000 });
  await dialog
    .getByRole("button", { name: "Cancel attempt", exact: true })
    .click({ timeout: 3000 });
  await expect(
    dialog.getByRole("region", { name: "Review unused changes", exact: true }),
  ).toContainText("Cancel this unused attempt");
  await dialog
    .getByRole("button", { name: "Back to attempts", exact: true })
    .click({ timeout: 3000 });
  await expect(
    dialog.getByRole("button", { name: "Edit settings", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByLabel("Time limit (minutes)", { exact: true }),
  ).toHaveCount(0);
  expect(f.state.writes).toHaveLength(0);
  await dialog
    .getByRole("button", { name: "Edit settings", exact: true })
    .click({ timeout: 3000 });
  await expect(
    dialog.getByLabel("Time limit (minutes)", { exact: true }),
  ).toHaveValue("90");
  await expect(
    dialog.getByRole("combobox", { name: "Webcam", exact: true }),
  ).toHaveValue("true");
});

test("personal current saved files remain selected when another attempt is the only retrievable source", async ({
  page,
}) => {
  const f = await fixture(page, "source");
  const latest = {
    ...f.source,
    id: "44444444-4444-4444-8444-444444444444",
    start: f.source.start + 10000,
    attempt_number: 2,
  };
  f.state.sourceAttempts = [latest];
  const before = structuredClone(f.state.grants[0]),
    dialog = await f.openPersonal();
  const choice = dialog.getByRole("combobox", {
    name: "Saved work for amy",
    exact: true,
  });
  await expect(choice).toHaveValue(before.work.attempt!);
  await expect(
    choice.getByRole("option", { name: "Current files", exact: true }),
  ).toHaveCount(1);
  await dialog
    .getByRole("button", { name: "Review changes", exact: true })
    .click({ timeout: 3000 });
  await expect(dialog.getByText("No changes", { exact: true })).toBeVisible();
  expect(f.state.writes).toHaveLength(0);
  expect(f.state.grants[0]).toEqual(before);
});

test("bulk allowed-attempt selection chooses an action target without changing permission", async ({
  page,
}) => {
  const f = await fixture(page);
  const dialog = await f.open(),
    card = dialog
      .getByRole("region", { name: "Attempts for amy", exact: true })
      .getByRole("article"),
    target = card.getByRole("checkbox", { name: /^Select .*attempt/i });
  await expect(
    dialog.getByText("Select unused attempts to change or cancel.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(card.locator("label")).toHaveText(/^Select .*attempt/i);
  await expect(target).not.toBeChecked();
  await target.check();
  await expect(target).toBeChecked();
  await expect(dialog).toContainText("1 attempt for 1 student selected");
  expect(f.state.writes).toHaveLength(0);
  await dialog
    .getByRole("button", { name: "Clear selection", exact: true })
    .click();
  await expect(target).not.toBeChecked();
  await expect(dialog).toContainText("0 attempts for 0 students selected");
  for (const name of ["Review changes", "Review cancellation"])
    await expect(
      dialog.getByRole("button", { name, exact: true }),
    ).toBeDisabled();
  expect(f.state.grants).toEqual(f.original);
  expect(f.state.writes).toHaveLength(0);
  await target.check();
  await expect(dialog).toContainText("1 attempt for 1 student selected");
  for (const name of ["Review changes", "Review cancellation"])
    await expect(
      dialog.getByRole("button", { name, exact: true }),
    ).toBeEnabled();
  await dialog
    .getByRole("button", { name: "Review cancellation", exact: true })
    .click();
  const review = dialog.getByRole("region", {
    name: "Review unused changes",
    exact: true,
  });
  await expect(review.getByRole("article")).toHaveCount(1);
  await expect(review).toContainText("amy · Extra attempt");
  await expect(review).toContainText(
    "Cancel this unused attempt. Saved files and history are kept.",
  );
  await expect(
    dialog.getByRole("button", {
      name: "Cancel selected attempts",
      exact: true,
    }),
  ).toBeEnabled();
  expect(f.state.writes).toHaveLength(0);
  expect(f.state.grants).toEqual(f.original);
});

test("started historical attempts show their status without a selection checkbox", async ({
  page,
}) => {
  const f = await fixture(page),
    dialog = await f.open(),
    history = dialog.getByRole("region", {
      name: "Attempts for carol",
      exact: true,
    });
  await history
    .getByText("Unavailable attempts and history", { exact: true })
    .click();
  const started = history.getByRole("article");
  await expect(started).toContainText("Started");
  await expect(started.getByRole("checkbox")).toHaveCount(0);
  expect(f.state.writes).toHaveLength(0);
  expect(f.state.grants).toEqual(f.original);
});

test("an inherited exact-second default can be saved without rounding or invalid minute input", async ({
  page,
}) => {
  const f = await fixture(page);
  await page.getByLabel("Selected exam").selectOption(f.settings.id);
  await expect(
    page.getByRole("button", {
      name: "Edit future time limit for amy",
      exact: true,
    }),
  ).toHaveText("Default: 1 min 35 sec");
  await expect(
    page.getByRole("button", {
      name: "Edit future webcam setting for amy",
      exact: true,
    }),
  ).toHaveText("Webcam default: Required");
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
  ).toHaveText("Default: 1 min 35 sec");
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
    .getByRole("button", { name: "Back to editing", exact: true })
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
  const f = await fixture(page);
  // The authored window must span the fixed DST boundary, even after that date.
  for (let i = 0; i < 2; i++) {
    f.state.grants[i].settings.earliest = Date.UTC(2026, 9, 31, 18, 0, 0, 123);
    f.original[i] = structuredClone(f.state.grants[i]);
  }
  const dialog = await f.open();
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
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
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
  await openStartingFiles(dialog);
  await dialog
    .getByRole("combobox", { name: "Starting files", exact: true })
    .selectOption("saved");
  await expect(
    dialog.getByRole("combobox", { name: "Saved work for amy", exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Review changes", exact: true }),
  ).toBeDisabled();
  await expect(dialog).toContainText("Could not load saved work.");
  await expect(dialog.getByText(/No saved files are available/)).toHaveCount(0);
  f.state.failSource = false;
  await dialog
    .getByRole("button", { name: "Refresh saved work", exact: true })
    .click();
  await expect(dialog.getByText(/^amy: Midterm.*Attempt 1/)).toBeVisible();
  await expect(
    dialog.getByRole("combobox", { name: "Saved work for amy", exact: true }),
  ).toHaveCount(0);
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

test("personal attempt editing has no selection clutter and opening file options changes no files", async ({
  page,
}, info) => {
  const f = await fixture(page),
    dialog = await f.openPersonal("amy", false);
  await expect(dialog.getByRole("checkbox")).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Select unused attempts", exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Clear selection", exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByText("1 attempt for 1 student selected", { exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByText("Starting files: sample-exam (starter files)", {
      exact: true,
    }),
  ).toBeVisible();
  for (const width of [1280, 430]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await dialog.evaluate(
        (element) => element.getBoundingClientRect().right <= innerWidth + 1,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`personal-attempt-${width}.png`),
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await dialog
    .getByRole("button", { name: "Edit settings", exact: true })
    .click({ timeout: 3000 });
  await expect(
    dialog.getByRole("combobox", { name: "Starting files", exact: true }),
  ).toHaveValue("template");
  await expect(
    dialog.getByRole("option", { name: "Keep current files", exact: true }),
  ).toHaveCount(0);
  expect(f.state.grants).toEqual(f.original);
  expect(f.state.writes).toHaveLength(0);
  await dialog
    .getByRole("combobox", { name: "Webcam", exact: true })
    .selectOption("false");
  f.state.grants[0].claims = [{ state: "CONSUMED" }];
  await dialog
    .getByRole("button", { name: "Review changes", exact: true })
    .click({ timeout: 3000 });
  await expect(dialog.getByRole("alert")).toContainText(
    "Settings changed or setup started for amy",
  );
  expect(f.state.writes).toHaveLength(0);
  f.state.grants[0].claims = [];
  await dialog
    .getByRole("button", { name: "Review changes", exact: true })
    .click({ timeout: 3000 });
  expect(f.state.writes).toHaveLength(0);
  await dialog
    .getByRole("button", { name: "Apply changes", exact: true })
    .click({ timeout: 3000 });
  await expect(
    dialog.getByText("Settings saved", { exact: true }),
  ).toBeVisible();
  expect(f.state.writes[0].rows).toHaveLength(1);
  expect(f.state.writes[0].rows[0].id).toBe(f.original[0].id);
  expect(f.state.writes[0].rows[0].body).not.toHaveProperty("work");
  expect(f.state.grants[0].work).toEqual(f.original[0].work);
});

test("personal multiple attempts edit one row reset drafts on switching and cancel the exact other row", async ({
  page,
}) => {
  const f = await fixture(page),
    extra = structuredClone(f.state.grants[0]);
  extra.id = "44444444-4444-4444-8444-444444444444";
  extra.issuance_order = 4;
  extra.issued_at += 10000;
  f.state.grants.push(extra);
  f.original.push(structuredClone(extra));
  const dialog = await f.openPersonal("amy", false),
    rows = dialog
      .getByRole("region", { name: "Attempts for amy", exact: true })
      .getByRole("article");
  await expect(rows).toHaveCount(2);
  await expect(dialog.getByRole("checkbox")).toHaveCount(0);
  await rows
    .nth(0)
    .getByRole("button", { name: "Edit settings", exact: true })
    .click({ timeout: 3000 });
  await expect(dialog.getByText(/^Editing:/)).toBeVisible();
  await dialog
    .getByRole("combobox", { name: "Webcam", exact: true })
    .selectOption("false");
  await openStartingFiles(dialog);
  await dialog
    .getByRole("combobox", { name: "Starting files", exact: true })
    .selectOption("empty");
  await dialog
    .getByRole("button", { name: "Cancel editing", exact: true })
    .click({ timeout: 3000 });
  await rows
    .nth(1)
    .getByRole("button", { name: "Edit settings", exact: true })
    .click({ timeout: 3000 });
  await expect(
    dialog.getByRole("combobox", { name: "Webcam", exact: true }),
  ).toHaveValue("true");
  await openStartingFiles(dialog);
  await expect(
    dialog.getByRole("combobox", { name: "Starting files", exact: true }),
  ).toHaveValue("template");
  await dialog
    .getByRole("button", { name: "Cancel editing", exact: true })
    .click({ timeout: 3000 });
  await rows
    .nth(0)
    .getByRole("button", { name: "Cancel attempt", exact: true })
    .click({ timeout: 3000 });
  await expect(
    dialog
      .getByRole("region", { name: "Review unused changes", exact: true })
      .getByRole("article"),
  ).toHaveCount(1);
  expect(f.state.writes).toHaveLength(0);
  await dialog
    .getByRole("button", { name: "Cancel attempt", exact: true })
    .click({ timeout: 3000 });
  await expect(dialog.getByText("Cancelled", { exact: true })).toBeVisible();
  expect(f.state.writes[0].rows.map((row: any) => row.id)).toEqual([
    f.original[0].id,
  ]);
  expect(f.state.grants[0].status).toBe("REVOKED");
  expect(f.state.grants[3]).toEqual(f.original[3]);
});

test("personal saved-file choices explain an empty completed list without blocking cancellation", async ({
  page,
}, info) => {
  const f = await fixture(page, "normal", false, "Programming exam");
  f.state.sourceAttempts = [];
  const dialog = await f.openPersonal();
  await chooseSavedFiles(dialog);
  await expect(
    dialog.getByText(/No saved files are available for amy in/),
  ).toBeVisible();
  await expect(dialog).toContainText(/[Kk]eep the current files/);
  await expect(
    dialog.getByRole("combobox", { name: "Saved work for amy", exact: true }),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 430, height: 900 });
  const noFiles = dialog.getByText(/No saved files are available for amy in/);
  await noFiles.scrollIntoViewIfNeeded({ timeout: 3000 });
  await expect(noFiles).toBeInViewport();
  await page.screenshot({
    path: info.outputPath("personal-no-saved-files-mobile.png"),
    fullPage: true,
  });
  await dialog
    .getByRole("button", { name: "Cancel editing", exact: true })
    .click({ timeout: 3000 });
  await dialog
    .getByRole("button", { name: "Cancel attempt", exact: true })
    .click({ timeout: 3000 });
  await expect(
    dialog.getByRole("button", {
      name: "Cancel attempt",
      exact: true,
    }),
  ).toBeEnabled();
  expect(f.state.writes).toHaveLength(0);
  expect(f.state.grants).toEqual(f.original);
});

test("personal saved-file choices show one current safe source directly with its exact exam name and code", async ({
  page,
}, info) => {
  const f = await fixture(page, "normal", false, "Programming exam"),
    dialog = await f.openPersonal();
  await chooseSavedFiles(dialog);
  await expect(dialog.getByText(/Programming exam.*Attempt 1/)).toBeVisible();
  await expect(dialog).toContainText("Programming exam · prof-unused");
  await expect(
    dialog.getByRole("combobox", { name: "From exam", exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("combobox", { name: "Saved work for amy", exact: true }),
  ).toHaveCount(0);
  const savedFiles = dialog.getByText(/Programming exam.*Attempt 1/);
  await savedFiles.scrollIntoViewIfNeeded({ timeout: 3000 });
  await expect(savedFiles).toBeInViewport();
  await page.screenshot({
    path: info.outputPath("personal-one-saved-source-desktop.png"),
    fullPage: true,
  });
  expect(f.state.writes).toHaveLength(0);
  await dialog
    .getByRole("button", { name: "Review changes", exact: true })
    .click({ timeout: 3000 });
  await dialog
    .getByRole("button", { name: "Apply changes", exact: true })
    .click({ timeout: 3000 });
  await expect(
    dialog.getByText("Settings saved", { exact: true }),
  ).toBeVisible();
  expect(f.state.writes[0].rows[0].body.work).toEqual({
    kind: "saved",
    attempt: f.source.id,
    checksum: f.source.checksum,
  });
  expect(f.state.grants[0].status).toBe("PENDING_NATIVE");
});

test("personal saved-file choices keep multiple sources selectable and distinguish generic and archived exam names", async ({
  page,
}) => {
  const f = await fixture(page, "normal", false, "Programming exam"),
    latest = {
      ...f.source,
      id: "44444444-4444-4444-8444-444444444444",
      start: f.source.start + 10000,
      attempt_number: 2,
    };
  f.state.sourceAttempts.push(latest);
  f.state.examDefinitions.push({
    ...f.state.examDefinitions[0],
    id: "recovery-source",
    name: "Programming exam (recovery)",
    lifecycle: "archived",
  });
  const recovery = {
    ...f.source,
    id: "55555555-5555-4555-8555-555555555555",
    exam: "recovery-source",
    settings: {
      ...f.settings,
      id: "recovery-source",
      name: "Programming exam (recovery)",
    },
  };
  f.state.sourceAttempts.push(recovery);
  const dialog = await f.openPersonal();
  await chooseSavedFiles(dialog);
  const choices = dialog.getByRole("combobox", {
    name: "Saved work for amy",
    exact: true,
  });
  await expect(choices).toHaveValue(latest.id);
  await expect(choices.getByRole("option")).toHaveCount(3);
  const exams = dialog.getByRole("combobox", {
    name: "From exam",
    exact: true,
  });
  await expect(
    exams.getByRole("option", {
      name: "Programming exam · prof-unused",
      exact: true,
    }),
  ).toHaveCount(1);
  await expect(
    exams.getByRole("option", {
      name: "Programming exam (recovery) · recovery-source · Archived",
      exact: true,
    }),
  ).toHaveCount(1);
  await choices.selectOption(f.source.id);
  await exams.selectOption("recovery-source");
  await expect(
    dialog.getByText(/Programming exam \(recovery\).*Attempt 1/),
  ).toBeVisible();
  await expect(
    dialog.getByRole("combobox", { name: "Saved work for amy", exact: true }),
  ).toHaveCount(0);
  await dialog
    .getByRole("button", { name: "Review changes", exact: true })
    .click({ timeout: 3000 });
  await dialog
    .getByRole("button", { name: "Apply changes", exact: true })
    .click({ timeout: 3000 });
  await expect(
    dialog.getByText("Settings saved", { exact: true }),
  ).toBeVisible();
  expect(f.state.writes[0].rows[0].body.work).toEqual({
    kind: "saved",
    attempt: recovery.id,
    checksum: recovery.checksum,
  });
});

for (const scenario of ["unsafe", "tied"] as const)
  test(`personal saved-file choices never automatically substitute an older source when latest is ${scenario}`, async ({
    page,
  }) => {
    const f = await fixture(page),
      unsafe = {
        ...f.source,
        id: "44444444-4444-4444-8444-444444444444",
        start: f.source.start + 10000,
        state: "ACTIVE",
        protected: 0,
      };
    f.state.sourceAttempts.push(unsafe);
    if (scenario === "tied")
      f.state.sourceAttempts.push({
        ...unsafe,
        id: "55555555-5555-4555-8555-555555555555",
      });
    const dialog = await f.openPersonal();
    await chooseSavedFiles(dialog);
    await expect(
      dialog.getByText(
        scenario === "unsafe"
          ? "The latest attempt’s saved files are not available. Choose an earlier attempt or keep the current files."
          : "The latest attempt could not be identified. Choose an attempt or keep the current files.",
        { exact: true },
      ),
    ).toBeVisible();
    const choices = dialog.getByRole("combobox", {
      name: "Saved work for amy",
      exact: true,
    });
    await expect(choices).toHaveValue("");
    await expect(choices.getByRole("option")).toHaveCount(2);
    expect(f.state.writes).toHaveLength(0);
    await choices.selectOption(f.source.id);
    await dialog
      .getByRole("button", { name: "Review changes", exact: true })
      .click({ timeout: 3000 });
    await dialog
      .getByRole("button", { name: "Apply changes", exact: true })
      .click({ timeout: 3000 });
    await expect(
      dialog.getByText("Settings saved", { exact: true }),
    ).toBeVisible();
    expect(f.state.writes[0].rows[0].body.work).toEqual({
      kind: "saved",
      attempt: f.source.id,
      checksum: f.source.checksum,
    });
  });

test("personal source choice clearing and stale choices never fall back invisibly", async ({
  page,
}) => {
  const f = await fixture(page),
    latest = {
      ...f.source,
      id: "44444444-4444-4444-8444-444444444444",
      start: f.source.start + 10000,
      attempt_number: 2,
    };
  f.state.sourceAttempts.push(latest);
  const dialog = await f.openPersonal();
  await chooseSavedFiles(dialog);
  let choices = dialog.getByRole("combobox", {
    name: "Saved work for amy",
    exact: true,
  });
  await expect(choices).toHaveValue(latest.id);
  await choices.selectOption("");
  let reads = f.state.statusReads;
  // Review must run the management guard rather than stop at browser validation.
  await dialog
    .getByRole("button", { name: "Review changes", exact: true })
    .click({ timeout: 3000 });
  await expect.poll(() => f.state.statusReads).toBeGreaterThan(reads);
  await expect(dialog.getByRole("alert")).toContainText(
    "choose protected saved work",
  );
  expect(f.state.writes).toHaveLength(0);
  await choices.selectOption(f.source.id);
  f.state.sourceAttempts = [latest];
  await dialog
    .getByRole("button", { name: "Refresh saved work", exact: true })
    .click({ timeout: 3000 });
  await expect(
    dialog.getByText("Loading saved work…", { exact: true }),
  ).toHaveCount(0);
  choices = dialog.getByRole("combobox", {
    name: "Saved work for amy",
    exact: true,
  });
  await expect(choices).toHaveValue("");
  reads = f.state.statusReads;
  await dialog
    .getByRole("button", { name: "Review changes", exact: true })
    .click({ timeout: 3000 });
  await expect.poll(() => f.state.statusReads).toBeGreaterThan(reads);
  await expect(dialog.getByRole("alert")).toContainText(
    "choose protected saved work",
  );
  expect(f.state.writes).toHaveLength(0);
});

test("personal historical focus never automatically targets a different unused permission", async ({
  page,
}) => {
  const f = await fixture(page),
    historical = {
      ...structuredClone(f.state.grants[0]),
      id: "44444444-4444-4444-8444-444444444444",
      status: "CONSUMED",
      claims: [{ state: "CONSUMED" }],
    };
  f.state.grants.push(historical);
  f.original.push(structuredClone(historical));
  f.state.dashboardAttempts = [
    {
      ...f.source,
      settings: JSON.stringify(f.settings),
      deadline: f.source.original_deadline,
      ended: f.source.original_deadline,
      grantContext: { ...historical, state: "recorded" },
    },
  ];
  await page.getByLabel("Selected exam").selectOption(f.settings.id);
  await page
    .getByRole("button", {
      name: "View settings for amy attempt 1",
      exact: true,
    })
    .click({ timeout: 3000 });
  const dialog = page.getByRole("dialog", {
    name: "Allowed attempts for amy",
    exact: true,
  });
  await expect(dialog.getByText(/^Editing:/)).toHaveCount(0);
  const review = dialog.getByRole("button", {
    name: "Review changes",
    exact: true,
  });
  if (await review.count()) await expect(review).toBeDisabled();
  await expect(dialog.getByRole("checkbox")).toHaveCount(0);
  expect(f.state.writes).toHaveLength(0);
  expect(f.state.grants).toEqual(f.original);
});

test("personal unknown changes keep their exact reviewed request after reopening", async ({
  page,
}) => {
  const f = await fixture(page, "partial");
  let dialog = await f.openPersonal();
  await dialog
    .getByRole("combobox", { name: "Webcam", exact: true })
    .selectOption("false");
  await dialog
    .getByRole("button", { name: "Review changes", exact: true })
    .click({ timeout: 3000 });
  await dialog
    .getByRole("button", { name: "Apply changes", exact: true })
    .click({ timeout: 3000 });
  await expect(
    dialog.getByText("Change unconfirmed", { exact: true }),
  ).toBeVisible();
  const original = structuredClone(f.state.writes[0]);
  await page.reload();
  dialog = await f.openPersonal();
  await expect(
    dialog.getByRole("button", { name: "Edit settings", exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("button", {
      name: "Retry unconfirmed changes",
      exact: true,
    }),
  ).toBeEnabled();
  await dialog
    .getByRole("button", { name: "Retry unconfirmed changes", exact: true })
    .click({ timeout: 3000 });
  await expect(
    dialog.getByText("Settings saved", { exact: true }),
  ).toBeVisible();
  expect(f.state.writes).toHaveLength(2);
  expect(f.state.writes[1]).toEqual(original);
});

test("personal refresh never opens a different editor after its previous target starts", async ({
  page,
}) => {
  const f = await fixture(page),
    extra = structuredClone(f.state.grants[0]);
  extra.id = "44444444-4444-4444-8444-444444444444";
  extra.issuance_order = 4;
  f.state.grants.push(extra);
  const dialog = await f.openPersonal("amy", false);
  await dialog
    .getByRole("button", { name: "Edit settings", exact: true })
    .first()
    .click({ timeout: 3000 });
  await expect(dialog.getByText(/^Editing:/)).toBeVisible();
  f.state.grants[0].status = "CONSUMED";
  f.state.grants[0].claims = [{ state: "CONSUMED" }];
  await dialog
    .getByRole("button", { name: "Refresh", exact: true })
    .click({ timeout: 3000 });
  await expect(dialog.getByText(/^Editing:/)).toHaveCount(0);
  extra.settings.duration = 900;
  await dialog
    .getByRole("button", { name: "Refresh", exact: true })
    .click({ timeout: 3000 });
  await expect(
    dialog.getByText("15 min · Webcam required", { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByText(/^Editing:/)).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Review changes", exact: true }),
  ).toHaveCount(0);
  expect(f.state.writes).toHaveLength(0);
});

test("personal missing starter-file choice reaches the manual Review guard without discarding intent", async ({
  page,
}) => {
  const f = await fixture(page);
  f.state.grants[0].work = { kind: "empty" } as any;
  f.original[0] = structuredClone(f.state.grants[0]);
  const dialog = await f.openPersonal();
  await openStartingFiles(dialog);
  await dialog
    .getByRole("combobox", { name: "Starting files", exact: true })
    .selectOption("template");
  await expect(
    dialog.getByRole("combobox", { name: "Starter files", exact: true }),
  ).toHaveValue("");
  const reads = f.state.statusReads;
  await dialog
    .getByRole("button", { name: "Review changes", exact: true })
    .click({ timeout: 3000 });
  await expect.poll(() => f.state.statusReads).toBeGreaterThan(reads);
  await expect(dialog.getByRole("alert")).toContainText(
    "Choose published starter files",
  );
  await openStartingFiles(dialog);
  await expect(
    dialog.getByRole("combobox", { name: "Starting files", exact: true }),
  ).toHaveValue("template");
  await expect(
    dialog.getByRole("region", { name: "Review unused changes", exact: true }),
  ).toHaveCount(0);
  expect(f.state.writes).toHaveLength(0);
  expect(f.state.grants).toEqual(f.original);
});

test("personal Review rejects unfinished native number input and preserves the draft for repair", async ({
  page,
}) => {
  const f = await fixture(page),
    dialog = await f.openPersonal();
  await dialog
    .getByRole("combobox", { name: "Webcam", exact: true })
    .selectOption("false");
  const duration = dialog.getByRole("spinbutton", {
    name: "Time limit (minutes)",
    exact: true,
  });
  await duration.focus();
  await expect(duration).toBeFocused();
  await duration.pressSequentially("1e");
  await expect(duration).toHaveValue("");
  expect(
    await duration.evaluate(
      (element) => (element as HTMLInputElement).validity.badInput,
    ),
  ).toBe(true);
  const reads = f.state.statusReads;
  await dialog
    .getByRole("button", { name: "Review changes", exact: true })
    .click({ timeout: 3000 });
  await expect(dialog.getByRole("alert")).toContainText(
    "Complete Time limit (minutes) before reviewing.",
  );
  expect(f.state.statusReads).toBe(reads);
  expect(f.state.writes).toHaveLength(0);
  await expect(
    dialog.getByRole("region", { name: "Review unused changes", exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByRole("combobox", { name: "Webcam", exact: true }),
  ).toHaveValue("false");
  await duration.fill("90");
  await dialog
    .getByRole("button", { name: "Review changes", exact: true })
    .click({ timeout: 3000 });
  await expect(
    dialog.getByRole("region", { name: "Review unused changes", exact: true }),
  ).toContainText("Webcam: Required → Optional");
  await expect(
    dialog.getByRole("region", { name: "Review unused changes", exact: true }),
  ).toContainText("Time limit: 1 min 35 sec → 90 min");
  expect(f.state.writes).toHaveLength(0);
});
