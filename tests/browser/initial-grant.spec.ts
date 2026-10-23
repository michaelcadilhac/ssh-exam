import { test, expect } from "@playwright/test";
import { simulatedMedia, ready } from "./transition-fixture.js";

test("issued grant settings survive later defaults through portal, real WASM SSH and fresh native Begin", async ({
  page,
}) => {
  test.setTimeout(60000);
  await simulatedMedia(page);
  await page.goto("/");
  await page.getByLabel("Exam ID", { exact: true }).fill("initial-grant");
  await page.getByLabel("Enrolled username").fill("grant01");
  await page
    .getByRole("button", { name: "Start SSH sign-in", exact: true })
    .click();
  await page.getByLabel("Shared SSH password").fill("shared-password");
  await page
    .getByRole("button", { name: "Respond to this host", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Initial browser grant", exact: true }),
  ).toBeVisible();
  await expect(page.locator("main")).toContainText(
    "90 minutes · Webcam: Not required",
  );
  const portal = await (await page.request.get("/api/student/exam")).json();
  expect(portal.exam).toMatchObject({ duration: 3600, webcam: true });
  expect(portal.settings).toMatchObject({
    duration: 5400,
    webcam: false,
    template_version: "a".repeat(64),
  });
  await page
    .getByRole("button", { name: "Open preflight & practice", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Practice terminal", exact: true }),
  ).toBeEnabled();
  const prepared = (await (await page.request.get("/api/student/exam")).json())
    .attempt;
  expect(prepared).toMatchObject({
    state: "PREPARING",
    start: null,
    deadline: null,
    grant_id: expect.any(String),
    grant_revision: 1,
  });
  await ready(page);
  await page.getByRole("button", { name: "Begin exam", exact: true }).click();
  const begin = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.endsWith("/begin"),
    { timeout: 10000 },
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Begin exam", exact: true })
    .click();
  const started = await begin;
  expect(
    started.status(),
    (await started.text()) +
      JSON.stringify(
        await (await page.request.get("/api/fixture/runtime")).json(),
      ),
  ).toBe(200);
  await expect(page.locator(".winbox")).toHaveCount(1);
  const active = (await (await page.request.get("/api/student/exam")).json())
    .attempt;
  expect(active).toMatchObject({
    state: "ACTIVE",
    grant_id: prepared.grant_id,
    grant_begin_intent: expect.any(String),
  });
  expect(active.deadline - active.start).toBe(5400000);
  expect(active.original_deadline).toBe(active.deadline);
  const owner = JSON.parse(active.registered_owner);
  expect(owner).toMatchObject({
    attempt: active.id,
    exam: "initial-grant",
    username: "grant01",
    uid: 10022,
    page_epoch: active.page_hash,
    input_epoch: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  await page.getByRole("button", { name: "Finish exam", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Finish exam", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Connect to your exam", exact: true }),
  ).toBeVisible();
  expect((await page.request.get("/api/session")).status()).toBe(401);
});
