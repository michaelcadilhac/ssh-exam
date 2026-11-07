import { isChallengedCapture, captureMetadata } from "./capture-requests.js";
import { instructorSignIn } from "./prof-workflow-fixture.js";
import { test, expect } from "@playwright/test";
import { simulatedMedia } from "./transition-fixture.js";
import {
  additionalDraft,
  previewAdditional,
  editNextField,
  cancelNext,
  chooseSavedSource,
} from "./prof-workflow-fixture.js";

async function admin(
  page: import("@playwright/test").Page,
  actor: Parameters<typeof instructorSignIn>[1] = "prof_additional",
) {
  await instructorSignIn(page, actor);
  await page.getByLabel("Selected exam").selectOption("additional-template");
}
test("individual additional settings are reviewed per student without changing shared defaults or issuing on preview", async ({
  page,
}, info) => {
  page.setDefaultTimeout(8000);
  await page.setViewportSize({ width: 430, height: 1000 });
  await admin(page, "prof_additional_review");
  const dialog = await additionalDraft(page, ["extra01", "extra02"]);
  await dialog
    .getByText("Individual time and webcam settings", { exact: true })
    .click();
  await expect(
    dialog
      .getByRole("combobox", { name: "Webcam for extra02", exact: true })
      .getByRole("option", { name: "Off", exact: true }),
  ).toHaveCount(1);
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
  await expect(
    dialog.getByRole("article").filter({
      has: page.getByRole("heading", { name: "extra02", exact: true }),
    }),
  ).toContainText("Webcam off");
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

test("a next attempt can be cancelled, recreated and edited before starting with its exact settings", async ({
  page,
}, testInfo) => {
  test.setTimeout(90000);
  page.setDefaultTimeout(10000);
  await page.setViewportSize({ width: 430, height: 1000 });
  expect(
    (await (await page.request.get("/api/login-test")).json()).browserSSH,
  ).toBe(true);
  await simulatedMedia(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 320;
        canvas.height = 240;
        const context = canvas.getContext("2d")!;
        const draw = () => {
          context.fillStyle = "#8ddab9";
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.fillStyle = "#132033";
          context.fillText("Synthetic webcam", 20, 40);
        };
        draw();
        setInterval(draw, 100);
        return canvas.captureStream(10);
      },
    });
  });
  let verifiedWebcamUploads = 0;
  page.on("response", (response) => {
    if (
      isChallengedCapture(response.url()) &&
      response.status() === 200 &&
      captureMetadata(response.request())?.source === "webcam"
    )
      verifiedWebcamUploads++;
  });
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
  await expect(dialog).toContainText("90 min · Webcam required");
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
    .getByRole("button", { name: "Add next attempt", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Retry same request", exact: true }),
  ).toBeEnabled();
  await page.reload();
  await page.getByLabel("Selected exam").selectOption("additional-template");
  await page
    .getByRole("button", { name: "Resume saved request (1)", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Attempt allowed", exact: true }),
  ).toBeVisible();
  expect(lost).toBe(1);
  const receipt = await (
      await page.request.get(`/api/admin/grant-issuance/${reviewID}`)
    ).json(),
    ninety = receipt.issued[0].grant;
  const prior = await (
    await page.request.get(`/api/admin/grants/${ninety}`)
  ).json();
  expect(prior.settings.duration).toBe(5400);
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await page.unroute(`**/api/admin/grant-issuance/${reviewID}/confirm`);
  await cancelNext(page, "extra01");
  dialog = await additionalDraft(page, ["extra01"], "75");
  const { review: replacementReview } = await previewAdditional(page, dialog);
  expect(replacementReview.rows[0].replaces).toEqual([]);
  await expect(dialog).not.toContainText("Replaces 1 unused attempt.");
  const replacementReply = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname ===
        `/api/admin/grant-issuance/${replacementReview.id}/confirm` &&
      response.request().method() === "POST",
  );
  await dialog
    .getByRole("button", { name: "Add next attempt", exact: true })
    .click();
  await expect(
    dialog.getByRole("heading", { name: "Attempt allowed", exact: true }),
  ).toBeVisible();
  const replacementResponse = await replacementReply;
  expect(replacementResponse.status()).toBe(200);
  expect(replacementResponse.request().postDataJSON().replacement_policy).toBe(
    "single-unused-v1",
  );
  const replacementReceipt = await replacementResponse.json();
  expect(replacementReceipt.issued[0].replaced).toEqual([]);
  await expect(dialog).not.toContainText("Replaced 1 unused attempt.");
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  const records = (
    await (
      await page.request.get(
        "/api/admin/exams/additional-template/grants?username=extra01",
      )
    ).json()
  ).grants;
  expect(records).toHaveLength(2);
  const other = records.find((g: any) => g.id !== ninety);
  expect(records.find((g: any) => g.id === ninety)).toMatchObject({
    status: "REVOKED",
    claims: [],
    settings: { duration: 5400 },
  });
  expect(
    records
      .filter((g: any) => ["AVAILABLE", "PENDING_NATIVE"].includes(g.status))
      .map((g: any) => g.id),
  ).toEqual([other.id]);
  expect(other.work.kind).toBe("empty");
  const timeEditor = await editNextField(page, "extra01", "time limit");
  await timeEditor.fill("60");
  await timeEditor.press("Enter");
  await expect(timeEditor).toHaveCount(0);
  const grants = await editNextField(page, "extra01", "starting files");
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
  ).toBe(3600);
  await page.unroute("**/api/admin/exams/additional-template/grants/change");
  await grants
    .getByRole("button", { name: "Back to editing", exact: true })
    .click();
  await grants
    .getByRole("button", { name: "Review changes", exact: true })
    .click();
  await grants
    .getByRole("button", { name: "Apply changes", exact: true })
    .click();
  await expect(grants).toHaveCount(0);
  const revised = await (
    await page.request.get(`/api/admin/grants/${other.id}`)
  ).json();
  expect(revised).toMatchObject({
    settings: { duration: 3600 },
    work: { kind: "template", name: "sample-exam", hash: "a".repeat(64) },
  });
  await expect(
    page.getByRole("button", {
      name: "Change time limit for extra01",
      exact: true,
    }),
  ).toHaveText("60 min");
  await page.screenshot({
    path: testInfo.outputPath("additional-grants-management-430.png"),
    fullPage: true,
  });
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
  expect(summary.grants.map((grant: any) => grant.id)).toEqual([other.id]);
  expect(summary.selected_grant).toBe(other.id);
  expect(summary.attempt).toBeNull();
  await expect(
    page.getByRole("combobox", { name: "Choose an attempt", exact: true }),
  ).toHaveCount(0);
  const open = page.getByRole("button", {
    name: "Check setup and practice",
    exact: true,
  });
  await expect(page.getByText(/start window/i)).toHaveCount(0);
  await expect(open).toBeEnabled();
  await expect(page.locator("main")).toContainText("60 min · Webcam: Required");
  const session = await (await page.request.get("/api/session")).json(),
    runtimeBefore = await (
      await page.request.get("/api/fixture/runtime")
    ).json();
  const stale = await page.request.post("/api/student/preflight", {
    headers: {
      Origin: new URL(page.url()).origin,
      "X-CSRF-Token": session.csrf,
    },
    data: { grant: ninety },
  });
  expect(stale.status()).toBe(409);
  expect(await stale.json()).toMatchObject({ code: "ATTEMPT_UNAVAILABLE" });
  const afterStale = await (await page.request.get("/api/student/exam")).json(),
    runtimeAfter = await (
      await page.request.get("/api/fixture/runtime")
    ).json();
  expect(afterStale.attempt).toBeNull();
  expect(afterStale.selected_grant).toBe(other.id);
  expect(runtimeAfter.nativeBeginRequests).toEqual(
    runtimeBefore.nativeBeginRequests,
  );
  expect(runtimeAfter.terminalOpens).toBe(runtimeBefore.terminalOpens);
  expect(runtimeAfter.panes).toEqual(runtimeBefore.panes);
  await open.click();
  await expect(
    page.getByRole("button", { name: "Practice terminal", exact: true }),
  ).toBeEnabled();
  const beforeSummary = await (
      await page.request.get("/api/student/exam")
    ).json(),
    before = beforeSummary.attempt;
  expect(before).toMatchObject({
    state: "PREPARING",
    start: null,
    deadline: null,
    grant_id: other.id,
    grant_kind: "ADDITIONAL",
    grant_revision: revised.revision,
    grant_hash: revised.hash,
  });
  // The native binding omits work when it exactly matches the saved starter
  // snapshot. NULL here is canonical, not an absent initializer.
  expect(before.grant_work).toBeNull();
  expect(JSON.parse(before.settings)).toEqual(revised.settings);
  expect(beforeSummary.settings).toEqual(revised.settings);
  expect(revised.work).toEqual({
    kind: "template",
    name: "sample-exam",
    hash: revised.settings.template_version,
  });
  expect(revised.settings.template).toBe("sample-exam");
  expect(revised.settings.template_version).toBe("a".repeat(64));
  await page
    .getByRole("button", { name: "1. Share entire screen", exact: true })
    .click();
  await page
    .getByRole("button", { name: "2. Enable webcam", exact: true })
    .click();
  await expect(page.locator("#camera-preview")).toBeVisible();
  await page
    .getByRole("button", { name: "3. Enter fullscreen", exact: true })
    .click();
  await page
    .getByRole("button", { name: "4. Lock keyboard", exact: true })
    .click();
  await expect
    .poll(() => verifiedWebcamUploads, { timeout: 10000 })
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: "Start exam", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Start exam", exact: true })
    .click();
  await expect(page.locator(".winbox")).toHaveCount(1);
  const active = (await (await page.request.get("/api/student/exam")).json())
    .attempt;
  expect(active).toMatchObject({ state: "ACTIVE", grant_id: other.id });
  expect(active.deadline - active.start).toBe(3600000);
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
  const finished = (await dashboard()).students.find(
      (s: any) => s.username === "extra01",
    ).attempts,
    completed = finished.find((a: any) => a.id === active.id),
    kept = finished.find((a: any) => a.id === original.id);
  expect(completed.state).toBe("COMPLETED");
  expect(completed.protected === true || completed.protected === 1).toBe(true);
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
  await admin(page, "prof_additional_saved");
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
    .getByRole("button", { name: "Add next attempt", exact: true })
    .click();
  await expect(dialog).toContainText("Preparing saved work");
  await expect(dialog).not.toContainText("sudo examctl");
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
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
  await expect(
    page.getByRole("table", { name: "Students and attempts" }),
  ).toContainText("Preparing saved work");
  await cancelNext(page, "extra01");
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
  await admin(page, "prof_additional_bulk");
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
    ).toContainText("90 min · Webcam required");
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
    .getByRole("button", { name: "Add next attempts", exact: true })
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
      settings: { duration: 5400, webcam: true },
      claims: [],
    });
  }
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await cancelNext(page, "extra02");
  const retained = await page.request.get(
    `/api/admin/grants/${receipt.issued.find((g: any) => g.username === "extra01").grant}`,
  );
  expect(retained.status(), await retained.text()).toBe(200);
  expect((await retained.json()).status).toBe("PENDING_NATIVE");
  expect(await histories()).toEqual(original);
});
