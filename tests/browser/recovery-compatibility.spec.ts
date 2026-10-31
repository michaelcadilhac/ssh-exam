import { test, expect } from "@playwright/test";
import { ready, simulatedMedia, confirmFinish } from "./transition-fixture.js";

test("actual WASM legacy first preflight and Begin refuse old roles, then retry the same allowance after repair", async ({
  page,
}) => {
  test.setTimeout(75000);
  test.skip(
    process.env.EXAM_BROWSER_SSH !== "1",
    "Requires actual browser SSH relay",
  );
  const role = async (missing: boolean) => {
    const session = await (await page.request.get("/api/session")).json();
    const response = await page.request.post("/api/fixture/recovery-role", {
      headers: {
        origin: "http://localhost:3100",
        "x-csrf-token": session.csrf,
      },
      data: { missing },
    });
    expect(response.ok(), await response.text()).toBe(true);
  };
  const read = async () =>
    (await (await page.request.get("/api/fixture/runtime")).json())
      .recoveryCompatibility;
  await simulatedMedia(page);
  await page.goto("/");
  const runtime = await (await page.request.get("/api/login-test")).json();
  expect(runtime.browserSSH).toBe(true);
  await page
    .getByLabel("Exam ID", { exact: true })
    .fill("recovery-compatibility");
  await page.getByLabel("Username").fill("recovery01");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByLabel("Password", { exact: true }).fill("shared-password");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "Check setup and practice",
      exact: true,
    }),
  ).toBeVisible({ timeout: 10000 });
  await role(true);
  await page
    .getByRole("button", { name: "Check setup and practice", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "The exam server cannot confirm this attempt's saved time limit. Ask your instructor to check the server. Keep this setup and its saved files; this request did not start an exam or use an attempt.",
    { timeout: 10000 },
  );
  const refused = await read();
  expect(refused.web).toEqual([]);
  expect(refused.native).toEqual([]);
  expect(refused.operations).not.toContain("prepare-attempt");
  await role(false);
  await page
    .getByRole("button", { name: "Check setup and practice", exact: true })
    .click();
  await ready(page);
  const before = (await read()).web[0];
  expect(before).toMatchObject({
    state: "PREPARING",
    start: null,
    deadline: null,
    original_deadline: null,
  });
  const begin = async () => {
    await page
      .getByRole("button", { name: "Start exam", exact: true })
      .click({ timeout: 5000 });
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Start exam", exact: true })
      .click({ timeout: 5000 });
  };
  await role(true);
  await begin();
  await expect(
    page.getByRole("dialog", { name: "Workspace error" }),
  ).toContainText(
    "The exam server could not confirm this saved-work attempt's time limit or safety checks. Keep the setup and saved files, and ask your instructor to check the server. This request did not start an exam or use an attempt.",
    { timeout: 10000 },
  );
  const blocked = await read();
  expect(blocked.web).toEqual([before]);
  expect(blocked.native).toHaveLength(1);
  expect(blocked.native[0]).toMatchObject({
    id: before.id,
    state: "PREPARING",
    start: 0,
    deadline: 0,
    original_deadline: 0,
  });
  expect(blocked.operations).not.toContain("activate-versioned-attempt");
  expect(blocked.activationFailures).toEqual({ n: 0 });
  await page
    .getByRole("dialog", { name: "Workspace error" })
    .getByRole("button", { name: "Close", exact: true })
    .click({ timeout: 5000 });
  await role(false);
  await begin();
  await expect(
    page.getByRole("button", { name: "Finish exam", exact: true }),
  ).toBeVisible({ timeout: 10000 });
  const active = (await read()).web[0];
  expect(active.id).toBe(before.id);
  expect(active.deadline - active.start).toBe(5400000);
  await confirmFinish(page);
  await expect(
    page.getByRole("heading", { name: "Sign in to your exam", exact: true }),
  ).toBeVisible();
});
