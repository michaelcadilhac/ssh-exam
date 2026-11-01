import { test, expect, type Page } from "@playwright/test";
test.use({ timezoneId: "America/Chicago" });

async function fixture(
  page: Page,
  count = 3,
  pinned = true,
  displayName = "Midterm",
) {
  page.setDefaultTimeout(7000);
  const exam = "prof-another",
    now = Date.now(),
    id = "88888888-8888-4888-8888-888888888888";
  const settings = {
    id: exam,
    name: displayName,
    template: "sample-exam",
    template_version: pinned ? "a".repeat(64) : "",
    revision: "b".repeat(64),
    duration: 5400,
    webcam: true,
    terminals: 4,
    earliest: now - 86400000,
    latest: now - 3600000,
  };
  const usernames = Array.from(
    { length: count },
    (_, i) => `student${String(i + 1).padStart(2, "0")}`,
  );
  const attempts = usernames
    .filter((_, i) => count > 3 || i === 0)
    .map((username, i) => ({
      id: `11111111-1111-4111-8111-${String(i + 1).padStart(12, "0")}`,
      exam,
      username,
      uid: 10001 + i,
      state: "COMPLETED",
      protected: 1,
      checksum: "c".repeat(64),
      start: now - 7200000,
      deadline: now - 3600000,
      original_deadline: now - 3600000,
      settings: { name: displayName },
      attempt_number: 1,
      access_state: "RELEASED",
    }));
  const state = {
    previews: [] as any[],
    confirmations: [] as any[],
    cohortReads: 0,
    individualReads: 0,
    ready: false,
    dropPreview: false,
    dropConfirm: false,
    review: null as any,
    attempts,
  };
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname;
    if (path === "/api/session")
      return route.fulfill({
        json: { role: "admin", username: "instructor", csrf: "fixture" },
      });
    if (path === "/api/login-test")
      return route.fulfill({ json: { loginOnly: false, browserSSH: true } });
    if (path === "/api/admin/exams") return route.fulfill({ json: [settings] });
    if (path.endsWith("/dashboard"))
      return route.fulfill({
        json: {
          serverNow: now,
          students: usernames.map((username, i) => ({
            username,
            enrollment: {
              duration: i === 0 ? 95 : null,
              webcam: i === 0 ? 0 : null,
            },
            attempts: attempts.filter((a) => a.username === username),
          })),
          total: count,
          counts: { students: count },
          incidents: [],
        },
      });
    if (path.endsWith("/attempts"))
      return route.fulfill({
        json: {
          attempts: state.attempts,
          scanned: state.attempts.length,
          next: null,
        },
      });
    if (path.endsWith("/grant-reviews"))
      return route.fulfill({
        json: {
          agent: "class",
          exam,
          actor: "instructor",
          rows: state.review
            ? [
                {
                  id,
                  kind: state.review.kind,
                  status: state.review.status,
                  created: now,
                  expires: now + 900000,
                  reason: state.review.reason,
                  usernames,
                },
              ]
            : [],
          next: null,
        },
      });
    if (path.endsWith("/additional-preview")) {
      const body = route.request().postDataJSON();
      state.previews.push(body);
      state.review = {
        id,
        exam,
        actor: "instructor",
        kind: "NEW_ADDITIONAL_TEMPLATE_GRANTS",
        status: "REVIEW",
        revision: "d".repeat(64),
        created: now,
        expires: now + 900000,
        reason: body.reason,
        issued: [],
        rows: body.usernames.map((username: string, i: number) => ({
          username,
          work: body.work_sources.find((s: any) => s.username === username)
            .work,
          settings: {
            ...settings,
            duration: body.duration ?? (i === 0 ? 95 : 5400),
            webcam: body.webcam ?? i !== 0,
            earliest: body.earliest,
            latest: body.latest,
          },
          existing_grants: 0,
        })),
      };
      if (state.dropPreview) {
        state.dropPreview = false;
        return route.abort("failed");
      }
      return route.fulfill({ json: state.review });
    }
    if (path === `/api/admin/grant-issuance/${id}/confirm`) {
      state.confirmations.push(route.request().postDataJSON());
      state.review.status = "CONFIRMED";
      state.review.issued = state.review.rows.map((row: any, i: number) => ({
        username: row.username,
        grant: `22222222-2222-4222-8222-${String(i + 1).padStart(12, "0")}`,
      }));
      if (state.dropConfirm) {
        state.dropConfirm = false;
        return route.abort("failed");
      }
      return route.fulfill({ json: state.review });
    }
    if (path === `/api/admin/grant-issuance/${id}/source-setup`) {
      state.cohortReads++;
      return route.fulfill({
        json: {
          id,
          rows: state.review.issued.map((g: any) => {
            const row = state.review.rows.find(
                (r: any) => r.username === g.username,
              ),
              pending = row.work.kind === "saved" && !state.ready;
            return {
              id: g.grant,
              username: g.username,
              revision: 1,
              current_revision: 1,
              grant_status: pending ? "PENDING_NATIVE" : "AVAILABLE",
              status: pending ? "RUNNING" : "READY",
              tries: 1,
              error: "",
              grant: {
                id: g.grant,
                revision: 1,
                status: pending ? "PENDING_NATIVE" : "AVAILABLE",
                settings: row.settings,
                claims: [],
              },
            };
          }),
        },
      });
    }
    if (path === `/api/admin/grant-issuance/${id}`)
      return route.fulfill({ json: state.review });
    if (path.includes("/admin/grants/")) {
      state.individualReads++;
      return route.fulfill({
        status: 500,
        json: { error: "Unexpected individual polling" },
      });
    }
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto("/admin");
  await page.getByLabel("Selected exam").selectOption(exam);
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
      .getByRole("menuitem", { name: "Allow another attempt", exact: true })
      .click();
    return page.getByRole("dialog", {
      name: "Allow another attempt",
      exact: true,
    });
  };
  return { state, open, usernames };
}

test("source exams show their recognizable code even when the display name is generic", async ({
  page,
}) => {
  const f = await fixture(page, 1, true, "Programming exam"),
    dialog = await f.open(),
    source = dialog.getByText(
      "Saved work from Programming exam · prof-another",
      { exact: true },
    );
  await expect(source).toBeVisible({ timeout: 3000 });
  await source.click({ timeout: 3000 });
  await expect(
    dialog.getByRole("checkbox", {
      name: "Programming exam · prof-another",
      exact: true,
    }),
  ).toBeChecked();
  expect(f.state.previews).toHaveLength(0);
  expect(f.state.confirmations).toHaveLength(0);
});

test("another attempt uses two screens with fetched mixed sources and exact per-student settings", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 430, height: 1000 });
  const f = await fixture(page),
    dialog = await f.open();
  await expect(dialog.getByLabel("Starting files for student01")).toContainText(
    "Midterm · Attempt 1",
  );
  await expect(dialog.getByLabel("Starting files for student02")).toContainText(
    "Automatic: Starter files: sample-exam",
  );
  await expect(dialog.getByLabel("Closes", { exact: true })).toHaveValue("");
  await dialog.getByRole("button", { name: "Review", exact: true }).click();
  expect(f.state.previews).toHaveLength(0);
  await dialog.getByLabel("Closes", { exact: true }).fill("2026-11-06T23:42");
  await expect(
    dialog.getByLabel("Time limit (minutes)", { exact: true }),
  ).toHaveValue("");
  await expect(
    dialog.getByRole("textbox", { name: /username|checksum|hash|UUID/i }),
  ).toHaveCount(0);
  await dialog.getByRole("button", { name: "Review", exact: true }).click();
  await expect(
    dialog.getByRole("heading", { name: "Review attempts", exact: true }),
  ).toBeVisible();
  expect(f.state.previews).toHaveLength(1);
  expect(f.state.confirmations).toHaveLength(0);
  expect(f.state.previews[0].preserve_duration).toBe(true);
  expect(f.state.previews[0]).not.toHaveProperty("duration");
  expect(f.state.previews[0].work_sources.map((s: any) => s.work.kind)).toEqual(
    ["saved", "template", "template"],
  );
  await expect(dialog).toContainText("1 min 35 sec · Webcam optional");
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(
    dialog.getByRole("button", { name: "Close", exact: true }),
  ).toBeInViewport({ ratio: 1 });
  await page.screenshot({
    path: info.outputPath("another-attempt-review-mobile.png"),
    fullPage: true,
  });
  await dialog
    .getByRole("button", { name: "Allow attempts", exact: true })
    .click();
  await expect(dialog).toContainText("Preparing saved work");
  await expect(dialog).not.toContainText("sudo examctl");
  f.state.ready = true;
  await dialog
    .getByRole("button", { name: "Refresh status", exact: true })
    .click();
  await expect(dialog.getByText("Ready", { exact: true })).toBeVisible();
  expect(f.state.individualReads).toBe(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("a lost preview displays its saved intent after reload and a lost confirmation cannot duplicate issuance", async ({
  page,
}) => {
  const f = await fixture(page),
    dialog = await f.open();
  await dialog.getByLabel("Closes", { exact: true }).fill("2026-11-06T23:42");
  f.state.dropPreview = true;
  await dialog.getByRole("button", { name: "Review", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "Retry same request", exact: true }),
  ).toBeEnabled();
  const original = f.state.previews[0];
  await page.reload();
  await f.open();
  await expect(
    dialog.getByRole("region", { name: "Unconfirmed request" }),
  ).toBeVisible();
  await expect(dialog.getByLabel("Closes", { exact: true })).toHaveCount(0);
  await dialog
    .getByRole("button", { name: "Retry same request", exact: true })
    .click();
  expect(f.state.previews[1]).toEqual(original);
  f.state.dropConfirm = true;
  await dialog
    .getByRole("button", { name: "Allow attempts", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Retry same request", exact: true }),
  ).toBeEnabled();
  await page.reload();
  await f.open();
  await expect(
    dialog.getByRole("heading", { name: "Attempts allowed", exact: true }),
  ).toBeVisible();
  expect(f.state.confirmations).toHaveLength(1);
});

test("a review polls one cohort, rather than every student, and invalid latest files never fall back silently", async ({
  page,
}) => {
  test.setTimeout(25000);
  const f = await fixture(page, 16),
    dialog = await f.open();
  await dialog
    .getByText("Saved work from Midterm · prof-another", { exact: true })
    .click();
  await dialog
    .getByRole("checkbox", { name: "Midterm · prof-another", exact: true })
    .uncheck();
  await expect(dialog.getByRole("alert")).toContainText(
    "Choose at least one source exam.",
  );
  await expect(
    dialog.getByRole("button", { name: "Review", exact: true }),
  ).toBeDisabled();
  await expect(dialog.getByText(/Starter files: 16/)).toHaveCount(0);
  await dialog
    .getByRole("checkbox", { name: "Midterm · prof-another", exact: true })
    .check();
  f.state.attempts.push({
    ...f.state.attempts[0],
    id: "77777777-7777-4777-8777-777777777777",
    start: Date.now() - 1000,
    protected: 0,
  });
  // Reload histories by re-opening; the latest invalid record must block the
  // automatic selection even though an older protected archive exists.
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await f.open();
  await expect(dialog.getByLabel("Starting files for student01")).toContainText(
    "Latest files need review",
  );
  await dialog.getByLabel("Closes", { exact: true }).fill("2026-11-06T23:42");
  await dialog.getByRole("button", { name: "Review", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  expect(f.state.previews).toHaveLength(0);
  await dialog
    .getByLabel("Starting files for student01")
    .selectOption(f.state.attempts[0].id);
  await expect(dialog.getByText(/Needs review: 1/)).toHaveCount(0);
  await expect(
    dialog
      .getByLabel("Starting files for student01")
      .getByRole("option", { name: /Automatic: Latest files need review/ }),
  ).toHaveCount(1);
  await dialog.getByRole("button", { name: "Review", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Allow attempts", exact: true })
    .click();
  await expect(
    dialog.getByText("Preparing saved work", { exact: true }),
  ).toHaveCount(16);
  await expect.poll(() => f.state.cohortReads).toBeGreaterThanOrEqual(2);
  expect(f.state.cohortReads).toBeLessThanOrEqual(3);
  expect(f.state.individualReads).toBe(0);
});

test("a disabled review explains missing published exam files", async ({
  page,
}) => {
  const f = await fixture(page, 1, false),
    dialog = await f.open();
  await dialog
    .getByRole("combobox", { name: "Start with", exact: true })
    .selectOption("empty");
  await expect(
    dialog.getByRole("button", { name: "Review", exact: true }),
  ).toBeDisabled();
  await expect(dialog).toContainText(
    "Choose published starter files in Exam defaults before reviewing.",
  );
  expect(f.state.previews).toHaveLength(0);
});
