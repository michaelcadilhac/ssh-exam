import { test, expect, type Page } from "@playwright/test";
import {
  additionalDraft,
  previewAdditional,
  selectedAction,
} from "./prof-workflow-fixture.js";

const oldID = "11111111-1111-4111-8111-111111111111";
const newID = "22222222-2222-4222-8222-222222222222";
const reviewID = "33333333-3333-4333-8333-333333333333";
const oldRef = { id: oldID, revision: 2, hash: "c".repeat(64) };

async function studentPortal(
  page: Page,
  duplicate = false,
  absent = false,
  pending = false,
) {
  page.setDefaultTimeout(6000);
  const now = Date.now(),
    exam = {
      id: "single-unused",
      name: "Midterm",
      duration: 5400,
      webcam: false,
      terminals: 4,
      earliest: now - 60000,
      latest: now + 3600000,
    };
  const grant = (id: string) => ({
    id,
    issuance: "ADDITIONAL_TEMPLATE",
    issued_at: now,
    settings: { ...exam, duration: id === newID ? 4500 : 5400 },
    work:
      id === newID || pending
        ? { kind: "saved", attempt: reviewID, checksum: "d".repeat(64) }
        : { kind: "template", name: "midterm-starter" },
  });
  let replacement = false,
    preparing = pending;
  const reads: string[] = [],
    preparations: any[] = [];
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "keyboard", {
      configurable: true,
      value: { lock: async () => {}, unlock() {} },
    });
    Object.defineProperty(navigator.mediaDevices, "getDisplayMedia", {
      configurable: true,
      value: async () => {
        throw Error("Capture is not used by this summary test");
      },
    });
  });
  await page.route("**/api/session", (route) =>
    route.fulfill({
      json: {
        role: "student",
        username: "synthetic",
        exam: exam.id,
        csrf: "fixture",
      },
    }),
  );
  await page.route("**/api/login-test", (route) =>
    route.fulfill({ json: { loginOnly: false } }),
  );
  await page.route("**/api/student/exam*", (route) => {
    const url = new URL(route.request().url());
    reads.push(url.pathname + url.search);
    const assigned = absent ? null : grant(replacement ? newID : oldID),
      grants = assigned
        ? duplicate
          ? [assigned, grant(newID)]
          : [assigned]
        : [];
    return route.fulfill({
      json: {
        exam,
        enrollment: { duration: null, webcam: null, uid: 10001 },
        settings: assigned?.settings ?? exam,
        attempt: null,
        grants,
        selected_grant: assigned?.id ?? null,
        sshConnected: true,
        ...(preparing
          ? {
              attempt_blocked: {
                status: "PENDING_NATIVE",
                message:
                  "Your starting files are being prepared. Check again shortly.",
              },
            }
          : {}),
      },
    });
  });
  await page.route("**/api/student/preflight", (route) => {
    preparations.push(route.request().postDataJSON());
    replacement = true;
    return route.fulfill({
      status: 409,
      json: {
        code: "ATTEMPT_UNAVAILABLE",
        error: "Your attempt has changed. Check it again before opening setup.",
      },
    });
  });
  return { reads, preparations, ready: () => (preparing = false) };
}

async function instructorPortal(
  page: Page,
  legacyReceipt = false,
  missingContract = false,
) {
  page.setDefaultTimeout(6000);
  const now = Date.now(),
    exam = {
      id: "single-unused",
      name: "Midterm",
      template: "midterm-starter",
      template_version: "a".repeat(64),
      revision: "b".repeat(64),
      duration: 5400,
      webcam: false,
      terminals: 4,
      earliest: now - 60000,
      latest: now + 3600000,
    };
  let review: any = null;
  const confirmations: any[] = [];
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/session")
      return route.fulfill({
        json: { role: "admin", username: "instructor", csrf: "fixture" },
      });
    if (path === "/api/login-test")
      return route.fulfill({ json: { loginOnly: false } });
    if (path === "/api/admin/exams") return route.fulfill({ json: [exam] });
    if (path.endsWith("/dashboard"))
      return route.fulfill({
        json: {
          serverNow: now,
          students: [
            {
              username: "synthetic",
              enrollment: { duration: null, webcam: null },
              attempts: [],
            },
          ],
          total: 1,
          counts: { students: 1 },
          incidents: [],
        },
      });
    if (path.endsWith("/attempts"))
      return route.fulfill({ json: { attempts: [], scanned: 0, next: null } });
    if (path.endsWith("/grant-reviews"))
      return route.fulfill({
        json: {
          agent: "class",
          exam: exam.id,
          actor: "instructor",
          rows: [],
          next: null,
        },
      });
    if (path.endsWith("/additional-preview")) {
      const body = route.request().postDataJSON();
      review = {
        id: reviewID,
        exam: exam.id,
        actor: "instructor",
        kind: "NEW_ADDITIONAL_TEMPLATE_GRANTS",
        status: legacyReceipt ? "CONFIRMED" : "REVIEW",
        revision: "e".repeat(64),
        reason: body.reason,
        created: now,
        expires: now + 900000,
        rows: [
          {
            username: "synthetic",
            settings: {
              ...exam,
              earliest: body.earliest,
              latest: body.latest,
            },
            work: { kind: "empty" },
            existing_grants: 1,
            ...(legacyReceipt || missingContract ? {} : { replaces: [oldRef] }),
          },
        ],
        issued: legacyReceipt ? [{ username: "synthetic", grant: newID }] : [],
      };
      return route.fulfill({ json: review });
    }
    if (path === `/api/admin/grant-issuance/${reviewID}/confirm`) {
      confirmations.push(route.request().postDataJSON());
      review.status = "CONFIRMED";
      review.issued = [
        { username: "synthetic", grant: newID, replaced: [oldRef] },
      ];
      return route.fulfill({ json: review });
    }
    if (path === `/api/admin/grant-issuance/${reviewID}`)
      return route.fulfill({ json: review });
    if (path.endsWith("/source-setup"))
      return route.fulfill({
        json: {
          id: reviewID,
          rows: [
            {
              id: newID,
              username: "synthetic",
              revision: 1,
              current_revision: 1,
              grant_status: "AVAILABLE",
              status: "READY",
              grant: {
                id: newID,
                revision: 1,
                status: "AVAILABLE",
                claims: [],
              },
            },
          ],
        },
      });
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto("/admin");
  await page.getByLabel("Selected exam").selectOption(exam.id);
  return {
    confirmations,
    confirmExisting: () => {
      review.status = "CONFIRMED";
      review.issued = [{ username: "synthetic", grant: newID }];
    },
  };
}

async function saveUnknownConfirmation(page: Page, body: any) {
  await page.evaluate(
    ({ id, body }) => {
      sessionStorage.setItem(
        `exam-admin-review:${JSON.stringify([
          "instructor",
          "single-unused",
          "NEW_ADDITIONAL_TEMPLATE_GRANTS",
          ["synthetic"],
        ])}`,
        JSON.stringify({
          review: id,
          pending: {
            operation: "confirm",
            path: `/admin/grant-issuance/${id}/confirm`,
            body,
          },
        }),
      );
    },
    { id: reviewID, body },
  );
}

async function reopenReview(page: Page) {
  await page.reload();
  await page.getByLabel("Selected exam").selectOption("single-unused");
  return selectedAction(page, ["synthetic"], "Allow another attempt");
}

for (const width of [1280, 430]) {
  test(`students have one assigned summary and no attempt chooser at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const f = await studentPortal(page, true);
    await page.goto("/");
    await expect(
      page.getByText("Starter files: midterm-starter"),
    ).toBeVisible();
    await expect(
      page.getByRole("combobox", { name: "Choose an attempt" }),
    ).toHaveCount(0);
    await expect(page.locator("main")).not.toContainText(
      /Choose an attempt|Created/,
    );
    await expect(
      page.getByRole("button", {
        name: "Check setup and practice",
        exact: true,
      }),
    ).toBeEnabled();
    expect(f.preparations).toHaveLength(0);
    expect(f.reads).toEqual(["/api/student/exam"]);
    await page.screenshot({
      path: info.outputPath(`assigned-attempt-${width}.png`),
    });
  });

  test(`replacement review and receipt are explicit without another dialog at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    const f = await instructorPortal(page);
    const dialog = await additionalDraft(page, ["synthetic"]);
    await expect(dialog).toContainText(
      "A new attempt replaces any unused attempt for this exam.",
    );
    const { review } = await previewAdditional(page, dialog);
    expect(review.rows[0].replaces).toEqual([oldRef]);
    await expect(
      dialog.getByText("Replaces 1 unused attempt.", { exact: true }),
    ).toBeVisible();
    await expect(dialog).not.toContainText("earlier unused attempt remains");
    expect(f.confirmations).toHaveLength(0);
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await page.screenshot({
      path: info.outputPath(`replacement-review-${width}.png`),
    });
    await dialog
      .getByRole("button", { name: "Allow attempt", exact: true })
      .click();
    await expect(
      dialog.getByText("Replaced 1 unused attempt.", { exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByText("Replaces 1 unused attempt.", { exact: true }),
    ).toHaveCount(0);
    expect(f.confirmations).toHaveLength(1);
    expect(f.confirmations[0].replacement_policy).toBe("single-unused-v1");
    await expect(dialog.getByText(oldID, { exact: false })).not.toBeVisible();
    await page.screenshot({
      path: info.outputPath(`replacement-result-${width}.png`),
    });
  });
}

test("stale assigned settings refresh without a selected ID and keep exact preparation guards", async ({
  page,
}) => {
  const f = await studentPortal(page);
  await page.goto("/");
  const setup = page.getByRole("button", {
    name: "Check setup and practice",
    exact: true,
  });
  await expect(setup).toBeEnabled();
  await setup.click();
  await expect(page.getByRole("alert")).toContainText(
    "Your attempt has changed.",
  );
  await expect(setup).toBeDisabled();
  await expect(page.getByText("Starter files: midterm-starter")).toHaveCount(0);
  await page.getByRole("button", { name: "Check again", exact: true }).click();
  await expect(
    page.getByText("Starting files: Saved work", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("main")).toContainText("75 min · Webcam: Optional");
  await expect(setup).toBeEnabled();
  expect(f.reads).toEqual(["/api/student/exam", "/api/student/exam"]);
  expect(f.preparations).toEqual([{ grant: oldID }]);
  await setup.click();
  await expect
    .poll(() => f.preparations)
    .toEqual([{ grant: oldID }, { grant: newID }]);
});

test("no assigned attempt cannot open setup or display fallback settings", async ({
  page,
}) => {
  const f = await studentPortal(page, false, true);
  await page.goto("/");
  await expect(page.getByRole("status")).toContainText(
    "No attempt is available. Ask your instructor.",
  );
  await expect(
    page.getByRole("button", { name: "Check setup and practice", exact: true }),
  ).toBeDisabled();
  await expect(page.locator("main")).not.toContainText("90 min");
  await page.getByRole("button", { name: "Check again", exact: true }).click();
  expect(f.reads).toEqual(["/api/student/exam", "/api/student/exam"]);
  expect(f.preparations).toHaveLength(0);
});

test("a pending saved-file attempt shows its real settings and cannot open setup until ready", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 430, height: 900 });
  const f = await studentPortal(page, false, false, true);
  await page.goto("/");
  await expect(page.getByRole("status")).toContainText(
    "Your starting files are being prepared. Check again shortly.",
  );
  await expect(
    page.getByText("Starting files: Saved work", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("main")).toContainText("90 min · Webcam: Optional");
  await expect(page.locator("main")).not.toContainText(
    "No attempt is available",
  );
  const setup = page.getByRole("button", {
    name: "Check setup and practice",
    exact: true,
  });
  await expect(setup).toBeDisabled();
  await page.screenshot({
    path: info.outputPath("pending-assigned-attempt-430.png"),
  });
  const stillPending = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/student/exam" &&
      response.request().method() === "GET",
  );
  await page.getByRole("button", { name: "Check again", exact: true }).click();
  expect((await (await stillPending).json()).attempt_blocked.status).toBe(
    "PENDING_NATIVE",
  );
  await expect(page.getByRole("status")).toContainText(
    "Your starting files are being prepared. Check again shortly.",
  );
  await expect(setup).toBeDisabled();
  f.ready();
  await page.getByRole("button", { name: "Check again", exact: true }).click();
  await expect(setup).toBeEnabled();
  await expect(page.getByRole("status")).toHaveCount(0);
  expect(f.reads).toEqual([
    "/api/student/exam",
    "/api/student/exam",
    "/api/student/exam",
  ]);
  expect(f.preparations).toHaveLength(0);
});

test("historical confirmed reviews do not invent a replacement receipt from the old count", async ({
  page,
}) => {
  await instructorPortal(page, true);
  const dialog = await additionalDraft(page, ["synthetic"]);
  await previewAdditional(page, dialog);
  await expect(
    dialog.getByRole("heading", { name: "Attempt allowed", exact: true }),
  ).toBeVisible();
  await expect(dialog).not.toContainText(
    /Replaced|Replaces|earlier unused attempt remains/,
  );
});

test("a review without an authoritative replacement snapshot cannot be confirmed", async ({
  page,
}) => {
  const f = await instructorPortal(page, false, true);
  const dialog = await additionalDraft(page, ["synthetic"]);
  await previewAdditional(page, dialog);
  await expect(
    dialog.getByRole("button", { name: "Allow attempt", exact: true }),
  ).toBeDisabled();
  await expect(dialog).toContainText(/review again/i);
  expect(f.confirmations).toHaveLength(0);
});

test("a previously saved current-policy confirmation retries its exact request body", async ({
  page,
}) => {
  const f = await instructorPortal(page);
  const dialog = await additionalDraft(page, ["synthetic"]);
  await previewAdditional(page, dialog);
  const original = {
    revision: "e".repeat(64),
    request: "44444444-4444-4444-8444-444444444444",
    replacement_policy: "single-unused-v1",
  };
  await saveUnknownConfirmation(page, original);
  const restored = await reopenReview(page);
  await restored
    .getByRole("button", { name: "Retry same request", exact: true })
    .click();
  await expect(
    restored.getByRole("heading", { name: "Attempt allowed", exact: true }),
  ).toBeVisible();
  expect(f.confirmations).toEqual([original]);
});

test("an unconfirmed legacy request cannot be replayed to an older gateway", async ({
  page,
}) => {
  const f = await instructorPortal(page, false, true);
  const dialog = await additionalDraft(page, ["synthetic"]);
  await previewAdditional(page, dialog);
  const original = {
    revision: "e".repeat(64),
    request: "44444444-4444-4444-8444-444444444444",
  };
  await saveUnknownConfirmation(page, original);
  const restored = await reopenReview(page);
  await expect(
    restored.getByRole("button", { name: "Retry same request", exact: true }),
  ).toBeDisabled();
  await expect(
    restored
      .getByRole("status")
      .filter({ hasText: "The earlier result is unconfirmed." }),
  ).toContainText("The earlier result is unconfirmed.");
  await expect(
    restored.getByRole("button", {
      name: "Edit and review again",
      exact: true,
    }),
  ).toBeEnabled();
  expect(f.confirmations).toHaveLength(0);
  const savedBodies = await page.evaluate(() =>
    Object.keys(sessionStorage)
      .filter((key) => key.startsWith("exam-admin-review:"))
      .map((key) => JSON.parse(sessionStorage.getItem(key)!).pending?.body),
  );
  expect(savedBodies).toEqual([original]);
});

test("a legacy unknown outcome is resolved only by its actual confirmed receipt", async ({
  page,
}) => {
  const f = await instructorPortal(page, false, true);
  const dialog = await additionalDraft(page, ["synthetic"]);
  await previewAdditional(page, dialog);
  await saveUnknownConfirmation(page, {
    revision: "e".repeat(64),
    request: "44444444-4444-4444-8444-444444444444",
  });
  f.confirmExisting();
  const restored = await reopenReview(page);
  await expect(
    restored.getByRole("heading", { name: "Attempt allowed", exact: true }),
  ).toBeVisible();
  await expect(
    restored.getByRole("button", { name: "Retry same request", exact: true }),
  ).toHaveCount(0);
  await expect(restored).not.toContainText(/Replaced|Replaces|unconfirmed/);
  expect(f.confirmations).toHaveLength(0);
});
