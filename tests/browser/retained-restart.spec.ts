import { test, expect, type Page } from "@playwright/test";
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

async function restart(page: Page, previous: number) {
  expect((await fixture(page, "gateway-restart", {})).previous).toBe(previous);
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

test("gateway restart preserves a policy hold and its scoped approval on the same SSH", async ({
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
