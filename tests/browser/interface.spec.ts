import { test, expect, request, type Page } from "@playwright/test";
async function adminCommand(page: Page, command: string) {
  await page
    .getByRole("button", { name: "Administration", exact: true })
    .click();
  await page.getByRole("menuitem", { name: command, exact: true }).click();
}
async function rowCommand(page: Page, label: string, command: string) {
  await page.getByRole("button", { name: label, exact: true }).click();
  await page.getByRole("menuitem", { name: command, exact: true }).click();
}
test("sandbox auto-enrolls, resumes without an instructor, preserves the deadline and retains repeat history", async ({
  page,
}) => {
  await simulatedMedia(page);
  await studentSignIn(page, "sandbox", "student04");
  await page.getByRole("button", { name: "Open preflight & practice" }).click();
  await page.getByRole("button", { name: "1. Share entire display" }).click();
  await page.getByRole("button", { name: "2. Enter fullscreen" }).click();
  await page
    .getByRole("button", { name: "3. Lock keyboard", exact: true })
    .click();
  await page.getByRole("button", { name: "Begin exam", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Begin exam", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Finish exam", exact: true }),
  ).toBeVisible();
  const initial = (await (await page.request.get("/api/student/exam")).json())
    .attempt;
  expect(initial.deadline - initial.start).toBe(300000);
  await page.evaluate(() => document.exitFullscreen());
  await expect(
    page.getByRole("heading", { name: "Exam paused" }),
  ).toBeVisible();
  await expect
    .poll(
      async () =>
        (await (await page.request.get("/api/student/exam")).json())
          .sshConnected,
    )
    .toBe(false);
  await page
    .getByRole("button", { name: "Reconnect SSH", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Connect to your exam" }),
  ).toBeVisible();
  await studentSignIn(page, "sandbox", "student04", "Restore page");
  await page.getByRole("button", { name: "Restore page", exact: true }).click();
  await page
    .getByRole("button", { name: "Restore screen sharing", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Restore fullscreen", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Restore keyboard lock", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Continue exam", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "Exam paused" })).toHaveCount(
    0,
  );
  const resumed = (await (await page.request.get("/api/student/exam")).json())
    .attempt;
  expect(resumed.deadline).toBe(initial.deadline);
  // An invalidated browser session may still recover; the toolbar no longer
  // offers a separate sign-out action during an active exam.
  const session = await (await page.request.get("/api/session")).json();
  expect(
    (
      await page.request.post("/api/logout", {
        headers: {
          "X-CSRF-Token": session.csrf,
          Origin: "http://localhost:3100",
        },
        data: {},
      })
    ).ok(),
  ).toBe(true);
  await studentSignIn(page, "sandbox", "student04", "Restore page");
  await page.getByRole("button", { name: "Restore page", exact: true }).click();
  await page
    .getByRole("button", { name: "Restore screen sharing", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Restore fullscreen", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Restore keyboard lock", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Continue exam", exact: true })
    .click();
  await expect(page.getByRole("heading", { name: "Exam paused" })).toHaveCount(
    0,
  );
  const relogged = (await (await page.request.get("/api/student/exam")).json())
    .attempt;
  expect(relogged.id).toBe(initial.id);
  expect(relogged.deadline).toBe(initial.deadline);
  await page.getByRole("button", { name: "Finish exam", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Finish exam", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Connect to your exam", exact: true }),
  ).toBeVisible();
  expect((await page.request.get("/api/session")).status()).toBe(401);
  await studentSignIn(page, "sandbox", "student04");
  await page.getByRole("button", { name: "Open preflight & practice" }).click();
  await expect(page.locator(".empty-workspace")).toContainText(
    "try your tools before the exam",
  );
  await expect(page.locator(".exam-toolbar")).not.toContainText(
    /ordinary access|Screen|Camera|\/work/,
  );
  await expect(
    page.getByRole("button", { name: "1. Share entire display" }),
  ).toBeVisible();
  const repeat = (await (await page.request.get("/api/student/exam")).json())
    .attempt;
  expect(repeat.id).not.toBe(initial.id);
  const old = await page.request.get(
    `/api/student/attempts/${initial.id}/status`,
  );
  expect(old.ok()).toBe(true);
  expect((await old.json()).attempt.protected).toBe(1);
  await expect
    .poll(
      async () =>
        (
          await (
            await page.request.get(`/api/student/attempts/${initial.id}/status`)
          ).json()
        ).attempt.export_status,
    )
    .toBe("server-only");
  expect(
    (await (await page.request.get("/api/student/exam")).json()).sshConnected,
  ).toBe(true);
  await page
    .getByRole("button", { name: "Practice terminal", exact: true })
    .click();
  await expect(page.locator(".winbox")).toHaveCount(1);
});
for (const [index, missing] of [
  "keyboard lock",
  "fullscreen",
  "screen sharing",
  "embedding policy",
  "denied permission",
].entries()) {
  test(`unsupported browser blocks student authentication: ${missing}`, async ({
    page,
  }) => {
    // These independent browser clients share one fixture server. Keep their
    // anonymous traffic out of the student's existing per-IP rate-limit budget.
    await page.setExtraHTTPHeaders({
      "X-Forwarded-For": `198.51.100.${index + 1}`,
    });
    await page.addInitScript((missing) => {
      if (missing === "keyboard lock")
        Object.defineProperty(navigator, "keyboard", { value: undefined });
      if (missing === "fullscreen")
        Object.defineProperty(document, "fullscreenEnabled", { value: false });
      if (missing === "screen sharing")
        Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", {
          value: undefined,
        });
      if (missing === "embedding policy")
        Object.defineProperty(document, "featurePolicy", {
          value: {
            features: () => ["display-capture"],
            allowsFeature: () => false,
          },
        });
      if (missing === "denied permission")
        Object.defineProperty(navigator, "permissions", {
          value: { query: async () => ({ state: "denied" }) },
        });
    }, missing);
    let authenticationRequests = 0;
    page.on("request", (req) => {
      if (new URL(req.url()).pathname === "/api/auth/start")
        authenticationRequests++;
    });
    await page.goto("/");
    await expect(page.getByRole("alert")).toContainText(
      "This browser cannot run an exam",
    );
    await expect(page.getByRole("alert")).toContainText(
      "desktop Chrome, Edge or Chromium",
    );
    await expect(
      page.getByRole("button", { name: "Start SSH sign-in" }),
    ).toHaveCount(0);
    await expect(page.getByLabel("Exam ID", { exact: true })).toHaveCount(0);
    await expect(page.getByLabel("Enrolled username")).toHaveCount(0);
    await expect(page.locator(".sign-in form, .sign-in input")).toHaveCount(0);
    expect(authenticationRequests).toBe(0);
    await expect(page.getByLabel("Shared SSH password")).toHaveCount(0);
    await page.getByRole("link", { name: "Instructor sign-in" }).click();
    await expect(
      page.getByRole("heading", { name: "Instructor sign-in" }),
    ).toBeVisible();
    await expect(page.getByLabel("Username", { exact: true })).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "Sign in", exact: true }),
    ).toBeEnabled();
  });
}

test("student notice and authentication are accessible and self-hosted", async ({
  page,
}) => {
  const outside: string[] = [];
  page.on("request", (r) => {
    if (!r.url().startsWith("http://localhost:3100")) outside.push(r.url());
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Connect to your exam" }),
  ).toBeVisible();
  await expect(
    page.getByText("No audio or raw keystrokes.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByLabel("Enrolled username")).toBeVisible();
  await expect(page.getByLabel("Exam ID", { exact: true })).toHaveValue("");
  await expect(page.locator(".intro, .landing footer")).toHaveCount(0);
  await expect(
    page.getByText("ONE WORKSPACE. YOUR CLASS SERVER.", { exact: true }),
  ).toHaveCount(0);
  expect(outside).toEqual([]);
  await page.screenshot({
    path: "docs/screenshots/student-sign-in.png",
    fullPage: true,
  });
});
test("instructor can add, remove and import students, cancel removal with Escape, and sign out", async ({
  page,
}) => {
  await page.goto("/admin");
  await page.getByLabel("Username", { exact: true }).fill("instructor");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByLabel("Selected exam", { exact: true })).toHaveValue(
    "",
  );
  await expect(page.getByRole("table")).toHaveCount(0);
  await page.getByRole("button", { name: "New exam", exact: true }).click();
  await expect(page.getByLabel("Exam ID", { exact: true })).toHaveValue("");
  await page.getByLabel("Exam ID", { exact: true }).fill("admin-created");
  await page.getByRole("button", { name: "Save exam", exact: true }).click();
  await expect(page.getByLabel("Selected exam", { exact: true })).toHaveValue(
    "admin-created",
  );
  await page.getByRole("button", { name: "Add student", exact: true }).click();
  await page.getByLabel("Student username", { exact: true }).fill("student02");
  await page.getByLabel("Webcam for this student").selectOption("false");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Add student", exact: true })
    .click();
  const roster = page.getByRole("table", { name: "Students and attempts" });
  await expect(
    roster.getByRole("row").filter({ hasText: "student02" }),
  ).toContainText("Not required");
  await rowCommand(page, "Actions for student student02", "Remove from exam…");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(roster).toContainText("student02");
  await page.getByLabel("Selected exam").selectOption("admin-created");
  await expect(roster).toContainText("student02");
  await rowCommand(page, "Actions for student student02", "Remove from exam…");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Remove student", exact: true })
    .click();
  await expect(
    page.getByRole("rowgroup", { name: "student02", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "No students yet", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Add student", exact: true }).click();
  const importDialog = page.getByRole("dialog", {
    name: "Add students",
    exact: true,
  });
  await importDialog
    .getByRole("button", { name: "CSV file", exact: true })
    .click();
  await expect(importDialog.locator("textarea")).toHaveCount(0);
  await importDialog.getByLabel("CSV file", { exact: true }).setInputFiles({
    name: "roster.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "username,require_webcam\nstudent01,false\nstudent03,inherit",
    ),
  });
  await expect(
    page.getByText("2 validated rows.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Confirm import" }).click();
  await expect(roster).toContainText("student01");
  await expect(roster).toContainText("student03");
  await page
    .getByLabel("Bulk action", { exact: true })
    .selectOption("duration");
  await page
    .getByRole("checkbox", { name: "Select student student01", exact: true })
    .check();
  await page
    .getByRole("checkbox", { name: "Select student student03", exact: true })
    .check();

  await page
    .getByRole("button", { name: "Apply to 2 students", exact: true })
    .click();
  let settings = page.getByRole("dialog", {
    name: "Set duration",
    exact: true,
  });
  await settings.getByRole("checkbox", { name: /Use exam default/ }).uncheck();
  await settings.getByLabel("Duration (minutes)", { exact: true }).fill("120");
  await settings
    .getByRole("button", { name: "Apply settings", exact: true })
    .click();
  await expect(settings).toHaveCount(0);
  for (const name of ["student01", "student03"])
    await expect(
      roster.getByRole("rowgroup", { name, exact: true }),
    ).toContainText("Duration: 120 minutes");
  await page.getByLabel("Bulk action", { exact: true }).selectOption("webcam");
  await page
    .getByRole("checkbox", { name: "Select student student01", exact: true })
    .check();
  await page
    .getByRole("checkbox", { name: "Select student student03", exact: true })
    .check();

  await page
    .getByRole("button", { name: "Apply to 2 students", exact: true })
    .click();
  settings = page.getByRole("dialog", {
    name: "Set webcam requirement",
    exact: true,
  });
  await settings.getByLabel("Webcam requirement").selectOption("false");
  await settings
    .getByRole("button", { name: "Apply settings", exact: true })
    .click();
  await expect(settings).toHaveCount(0);
  await expect(
    roster.getByRole("rowgroup", { name: "student03", exact: true }),
  ).toContainText("Not required");
  await expect(page.getByRole("link", { name: /Download/ })).toHaveCount(0);
  await page.screenshot({
    path: "docs/screenshots/instructor-dashboard.png",
    fullPage: true,
  });
  await adminCommand(page, "Sign out");
  await expect(
    page.getByRole("heading", { name: "Instructor sign-in" }),
  ).toBeVisible();
});

test("exam selection scopes the grouped history and ignores late replies after switching", async ({
  page,
}) => {
  await page.setExtraHTTPHeaders({ "X-Forwarded-For": "198.51.100.201" });
  const unexpected: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes("/api/admin/attempts?")) unexpected.push(req.url());
  });
  let hold = false,
    held = false,
    release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/admin/exams/sample/dashboard?*", async (route) => {
    if (hold) {
      held = true;
      await waiting;
    }
    const start = Date.now() - 60000,
      deadline = Date.now() + 300000;
    await route.fulfill({
      json: {
        serverNow: Date.now(),
        total: 1,
        counts: { active: 1, locked: 0, collected: 1 },
        incidents: [],
        students: [
          {
            username: "history-only-user",
            enrollment: { duration: null, webcam: null },
            attempts: [
              {
                id: "11111111-1111-4111-8111-111111111111",
                username: "history-only-user",
                exam: "sample",
                state: "ACTIVE",
                working: true,
                start,
                deadline,
                settings: JSON.stringify({ webcam: true }),
                attempt_number: 2,
              },
              {
                id: "22222222-2222-4222-8222-222222222222",
                username: "history-only-user",
                exam: "sample",
                state: "COMPLETED",
                start: start - 3600000,
                deadline: start,
                protected: 1,
                settings: JSON.stringify({ webcam: false }),
                attempt_number: 1,
              },
            ],
          },
        ],
      },
    });
  });
  await page.goto("/admin");
  await page.getByLabel("Username", { exact: true }).fill("instructor");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const selector = page.getByLabel("Selected exam", { exact: true });
  await expect(selector).toHaveValue("");
  await expect(page.getByRole("table")).toHaveCount(0);
  await selector.selectOption("sample");
  const table = page.getByRole("table", { name: "Students and attempts" });
  await expect(table.locator(".attempt-row")).toHaveCount(2);
  await expect(
    table.getByRole("rowgroup", { name: "history-only-user", exact: true }),
  ).toContainText("Exam default");
  await page
    .getByLabel("Filter attempts", { exact: true })
    .selectOption("COMPLETED");
  await expect(table.locator(".attempt-row")).toHaveCount(1);
  await expect(table.locator(".attempt-row")).toContainText("Attempt 1");
  await page.getByLabel("Filter attempts", { exact: true }).selectOption("");
  let releaseReview!: () => void;
  const waitReview = new Promise<void>((resolve) => {
    releaseReview = resolve;
  });
  let reviewCalls = 0,
    oldReviewSent = false;
  await page.route(
    "**/api/admin/attempts/11111111-1111-4111-8111-111111111111/recordings",
    async (route) => {
      const number = ++reviewCalls;
      if (number === 1) await waitReview;
      await route.fulfill({
        json: {
          frames: [],
          terminals: [],
          manifest: { label: number === 1 ? "stale-receipt" : "fresh-receipt" },
        },
      });
      if (number === 1) oldReviewSent = true;
    },
  );
  await table
    .locator(".attempt-row")
    .first()
    .getByRole("button", { name: "Review", exact: true })
    .click();
  try {
    await expect.poll(() => reviewCalls).toBe(1);
    await page
      .getByRole("button", { name: "Close review", exact: true })
      .click();
    await table
      .locator(".attempt-row")
      .first()
      .getByRole("button", { name: "Review", exact: true })
      .click();
    await page.getByRole("button", { name: "Submission", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("fresh-receipt");
    releaseReview();
    await expect.poll(() => oldReviewSent).toBe(true);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
    await expect(page.getByRole("dialog")).not.toContainText("stale-receipt");
    await page
      .getByRole("button", { name: "Close review", exact: true })
      .click();
  } finally {
    releaseReview();
  }
  await page.screenshot({
    path: test.info().outputPath("exam-dashboard.png"),
    fullPage: true,
  });
  await selector.selectOption("camera");
  await expect(table).not.toContainText("history-only-user");
  hold = true;
  await selector.selectOption("sample");
  try {
    await expect.poll(() => held).toBe(true);
    await selector.selectOption("camera");
    release();
    await expect(table).not.toContainText("history-only-user");
    await expect(selector).toHaveValue("camera");
    await expect(page.getByRole("link", { name: /Download/ })).toHaveCount(0);
    expect(unexpected).toEqual([]);
  } finally {
    release();
  }
});

test("instructor creates an administrator with confirmation, cancellation and duplicate protection", async ({
  page,
}) => {
  await page.setExtraHTTPHeaders({ "X-Forwarded-For": "198.51.100.202" });
  await page.goto("/admin");
  await page.getByLabel("Username", { exact: true }).fill("instructor");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  const add = { click: () => adminCommand(page, "Add administrator") };
  await add.click();
  let dialog = page.getByRole("dialog", { name: "Add administrator" });
  await dialog
    .getByLabel("Administrator username", { exact: true })
    .fill("cancelled-admin");
  await dialog
    .getByLabel("Password", { exact: true })
    .fill("cancelled-password");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Administration", exact: true }),
  ).toBeFocused();
  await add.click();
  dialog = page.getByRole("dialog", { name: "Add administrator" });
  await expect(dialog.getByLabel("Password", { exact: true })).toHaveValue("");
  await expect(
    dialog.getByLabel("Administrator username", { exact: true }),
  ).toHaveValue("");
  await dialog
    .getByLabel("Administrator username", { exact: true })
    .fill("helper-admin");
  await dialog
    .getByLabel("Password", { exact: true })
    .fill("helper-admin-password");
  await dialog
    .getByLabel("Confirm password", { exact: true })
    .fill("mismatched-password");
  await dialog
    .getByRole("button", { name: "Create administrator", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Passwords do not match",
  );
  await expect(dialog.getByLabel("Password", { exact: true })).toHaveValue("");
  await expect(
    dialog.getByLabel("Confirm password", { exact: true }),
  ).toHaveValue("");
  await dialog
    .getByLabel("Password", { exact: true })
    .fill("helper-admin-password");
  await dialog
    .getByLabel("Confirm password", { exact: true })
    .fill("helper-admin-password");
  let release!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/admin/administrators", async (route) => {
    await waiting;
    await route.continue();
  });
  try {
    await dialog
      .getByRole("button", { name: "Create administrator", exact: true })
      .click();
    await expect(
      dialog.getByRole("button", { name: "Creating…", exact: true }),
    ).toBeDisabled();
    await expect(dialog.getByLabel("Password", { exact: true })).toHaveValue(
      "",
    );
    await expect(
      dialog.getByLabel("Confirm password", { exact: true }),
    ).toHaveValue("");
  } finally {
    release();
  }
  await expect(dialog).toHaveCount(0);
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "Administrator helper-admin created." }),
  ).toBeVisible();
  await page.unroute("**/api/admin/administrators");
  await add.click();
  await dialog
    .getByLabel("Administrator username", { exact: true })
    .fill("helper-admin");
  await dialog
    .getByLabel("Password", { exact: true })
    .fill("different-admin-password");
  await dialog
    .getByLabel("Confirm password", { exact: true })
    .fill("different-admin-password");
  await dialog
    .getByRole("button", { name: "Create administrator", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("already exists");
  await expect(dialog.getByLabel("Password", { exact: true })).toHaveValue("");
  await dialog.screenshot({
    path: test.info().outputPath("add-administrator.png"),
  });
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await adminCommand(page, "Sign out");
  await page.getByLabel("Username", { exact: true }).fill("helper-admin");
  await page
    .getByLabel("Password", { exact: true })
    .fill("helper-admin-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Administration", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Exams", exact: true }),
  ).toBeVisible();
});

async function studentSignIn(
  page: import("@playwright/test").Page,
  exam = "sample",
  username = "student01",
  readyButton = "Open preflight & practice",
) {
  await page.goto("/");
  await page.getByLabel("Exam ID", { exact: true }).fill(exam);
  await page.getByLabel("Enrolled username").fill(username);
  await page.getByRole("button", { name: "Start SSH sign-in" }).click();
  await page.getByLabel("Shared SSH password").fill("shared-password");
  await page.getByRole("button", { name: "Respond to this host" }).click();
  await expect(page.getByLabel("Host authentication messages")).toContainText(
    "Enter number 42",
  );
  await expect(
    page.getByRole("button", { name: readyButton, exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Shared SSH password")).toHaveCount(0);
}

test("practice terminals accept typing, stay floating, change maximize icon, close and restore correctly", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await studentSignIn(page);
  await page.getByRole("button", { name: "Open preflight & practice" }).click();
  await page
    .getByRole("button", { name: "Practice terminal", exact: true })
    .click();
  const first = page.locator(".winbox").first();
  await expect(first).not.toHaveClass(/\bmax\b/);
  await expect(page.locator(".directory, .taskbar")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Snap left Terminal 1", exact: true })
    .click();
  expect((await first.boundingBox())!.width).toBeLessThan(700);
  const max = page.getByRole("button", {
    name: "Maximize Terminal 1",
    exact: true,
  });
  const initialIcon = await max.evaluate(
    (el) => getComputedStyle(el).backgroundImage,
  );
  await max.click();
  await expect(first).toHaveClass(/\bmax\b/);
  const restore = page.getByRole("button", {
    name: "Restore Terminal 1",
    exact: true,
  });
  expect(
    await restore.evaluate((el) => getComputedStyle(el).backgroundImage),
  ).not.toBe(initialIcon);
  await restore.click();
  await expect(first).not.toHaveClass(/\bmax\b/);
  await first.locator(".xterm-helper-textarea").focus();
  await page.keyboard.type("help");
  await page.keyboard.press("Enter");
  await expect(first.locator(".xterm-rows")).toContainText("Fixture commands:");
  await page.keyboard.type("pwxx");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await page.keyboard.type("d");
  await page.keyboard.press("Enter");
  await expect(first.locator(".xterm-rows")).toContainText("/work");
  await page
    .getByRole("button", { name: "Practice terminal", exact: true })
    .click();
  await expect(page.locator(".winbox")).toHaveCount(2);
  await page
    .getByRole("button", { name: "Minimize Terminal 2", exact: true })
    .click();
  await expect(page.locator(".winbox").last()).toHaveClass(/\bmin\b/);
  await page.getByText("Terminals", { exact: true }).click();
  await page
    .getByRole("button", { name: "Terminal 2 (minimized)", exact: true })
    .click();
  await expect(page.locator(".winbox").last()).not.toHaveClass(/\bmin\b/);
  await page
    .getByRole("button", { name: "Rename Terminal 2", exact: true })
    .click();
  await page.getByLabel("Terminal name").fill("Editor");
  await page.getByRole("button", { name: "Save name", exact: true }).click();
  await expect(
    page.locator(".wb-title").filter({ hasText: "Editor" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close Editor", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const size = await page
    .getByRole("dialog")
    .evaluate((el) => ({ width: el.clientWidth, scroll: el.scrollWidth }));
  await page.screenshot({
    path: "docs/screenshots/terminal-close-dialog.png",
    fullPage: true,
  });
  expect(size.width).toBeGreaterThan(450);
  expect(size.scroll).toBeLessThanOrEqual(size.width + 1);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".winbox")).toHaveCount(2);
  await page.getByRole("button", { name: "Close Editor", exact: true }).click();
  await page
    .getByRole("button", { name: "Close terminal", exact: true })
    .click();
  await expect(page.locator(".winbox")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Practice terminal", exact: true })
    .click();
  await expect(page.locator(".winbox")).toHaveCount(2);
  await expect(
    page.locator(".wb-title").filter({ hasText: "Terminal 3" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Rules", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.locator(".collection-notice, .workspace-message"),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Sign out", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Connect to your exam" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("preflight retries beyond 15 seconds and offers fresh sign-in when SSH is lost", async ({
  page,
}) => {
  let interrupted = false;
  let connections = 0;
  let client: import("@playwright/test").WebSocketRoute;
  let server: import("@playwright/test").WebSocketRoute;
  await page.routeWebSocket("**/api/student/session", (route) => {
    connections++;
    if (interrupted) {
      route.close();
      return;
    }
    client = route;
    server = route.connectToServer();
  });
  await studentSignIn(page, "recovery", "student03");
  await page.getByRole("button", { name: "Open preflight & practice" }).click();
  const practice = page.getByRole("button", {
    name: "Practice terminal",
    exact: true,
  });
  await expect(practice).toBeEnabled();
  await page.clock.install();
  interrupted = true;
  client!.close();
  server!.close();
  await expect(
    page.getByText("Reconnecting · input blocked", { exact: true }),
  ).toBeVisible();
  for (let i = 0; i < 18; i++) {
    await page.clock.runFor(1000);
    // Let intercepted WebSocket close events settle between timer advances.
    await page.waitForTimeout(30);
  }
  await expect(
    page.getByRole("heading", { name: "Preflight connection lost" }),
  ).toBeVisible();
  await expect(
    page.getByText("Connection unavailable · retrying", { exact: true }),
  ).toBeVisible();
  await expect(practice).toBeDisabled();
  expect(connections).toBeGreaterThan(4);
  interrupted = false;
  await page.clock.runFor(5000);
  await expect(practice).toBeEnabled();
  await expect(
    page.getByRole("heading", { name: "Preflight connection lost" }),
  ).toHaveCount(0);

  const attempt = (await (await page.request.get("/api/student/exam")).json())
    .attempt;
  expect(attempt.start).toBeNull();
  expect(attempt.deadline).toBeNull();
  await page.route("**/api/student/attempts/*/status", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      json: { ...(await response.json()), authenticationGap: true },
    });
  });
  client!.send(
    JSON.stringify({
      v: 1,
      type: "state",
      attempt,
      serverNow: Date.now(),
      authenticationGap: true,
    }),
  );
  await expect(
    page.getByRole("heading", { name: "Preflight connection lost" }),
  ).toBeVisible();
  await expect(
    page.getByText("SSH sign-in required", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Your exam has not started. No exam time has elapsed.", {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Reconnect SSH", exact: true })
    .click();
  await expect(page.getByLabel("Exam ID", { exact: true })).toHaveValue(
    "recovery",
  );
  await expect(page.getByLabel("Enrolled username")).toHaveValue("student03");
  await expect(
    page.getByRole("button", { name: "Start SSH sign-in" }),
  ).toBeVisible();
  await page.unroute("**/api/student/attempts/*/status");
  await studentSignIn(page, "recovery", "student03");
  await page.getByRole("button", { name: "Open preflight & practice" }).click();
  await expect(practice).toBeEnabled();
  const fresh = (await (await page.request.get("/api/student/exam")).json())
    .attempt;
  expect(fresh.id).not.toBe(attempt.id);
  expect(fresh.start).toBeNull();
  expect(fresh.deadline).toBeNull();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Sign out", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Start SSH sign-in" }),
  ).toBeVisible();
});

test("preflight errors stay visible inside fullscreen and keyboard lock can be retried", async ({
  page,
}) => {
  await simulatedMedia(page);
  await studentSignIn(page, "sandbox", "student08");
  await page.getByRole("button", { name: "Open preflight & practice" }).click();
  await page.getByRole("button", { name: "1. Share entire display" }).click();
  await page.getByRole("button", { name: "2. Enter fullscreen" }).click();
  await page.evaluate(() => {
    (navigator as any).keyboard.lock = async () => {
      throw new DOMException(
        "lock() request could not be registered.",
        "InvalidStateError",
      );
    };
  });
  const lock = page.getByRole("button", {
    name: "3. Lock keyboard",
    exact: true,
  });
  await lock.click();
  const error = page.getByRole("dialog", { name: "Keyboard lock failed" });
  await expect(error).toBeVisible();
  await expect(error).toContainText(
    "standalone desktop Chrome, Edge or Chromium",
  );
  await expect(error).toContainText("lock() request could not be registered.");
  await error.screenshot({
    path: test.info().outputPath("fullscreen-keyboard-error.png"),
  });
  expect(
    await error.evaluate((el) => document.fullscreenElement?.contains(el)),
  ).toBe(true);
  await expect(lock).toHaveAttribute("aria-pressed", "false");
  await expect(
    page.getByRole("button", { name: "Begin exam", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(error).toHaveCount(0);
  expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await expect(lock).toBeFocused();
  await page.evaluate(() => {
    (navigator as any).keyboard.lock = async () => {};
  });
  await lock.click();
  await expect(lock).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("button", { name: "Begin exam", exact: true }),
  ).toBeEnabled();

  // Server failures after a confirmation use the same fullscreen error path.
  await page.route("**/api/student/attempts/*/begin", (route) =>
    route.fulfill({
      status: 409,
      json: { error: "Exam cannot start right now." },
    }),
  );
  await page.getByRole("button", { name: "Begin exam", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Begin exam", exact: true })
    .click();
  const startError = page.getByRole("dialog", { name: "Workspace error" });
  await expect(startError).toBeVisible();
  await expect(startError).toContainText("Exam cannot start right now.");
  expect(
    await startError.evaluate((el) => document.fullscreenElement?.contains(el)),
  ).toBe(true);
  await startError.getByRole("button", { name: "Close", exact: true }).click();
  await expect(startError).toHaveCount(0);
  expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  expect(
    (await (await page.request.get("/api/student/exam")).json()).attempt.start,
  ).toBeNull();
});

async function simulatedMedia(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    const makeStream = (monitor: boolean) => {
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 480;
      const ctx = canvas.getContext("2d")!;
      setInterval(() => {
        ctx.fillStyle = "#e6ecf4";
        ctx.fillRect(0, 0, 640, 480);
        ctx.fillStyle = "#132033";
        ctx.fillText("Simulated monitor", 20, 40);
      }, 100);
      const media = canvas.captureStream(10);
      const track = media.getVideoTracks()[0];
      const getSettings = track.getSettings.bind(track);
      track.getSettings = () => ({
        ...getSettings(),
        ...(monitor ? { displaySurface: "monitor" } : {}),
      });
      return media;
    };
    Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", {
      value: async () => makeStream(true),
    });
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: async () => makeStream(false),
    });
    Object.defineProperty(navigator, "keyboard", {
      value: { lock: async () => {}, unlock: () => {} },
    });
  });
}

test("webcam preflight uses consecutive steps and student can sign out before starting", async ({
  page,
}) => {
  await simulatedMedia(page);
  await studentSignIn(page, "camera", "student02");
  await page.getByRole("button", { name: "Open preflight & practice" }).click();
  await expect(
    page.getByRole("button", { name: "1. Share entire display", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "2. Enable webcam", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "3. Enter fullscreen", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "4. Lock keyboard", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "1. Share entire display" }).click();
  await expect(
    page.getByRole("button", { name: "Begin exam", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "2. Enable webcam" }).click();
  await expect(page.locator("#camera-preview")).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Sign out", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Connect to your exam" }),
  ).toBeVisible();
});

test("simulated capture workspace opens retained SSH terminals and locks on fullscreen exit", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) {
      if (typeof data === "string" && JSON.parse(data).type === "resize") {
        (window as any).__lateTerminalResize = () => send.call(this, data);
      }
      return send.call(this, data);
    };
  });
  page.on("pageerror", (error) => console.error(error.message));
  await simulatedMedia(page);
  await page.goto("/");
  await page.getByLabel("Exam ID", { exact: true }).fill("sample");
  await page.getByLabel("Enrolled username").fill("student01");
  await page.getByRole("button", { name: "Start SSH sign-in" }).click();
  await page.getByLabel("Shared SSH password").fill("shared-password");
  await page.getByRole("button", { name: "Respond to this host" }).click();
  await page.getByRole("button", { name: "Open preflight & practice" }).click();
  await page.getByRole("button", { name: "1. Share entire display" }).click();
  await page.getByRole("button", { name: "2. Enter fullscreen" }).click();
  await page
    .getByRole("button", { name: "Practice terminal", exact: true })
    .click();
  await expect(page.locator(".winbox")).toHaveCount(1);
  await page
    .getByRole("button", { name: "3. Lock keyboard", exact: true })
    .click();
  await page.getByRole("button", { name: "Begin exam", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Begin exam", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "New terminal", exact: true }),
  ).toBeVisible();
  const first = page.locator(".winbox").first();
  await expect(first).not.toHaveClass(/\bmax\b/);
  await first.locator(".xterm-helper-textarea").focus();
  await page.keyboard.type("save active answer");
  await page.keyboard.press("Enter");
  await expect(first.locator(".xterm-rows")).toContainText(
    "Saved fixture text",
  );
  await page.keyboard.type("cat");
  await page.keyboard.press("Enter");
  await expect(first.locator(".xterm-rows")).toContainText("active answer");
  const menu = page.getByRole("menu", { name: "Terminal actions" });
  await first
    .locator(".terminal:not(.xterm)")
    .click({ button: "right", position: { x: 60, y: 60 } });
  await expect(
    menu.getByRole("menuitem", { name: "Paste", exact: true }),
  ).toBeDisabled();
  await expect(
    menu.getByRole("menuitem", { name: "Reset zoom" }),
  ).toBeDisabled();
  await expect(menu.locator("small")).toHaveCount(0);
  const textSize = () =>
    first
      .locator(".xterm-rows")
      .evaluate((el) => getComputedStyle(el).fontSize);
  const initialSize = await textSize();
  await menu.getByRole("menuitem", { name: "Zoom in" }).click();
  await expect.poll(textSize).not.toBe(initialSize);
  await first
    .locator(".terminal:not(.xterm)")
    .click({ button: "right", position: { x: 60, y: 60 } });
  await menu.getByRole("menuitem", { name: "Reset zoom" }).click();
  await expect.poll(textSize).toBe(initialSize);
  await first
    .locator(".terminal:not(.xterm)")
    .click({ button: "right", position: { x: 60, y: 60 } });
  await menu.getByRole("menuitem", { name: "Zoom out" }).click();
  await expect.poll(textSize).not.toBe(initialSize);
  await first
    .locator(".terminal:not(.xterm)")
    .click({ button: "right", position: { x: 60, y: 60 } });
  await menu.getByRole("menuitem", { name: "Reset zoom" }).click();
  await expect.poll(textSize).toBe(initialSize);
  await first.locator(".xterm-helper-textarea").focus();
  await page.keyboard.press("Shift+F10");
  await expect(menu).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: "Zoom out" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(first.locator(".xterm-helper-textarea")).toBeFocused();
  const answerLine = first
    .locator(".xterm-rows > div")
    .filter({ hasText: /^active answer\s*$/ })
    .last();
  const lineRect = (await answerLine.boundingBox())!;
  await page.mouse.dblclick(lineRect.x + 10, lineRect.y + lineRect.height / 2);
  await first.locator(".xterm-helper-textarea").focus();
  await page.keyboard.press("Control+Shift+V");
  await page.keyboard.press("Enter");
  await expect(first.locator(".xterm-rows")).toContainText("Echo: active");
  await page.mouse.dblclick(lineRect.x + 10, lineRect.y + lineRect.height / 2);
  await page.mouse.click(lineRect.x + 10, lineRect.y + lineRect.height / 2, {
    button: "right",
  });
  await expect(
    menu.getByRole("menuitem", { name: "Copy", exact: true }),
  ).toBeEnabled();
  await menu.getByRole("menuitem", { name: "Copy", exact: true }).click();
  const prevented = await first
    .locator(".xterm-helper-textarea")
    .evaluate((el) => {
      const data = new DataTransfer();
      data.setData("text/plain", "outside paste");
      const event = new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: data,
      });
      el.dispatchEvent(event);
      return event.defaultPrevented;
    });
  expect(prevented).toBe(true);
  await page.getByRole("button", { name: "New terminal", exact: true }).click();
  await expect(page.locator(".winbox")).toHaveCount(2);
  await page.getByRole("button", { name: "Arrange terminals" }).click();
  const second = page.locator(".winbox").last();
  await second
    .locator(".terminal:not(.xterm)")
    .click({ button: "right", position: { x: 60, y: 60 } });
  await menu.getByRole("menuitem", { name: "Paste", exact: true }).click();
  await page.keyboard.press("Enter");
  await expect(second.locator(".xterm-rows")).toContainText("Echo: active");
  await expect(second.locator(".xterm-helper-textarea")).toBeFocused();
  await second
    .locator(".terminal:not(.xterm)")
    .click({ button: "right", position: { x: 60, y: 60 } });
  await page.screenshot({
    path: "docs/screenshots/student-workspace.png",
    fullPage: true,
  });
  await page.evaluate(() => document.exitFullscreen());
  await expect(
    page.getByRole("heading", { name: "Instructor review required" }),
  ).toBeVisible();
  await expect(menu).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "New terminal", exact: true }),
  ).toBeDisabled();
  await expect
    .poll(
      async () =>
        (await (await page.request.get("/api/student/exam")).json())
          .sshConnected,
    )
    .toBe(false);
  await expect(
    page.getByRole("button", { name: "Restore screen sharing", exact: true }),
  ).toBeHidden();
  await page
    .getByRole("button", { name: "Reconnect SSH", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Instructor authorization required",
  );
  const admin = await request.newContext({
    baseURL: "http://localhost:3100",
    extraHTTPHeaders: { Origin: "http://localhost:3100" },
  });
  try {
    const login = await admin.post("/api/admin/login", {
      headers: { origin: "http://localhost:3100" },
      data: { username: "instructor", password: "fixture-password" },
    });
    expect(login.ok()).toBe(true);
    const { csrf } = await login.json();
    const attempts = await (
      await admin.get("/api/admin/attempts?q=student01&state=LOCKED")
    ).json();
    const attempt = attempts.attempts.find((a: any) => a.exam === "sample");
    const approved = await admin.post(
      `/api/admin/attempts/${attempt.id}/authorize`,
      {
        headers: { origin: "http://localhost:3100", "x-csrf-token": csrf },
        data: {
          generation: attempt.generation,
          revision: attempt.continuation_revision,
          requestID: crypto.randomUUID(),
          reason: "Reviewed synthetic monitoring interruption",
        },
      },
    );
    expect(approved.ok()).toBe(true);
    await page
      .getByRole("button", { name: "Reconnect SSH", exact: true })
      .click();
    // Wait for reauthentication to revoke the old browser session before the
    // helper navigates, otherwise navigation can cancel that in-flight request.
    await expect(
      page.getByRole("heading", { name: "Connect to your exam" }),
    ).toBeVisible();
    await studentSignIn(
      page,
      "sample",
      "student01",
      "Restore page after instructor authorization",
    );
    await page
      .getByRole("button", {
        name: "Restore page after instructor authorization",
        exact: true,
      })
      .click();
    await page
      .getByRole("button", { name: "Restore screen sharing", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Restore fullscreen", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Restore keyboard lock", exact: true })
      .click();
    await page
      .getByRole("button", {
        name: "Continue exam after authorization",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("heading", { name: "Instructor review required" }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "New terminal", exact: true })
      .click();
    await expect(page.locator(".winbox")).toHaveCount(1);
    const resumed = await (
      await page.request.get(`/api/student/attempts/${attempt.id}/status`)
    ).json();
    expect(resumed.attempt.state).toBe("ACTIVE");
    expect(resumed.attempt.deadline).toBe(attempt.deadline);
    await expect(
      page.locator(".collection-notice, .workspace-message"),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Sign out", exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Finish exam", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toContainText(
      "Finishing is irreversible",
    );
    await page.keyboard.press("Escape");
    expect(
      (
        await (
          await page.request.get(`/api/student/attempts/${attempt.id}/status`)
        ).json()
      ).attempt.state,
    ).toBe("ACTIVE");
    await page
      .getByRole("button", { name: "Finish exam", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Finish exam", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Connect to your exam", exact: true }),
    ).toBeVisible();
    await page.evaluate(() => (window as any).__lateTerminalResize());
    await page.waitForTimeout(200);
    await expect(
      page.getByRole("dialog", { name: "Terminal error" }),
    ).toHaveCount(0);
    expect((await page.request.get("/api/session")).status()).toBe(401);
    const submission = await admin.get(
      `/api/admin/attempts/${attempt.id}/submission`,
    );
    expect(submission.status()).toBe(404);
    expect(
      (
        await page.request.get(`/api/admin/attempts/${attempt.id}/submission`)
      ).status(),
    ).toBe(404);
  } finally {
    await admin.dispose();
  }
});

test("one Finish exam action confirms, secures work and signs out; cancellation keeps the exam active", async ({
  page,
}) => {
  await simulatedMedia(page);
  await studentSignIn(page, "logout", "student03");
  await page.getByRole("button", { name: "Open preflight & practice" }).click();
  await page.getByRole("button", { name: "1. Share entire display" }).click();
  await page.getByRole("button", { name: "2. Enter fullscreen" }).click();
  await page.getByRole("button", { name: "3. Lock keyboard" }).click();
  await page.getByRole("button", { name: "Begin exam", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Begin exam", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "New terminal", exact: true }),
  ).toBeVisible();
  const attempt = (await (await page.request.get("/api/student/exam")).json())
    .attempt;
  await expect(
    page.getByRole("button", { name: "Sign out", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Finish exam", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "Finishing is irreversible and signs you out",
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "New terminal", exact: true }),
  ).toBeEnabled();
  expect(
    (
      await (
        await page.request.get(`/api/student/attempts/${attempt.id}/status`)
      ).json()
    ).attempt.state,
  ).toBe("ACTIVE");
  await page.getByRole("button", { name: "Finish exam", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Finish exam", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Connect to your exam" }),
  ).toBeVisible();
  await expect(page.locator(".winbox")).toHaveCount(0);
  expect((await page.request.get("/api/session")).status()).toBe(401);
  const admin = await request.newContext({ baseURL: "http://localhost:3100" });
  try {
    const login = await admin.post("/api/admin/login", {
      headers: { origin: "http://localhost:3100" },
      data: { username: "instructor", password: "fixture-password" },
    });
    expect(login.ok()).toBe(true);
    await expect
      .poll(async () =>
        (
          await admin.get(`/api/admin/attempts/${attempt.id}/submission`)
        ).status(),
      )
      .toBe(404);
    const list = await (await admin.get("/api/admin/attempts")).json();
    const completed = list.attempts.find((a: any) => a.id === attempt.id);
    expect(completed.state).toBe("COMPLETED");
    expect(completed.protected).toBe(1);
  } finally {
    await admin.dispose();
  }
});

test("completed and locked exam sign-in failures describe the attempt instead of SSH configuration", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Exam ID", { exact: true }).fill("sample");
  await page.getByLabel("Enrolled username").fill("student01");
  await page.getByRole("button", { name: "Start SSH sign-in" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Your exam is already completed",
  );
  await expect(page.getByLabel("Shared SSH password")).toHaveCount(0);
  await page.getByRole("button", { name: "Dismiss", exact: true }).click();
  await page.getByLabel("Exam ID", { exact: true }).fill("locked");
  await page.getByLabel("Enrolled username").fill("student05");
  await page.getByRole("button", { name: "Start SSH sign-in" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Ask your instructor to authorize continuation",
  );
  await expect(page.getByRole("alert")).not.toContainText("host pins");
});

test("expired incomplete preflight explains cancellation, permits fresh retry, and keeps a connected incomplete retry alive", async ({
  page,
}) => {
  test.setTimeout(45000);
  await page.addInitScript(() => {
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) {
      if (
        (window as any).dropPreflightContact &&
        typeof data === "string" &&
        JSON.parse(data).type === "preflight-contact"
      )
        return;
      return send.call(this, data);
    };
    (window as any).dropPreflightContact = true;
  });
  await studentSignIn(page, "expiry", "student02");
  await page.getByRole("button", { name: "Open preflight & practice" }).click();
  await expect(
    page.getByRole("heading", { name: "Preflight ended before starting" }),
  ).toBeVisible({ timeout: 18000 });
  const oldAttempt = (
    await (await page.request.get("/api/student/exam")).json()
  ).attempt;
  expect(oldAttempt.start).toBeNull();
  expect(oldAttempt.deadline).toBeNull();
  const receipt = page.locator(".lock-overlay");
  await expect(receipt).toContainText("no exam time was consumed");
  await expect(receipt).not.toContainText("Collection requires recovery");
  await expect(receipt).not.toContainText("Checksum");
  await page.screenshot({
    path: "docs/screenshots/preflight-expired.png",
    fullPage: true,
  });
  await page.reload();
  await expect(
    page.getByText("Your SSH connection has ended.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open preflight & practice" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Sign out and sign in again" })
    .click();

  await studentSignIn(page, "expiry", "student02");
  await page.evaluate(() => {
    (window as any).dropPreflightContact = false;
  });
  await expect(
    page.getByText("You can retry without consuming exam time.", {
      exact: false,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open preflight & practice" }).click();
  await expect(
    page.getByRole("button", { name: "1. Share entire display" }),
  ).toBeVisible();
  const newAttempt = (
    await (await page.request.get("/api/student/exam")).json()
  ).attempt;
  expect(newAttempt.id).not.toBe(oldAttempt.id);
  expect(newAttempt.start).toBeNull();
  expect(newAttempt.deadline).toBeNull();
  await page.waitForTimeout(12000);
  await expect(
    page.getByRole("button", { name: "1. Share entire display" }),
  ).toBeVisible();
  await expect(page.locator(".lock-overlay")).toHaveCount(0);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Sign out", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Start SSH sign-in" }),
  ).toBeVisible();
  await studentSignIn(page, "expiry", "student02");
  await page.getByRole("button", { name: "Open preflight & practice" }).click();
  await expect(
    page.getByRole("button", { name: "1. Share entire display" }),
  ).toBeVisible();
});

test("login-only interface identifies real hosts and displays authentication success without exam controls", async ({
  page,
}) => {
  const hosts = {
    loginOnly: true,
    jump: "sshjump.depaul.edu",
    class: "csc-sys.cdm.depaul.edu",
  };
  await page.route("**/api/login-test", (route) =>
    route.fulfill({ json: hosts }),
  );
  await page.route("**/api/session", (route) =>
    route.fulfill({ status: 401, json: { error: "Sign in" } }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Test your SSH login" }),
  ).toBeVisible();
  await expect(page.getByLabel("SSH username")).toBeVisible();
  await expect(page.getByLabel("Exam ID", { exact: true })).toHaveCount(0);
  await expect(
    page.getByText("Login test only; no exam or recording starts.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.route("**/api/session", (route) =>
    route.fulfill({
      json: {
        role: "student",
        username: "realuser",
        exam: "sample",
        csrf: "test",
      },
    }),
  );
  await page.route("**/api/student/exam", (route) =>
    route.fulfill({ json: hosts }),
  );
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Both SSH hosts authenticated" }),
  ).toBeVisible();
  await expect(
    page.getByText("The SSH connections have been closed.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open preflight & practice" }),
  ).toHaveCount(0);
  await expect(page.locator("footer")).toHaveCount(0);
  await page.screenshot({
    path: "docs/screenshots/login-test-success.png",
    fullPage: true,
  });
});

test("MFA messages survive blank rounds, preserve pending prompts and clear sent answers", async ({
  page,
}) => {
  let server: import("@playwright/test").WebSocketRoute;
  const sent: any[] = [];
  await page.routeWebSocket("**/api/auth/dialogue", (route) => {
    server = route;
    route.onMessage((raw) => {
      const m = JSON.parse(String(raw));
      sent.push(m);
      if (m.type === "start")
        route.send(
          JSON.stringify({
            v: 1,
            type: "challenge",
            host: "jump",
            instruction:
              "------------------------------------------------------------------------\nThis is a DePaul University resource. This computer\nsystem, and all\nrelated equipment, networks, and network devices\nare provided for\nauthorized use only.\n------------------------------------------------------------------------\n\nEnter your shared SSH password",
            round: "shared-password-round",
            prompts: [{ prompt: "Shared SSH password", echo: false }],
          }),
        );
    });
  });
  await page.goto("/");
  await page.getByLabel("Exam ID", { exact: true }).fill("sample");
  await page.getByLabel("Enrolled username").fill("student01");
  await page.getByRole("button", { name: "Start SSH sign-in" }).click();
  const banner = page.getByLabel("Host authentication messages");
  const prose = banner.locator("p").first();
  await expect(prose).toHaveText(
    "This is a DePaul University resource. This computer system, and all related equipment, networks, and network devices are provided for authorized use only.",
  );
  await expect(prose).toHaveCSS("white-space", "normal");
  await expect(banner.locator("hr")).toHaveCount(2);
  await page.setViewportSize({ width: 420, height: 900 });
  expect(await banner.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: "docs/screenshots/ssh-authentication-banner-narrow.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 780, height: 1000 });
  await page.screenshot({
    path: "docs/screenshots/ssh-authentication-banner.png",
    fullPage: true,
  });
  await page.getByLabel("Shared SSH password").fill("shared-password");
  await page.getByRole("button", { name: "Respond to this host" }).click();
  await expect(page.getByLabel("Shared SSH password")).toHaveValue("");
  await expect(page.getByLabel("Shared SSH password")).toBeDisabled();
  await expect
    .poll(() => sent.filter((m) => m.type === "answers").length)
    .toBe(1);
  expect(sent.find((m) => m.type === "answers").answers).toEqual([
    "shared-password",
  ]);
  await expect(page.locator("body")).not.toContainText("shared-password");
  expect(page.url()).not.toContain("shared-password");
  server!.send(
    JSON.stringify({
      v: 1,
      type: "challenge",
      host: "jump",
      instruction: "Enter number 42 in your authentication app.",
      round: "number",
      prompts: [],
    }),
  );
  server!.send(
    JSON.stringify({
      v: 1,
      type: "challenge",
      host: "jump",
      instruction: "",
      round: "blank",
      prompts: [],
    }),
  );
  const messages = page.getByLabel("Host authentication messages");
  await expect(messages).toContainText("Enter number 42");
  await page.waitForTimeout(700);
  server!.send(
    JSON.stringify({
      v: 1,
      type: "challenge",
      host: "jump",
      instruction: "Waiting for approval",
      round: "poll",
      prompts: [],
    }),
  );
  await expect(messages).toContainText("Enter number 42");
  await expect(messages).toContainText("Waiting for approval");
  await messages.evaluate((el) => el.closest("form")!.requestSubmit());
  expect(sent.filter((m) => m.type === "answers")).toHaveLength(1);
  server!.send(
    JSON.stringify({
      v: 1,
      type: "challenge",
      host: "class",
      instruction: "Enter verification code",
      round: "verification-code-round",
      prompts: [{ prompt: "Verification code", echo: false }],
    }),
  );
  await page.getByLabel("Verification code").fill("123456");
  server!.send(
    JSON.stringify({
      v: 1,
      type: "notice",
      host: "class",
      instruction: "Additional class-host notice",
      round: "notice",
      prompts: [],
    }),
  );
  await expect(messages).toContainText("Additional class-host notice");
  await expect(messages).not.toContainText("42");
  await expect(messages).not.toContainText("123456");
  await expect(page.getByLabel("Verification code")).toHaveValue("123456");
  await page.getByRole("button", { name: "Respond to this host" }).click();
  await expect(page.getByLabel("Verification code")).toHaveValue("");
  await expect
    .poll(() => sent.filter((m) => m.type === "answers").at(-1)?.round)
    .toBe("verification-code-round");
  await expect(
    page.getByRole("button", { name: "Waiting for host…" }),
  ).toBeDisabled();
  await page.screenshot({
    path: "docs/screenshots/ssh-authentication-messages.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByLabel("Host authentication messages")).toHaveCount(0);
  await page.getByRole("button", { name: "Start SSH sign-in" }).click();
  await expect(page.getByLabel("Shared SSH password")).toBeVisible();
  await expect(
    page.getByLabel("Host authentication messages"),
  ).not.toContainText("Additional class-host notice");
});

test("instructor sees a working student and live clock, resets time without disconnecting terminals", async ({
  page,
  browser,
}) => {
  test.setTimeout(60000);
  const instructorBrowser = await browser.browserType().launch({
    headless: true,
    executablePath: process.env.CHROMIUM || "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  const context = await instructorBrowser.newContext({
    baseURL: "http://localhost:3100",
  });
  const instructor = await context.newPage();
  try {
    await instructor.goto("/admin");
    await instructor.getByLabel("Username", { exact: true }).fill("instructor");
    await instructor
      .getByLabel("Password", { exact: true })
      .fill("fixture-password");
    await instructor
      .getByRole("button", { name: "Sign in", exact: true })
      .click();
    await instructor
      .getByLabel("Selected exam", { exact: true })
      .selectOption("sandbox");
    await simulatedMedia(page);
    await studentSignIn(page, "sandbox", "student06");
    await page
      .getByRole("button", { name: "Open preflight & practice" })
      .click();
    await page.getByRole("button", { name: "1. Share entire display" }).click();
    await page.getByRole("button", { name: "2. Enter fullscreen" }).click();
    await page
      .getByRole("button", { name: "3. Lock keyboard", exact: true })
      .click();
    await page.getByRole("button", { name: "Begin exam", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Begin exam", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "New terminal", exact: true }),
    ).toBeVisible();
    const original = (
      await (await page.request.get("/api/student/exam")).json()
    ).attempt;
    const roster = instructor.getByRole("table", {
      name: "Students and attempts",
    });
    const row = roster.getByRole("rowgroup", {
      name: "student06",
      exact: true,
    });
    await expect(row).toContainText("Working", { timeout: 10000 });
    await expect(row).toContainText(/4:\d{2}|5:00/);
    await rowCommand(
      instructor,
      "Actions for student06 attempt 1",
      "Reset clock",
    );
    await expect(instructor.getByRole("dialog")).toContainText("→ 5 minutes");
    await instructor.keyboard.press("Escape");
    await expect(instructor.getByRole("dialog")).toHaveCount(0);
    await rowCommand(
      instructor,
      "Actions for student06 attempt 1",
      "Reset clock",
    );
    await instructor
      .getByRole("button", { name: "Apply reset", exact: true })
      .click();
    await expect(instructor.getByRole("dialog")).toHaveCount(0);
    await expect
      .poll(
        async () =>
          (await (await page.request.get("/api/student/exam")).json()).attempt
            .clock_revision,
      )
      .toBe(1);
    const updated = (await (await page.request.get("/api/student/exam")).json())
      .attempt;
    expect(updated.id).toBe(original.id);
    expect(updated.start).toBe(original.start);
    expect(updated.original_deadline).toBe(original.deadline);
    expect(updated.generation).toBe(original.generation);
    expect(updated.state).toBe("ACTIVE");
    expect(updated.deadline - Date.now()).toBeGreaterThan(290000);
    expect(updated.deadline - Date.now()).toBeLessThanOrEqual(300000);
    await instructor
      .getByLabel("Bulk action", { exact: true })
      .selectOption("extend");
    await row
      .getByRole("checkbox", {
        name: `Select attempt ${updated.id}`,
        exact: true,
      })
      .check();

    await instructor
      .getByRole("button", { name: "Apply to 1 attempt", exact: true })
      .click();
    await instructor.getByLabel("Minutes to add", { exact: true }).fill("3");
    await instructor
      .getByRole("button", { name: "Apply extension", exact: true })
      .click();
    await expect(instructor.getByRole("dialog")).toHaveCount(0);
    await expect
      .poll(
        async () =>
          (await (await page.request.get("/api/student/exam")).json()).attempt
            .clock_revision,
      )
      .toBe(2);
    const extended = (
      await (await page.request.get("/api/student/exam")).json()
    ).attempt;
    expect(extended.deadline).toBe(updated.deadline + 180000);
    expect(extended.original_deadline).toBe(original.deadline);
    await expect(row).toContainText(/7:\d{2}|8:00/);
    const clockText = await row
      .locator("tr.attempt-row .attempt-clock")
      .innerText();
    await expect
      .poll(() => row.locator("tr.attempt-row .attempt-clock").innerText())
      .not.toBe(clockText);
    const terminal = page.locator(".winbox").first();
    await terminal.locator(".xterm-helper-textarea").focus();
    await page.keyboard.type("echo still-connected");
    await page.keyboard.press("Enter");
    await expect(terminal.locator(".xterm-rows")).toContainText(
      "still-connected",
    );
    await expect(
      page.getByRole("heading", { name: "Exam paused" }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Finish exam", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Finish exam", exact: true })
      .click();
    await expect(row).toContainText("Submission secured", { timeout: 10000 });
    const attempts = instructor.getByRole("table", {
      name: "Students and attempts",
    });
    await expect(
      attempts.getByRole("row").filter({ hasText: "student06" }),
    ).not.toContainText("Working");
  } finally {
    await instructorBrowser.close();
  }
});

async function startFocusGraceExam(
  page: import("@playwright/test").Page,
  username: string,
) {
  await simulatedMedia(page);
  await page.addInitScript(() => {
    (window as any).__examFocus = true;
    Object.defineProperty(document, "hasFocus", {
      value: () => (window as any).__examFocus,
      configurable: true,
    });
    // The server must enforce the timeout even if the client's incident is lost.
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) {
      if (typeof data === "string") {
        const m = JSON.parse(data);
        if (
          m.type === "incident" &&
          m.reason === "Browser focus did not return within 20 seconds"
        )
          return;
      }
      return send.call(this, data);
    };
  });
  await studentSignIn(page, "sandbox", username);
  await page.getByRole("button", { name: "Open preflight & practice" }).click();
  await page.getByRole("button", { name: "1. Share entire display" }).click();
  await page.getByRole("button", { name: "2. Enter fullscreen" }).click();
  await page
    .getByRole("button", { name: "3. Lock keyboard", exact: true })
    .click();
  await page.getByRole("button", { name: "Begin exam", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Begin exam", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "New terminal", exact: true }),
  ).toBeVisible();
}
async function setExamFocus(
  page: import("@playwright/test").Page,
  focused: boolean,
) {
  await page.evaluate((value) => {
    (window as any).__examFocus = value;
    window.dispatchEvent(new Event(value ? "focus" : "blur"));
  }, focused);
}
test("focus grace counts down, survives 15 seconds, clears on return, and expires once after 20 seconds", async ({
  page,
}) => {
  test.setTimeout(65000);
  await startFocusGraceExam(page, "student08");
  const initial = (await (await page.request.get("/api/student/exam")).json())
    .attempt;
  const warning = page
    .getByRole("alert")
    .filter({ hasText: "Return to the exam" });
  await setExamFocus(page, false);
  await expect(warning).toContainText("20s before lock");
  await page.waitForTimeout(2200);
  await expect(warning).toContainText(/1[67]s before lock/);
  await page.screenshot({ path: "/tmp/ssh-exam-focus-warning.png" });
  await setExamFocus(page, true);
  await expect(warning).toHaveCount(0);
  await expect
    .poll(
      async () =>
        (await (await page.request.get("/api/student/exam")).json()).attempt
          .focus_lost_at,
    )
    .toBeNull();
  const returned = await (await page.request.get("/api/student/exam")).json();
  expect(returned.attempt.state).toBe("ACTIVE");
  expect(returned.attempt.deadline).toBe(initial.deadline);
  expect(returned.sshConnected).toBe(true);
  const terminal = page.locator(".winbox").first();
  await terminal.locator(".xterm-helper-textarea").focus();
  await page.keyboard.type("echo focus-returned");
  await page.keyboard.press("Enter");
  await expect(terminal.locator(".xterm-rows")).toContainText("focus-returned");
  await setExamFocus(page, false);
  await expect
    .poll(
      async () =>
        (await (await page.request.get("/api/student/exam")).json()).attempt
          .focus_lost_at,
    )
    .not.toBeNull();
  const lost = (await (await page.request.get("/api/student/exam")).json())
    .attempt.focus_lost_at;
  await page.waitForTimeout(10000);
  await setExamFocus(page, false);
  await page.waitForTimeout(6200);
  const stillActive = await (
    await page.request.get("/api/student/exam")
  ).json();
  expect(stillActive.attempt.state).toBe("ACTIVE");
  expect(stillActive.sshConnected).toBe(true);
  expect(stillActive.attempt.focus_lost_at).toBe(lost);
  await expect(warning).toContainText(/[34]s before lock/);
  await expect
    .poll(
      async () =>
        (await (await page.request.get("/api/student/exam")).json()).attempt
          .state,
      { timeout: 7000 },
    )
    .toBe("LOCKED");
  await expect(
    page.getByRole("heading", { name: "Exam paused" }),
  ).toBeVisible();
  const locked = await (await page.request.get("/api/student/exam")).json();
  expect(locked.attempt.reason).toBe(
    "Browser focus did not return within 20 seconds",
  );
  expect(locked.attempt.deadline).toBe(initial.deadline);
  await expect
    .poll(
      async () =>
        (await (await page.request.get("/api/student/exam")).json())
          .sshConnected,
    )
    .toBe(false);
  await expect(warning).toHaveCount(0);
});
for (const [violation, username] of [
  ["fullscreen", "student07"],
  ["visibility", "student09"],
]) {
  test(`focus grace does not delay ${violation} lock`, async ({ page }) => {
    await startFocusGraceExam(page, username);
    await setExamFocus(page, false);
    await expect(page.getByRole("alert")).toContainText("Return to the exam");
    if (violation === "fullscreen")
      await page.evaluate(() => document.exitFullscreen());
    else
      await page.evaluate(() => {
        Object.defineProperty(document, "hidden", {
          get: () => true,
          configurable: true,
        });
        document.dispatchEvent(new Event("visibilitychange"));
      });
    await expect(
      page.getByRole("heading", { name: "Exam paused" }),
    ).toBeVisible({ timeout: 3000 });
    await expect(
      page.getByRole("alert").filter({ hasText: "Return to the exam" }),
    ).toHaveCount(0);
  });
}

test("active page reload requires one instructor grant and fresh SSH before restoring input, without a wrong screen flash", async ({
  page,
}) => {
  const { observeScreens, resetScreens, onlyScreens } = await import(
    "./transition-fixture.js"
  );
  await observeScreens(page);
  await simulatedMedia(page);
  await studentSignIn(page, "reload", "student11");
  await page.getByRole("button", { name: "Open preflight & practice" }).click();
  await page.getByRole("button", { name: "1. Share entire display" }).click();
  await page.getByRole("button", { name: "2. Enter fullscreen" }).click();
  await page
    .getByRole("button", { name: "3. Lock keyboard", exact: true })
    .click();
  await page.getByRole("button", { name: "Begin exam", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Begin exam", exact: true })
    .click();
  await expect(page.locator(".winbox")).toHaveCount(1);
  const original = (await (await page.request.get("/api/student/exam")).json())
    .attempt;
  // Incidents use the monitoring WebSocket. Suppress that actual message so
  // recovery is tested independently of cooperative pagehide/visibility events.
  await page.evaluate(() => {
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) {
      if (typeof data === "string" && JSON.parse(data).type === "incident")
        return;
      return send.call(this, data);
    };
  });
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Reconnect SSH", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".workspace, form")).toHaveCount(0);
  await onlyScreens(page, ["empty", "loading", "summary"]);
  const restored = await (await page.request.get("/api/student/exam")).json();
  expect(restored.attempt).toMatchObject({
    id: original.id,
    state: "LOCKED",
    deadline: original.deadline,
    original_deadline: original.original_deadline,
    page_hash: null,
  });
  expect(restored.sshConnected).toBe(false);
  await page
    .getByRole("button", { name: "Reconnect SSH", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Instructor authorization required",
  );
  await expect(page.locator(".workspace, form")).toHaveCount(0);
  const admin = await request.newContext({
    baseURL: "http://localhost:3100",
    extraHTTPHeaders: { Origin: "http://localhost:3100" },
  });
  try {
    const login = await admin.post("/api/admin/login", {
      data: { username: "instructor", password: "fixture-password" },
    });
    expect(login.ok()).toBe(true);
    const { csrf } = await login.json();
    const selectedInterruption = await (
      await admin.get(`/api/admin/attempts/${original.id}/interruption`)
    ).json();
    expect(
      (
        await admin.post(`/api/admin/attempts/${original.id}/authorize`, {
          headers: { "X-CSRF-Token": csrf },
          data: {
            generation: selectedInterruption.generation,
            revision: selectedInterruption.revision,
            requestID: crypto.randomUUID(),
            reason: "Reviewed synthetic page reload",
          },
        })
      ).ok(),
    ).toBe(true);
    // Reloading an already locked attempt must preserve this one authorization.
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Reconnect SSH", exact: true }),
    ).toBeVisible();
    await onlyScreens(page, ["empty", "loading", "summary"]);
    await page
      .getByRole("button", { name: "Reconnect SSH", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Start SSH sign-in" }),
    ).toBeVisible();
    await resetScreens(page);
    await page.getByRole("button", { name: "Start SSH sign-in" }).click();
    await page.getByLabel("Shared SSH password").fill("shared-password");
    await page.getByRole("button", { name: "Respond to this host" }).click();
    await expect(page.getByLabel("Host authentication messages")).toContainText(
      "Enter number 42",
    );
    await expect(
      page.getByRole("button", {
        name: "Restore page after instructor authorization",
        exact: true,
      }),
    ).toBeVisible();
    await onlyScreens(page, ["SSH authentication", "summary"]);
    await resetScreens(page);
    await page
      .getByRole("button", {
        name: "Restore page after instructor authorization",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("heading", { name: "Instructor review required" }),
    ).toBeVisible();
    await onlyScreens(page, [
      "summary",
      "Instructor review required",
      "Continuation approved",
    ]);
    await page
      .getByRole("button", { name: "Restore screen sharing", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Restore fullscreen", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Restore keyboard lock", exact: true })
      .click();
    await page
      .getByRole("button", {
        name: "Continue exam after authorization",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("heading", { name: "Instructor review required" }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "New terminal", exact: true })
      .click();
    await expect(page.locator(".winbox")).toHaveCount(1);
    await page.locator(".xterm-helper-textarea").focus();
    await page.keyboard.type("reloaded answer");
    await page.keyboard.press("Enter");
    await expect(page.locator(".xterm-rows")).toContainText(
      "Echo: reloaded answer",
    );
    const active = (await (await page.request.get("/api/student/exam")).json())
      .attempt;
    expect(active).toMatchObject({
      id: original.id,
      state: "ACTIVE",
      deadline: original.deadline,
    });
  } finally {
    await admin.dispose();
  }
});

test("browser SSH control recovery keeps input blocked until both channels are rebound", async ({
  page,
}) => {
  test.skip(
    process.env.EXAM_BROWSER_SSH !== "1",
    "Browser SSH control channel only",
  );
  const { gate, observeScreens, resetScreens, onlyScreens } = await import(
    "./transition-fixture.js"
  );
  await observeScreens(page);
  await simulatedMedia(page);
  let control: import("@playwright/test").WebSocketRoute | undefined;
  const ack = gate();
  let waiting = false;
  await page.routeWebSocket("**/api/auth/dialogue", (socket) => {
    control = socket;
    socket.connectToServer();
  });
  await page.routeWebSocket("**/api/browser/ssh", (socket) => {
    const server = socket.connectToServer();
    server.onMessage(async (message) => {
      if (JSON.parse(String(message)).type === "browser-bound") {
        waiting = true;
        await ack.promise;
      }
      socket.send(message);
    });
  });
  await studentSignIn(page, "sandbox", "student12");
  await page.getByRole("button", { name: "Open preflight & practice" }).click();
  await page.getByRole("button", { name: "1. Share entire display" }).click();
  await page.getByRole("button", { name: "2. Enter fullscreen" }).click();
  await page
    .getByRole("button", { name: "3. Lock keyboard", exact: true })
    .click();
  await page.getByRole("button", { name: "Begin exam", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Begin exam", exact: true })
    .click();
  await expect(page.locator(".winbox")).toHaveCount(1);
  await page.locator(".xterm-helper-textarea").focus();
  await page.keyboard.type("before");
  await page.keyboard.press("Enter");
  await expect(page.locator(".xterm-rows")).toContainText("Echo: before");
  await resetScreens(page);
  try {
    control!.close({ code: 1012 });
    await expect(
      page.getByText("Reconnecting · input blocked", { exact: true }),
    ).toBeVisible();
    await expect.poll(() => waiting).toBe(true);
    await page.locator(".xterm-helper-textarea").evaluate((el) => {
      (el as HTMLTextAreaElement).value = "discarded\r";
      el.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          data: "discarded\r",
          inputType: "insertText",
        }),
      );
    });
    await expect(
      page.getByText("Reconnecting · input blocked", { exact: true }),
    ).toBeVisible();
    await onlyScreens(page, ["active", "Reconnecting"]);
    ack.release();
    await expect(
      page.getByText("Reconnecting · input blocked", { exact: true }),
    ).toHaveCount(0);
    await page.locator(".xterm-helper-textarea").focus();
    await page.keyboard.type("after");
    await page.keyboard.press("Enter");
    await expect(page.locator(".xterm-rows")).toContainText("Echo: after");
    await expect(page.locator(".xterm-rows")).not.toContainText("discarded");
    await onlyScreens(page, ["active", "Reconnecting"]);
    expect(
      (await (await page.request.get("/api/student/exam")).json()).attempt
        .state,
    ).toBe("ACTIVE");
  } finally {
    ack.release();
  }
});
