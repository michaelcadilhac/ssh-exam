import { test, expect } from "@playwright/test";
import { simulatedMedia, ready } from "./transition-fixture.js";

test("real WASM SSH recovers dropped native renewal replies and retires only their command channels", async ({
  page,
}) => {
  test.setTimeout(60000);
  await simulatedMedia(page);
  await page.goto("/");
  await page.getByLabel("Exam ID", { exact: true }).fill("monitoring-receipt");
  await page.getByLabel("Username").fill("receipt01");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByLabel("Shared SSH password").fill("shared-password");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Check setup and practice" }).click();
  await ready(page);
  await page.getByRole("button", { name: "Start exam", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Start exam", exact: true })
    .click();
  await expect(page.locator(".winbox")).toHaveCount(1);
  // Window allocation is not exec. Observe real SSH output before freezing the
  // baseline and exercising the exact-channel cancellation/terminal boundary.
  await expect(page.locator(".xterm-rows")).toContainText(
    "DISPOSABLE DEVELOPMENT FIXTURE",
  );
  const original = (await (await page.request.get("/api/student/exam")).json())
    .attempt;
  const baseline = await (
    await page.request.get("/api/fixture/runtime")
  ).json();
  await expect
    .poll(
      async () =>
        (await (await page.request.get("/api/fixture/runtime")).json())
          .renewalReceipts.recovered,
      { timeout: 20000 },
    )
    .toBeGreaterThanOrEqual(baseline.renewalReceipts.recovered + 3);
  await page.locator(".xterm-helper-textarea").last().focus();
  await page.keyboard.type("same-wasm-pane-after-recovery");
  await page.keyboard.press("Enter");
  await expect(page.locator(".xterm-rows")).toContainText(
    "Echo: same-wasm-pane-after-recovery",
  );
  const current = (await (await page.request.get("/api/student/exam")).json())
    .attempt;
  expect(current).toMatchObject({
    id: original.id,
    state: "ACTIVE",
    start: original.start,
    generation: original.generation,
    deadline: original.deadline,
    original_deadline: original.original_deadline,
  });
  const after = await (await page.request.get("/api/fixture/runtime")).json();
  expect(after.authenticationCalls).toEqual(baseline.authenticationCalls);
  expect(after.renewalReceipts.maxActiveCommands).toBeLessThanOrEqual(4);
  await expect(
    page.getByRole("heading", {
      name: /^(Work paused|Instructor review required)$/,
    }),
  ).toHaveCount(0);
});
