import { test, expect } from "@playwright/test";
import { simulatedMedia, ready } from "./transition-fixture.js";

test("negotiated retained WASM Begin preserves its actual transport through policy and control recovery", async ({
  page,
  request,
}) => {
  test.setTimeout(90000);
  let uploads = 0;
  let controlConnections = 0,
    delayAfterConnection = 0,
    holdBindings = false;
  let cutControl: (() => Promise<unknown>) | undefined;
  const heldBindings: { connection: number; send: () => void }[] = [];
  const controlTrace: unknown[] = [];
  await page.routeWebSocket("**/api/student/session", (socket) => {
    const connection = ++controlConnections;
    const upstream = socket.connectToServer();
    socket.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      controlTrace.push({
        connection,
        direction: "request",
        type: message.type,
      });
      upstream.send(raw);
    });
    cutControl = () => {
      const close = {
        // The upstream is a real browser WebSocket: close() accepts1000 or
        // application codes3000..4999, not the server-only restart code1012.
        code: 4001,
        reason: "Synthetic retained page control interruption",
      };
      // Playwright models the two endpoints independently. Closing only the
      // upstream does not dispatch a close event to the page-side mock socket.
      return Promise.all([socket.close(close), upstream.close(close)]);
    };
    upstream.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      controlTrace.push({
        connection,
        direction: "reply",
        type: message.type,
        binding: !!message.binding,
        error: message.error,
      });
      if (
        holdBindings &&
        connection > delayAfterConnection &&
        message.type === "state" &&
        message.binding
      ) {
        heldBindings.push({ connection, send: () => socket.send(raw) });
        return;
      }
      socket.send(raw);
    });
  });
  page.on("response", (response) => {
    if (
      new URL(response.url()).pathname.endsWith("/frames/challenged") &&
      response.status() === 200
    )
      uploads++;
  });
  await simulatedMedia(page);
  await page.goto("/");
  expect(
    (await (await page.request.get("/api/login-test")).json()).browserSSH,
    "Requires EXAM_BROWSER_SSH=1; Node fallback cannot qualify retained WASM",
  ).toBe(true);
  await page
    .getByLabel("Exam ID", { exact: true })
    .fill("retained-control", { timeout: 5000 });
  await page
    .getByLabel("Enrolled username")
    .fill("retained01", { timeout: 5000 });
  await page
    .getByRole("button", { name: "Start SSH sign-in", exact: true })
    .click({ timeout: 10000 });
  await page
    .getByLabel("Shared SSH password")
    .fill("shared-password", { timeout: 10000 });
  await page
    .getByRole("button", { name: "Respond to this host", exact: true })
    .click({ timeout: 10000 });
  await page
    .getByRole("button", { name: "Open preflight & practice", exact: true })
    .click({ timeout: 10000 });
  await ready(page);
  await page
    .getByRole("button", { name: "Begin exam", exact: true })
    .click({ timeout: 10000 });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Begin exam", exact: true })
    .click({ timeout: 10000 });
  await expect(page.locator(".xterm-rows")).toContainText(
    "DISPOSABLE DEVELOPMENT FIXTURE",
    { timeout: 10000 },
  );
  const original = (await (await page.request.get("/api/student/exam")).json())
    .attempt;
  expect(original.state).toBe("ACTIVE");
  expect(
    original.monitoring_mode,
    "The real framed fixture must negotiate retainedv1, not merely inject paused page state",
  ).toBe("v1");
  const runtime = await (await page.request.get("/api/fixture/runtime")).json();
  expect(runtime.retainedRegistrations).toContainEqual({
    exam: "retained-control",
    username: "retained01",
    retained_monitoring: "v1",
  });
  await page.locator(".xterm-helper-textarea").last().focus();
  await page.keyboard.type("retained-buffer-");
  await expect(page.locator(".xterm-rows")).toContainText("retained-buffer-", {
    timeout: 5000,
  });
  const beforePause = await (
    await page.request.get("/api/fixture/runtime")
  ).json();
  const originalInput = beforePause.framedInput.accepted
    .filter((p: any) => p.kind === 0)
    .at(-1);
  expect(originalInput?.epoch).toMatch(/^[a-f0-9]{64}$/);
  const beforePauseUploads = uploads;
  await page.evaluate(() => document.exitFullscreen());
  await expect(page.locator(".lock-overlay")).toBeVisible({ timeout: 10000 });
  const paused = (await (await page.request.get("/api/student/exam")).json())
    .attempt;
  expect(paused.state).toBe("LOCKED");
  expect(paused.generation).toBe(original.generation + 1);
  expect(paused.deadline).toBe(original.deadline);
  const held = await (await page.request.get("/api/fixture/runtime")).json();
  expect(held.authenticationCalls).toEqual(runtime.authenticationCalls);
  expect(held.panes).toEqual(runtime.panes);
  const login = await request.post("/api/admin/login", {
    headers: { origin: "http://localhost:3100" },
    data: { username: "instructor", password: "fixture-password" },
  });
  expect(login.ok(), await login.text()).toBe(true);
  const selected = await (
    await request.get(`/api/admin/attempts/${original.id}/interruption`)
  ).json();
  const approval = await request.post(
    `/api/admin/attempts/${original.id}/authorize`,
    {
      headers: {
        origin: "http://localhost:3100",
        "x-csrf-token": (await login.json()).csrf,
      },
      data: {
        generation: selected.generation,
        revision: selected.revision,
        requestID: crypto.randomUUID(),
        reason: "Reviewed synthetic negotiated retained control recovery",
      },
    },
  );
  expect(approval.ok(), await approval.text()).toBe(true);
  await expect(
    page.getByRole("heading", { name: "Continuation approved", exact: true }),
  ).toBeVisible({ timeout: 10000 });
  await page
    .getByRole("button", { name: "Restore fullscreen", exact: true })
    .click({ timeout: 10000 });
  const keyboard = page.getByRole("button", {
    name: "Restore keyboard lock",
    exact: true,
  });
  if ((await keyboard.getAttribute("aria-pressed")) !== "true") {
    await expect(keyboard).toBeEnabled({ timeout: 10000 });
    await keyboard.click({ timeout: 10000 });
  }
  await expect(keyboard).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(() => uploads, { timeout: 10000 })
    .toBeGreaterThan(beforePauseUploads);
  await page.waitForResponse(
    (response) => {
      if (
        !new URL(response.url()).pathname.endsWith("/frames/challenged") ||
        response.status() !== 200
      )
        return false;
      const sample = response.request().postDataJSON();
      return (
        sample.source === "screen" &&
        ["fullscreen", "keyboard", "screen", "focus", "visible"].every(
          (key) => sample.readiness?.[key] === true,
        )
      );
    },
    { timeout: 10000 },
  );
  const continued = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/attempts/${original.id}/continue`) &&
      response.request().method() === "POST",
    { timeout: 10000 },
  );
  await page
    .getByRole("button", {
      name: "Continue exam after authorization",
      exact: true,
    })
    .click({ timeout: 10000 });
  const response = await continued;
  expect(response.status(), await response.text()).toBe(200);
  await expect(page.locator(".lock-overlay")).toHaveCount(0, {
    timeout: 10000,
  });
  await page.locator(".xterm-helper-textarea").last().focus();
  await page.keyboard.type("fresh");
  await page.keyboard.press("Enter");
  await expect(page.locator(".xterm-rows")).toContainText(
    "Echo: retained-buffer-fresh",
    { timeout: 5000 },
  );
  const resumed = (await (await page.request.get("/api/student/exam")).json())
    .attempt;
  expect(resumed).toMatchObject({
    id: original.id,
    state: "ACTIVE",
    monitoring_mode: "v1",
    generation: paused.generation,
    start: original.start,
    deadline: original.deadline,
    original_deadline: original.original_deadline,
  });
  const after = await (await page.request.get("/api/fixture/runtime")).json();
  expect(after.authenticationCalls).toEqual(runtime.authenticationCalls);
  expect(after.panes).toEqual(runtime.panes);
  const acceptedBeforeControl = after.framedInput.accepted.filter(
    (p: any) => p.kind === 0,
  );
  expect(acceptedBeforeControl.at(-1).epoch).not.toBe(originalInput.epoch);
  const beforeControlUploads = uploads;
  delayAfterConnection = controlConnections;
  holdBindings = true;
  expect(cutControl).toBeDefined();
  await cutControl!();
  const reconnecting = page.getByText("Reconnecting · input blocked", {
    exact: true,
  });
  await expect(reconnecting).toBeVisible({ timeout: 5000 });
  await expect
    .poll(() => heldBindings.length, { timeout: 5000 })
    .toBeGreaterThan(0)
    .catch((error) => {
      console.log(
        "Retained control protocol trace",
        JSON.stringify(controlTrace),
      );
      throw error;
    });
  await page
    .locator(".xterm-helper-textarea")
    .last()
    .evaluate((element) => {
      const input = element as HTMLTextAreaElement;
      input.value = "CONTROL_STALE_INPUT";
      input.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          data: "CONTROL_STALE_INPUT",
          inputType: "insertText",
        }),
      );
    });
  // Real wall time: lost coordination replies alone must not cause a violation,
  // close a viable transport, or replay blocked input after the old15s limit.
  await page.waitForTimeout(17500);
  await expect(reconnecting).toBeVisible();
  expect(
    heldBindings.filter((p) => p.connection < controlConnections).length,
  ).toBeGreaterThan(0);
  await expect(
    page.getByRole("heading", { name: "Reconnecting", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Instructor review required",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Terminal input is disabled while reconnecting.", {
      exact: true,
    }),
  ).toBeVisible();
  expect(uploads - beforeControlUploads).toBeGreaterThanOrEqual(3);
  const blocked = await (await page.request.get("/api/fixture/runtime")).json();
  expect(blocked.authenticationCalls).toEqual(runtime.authenticationCalls);
  expect(blocked.panes).toEqual(runtime.panes);
  expect(blocked.framedInput.accepted.filter((p: any) => p.kind === 0)).toEqual(
    acceptedBeforeControl,
  );
  const delayed = (await (await page.request.get("/api/student/exam")).json())
    .attempt;
  expect(delayed).toMatchObject({
    id: original.id,
    state: "ACTIVE",
    generation: resumed.generation,
    start: original.start,
    deadline: original.deadline,
    original_deadline: original.original_deadline,
  });
  holdBindings = false;
  const current = heldBindings.filter(
    (p) => p.connection === controlConnections,
  );
  expect(current.length).toBeGreaterThan(0);
  for (const binding of current) binding.send();
  await expect(reconnecting).toHaveCount(0, { timeout: 5000 });
  await page.locator(".xterm-helper-textarea").last().focus();
  await page.keyboard.type("post-control");
  await page.keyboard.press("Enter");
  await expect(page.locator(".xterm-rows")).toContainText(
    "Echo: post-control",
    { timeout: 5000 },
  );
  await expect(page.locator(".xterm-rows")).not.toContainText(
    "CONTROL_STALE_INPUT",
  );
  const final = await (await page.request.get("/api/fixture/runtime")).json();
  expect(final.authenticationCalls).toEqual(runtime.authenticationCalls);
  expect(final.panes).toEqual(runtime.panes);
  const acceptedAfterControl = final.framedInput.accepted.filter(
    (p: any) => p.kind === 0,
  );
  expect(acceptedAfterControl.length).toBeGreaterThan(
    acceptedBeforeControl.length,
  );
  expect(acceptedAfterControl.at(-1).epoch).toBe(
    acceptedBeforeControl.at(-1).epoch,
  );
  expect(acceptedAfterControl.at(-1).sequence).toBeGreaterThan(
    acceptedBeforeControl.at(-1).sequence,
  );
});
