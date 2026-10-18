import { test, expect, type Page } from "@playwright/test";
import { matchesDashboardView } from "../../packages/protocol/admin.js";
function makeAttempt(
  n: number,
  username: string,
  state: string,
  extra: any = {},
) {
  const start = Date.now() - 60000;
  return {
    id: `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`,
    exam: "alpha",
    username,
    state,
    settings: JSON.stringify({ webcam: false }),
    start,
    deadline: Date.now() + 300000,
    original_deadline: Date.now() + 300000,
    clock_revision: 0,
    generation: 1,
    attempt_number: 1,
    protected: 0,
    ended: ["COMPLETED", "COLLECTION_FAILED"].includes(state)
      ? Date.now() - 1000
      : null,
    ...extra,
  };
}
async function fixture(page: Page, large = false) {
  const amy = makeAttempt(1, "amy", "ACTIVE", {
      working: true,
      attempt_number: 2,
    }),
    bob = makeAttempt(3, "bob", "LOCKED", { reason: "Fullscreen exited" });
  const rows: any[] = [
    {
      username: "amy",
      enrollment: { duration: null, webcam: null },
      attempts: [
        amy,
        makeAttempt(2, "amy", "COMPLETED", { protected: 1, attempt_number: 1 }),
      ],
    },
    {
      username: "bob",
      enrollment: { duration: 8100, webcam: true },
      attempts: [bob],
    },
    {
      username: "carol",
      enrollment: { duration: null, webcam: null },
      attempts: [makeAttempt(4, "carol", "COMPLETED")],
    },
    {
      username: "dave",
      enrollment: { duration: null, webcam: null },
      attempts: [
        makeAttempt(5, "dave", "COLLECTION_FAILED", {
          reason: "Protected copy could not be secured",
        }),
      ],
    },
    {
      username: "eve",
      enrollment: { duration: null, webcam: null },
      attempts: [],
    },
  ];
  if (large)
    for (let i = 0; i < 20; i++) {
      const username =
        i === 0 ? "student_with_long_username_0001" : `student${i}`;
      rows.push({
        username,
        enrollment: { duration: null, webcam: null },
        attempts: [
          makeAttempt(100 + i, username, "COMPLETED", { protected: 1 }),
        ],
      });
    }
  const state = {
    rows,
    calls: [] as { path: string; body: any }[],
    dashboards: 0,
    failDashboard: false,
    failReview: false,
    failedClock: "",
    slow: 0,
    reviewDelay: null as Promise<void> | null,
  };
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname;
    const json = async (body: any, status = 200) =>
      route.fulfill({ status, json: body });
    if (path === "/api/session")
      return json({ role: "admin", username: "instructor", csrf: "fixture" });
    if (path === "/api/login-test") return json({ loginOnly: false });
    if (path === "/api/admin/exams")
      return json(
        ["alpha", "beta"].map((id) => ({
          id,
          name: id === "alpha" ? "Programming final" : "Second exam",
          duration: 5400,
          webcam: false,
          terminals: 4,
          template: "sample-exam",
        })),
      );
    if (path.endsWith("/dashboard")) {
      state.dashboards++;
      if (state.slow) await new Promise((r) => setTimeout(r, state.slow));
      if (state.failDashboard)
        return json({ error: "Dashboard unavailable" }, 503);
      const source = path.includes("/beta/") ? [] : state.rows;
      const filtered = source
        .map((s) => ({
          ...s,
          attempts: s.attempts.filter((a: any) =>
            matchesDashboardView(
              a,
              (url.searchParams.get("view") || "") as any,
            ),
          ),
        }))
        .filter(
          (s) =>
            (!url.searchParams.get("view") || s.attempts.length) &&
            s.username.includes(url.searchParams.get("q") || ""),
        );
      return json({
        serverNow: Date.now(),
        students: filtered,
        total: filtered.length,
        reviewAttempt:
          source
            .flatMap((s) => s.attempts)
            .find((a: any) => a.id === url.searchParams.get("review")) || null,
        counts: {
          students: source.length,
          working: source.flatMap((s) => s.attempts).filter((a) => a.working)
            .length,
          attention: source
            .flatMap((s) => s.attempts)
            .filter((a) => ["LOCKED", "COLLECTION_FAILED"].includes(a.state))
            .length,
          active: source
            .flatMap((s) => s.attempts)
            .filter((a) => a.state === "ACTIVE").length,
          locked: source
            .flatMap((s) => s.attempts)
            .filter((a) => a.state === "LOCKED").length,
          collected: source
            .flatMap((s) => s.attempts)
            .filter((a) => a.protected).length,
        },
        incidents: [],
      });
    }
    if (path.endsWith("/recordings")) {
      if (state.reviewDelay) await state.reviewDelay;
      if (state.failReview)
        return json({ error: "Monitoring unavailable" }, 503);
      return json({
        frames: [],
        terminals: [],
        manifest: { checksum: "fixture-checksum" },
        incidents: [
          {
            id: "incident",
            opened: Date.now() - 20000,
            events: JSON.stringify([{ reason: "Fullscreen exited" }]),
            message: "Ready to reconnect",
            review_at: null,
          },
        ],
      });
    }
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      state.calls.push({ path, body });
      if (path.endsWith("/attempts/clocks")) {
        for (const t of body.targets) {
          const a = state.rows
            .flatMap((s) => s.attempts)
            .find((a) => a.id === t.id);
          if (a.id !== state.failedClock)
            a.pendingClockReset = { requestID: t.requestID };
        }
        return json({
          results: body.targets.map((t: any) => ({
            id: t.id,
            status: t.id === state.failedClock ? "failed" : "pending",
            ...(t.id === state.failedClock
              ? { error: "Clock request could not be delivered" }
              : {}),
          })),
        });
      }
      return json({ ok: true });
    }
    return json({ error: "Unexpected fixture request" }, 404);
  });
  await page.goto("/admin");
  await page.getByLabel("Selected exam", { exact: true }).selectOption("alpha");
  await expect(
    page.getByRole("table", { name: "Students and attempts" }),
  ).toBeVisible();
  return state;
}
for (const width of [1280, 430])
  test(`compact roster preserves all attempts and fits a ${width}px window`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await fixture(page, true);
    await expect(page.locator(".attempt-row")).toHaveCount(25);
    await expect(page.locator(".student-row")).toHaveCount(25);
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Administration", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".metrics")).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({ path: info.outputPath(`admin-${width}.png`) });
    await page
      .getByLabel("Bulk action", { exact: true })
      .selectOption("extend");
    await expect(
      page.getByRole("checkbox", {
        name: "Select all attempts on this page",
        exact: true,
      }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page
      .getByRole("rowgroup", { name: "amy", exact: true })
      .getByRole("button", { name: "Review", exact: true })
      .first()
      .click();
    const review = page.getByRole("dialog", {
      name: "amy · Attempt 2",
      exact: true,
    });
    await expect(
      review.getByRole("button", { name: "Close review", exact: true }),
    ).toBeFocused();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.keyboard.press("Escape");
  });
test("bulk action comes first, switches clear selection, and clock requests name only eligible attempts", async ({
  page,
}) => {
  const s = await fixture(page);
  await page
    .getByLabel("Bulk action", { exact: true })
    .selectOption("duration");
  await page
    .getByRole("checkbox", { name: "Select student amy", exact: true })
    .check();
  await expect(
    page.getByRole("region", { name: "Bulk selection" }),
  ).toContainText("1 student selected");
  await page.getByLabel("Bulk action", { exact: true }).selectOption("extend");
  await expect(
    page.getByRole("region", { name: "Bulk selection" }),
  ).toContainText("0 attempts selected");
  await expect(
    page.getByRole("checkbox", { name: "Select student amy", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("checkbox", {
      name: "Select all attempts on this page",
      exact: true,
    })
    .check();
  await page
    .getByRole("button", { name: "Apply to 2 attempts", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Extend time", exact: true });
  await expect(dialog).toContainText("amy");
  await expect(dialog).toContainText("bob");
  await expect(dialog).not.toContainText("carol");
  await dialog.getByLabel("Minutes to add", { exact: true }).fill("10");
  await dialog
    .getByRole("button", { name: "Apply extension", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(s.calls).toHaveLength(1);
  expect(s.calls[0].body.action).toBe("extend");
  expect(s.calls[0].body.minutes).toBe(10);
  expect(s.calls[0].body.targets.map((t: any) => t.id)).toEqual([
    s.rows[0].attempts[0].id,
    s.rows[1].attempts[0].id,
  ]);
  await expect(
    page.getByRole("checkbox", {
      name: `Select attempt ${s.rows[0].attempts[0].id}`,
      exact: true,
    }),
  ).toBeDisabled();
  await expect(
    page.getByRole("rowgroup", { name: "amy", exact: true }),
  ).toContainText("Clock change pending");
});
test("row menus support keyboard navigation and restore focus after a cancelled operation", async ({
  page,
}) => {
  await fixture(page);
  const trigger = page.getByRole("button", {
    name: "Actions for student amy",
    exact: true,
  });
  await trigger.focus();
  await trigger.press("ArrowDown");
  await expect(
    page.getByRole("menuitem", { name: "Set duration", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(
    page.getByRole("menuitem", { name: "Set webcam", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(page.getByRole("menu")).toHaveCount(0);
  await trigger.click();
  await page
    .getByRole("menuitem", { name: "Set duration", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Set duration", exact: true }),
  ).toContainText("Future attempts only");
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await trigger.press("ArrowDown");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(
    page
      .getByRole("rowgroup", { name: "amy", exact: true })
      .getByRole("button", { name: "Review", exact: true })
      .first(),
  ).toBeFocused();
});
test("review keeps recovery deliberate, shows incidents and does not call an unverified submission secured", async ({
  page,
}) => {
  const s = await fixture(page);
  const bob = page.getByRole("rowgroup", { name: "bob", exact: true });
  await bob.getByRole("button", { name: "Review", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "bob · Attempt 1",
    exact: true,
  });
  await expect(
    dialog.getByRole("button", { name: "Close review", exact: true }),
  ).toBeFocused();
  expect(s.calls).toHaveLength(0);
  await dialog.getByRole("button", { name: /^Activity/ }).click();
  await expect(dialog).toContainText("Ready to reconnect");
  s.slow = 500; // A refresh must not publish success while Escape is still blocked.
  await dialog
    .getByRole("button", { name: "Authorize resume", exact: true })
    .click();
  await expect(dialog).toContainText("Resume authorized");
  expect(
    await dialog
      .getByRole("button", { name: "Close review", exact: true })
      .isEnabled(),
  ).toBe(true);
  s.slow = 0;
  expect(s.calls[0].path).toContain("/authorize");
  // Keep an open review fresh even if it no longer matches the selected filter.
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await page
    .getByLabel("Filter attempts", { exact: true })
    .selectOption("attention");
  await bob.getByRole("button", { name: "Review", exact: true }).click();
  s.rows[1].attempts[0].state = "ACTIVE";
  s.rows[1].attempts[0].working = true;
  await expect(dialog.locator(".attempt-status")).toHaveText("Working", {
    timeout: 8000,
  });
  await expect(
    dialog.getByRole("button", { name: "Authorize resume", exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByLabel("Filter attempts", { exact: true }).selectOption("");
  await page
    .getByRole("rowgroup", { name: "carol", exact: true })
    .getByRole("button", { name: "Review", exact: true })
    .click();
  const pending = page.getByRole("dialog", {
    name: "carol · Attempt 1",
    exact: true,
  });
  await pending
    .getByRole("button", { name: "Submission", exact: true })
    .click();
  await expect(pending).toContainText("Collection pending");
  await expect(pending).not.toContainText("Submission secured");
  await expect(pending.getByRole("link", { name: /Download/ })).toHaveCount(0);
});
test("monitoring errors stay inside review and retry without an empty or wrong screen", async ({
  page,
}) => {
  const s = await fixture(page);
  s.failReview = true;
  await page
    .getByRole("rowgroup", { name: "amy", exact: true })
    .getByRole("button", { name: "Review", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog", {
    name: "amy · Attempt 2",
    exact: true,
  });
  await expect(dialog.getByRole("alert")).toContainText(
    "Monitoring unavailable",
  );
  s.failReview = false;
  await dialog
    .getByRole("button", { name: "Retry monitoring", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect(dialog).toContainText("No screen images received");
});
test("slow dashboard responses complete, stale data blocks clock edits, and exam changes clear old rows", async ({
  page,
}) => {
  const s = await fixture(page);
  s.slow = 6000;
  s.rows[0].enrollment.duration = 7200;
  await expect(
    page.getByRole("rowgroup", { name: "amy", exact: true }),
  ).toContainText("Future duration: 120 minutes", { timeout: 15000 });
  s.slow = 0;
  s.failDashboard = true;
  await expect(page.getByRole("alert")).toContainText("Updates paused", {
    timeout: 15000,
  });
  await page
    .getByRole("button", { name: "Actions for amy attempt 2", exact: true })
    .click();
  await expect(
    page.getByRole("menuitem", { name: "Reset clock", exact: true }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  s.failDashboard = false;
  await page
    .getByRole("button", { name: "Retry updates", exact: true })
    .click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByLabel("Selected exam", { exact: true }).selectOption("beta");
  await expect(
    page.getByRole("table", { name: "Students and attempts" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "No students yet", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Instructor sign-in", exact: true }),
  ).toHaveCount(0);
});

test("partial clock failures stay reviewable and retries reuse the same request identities", async ({
  page,
}) => {
  const s = await fixture(page);
  s.failedClock = s.rows[1].attempts[0].id;
  await page.getByLabel("Bulk action", { exact: true }).selectOption("extend");
  await page
    .getByRole("checkbox", {
      name: "Select all attempts on this page",
      exact: true,
    })
    .check();
  await page
    .getByRole("button", { name: "Apply to 2 attempts", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Extend time", exact: true });
  await dialog
    .getByRole("button", { name: "Apply extension", exact: true })
    .click();
  await expect(dialog).toContainText("bob: failed");
  await expect(dialog).toContainText("Clock request could not be delivered");
  await expect(
    dialog.getByLabel("Minutes to add", { exact: true }),
  ).toBeDisabled();
  s.failedClock = "";
  await dialog
    .getByRole("button", { name: "Retry request", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(s.calls).toHaveLength(2);
  expect(s.calls[0].body).toEqual(s.calls[1].body);
});
test("monitoring deletion requires named confirmation and leaves submission review available", async ({
  page,
}) => {
  const s = await fixture(page);
  await page
    .getByRole("rowgroup", { name: "amy", exact: true })
    .getByRole("button", { name: "Review", exact: true })
    .nth(1)
    .click();
  const dialog = page.getByRole("dialog", {
    name: "amy · Attempt 1",
    exact: true,
  });
  await dialog.getByText("Monitoring retention", { exact: true }).click();
  await dialog
    .getByRole("button", { name: "Delete monitoring…", exact: true })
    .click();
  await expect(
    dialog.getByRole("group", { name: "Confirm monitoring deletion" }),
  ).toContainText("amy, attempt 1");
  await dialog
    .getByRole("button", { name: "Cancel deletion", exact: true })
    .click();
  expect(s.calls).toHaveLength(0);
  await dialog
    .getByRole("button", { name: "Delete monitoring…", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Permanently delete monitoring", exact: true })
    .click();
  await expect(
    dialog.getByRole("group", { name: "Confirm monitoring deletion" }),
  ).toHaveCount(0);
  expect(s.calls).toHaveLength(1);
  expect(s.calls[0].path).toContain("/delete-monitoring");
  expect(s.calls[0].body).toEqual({ confirm: true });
  await dialog.getByRole("button", { name: "Submission", exact: true }).click();
  await expect(dialog).toContainText("Submission secured");
  await expect(dialog).toContainText(
    "Submissions are retained on the SSH server",
  );
});

test("editing an exam focuses an editable field and fits a narrow dialog", async ({
  page,
}) => {
  await page.setViewportSize({ width: 430, height: 900 });
  await fixture(page);
  const settings = page.getByRole("button", {
    name: "Exam settings",
    exact: true,
  });
  await settings.click();
  const dialog = page.getByRole("dialog", {
    name: "Exam settings",
    exact: true,
  });
  await expect(dialog.getByLabel("Exam ID", { exact: true })).toBeDisabled();
  await expect(dialog.getByLabel("Name", { exact: true })).toBeFocused();
  await expect(
    dialog.getByLabel("Materials template", { exact: true }),
  ).toHaveValue("sample-exam");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(settings).toBeFocused();
});
