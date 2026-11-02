import { expect, test, type Page } from "@playwright/test";

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

async function fixture(
  page: Page,
  size: number,
  hold = false,
  legacyRosterMissing = false,
) {
  page.setDefaultTimeout(6000);
  const now = Date.now(),
    exam = "bulk-next-loading";
  const settings = {
    id: exam,
    name: "Midterm",
    template: "sample-exam",
    template_version: "a".repeat(64),
    revision: "b".repeat(64),
    duration: 3600,
    webcam: false,
    terminals: 4,
    collection_file_mib: 128,
    collection_total_mib: 512,
    earliest: now - 60000,
    latest: now + 3600000,
  };
  const names = Array.from(
    { length: size },
    (_, i) => `learner${String(i + 1).padStart(3, "0")}`,
  );
  const makeGrant = (i: number, username: string, extra: any = {}) => ({
    id: `11111111-1111-4111-8111-${String(i + 1).padStart(12, "0")}`,
    exam,
    username,
    revision: 1,
    status: "AVAILABLE",
    issuance: "ADDITIONAL_TEMPLATE",
    issuance_order: i + 1,
    actor: "instructor",
    issued_at: now - 10000,
    settings,
    work: { kind: "empty" },
    claims: [],
    ...extra,
  });
  const grants = names.map((name, i) =>
    makeGrant(
      i,
      name,
      i >= size - 4 && (legacyRosterMissing || i < size - 1)
        ? { status: "CONSUMED", claims: [{ state: "CONSUMED" }] }
        : i === size - 1
          ? { claims: [{ state: "PREPARING" }] }
          : i === 0
            ? {
                status: "PENDING_NATIVE",
                work: {
                  kind: "saved",
                  attempt: "33333333-3333-4333-8333-333333333333",
                  checksum: "c".repeat(64),
                },
              }
            : {},
    ),
  );
  // The list is exam-wide. A valid permission outside the selected page must
  // never become an edit target, and historical rows must never be fetched.
  grants.push(makeGrant(size + 1, "unselected_student"));
  const listGate = gate(),
    statusGate = gate();
  const state = {
    grants,
    names,
    settings,
    metadataReads: [] as URL[],
    historyReads: [] as URL[],
    statusReads: [] as any[],
    mutations: [] as string[],
    failList: false,
    invalidList: false,
    holdStatus: hold,
  };
  await page.route("**/api/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      path = url.pathname;
    if (path === "/api/session")
      return route.fulfill({
        json: { role: "admin", username: "instructor", csrf: "fixture" },
      });
    if (path === "/api/login-test")
      return route.fulfill({ json: { loginOnly: false } });
    if (path === "/api/admin/exams") return route.fulfill({ json: [settings] });
    if (path.endsWith("/dashboard"))
      return route.fulfill({
        json: {
          serverNow: now,
          students: names.map((username, i) => ({
            username,
            enrollment:
              legacyRosterMissing && i >= size - 4
                ? null
                : { duration: null, webcam: null },
            removable: false,
            latestSettings: settings,
            unusedAttempt:
              grants.find(
                (grant) =>
                  grant.username === username &&
                  ["AVAILABLE", "PENDING_NATIVE"].includes(grant.status) &&
                  grant.claims.every(
                    (claim: any) => claim.state === "CANCELLED",
                  ),
              ) ?? null,
            attempts:
              legacyRosterMissing && i >= size - 4
                ? [
                    {
                      id: `22222222-2222-4222-8222-${String(i + 1).padStart(12, "0")}`,
                      exam,
                      username,
                      state: "COMPLETED",
                      protected: 1,
                      settings: JSON.stringify(settings),
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
                  ]
                : [],
          })),
          total: size,
          counts: { students: size },
          incidents: [],
        },
      });
    if (path.endsWith("/grants")) {
      if (url.searchParams.get("next_only") !== "true") {
        state.historyReads.push(url);
        return route.fulfill({
          status: 500,
          json: { error: "Unexpected per-student history lookup" },
        });
      }
      state.metadataReads.push(url);
      if (hold) await listGate.promise;
      if (state.failList)
        return route.fulfill({
          status: 503,
          json: { error: "Synthetic selection unavailable" },
        });
      // Database UUID order is unrelated to the instructor's alphabetical selection.
      const rows = grants
        .filter((g) => ["AVAILABLE", "PENDING_NATIVE"].includes(g.status))
        .reverse();
      return route.fulfill({
        json: {
          grants: state.invalidList
            ? rows.map((row) =>
                row.username === names[0] ? { ...row, claims: undefined } : row,
              )
            : rows,
          next: null,
        },
      });
    }
    if (path.endsWith("/grants/status")) {
      const body = request.postDataJSON();
      state.statusReads.push(body);
      if (state.holdStatus) await statusGate.promise;
      return route.fulfill({
        json: {
          rows: body.rows.map((ref: any) => {
            const g = grants.find((candidate) => candidate.id === ref.id)!;
            return {
              id: g.id,
              revision: ref.revision,
              current_revision: g.revision,
              grant_status: g.status,
              status: g.status === "PENDING_NATIVE" ? "RUNNING" : "NOT_QUEUED",
              tries: 0,
              error: "",
              grant: g,
              source: null,
            };
          }),
        },
      });
    }
    if (request.method() !== "GET") state.mutations.push(path);
    return route.fulfill({
      status: 404,
      json: { error: "Unexpected synthetic request" },
    });
  });
  await page.goto("/admin");
  await page
    .getByRole("combobox", { name: "Selected exam", exact: true })
    .selectOption(exam);
  const open = async () => {
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
    return page.getByRole("dialog", {
      name: "Change next attempts",
      exact: true,
    });
  };
  return {
    state,
    open,
    releaseList: listGate.release,
    releaseStatus: () => {
      state.holdStatus = false;
      statusGate.release();
    },
  };
}

for (const size of [70, 100])
  test(`${size} selected students get an immediate draft and one current-attempt lookup with every omission named`, async ({
    page,
  }, info) => {
    const f = await fixture(page, size, true),
      dialog = await f.open();
    try {
      await expect.poll(() => f.state.metadataReads.length).toBe(1);
      await expect(dialog).toContainText(`${size} students selected`);
      const time = dialog.getByLabel("Time limit (minutes)", { exact: true });
      await expect(time).toBeEnabled();
      await time.fill("37");
      await expect(
        dialog.getByRole("button", { name: "Review changes", exact: true }),
      ).toBeDisabled();
      await expect(dialog.getByRole("alert")).toHaveCount(0);
      if (size === 70)
        await page.screenshot({ path: info.outputPath("bulk70-loading.png") });
      f.releaseList();
      await expect(dialog).toContainText(
        `${size - 4} next attempts can be changed`,
      );
      await expect(time).toHaveValue("37");
      // Saved-work status hydration is not a prerequisite for selecting the
      // current permissions or preparing a shared settings change.
      await expect.poll(() => f.state.statusReads.length).toBeGreaterThan(0);
      await expect(time).toBeEnabled();
      await expect(dialog).toContainText(
        `No next attempt for: ${f.state.names.slice(size - 4, size - 1).join(", ")}.`,
      );
      await expect(dialog).toContainText(
        `Attempt already in progress for: ${f.state.names[size - 1]}.`,
      );
      await expect(dialog.getByRole("alert")).toHaveCount(0);
      expect(f.state.historyReads).toEqual([]);
      expect(f.state.metadataReads).toHaveLength(1);
      expect(f.state.metadataReads[0].searchParams.get("username")).toBeNull();
      expect(f.state.metadataReads[0].searchParams.get("limit")).toBe("200");
      expect(f.state.mutations).toEqual([]);
      if (size === 70)
        await page.screenshot({ path: info.outputPath("bulk70-ready.png") });
      f.releaseStatus();
      await dialog
        .getByRole("button", { name: "Review changes", exact: true })
        .click();
      const review = dialog.getByRole("region", {
        name: "Review unused changes",
        exact: true,
      });
      await expect(review.getByRole("article")).toHaveCount(size - 4);
      const reviewed = f.state.statusReads.findLast(
        (read) => read.rows.length === size - 4,
      );
      expect(reviewed).toBeDefined();
      const targets = reviewed.rows.map((ref: any) => ref.id);
      expect(targets).toEqual(
        f.state.grants.slice(0, size - 4).map((g) => g.id),
      );
      await expect(review).not.toContainText("unselected_student");
      expect(f.state.mutations).toEqual([]);
    } finally {
      f.releaseList();
      f.releaseStatus();
    }
  });

for (const invalid of [false, true])
  test(`an ${invalid ? "invalid" : "unavailable"} bulk lookup keeps the full selection and draft safely retryable`, async ({
    page,
  }) => {
    const f = await fixture(page, 70, true);
    f.state.failList = !invalid;
    f.state.invalidList = invalid;
    const dialog = await f.open(),
      time = dialog.getByLabel("Time limit (minutes)", { exact: true });
    try {
      await time.fill("39");
      f.releaseList();
      await expect(dialog.getByRole("alert")).toBeVisible();
      await expect(dialog).toContainText("70 students selected");
      await expect(
        dialog.getByRole("button", { name: "Review changes", exact: true }),
      ).toBeDisabled();
      await expect(dialog).not.toContainText("No next attempt for:");
      expect(f.state.mutations).toEqual([]);
      f.state.failList = false;
      f.state.invalidList = false;
      await dialog
        .getByRole("button", { name: "Refresh", exact: true })
        .click();
      await expect(dialog).toContainText("66 next attempts can be changed");
      await expect(time).toHaveValue("39");
      await expect(dialog.getByRole("alert")).toHaveCount(0);
      expect(f.state.metadataReads).toHaveLength(2);
      expect(f.state.historyReads).toEqual([]);
      expect(f.state.mutations).toEqual([]);
    } finally {
      f.releaseList();
      f.releaseStatus();
    }
  });

test("a student entering setup after the bulk lookup is refused by the fresh review without editing an active attempt", async ({
  page,
}) => {
  const f = await fixture(page, 70),
    dialog = await f.open();
  await expect(dialog).toContainText("66 next attempts can be changed");
  await dialog.getByLabel("Time limit (minutes)", { exact: true }).fill("40");
  f.state.grants[5].claims = [{ state: "PREPARING" }];
  await dialog
    .getByRole("button", { name: "Review changes", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(f.state.names[5]);
  await expect(
    dialog.getByRole("region", { name: "Review unused changes", exact: true }),
  ).toHaveCount(0);
  await expect(
    dialog.getByLabel("Time limit (minutes)", { exact: true }),
  ).toHaveValue("40");
  expect(f.state.mutations).toEqual([]);
  expect(f.state.grants[5].settings.duration).toBe(3600);
});

test("all 70 students are selectable and four historical students without next attempts remain in the bulk selection", async ({
  page,
}, info) => {
  const f = await fixture(page, 70, false, true);
  await expect(page.getByRole("rowgroup", { name: /^learner/ })).toHaveCount(
    70,
  );
  const select = page.getByRole("checkbox", {
    name: "Select all students on this page",
    exact: true,
  });
  await expect(
    page.getByText("Select all students (70)", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: /^Select student learner/ }),
  ).toHaveCount(70);
  await expect(page.getByText("Not enrolled", { exact: true })).toHaveCount(0);
  const historyStudent = f.state.names[66];
  await expect(
    page.getByRole("button", {
      name: `Add next attempt for ${historyStudent}`,
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: `Delete student ${historyStudent}`,
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: `Actions for student ${historyStudent}`,
      exact: true,
    }),
  ).toHaveCount(0);
  await select.check();
  const selection = page.getByRole("region", {
    name: "Bulk selection",
    exact: true,
  });
  await expect(selection).toContainText("70 students selected");
  await expect(selection).not.toContainText(/not enrolled|not selected/i);
  for (const username of f.state.names.slice(66)) {
    await expect(
      page.getByRole("checkbox", {
        name: `Select student ${username}`,
        exact: true,
      }),
    ).toBeChecked();
  }
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
  await expect(dialog).toContainText("70 students selected");
  await expect(dialog).toContainText("66 next attempts can be changed");
  await expect(dialog).not.toContainText(/not enrolled|not selected/i);
  await expect(dialog).toContainText(
    `No next attempt for: ${f.state.names.slice(66).join(", ")}.`,
  );
  for (const username of f.state.names.slice(66))
    await expect(dialog).toContainText(username);
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  expect(f.state.metadataReads).toHaveLength(1);
  expect(f.state.historyReads).toEqual([]);
  await dialog.getByLabel("Time limit (minutes)", { exact: true }).fill("37");
  await page.screenshot({
    path: info.outputPath("70-selected-66-next-attempts.png"),
  });
  await dialog
    .getByRole("button", { name: "Review changes", exact: true })
    .click();
  await expect(
    dialog
      .getByRole("region", { name: "Review unused changes", exact: true })
      .getByRole("article"),
  ).toHaveCount(66);
  const reviewed = f.state.statusReads.findLast(
    (read) => read.rows.length === 66,
  );
  expect(reviewed).toBeDefined();
  expect(reviewed.rows.map((ref: any) => ref.id)).toEqual(
    f.state.grants.slice(0, 66).map((grant) => grant.id),
  );
  expect(f.state.mutations).toEqual([]);
});
