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
    preflight_started_at: start - 120000,
    connected: state === "ACTIVE",
    last_contact: Date.now(),
    terminalCount: state === "ACTIVE" ? 2 : 0,
    deadline: Date.now() + 300000,
    original_deadline: Date.now() + 300000,
    clock_revision: 0,
    generation: 1,
    continuation_revision: 0,
    attempt_number: 1,
    protected: 0,
    ended: ["COMPLETED", "COLLECTION_FAILED"].includes(state)
      ? Date.now() - 1000
      : null,
    ...extra,
  };
}
async function fixture(
  page: Page,
  large = false,
  provenance = false,
  retained = false,
) {
  const amy = makeAttempt(1, "amy", "ACTIVE", {
      working: true,
      attempt_number: 2,
    }),
    bob = makeAttempt(3, "bob", "LOCKED", {
      reason: "Fullscreen exited",
      monitoring_mode: retained ? "v1" : undefined,
    });
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
    failSettings: false,
    failReview: false,
    failedClock: "",
    slow: 0,
    reviewDelay: null as Promise<void> | null,
    reviewCalls: 0,
    replayOffsets: [] as number[],
    replayEvents: [] as any[],
    failReplay: false,
    lostAuthorization: false,
    authorizationReplies: new Map<string, any>(),
    monitoringRevision: "a".repeat(64),
    lostDeletion: false,
    deletionReplies: new Map<string, any>(),
    media: {
      monitoringDeleted: false,
      physicalPurge: {
        status: "not-verified",
        verified: null as number | null,
      },
      frames: [] as any[],
      terminals: [] as any[],
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
    },
  };
  const grant = {
    id: "22222222-2222-4222-8222-222222222222",
    exam: "alpha",
    username: "amy",
    issuance: "ADDITIONAL_TEMPLATE",
    issuance_order: 2,
    revision: 2,
    status: "AVAILABLE",
    hash: "b".repeat(64),
    issued_at: Date.now() - 120000,
    actor: "instructor",
    reason: "Explicit recovery from the selected protected source",
    settings: {
      id: "alpha",
      duration: 4500,
      webcam: false,
      terminals: 4,
      earliest: Date.now() - 60000,
      latest: Date.now() + 3600000,
      template: "sample-exam",
      template_version: "a".repeat(64),
      collection_file_mib: 128,
      collection_total_mib: 512,
    },
    work: { kind: "empty" },
    claims: [],
    history: [],
  };
  const source = makeAttempt(7, "amy", "COMPLETED", {
    exam: "beta",
    attempt_number: 1,
    protected: 1,
    grantContext: { state: "legacy" },
  });
  if (provenance) {
    amy.grantContext = {
      ...grant,
      state: "recorded",
      revision: 1,
      hash: "c".repeat(64),
      current_revision: 2,
      current_status: "AVAILABLE",
      revision_reason: grant.reason,
      settings: { ...grant.settings, duration: 5400 },
      work: { kind: "saved", attempt: source.id, checksum: "d".repeat(64) },
      source_attempt: {
        id: source.id,
        exam: "beta",
        attempt_number: 1,
        state: "COMPLETED",
        recorded_protected: true,
        checksum_matches: true,
        available_in_gateway: true,
      },
    };
    rows[0].unusedGrants = {
      available: 1,
      future: 1,
      closed: 1,
      pendingNative: 1,
    };
  }
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname;
    const json = async (body: any, status = 200) =>
      route.fulfill({ status, json: body });
    if (path === "/api/session")
      return json({ role: "admin", username: "instructor", csrf: "fixture" });
    if (path === "/api/login-test") return json({ loginOnly: false });
    if (provenance && path === "/api/admin/exams/alpha/grants")
      return json({ grants: [], next: null }); // Exact historical selection may be outside the first page.
    if (provenance && path === `/api/admin/grants/${grant.id}`)
      return json(grant);
    if (path === "/api/admin/templates")
      return json({
        agent: "class",
        sources: [
          {
            schema: 1,
            agent: "class",
            name: "sample-exam",
            hash: "a".repeat(64),
            entries: 4,
            files: 2,
            bytes: 30,
            max_file_bytes: 20,
            first_native_created: 1000,
            last_native_created: 1000,
            first_acknowledged_at: 1000,
            last_attested_at: 1000,
            last_acknowledged_at: 1000,
            last_request: "12345678-1234-4234-8234-123456789abc",
            revision: "b".repeat(64),
          },
        ],
        next: null,
        observed: Date.now(),
        note: "Synthetic published files",
      });
    if (path === "/api/admin/exams")
      return json(
        ["alpha", "beta"].map((id) => ({
          id,
          name: id === "alpha" ? "Programming final" : "Second exam",
          duration: 5400,
          webcam: false,
          terminals: 4,
          template: "sample-exam",
          template_version: "a".repeat(64),
          revision: 1,
          earliest: Date.now() - 60000,
          latest: Date.now() + 3600000,
        })),
      );
    if (path.endsWith("/dashboard")) {
      state.dashboards++;
      if (state.slow) await new Promise((r) => setTimeout(r, state.slow));
      if (state.failDashboard)
        return json({ error: "Dashboard unavailable" }, 503);
      const roster = path.includes("/beta/")
        ? provenance
          ? [{ username: "amy", enrollment: null, attempts: [source] }]
          : []
        : state.rows;
      const filtered = roster
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
          roster
            .flatMap((s) => s.attempts)
            .find((a: any) => a.id === url.searchParams.get("review")) || null,
        counts: {
          students: roster.length,
          working: roster.flatMap((s) => s.attempts).filter((a) => a.working)
            .length,
          attention: roster
            .flatMap((s) => s.attempts)
            .filter((a) => ["LOCKED", "COLLECTION_FAILED"].includes(a.state))
            .length,
          active: roster
            .flatMap((s) => s.attempts)
            .filter((a) => a.state === "ACTIVE").length,
          locked: roster
            .flatMap((s) => s.attempts)
            .filter((a) => a.state === "LOCKED").length,
          collected: roster
            .flatMap((s) => s.attempts)
            .filter((a) => a.protected).length,
        },
        incidents: [],
      });
    }
    if (path.includes("/recordings/")) {
      const offset = Number(url.searchParams.get("offset"));
      state.replayOffsets.push(offset);
      if (state.failReplay) return json({ error: "Replay unavailable" }, 503);
      const text = state.replayEvents
        .map((e) => JSON.stringify(e) + "\n")
        .join("");
      return json({
        text: text.slice(offset),
        nextOffset: text.length,
        more: false,
      });
    }
    if (path.startsWith("/api/admin/media/"))
      return route.fulfill({
        contentType: "image/png",
        body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6lWQAAAAASUVORK5CYII=",
          "base64",
        ),
      });
    if (path.endsWith("/recordings")) {
      state.reviewCalls++;
      if (state.reviewDelay) await state.reviewDelay;
      if (state.failReview)
        return json({ error: "Monitoring unavailable" }, 503);
      const a = [...state.rows, { attempts: [source] }]
        .flatMap((s) => s.attempts)
        .find((a) => path.includes(a.id));
      return json({
        ...state.media,
        deletionReview: {
          id: a.id,
          confirm: a.username,
          revision: state.monitoringRevision,
          eligible: !!a.ended,
        },
      });
    }
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      state.calls.push({ path, body });
      if (path.endsWith("/delete-monitoring")) {
        if (state.deletionReplies.has(body.requestID))
          return json(state.deletionReplies.get(body.requestID));
        if (body.revision !== state.monitoringRevision)
          return json(
            {
              error:
                "Monitoring deletion target changed after review; cancel and review a NEW intent",
            },
            409,
          );
        state.media.monitoringDeleted = true;
        state.media.physicalPurge.status = "retry";
        state.monitoringRevision = "b".repeat(64);
        const result = {
          ok: true,
          logicalDeleted: true,
          physicalPurge: state.media.physicalPurge,
        };
        state.deletionReplies.set(body.requestID, result);
        if (state.lostDeletion) {
          state.lostDeletion = false;
          return route.abort("failed");
        }
        return json(result);
      }
      if (path.endsWith("/authorize")) {
        const prior = state.authorizationReplies.get(body.requestID);
        if (prior) return json(prior);
        const a = state.rows
          .flatMap((s) => s.attempts)
          .find((a) => path.includes(a.id));
        if (
          a.generation !== body.generation ||
          a.continuation_revision !== body.revision
        )
          return json(
            {
              error:
                "Interruption changed after review; cancel, review current interruption and use a new intent",
            },
            409,
          );
        const result = {
          id: a.id,
          generation: a.generation,
          expires: Math.min(a.deadline, Date.now() + 300000),
          execution: false,
          status: "authorized",
        };
        a.continuation_revision++;
        state.authorizationReplies.set(body.requestID, result);
        if (state.lostAuthorization) {
          state.lostAuthorization = false;
          return route.abort("failed");
        }
        return json(result);
      }
      if (path.endsWith("/roster/settings")) {
        if (state.failSettings)
          return json({ error: "Settings could not be saved" }, 503);
        for (const row of state.rows.filter((s) =>
          body.usernames.includes(s.username),
        )) {
          for (const field of ["duration", "webcam"])
            if (field in body) row.enrollment[field] = body[field];
        }
        return json({ ok: true });
      }
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
  test(`legacy attempt notes are inline in roster and review at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await fixture(page, false, true);
    await page
      .getByLabel("Selected exam", { exact: true })
      .selectOption("beta");
    const row = page.getByRole("rowgroup", { name: "amy", exact: true }),
      notice = "Earlier attempt · saved settings unavailable";
    await expect(row.getByText(notice, { exact: true })).toBeVisible();
    await expect(row.locator(".attempt-grant-summary summary")).toHaveCount(0);
    await row
      .getByRole("button", { name: "Review", exact: true })
      .click({ timeout: 3000 });
    const review = page.getByRole("dialog", {
      name: "amy · Attempt 1",
      exact: true,
    });
    await expect(review.getByText(notice, { exact: true })).toBeVisible();
    await expect(review.locator(".attempt-grant-summary summary")).toHaveCount(
      0,
    );
    await page.screenshot({
      path: info.outputPath(`legacy-attempt-notes-${width}.png`),
      fullPage: true,
    });
  });

for (const width of [1280, 430])
  test(`attempt provenance keeps applied settings and opens the exact grant and cross-exam source at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await fixture(page, false, true);
    const amy = page.getByRole("rowgroup", { name: "amy", exact: true });
    await expect(amy).toContainText("1 attempt ready");
    await expect(amy).toContainText("1 preparing saved work");
    await expect(amy).toContainText("1 available later");
    await expect(amy).toContainText("1 start window closed");
    await amy
      .getByRole("button", {
        name: "View settings for amy attempt 2",
        exact: true,
      })
      .click({ timeout: 5000 });
    const grants = page.getByRole("dialog", {
      name: "Allowed attempts for amy",
      exact: true,
    });
    const currentGrant = grants.locator("article.clock-batch-row").filter({
      hasText: "75 min · Webcam optional",
    });
    const selectionHelp = grants.getByText(
      "Select unused attempts to change or cancel.",
      { exact: true },
    );
    await expect(selectionHelp).toBeVisible();
    await expect(currentGrant).toHaveCount(1);
    await expect(currentGrant).toBeInViewport();
    await expect(
      currentGrant.getByRole("checkbox", { name: /^Select .*attempt/i }),
    ).toBeChecked();
    await expect(currentGrant.locator("label")).toHaveText(
      /^Select .*attempt/i,
    );
    await expect(
      grants.getByText("1 attempt for 1 student selected", { exact: true }),
    ).toBeVisible();
    await expect(currentGrant.getByText(/^Start window:/)).toBeVisible();
    await expect(currentGrant.getByText(/^Reference /)).not.toBeVisible();
    const cardBox = await currentGrant.boundingBox(),
      purposeBox = await selectionHelp.boundingBox(),
      editBox = await grants
        .getByLabel("Time limit (minutes)", { exact: true })
        .boundingBox();
    expect(cardBox).not.toBeNull();
    expect(purposeBox).not.toBeNull();
    expect(editBox).not.toBeNull();
    expect(purposeBox!.y).toBeLessThan(cardBox!.y);
    expect(cardBox!.y).toBeLessThan(editBox!.y);
    await page.screenshot({
      path: info.outputPath(`allowed-attempts-useful-${width}.png`),
      fullPage: true,
    });
    await currentGrant.getByText("Technical details", { exact: true }).click();
    await expect(currentGrant.getByText(/^Reference /)).toBeVisible();
    await expect(currentGrant).toContainText("Revision 2");
    await grants
      .getByRole("button", { name: "Close", exact: true })
      .click({ timeout: 5000 });
    await amy
      .getByRole("button", { name: "Review", exact: true })
      .first()
      .click({ timeout: 5000 });
    const review = page.getByRole("dialog", {
      name: "amy · Attempt 2",
      exact: true,
    });
    const provenance = review.locator(".grant-provenance");
    await provenance
      .getByText("Starting files and settings", { exact: true })
      .click();
    await expect(provenance).toContainText(
      "This attempt keeps its saved settings despite later changes",
    );
    await expect(provenance.getByText("90 min", { exact: true })).toBeVisible();
    await expect(
      provenance.getByText("Optional", { exact: true }),
    ).toBeVisible();
    await expect(
      provenance.getByText(
        "Explicit recovery from the selected protected source",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      provenance.getByText("c".repeat(64), { exact: true }),
    ).not.toBeVisible();
    await expect(
      provenance.getByText("d".repeat(64), { exact: true }),
    ).not.toBeVisible();
    await expect(
      provenance.getByRole("button", {
        name: "Review saved source attempt 1 for amy",
        exact: true,
      }),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath(`attempt-useful-details-${width}.png`),
      fullPage: true,
    });
    await provenance.getByText("Technical details", { exact: true }).click();
    await expect(
      provenance.getByText("c".repeat(64), { exact: true }),
    ).toBeVisible();
    await expect(provenance).toContainText("Saved work · beta · Attempt 1");
    await expect(provenance).toContainText("files recorded protected");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`attempt-provenance-${width}.png`),
      fullPage: true,
    });
    await provenance
      .getByRole("button", {
        name: "View settings for amy attempt 2",
        exact: true,
      })
      .click({ timeout: 5000 });
    await expect(grants).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await grants
      .getByRole("button", { name: "Close", exact: true })
      .click({ timeout: 5000 });
    await amy
      .getByRole("button", { name: "Review", exact: true })
      .first()
      .click({ timeout: 5000 });
    await provenance
      .getByText("Starting files and settings", { exact: true })
      .click();
    await provenance
      .getByRole("button", {
        name: "Review saved source attempt 1 for amy",
        exact: true,
      })
      .click({ timeout: 5000 });
    await expect(page.getByLabel("Selected exam", { exact: true })).toHaveValue(
      "beta",
    );
    const source = page.getByRole("dialog", {
      name: "amy · Attempt 1",
      exact: true,
    });
    await expect(
      source.getByText("Earlier attempt · saved settings unavailable", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      source.locator(
        ".attempt-grant-summary details, details.attempt-grant-summary",
      ),
    ).toHaveCount(0);
    await expect(source.locator(".grant-provenance")).toHaveCount(0);
  });
test("saved attempt settings show exact short durations without exposing technical references", async ({
  page,
}) => {
  const state = await fixture(page, false, true);
  state.rows[0].attempts[0].grantContext.settings.duration = 95;
  await page
    .getByRole("rowgroup", { name: "amy", exact: true })
    .getByRole("button", { name: "Review", exact: true })
    .first()
    .click();
  const provenance = page.getByRole("dialog").locator(".grant-provenance");
  await provenance
    .getByText("Starting files and settings", { exact: true })
    .click();
  await expect(
    provenance.getByText("1 min 35 sec", { exact: true }),
  ).toBeVisible();
  await expect(
    provenance.getByText("c".repeat(64), { exact: true }),
  ).not.toBeVisible();
  await expect(
    provenance.getByText("22222222-2222-4222-8222-222222222222", {
      exact: true,
    }),
  ).not.toBeVisible();
});
test("ordinary timing and date controls keep technical references out of the useful view", async ({
  page,
}) => {
  const state = await fixture(page, false, true);
  await page
    .getByRole("button", { name: "Exam settings", exact: true })
    .click();
  const settings = page.getByRole("dialog");
  await expect(settings.getByLabel("Opens", { exact: true })).toHaveAttribute(
    "type",
    "datetime-local",
  );
  await expect(settings.getByLabel("Closes", { exact: true })).toHaveAttribute(
    "type",
    "datetime-local",
  );
  await expect(
    settings.getByLabel("Time limit (minutes)", { exact: true }),
  ).toHaveAttribute("type", "number");
  const fileDetails = settings.locator("details").filter({
    has: page.locator("summary").filter({ hasText: /^Technical details$/ }),
  });
  await expect(fileDetails).toHaveCount(1);
  await expect(fileDetails.locator("p")).not.toBeVisible();
  await fileDetails.locator("summary").click();
  await expect(fileDetails.locator("p")).toContainText("a".repeat(64));
  await settings.getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .getByRole("rowgroup", { name: "amy", exact: true })
    .getByRole("button", { name: "Review", exact: true })
    .first()
    .click();
  const review = page.getByRole("dialog");
  await review.getByText("Timing details", { exact: true }).click();
  await expect(review.locator(".review-attempt-id")).not.toBeVisible();
  const timing = review.locator(".review-timing-details");
  await timing.getByText("Technical details", { exact: true }).click();
  await expect(review.locator(".review-attempt-id")).toBeVisible();
  expect(state.calls).toEqual([]);
});
test("unavailable source history stays inspectable without offering a misleading source link", async ({
  page,
}) => {
  const state = await fixture(page, false, true);
  const applied = state.rows[0].attempts[0].grantContext;
  applied.source_attempt = {
    id: applied.work.attempt,
    available_in_gateway: false,
  };
  await page.reload();
  await page.getByLabel("Selected exam", { exact: true }).selectOption("alpha");
  await page
    .getByRole("rowgroup", { name: "amy", exact: true })
    .getByRole("button", { name: "Review", exact: true })
    .first()
    .click({ timeout: 5000 });
  const provenance = page.getByRole("dialog").locator(".grant-provenance");
  await provenance
    .getByText("Starting files and settings", { exact: true })
    .click();
  await expect(provenance).toContainText("Source history is unavailable");
  await expect(provenance).toContainText(
    "An administrator must check the saved files",
  );
  await provenance.getByText("Technical details", { exact: true }).click();
  await expect(provenance).toContainText(applied.work.attempt);
  await expect(
    provenance.getByRole("button", { name: /Review saved source/ }),
  ).toHaveCount(0);
  await expect(
    provenance.getByRole("button", {
      name: "View settings for amy attempt 2",
      exact: true,
    }),
  ).toBeVisible();
});
for (const width of [1280, 430])
  test(`compact roster preserves all attempts and fits a ${width}px window`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await fixture(page, true);
    await expect(page.locator(".attempt-row")).toHaveCount(25);
    await expect(page.locator(".student-row")).toHaveCount(25);
    await expect(page.getByRole("checkbox")).toHaveCount(26);
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
    await expect(
      page.getByRole("checkbox", {
        name: "Select all students on this page",
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
test("student selection names excluded students and changes only eligible current clocks", async ({
  page,
}) => {
  const s = await fixture(page);
  await expect(
    page.getByRole("region", { name: "Bulk selection" }),
  ).toHaveCount(0);
  await page
    .getByRole("checkbox", {
      name: "Select all students on this page",
      exact: true,
    })
    .check();
  await expect(
    page.getByRole("region", { name: "Bulk selection" }),
  ).toContainText("5 students selected");
  await page
    .getByRole("button", { name: "Selected students", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Add time", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add time", exact: true });
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(dialog.getByRole("list")).toContainText("amy");
  await expect(dialog.getByRole("list")).toContainText("bob");
  await expect(dialog).toContainText(
    "Time will not change for: carol, dave, eve.",
  );
  await dialog.getByLabel("Minutes to add", { exact: true }).fill("10");
  await dialog.getByRole("button", { name: "Add time", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(s.calls).toHaveLength(1);
  expect(s.calls[0].body.action).toBe("extend");
  expect(s.calls[0].body.minutes).toBe(10);
  expect(s.calls[0].body.targets.map((t: any) => t.id)).toEqual([
    s.rows[0].attempts[0].id,
    s.rows[1].attempts[0].id,
  ]);
  await page
    .getByRole("checkbox", { name: "Select student amy", exact: true })
    .check();
  await page
    .getByRole("button", { name: "Selected students", exact: true })
    .click();
  await expect(
    page.getByRole("menuitem", { name: "Add time", exact: true }),
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
    page.getByRole("menuitem", { name: "Allowed attempts…", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(
    page.getByRole("menuitem", { name: "Remove from exam…", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(
    page.getByRole("menuitem", { name: "Allowed attempts…", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(page.getByRole("menu")).toHaveCount(0);
  await trigger.click();
  await page
    .getByRole("menuitem", { name: "Remove from exam…", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", {
      name: "Remove amy from this exam?",
      exact: true,
    }),
  ).toBeVisible();
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
test("row menus ignore queued scroll at the same anchor but dismiss after actual movement", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await fixture(page, true);
  await page
    .getByRole("button", { name: "Actions for student amy", exact: true })
    .click({ timeout: 5000 });
  const menu = page.getByRole("menu", {
    name: "Actions for student amy",
    exact: true,
  });
  await expect(menu).toBeVisible();
  await page.evaluate(() => dispatchEvent(new Event("scroll")));
  await expect(menu).toBeVisible();
  await expect(
    menu.getByRole("menuitem", { name: "Allowed attempts…", exact: true }),
  ).toBeFocused();
  const previous = await page.evaluate(() => scrollY);
  await page.evaluate(() => scrollBy(0, 100));
  await expect.poll(() => page.evaluate(() => scrollY)).not.toBe(previous);
  await expect(menu).toHaveCount(0);
});

test("retained instructor authorization preserves the original page and SSH rather than requesting replacement authentication", async ({
  page,
}) => {
  await fixture(page, false, false, true);
  await page
    .getByRole("rowgroup", { name: "bob", exact: true })
    .getByRole("button", { name: "Review", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "bob · Attempt 1",
    exact: true,
  });
  await dialog
    .getByRole("button", { name: "Allow resume", exact: true })
    .click();
  await expect(dialog).toContainText("on the same page and connection");
  await expect(dialog).toContainText("A lost session needs another attempt");
  const approval = dialog.getByRole("group", {
    name: "Confirm resume approval",
    exact: true,
  });
  await expect(approval.getByText(/Reviewed revision/)).not.toBeVisible();
  const technical = approval.getByText("Technical details", { exact: true });
  await expect(technical).toBeVisible();
  await technical.click({ timeout: 3000 });
  await expect(approval.getByText(/Reviewed revision/)).toBeVisible();
  await dialog
    .getByRole("textbox", { name: /^Reason/ })
    .fill("Reviewed same-page monitoring restoration");
  await dialog
    .getByRole("group", { name: "Confirm resume approval", exact: true })
    .getByRole("button", { name: "Allow resume", exact: true })
    .click();
  await expect(dialog).toContainText(
    "The student must restore the checks and choose Resume exam on the same page and connection",
  );
  await expect(dialog).not.toContainText("must reconnect");
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
    .getByRole("button", { name: "Allow resume", exact: true })
    .click();
  expect(s.calls).toHaveLength(0);
  await dialog
    .getByRole("textbox", { name: /^Reason/ })
    .fill("Reviewed monitoring interruption");
  await dialog
    .getByRole("group", { name: "Confirm resume approval", exact: true })
    .getByRole("button", { name: "Allow resume", exact: true })
    .click();
  await expect(dialog).toContainText("Resume allowed");
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
    dialog.getByRole("button", { name: "Allow resume", exact: true }),
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
  await expect(pending).toContainText("File protection is not confirmed");
  await expect(pending).not.toContainText("Files saved");
  await expect(pending.getByRole("link", { name: /Download/ })).toHaveCount(0);
});
for (const width of [1280, 430])
  test(`continuation confirmation preserves exact intent after a lost reply at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const s = await fixture(page);
    const bob = s.rows[1].attempts[0];
    await page
      .getByRole("rowgroup", { name: "bob", exact: true })
      .getByRole("button", { name: "Review", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "bob · Attempt 1",
      exact: true,
    });
    await dialog
      .getByRole("button", { name: "Allow resume", exact: true })
      .click();
    const reason = dialog.getByRole("textbox", {
      name: /^Reason/,
    });
    await expect(reason).toBeFocused();
    await reason.fill("Reviewed screen-sharing restoration");
    s.lostAuthorization = true;
    await dialog
      .getByRole("group", { name: "Confirm resume approval", exact: true })
      .getByRole("button", { name: "Allow resume", exact: true })
      .click();
    await expect(dialog.getByRole("alert")).toContainText(/fetch|network/i);
    expect(s.calls).toHaveLength(1);
    const original = s.calls[0].body;
    expect(original).toMatchObject({
      generation: 1,
      revision: 0,
      reason: "Reviewed screen-sharing restoration",
    });
    await page.waitForResponse(
      async (r) =>
        r.url().includes("/dashboard") &&
        (await r.json()).students?.some(
          (s: any) =>
            s.username === "bob" &&
            s.attempts[0].continuation_revision === bob.continuation_revision,
        ),
      { timeout: 10000 },
    );
    await expect(reason).toHaveValue(original.reason);
    if (width === 430)
      await page.screenshot({
        path: test.info().outputPath("interruption-confirmation-mobile.png"),
        fullPage: true,
      });
    await dialog
      .getByRole("group", { name: "Confirm resume approval", exact: true })
      .getByRole("button", { name: "Allow resume", exact: true })
      .click();
    await expect(dialog).toContainText("Resume allowed until");
    expect(s.calls[1].body).toEqual(original);
    expect(s.authorizationReplies.size).toBe(1);
    expect(bob.state).toBe("LOCKED");
  });

test("continuation confirmation cannot silently adopt a new generation or same-generation review revision", async ({
  page,
}) => {
  const s = await fixture(page);
  const bob = s.rows[1].attempts[0];
  await page
    .getByRole("rowgroup", { name: "bob", exact: true })
    .getByRole("button", { name: "Review", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "bob · Attempt 1",
    exact: true,
  });
  for (const changeGeneration of [false, true]) {
    await dialog
      .getByRole("button", { name: "Allow resume", exact: true })
      .click();
    const reason = dialog.getByRole("textbox", {
      name: /^Reason/,
    });
    await reason.fill("Reviewed original interruption");
    const selectedRevision = bob.continuation_revision;
    bob.continuation_revision++;
    if (changeGeneration) bob.generation++;
    await page.waitForResponse(
      async (r) =>
        r.url().includes("/dashboard") &&
        (await r.json()).students?.some(
          (s: any) =>
            s.username === "bob" &&
            s.attempts[0].continuation_revision === bob.continuation_revision,
        ),
      { timeout: 10000 },
    );
    await dialog
      .getByRole("group", { name: "Confirm resume approval", exact: true })
      .getByRole("button", { name: "Allow resume", exact: true })
      .click();
    await expect(dialog.getByRole("alert")).toContainText(
      "Interruption changed after review",
    );
    expect(s.calls.at(-1)!.body.revision).toBe(selectedRevision);
    expect(s.authorizationReplies.size).toBe(0);
    await expect(reason).toHaveValue("Reviewed original interruption");
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(
      dialog.getByRole("button", { name: "Allow resume", exact: true }),
    ).toBeFocused();
  }
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
  await dialog.getByRole("button", { name: "Retry", exact: true }).click();
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
  ).toContainText("Default: 120 min", { timeout: 15000 });
  s.slow = 0;
  s.failDashboard = true;
  await expect(page.getByRole("alert")).toContainText("Updates paused", {
    timeout: 15000,
  });
  await page
    .getByRole("button", { name: "Actions for amy attempt 2", exact: true })
    .click();
  await expect(
    page.getByRole("menuitem", { name: "Reset time remaining", exact: true }),
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
  await dialog.getByRole("button", { name: "Add time", exact: true }).click();
  await expect(dialog).toContainText("bob: Needs attention");
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

test("default reset keeps the displayed allowance fixed across background roster changes", async ({
  page,
}) => {
  const s = await fixture(page);
  await page
    .getByRole("rowgroup", { name: "amy", exact: true })
    .getByRole("button", { name: "Actions for amy attempt 2", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Reset time remaining", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Reset time remaining",
    exact: true,
  });
  await expect(dialog.locator(".admin-target-list")).toContainText("90 min");
  const updated = page.waitForResponse(
    async (response) => {
      if (
        !new URL(response.url()).pathname.endsWith("/alpha/dashboard") ||
        !response.ok()
      )
        return false;
      const body = await response.json();
      return body.students?.some(
        (row: any) =>
          row.username === "amy" && row.enrollment?.duration === 7200,
      );
    },
    { timeout: 10000 },
  );
  s.rows[0].enrollment.duration = 7200;
  await updated;
  let sent: any;
  await page.route(
    "**/api/admin/exams/alpha/attempts/clocks",
    async (route) => {
      sent = route.request().postDataJSON();
      return route.fulfill({
        json: {
          results: sent.targets.map((t: any) => ({
            id: t.id,
            status: t.expectedSeconds === 5400 ? "failed" : "pending",
            error:
              "Default allowance changed after review; close and review again",
          })),
        },
      });
    },
  );
  await dialog
    .getByRole("button", { name: "Apply reset", exact: true })
    .click();
  await expect(dialog).toContainText("Default allowance changed");
  expect(sent.targets[0].expectedSeconds).toBe(5400);
  await expect(dialog.locator(".admin-target-list")).toContainText("90 min");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
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
  await dialog.getByText("Recording retention", { exact: true }).click();
  await dialog
    .getByRole("button", { name: "Delete recordings…", exact: true })
    .click();
  await expect(
    dialog.getByRole("group", { name: "Confirm recording deletion" }),
  ).toContainText("amy, attempt 1");
  await dialog
    .getByRole("button", { name: "Cancel deletion", exact: true })
    .click();
  expect(s.calls).toHaveLength(0);
  await dialog
    .getByRole("button", { name: "Delete recordings…", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", {
      name: "Permanently delete monitoring",
      exact: true,
    }),
  ).toBeDisabled();
  await dialog.getByLabel("Reason").fill("Reviewed retention request");
  await dialog
    .getByRole("button", { name: "Permanently delete monitoring", exact: true })
    .click();
  await expect(
    dialog.getByRole("group", { name: "Confirm recording deletion" }),
  ).toHaveCount(0);
  expect(s.calls).toHaveLength(1);
  expect(s.calls[0].path).toContain("/delete-monitoring");
  expect(s.calls[0].body).toMatchObject({
    confirm: "amy",
    revision: "a".repeat(64),
    reason: "Reviewed retention request",
    requestID: expect.any(String),
  });
  await expect(dialog).toContainText("File deletion: retry");
  await expect(dialog).toContainText("access remains blocked");
  s.media.physicalPurge = { status: "verified-absent", verified: Date.now() };
  await expect(dialog).toContainText("File deletion: verified-absent", {
    timeout: 10000,
  });
  await expect(dialog).toContainText("backups have separate retention");
  await dialog.getByRole("button", { name: "Submission", exact: true }).click();
  await expect(dialog).toContainText("Files saved");
  await expect(dialog).toContainText("Saved files stay on the exam server");
});

for (const width of [1280, 390])
  test(`monitoring deletion keeps its reviewed intent after lost reply at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
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
    await dialog.getByText("Recording retention", { exact: true }).click();
    await dialog
      .getByRole("button", { name: "Delete recordings…", exact: true })
      .click();
    await dialog
      .getByLabel("Reason")
      .fill("Reviewed immutable deletion intent");
    s.lostDeletion = true;
    await dialog
      .getByRole("button", {
        name: "Permanently delete monitoring",
        exact: true,
      })
      .click();
    await expect(
      dialog.getByText("Retry repeats the same deletion request.", {
        exact: false,
      }),
    ).toBeVisible();
    await expect(dialog.getByRole("alert")).toBeVisible();
    await expect(dialog.getByLabel("Reason")).toBeDisabled();
    const original = s.calls[0].body;
    await dialog
      .getByRole("button", {
        name: "Permanently delete monitoring",
        exact: true,
      })
      .click();
    await expect(
      dialog.getByRole("group", { name: "Confirm recording deletion" }),
    ).toHaveCount(0);
    expect(s.calls).toHaveLength(2);
    expect(s.calls[1].body).toEqual(original);
    expect(s.deletionReplies.size).toBe(1);
    await expect(dialog).toContainText("File deletion: retry");
  });

test("monitoring deletion refuses a changed review without silently adopting it", async ({
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
  await dialog.getByText("Recording retention", { exact: true }).click();
  await dialog
    .getByRole("button", { name: "Delete recordings…", exact: true })
    .click();
  await dialog.getByLabel("Reason").fill("Reviewed original deletion target");
  s.monitoringRevision = "c".repeat(64);
  await dialog.getByRole("button", { name: "Refresh", exact: true }).click();
  await dialog
    .getByRole("button", { name: "Permanently delete monitoring", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("changed after review");
  expect(s.calls[0].body.revision).toBe("a".repeat(64));
  expect(s.media.monitoringDeleted).toBe(false);
  await dialog
    .getByRole("button", { name: "Cancel deletion", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Delete recordings…", exact: true })
    .click();
  await dialog.getByLabel("Reason").fill("Reviewed changed deletion target");
  await dialog
    .getByRole("button", { name: "Permanently delete monitoring", exact: true })
    .click();
  await expect(
    dialog.getByRole("group", { name: "Confirm recording deletion" }),
  ).toHaveCount(0);
  expect(s.calls[1].body.revision).toBe("c".repeat(64));
  expect(s.calls[1].body.requestID).not.toBe(s.calls[0].body.requestID);
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
  await expect(settings).toBeInViewport();
  await settings.click();
  const dialog = page.getByRole("dialog", {
    name: "Exam settings",
    exact: true,
  });
  await expect(dialog.getByLabel("Exam ID", { exact: true })).toBeDisabled();
  await expect(dialog.getByLabel("Name", { exact: true })).toBeFocused();
  await expect(
    dialog.getByRole("combobox", { name: "Exam files", exact: true }),
  ).toHaveValue(`sample-exam@${"a".repeat(64)}`);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(settings).toBeFocused();
});

test("open review updates images, activity and incremental replay without moving the selection", async ({
  page,
}) => {
  const s = await fixture(page);
  const pane = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  let captureIndex = 0;
  const capture = (id: string, source: string) => ({
    id,
    source,
    captured: Date.now() + captureIndex++ * 1000,
    received: Date.now(),
  });
  s.rows[0].attempts[0].settings = JSON.stringify({ webcam: true });
  s.media.frames.push(
    capture("screen-old", "screen"),
    capture("screen-current", "screen"),
    capture("webcam-old", "webcam"),
  );
  s.media.terminals.push({ pane });
  s.replayEvents.push(
    { at: Date.now(), event: "open" },
    {
      at: Date.now(),
      event: "output",
      data: Buffer.from("first output").toString("base64"),
    },
    {
      at: Date.now(),
      event: "output",
      data: Buffer.from("second output").toString("base64"),
    },
  );
  await page
    .getByRole("rowgroup", { name: "amy", exact: true })
    .getByRole("button", { name: "Review", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  const timeline = dialog.getByRole("slider", {
    name: "Screen timeline",
    exact: true,
  });
  const terminal = dialog.getByRole("combobox", {
    name: "Terminal replay",
    exact: true,
  });
  await expect(terminal).toHaveCount(0);
  expect(s.replayOffsets).toHaveLength(0);
  await timeline.fill("0");
  await dialog
    .getByRole("button", { name: "Open terminal replay", exact: true })
    .click();
  await terminal.selectOption(pane);
  const slider = dialog.locator(".admin-replay input[type=range]");
  await expect(slider).toHaveAttribute("max", "2");
  await slider.fill("1");
  const originalOffset = s.replayOffsets.length;
  await page.evaluate(() => {
    (window as any).reviewTerminal = document.querySelector(
      ".admin-replay .xterm",
    );
  });
  await dialog.getByRole("button", { name: /^Activity/ }).click();
  s.media.frames.push(
    capture("screen-new", "screen"),
    capture("webcam-new", "webcam"),
  );
  s.media.incidents.push({
    id: "second",
    opened: Date.now(),
    events: JSON.stringify([{ reason: "Network disconnected" }]),
    message: "New activity",
    review_at: null,
  });
  s.replayEvents.push({
    at: Date.now(),
    event: "output",
    data: Buffer.from("new output").toString("base64"),
  });
  await expect(dialog.getByRole("button", { name: /^Activity/ })).toHaveText(
    "Activity (2)",
    { timeout: 8000 },
  );
  await expect(
    dialog.getByRole("button", { name: /^Activity/ }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(dialog).toContainText("New activity");
  expect(s.replayOffsets).toHaveLength(originalOffset);
  await dialog.getByRole("button", { name: "Recordings", exact: true }).click();
  await expect
    .poll(() => s.replayOffsets.length)
    .toBeGreaterThan(originalOffset);
  expect(s.replayOffsets.slice(1).every((offset) => offset > 0)).toBe(true);
  await expect(dialog.getByAltText("Screen capture for amy")).toHaveAttribute(
    "src",
    "/api/admin/media/screen-old",
  );
  await expect(dialog.getByAltText("Webcam capture for amy")).toHaveAttribute(
    "src",
    "/api/admin/media/webcam-new",
  );
  await expect(timeline).toHaveValue("0");
  await expect(terminal).toHaveValue(pane);
  await expect(slider).toHaveAttribute("max", "3");
  await expect(slider).toHaveValue("1");
  expect(
    await page.evaluate(
      () =>
        (window as any).reviewTerminal ===
        document.querySelector(".admin-replay .xterm"),
    ),
  ).toBe(true);
  await dialog.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(timeline).toHaveValue("0");
  await expect(slider).toHaveValue("1");
  await dialog
    .getByRole("button", { name: "Live screen", exact: true })
    .click();
  await expect(dialog.getByAltText("Screen capture for amy")).toHaveAttribute(
    "src",
    "/api/admin/media/screen-new",
  );
  await expect(
    dialog.getByRole("button", { name: "Live screen", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await terminal.selectOption("");
  await terminal.selectOption(pane);
  await expect(slider).toHaveAttribute("max", "3");
  await expect(slider).toHaveValue("1");
});

test("automatic review refresh recovers after network failure and stops when closed", async ({
  page,
}) => {
  const s = await fixture(page);
  const pane = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  s.media.terminals.push({ pane });
  s.replayEvents.push(
    { at: Date.now(), event: "open" },
    { at: Date.now(), event: "output", data: "b2s=" },
  );
  await page
    .getByRole("rowgroup", { name: "amy", exact: true })
    .getByRole("button", { name: "Review", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "Open terminal replay", exact: true })
    .click();
  await dialog
    .getByRole("combobox", { name: "Terminal replay", exact: true })
    .selectOption(pane);
  await expect(dialog.getByRole("slider")).toHaveAttribute("max", "1");
  await dialog.getByRole("slider").fill("1");
  s.failReview = true;
  s.failReplay = true;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(dialog).toContainText("Monitoring unavailable");
  await expect(dialog).toContainText("Replay unavailable");
  await expect(dialog.getByRole("slider")).toHaveValue("1");
  s.failReview = false;
  s.failReplay = false;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect(dialog.getByRole("slider")).toHaveValue("1");
  await dialog.getByRole("button", { name: "Submission", exact: true }).click();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    dialog.getByRole("button", { name: "Submission", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  const calls = s.reviewCalls,
    replayCalls = s.replayOffsets.length;
  await page.waitForTimeout(5500);
  expect(s.reviewCalls).toBe(calls);
  expect(s.replayOffsets).toHaveLength(replayCalls);
});

for (const ended of [false, true]) {
  test(`screenshots lead ${ended ? "completed" : "active"} review; replay opens on demand and preserves position when closed`, async ({
    page,
  }) => {
    const s = await fixture(page);
    const pane = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const a = s.rows[0].attempts[0];
    if (ended)
      Object.assign(a, {
        state: "COMPLETED",
        ended: Date.now(),
        protected: 1,
        working: false,
      });
    s.media.frames.push({
      id: "screen",
      source: "screen",
      captured: Date.now(),
      received: Date.now(),
    });
    s.media.terminals.push({ pane });
    s.replayEvents.push(
      { at: Date.now(), event: "open" },
      { at: Date.now(), event: "output", data: "b2s=" },
    );
    await page
      .getByRole("rowgroup", { name: "amy", exact: true })
      .getByRole("button", { name: "Review", exact: true })
      .first()
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByAltText("Screen capture for amy")).toBeVisible();
    await expect(
      dialog.getByRole("combobox", { name: "Terminal replay", exact: true }),
    ).toHaveCount(0);
    expect(s.replayOffsets).toHaveLength(0);
    await dialog.getByRole("button", { name: "Refresh", exact: true }).click();
    expect(s.replayOffsets).toHaveLength(0);
    await dialog
      .getByRole("button", { name: "Open terminal replay", exact: true })
      .click();
    await dialog
      .getByRole("combobox", { name: "Terminal replay", exact: true })
      .selectOption(pane);
    const slider = dialog.locator(".admin-replay input[type=range]");
    await expect(slider).toHaveAttribute("max", "1");
    await slider.fill("1");
    await dialog
      .getByRole("button", { name: "Close terminal replay", exact: true })
      .click();
    await expect(slider).toHaveCount(0);
    const reads = s.replayOffsets.length;
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await page.waitForTimeout(200);
    expect(s.replayOffsets).toHaveLength(reads);
    await dialog
      .getByRole("button", { name: "Open terminal replay", exact: true })
      .click();
    await expect(slider).toHaveAttribute("max", "1");
    await expect(slider).toHaveValue("1");
    await expect(dialog.getByAltText("Screen capture for amy")).toBeVisible();
  });
}

test("slow review polling does not overlap and closing cancels an outstanding refresh", async ({
  page,
}) => {
  const s = await fixture(page);
  let release!: () => void;
  s.reviewDelay = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page
    .getByRole("rowgroup", { name: "amy", exact: true })
    .getByRole("button", { name: "Review", exact: true })
    .first()
    .click();
  await expect.poll(() => s.reviewCalls).toBe(1);
  await page.waitForTimeout(5500);
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("online"));
  });
  expect(s.reviewCalls).toBe(1);
  await page.keyboard.press("Escape");
  release();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page
    .getByRole("rowgroup", { name: "bob", exact: true })
    .getByRole("button", { name: "Review", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "bob · Attempt 1", exact: true }),
  ).toContainText("No screen images received");
});

for (const width of [1280, 430])
  test(`table settings edit in place, preserve attempts and show start times at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    const s = await fixture(page);
    const amy = page.getByRole("rowgroup", { name: "amy", exact: true });
    const duration = amy.getByRole("button", {
      name: "Edit future time limit for amy",
      exact: true,
    });
    await expect(duration).toHaveText("Default: 90 min");
    await expect(
      amy.getByRole("button", {
        name: "Edit future webcam setting for amy",
        exact: true,
      }),
    ).toHaveText("Webcam default: Optional");
    const started = amy.locator(".attempt-row time").first();
    await expect(started).toHaveAttribute(
      "datetime",
      new Date(s.rows[0].attempts[0].start).toISOString(),
    );
    await expect(started).toContainText("Started");
    await expect(started).toContainText(
      String(new Date(s.rows[0].attempts[0].start).getUTCFullYear()),
    );
    await expect(started).toContainText(/C[DS]T/);
    await expect(page.locator("main")).not.toContainText(/\bfuture\b/i);
    await duration.focus();
    await duration.press("Enter");
    let editor = amy.getByRole("form", {
      name: "Edit future time limit for amy",
      exact: true,
    });
    await expect(
      editor.getByRole("checkbox", { name: /Exam default/ }),
    ).toBeFocused();
    await expect(editor).toContainText("older unused recovery attempts");
    await expect(editor).toContainText("Changing exam defaults does not");
    await editor.getByRole("checkbox", { name: /Exam default/ }).uncheck();
    await editor.getByLabel("Minutes", { exact: true }).fill("123");
    await page.keyboard.press("Escape");
    await expect(duration).toBeFocused();
    expect(s.calls).toHaveLength(0);
    await duration.click();
    editor = amy.getByRole("form", {
      name: "Edit future time limit for amy",
      exact: true,
    });
    await editor.getByRole("checkbox", { name: /Exam default/ }).uncheck();
    await editor.getByLabel("Minutes", { exact: true }).fill("120");
    await page.screenshot({
      path: info.outputPath(`inline-editor-${width}.png`),
      fullPage: true,
    });
    await editor.getByLabel("Minutes", { exact: true }).press("Enter");
    await expect(duration).toHaveText("Default: 120 min");
    expect(s.calls[0].body).toEqual({ usernames: ["amy"], duration: 7200 });
    await amy
      .getByRole("button", {
        name: "Edit future webcam setting for amy",
        exact: true,
      })
      .click();
    let webcam = amy.getByRole("form", {
      name: "Edit future webcam setting for amy",
      exact: true,
    });
    await webcam
      .getByRole("combobox", { name: "Webcam", exact: true })
      .selectOption("true");
    await webcam.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      amy.getByRole("button", {
        name: "Edit future webcam setting for amy",
        exact: true,
      }),
    ).toHaveText("Webcam default: Required");
    expect(s.calls[1].body).toEqual({ usernames: ["amy"], webcam: true });
    await expect(
      amy.locator('.attempt-row [data-label="Webcam"]').first(),
    ).toHaveText("Optional");
    expect(s.rows[0].attempts[0].settings).toBe(
      JSON.stringify({ webcam: false }),
    );
    expect(
      s.calls.every((call) => call.path.endsWith("/roster/settings")),
    ).toBe(true);
    await duration.click();
    editor = amy.getByRole("form", {
      name: "Edit future time limit for amy",
      exact: true,
    });
    await editor.getByRole("checkbox", { name: /Exam default/ }).check();
    await editor.getByRole("button", { name: "Save", exact: true }).click();
    await expect(duration).toHaveText("Default: 90 min");
    expect(s.calls[2].body).toEqual({ usernames: ["amy"], duration: null });
    await amy
      .getByRole("button", {
        name: "Edit future webcam setting for amy",
        exact: true,
      })
      .click();
    webcam = amy.getByRole("form", {
      name: "Edit future webcam setting for amy",
      exact: true,
    });
    await webcam
      .getByRole("combobox", { name: "Webcam", exact: true })
      .selectOption("inherit");
    await webcam.getByRole("button", { name: "Save", exact: true }).click();
    await expect(
      amy.getByRole("button", {
        name: "Edit future webcam setting for amy",
        exact: true,
      }),
    ).toHaveText("Webcam default: Optional");
    expect(s.calls[3].body).toEqual({ usernames: ["amy"], webcam: null });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`inline-settings-${width}.png`),
      fullPage: true,
    });
  });

test("inline setting failures preserve edits for retry and cancellation", async ({
  page,
}) => {
  const s = await fixture(page);
  const amy = page.getByRole("rowgroup", { name: "amy", exact: true });
  const duration = amy.getByRole("button", {
    name: "Edit future time limit for amy",
    exact: true,
  });
  await duration.click();
  const editor = amy.getByRole("form", {
    name: "Edit future time limit for amy",
    exact: true,
  });
  await editor.getByRole("checkbox", { name: /Exam default/ }).uncheck();
  await editor.getByLabel("Minutes", { exact: true }).fill("125");
  s.failSettings = true;
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor.getByRole("alert")).toContainText(
    "Settings could not be saved",
  );
  await expect(editor.getByLabel("Minutes", { exact: true })).toHaveValue(
    "125",
  );
  s.failSettings = false;
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(duration).toHaveText("Default: 125 min");
  await duration.click();
  await editor.getByLabel("Minutes", { exact: true }).fill("140");
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(duration).toHaveText("Default: 125 min");
  await expect(duration).toBeFocused();
  expect(s.calls).toHaveLength(2);
});

for (const width of [1280, 430])
  test(`admin time displays use readable units at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    const s = await fixture(page);
    const now = Date.now();
    const attempt = s.rows[0].attempts[0];
    attempt.deadline = now + 5400000;
    attempt.settings = JSON.stringify({ webcam: true, duration: 5400 });
    s.media.frames.push(
      {
        id: "old-screen",
        source: "screen",
        captured: now - 3661000,
        received: now,
      },
      {
        id: "old-camera",
        source: "webcam",
        captured: now - 125000,
        received: now,
      },
    );
    (s.media as any).manifest = {
      checksum: "fixture-checksum",
      attempt: { settings: { duration: 5400 } },
    };
    await page
      .getByLabel("Selected exam", { exact: true })
      .selectOption("beta");
    await page
      .getByLabel("Selected exam", { exact: true })
      .selectOption("alpha");
    const student = page.getByRole("rowgroup", { name: "amy", exact: true });
    await expect(student.locator(".attempt-clock time").first()).toHaveText(
      /^(1:30:00|1:29:\d\d)$/,
    );
    await student
      .getByRole("button", { name: "Review", exact: true })
      .first()
      .click();
    const dialog = page.getByRole("dialog");
    await expect(
      dialog.locator(".review-images figcaption").first(),
    ).toContainText(/1h 1min(?: \d+s)? ago/);
    await expect(
      dialog.locator(".review-images figcaption").nth(1),
    ).toContainText(/2min \d+s ago/);
    await expect(dialog.locator(".review-clock")).toContainText(/1:29:\d\d/);
    await dialog
      .getByRole("button", { name: "Submission", exact: true })
      .click();
    await dialog.getByText("Timing details", { exact: true }).click();
    await expect(
      dialog
        .getByText("Time limit", { exact: true })
        .locator("..")
        .locator("dd"),
    ).toHaveText("1h 30min");
    await dialog.getByText("Technical file details", { exact: true }).click();
    await expect(dialog.locator("pre")).not.toBeVisible();
    await page.screenshot({
      path: info.outputPath(`time-review-${width}.png`),
      fullPage: true,
    });
    await dialog.getByText("Technical manifest", { exact: true }).click();
    await expect(dialog.locator("pre")).toBeVisible();
    await expect(dialog).toContainText(
      "remaining_seconds and extend_seconds are in seconds",
    );
    await dialog
      .getByRole("button", { name: "Close review", exact: true })
      .click();
    await student
      .getByRole("button", { name: "Actions for amy attempt 2", exact: true })
      .click();
    await page
      .getByRole("menuitem", { name: "Reset time remaining", exact: true })
      .click();
    const clock = page.getByRole("dialog").locator(".admin-target-list");
    const before = await clock.innerText();
    await expect.poll(() => clock.innerText()).not.toBe(before);
    await expect(clock).toContainText(/1:29:\d\d remaining/);
  });

test("capture sliders are independent, keyboard accessible, and stop following when the student pauses", async ({
  page,
}, info) => {
  const s = await fixture(page);
  const a = s.rows[0].attempts[0],
    now = Date.now();
  a.settings = JSON.stringify({ webcam: true, duration: 5400 });
  a.preflight_started_at = now - 180000;
  s.media.frames.push(
    ...["screen", "webcam"].flatMap((source) =>
      [0, 1, 2].map((i) => ({
        id: `${source}-${i}`,
        source,
        captured: now - (2 - i) * 15000,
        received: now - (2 - i) * 15000,
      })),
    ),
  );
  await page
    .getByRole("rowgroup", { name: "amy", exact: true })
    .getByRole("button", { name: "Review", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  const screen = dialog.getByRole("slider", {
    name: "Screen timeline",
    exact: true,
  });
  const webcam = dialog.getByRole("slider", {
    name: "Webcam timeline",
    exact: true,
  });
  await expect(screen).toHaveValue("2");
  await screen.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(screen).toHaveValue("1");
  await expect(dialog.getByAltText("Screen capture for amy")).toHaveAttribute(
    "src",
    "/api/admin/media/screen-1",
  );
  await expect(webcam).toHaveValue("2");
  await expect(
    dialog.getByRole("button", { name: "Live screen", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await expect(
    dialog.getByRole("button", { name: "Live webcam", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(screen).toHaveAttribute("aria-valuetext", /CDT/);
  await page.screenshot({
    path: info.outputPath("capture-sliders-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.screenshot({
    path: info.outputPath("capture-sliders-mobile.png"),
    fullPage: true,
  });
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  a.state = "LOCKED";
  a.working = false;
  a.connected = false;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    dialog.getByRole("button", { name: "Live webcam", exact: true }),
  ).toHaveCount(0);
  s.media.frames.push({
    id: "webcam-late",
    source: "webcam",
    captured: now + 1000,
    received: now + 1000,
  });
  await dialog.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(dialog.getByAltText("Webcam capture for amy")).toHaveAttribute(
    "src",
    "/api/admin/media/webcam-2",
  );
  await expect(screen).toHaveValue("1");
  a.state = "ACTIVE";
  a.working = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    dialog.getByRole("button", { name: "Live webcam", exact: true }),
  ).toHaveAttribute("aria-pressed", "false");
  await dialog
    .getByRole("button", { name: "Live webcam", exact: true })
    .click();
  await expect(dialog.getByAltText("Webcam capture for amy")).toHaveAttribute(
    "src",
    "/api/admin/media/webcam-late",
  );
});

test("review shows preflight, finished duration, access failures, clock changes and omission reasons in plain language", async ({
  page,
}) => {
  const s = await fixture(page),
    a = s.rows[0].attempts[0];
  a.state = "COMPLETED";
  a.working = false;
  a.connected = false;
  a.protected = 1;
  a.start = Date.UTC(2026, 9, 19, 15);
  a.preflight_started_at = a.start - 120000;
  a.ended = a.start + 2400000;
  a.deadline = a.start + 5400000;
  a.original_deadline = a.deadline;
  a.clock_revision = 1;
  a.clock_resets = JSON.stringify([
    {
      id: "reset",
      actor: "instructor",
      requested_at: a.start + 60000,
      applied_at: a.start + 61000,
      remaining_seconds: 3600,
      deadline: a.deadline,
    },
  ]);
  a.access_error = "Writer remains active";
  (s.media as any).manifest = {
    files: [{ path: "answer.c" }],
    omissions: [".#answer.c: symbolic link omitted"],
  };
  await page.getByLabel("Selected exam", { exact: true }).selectOption("beta");
  await page.getByLabel("Selected exam", { exact: true }).selectOption("alpha");
  const group = page.getByRole("rowgroup", { name: "amy", exact: true });
  await expect(group).toContainText("40min used");
  await expect(group).toContainText("Ended Oct 19, 2026");
  await group
    .getByRole("button", { name: "Review", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByText("Setup started", { exact: true }).locator(".."),
  ).toContainText("9:58:00 AM CDT");
  await expect(
    dialog.getByText("Exam ended", { exact: true }).locator(".."),
  ).toContainText("10:40:00 AM CDT");
  await expect(
    dialog.getByText("Time used", { exact: true }).locator(".."),
  ).toContainText("40min");
  await expect(dialog.getByRole("alert")).toContainText(
    "Writer remains active",
  );
  await dialog.getByText("Timing details", { exact: true }).click();
  await expect(
    dialog.getByText("Setup time", { exact: true }).locator(".."),
  ).toContainText("2min");
  await expect(dialog.getByLabel("Time-change history")).toContainText(
    "Reset to 1h",
  );
  await expect(dialog.getByLabel("Time-change history")).toContainText(
    "instructor",
  );
  await dialog.getByRole("button", { name: "Submission", exact: true }).click();
  await expect(dialog).toContainText("1 file collected · 1 entry omitted");
  await dialog.getByText("Omitted entries", { exact: true }).click();
  await expect(dialog).toContainText(".#answer.c: symbolic link omitted");
  await expect(
    dialog.getByRole("button", { name: "Live screen", exact: true }),
  ).toHaveCount(0);
  a.ended = null; // A historical end can be missing; never keep it ticking.
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    dialog.getByText("Time used", { exact: true }).locator(".."),
  ).toContainText("Not recorded");
});

for (const width of [1280, 390])
  test(`attempt interruption disclosures preserve history and authorization detail at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    const s = await fixture(page),
      a = s.rows[0].attempts[0],
      now = Date.now();
    a.state = "LOCKED";
    a.working = false;
    a.reason = "Screen sharing ended";
    a.interruptions = [
      {
        id: "pause1",
        opened: now - 180000,
        ended: now - 60000,
        outcome: "resumed",
        generation: 1,
        events: [
          {
            at: now - 180000,
            reason: "Focus did not return within 20 seconds",
          },
        ],
        authorizations: [
          {
            at: now - 100000,
            actor: "teacher",
            expires: now + 10000,
            generation: 1,
            used_at: now - 60000,
          },
        ],
      },
      {
        id: "pause2",
        opened: now - 10000,
        ended: null,
        outcome: null,
        generation: 2,
        events: [
          { at: now - 10000, reason: "Screen sharing ended" },
          { at: now - 9000, reason: "SSH disconnected" },
        ],
        authorizations: [
          {
            at: now - 5000,
            actor: "teacher",
            expires: now + 60000,
            generation: 2,
          },
        ],
      },
    ];
    await page
      .getByLabel("Selected exam", { exact: true })
      .selectOption("beta");
    await page
      .getByLabel("Selected exam", { exact: true })
      .selectOption("alpha");
    const button = page.getByRole("button", {
      name: "Interruption history for amy attempt 2",
      exact: true,
    });
    await expect(button).toContainText("2 interruptions");
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await button.focus();
    await page.keyboard.press("Enter");
    const history = page.getByRole("region", {
      name: "Interruption history for amy attempt 2",
      exact: true,
    });
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await expect(history).toContainText("2min · Resumed");
    await expect(history).toContainText("Used to resume");
    await expect(history).toContainText("Awaiting resume");
    await expect(history).toContainText("Screen sharing ended");
    await expect(history).toContainText("SSH disconnected");
    await expect(history).toContainText("Allowed by teacher");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`interruptions-${width}.png`),
      fullPage: true,
    });
    // Observe the real five-second poll. A synthetic focus event has no
    // refresh handler; a five-second assertion deadline races that same timer.
    const refreshed = page.waitForResponse(
      async (response) => {
        if (
          !new URL(response.url()).pathname.endsWith("/alpha/dashboard") ||
          !response.ok()
        )
          return false;
        const body = await response.json();
        return body.students?.some((row: any) =>
          row.attempts?.some(
            (entry: any) =>
              entry.id === a.id &&
              entry.interruptions?.[1]?.outcome === "resumed",
          ),
        );
      },
      { timeout: 10000 },
    );
    a.interruptions[1].ended = now + 1000;
    a.interruptions[1].outcome = "resumed";
    a.interruptions[1].authorizations[0].used_at = now + 1000;
    a.state = "ACTIVE";
    a.working = true;
    await refreshed;
    await expect(history).not.toContainText("Awaiting resume");
    await expect(history).toContainText("11s · Resumed");
    await expect(button).toHaveAttribute("aria-expanded", "true");
    await button.click();
    await expect(history).toHaveCount(0);
    await expect(button).toBeFocused();
  });
