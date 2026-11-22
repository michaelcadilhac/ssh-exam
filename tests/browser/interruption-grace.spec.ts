import { test, expect } from "@playwright/test";
import { begin, fixture, gate } from "./transition-fixture.js";

async function visibility(
  page: import("@playwright/test").Page,
  hidden: boolean,
) {
  await page.evaluate((hidden) => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => hidden,
    });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => (hidden ? "hidden" : "visible"),
    });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
}

test("hidden-page grace keeps screen uploads running and restores typing without another attempt", async ({
  page,
}) => {
  const f = await fixture(page);
  let frames = 0;
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname.endsWith("/frames") &&
      request.method() === "POST" &&
      request.postDataJSON().source === "screen"
    )
      frames++;
  });
  await begin(page, f);
  const original = { ...f.model.attempt };
  const before = frames;
  await visibility(page, true);
  await expect(page.locator(".focus-warning")).toContainText(
    "15s to restore exam checks",
  );
  await expect(page.locator(".workspace .window-area")).toHaveAttribute(
    "inert",
    "",
  );
  await expect
    .poll(() => frames, { timeout: 8000 })
    .toBeGreaterThan(before + 1);
  expect(f.model.messages.filter((m) => m.type === "incident")).toHaveLength(0);
  await visibility(page, false);
  await expect(page.locator(".focus-warning")).toHaveCount(0);
  await expect(page.locator(".workspace .window-area")).not.toHaveAttribute(
    "inert",
    "",
  );
  expect(f.model.attempt.id).toBe(original.id);
  expect(f.model.attempt.deadline).toBe(original.deadline);
  expect(f.model.messages.filter((m) => m.type === "incident")).toHaveLength(0);
});

test("fullscreen and keyboard restore from the grace warning without instructor review", async ({
  page,
}) => {
  const f = await fixture(page);
  await begin(page, f);
  await page.evaluate(() => document.exitFullscreen());
  await expect(page.locator(".focus-warning")).toBeVisible();
  await page
    .getByRole("button", { name: "Return to fullscreen", exact: true })
    .click();
  await expect(page.locator(".focus-warning")).toHaveCount(0);
  expect(f.model.messages.filter((m) => m.type === "incident")).toHaveLength(0);
});

test("repeated and changing losses do not restart grace or let a late return unlock typing", async ({
  page,
}) => {
  test.setTimeout(30000);
  const f = await fixture(page);
  await begin(page, f);
  await visibility(page, true);
  await expect(page.locator(".focus-warning")).toBeVisible();
  await page.waitForTimeout(9000);
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await page.evaluate(() => document.exitFullscreen());
  await expect
    .poll(() => f.model.messages.filter((m) => m.type === "incident").length, {
      timeout: 8500,
    })
    .toBe(1);
  await visibility(page, false);
  await page.waitForTimeout(500);
  expect(f.model.messages.filter((m) => m.type === "incident")).toHaveLength(1);
  await expect(page.locator(".workspace .window-area")).toHaveAttribute(
    "inert",
    "",
  );
});

test("a brief monitoring socket outage recovers automatically inside grace", async ({
  page,
}) => {
  const f = await fixture(page);
  await begin(page, f);
  const original = { ...f.model.attempt };
  await f.model.socket!.close({ code: 1000, reason: "Synthetic short outage" });
  await expect(page.locator(".focus-warning")).toBeVisible();
  await expect(page.locator(".focus-warning")).toHaveCount(0, {
    timeout: 10000,
  });
  expect(f.model.attempt.deadline).toBe(original.deadline);
  expect(f.model.messages.filter((m) => m.type === "incident")).toHaveLength(0);
});

test("delayed connection binding remains a technical wait after grace and needs fresh verification to restore typing", async ({
  page,
}) => {
  test.setTimeout(35000);
  const f = await fixture(page);
  await begin(page, f);
  const original = { ...f.model.attempt };
  const bindings = f.model.bindings.length;
  const verification = gate();
  let verifying = false;
  await page.route(
    "**/api/student/attempts/*/monitoring-readiness",
    async (route) => {
      verifying = true;
      await Promise.race([
        verification.promise,
        new Promise<void>((resolve) => setTimeout(resolve, 10000)),
      ]);
      await route.fulfill({ json: { complete: true } });
    },
  );
  f.model.onBind = async () => {};
  await f.model.socket!.close({
    code: 1000,
    reason: "Synthetic delayed binding",
  });
  await expect.poll(() => f.model.bindings.length).toBeGreaterThan(bindings);
  await expect(page.locator(".focus-warning")).toBeVisible();
  await page.waitForTimeout(17000);
  await expect(page.locator(".focus-warning")).toHaveCount(0);
  await expect(page.locator(".workspace .window-area")).toHaveAttribute(
    "inert",
    "",
  );
  expect(f.model.messages.filter((m) => m.type === "incident")).toHaveLength(0);
  expect(f.model.attempt.state).toBe("ACTIVE");
  f.model.onBind = undefined;
  const pending = f.model.bindings.at(-1)!;
  pending.socket.send(
    JSON.stringify({
      type: "state",
      binding: pending.binding,
      ...f.snapshot(),
    }),
  );
  await expect.poll(() => verifying).toBe(true);
  await expect(page.locator(".workspace .window-area")).toHaveAttribute(
    "inert",
    "",
  );
  verification.release();
  await expect(page.locator(".workspace .window-area")).not.toHaveAttribute(
    "inert",
    "",
  );
  expect(f.model.attempt.deadline).toBe(original.deadline);
  expect(f.model.messages.filter((m) => m.type === "incident")).toHaveLength(0);
});

test("confirmed SSH loss keeps available capture for grace without thawing the native hold", async ({
  page,
}) => {
  test.setTimeout(30000);
  const f = await fixture(page);
  let screens = 0;
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname.endsWith("/frames") &&
      request.method() === "POST" &&
      request.postDataJSON().source === "screen"
    )
      screens++;
  });
  await begin(page, f);
  const before = screens;
  Object.assign(f.model.attempt, {
    state: "LOCKED",
    generation: 1,
    reason: "SSH transport lost",
    focus_lost_at: Date.now(),
  });
  f.model.state = "LOCKED";
  f.model.authenticationGap = true;
  f.send();
  await expect(page.locator(".focus-warning")).toBeVisible();
  await expect(page.locator(".workspace .window-area")).toHaveAttribute(
    "inert",
    "",
  );
  await expect(page.locator(".lock-overlay")).toHaveCount(0);
  await expect
    .poll(() => screens, { timeout: 8000 })
    .toBeGreaterThan(before + 1);
  f.send();
  await expect(page.locator(".lock-overlay")).toBeVisible({ timeout: 12000 });
  expect(f.model.attempt.state).toBe("LOCKED");
  expect(f.model.messages.filter((m) => m.type === "incident")).toHaveLength(0);
});

test("an authoritative deadline still finishes immediately during interruption grace", async ({
  page,
}) => {
  const f = await fixture(page);
  await begin(page, f);
  f.model.attempt.deadline = Date.now() + 2000;
  f.send();
  await visibility(page, true);
  await expect(page.locator(".focus-warning")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Saving your files", exact: true }),
  ).toBeVisible({ timeout: 5000 });
  expect(f.model.messages.filter((m) => m.type === "incident")).toHaveLength(0);
});

test("fresh images cannot restore typing when canonical status has already issued a hold", async ({
  page,
}) => {
  const f = await fixture(page);
  await begin(page, f);
  await visibility(page, true);
  await expect(page.locator(".focus-warning")).toBeVisible();
  await page.evaluate(() => {
    (window as any).__graceReopened = false;
    new MutationObserver(() => {
      const area = document.querySelector<HTMLElement>(".window-area");
      if (area && !area.inert) (window as any).__graceReopened = true;
    }).observe(document.querySelector(".window-area")!, { attributes: true });
  });
  f.model.status = async (route) =>
    route.fulfill({
      json: {
        ...f.snapshot(),
        attempt: { ...f.model.attempt, state: "LOCKED", generation: 1 },
      },
    });
  await visibility(page, false);
  await page.waitForTimeout(2500);
  expect(await page.evaluate(() => (window as any).__graceReopened)).toBe(
    false,
  );
  await expect(page.locator(".workspace .window-area")).toHaveAttribute(
    "inert",
    "",
  );
});
