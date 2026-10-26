import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { simulatedMedia, ready } from "./transition-fixture.js";

async function begin(page: Page, username: string) {
  await simulatedMedia(page);
  await page.goto("/");
  expect(
    (await (await page.request.get("/api/login-test")).json()).browserSSH,
  ).toBe(true);
  await page.getByLabel("Exam ID", { exact: true }).fill("retained-restart");
  await page.getByLabel("Enrolled username").fill(username);
  await page
    .getByRole("button", { name: "Start SSH sign-in", exact: true })
    .click();
  await page.getByLabel("Shared SSH password").fill("shared-password");
  await page
    .getByRole("button", { name: "Respond to this host", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Open preflight & practice", exact: true })
    .click({ timeout: 10000 });
  await ready(page);
  await page.getByRole("button", { name: "Begin exam", exact: true }).click();
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
  expect(original).toMatchObject({
    state: "ACTIVE",
    monitoring_mode: "v1",
    grant_id: expect.any(String),
  });
  return original;
}

async function runtime(page: Page) {
  const response = await page.request.get("/api/fixture/runtime", {
    timeout: 2000,
  });
  expect(response.status(), await response.text()).toBe(200);
  return response.json();
}

async function fixture(page: Page, path: string, data: unknown) {
  const session = await (await page.request.get("/api/session")).json();
  const response = await page.request.post(`/api/fixture/${path}`, {
    headers: { origin: "http://localhost:3100", "x-csrf-token": session.csrf },
    data,
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}

async function restart(
  page: Page,
  previous: number,
  mode: "kill" | "graceful" = "kill",
) {
  expect((await fixture(page, "gateway-restart", { mode })).previous).toBe(
    previous,
  );
  await expect
    .poll(
      async () => {
        try {
          return (await runtime(page)).pid;
        } catch {
          return previous;
        }
      },
      { timeout: 15000 },
    )
    .not.toBe(previous);
}

function sameInterval(original: any) {
  return Object.fromEntries(
    [
      "id",
      "grant_id",
      "start",
      "deadline",
      "original_deadline",
      "generation",
      "clock_revision",
      "registered_owner",
    ].map((key) => [key, original[key]]),
  );
}

test("capture recovery restores terminal input when React coalesces the failed and healthy samples", async ({
  page,
}) => {
  test.setTimeout(45000);
  page.setDefaultTimeout(5000);
  // Delay only React's null MessageChannel task, not capture, sockets, worker
  // messages or browser timers. This makes the otherwise load-dependent pair of
  // health updates deterministic without granting any execution authority.
  await page.addInitScript(() => {
    const gate = { hold: false, delayed: 0, pending: [] as MessagePort[] };
    (window as any).__renderDeliveryGate = gate;
    const Original = window.MessageChannel;
    window.MessageChannel = class extends Original {
      constructor() {
        super();
        this.port1.addEventListener("message", (event) => {
          if (!gate.hold || event.data !== null) return;
          event.stopImmediatePropagation();
          gate.delayed++;
          gate.pending.push(this.port1);
        });
      }
    };
  });
  let failNext = false;
  await page.route("**/capture-challenges", async (route) => {
    if (failNext && route.request().postDataJSON().source === "screen") {
      failNext = false;
      await route.fulfill({
        status: 503,
        json: { error: "Synthetic verification delay" },
      });
    } else await route.continue();
  });
  const original = await begin(page, "retained15"),
    before = await runtime(page);
  await page.locator(".xterm-helper-textarea").last().focus();
  await page.keyboard.type("coalesced-private-");
  await expect(page.locator(".xterm-rows")).toContainText("coalesced-private-");
  const failed = page.waitForResponse(
    (response) =>
      response.url().endsWith("/capture-challenges") &&
      response.status() === 503,
  );
  await page.evaluate(() => {
    (window as any).__renderDeliveryGate.hold = true;
  });
  failNext = true;
  try {
    await (await failed).finished();
    await expect
      .poll(() =>
        page.evaluate(() => (window as any).__renderDeliveryGate.delayed),
      )
      .toBeGreaterThan(0);
    const recovered = await page.waitForResponse(
      (response) =>
        response.url().endsWith("/frames/challenged") &&
        response.status() === 200 &&
        response.request().postDataJSON().source === "screen",
      { timeout: 7000 }, // Capture's actual sampling interval is five seconds.
    );
    await recovered.finished();
    // Let fetch.json()/sampleHealth finish while rendering is still held.
    await page.evaluate(
      () => new Promise((resolve) => setTimeout(resolve, 25)),
    );
    await expect(
      page.getByText("Monitoring verification delayed · input blocked", {
        exact: true,
      }),
    ).toHaveCount(0);
  } finally {
    await page.evaluate(() => {
      const gate = (window as any).__renderDeliveryGate;
      gate.hold = false;
      for (const port of gate.pending.splice(0))
        port.dispatchEvent(new MessageEvent("message", { data: null }));
    });
  }
  await expect(
    page.getByText("Monitoring verification delayed · input blocked", {
      exact: true,
    }),
  ).toHaveCount(0);
  await page.locator(".xterm-helper-textarea").last().focus();
  await page.keyboard.type("recovered");
  await page.keyboard.press("Enter");
  await expect(page.locator(".xterm-rows")).toContainText(
    "Echo: coalesced-private-recovered",
  );
  expect(
    (await (await page.request.get("/api/student/exam")).json()).attempt,
  ).toMatchObject({ ...sameInterval(original), state: "ACTIVE" });
  const after = await runtime(page);
  expect(after.authenticationCalls).toEqual(before.authenticationCalls);
  expect(after.terminalOpens).toBe(before.terminalOpens);
});

test("graceful gateway shutdown preserves the original SSH, buffer and interval without a policy hold", async ({
  page,
}) => {
  test.skip(
    process.env.EXAM_BROWSER_GATEWAY_PROCESS !== "1",
    "Requires the private process fixture",
  );
  test.setTimeout(60000);
  page.setDefaultTimeout(5000);
  const original = await begin(page, "retained14"),
    before = await runtime(page),
    owner = JSON.parse(original.registered_owner);
  expect(before.gatewayProcess).toBe(true);
  expect(before.sshTransports).toContainEqual({
    transport: owner.transport_hash,
    username: "retained14",
    closed: false,
  });
  await page.locator(".xterm-helper-textarea").last().focus();
  await page.keyboard.type("graceful-private-");
  await expect(page.locator(".xterm-rows")).toContainText("graceful-private-");
  await restart(page, before.pid, "graceful");
  const current = (await (await page.request.get("/api/student/exam")).json())
    .attempt;
  expect(current).toMatchObject({ ...sameInterval(original), state: "ACTIVE" });
  await expect(
    page.getByText("Reconnecting · input blocked", { exact: true }),
  ).toHaveCount(0, { timeout: 10000 });
  await expect(
    page.getByRole("heading", { name: "Instructor review required" }),
  ).toHaveCount(0);
  await page.locator(".xterm-helper-textarea").last().focus();
  await page.keyboard.type("verified");
  await page.keyboard.press("Enter");
  await expect(page.locator(".xterm-rows")).toContainText(
    "Echo: graceful-private-verified",
  );
  const final = await runtime(page);
  expect(final.fixturePID).toBe(before.fixturePID);
  expect(final.authenticationCalls).toEqual(before.authenticationCalls);
  expect(final.terminalOpens).toBe(before.terminalOpens);
  expect(final.sshTransports).toContainEqual({
    transport: owner.transport_hash,
    username: "retained14",
    closed: false,
  });
});

async function approve(request: APIRequestContext, id: string) {
  const login = await request.post("/api/admin/login", {
    headers: { origin: "http://localhost:3100" },
    data: { username: "instructor", password: "fixture-password" },
  });
  expect(login.ok(), await login.text()).toBe(true);
  const selected = await (
    await request.get(`/api/admin/attempts/${id}/interruption`)
  ).json();
  const response = await request.post(`/api/admin/attempts/${id}/authorize`, {
    headers: {
      origin: "http://localhost:3100",
      "x-csrf-token": (await login.json()).csrf,
    },
    data: {
      generation: selected.generation,
      revision: selected.revision,
      requestID: crypto.randomUUID(),
      reason: "Reviewed synthetic pending pause",
    },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return (await request.get(`/api/admin/attempts/${id}/interruption`)).json();
}

test("an actual gateway restart re-verifies the same live SSH and private shell buffer without a policy violation", async ({
  page,
}) => {
  test.skip(
    process.env.EXAM_BROWSER_GATEWAY_PROCESS !== "1",
    "Requires the independent, disposable gateway-process fixture",
  );
  test.setTimeout(75000);
  page.setDefaultTimeout(5000);
  let restarting = false,
    connections = 0,
    uploads = 0;
  const replies: { connection: number; message: any }[] = [];
  const withheld: any[] = [];
  await page.routeWebSocket("**/api/student/session", (socket) => {
    const connection = ++connections,
      upstream = socket.connectToServer();
    socket.onMessage((raw) => upstream.send(raw));
    upstream.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      if (restarting && message.type === "state")
        replies.push({ connection, message });
      // Hold an erroneous loss claim at its exact boundary so its receipt
      // cannot itself close the live SSH before the positive observation.
      if (restarting && message.authenticationGap) {
        withheld.push(message);
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
  const original = await begin(page, "retained07");
  const runtime = async () => {
    const response = await page.request.get("/api/fixture/runtime", {
      timeout: 2000,
    });
    expect(response.status(), await response.text()).toBe(200);
    return response.json();
  };
  const before = await runtime(),
    owner = JSON.parse(original.registered_owner);
  expect(before.gatewayProcess).toBe(true);
  expect(before.pid).not.toBe(before.fixturePID);
  expect(before.sshTransports).toContainEqual({
    transport: owner.transport_hash,
    username: "retained07",
    closed: false,
  });
  await page.locator(".xterm-helper-textarea").last().focus();
  await page.keyboard.type("restart-private-buffer-");
  await expect(page.locator(".xterm-rows")).toContainText(
    "restart-private-buffer-",
  );
  const boundBefore = connections,
    uploadsBefore = uploads;
  const session = await (await page.request.get("/api/session")).json();
  restarting = true;
  const injected = await page.request.post("/api/fixture/gateway-restart", {
    headers: { origin: "http://localhost:3100", "x-csrf-token": session.csrf },
    data: {},
  });
  expect(injected.ok(), await injected.text()).toBe(true);
  expect((await injected.json()).previous).toBe(before.pid);
  await expect
    .poll(
      async () => {
        try {
          return (await runtime()).pid;
        } catch {
          return before.pid;
        }
      },
      { timeout: 15000 },
    )
    .not.toBe(before.pid);
  const replacement = await runtime();
  expect(replacement.fixturePID).toBe(before.fixturePID);
  expect(replacement.sshTransports).toContainEqual({
    transport: owner.transport_hash,
    username: "retained07",
    closed: false,
  });
  expect(replacement.authenticationCalls).toEqual(before.authenticationCalls);
  await expect
    .poll(
      () =>
        replies.filter((r) => r.connection > boundBefore && !r.message.binding)
          .length,
      {
        timeout: 10000,
        message:
          "Require an actual new-gateway contact reply, not merely an elapsed reconnect timer",
      },
    )
    .toBeGreaterThan(0);
  const observed = await runtime();
  expect(observed.sshTransports).toContainEqual({
    transport: owner.transport_hash,
    username: "retained07",
    closed: false,
  });
  expect(
    replies.filter(
      (r) => r.message.attempt?.reason === "Required SSH/capture health lost",
    ),
    "A missing gateway connection object is not a proven SSH/capture loss",
  ).toHaveLength(0);
  expect(
    withheld,
    "A memory gap cannot demand fresh SSH on this still-live transport",
  ).toHaveLength(0);
  await expect(
    page.getByText("Reconnecting · input blocked", { exact: true }),
  ).toHaveCount(0, { timeout: 10000 });
  await expect
    .poll(() => uploads, { timeout: 10000 })
    .toBeGreaterThan(uploadsBefore);
  await page.locator(".xterm-helper-textarea").last().focus();
  await page.keyboard.type("verified");
  await page.keyboard.press("Enter");
  await expect(page.locator(".xterm-rows")).toContainText(
    "Echo: restart-private-buffer-verified",
  );
  const after = (await (await page.request.get("/api/student/exam")).json())
    .attempt;
  expect(after).toMatchObject({
    id: original.id,
    state: "ACTIVE",
    grant_id: original.grant_id,
    start: original.start,
    deadline: original.deadline,
    original_deadline: original.original_deadline,
    generation: original.generation,
    clock_revision: original.clock_revision,
    registered_owner: original.registered_owner,
  });
  expect((await runtime()).authenticationCalls).toEqual(
    before.authenticationCalls,
  );
});

for (const [mode, username] of [
  ["page", "retained09"],
  ["transport", "retained10"],
  ["clock", "retained11"],
])
  test(`gateway rebind refuses mismatched native ${mode} without consuming or closing the original SSH`, async ({
    page,
  }) => {
    test.skip(
      process.env.EXAM_BROWSER_GATEWAY_PROCESS !== "1",
      "Requires independent disposable gateway",
    );
    test.setTimeout(75000);
    page.setDefaultTimeout(5000);
    const original = await begin(page, username),
      before = await runtime(page),
      owner = JSON.parse(original.registered_owner);
    await page.locator(".xterm-helper-textarea").last().focus();
    await page.keyboard.type(`${mode}-private-`);
    await expect(page.locator(".xterm-rows")).toContainText(`${mode}-private-`);
    const accepted = before.framedInput.accepted.length;
    await fixture(page, "retained-inspection-fault", { username, mode });
    await restart(page, before.pid);
    await expect
      .poll(
        async () =>
          (await runtime(page)).retainedInspections.filter(
            (entry: any) =>
              entry.attempt === original.id &&
              entry.mode === mode &&
              entry.gatewayPID !== before.pid,
          ).length,
        {
          timeout: 15000,
          message:
            "Require repeated actual signed inspection refusals, not a reconnect timeout",
        },
      )
      .toBeGreaterThanOrEqual(2);
    const refused = await runtime(page);
    expect(refused.sshTransports).toContainEqual({
      transport: owner.transport_hash,
      username,
      closed: false,
    });
    expect(refused.authenticationCalls).toEqual(before.authenticationCalls);
    expect(refused.terminalOpens).toEqual(before.terminalOpens);
    expect(
      refused.retainedAttempts.find((a: any) => a.id === original.id),
    ).toMatchObject({
      ...sameInterval(original),
      state: "ACTIVE",
    });
    await expect(
      page.getByText("Reconnecting · input blocked", { exact: true }),
    ).toBeVisible();
    // The refusal stage is positively established above. Typing cannot reach the
    // old channel while a contradictory native proof is the only available proof.
    const refusedInput = refused.framedInput.accepted.length;
    expect(refusedInput).toBeGreaterThanOrEqual(accepted);
    await page.locator(".xterm-helper-textarea").last().focus();
    await page.keyboard.type("must-not-replay");
    expect((await runtime(page)).framedInput.accepted.length).toBe(
      refusedInput,
    );
    await fixture(page, "retained-inspection-fault", {
      username,
      mode: "none",
    });
    await expect(
      page.getByText("Reconnecting · input blocked", { exact: true }),
    ).toHaveCount(0, { timeout: 10000 });
    await page.locator(".xterm-helper-textarea").last().focus();
    await page.keyboard.type("verified");
    await page.keyboard.press("Enter");
    await expect(page.locator(".xterm-rows")).toContainText(
      `Echo: ${mode}-private-verified`,
    );
    expect((await runtime(page)).authenticationCalls).toEqual(
      before.authenticationCalls,
    );
    const after = (await (await page.request.get("/api/student/exam")).json())
      .attempt;
    expect(after).toMatchObject({ ...sameInterval(original), state: "ACTIVE" });
  });

test("proxy failure and gateway restart preserve a policy hold and its scoped approval on the same SSH", async ({
  page,
  request,
}) => {
  test.skip(
    process.env.EXAM_BROWSER_GATEWAY_PROCESS !== "1",
    "Requires independent disposable gateway",
  );
  test.setTimeout(90000);
  page.setDefaultTimeout(5000);
  const original = await begin(page, "retained08"),
    before = await runtime(page);
  await page.locator(".xterm-helper-textarea").last().focus();
  await page.keyboard.type("approved-private-");
  await expect(page.locator(".xterm-rows")).toContainText("approved-private-");
  await page.evaluate(() => document.exitFullscreen());
  await expect(page.locator(".lock-overlay")).toBeVisible({ timeout: 10000 });
  const paused = (await (await page.request.get("/api/student/exam")).json())
    .attempt;
  expect(paused).toMatchObject({
    state: "LOCKED",
    generation: original.generation + 1,
    deadline: original.deadline,
  });
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
        reason: "Reviewed synthetic gateway restart policy hold",
      },
    },
  );
  expect(approval.ok(), await approval.text()).toBe(true);
  await expect(
    page.getByRole("heading", { name: "Continuation approved", exact: true }),
  ).toBeVisible({ timeout: 10000 });
  const { serverNow: approvedAt, ...approved } = await (
    await request.get(`/api/admin/attempts/${original.id}/interruption`)
  ).json();
  const proxy = (await runtime(page)).workers.find(
    (w: any) => w.username === "retained08",
  );
  expect(
    (await fixture(page, "fault", { username: "retained08", fault: "kill" }))
      .pid,
  ).toBe(proxy.pid);
  await expect
    .poll(
      async () => {
        const current = (await runtime(page)).workers.find(
          (w: any) => w.username === "retained08",
        );
        return !!current && current.pid !== proxy.pid;
      },
      { timeout: 10000 },
    )
    .toBe(true);
  await expect(
    page.getByText("Reconnecting · input blocked", { exact: true }),
  ).toHaveCount(0, { timeout: 10000 });
  expect(
    (await (await page.request.get("/api/student/exam")).json()).attempt,
  ).toMatchObject({ ...sameInterval(paused), state: "LOCKED" });
  const { serverNow: inspectedAt, ...afterProxy } = await (
    await request.get(`/api/admin/attempts/${original.id}/interruption`)
  ).json();
  expect(inspectedAt).toBeGreaterThanOrEqual(approvedAt);
  expect(afterProxy).toEqual(approved);
  await expect(
    page.getByRole("heading", { name: "Continuation approved", exact: true }),
  ).toBeVisible();
  await restart(page, before.pid);
  await expect
    .poll(
      async () =>
        (await runtime(page)).retainedInspections.filter(
          (entry: any) =>
            entry.attempt === original.id && entry.gatewayPID !== before.pid,
        ).length,
      { timeout: 10000 },
    )
    .toBeGreaterThan(0);
  await expect(
    page.getByText("Reconnecting · input blocked", { exact: true }),
  ).toHaveCount(0, { timeout: 10000 });
  const held = (await (await page.request.get("/api/student/exam")).json())
    .attempt;
  expect(held).toMatchObject({ ...sameInterval(paused), state: "LOCKED" });
  await expect(
    page.getByRole("heading", { name: "Continuation approved", exact: true }),
  ).toBeVisible();
  expect((await runtime(page)).authenticationCalls).toEqual(
    before.authenticationCalls,
  );
  await page
    .getByRole("button", { name: "Restore fullscreen", exact: true })
    .click();
  const keyboard = page.getByRole("button", {
    name: "Restore keyboard lock",
    exact: true,
  });
  if ((await keyboard.getAttribute("aria-pressed")) !== "true")
    await keyboard.click();
  await expect(keyboard).toHaveAttribute("aria-pressed", "true");
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
    .click();
  const response = await continued;
  expect(response.status(), await response.text()).toBe(200);
  await expect(page.locator(".lock-overlay")).toHaveCount(0, {
    timeout: 10000,
  });
  await page.locator(".xterm-helper-textarea").last().focus();
  await page.keyboard.type("verified");
  await page.keyboard.press("Enter");
  await expect(page.locator(".xterm-rows")).toContainText(
    "Echo: approved-private-verified",
  );
  expect((await runtime(page)).authenticationCalls).toEqual(
    before.authenticationCalls,
  );
  const after = (await (await page.request.get("/api/student/exam")).json())
    .attempt;
  expect(after).toMatchObject({
    ...sameInterval(paused),
    state: "ACTIVE",
    registered_owner: expect.any(String),
  });
  expect(JSON.parse(after.registered_owner).generation).toBe(paused.generation);
});

test("a policy report lost across gateway replacement is acknowledged before positive capture resumes", async ({
  page,
  request,
}) => {
  test.skip(
    process.env.EXAM_BROWSER_GATEWAY_PROCESS !== "1",
    "Requires independent disposable gateway",
  );
  test.setTimeout(75000);
  page.setDefaultTimeout(5000);
  let releaseReports = false;
  const dropped: any[] = [],
    forwarded: any[] = [],
    receipts: any[] = [];
  await page.routeWebSocket("**/api/student/session", (socket) => {
    const upstream = socket.connectToServer();
    socket.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      if (message.type === "incident") {
        if (!releaseReports) {
          dropped.push(message);
          return;
        }
        forwarded.push(message);
      }
      upstream.send(raw);
    });
    upstream.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      if (message.type === "incident-recorded") {
        receipts.push(message);
        if (receipts.length === 1) {
          releaseReports = false;
          return; // Lose the receipt after the genuine pause committed.
        }
      }
      socket.send(raw);
    });
  });
  // The fault loses the original negative frame too. A later restored-condition
  // JPEG must not erase the pending negative socket report.
  await page.route("**/frames/challenged", async (route) => {
    const readiness = route.request().postDataJSON().readiness;
    if (
      ["fullscreen", "visible", "keyboard", "screen"].some(
        (key) => readiness?.[key] !== true,
      )
    )
      await route.abort("failed");
    else await route.continue();
  });
  const original = await begin(page, "retained12"),
    before = await runtime(page),
    owner = JSON.parse(original.registered_owner);
  await page.locator(".xterm-helper-textarea").last().focus();
  await page.keyboard.type("policy-private-");
  await expect(page.locator(".xterm-rows")).toContainText("policy-private-");
  await page.evaluate(() => document.exitFullscreen());
  await expect.poll(() => dropped.length, { timeout: 5000 }).toBeGreaterThan(0);
  await page
    .getByRole("button", { name: "Restore fullscreen", exact: true })
    .click();
  const keyboard = page.getByRole("button", {
    name: "Restore keyboard lock",
    exact: true,
  });
  if ((await keyboard.getAttribute("aria-pressed")) !== "true")
    await keyboard.click();
  expect(
    (await (await page.request.get("/api/student/exam")).json()).attempt.state,
  ).toBe("ACTIVE");
  await restart(page, before.pid);
  releaseReports = true;
  await expect
    .poll(
      async () =>
        (await (await page.request.get("/api/student/exam")).json()).attempt,
      {
        timeout: 12000,
        message:
          "Require the lost genuine policy report to reach the replacement gateway's durable hold",
      },
    )
    .toMatchObject({ state: "LOCKED", reason: dropped[0].reason });
  await expect
    .poll(() => receipts.length, { timeout: 5000 })
    .toBeGreaterThan(0);
  const login = await request.post("/api/admin/login", {
    headers: { origin: "http://localhost:3100" },
    data: { username: "instructor", password: "fixture-password" },
  });
  expect(login.ok(), await login.text()).toBe(true);
  const selected = await (
    await request.get(`/api/admin/attempts/${original.id}/interruption`)
  ).json();
  const authorization = await request.post(
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
        reason: "Reviewed synthetic policy before lost acknowledgement retry",
      },
    },
  );
  expect(authorization.ok(), await authorization.text()).toBe(true);
  const approved = await (
    await request.get(`/api/admin/attempts/${original.id}/interruption`)
  ).json();
  expect(approved.authorization).toMatchObject({
    generation: original.generation + 1,
    consumed: 0,
  });
  releaseReports = true;
  await expect
    .poll(() => receipts.length, { timeout: 5000 })
    .toBeGreaterThanOrEqual(2);
  const repeated = await (
    await request.get(`/api/admin/attempts/${original.id}/interruption`)
  ).json();
  expect(repeated).toMatchObject({
    generation: approved.generation,
    revision: approved.revision,
    authorization: approved.authorization,
  });
  expect(dropped[0].report).toMatch(/^[a-f0-9-]{36}$/);
  expect(forwarded).not.toHaveLength(0);
  expect(
    forwarded.every(
      (m) =>
        m.report === dropped[0].report && m.generation === original.generation,
    ),
  ).toBe(true);
  expect(receipts).toContainEqual(
    expect.objectContaining({
      attempt: original.id,
      report: dropped[0].report,
      generation: original.generation,
    }),
  );
  const after = (await (await page.request.get("/api/student/exam")).json())
    .attempt;
  expect(after).toMatchObject({
    ...sameInterval(original),
    state: "LOCKED",
    generation: original.generation + 1,
    reason: dropped[0].reason,
  });
  const observed = await runtime(page);
  expect(observed.authenticationCalls).toEqual(before.authenticationCalls);
  expect(observed.terminalOpens).toBe(before.terminalOpens);
  expect(observed.sshTransports).toContainEqual({
    transport: owner.transport_hash,
    username: "retained12",
    closed: false,
  });
});

test("gateway recovery completes a durably recorded policy pause rejected by native without revoking approval", async ({
  page,
  request,
}) => {
  test.skip(
    process.env.EXAM_BROWSER_GATEWAY_PROCESS !== "1",
    "Requires independent disposable gateway",
  );
  test.setTimeout(90000);
  page.setDefaultTimeout(5000);
  const original = await begin(page, "retained13"),
    before = await runtime(page),
    owner = JSON.parse(original.registered_owner);
  await page.locator(".xterm-helper-textarea").last().focus();
  await page.keyboard.type("pending-private-");
  await expect(page.locator(".xterm-rows")).toContainText("pending-private-");
  await fixture(page, "refuse-retained-pause", { username: "retained13" });
  await page.evaluate(() => document.exitFullscreen());
  await expect
    .poll(async () => (await runtime(page)).refusedRetainedPauses, {
      timeout: 10000,
    })
    .toContain(original.id);
  await expect
    .poll(
      async () =>
        (await (await page.request.get("/api/student/exam")).json()).attempt
          .state,
      { timeout: 5000 },
    )
    .toBe("LOCKED");
  expect((await runtime(page)).nativeRetainedAttempts).toContainEqual({
    id: original.id,
    state: "ACTIVE",
    generation: original.generation,
  });
  const approved = await approve(request, original.id);
  expect(approved.authorization).toMatchObject({
    consumed: 0,
    generation: original.generation + 1,
  });
  await restart(page, before.pid);
  await expect
    .poll(
      async () =>
        (await runtime(page)).retainedInspections.filter(
          (r: any) => r.attempt === original.id && r.gatewayPID !== before.pid,
        ).length,
      { timeout: 10000 },
    )
    .toBeGreaterThan(0);
  await expect(
    page.getByText("Reconnecting · input blocked", { exact: true }),
  ).toHaveCount(0, { timeout: 10000 });
  const reconciled = await runtime(page);
  expect(reconciled.nativeRetainedAttempts).toContainEqual({
    id: original.id,
    state: "LOCKED",
    generation: original.generation + 1,
  });
  expect(reconciled.authenticationCalls).toEqual(before.authenticationCalls);
  expect(reconciled.sshTransports).toContainEqual({
    transport: owner.transport_hash,
    username: "retained13",
    closed: false,
  });
  const afterRebind = await (
    await request.get(`/api/admin/attempts/${original.id}/interruption`)
  ).json();
  expect(afterRebind).toMatchObject({
    generation: approved.generation,
    revision: approved.revision,
    authorization: approved.authorization,
  });
  await page
    .getByRole("button", { name: "Restore fullscreen", exact: true })
    .click();
  const keyboard = page.getByRole("button", {
    name: "Restore keyboard lock",
    exact: true,
  });
  if ((await keyboard.getAttribute("aria-pressed")) !== "true")
    await keyboard.click();
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
    .click();
  const response = await continued;
  expect(response.status(), await response.text()).toBe(200);
  await expect(page.locator(".lock-overlay")).toHaveCount(0, {
    timeout: 10000,
  });
  await page.locator(".xterm-helper-textarea").last().focus();
  await page.keyboard.type("continued");
  await page.keyboard.press("Enter");
  await expect(page.locator(".xterm-rows")).toContainText(
    "Echo: pending-private-continued",
  );
  const after = (await (await page.request.get("/api/student/exam")).json())
    .attempt;
  expect(after).toMatchObject({
    ...sameInterval(original),
    state: "ACTIVE",
    generation: original.generation + 1,
    registered_owner: expect.any(String),
  });
  expect((await runtime(page)).authenticationCalls).toEqual(
    before.authenticationCalls,
  );
});
