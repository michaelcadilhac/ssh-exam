import { test, expect, type Page } from "@playwright/test";
import { simulatedMedia, ready } from "./transition-fixture.js";

async function prepareRetained(page: Page, username: string) {
  await simulatedMedia(page);
  await page.goto("/");
  expect(
    (await (await page.request.get("/api/login-test")).json()).browserSSH,
    "Requires EXAM_BROWSER_SSH=1; Node fallback cannot qualify retained WASM",
  ).toBe(true);
  await page
    .getByLabel("Exam ID", { exact: true })
    .fill("retained-control", { timeout: 5000 });
  await page.getByLabel("Username").fill(username, { timeout: 5000 });
  await page
    .getByRole("button", { name: "Sign in", exact: true })
    .click({ timeout: 10000 });
  await page
    .getByLabel("Shared SSH password")
    .fill("shared-password", { timeout: 10000 });
  await page
    .getByRole("button", { name: "Continue", exact: true })
    .click({ timeout: 10000 });
  await page
    .getByRole("button", { name: "Check setup and practice", exact: true })
    .click({ timeout: 10000 });
  await ready(page);
}

async function beginRetained(page: Page, username: string) {
  await prepareRetained(page, username);
  await page
    .getByRole("button", { name: "Start exam", exact: true })
    .click({ timeout: 10000 });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Start exam", exact: true })
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
  expect(runtime.nativeBeginRequests).toContain(original.id);
  expect(runtime.retainedRegistrations).toContainEqual({
    exam: "retained-control",
    username,
    retained_monitoring: "v1",
  });
  return { original, runtime };
}

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
  const { original, runtime } = await beginRetained(page, "retained01");
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
    page.getByRole("heading", { name: "Resume approved", exact: true }),
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
      name: "Resume exam",
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
      name: /^(Work paused|Instructor review required)$/,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Reconnecting. Terminal input is paused.", {
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

test("retained WASM SSH control recovery preserves its authenticated worker and partial input", async ({
  page,
}) => {
  test.setTimeout(75000);
  let denyBindings = false,
    retries = 0,
    uploads = 0;
  let cutControl: (() => Promise<unknown>) | undefined;
  await page.routeWebSocket("**/api/auth/dialogue", (socket) => {
    const upstream = socket.connectToServer();
    cutControl = () =>
      Promise.all([
        socket.close({
          code: 4001,
          reason: "Synthetic SSH coordination fault",
        }),
        upstream.close({
          code: 4001,
          reason: "Synthetic SSH coordination fault",
        }),
      ]);
  });
  await page.routeWebSocket("**/api/browser/ssh", (socket) => {
    retries++;
    if (denyBindings) {
      void socket.close({
        code: 4002,
        reason: "Synthetic bounded control outage",
      });
      return;
    }
    socket.connectToServer();
  });
  page.on("response", (response) => {
    if (
      new URL(response.url()).pathname.endsWith("/frames/challenged") &&
      response.status() === 200
    )
      uploads++;
  });
  const { original, runtime } = await beginRetained(page, "retained02");
  const ownPanes = (value: any) =>
    value.panes.filter((p: any) => p.attempt === original.id);
  const ownWorker = (value: any) =>
    value.workers.filter((w: any) => w.username === "retained02");
  expect(ownPanes(runtime)).toHaveLength(1);
  expect(ownWorker(runtime)).toHaveLength(1);
  expect(ownWorker(runtime)[0].pid).toBeGreaterThan(0);
  expect(runtime.terminalOpens).toBeGreaterThan(0);
  await page.locator(".xterm-helper-textarea").last().focus();
  await page.keyboard.type("ssh-control-buffer-");
  await expect(page.locator(".xterm-rows")).toContainText(
    "ssh-control-buffer-",
  );
  const beforeUploads = uploads;
  denyBindings = true;
  expect(cutControl).toBeDefined();
  await cutControl!();
  const reconnecting = page.getByText("Reconnecting · input blocked", {
    exact: true,
  });
  await expect(reconnecting).toBeVisible({ timeout: 5000 });
  await expect.poll(() => retries, { timeout: 5000 }).toBeGreaterThan(1);
  await page
    .locator(".xterm-helper-textarea")
    .last()
    .evaluate((element) => {
      const input = element as HTMLTextAreaElement;
      input.value = "DISCARDED_SSH_CONTROL_INPUT";
      input.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          data: "DISCARDED_SSH_CONTROL_INPUT",
          inputType: "insertText",
        }),
      );
    });
  await page.waitForTimeout(17500);
  const delayed = (await (await page.request.get("/api/student/exam")).json())
    .attempt;
  expect(
    delayed.state,
    `A control timeout must not become ${delayed.reason}`,
  ).toBe("ACTIVE");
  expect(delayed).toMatchObject({
    id: original.id,
    monitoring_mode: "v1",
    generation: original.generation,
    start: original.start,
    deadline: original.deadline,
    original_deadline: original.original_deadline,
  });
  expect(uploads - beforeUploads).toBeGreaterThanOrEqual(3);
  const held = await (await page.request.get("/api/fixture/runtime")).json();
  expect(held.authenticationCalls).toEqual(runtime.authenticationCalls);
  expect(held.terminalOpens).toBe(runtime.terminalOpens);
  expect(ownWorker(held)).toEqual(ownWorker(runtime));
  expect(ownPanes(held)).toEqual(ownPanes(runtime));
  await expect(
    page.getByRole("heading", {
      name: /^(Work paused|Instructor review required)$/,
    }),
  ).toHaveCount(0);
  denyBindings = false;
  await expect(reconnecting).toHaveCount(0, { timeout: 10000 });
  await page.locator(".xterm-helper-textarea").last().focus();
  await page.keyboard.type("fresh");
  await page.keyboard.press("Enter");
  await expect(page.locator(".xterm-rows")).toContainText(
    "Echo: ssh-control-buffer-fresh",
    { timeout: 5000 },
  );
  await expect(page.locator(".xterm-rows")).not.toContainText(
    "DISCARDED_SSH_CONTROL_INPUT",
  );
  const final = await (await page.request.get("/api/fixture/runtime")).json();
  expect(final.authenticationCalls).toEqual(runtime.authenticationCalls);
  expect(final.terminalOpens).toBe(runtime.terminalOpens);
  expect(ownWorker(final)).toEqual(ownWorker(runtime));
  expect(ownPanes(final)).toEqual(ownPanes(runtime));
});

test("missing loaded JS control agreement refuses actual Begin before native start or grant consumption", async ({
  page,
}) => {
  test.setTimeout(45000);
  let changedProducer = 0;
  let features: Record<string, unknown> | undefined;
  await page.route("**/assets/index-*.js", async (route) => {
    const response = await route.fetch(),
      body = await response.text();
    const field = /loaded_control_retention:"v1"/g;
    // Initial connect and retained restoration both declare the loaded feature.
    // Mutate both producers; the actual authentication wire is the refusal oracle.
    expect([...body.matchAll(field)]).toHaveLength(2);
    changedProducer++;
    await route.fulfill({
      response,
      body: body.replace(field, "loaded_control_retention:void 0"),
    });
  });
  await page.routeWebSocket("**/api/auth/dialogue", (socket) => {
    const upstream = socket.connectToServer();
    socket.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      if (
        message.type === "browser-result" &&
        message.result?.loaded_pane_input === "v1"
      ) {
        features = {
          framed: message.result.framed_input,
          pane: message.result.loaded_pane_input,
          epoch: message.result.pane_epoch_change,
          loadedEpoch: message.result.loaded_pane_epoch_change,
          controlPresent: Object.hasOwn(
            message.result,
            "loaded_control_retention",
          ),
        };
      }
      upstream.send(raw);
    });
  });
  await prepareRetained(page, "retained03");
  expect(changedProducer).toBe(1);
  expect(features).toEqual({
    framed: true,
    pane: "v1",
    epoch: true,
    loadedEpoch: "v1",
    controlPresent: false,
  });
  const before = (await (await page.request.get("/api/student/exam")).json())
    .attempt;
  expect(before).toMatchObject({
    state: "PREPARING",
    start: null,
    deadline: null,
    grant_id: expect.any(String),
    grant_revision: 1,
    grant_begin_intent: null,
  });
  const result = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/attempts/${before.id}/begin`) &&
      response.request().method() === "POST",
    { timeout: 10000 },
  );
  await page
    .getByRole("button", { name: "Start exam", exact: true })
    .click({ timeout: 5000 });
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Start exam", exact: true })
    .click({ timeout: 5000 });
  const refused = await result;
  expect(refused.status(), await refused.text()).toBe(400);
  expect((await refused.json()).error).toContain(
    "matching browser and server versions",
  );
  const after = (await (await page.request.get("/api/student/exam")).json())
    .attempt;
  expect(after).toMatchObject({
    id: before.id,
    state: "PREPARING",
    start: null,
    deadline: null,
    grant_id: before.grant_id,
    grant_revision: before.grant_revision,
    grant_begin_intent: null,
    settings: before.settings,
  });
  const runtime = await (await page.request.get("/api/fixture/runtime")).json();
  expect(
    runtime.nativeBeginRequests.filter((id: string) => id === before.id),
  ).toEqual([]);
  expect(runtime.retainedRegistrations).toContainEqual({
    exam: "retained-control",
    username: "retained03",
    retained_monitoring: "v1",
  });
});
