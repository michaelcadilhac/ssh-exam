import { test, expect } from "@playwright/test";
import { z } from "zod";
import { mkdir, writeFile } from "node:fs/promises";
import { simulatedMedia, ready } from "./transition-fixture.js";

// types.go Attempt serializes retained_hold as a STRING. The independent live
// supervisor has a separate view; kernel observations are mandatory below.
const nativeProbe = z.object({
  private_guest: z.literal(true),
  editor_exists: z.boolean(),
  writer_bytes: z.number().int().nonnegative(),
  attempt: z
    .object({
      state: z.string(),
      start: z.number(),
      deadline: z.number(),
      original_deadline: z.number(),
      transport: z.string(),
      generation: z.number().int(),
      retained_hold: z.string().optional(),
      monitoring_hold_kind: z.string().optional(),
      grant: z.unknown(),
    })
    .passthrough(),
  supervisor: z
    .object({
      pid: z.number().int().positive().optional(),
      ssh_peer: z.string().optional(),
      attached_panes: z.number().int().optional(),
    })
    .passthrough()
    .nullable(),
  kernel: z.array(
    z.object({
      unit: z.string(),
      frozen: z.enum(["0", "1"]),
      populated: z.enum(["0", "1"]),
    }),
  ),
});

let failureAttempt = "";
const failureStates: unknown[] = [];
test.afterEach(async ({ page }, info) => {
  if (
    !process.env.EXAM_BROWSER_NATIVE_BUNDLE ||
    info.status === "passed" ||
    !failureAttempt
  )
    return;
  try {
    const diagnostic = async (name: string, value: unknown) => {
      await mkdir(info.outputDir, { recursive: true });
      const path = info.outputPath(name + ".json");
      await writeFile(
        path,
        Buffer.isBuffer(value) ? value : JSON.stringify(value),
        { mode: 0o600 },
      );
      await info.attach(name, { path, contentType: "application/json" });
    };
    const response = await page.request.get("/api/fixture/native-state", {
      params: { attempt: failureAttempt },
      timeout: 10000,
    });
    await diagnostic("native-boundary-state", await response.body());
    await diagnostic("student-control-boundary", failureStates);
    const focus = await page.evaluate(() => ({
      activeTag: document.activeElement?.tagName,
      activeClass: document.activeElement?.className,
      activeLabel: document.activeElement?.getAttribute("aria-label"),
      visible: document.visibilityState,
      focused: document.hasFocus(),
      fullscreen: !!document.fullscreenElement,
      terminals: [...document.querySelectorAll(".xterm-helper-textarea")].map(
        (element) => ({
          connected: element.isConnected,
          inert: !!element.closest("[inert]"),
        }),
      ),
    }));
    await diagnostic("browser-input-boundary", focus);
  } catch {
    /* Preserve the original failure if the independent probe refuses. */
  }
});

test("actual native kernel hold and explicit Continue preserve the same browser SSH and private buffer through protected finish", async ({
  page,
  request,
}) => {
  test.skip(
    !process.env.EXAM_BROWSER_NATIVE_BUNDLE ||
      process.env.EXAM_BROWSER_NATIVE_STUDENTS === "16",
    "Requires the guarded disposable native guest and private code-only bundle",
  );
  test.setTimeout(150000);
  page.setDefaultTimeout(10000);
  failureAttempt = "";
  failureStates.length = 0;
  const processMode = process.env.EXAM_BROWSER_NATIVE_GATEWAY_PROCESS === "1";
  const stallMode = process.env.EXAM_BROWSER_NATIVE_GATE_STALL === "1";
  const coordinatorMode =
    process.env.EXAM_BROWSER_NATIVE_COORDINATOR_OUTAGE === "1";
  const continuityMode =
    process.env.EXAM_BROWSER_NATIVE_COORDINATOR_CONTINUITY === "1";
  const technicalRecovery =
    process.env.EXAM_BROWSER_NATIVE_TECHNICAL_RECOVERY === "1";
  const technicalSecondary =
    process.env.EXAM_BROWSER_NATIVE_TECHNICAL_SECONDARY === "1";
  const clockRetry = process.env.EXAM_BROWSER_NATIVE_CONTINUE_CLOCK === "1";
  const technicalPartial =
    process.env.EXAM_BROWSER_NATIVE_TECHNICAL_PARTIAL === "1";
  expect(
    technicalPartial &&
      (!technicalRecovery || !coordinatorMode || technicalSecondary),
  ).toBe(false);
  expect(clockRetry && coordinatorMode).toBe(false);
  const technicalGap = coordinatorMode && !continuityMode && !technicalRecovery;
  let missingCaptureUntil = 0,
    droppedCaptures = 0;
  if (technicalGap) {
    // Actual failed HTTP uploads to this synthetic page, not fabricated ledger
    // facts. Live media remains available; v1 must report technical uncertainty.
    await page.route(
      "**/api/student/attempts/*/frames/challenged",
      async (route) => {
        if (performance.now() < missingCaptureUntil) {
          droppedCaptures++;
          await route.abort("timedout");
        } else await route.continue();
      },
    );
  }
  expect(technicalSecondary && !(technicalRecovery && coordinatorMode)).toBe(
    false,
  );
  expect(continuityMode && !coordinatorMode).toBe(false);
  expect(stallMode && coordinatorMode).toBe(false);
  expect(
    technicalRecovery && (!coordinatorMode || continuityMode || processMode),
  ).toBe(false);
  let coordinatorHeldBytes = 0;
  let bindingConnection = 0,
    confirmationConnection = 0,
    connections = 0,
    uploads = 0;
  let lastOpenRequest = "";
  let recoveryTransport = "";
  let manualContinue:
    | { headers: Record<string, string>; data: unknown }
    | undefined;
  page.on("request", (request) => {
    if (
      request.url().endsWith("/continue") &&
      request.method() === "POST" &&
      request.postDataJSON().automaticTechnical !== true
    ) {
      const headers = request.headers();
      manualContinue = {
        data: request.postDataJSON(),
        headers: {
          origin,
          "x-csrf-token": headers["x-csrf-token"] || "",
          "x-page-instance": headers["x-page-instance"] || "",
        },
      };
    }
  });
  const paneReplies = new Map<string, "opened" | "error">();
  page.on("response", (response) => {
    if (response.url().endsWith("/continue") && response.status() === 200)
      void response
        .json()
        .then((value) => {
          recoveryTransport = value.technicalRecoveryTransport || "";
        })
        .catch(() => {});
    if (
      response.url().endsWith("/frames/challenged") &&
      response.status() === 200
    )
      uploads++;
  });
  page.on("websocket", (socket) => {
    if (new URL(socket.url()).pathname !== "/api/student/session") return;
    const connection = ++connections;
    socket.on("framesent", ({ payload }) => {
      try {
        const message = JSON.parse(String(payload));
        if (message.type === "open" && typeof message.pane === "string")
          lastOpenRequest = message.pane;
      } catch {}
    });
    socket.on("framereceived", ({ payload }) => {
      try {
        const message = JSON.parse(String(payload));
        if (
          (message.type === "opened" || message.type === "error") &&
          typeof message.pane === "string"
        )
          paneReplies.set(message.pane, message.type);
        if (message.binding) bindingConnection = connection;
        if (
          message.type === "state" &&
          message.confirmation &&
          !message.binding
        )
          confirmationConnection = connection;
        failureStates.push({
          type: message.type,
          binding: !!message.binding,
          pane: message.pane,
          input: message.input,
          state: message.attempt?.state,
          generation: message.attempt?.generation,
        });
        if (failureStates.length > 32) failureStates.shift();
      } catch {
        /* Only bounded public state metadata, no terminal/password data. */
      }
    });
  });
  const origin = "https://127.0.0.1:9444";
  expect(
    await (await request.get("/api/fixture/native-ready")).json(),
  ).toMatchObject({
    privateGuest: true,
    gatewayProcess: processMode,
    gateStall: stallMode,
    coordinatorOutage: coordinatorMode,
    technicalRecovery,
    technicalPartial,
    continueClock: clockRetry,
  });
  await simulatedMedia(page);
  await page.goto("/");
  await page.getByLabel("Exam ID", { exact: true }).fill("native-browser");
  await page.getByLabel("Enrolled username").fill("examq");
  await page
    .getByRole("button", { name: "Start SSH sign-in", exact: true })
    .click();
  await page.getByLabel("Shared SSH password").fill("shared-password");
  await page
    .getByRole("button", { name: "Respond to this host", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Open preflight & practice", exact: true })
    .click();
  await ready(page);
  await page.getByRole("button", { name: "Begin exam", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Begin exam", exact: true })
    .click();
  const current = async () =>
    (await (await page.request.get("/api/student/exam")).json()).attempt;
  await expect
    .poll(async () => (await current()).state, { timeout: 20000 })
    .toBe("ACTIVE");
  const original = await current();
  failureAttempt = original.id;
  expect(original).toMatchObject({
    monitoring_mode: "v1",
    grant_id: expect.any(String),
    start: expect.any(Number),
    deadline: expect.any(Number),
  });
  const native = async () => {
    const response = await request.get("/api/fixture/native-state", {
      params: { attempt: original.id },
      timeout: 10000,
    });
    expect(response.ok(), await response.text()).toBe(true);
    return nativeProbe.parse(await response.json());
  };
  await expect
    .poll(async () => (await native()).supervisor?.attached_panes, {
      timeout: 15000,
    })
    .toBe(1);
  const before = await native();
  expect(before.supervisor?.ssh_peer).toBe("pinned-live");
  expect(before.attempt.deadline - before.attempt.start).toBe(5400000);
  const pane = page.locator(".xterm-helper-textarea").first();
  // Begin replaces preflight panes and removes the covering modal separately
  // from the native start. Use the student's actionable terminal surface;
  // HTMLElement.focus() can silently target an inert or retiring preflight pane.
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "New terminal", exact: true }),
  ).toBeEnabled();
  await page.locator(".xterm-screen").first().click();
  await expect(pane).toBeFocused();
  await page.keyboard.type("printf 'NATIVE-%s-END\\n' 'retained-private-");
  await expect(page.locator(".xterm-rows")).toContainText("retained-private-");
  const login = await request.post("/api/admin/login", {
    headers: { origin },
    data: { username: "instructor", password: "fixture-password" },
  });
  expect(login.ok(), await login.text()).toBe(true);
  const restart = async (mode: "kill" | "graceful", held = false) => {
    const runtime = async () => {
      const response = await request.get(
        "/api/fixture/native-gateway-runtime",
        { timeout: 3000 },
      );
      expect(response.ok(), await response.text()).toBe(true);
      return z
        .object({
          pid: z.number().int().positive(),
          fixturePID: z.number().int().positive(),
          ownGroup: z.literal(true),
        })
        .parse(await response.json());
    };
    const old = await runtime(),
      oldConnections = connections;
    expect(old.pid).not.toBe(old.fixturePID);
    const injected = await request.post("/api/fixture/native-gateway-restart", {
      headers: { origin, "x-csrf-token": (await login.json()).csrf },
      data: { mode },
      timeout: 5000,
    });
    expect(injected.ok(), await injected.text()).toBe(true);
    expect((await injected.json()).previous).toBe(old.pid);
    await expect
      .poll(
        async () => {
          try {
            return (await runtime()).pid;
          } catch {
            return old.pid;
          }
        },
        { timeout: 20000 },
      )
      .not.toBe(old.pid);
    await expect
      .poll(() => bindingConnection, { timeout: 20000 })
      .toBeGreaterThan(oldConnections);
    if (!held) {
      await expect
        .poll(() => confirmationConnection, { timeout: 15000 })
        .toBeGreaterThan(oldConnections);
      const confirmedUploads = uploads;
      await expect
        .poll(() => uploads, { timeout: 15000 })
        .toBeGreaterThan(confirmedUploads);
    }
    await expect(
      page.getByText("Reconnecting · input blocked", { exact: true }),
    ).toHaveCount(0, { timeout: 15000 });
    await expect(page.getByLabel("Shared SSH password")).toHaveCount(0);
  };
  if (processMode) {
    await restart("kill");
    await expect
      .poll(
        async () => {
          const value = await native();
          return {
            state: value.attempt.state,
            generation: value.attempt.generation,
            ssh: value.supervisor?.ssh_peer,
            pid: value.supervisor?.pid,
            unfrozen:
              value.kernel.length > 0 &&
              value.kernel.every(
                (unit) => unit.frozen === "0" && unit.populated === "1",
              ),
          };
        },
        { timeout: 15000 },
      )
      .toEqual({
        state: "ACTIVE",
        generation: before.attempt.generation,
        ssh: "pinned-live",
        pid: before.supervisor!.pid,
        unfrozen: true,
      });
    await pane.focus();
    await expect(pane).toBeFocused();
    await page.keyboard.type("gateway-", { delay: 25 });
    await expect(page.locator(".xterm-rows")).toContainText(
      "retained-private-gateway-",
    );
  }
  let policyCycle = 0;
  const pauseAndContinue = async (cause: "policy" | "technical" = "policy") => {
    policyCycle++;
    if (cause === "policy")
      await page.evaluate(() => document.exitFullscreen());
    await expect(page.locator(".lock-overlay")).toBeVisible();
    await expect
      .poll(
        async () => {
          const held = await native();
          return {
            state: held.attempt.state,
            phase: held.attempt.retained_hold,
            kind: held.attempt.monitoring_hold_kind,
            populatedFrozen:
              held.kernel.length > 0 &&
              held.kernel.every(
                (entry: any) => entry.frozen === "1" && entry.populated === "1",
              ),
            ssh: held.supervisor?.ssh_peer,
            pid: held.supervisor?.pid,
          };
        },
        { timeout: 15000 },
      )
      .toEqual({
        state: "LOCKED",
        phase: "held",
        kind: cause,
        populatedFrozen: true,
        ssh: "pinned-live",
        pid: before.supervisor!.pid,
      });
    const paused = await current();
    if (coordinatorMode) coordinatorHeldBytes = (await native()).writer_bytes;
    const selected = await (
      await request.get(`/api/admin/attempts/${original.id}/interruption`)
    ).json();
    const approval = await request.post(
      `/api/admin/attempts/${original.id}/authorize`,
      {
        headers: { origin, "x-csrf-token": (await login.json()).csrf },
        data: {
          generation: selected.generation,
          revision: selected.revision,
          requestID: crypto.randomUUID(),
          reason: "Reviewed private actual native browser interruption",
        },
      },
    );
    expect(approval.ok(), await approval.text()).toBe(true);
    await expect(
      page.getByRole("heading", { name: "Continuation approved", exact: true }),
    ).toBeVisible();
    expect(
      (await native()).kernel.every((entry: any) => entry.frozen === "1"),
    ).toBe(true);
    if (processMode) {
      await restart(policyCycle === 1 ? "graceful" : "kill", true);
      await expect(
        page.getByRole("heading", {
          name: "Continuation approved",
          exact: true,
        }),
      ).toBeVisible();
      const stillHeld = await native();
      expect(stillHeld.attempt).toMatchObject({
        state: "LOCKED",
        retained_hold: "held",
        generation: paused.generation,
        start: before.attempt.start,
        deadline: before.attempt.deadline,
        original_deadline: before.attempt.original_deadline,
        grant: before.attempt.grant,
      });
      expect(stillHeld.supervisor).toMatchObject({
        pid: before.supervisor!.pid,
        ssh_peer: "pinned-live",
      });
      expect(
        stillHeld.kernel.length > 0 &&
          stillHeld.kernel.every(
            (unit) => unit.frozen === "1" && unit.populated === "1",
          ),
      ).toBe(true);
    }
    if (cause === "policy")
      await page
        .getByRole("button", { name: "Restore fullscreen", exact: true })
        .click();
    const keyboard = page.getByRole("button", {
      name: "Restore keyboard lock",
      exact: true,
    });
    if ((await keyboard.getAttribute("aria-pressed")) !== "true")
      await keyboard.click();
    const captureUntil = performance.now() + 15000;
    const captured = page.waitForResponse(
      (response) =>
        response.url().endsWith("/frames/challenged") &&
        response.status() === 200 &&
        response.request().postDataJSON().readiness?.fullscreen === true,
      { timeout: 15000 },
    );
    const capturedReply = await captured;
    const pageInstance = capturedReply.request().headers()["x-page-instance"];
    expect(pageInstance).toBeTruthy();
    // One accepted image does not establish complete current policy/capture
    // readiness. Observe the real scoped protocol within the SAME setup budget.
    await expect
      .poll(
        async () => {
          const response = await page.request.get(
            `/api/student/attempts/${original.id}/monitoring-readiness`,
            {
              headers: { "x-page-instance": pageInstance },
              timeout: Math.max(
                1,
                Math.min(3000, captureUntil - performance.now()),
              ),
            },
          );
          expect(response.ok(), await response.text()).toBe(true);
          return (await response.json()).complete;
        },
        { timeout: Math.max(1, captureUntil - performance.now()) },
      )
      .toBe(true);
    const continued = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/attempts/${original.id}/continue`) &&
        response.request().method() === "POST" &&
        response.request().postDataJSON().automaticTechnical !== true,
    );
    await page
      .getByRole("button", {
        name: "Continue exam after authorization",
        exact: true,
      })
      .click();
    const continuation = await continued;
    expect(continuation.ok(), await continuation.text()).toBe(true);
    await expect(page.locator(".lock-overlay")).toHaveCount(0);
    return paused;
  };
  let paused = await pauseAndContinue();
  if (clockRetry) {
    expect(!!manualContinue).toBe(true);
    expect(!!manualContinue!.headers["x-page-instance"]).toBe(true);
    const previous = await current();
    const reset = await request.post(
      `/api/admin/attempts/${original.id}/reset-clock`,
      {
        headers: { origin, "x-csrf-token": (await login.json()).csrf },
        data: {
          minutes: 90,
          revision: previous.clock_revision,
          requestID: crypto.randomUUID(),
        },
        timeout: 10000,
      },
    );
    expect(reset.ok(), await reset.text()).toBe(true);
    const changed = await current();
    expect(changed.clock_revision).toBe(previous.clock_revision + 1);
    expect(changed.original_deadline).toBe(original.original_deadline);
    expect(changed.deadline).toBeGreaterThan(previous.deadline);
    expect(changed.start).toBe(original.start);
    const retry = await page.request.post(
      `/api/student/attempts/${original.id}/continue`,
      {
        headers: manualContinue!.headers,
        data: manualContinue!.data,
        timeout: 10000,
      },
    );
    expect(retry.ok(), await retry.text()).toBe(true);
    expect((await retry.json()).attempt).toMatchObject({
      state: "ACTIVE",
      generation: paused.generation,
      start: changed.start,
      deadline: changed.deadline,
      original_deadline: original.original_deadline,
      clock_revision: changed.clock_revision,
    });
    // Later assertions use this explicitly authorized CURRENT deadline; the
    // immutable original interval remains separately checked throughout.
    before.attempt.deadline = changed.deadline;
  }
  await pane.focus();
  await page.keyboard.type("verified'");
  await page.keyboard.press("Enter");
  await expect(page.locator(".xterm-rows")).toContainText(
    processMode
      ? "NATIVE-retained-private-gateway-verified-END"
      : "NATIVE-retained-private-verified-END",
  );
  if (stallMode) {
    const gate = async (action: "start" | "status" | "restore") => {
      const result = await request.post("/api/fixture/native-gate", {
        headers: { origin, "x-csrf-token": (await login.json()).csrf },
        data: { attempt: original.id, action },
        timeout: 10000,
      });
      expect(result.ok(), await result.text()).toBe(true);
      return z
        .object({
          phase: z.enum(["blocked", "restored", "failed"]),
          accepted: z.number().int().nonnegative(),
          evidence_replies: z.number().int().nonnegative(),
          error: z.string().nullable(),
        })
        .parse(await result.json());
    };
    await pane.focus();
    await expect(pane).toBeFocused();
    await page.keyboard.type(
      "(while :; do printf x >> /work/control-stall-proof; sleep 0.2; done) & stall_writer=$!; printf 'WRITER-%s\\n' READY",
      { delay: 25 },
    );
    await page.keyboard.press("Enter");
    await expect(page.locator(".xterm-rows").first()).toContainText(
      "WRITER-READY",
    );
    await expect
      .poll(async () => (await native()).writer_bytes, { timeout: 5000 })
      .toBeGreaterThan(2);
    const initial = await native(),
      started = await gate("start");
    expect(started.phase).toBe("blocked");
    const previousOpen = lastOpenRequest;
    await page
      .getByRole("button", { name: "New terminal", exact: true })
      .click();
    await expect
      .poll(() => lastOpenRequest, { timeout: 5000 })
      .not.toBe(previousOpen);
    const stalledPane = lastOpenRequest;
    await expect
      .poll(async () => (await gate("status")).accepted, { timeout: 5000 })
      .toBeGreaterThan(0);
    let samples = 0,
      written = initial.writer_bytes;
    const until = performance.now() + 25000;
    while (true) {
      const status = await gate("status"),
        observed = await native();
      expect(observed.attempt).toMatchObject({
        state: "ACTIVE",
        generation: initial.attempt.generation,
        start: initial.attempt.start,
        deadline: initial.attempt.deadline,
        original_deadline: initial.attempt.original_deadline,
        transport: initial.attempt.transport,
        grant: initial.attempt.grant,
      });
      expect(observed.supervisor).toMatchObject({
        pid: initial.supervisor!.pid,
        ssh_peer: "pinned-live",
      });
      expect(
        observed.kernel.length > 0 &&
          observed.kernel.every(
            (unit) => unit.frozen === "0" && unit.populated === "1",
          ),
      ).toBe(true);
      expect(status.phase, JSON.stringify(status)).not.toBe("failed");
      if (status.phase === "restored") break;
      expect(performance.now()).toBeLessThan(until);
      await expect
        .poll(async () => (await native()).writer_bytes, { timeout: 1500 })
        .toBeGreaterThan(written);
      written = (await native()).writer_bytes;
      samples++;
      if (samples === 2) {
        await pane.focus();
        await expect(pane).toBeFocused();
        await page.keyboard.type("printf 'DURING-%s\\n' STALL", { delay: 25 });
        await page.keyboard.press("Enter");
        await expect(page.locator(".xterm-rows").first()).toContainText(
          "DURING-STALL",
          { timeout: 5000 },
        );
      }
    }
    expect(samples).toBeGreaterThanOrEqual(3);
    const restored = await gate("status");
    expect(restored.evidence_replies).toBeGreaterThan(
      started.evidence_replies + 3,
    );
    await expect
      .poll(() => paneReplies.has(stalledPane), { timeout: 15000 })
      .toBe(true);
    const openingError = page.getByRole("dialog", {
      name: "Terminal error",
      exact: true,
    });
    if (paneReplies.get(stalledPane) === "error") {
      await expect(openingError).toBeVisible();
      await expect(openingError).toContainText("Browser SSH operation failed");
      await openingError
        .getByRole("button", { name: "Close", exact: true })
        .click();
    }
    await expect(openingError).toHaveCount(0);
    // Prove the restored real gate permits a fresh signed admission, rather
    // than treating disappearance of the operational error as recovery.
    if ((await native()).supervisor?.attached_panes === 1) {
      await page
        .getByRole("button", { name: "New terminal", exact: true })
        .click();
    }
    await expect
      .poll(async () => (await native()).supervisor?.attached_panes, {
        timeout: 15000,
      })
      .toBe(2);
    await pane.focus();
    await expect(pane).toBeFocused();
    await page.keyboard.type(
      'kill "$stall_writer"; wait "$stall_writer" 2>/dev/null; printf \'WRITER-%s\\n\' STOPPED',
      { delay: 25 },
    );
    await page.keyboard.press("Enter");
    await expect(page.locator(".xterm-rows").first()).toContainText(
      "WRITER-STOPPED",
    );
    // The original signed request may finish or refuse after restoration. Close
    // only its synthetic extra pane through the actual student close workflow.
    const extra = page.getByRole("button", { name: /^Close Terminal [2-4]$/ });
    if (await extra.count()) {
      await extra.last().click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Close terminal", exact: true })
        .click();
    }
    await expect
      .poll(async () => (await native()).supervisor?.attached_panes, {
        timeout: 15000,
      })
      .toBe(1);
    await pane.focus();
    await expect(pane).toBeFocused();
  }
  if (coordinatorMode) {
    await pane.focus();
    await expect(pane).toBeFocused();
    await page.keyboard.type(
      "(while :; do printf x >> /work/control-stall-proof; sleep 0.2; done) & coordinator_writer=$!; printf 'COORDINATOR-%s\\n' READY",
      { delay: 25 },
    );
    await page.keyboard.press("Enter");
    await expect(page.locator(".xterm-rows")).toContainText(
      "COORDINATOR-READY",
    );
    await expect
      .poll(async () => (await native()).writer_bytes)
      .toBeGreaterThan(2);
  }
  await page.keyboard.type("nano -I -w /work/browser-editor.txt", {
    delay: 25,
  });
  await page.keyboard.press("Enter");
  await expect(page.locator(".xterm-rows")).toContainText("GNU nano");
  await page.keyboard.type("UNSAVED-native-editor", { delay: 25 });
  await expect(page.locator(".xterm-rows")).toContainText(
    "UNSAVED-native-editor",
  );
  expect((await native()).editor_exists).toBe(false);
  if (coordinatorMode) {
    const evidence = async () => {
      const response = await request.get("/api/fixture/native-evidence", {
        params: { attempt: original.id },
        timeout: 5000,
      });
      expect(response.ok(), await response.text()).toBe(true);
      return z
        .object({
          privateGuest: z.literal(true),
          state: z.enum(["fresh", "technical-gap", "policy-blocked"]),
          coverageEpoch: z
            .string()
            .regex(/^[a-f0-9]{64}$/)
            .nullable(),
          sequence: z.number().int().nonnegative(),
          gaps: z.number().int().nonnegative(),
          remainingMS: z.number().int().nonnegative(),
        })
        .parse(await response.json());
    };
    const coordinator = async (action: "start" | "status" | "restore") => {
      const result = await request.post("/api/fixture/native-coordinator", {
        headers: { origin, "x-csrf-token": (await login.json()).csrf },
        data: {
          attempt: original.id,
          action,
          allProofPaths: !continuityMode,
          transportOnly: technicalSecondary,
        },
        timeout: 10000,
      });
      expect(result.ok(), await result.text()).toBe(true);
      const value = z
        .object({
          phase: z.enum(["stopping", "offline", "restored", "failed"]),
          before: z.number().int().positive(),
          after: z.number().int().positive().nullable(),
          watchdog: z.number().int().positive(),
          watchdog_after: z.number().int().positive().nullable(),
          all_proof_paths: z.boolean(),
          error: z.string().nullable(),
        })
        .parse(await result.json());
      expect(value.phase, JSON.stringify(value)).not.toBe("failed");
      return value;
    };
    const initialEvidence =
      technicalRecovery || technicalGap ? await evidence() : undefined;
    if (initialEvidence) {
      expect(initialEvidence.state).toBe("fresh");
      expect(initialEvidence.gaps).toBe(0);
    }
    if (technicalGap) missingCaptureUntil = performance.now() + 18000;
    const initial = await native(),
      started = await coordinator("start");
    expect(started.phase).not.toBe("failed");
    expect(started.all_proof_paths).toBe(!continuityMode);
    await expect
      .poll(async () => (await coordinator("status")).phase, { timeout: 10000 })
      .toBe("offline");
    if (continuityMode) {
      const uploadsBefore = uploads;
      let samples = 0,
        written = initial.writer_bytes;
      const until = performance.now() + 35000;
      while ((await coordinator("status")).phase !== "restored") {
        expect(performance.now()).toBeLessThan(until);
        const observed = await native();
        expect(observed.attempt).toMatchObject({
          state: "ACTIVE",
          generation: initial.attempt.generation,
          start: initial.attempt.start,
          deadline: initial.attempt.deadline,
          original_deadline: initial.attempt.original_deadline,
          transport: initial.attempt.transport,
          grant: initial.attempt.grant,
        });
        expect(observed.supervisor).toMatchObject({
          pid: initial.supervisor!.pid,
          ssh_peer: "pinned-live",
        });
        expect(
          observed.kernel.length > 0 &&
            observed.kernel.every(
              (unit) => unit.populated === "1" && unit.frozen === "0",
            ),
        ).toBe(true);
        await expect
          .poll(async () => (await native()).writer_bytes, { timeout: 1500 })
          .toBeGreaterThan(written);
        written = (await native()).writer_bytes;
        samples++;
      }
      expect(samples).toBeGreaterThanOrEqual(3);
      expect(uploads).toBeGreaterThan(uploadsBefore);
      const restored = await coordinator("status");
      expect(restored.after).not.toBe(started.before);
      expect(restored.watchdog).toBe(started.watchdog);
      expect(restored.watchdog_after).toBe(started.watchdog);
      expect(restored.error).toBeNull();
    } else {
      await expect
        .poll(
          async () => {
            const observed = await native();
            return {
              frozen:
                observed.kernel.length > 0 &&
                observed.kernel.every(
                  (unit) => unit.populated === "1" && unit.frozen === "1",
                ),
            };
          },
          { timeout: 18000 },
        )
        .toEqual({
          frozen: true,
        });
      expect((await coordinator("status")).phase).toBe("offline");
      const held = await native();
      coordinatorHeldBytes = held.writer_bytes;
      expect(held.attempt).toMatchObject({
        start: initial.attempt.start,
        deadline: initial.attempt.deadline,
        original_deadline: initial.attempt.original_deadline,
        transport: initial.attempt.transport,
        grant: initial.attempt.grant,
      });
      expect(held.supervisor).toMatchObject({
        pid: initial.supervisor!.pid,
        ssh_peer: "pinned-live",
        attached_panes: 1,
      });
      expect(held.editor_exists).toBe(false);
      const sampled = performance.now();
      await expect
        .poll(
          async () => {
            const observed = await native();
            expect(observed.writer_bytes).toBe(held.writer_bytes);
            expect(
              observed.kernel.every(
                (unit) => unit.frozen === "1" && unit.populated === "1",
              ),
            ).toBe(true);
            return performance.now() - sampled >= 3000;
          },
          { timeout: 5000 },
        )
        .toBe(true);
      const transition = async (action: "start" | "status") => {
        const response = await request.post("/api/fixture/native-transition", {
          headers: { origin, "x-csrf-token": (await login.json()).csrf },
          data: { attempt: original.id, action },
          timeout: 10000,
        });
        expect(response.ok(), await response.text()).toBe(true);
        return z
          .object({
            observed: z.boolean(),
            verified_nonce_count: z.number().int().nonnegative(),
            stage: z.literal("process-continued"),
          })
          .parse(await response.json());
      };
      if (technicalPartial)
        expect((await transition("start")).observed).toBe(false);
      const technicalGate = async (action: "start" | "status" | "restore") => {
        const response = await request.post("/api/fixture/native-gate", {
          headers: { origin, "x-csrf-token": (await login.json()).csrf },
          data: { attempt: original.id, action, technicalRecovery: true },
          timeout: 10000,
        });
        expect(response.ok(), await response.text()).toBe(true);
        return z
          .object({
            phase: z.string(),
            accepted: z.number().int(),
            error: z.string().nullable(),
            commandProbe: z.string(),
          })
          .parse(await response.json());
      };
      if (technicalSecondary)
        expect((await technicalGate("start")).phase).toBe("blocked");
      await expect
        .poll(async () => (await coordinator("status")).phase, {
          timeout: 45000,
        })
        .toBe("restored");
      const restored = await coordinator("status");
      if (technicalSecondary) {
        expect(restored.after).toBe(started.before);
        expect(restored.watchdog_after).toBe(started.watchdog);
      } else {
        expect(restored.after).not.toBe(started.before);
        expect(restored.watchdog_after).not.toBe(started.watchdog);
      }
      expect(restored.watchdog).toBe(started.watchdog);
      expect(restored.error).toBeNull();
      if (technicalRecovery) {
        // Positive witness BEFORE awaiting recovery: the same live ledger has
        // complete uninterrupted challenged observations over the ENTIRE outage.
        // A new frame/new coverage epoch is insufficient to satisfy this oracle.
        const continuous = await evidence();
        expect(continuous).toMatchObject({
          state: "fresh",
          coverageEpoch: initialEvidence!.coverageEpoch,
          gaps: 0,
        });
        expect(continuous.sequence).toBeGreaterThan(initialEvidence!.sequence);
        expect(continuous.remainingMS).toBeGreaterThan(0);
        await expect
          .poll(async () => (await native()).attempt.state, {
            timeout: 12000,
          })
          .toBe("ACTIVE");
        if (technicalSecondary) {
          const blocked = await technicalGate("status");
          expect(blocked.phase).toBe("blocked");
          expect(blocked.accepted).toBeGreaterThan(0); // Actual signed SSH command reached the refusing boundary.
          expect(blocked.error).toBeNull();
          expect(blocked.commandProbe).toBe("pending");
        }
        const recovered = await native();
        if (technicalPartial) {
          const fault = await transition("status");
          expect(fault.observed).toBe(true);
          expect(fault.verified_nonce_count).toBeGreaterThanOrEqual(2);
          expect(recovered.attempt.generation).toBe(
            initial.attempt.generation + 1,
          );
        }
        expect(recovered.attempt).toMatchObject({
          start: initial.attempt.start,
          deadline: initial.attempt.deadline,
          original_deadline: initial.attempt.original_deadline,
          transport: initial.attempt.transport,
          grant: initial.attempt.grant,
        });
        expect(recovered.supervisor).toMatchObject({
          pid: initial.supervisor!.pid,
          ssh_peer: "pinned-live",
        });
        expect(
          recovered.kernel.length > 0 &&
            recovered.kernel.every(
              (unit) => unit.frozen === "0" && unit.populated === "1",
            ),
        ).toBe(true);
        await expect
          .poll(async () => (await native()).writer_bytes, {
            timeout: 5000,
          })
          .toBeGreaterThan(held.writer_bytes);
        await expect(page.locator(".lock-overlay")).toBeHidden();
        if (technicalSecondary) {
          await expect
            .poll(() => recoveryTransport, { timeout: 3000 })
            .toBe("authenticated-native");
          await pane.focus();
          const marker = "SECONDARY-C9-CHECK";
          await page.keyboard.type(marker, { delay: 15 });
          await expect(page.locator(".xterm-rows").first()).toContainText(
            marker,
          );
          for (const _ of marker) await page.keyboard.press("Backspace");
          expect((await technicalGate("status")).phase).toBe("blocked");
          expect((await technicalGate("restore")).phase).toBe("restored");
        }
      } else {
        await expect
          .poll(
            async () => {
              const observed = await native();
              return {
                state: observed.attempt.state,
                phase: observed.attempt.retained_hold,
                kind: observed.attempt.monitoring_hold_kind,
              };
            },
            { timeout: 10000 },
          )
          .toEqual({ state: "LOCKED", phase: "held", kind: "technical" });
        const afterRestoreUploads = uploads;
        await expect
          .poll(() => uploads, { timeout: 15000 })
          .toBeGreaterThan(afterRestoreUploads);
        const incomplete = await evidence();
        expect(incomplete.state).toBe("fresh"); // Later images really have returned.
        expect(droppedCaptures).toBeGreaterThan(0);
        expect(incomplete.gaps).toBeGreaterThan(0);
        expect(incomplete.coverageEpoch).not.toBe(
          initialEvidence!.coverageEpoch,
        );
        const unprovenGap = await native();
        expect(unprovenGap.attempt).toMatchObject({
          state: "LOCKED",
          retained_hold: "held",
          monitoring_hold_kind: "technical",
          generation: initial.attempt.generation + 1,
        });
        expect(unprovenGap.attempt.reason).toContain(
          "technical safety hold, not a student violation",
        );
        expect(unprovenGap.writer_bytes).toBe(held.writer_bytes);
        expect(unprovenGap.supervisor).toMatchObject({
          pid: initial.supervisor!.pid,
          ssh_peer: "pinned-live",
        });
        expect(
          unprovenGap.kernel.length > 0 &&
            unprovenGap.kernel.every(
              (unit) => unit.frozen === "1" && unit.populated === "1",
            ),
        ).toBe(true);
        await expect
          .poll(async () => (await current()).state, { timeout: 15000 })
          .toBe("LOCKED");
      }
    }
  }
  paused = await pauseAndContinue(
    coordinatorMode && !continuityMode && !technicalRecovery
      ? "technical"
      : "policy",
  );
  await pane.focus();
  await page.keyboard.press("Control+x");
  await expect(page.locator(".xterm-rows")).toContainText(
    "Save modified buffer",
  );
  await page.keyboard.type("y");
  await expect(page.locator(".xterm-rows")).toContainText("File Name to Write");
  await page.keyboard.press("Enter");
  if (coordinatorMode) {
    await expect
      .poll(async () => (await native()).writer_bytes, { timeout: 5000 })
      .toBeGreaterThan(coordinatorHeldBytes);
    await page.keyboard.type(
      'kill "$coordinator_writer"; wait "$coordinator_writer" 2>/dev/null; printf \'COORDINATOR-%s\\n\' STOPPED',
      { delay: 25 },
    );
    await page.keyboard.press("Enter");
    await expect(page.locator(".xterm-rows")).toContainText(
      "COORDINATOR-STOPPED",
    );
  }
  await page.keyboard.type("cat /work/browser-editor.txt", { delay: 25 });
  await page.keyboard.press("Enter");
  await expect(page.locator(".xterm-rows")).toContainText(
    "UNSAVED-native-editor",
  );
  expect((await native()).editor_exists).toBe(true);
  await page.keyboard.type(
    "printf 'SAVED-%s-END\\n' 'actual-native' > /work/browser-proof.txt",
    { delay: 25 },
  );
  await page.keyboard.press("Enter");
  await page.keyboard.type("cat /work/browser-proof.txt", { delay: 25 });
  await page.keyboard.press("Enter");
  try {
    await expect(page.locator(".xterm-rows")).toContainText(
      "SAVED-actual-native-END",
    );
  } catch (error) {
    await test.info().attach("native-input-failure-state", {
      body: Buffer.from(JSON.stringify(await native())),
      contentType: "application/json",
    });
    throw error;
  }
  await expect(
    page.getByText(/Recent terminal input was not sent/),
  ).toHaveCount(0);
  const after = await native();
  expect(after.supervisor).toMatchObject({
    pid: before.supervisor!.pid,
    ssh_peer: "pinned-live",
    attached_panes: 1,
  });
  expect(after.attempt).toMatchObject({
    state: "ACTIVE",
    start: before.attempt.start,
    deadline: before.attempt.deadline,
    original_deadline: before.attempt.original_deadline,
    transport: before.attempt.transport,
    grant: before.attempt.grant,
  });
  expect((await current()).generation).toBe(paused.generation);
  await page.getByRole("button", { name: "Finish exam", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Finish exam", exact: true })
    .click();
  // Finish signs the student out. Inspect through the already-authenticated
  // instructor interface, never assume the retired student session survives.
  await expect
    .poll(
      async () => {
        const value = await (
          await request.get(`/api/admin/attempts/${original.id}/interruption`)
        ).json();
        return { state: value.state, protected: !!value.protected };
      },
      { timeout: 30000 },
    )
    .toEqual({ state: "COMPLETED", protected: true });
  const protectedFinish = await request.post("/api/fixture/native-finish", {
    headers: { origin, "x-csrf-token": (await login.json()).csrf },
    data: { attempt: original.id },
    timeout: 30000,
  });
  expect(protectedFinish.ok(), await protectedFinish.text()).toBe(true);
  expect(await protectedFinish.json()).toMatchObject({
    private_guest: true,
    preservation: "FULL",
    verified_files: ["browser-editor.txt", "browser-proof.txt"],
    attempt: {
      state: "COMPLETED",
      protected: true,
      start: before.attempt.start,
      deadline: before.attempt.deadline,
      original_deadline: before.attempt.original_deadline,
      grant: before.attempt.grant,
      access_state: "HELD",
    },
  });
});
