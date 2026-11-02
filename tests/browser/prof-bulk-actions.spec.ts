import { test, expect, type Page } from "@playwright/test";

async function fixture(
  page: Page,
  mode: "partial" | "lost-before" | "empty" = "partial",
) {
  page.setDefaultTimeout(7000);
  const now = Date.now(),
    exam = "prof-bulk";
  const settings = {
    id: exam,
    name: "Practice midterm",
    duration: 5400,
    webcam: false,
    terminals: 4,
    template: "sample-exam",
    template_version: "a".repeat(64),
    earliest: now - 60000,
    latest: now + 3600000,
  };
  const grant = (n: number, username: string, extra: any = {}) => ({
    id: `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`,
    exam,
    username,
    revision: 1,
    status: "AVAILABLE",
    issuance: "ADDITIONAL_TEMPLATE",
    issuance_order: n,
    actor: "instructor",
    issued_at: now - n * 1000,
    reason: "Reviewed additional attempt",
    settings,
    work: { kind: "template", name: "sample-exam", hash: "a".repeat(64) },
    claims: [],
    ...extra,
  });
  const grants =
    mode === "empty"
      ? []
      : [
          grant(1, "amy"),
          grant(2, "bob"),
          grant(3, "carol", { status: "CONSUMED" }),
          grant(4, "dave", { issuance: "ENROLLMENT" }),
        ];
  const current = {
    id: "22222222-2222-4222-8222-222222222222",
    exam,
    username: "amy",
    state: "ACTIVE",
    settings: JSON.stringify(settings),
    start: now - 1000,
    deadline: now + 5400000,
    original_deadline: now + 5400000,
    clock_revision: 0,
    protected: 0,
    generation: 1,
    attempt_number: 2,
    connected: true,
    working: true,
    terminalCount: 1,
    last_contact: now,
  };
  const students = ["amy", "bob", "carol", "dave"].map((username) => ({
    username,
    enrollment: { duration: null, webcam: null },
    latestSettings: settings,
    unusedAttempt:
      grants.find((g) => g.username === username && g.status === "AVAILABLE") ??
      null,
    attempts:
      username === "amy"
        ? [
            current,
            {
              ...current,
              id: "33333333-3333-4333-8333-333333333333",
              attempt_number: 1,
              state: "COMPLETED",
              protected: 1,
              ended: now - 2000,
            },
          ]
        : [],
  }));
  const calls: { path: string; body: any }[] = [],
    queries: string[] = [];
  const replies = new Map<string, any>();
  let dropped = false;
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
      return route.fulfill({
        json: [{ ...settings, revision: "b".repeat(64) }],
      });
    if (path.endsWith("/dashboard"))
      return route.fulfill({
        json: {
          serverNow: Date.now(),
          students,
          total: 4,
          counts: { students: 4, working: 1, attention: 0, collected: 1 },
          incidents: [],
        },
      });
    if (path.endsWith("/grants")) {
      if (url.searchParams.get("next_only") === "true") {
        queries.push("next_only");
        return route.fulfill({
          json: {
            grants: grants.filter((g) =>
              ["AVAILABLE", "PENDING_NATIVE"].includes(g.status),
            ),
            next: null,
          },
        });
      }
      const username = url.searchParams.get("username")!;
      queries.push(username);
      // A complete export follows even an empty first page.
      if (username === "amy" && !url.searchParams.get("after"))
        return route.fulfill({
          json: { grants: [], next: "00000000-0000-4000-8000-000000000001" },
        });
      return route.fulfill({
        json: {
          grants: grants.filter((g) => g.username === username),
          next: null,
        },
      });
    }
    if (path.endsWith("/grants/status")) {
      const body = route.request().postDataJSON();
      return route.fulfill({
        json: {
          rows: body.rows.map((ref: any) => {
            const row = grants.find((g) => g.id === ref.id)!;
            return {
              id: row.id,
              revision: ref.revision,
              current_revision: row.revision,
              grant_status: row.status,
              status: "NOT_QUEUED",
              tries: 0,
              error: "",
              grant: row,
            };
          }),
        },
      });
    }
    if (path.endsWith("/grants/change")) {
      const body = route.request().postDataJSON();
      calls.push({ path, body });
      if (!dropped && mode === "lost-before") {
        dropped = true;
        return route.abort("failed");
      }
      const results = body.rows.map((change: any) => {
        const row = grants.find((g) => g.id === change.id)!;
        const ref = { id: row.id, request: change.body.request };
        if (replies.has(change.body.request))
          return replies.get(change.body.request);
        if (row.status === "CONSUMED")
          return {
            ...ref,
            outcome: "refused",
            error: "This attempt has started. It cannot be cancelled.",
          };
        if (row.username === "bob") {
          row.claims = [{ state: "PREPARING" }];
          return {
            ...ref,
            outcome: "refused",
            error:
              "The attempt has unresolved setup; inspect the original authority before another request.",
          };
        }
        row.status = "REVOKED";
        const result = { ...ref, outcome: "saved", grant: { ...row } };
        replies.set(change.body.request, result);
        if (!dropped) {
          dropped = true;
          return {
            ...ref,
            outcome: "unknown",
            error: "Cancellation reply was lost.",
          };
        }
        return result;
      });
      return route.fulfill({ json: { results } });
    }
    if (path.endsWith("/attempts/clocks")) {
      const body = route.request().postDataJSON();
      calls.push({ path, body });
      return route.fulfill({
        json: {
          results: body.targets.map((t: any) => ({ ...t, status: "pending" })),
        },
      });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto("/");
  await page.getByLabel("Selected exam", { exact: true }).selectOption(exam);
  return { calls, queries, grants, current };
}

async function openCancellation(page: Page) {
  await page
    .getByRole("button", { name: "Selected students", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Cancel next attempts", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Change next attempts",
    exact: true,
  });
  await expect(
    dialog.getByRole("region", { name: "Review unused changes", exact: true }),
  ).toBeVisible();
  return dialog;
}

async function selectPage(page: Page) {
  await page
    .getByRole("checkbox", {
      name: "Select all students on this page",
      exact: true,
    })
    .check();
}

test("cancel next attempts in one dialog with named omissions, protected history and exact retry", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 430, height: 1000 });
  const s = await fixture(page);
  await selectPage(page);
  const dialog = await openCancellation(page);
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(dialog).toContainText("No next attempt for: carol.");
  await expect(dialog.getByRole("checkbox")).toHaveCount(0);
  expect(s.queries).toEqual(["next_only"]);
  await expect(dialog).toContainText("3 attempts");
  await dialog
    .getByRole("button", { name: "Cancel selected attempts", exact: true })
    .click();
  await expect(
    dialog.getByText("Change unconfirmed", { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByText("Not changed", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Cancelled", { exact: true })).toHaveCount(1);
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await page.screenshot({
    path: info.outputPath("cancel-next-partial-mobile.png"),
  });
  await dialog
    .getByRole("button", { name: "Retry unconfirmed changes", exact: true })
    .click();
  await expect(dialog.getByText("Cancelled", { exact: true })).toHaveCount(2);
  expect(s.calls).toHaveLength(2);
  expect(s.calls[0].body.rows).toHaveLength(3);
  expect(s.calls[1].body.rows).toEqual([s.calls[0].body.rows[0]]);
  expect(s.grants[2].status).toBe("CONSUMED");
  expect(s.grants[3].status).toBe("REVOKED");
  expect(s.current.state).toBe("ACTIVE");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("closing and reopening keeps an unknown cancellation intent without another confirmation", async ({
  page,
}) => {
  const s = await fixture(page, "lost-before");
  await selectPage(page);
  let dialog = await openCancellation(page);
  await dialog
    .getByRole("button", { name: "Cancel selected attempts", exact: true })
    .click();
  await expect(
    dialog.getByText("Change unconfirmed", { exact: true }),
  ).toHaveCount(3);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  dialog = await openCancellation(page);
  await expect(
    dialog.getByText("Change unconfirmed", { exact: true }),
  ).toHaveCount(3);
  await dialog
    .getByRole("button", { name: "Retry unconfirmed changes", exact: true })
    .click();
  await expect(dialog.getByText("Cancelled", { exact: true })).toHaveCount(2);
  expect(s.calls).toHaveLength(2);
  expect(s.calls[0].body).toEqual(s.calls[1].body);
});

test("add time has one dialog and names selected students whose clocks will not change", async ({
  page,
}) => {
  const s = await fixture(page, "empty");
  await page
    .getByRole("checkbox", {
      name: "Select all students on this page",
      exact: true,
    })
    .check();
  await page
    .getByRole("button", { name: "Selected students", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Add time", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add time", exact: true });
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(dialog).toContainText(
    "Time will not change for: bob, carol, dave.",
  );
  await dialog.getByLabel("Minutes to add", { exact: true }).fill("15");
  await dialog.getByRole("button", { name: "Add time", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(s.calls).toHaveLength(1);
  expect(s.calls[0].body).toMatchObject({
    action: "extend",
    minutes: 15,
    targets: [{ id: s.current.id, revision: 0 }],
  });
});

test("an uncertain cancellation that starts while closed stays visible and cannot be revoked", async ({
  page,
}) => {
  const s = await fixture(page, "lost-before");
  await selectPage(page);
  let dialog = await openCancellation(page);
  await dialog
    .getByRole("button", { name: "Cancel selected attempts", exact: true })
    .click();
  await expect(
    dialog.getByText("Change unconfirmed", { exact: true }),
  ).toHaveCount(3);
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  s.grants[0].status = "CONSUMED";
  s.grants[0].claims = [{ state: "CONSUMED" }];
  dialog = await openCancellation(page);
  await expect(
    dialog.getByText("Change unconfirmed", { exact: true }),
  ).toHaveCount(3);
  await expect(dialog).not.toContainText("No next attempt for: amy");
  await dialog
    .getByRole("button", { name: "Retry unconfirmed changes", exact: true })
    .click();
  await expect(dialog.getByText("Cancelled", { exact: true })).toHaveCount(1);
  await expect(
    dialog.getByText("Change unconfirmed", { exact: true }),
  ).toHaveCount(2);
  await expect(dialog).toContainText("Current status: Started");
  expect(s.grants[0].status).toBe("CONSUMED");
  expect(s.calls[0].body).toEqual(s.calls[1].body);
});
