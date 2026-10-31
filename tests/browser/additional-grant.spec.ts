import { instructorSignIn } from "./prof-workflow-fixture.js";
import { test, expect } from "@playwright/test";
import { simulatedMedia, ready } from "./transition-fixture.js";
import {
  additionalDraft,
  previewAdditional,
  manageStudent,
  cancelUnused,
  selectedAction,
  chooseSavedSource,
} from "./prof-workflow-fixture.js";

async function admin(page: import("@playwright/test").Page) {
  await instructorSignIn(page, "prof_additional");
  await page.getByLabel("Selected exam").selectOption("additional-template");
}
test("individual additional settings are reviewed per student without changing shared defaults or issuing on preview", async ({
  page,
}, info) => {
  page.setDefaultTimeout(8000);
  await page.setViewportSize({ width: 430, height: 1000 });
  await admin(page);
  const dialog = await additionalDraft(page, ["extra01", "extra02"]);
  await dialog
    .getByText("Individual time and webcam settings", { exact: true })
    .click();
  for (const [username, minutes, webcam] of [
    ["extra01", "100", "required"],
    ["extra02", "120", "optional"],
  ]) {
    await dialog
      .getByLabel(`Time limit for ${username} (minutes)`, { exact: true })
      .fill(minutes);
    await dialog
      .getByRole("combobox", { name: `Webcam for ${username}`, exact: true })
      .selectOption(webcam);
  }
  const { reply, review } = await previewAdditional(page, dialog);
  expect(reply.request().postDataJSON().student_settings).toEqual([
    { username: "extra01", duration: 6000, webcam: true },
    { username: "extra02", duration: 7200, webcam: false },
  ]);
  expect(review.issued).toHaveLength(0);
  for (const [username, time] of [
    ["extra01", "100 min"],
    ["extra02", "120 min"],
  ])
    await expect(
      dialog.getByRole("article").filter({
        has: page.getByRole("heading", { name: username, exact: true }),
      }),
    ).toContainText(time);
  await page.screenshot({
    path: info.outputPath("individual-settings-review.png"),
    fullPage: true,
  });
  await dialog
    .getByRole("button", { name: "Cancel request", exact: true })
    .click();
  await expect(
    dialog.getByRole("heading", { name: "Request cancelled", exact: true }),
  ).toBeVisible();
});

test("additional grants outside expired defaults support reviewed recovery, multiple-grant management and explicit student selection through fresh Begin", async ({
  page,
}, testInfo) => {
  test.setTimeout(90000);
  page.setDefaultTimeout(10000);
  await page.setViewportSize({ width: 430, height: 1000 });
  expect(
    (await (await page.request.get("/api/login-test")).json()).browserSSH,
  ).toBe(true);
  await simulatedMedia(page);
  await admin(page);
  const dashboard = async () =>
    (
      await page.request.get("/api/admin/exams/additional-template/dashboard")
    ).json();
  const original = (await dashboard()).students.find(
    (s: any) => s.username === "extra01",
  ).attempts[0];
  expect(original).toMatchObject({
    id: "aaaaaaaa-1234-4234-8234-123456789abc",
    state: "COMPLETED",
    start: expect.any(Number),
    deadline: expect.any(Number),
  });
  expect(original.deadline - original.start).toBe(5400000);
  let dialog = await additionalDraft(page, ["extra01"]);
  const { review } = await previewAdditional(page, dialog),
    reviewID = review.id;
  await expect(dialog).toContainText("90 min · Webcam optional");
  await expect(dialog).toContainText("Empty folder");
  let lost = 0;
  await page.route(
    `**/api/admin/grant-issuance/${reviewID}/confirm`,
    async (route) => {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      lost++;
      await route.abort("failed");
    },
  );
  await dialog
    .getByRole("button", { name: "Allow attempt", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Retry same request", exact: true }),
  ).toBeEnabled();
  await page.reload();
  await page.getByLabel("Selected exam").selectOption("additional-template");
  dialog = await selectedAction(page, ["extra01"], "Allow another attempt");
  await expect(
    dialog.getByRole("heading", { name: "Attempt allowed", exact: true }),
  ).toBeVisible();
  expect(lost).toBe(1);
  const receipt = await (
      await page.request.get(`/api/admin/grant-issuance/${reviewID}`)
    ).json(),
    ninety = receipt.issued[0].grant;
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.unroute(`**/api/admin/grant-issuance/${reviewID}/confirm`);
  dialog = await additionalDraft(page, ["extra01"], "75");
  await previewAdditional(page, dialog);
  await dialog
    .getByRole("button", { name: "Allow attempt", exact: true })
    .click();
  await expect(
    dialog.getByRole("heading", { name: "Attempt allowed", exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  const records = (
    await (
      await page.request.get(
        "/api/admin/exams/additional-template/grants?username=extra01",
      )
    ).json()
  ).grants;
  expect(records).toHaveLength(2);
  const other = records.find((g: any) => g.id !== ninety);
  const grants = await manageStudent(page, "extra01");
  const otherRow = grants.getByRole("article").filter({ hasText: other.id });
  await otherRow.getByRole("checkbox").check();
  await grants.getByLabel("Time limit (minutes)", { exact: true }).fill("60");
  await grants
    .getByRole("combobox", { name: "Starting files", exact: true })
    .selectOption("template");
  await grants
    .getByRole("combobox", { name: "Starter files", exact: true })
    .selectOption(`sample-exam@${"a".repeat(64)}`);
  // Simulate a catalog selection losing its native attestation before save.
  // The real gateway, not the browser locator, must refuse the exact pair.
  await page.route(
    "**/api/admin/exams/additional-template/grants/change",
    async (route) => {
      const body = route.request().postDataJSON();
      body.rows[0].body.work.name = "v1";
      const response = await route.fetch({ postData: body });
      await route.fulfill({ response });
    },
  );
  await grants
    .getByRole("button", { name: "Review changes", exact: true })
    .click();
  await grants
    .getByRole("button", { name: "Apply changes", exact: true })
    .click();
  await expect(grants.getByText("Not changed", { exact: true })).toBeVisible();
  expect(
    (await (await page.request.get(`/api/admin/grants/${other.id}`)).json())
      .settings.duration,
  ).toBe(4500);
  await page.unroute("**/api/admin/exams/additional-template/grants/change");
  await grants
    .getByRole("button", { name: "Edit remaining changes", exact: true })
    .click();
  await grants
    .getByRole("button", { name: "Review changes", exact: true })
    .click();
  await grants
    .getByRole("button", { name: "Apply changes", exact: true })
    .click();
  await expect(
    grants.getByText("Settings saved", { exact: true }),
  ).toBeVisible();
  expect(
    await (await page.request.get(`/api/admin/grants/${other.id}`)).json(),
  ).toMatchObject({
    settings: { duration: 3600 },
    work: { kind: "template", name: "sample-exam", hash: "a".repeat(64) },
  });
  expect(
    await grants.evaluate(
      (el) => el.getBoundingClientRect().right <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("additional-grants-management-430.png"),
    fullPage: true,
  });
  await grants.getByRole("button", { name: "Close", exact: true }).click();
  await page
    .getByRole("button", { name: "Administration", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
  await page.goto("/");
  await page.getByLabel("Exam ID", { exact: true }).fill("additional-template");
  await page.getByLabel("Username").fill("extra01");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByLabel("Password", { exact: true }).fill("shared-password");
  // SSH authentication, HTTP session completion and destination loading are
  // separate stages. Bound the actual summary response before asserting its
  // controls; the default five-second visibility wait is not a sign-in bound.
  const summaryReady = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/student/exam",
    { timeout: 15000 },
  );
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  const summaryResponse = await summaryReady;
  expect(summaryResponse.status()).toBe(200);
  const summary = await summaryResponse.json();
  expect(summary.grants.map((grant: any) => grant.id).sort()).toEqual(
    [ninety, other.id].sort(),
  );
  await expect(
    page.getByRole("combobox", { name: "Choose an attempt", exact: true }),
  ).toBeVisible();
  const open = page.getByRole("button", {
    name: "Check setup and practice",
    exact: true,
  });
  await expect(open).toBeDisabled();
  await page
    .getByRole("combobox", { name: "Choose an attempt", exact: true })
    .selectOption(ninety);
  await expect(open).toBeEnabled();
  await expect(page.locator("main")).toContainText("90 min · Webcam: Optional");
  await open.click();
  await expect(
    page.getByRole("button", { name: "Practice terminal", exact: true }),
  ).toBeEnabled();
  const before = (await (await page.request.get("/api/student/exam")).json())
    .attempt;
  expect(before).toMatchObject({
    state: "PREPARING",
    start: null,
    deadline: null,
    grant_id: ninety,
    grant_kind: "ADDITIONAL",
    grant_work: '{"kind":"empty"}',
  });
  await ready(page);
  await page.getByRole("button", { name: "Start exam", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Start exam", exact: true })
    .click();
  await expect(page.locator(".winbox")).toHaveCount(1);
  const active = (await (await page.request.get("/api/student/exam")).json())
    .attempt;
  expect(active).toMatchObject({ state: "ACTIVE", grant_id: ninety });
  expect(active.deadline - active.start).toBe(5400000);
  expect(active.id).not.toBe(original.id);
  await page.getByRole("button", { name: "Finish exam", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Finish exam", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Sign in to your exam", exact: true }),
  ).toBeVisible();
  await admin(page);
  const kept = (await dashboard()).students
    .find((s: any) => s.username === "extra01")
    .attempts.find((a: any) => a.id === original.id);
  for (const key of [
    "id",
    "state",
    "start",
    "deadline",
    "original_deadline",
    "protected",
  ])
    expect(kept[key], key).toEqual(original[key]);
});

test("saved-work review stays pending without native confirmation and can be cancelled without changing protected history", async ({
  page,
}) => {
  test.setTimeout(45000);
  page.setDefaultTimeout(8000);
  await admin(page);
  const source = "aaaaaaaa-1234-4234-8234-123456789abc";
  const history = async () =>
    (
      await (
        await page.request.get("/api/admin/exams/additional-template/dashboard")
      ).json()
    ).students
      .find((s: any) => s.username === "extra01")
      .attempts.find((a: any) => a.id === source);
  const before = await history();
  expect(before.protected).toBeTruthy();
  const dialog = await additionalDraft(page, ["extra01"], "90", "latest");
  await chooseSavedSource(dialog, "extra01", source);
  const { review } = await previewAdditional(page, dialog);
  expect(review.rows[0].work).toMatchObject({
    kind: "saved",
    attempt: source,
    checksum: "b".repeat(64),
  });
  await dialog
    .getByRole("button", { name: "Allow attempt", exact: true })
    .click();
  await expect(dialog).toContainText("Preparing saved work");
  await expect(dialog).not.toContainText("sudo examctl");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  const saved = (
    await (
      await page.request.get(
        "/api/admin/exams/additional-template/grants?username=extra01",
      )
    ).json()
  ).grants.find(
    (g: any) => g.work.kind === "saved" && g.status === "PENDING_NATIVE",
  );
  expect(saved).toBeTruthy();
  expect(saved.claims).toHaveLength(0);
  const management = await manageStudent(page, "extra01");
  await management
    .getByRole("article")
    .filter({ hasText: saved.id })
    .getByRole("checkbox")
    .check();
  await expect(management).toContainText("Preparing saved work");
  await cancelUnused(management);
  expect(
    (await (await page.request.get(`/api/admin/grants/${saved.id}`)).json())
      .status,
  ).toBe("REVOKED");
  expect(await history()).toEqual(before);
});

test("bulk saved work requires each student's own source and preserves the exact review through correction and a lost confirmation", async ({
  page,
}, info) => {
  test.setTimeout(60000);
  page.setDefaultTimeout(8000);
  await page.setViewportSize({ width: 430, height: 1000 });
  await admin(page);
  const sources = [
    {
      username: "extra01",
      attempt: "aaaaaaaa-1234-4234-8234-123456789abc",
      checksum: "b".repeat(64),
    },
    {
      username: "extra02",
      attempt: "bbbbbbbb-1234-4234-8234-123456789abc",
      checksum: "c".repeat(64),
    },
  ];
  const histories = async () => {
    const d = await (
      await page.request.get("/api/admin/exams/additional-template/dashboard")
    ).json();
    return sources.map((s) =>
      d.students
        .find((u: any) => u.username === s.username)
        .attempts.find((a: any) => a.id === s.attempt),
    );
  };
  const original = await histories();
  const dialog = await additionalDraft(
    page,
    ["extra01", "extra02"],
    "90",
    "latest",
  );
  for (const source of sources)
    await chooseSavedSource(dialog, source.username, source.attempt);
  // Retrieved metadata cannot allow the wrong owner's archive to be issued.
  await page.route(
    "**/api/admin/exams/additional-template/grants/additional-preview",
    async (route) => {
      const body = route.request().postDataJSON();
      body.work_sources[1].work = { ...body.work_sources[0].work };
      const response = await route.fetch({ postData: body });
      expect(response.status()).toBe(409);
      await route.fulfill({ response });
    },
  );
  await dialog.getByRole("button", { name: "Review", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(
    dialog.getByLabel("Time limit (minutes)", { exact: true }),
  ).toBeEnabled();
  await page.unroute(
    "**/api/admin/exams/additional-template/grants/additional-preview",
  );
  const { review } = await previewAdditional(page, dialog),
    reviewID = review.id;
  for (const [i, source] of sources.entries()) {
    expect(review.rows[i].work).toMatchObject({
      kind: "saved",
      attempt: source.attempt,
      checksum: source.checksum,
    });
    await expect(
      dialog.getByRole("article").filter({
        has: page.getByRole("heading", {
          name: source.username,
          exact: true,
        }),
      }),
    ).toContainText(`90 min · Webcam ${i ? "required" : "optional"}`);
  }
  await page.screenshot({
    path: info.outputPath("bulk-saved-source-review-430.png"),
    fullPage: true,
  });
  let lost = 0;
  await page.route(
    `**/api/admin/grant-issuance/${reviewID}/confirm`,
    async (route) => {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      lost++;
      await route.abort("failed");
    },
  );
  await dialog
    .getByRole("button", { name: "Allow attempts", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Retry same request", exact: true }),
  ).toBeEnabled();
  await page.unroute(`**/api/admin/grant-issuance/${reviewID}/confirm`);
  await dialog
    .getByRole("button", { name: "Retry same request", exact: true })
    .click();
  await expect(
    dialog.getByRole("heading", { name: "Attempts allowed", exact: true }),
  ).toBeVisible();
  expect(lost).toBe(1);
  const receipt = await (
    await page.request.get(`/api/admin/grant-issuance/${reviewID}`)
  ).json();
  expect(receipt.issued).toHaveLength(2);
  for (const [i, source] of sources.entries()) {
    const id = receipt.issued.find(
      (g: any) => g.username === source.username,
    ).grant;
    expect(
      await (await page.request.get(`/api/admin/grants/${id}`)).json(),
    ).toMatchObject({
      status: "PENDING_NATIVE",
      work: {
        kind: "saved",
        attempt: source.attempt,
        checksum: source.checksum,
      },
      settings: { duration: 5400, webcam: !!i },
      claims: [],
    });
  }
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  const management = await manageStudent(page, "extra02"),
    secondID = receipt.issued.find((g: any) => g.username === "extra02").grant;
  await management
    .getByRole("article")
    .filter({ hasText: secondID })
    .getByRole("checkbox")
    .check();
  await cancelUnused(management);
  expect(
    (
      await (
        await page.request.get(
          `/api/admin/grants/${receipt.issued.find((g: any) => g.username === "extra01").grant}`,
        )
      ).json()
    ).status,
  ).toBe("PENDING_NATIVE");
  expect(await histories()).toEqual(original);
});
