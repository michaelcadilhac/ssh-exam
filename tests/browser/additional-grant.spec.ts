import { test, expect } from "@playwright/test";
import { simulatedMedia, ready } from "./transition-fixture.js";

test("individual additional settings are reviewed per student without changing shared defaults or issuing on preview", async ({
  page,
}, testInfo) => {
  test.setTimeout(30000);
  page.setDefaultTimeout(8000);
  await page.setViewportSize({ width: 430, height: 1000 });
  await page.goto("/admin");
  await page.getByLabel("Username", { exact: true }).fill("instructor");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByLabel("Selected exam").selectOption("additional-template");
  await page
    .getByRole("button", { name: "Authorize additional attempts", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Authorize additional attempts",
    exact: true,
  });
  await dialog
    .getByLabel("Additional attempt students", { exact: true })
    .fill("extra01 extra02");
  await dialog
    .getByRole("combobox", { name: "Workspace initialization", exact: true })
    .selectOption("empty");
  await dialog
    .getByLabel("Additional allowance seconds", { exact: true })
    .fill("5400");
  await dialog
    .getByLabel("Set individual student settings", { exact: true })
    .check();
  await dialog
    .getByLabel("Allowance seconds for extra01", { exact: true })
    .fill("6000");
  await dialog
    .getByRole("combobox", { name: "Webcam override for extra01", exact: true })
    .selectOption("required");
  await dialog
    .getByLabel("Allowance seconds for extra02", { exact: true })
    .fill("7200");
  await dialog
    .getByRole("combobox", { name: "Webcam override for extra02", exact: true })
    .selectOption("optional");
  await dialog
    .getByLabel("Earliest Begin (RFC3339 with zone)")
    .fill(new Date(Date.now() - 1000).toISOString());
  await dialog
    .getByLabel("Latest Begin (RFC3339 with zone)")
    .fill(new Date(Date.now() + 600000).toISOString());
  await dialog
    .getByLabel("Reason for additional attempt")
    .fill("Explicit individual synthetic allowances and webcam choices");
  const response = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname.endsWith("/grants/additional-preview") &&
      r.request().method() === "POST",
  );
  await dialog
    .getByRole("button", { name: "Preview additional grants", exact: true })
    .click();
  const reply = await response;
  expect(reply.status()).toBe(200);
  expect(reply.request().postDataJSON().student_settings).toEqual([
    { username: "extra01", duration: 6000, webcam: true },
    { username: "extra02", duration: 7200, webcam: false },
  ]);
  const reviewed = dialog.getByRole("region", {
    name: "Reviewed new grants",
    exact: true,
  });
  await expect(
    reviewed
      .getByRole("article")
      .filter({
        has: page.getByRole("heading", { name: "extra01", exact: true }),
      }),
  ).toContainText("100 minutes");
  await expect(
    reviewed
      .getByRole("article")
      .filter({
        has: page.getByRole("heading", { name: "extra02", exact: true }),
      }),
  ).toContainText("120 minutes");
  await expect(dialog).toContainText("Status: REVIEW");
  await page.screenshot({
    path: testInfo.outputPath("individual-settings-review.png"),
    fullPage: true,
  });
  await dialog
    .getByRole("button", { name: "Cancel review", exact: true })
    .click();
  await expect(dialog).toContainText("Status: CANCELLED");
});

test("additional grants outside expired defaults support reviewed recovery, multiple-grant management and explicit student selection through fresh Begin", async ({
  page,
}, testInfo) => {
  test.setTimeout(90000);
  page.setDefaultTimeout(10000);
  await page.setViewportSize({ width: 430, height: 1000 });
  await simulatedMedia(page);
  const admin = async () => {
    await page.goto("/admin");
    await page.getByLabel("Username", { exact: true }).fill("instructor");
    await page.getByLabel("Password", { exact: true }).fill("fixture-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByLabel("Selected exam").selectOption("additional-template");
  };
  await admin();
  const dashboard = async () =>
    await (
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
  const from = new Date(Date.now() - 60000).toISOString(),
    until = new Date(Date.now() + 600000).toISOString();
  const draft = async (seconds: string) => {
    await page
      .getByRole("button", {
        name: "Authorize additional attempts",
        exact: true,
      })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Authorize additional attempts",
      exact: true,
    });
    await dialog
      .getByLabel("Additional attempt students", { exact: true })
      .fill("extra01");
    await dialog.getByLabel("Additional allowance seconds").fill(seconds);
    await dialog
      .getByRole("combobox", { name: "Workspace initialization", exact: true })
      .selectOption("empty");
    await dialog.getByLabel("Earliest Begin (RFC3339 with zone)").fill(from);
    await dialog.getByLabel("Latest Begin (RFC3339 with zone)").fill(until);
    await dialog
      .getByLabel("Reason for additional attempt")
      .fill(
        "Explicit additional template allowance after original completed exam",
      );
    await dialog
      .getByRole("button", { name: "Preview additional grants", exact: true })
      .click();
    await expect(dialog).toContainText("Status: REVIEW");
    return dialog;
  };
  let dialog = await draft("5400");
  await expect(dialog).toContainText("90 minutes · Webcam not required");
  await expect(dialog).toContainText("Workspace: Empty workspace");
  const reviewID = await dialog.getByLabel("Saved review ID").inputValue();
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
    .getByRole("button", { name: "Confirm additional grants", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Retry confirm", exact: true }),
  ).toBeEnabled();
  await page.reload();
  await page.getByLabel("Selected exam").selectOption("additional-template");
  await page
    .getByRole("button", { name: "Authorize additional attempts", exact: true })
    .click();
  dialog = page.getByRole("dialog", {
    name: "Authorize additional attempts",
    exact: true,
  });
  await dialog.getByLabel("Saved review ID").fill(reviewID);
  await dialog
    .getByRole("button", { name: "Inspect saved review", exact: true })
    .click();
  await expect(dialog).toContainText("Status: CONFIRMED");
  expect(lost).toBe(1);
  const receipt = await (
      await page.request.get(`/api/admin/grant-issuance/${reviewID}`)
    ).json(),
    ninety = receipt.issued[0].grant;
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page.unroute(`**/api/admin/grant-issuance/${reviewID}/confirm`);
  dialog = await draft("4500");
  await expect(dialog).toContainText("1 existing unused or pending grants");
  await dialog
    .getByRole("button", { name: "Confirm additional grants", exact: true })
    .click();
  await expect(dialog).toContainText("Status: CONFIRMED");
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
  await page
    .getByRole("button", { name: "Actions for student extra01", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Attempt grants…", exact: true })
    .click();
  const grants = page.getByRole("dialog", {
    name: "Attempt grants for extra01",
    exact: true,
  });
  await grants
    .getByRole("combobox", { name: "Saved grant", exact: true })
    .selectOption(other.id);
  await expect(grants).toContainText("Saved allowance: 75 minutes");
  await grants.getByLabel("Allowance seconds", { exact: true }).fill("3600");
  await grants
    .getByRole("combobox", { name: "Workspace initialization", exact: true })
    .selectOption("template");
  await grants.getByLabel("Starter template name", { exact: true }).fill("v1");
  await grants
    .getByLabel("Starter template version", { exact: true })
    .fill("a".repeat(64));
  await grants
    .getByLabel("Reason", { exact: true })
    .fill("Explicit revision of this selected unused additional grant");
  await grants
    .getByRole("button", { name: "Revise unused grant", exact: true })
    .click();
  await expect(grants.getByRole("alert")).toContainText(
    "No authenticated source attestation",
  );
  await expect(
    grants.getByLabel("Starter template name", { exact: true }),
  ).toBeEnabled();
  await expect(grants).toContainText("Saved allowance: 75 minutes");
  await grants
    .getByLabel("Starter template name", { exact: true })
    .fill("sample-exam");
  await grants
    .getByRole("button", { name: "Revise unused grant", exact: true })
    .click();
  await expect(grants).toContainText("Saved allowance: 60 minutes");
  await expect(grants).toContainText(
    `Saved workspace: sample-exam · ${"a".repeat(64)}`,
  );
  await expect(
    grants.getByRole("combobox", { name: "Saved grant", exact: true }),
  ).toHaveValue(other.id);
  await grants
    .getByRole("combobox", { name: "Saved grant", exact: true })
    .selectOption(ninety);
  await expect(grants).toContainText("Saved allowance: 90 minutes");
  expect(
    await grants.evaluate(
      (el) => el.getBoundingClientRect().right <= innerWidth + 1,
    ),
  ).toBe(true);
  await grants
    .getByRole("heading", { name: "Attempt grants for extra01", exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath("additional-grants-management-430.png"),
    fullPage: true,
  });
  await grants
    .getByRole("button", { name: "Close grants", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Administration", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
  await page.goto("/");
  await page.getByLabel("Exam ID", { exact: true }).fill("additional-template");
  await page.getByLabel("Enrolled username").fill("extra01");
  await page
    .getByRole("button", { name: "Start SSH sign-in", exact: true })
    .click();
  await page.getByLabel("Shared SSH password").fill("shared-password");
  // SSH authentication, HTTP session completion and destination loading are
  // separate stages. Bound the actual summary response before asserting its
  // controls; the default five-second visibility wait is not a sign-in bound.
  const summaryReady = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/student/exam",
    { timeout: 15000 },
  );
  await page
    .getByRole("button", { name: "Respond to this host", exact: true })
    .click();
  const summaryResponse = await summaryReady;
  expect(summaryResponse.status()).toBe(200);
  const summary = await summaryResponse.json();
  expect(summary.grants.map((grant: any) => grant.id).sort()).toEqual(
    [ninety, other.id].sort(),
  );
  await expect(
    page.getByRole("combobox", { name: "Attempt authorization", exact: true }),
  ).toBeVisible();
  const open = page.getByRole("button", {
    name: "Open preflight & practice",
    exact: true,
  });
  await expect(open).toBeDisabled();
  await page
    .getByRole("combobox", { name: "Attempt authorization", exact: true })
    .selectOption(ninety);
  await expect(open).toBeEnabled();
  await expect(page.locator("main")).toContainText(
    "90 minutes · Webcam: Not required",
  );
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
  await page.getByRole("button", { name: "Begin exam", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Begin exam", exact: true })
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
    page.getByRole("heading", { name: "Connect to your exam", exact: true }),
  ).toBeVisible();
  await admin();
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
  await page.goto("/admin");
  await page.getByLabel("Username", { exact: true }).fill("instructor");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByLabel("Selected exam").selectOption("additional-template");
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
  await page
    .getByRole("button", { name: "Authorize additional attempts", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Authorize additional attempts",
    exact: true,
  });
  await dialog
    .getByLabel("Additional attempt students", { exact: true })
    .fill("extra01");
  await dialog.getByLabel("Additional allowance seconds").fill("5400");
  await dialog
    .getByRole("combobox", { name: "Workspace initialization", exact: true })
    .selectOption("saved");
  await dialog.getByLabel("Protected source attempt UUID").fill(source);
  await dialog
    .getByLabel("Protected source archive checksum")
    .fill("b".repeat(64));
  await dialog
    .getByLabel("Earliest Begin (RFC3339 with zone)")
    .fill(new Date(Date.now() - 1000).toISOString());
  await dialog
    .getByLabel("Latest Begin (RFC3339 with zone)")
    .fill(new Date(Date.now() + 600000).toISOString());
  await dialog
    .getByLabel("Reason for additional attempt")
    .fill(
      "Explicit new saved-work browser grant awaiting durable native protection",
    );
  await dialog
    .getByRole("button", { name: "Preview additional grants", exact: true })
    .click();
  await expect(dialog).toContainText("90 minutes · Webcam not required");
  await expect(dialog).toContainText(`Protected attempt ${source}`);
  await dialog
    .getByRole("button", { name: "Confirm additional grants", exact: true })
    .click();
  await expect(dialog).toContainText("Status: CONFIRMED");
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  const grants = (
    await (
      await page.request.get(
        "/api/admin/exams/additional-template/grants?username=extra01",
      )
    ).json()
  ).grants;
  const saved = grants.find(
    (g: any) => g.work.kind === "saved" && g.status === "PENDING_NATIVE",
  );
  expect(saved).toBeTruthy();
  await page
    .getByRole("button", { name: "Actions for student extra01", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Attempt grants…", exact: true })
    .click();
  const management = page.getByRole("dialog", {
    name: "Attempt grants for extra01",
    exact: true,
  });
  await management
    .getByRole("combobox", { name: "Saved grant", exact: true })
    .selectOption(saved.id);
  await expect(management).toContainText(
    "Waiting for durable class-server source retention confirmation",
  );
  await expect(management).toContainText("reserves no account or exam time");
  await expect(management).toContainText(
    `sudo examctl web grants source-sync ${saved.id} --revision ${saved.revision}`,
  );
  await expect(management).toContainText("inspect source-show and retry");
  await management
    .getByLabel("Reason", { exact: true })
    .fill("Cancel unconfirmed saved-source grant with history intact");
  await management
    .getByRole("button", { name: "Revoke unused grant", exact: true })
    .click();
  await expect(management).toContainText("REVOKED");
  expect(await history()).toEqual(before);
});

test("bulk saved work requires each student's own source and preserves the exact review through correction and a lost confirmation", async ({
  page,
}, testInfo) => {
  test.setTimeout(60000);
  page.setDefaultTimeout(8000);
  await page.setViewportSize({ width: 430, height: 1000 });
  await page.goto("/admin");
  await page.getByLabel("Username", { exact: true }).fill("instructor");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByLabel("Selected exam").selectOption("additional-template");
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
    const dashboard = await (
      await page.request.get("/api/admin/exams/additional-template/dashboard")
    ).json();
    return sources.map((s) =>
      dashboard.students
        .find((u: any) => u.username === s.username)
        .attempts.find((a: any) => a.id === s.attempt),
    );
  };
  const original = await histories();
  await page
    .getByRole("button", { name: "Authorize additional attempts", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Authorize additional attempts",
    exact: true,
  });
  await dialog
    .getByLabel("Additional attempt students", { exact: true })
    .fill("extra01\nextra02");
  await dialog.getByLabel("Additional allowance seconds").fill("5400");
  await dialog
    .getByRole("combobox", { name: "Workspace initialization", exact: true })
    .selectOption("saved");
  await expect(
    dialog.getByLabel("Protected source attempt UUID", { exact: true }),
  ).toHaveCount(0);
  for (const source of sources) {
    await dialog
      .getByLabel(`Protected source attempt for ${source.username}`, {
        exact: true,
      })
      .fill(source.attempt);
    await dialog
      .getByLabel(`Protected source checksum for ${source.username}`, {
        exact: true,
      })
      .fill(source.checksum);
  }
  await dialog
    .getByLabel("Earliest Begin (RFC3339 with zone)")
    .fill(new Date(Date.now() - 1000).toISOString());
  await dialog
    .getByLabel("Latest Begin (RFC3339 with zone)")
    .fill(new Date(Date.now() + 600000).toISOString());
  await dialog
    .getByLabel("Reason for additional attempt")
    .fill(
      "Explicit bulk ninety-minute attempts from separately selected student archives",
    );
  await dialog
    .getByLabel("Protected source attempt for extra02", { exact: true })
    .fill(sources[0].attempt);
  await dialog
    .getByLabel("Protected source checksum for extra02", { exact: true })
    .fill(sources[0].checksum);
  const refused = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname.endsWith("/grants/additional-preview") &&
      r.status() === 409,
  );
  await dialog
    .getByRole("button", { name: "Preview additional grants", exact: true })
    .click();
  await refused;
  await expect(dialog.getByRole("alert")).toContainText("protected");
  await expect(
    dialog.getByLabel("Protected source attempt for extra02", { exact: true }),
  ).toBeEnabled();
  await dialog
    .getByLabel("Protected source attempt for extra02", { exact: true })
    .fill(sources[1].attempt);
  await dialog
    .getByLabel("Protected source checksum for extra02", { exact: true })
    .fill(sources[1].checksum);
  await dialog
    .getByRole("button", { name: "Preview additional grants", exact: true })
    .click();
  await expect(dialog).toContainText("Status: REVIEW");
  const reviewed = dialog.getByRole("region", {
    name: "Reviewed new grants",
    exact: true,
  });
  for (const [index, source] of sources.entries()) {
    const row = reviewed.getByRole("article").filter({
      has: page.getByRole("heading", { name: source.username, exact: true }),
    });
    await expect(row).toContainText(
      `Protected attempt ${source.attempt} · ${source.checksum}`,
    );
    await expect(row).toContainText(
      `90 minutes · Webcam ${index ? "required" : "not required"}`,
    );
  }
  expect(
    await dialog.evaluate(
      (el) => el.getBoundingClientRect().right <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("bulk-saved-source-review-430.png"),
    fullPage: true,
  });
  const reviewID = await dialog.getByLabel("Saved review ID").inputValue();
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
    .getByRole("button", { name: "Confirm additional grants", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Retry confirm", exact: true }),
  ).toBeEnabled();
  await page.unroute(`**/api/admin/grant-issuance/${reviewID}/confirm`);
  await dialog
    .getByRole("button", { name: "Retry confirm", exact: true })
    .click();
  await expect(dialog).toContainText("Status: CONFIRMED");
  expect(lost).toBe(1);
  const receipt = await (
    await page.request.get(`/api/admin/grant-issuance/${reviewID}`)
  ).json();
  expect(receipt.issued).toHaveLength(2);
  for (const [index, source] of sources.entries()) {
    const id = receipt.issued.find(
        (g: any) => g.username === source.username,
      ).grant,
      grant = await (await page.request.get(`/api/admin/grants/${id}`)).json();
    expect(grant).toMatchObject({
      status: "PENDING_NATIVE",
      work: {
        kind: "saved",
        attempt: source.attempt,
        checksum: source.checksum,
      },
      settings: { duration: 5400, webcam: !!index },
      claims: [],
    });
  }
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  await page
    .getByRole("button", { name: "Actions for student extra02", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Attempt grants…", exact: true })
    .click();
  const management = page.getByRole("dialog", {
      name: "Attempt grants for extra02",
      exact: true,
    }),
    secondID = receipt.issued.find((g: any) => g.username === "extra02").grant;
  await expect(management.getByText(secondID, { exact: true })).toBeVisible();
  await expect(
    management.getByRole("combobox", { name: "Saved grant", exact: true }),
  ).toHaveCount(0);
  await expect(management).toContainText(
    `sudo examctl web grants source-sync ${secondID} --revision 1`,
  );
  await management
    .getByLabel("Reason", { exact: true })
    .fill("Cancel only this unused bulk saved grant with all history retained");
  await management
    .getByRole("button", { name: "Revoke unused grant", exact: true })
    .click();
  await expect(management).toContainText("REVOKED");
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
