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
    if (path.endsWith("/revoke")) {
      const body = route.request().postDataJSON();
      calls.push({ path, body });
      const row = grants.find((g) => path.includes(g.id))!;
      if (replies.has(body.request))
        return route.fulfill({ json: replies.get(body.request) });
      if (row.status === "CONSUMED")
        return route.fulfill({
          status: 409,
          json: { error: "This attempt has started. It cannot be cancelled." },
        });
      if (row.username === "bob") {
        row.claims = [{ state: "PREPARING" }];
        return route.fulfill({
          status: 409,
          json: {
            error:
              "Grant has an unresolved preparation/Begin; inspect original authority before another request.",
          },
        });
      }
      if (!dropped && mode === "lost-before") {
        dropped = true;
        return route.abort("failed");
      }
      row.status = "REVOKED";
      replies.set(body.request, { ...row });
      if (!dropped) {
        dropped = true;
        return route.abort("failed");
      }
      return route.fulfill({ json: { ...row } });
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
    .getByRole("menuitem", { name: "Cancel extra attempts", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Cancel extra attempts",
    exact: true,
  });
  await expect(
    dialog.getByText("dave: Nothing to cancel.", { exact: true }),
  ).toBeVisible();
  return dialog;
}

test("cancel selected extras in one dialog with named omissions, protected history and exact retry", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 430, height: 1000 });
  const s = await fixture(page);
  await page
    .getByRole("checkbox", {
      name: "Select all students on this page",
      exact: true,
    })
    .check();
  const dialog = await openCancellation(page);
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(
    dialog.getByText("carol: Nothing to cancel.", { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByRole("checkbox")).toHaveCount(2);
  expect(s.queries).toEqual(["amy", "amy", "bob", "carol", "dave"]);
  await dialog
    .getByRole("button", { name: "Cancel 2 extra attempts", exact: true })
    .click();
  await expect(
    dialog.getByText("Result unknown — retry", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByText("Not cancelled", { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByText(/Grant has an unresolved/)).not.toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await page.screenshot({ path: info.outputPath("cancel-partial-mobile.png") });
  await dialog
    .getByRole("button", { name: "Retry cancellation", exact: true })
    .click();
  await expect(dialog.getByText("Cancelled", { exact: true })).toBeVisible();
  expect(s.calls).toHaveLength(3);
  expect(s.calls[0].body).toEqual(s.calls[2].body);
  expect(s.grants[2].status).toBe("CONSUMED");
  expect(s.grants[3].status).toBe("AVAILABLE");
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
  await page
    .getByRole("checkbox", {
      name: "Select all students on this page",
      exact: true,
    })
    .check();
  let dialog = await openCancellation(page);
  await dialog
    .getByRole("button", { name: "Cancel 2 extra attempts", exact: true })
    .click();
  await expect(
    dialog.getByText("Result unknown — retry", { exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  dialog = await openCancellation(page);
  await expect(
    dialog.getByText("Previous result unknown — retry", { exact: true }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Retry cancellation", exact: true })
    .click();
  await expect(dialog.getByText("Cancelled", { exact: true })).toBeVisible();
  expect(s.calls[0].body).toEqual(s.calls[2].body);
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
  await dialog
    .getByRole("button", { name: "Add time", exact: true })
    .click();
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
  await page
    .getByRole("checkbox", {
      name: "Select all students on this page",
      exact: true,
    })
    .check();
  let dialog = await openCancellation(page);
  await dialog
    .getByRole("button", { name: "Cancel 2 extra attempts", exact: true })
    .click();
  await expect(
    dialog.getByText("Result unknown — retry", { exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  s.grants[0].status = "CONSUMED";
  s.grants[0].claims = [{ state: "CONSUMED" }];
  dialog = await openCancellation(page);
  await expect(
    dialog.getByText("Previous result unknown — retry", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByText("amy: Nothing to cancel.", { exact: true }),
  ).toHaveCount(0);
  await dialog
    .getByRole("button", { name: "Retry cancellation", exact: true })
    .click();
  await expect(dialog.getByText("Not cancelled", { exact: true })).toHaveCount(
    1,
  );
  expect(s.grants[0].status).toBe("CONSUMED");
  expect(s.calls[0].body).toEqual(s.calls[2].body);
});
