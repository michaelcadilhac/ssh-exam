import { test, expect } from "@playwright/test";
import { simulatedMedia, ready } from "./transition-fixture.js";

test("real WASM keeps captured input epochs across a delayed write and same-pane replacement", async ({
  page,
}) => {
  test.setTimeout(60000);
  const focusTerminal = async () => {
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // Modal restoration and the pane's own focus use animation frames. Observe
    // that boundary before placing keys; a focused final screenshot is too late.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    const input = page.locator(".xterm-helper-textarea");
    await input.focus();
    await expect(input).toBeFocused();
  };
  await simulatedMedia(page);
  await page.addInitScript(() => {
    const original: any = Worker.prototype.postMessage;
    const probe: any = {
      armed: false,
      held: null,
      released: false,
      operations: [],
      keyTargets: [],
      events: [],
    };
    const observed = new WeakSet<Worker>();
    (window as any).__framedInputProbe = probe;
    document.addEventListener(
      "keydown",
      (event) => {
        if (probe.armed)
          probe.keyTargets.push({
            tag: (event.target as HTMLElement)?.tagName,
            label: (event.target as HTMLElement)?.getAttribute("aria-label"),
            prevented: event.defaultPrevented,
          });
      },
      true,
    );
    Worker.prototype.postMessage = function (message: any, transfer?: any) {
      if (!observed.has(this)) {
        observed.add(this);
        this.addEventListener("message", ({ data }) => {
          if (["closed", "loss", "fatal", "rpc-result"].includes(data.type)) {
            probe.events.push({
              type: data.type,
              pane: data.pane,
              input_epoch: data.input_epoch,
              error: data.error,
            });
            if (probe.events.length > 100) probe.events.shift();
          }
        });
      }
      probe.operations.push({
        op: message.op,
        framed: !!message.args?.epoch,
        sequence: message.args?.sequence,
      });
      if (probe.operations.length > 100) probe.operations.shift();
      if (probe.armed && !probe.held && message.op === "input-framed") {
        probe.held = { worker: this, message: structuredClone(message) };
        return;
      }
      return original.call(this, message, transfer);
    };
    probe.release = () => {
      probe.armed = false;
      original.call(probe.held.worker, probe.held.message);
      probe.released = true;
    };
  });
  await page.goto("/");
  await page.getByLabel("Exam ID", { exact: true }).fill("framed-input");
  await page.getByLabel("Enrolled username").fill("framed01");
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
  await expect(page.locator(".xterm-rows")).toContainText(
    "DISPOSABLE DEVELOPMENT FIXTURE",
  );
  const initial = await (await page.request.get("/api/student/exam")).json();
  const baseline = await (
    await page.request.get("/api/fixture/runtime")
  ).json();
  // Actual resize frames show that both loaded WASM and native negotiation ran.
  await expect
    .poll(
      async () =>
        (
          await (await page.request.get("/api/fixture/runtime")).json()
        ).framedInput.accepted.some((f: any) => f.kind === 1),
      { timeout: 5000 },
    )
    .toBe(true);
  await page.evaluate(() => {
    (window as any).__framedInputProbe.armed = true;
  });
  await focusTerminal();
  await page.keyboard.type("STALE_SHOULD_NOT_EXECUTE\n");
  try {
    await expect
      .poll(
        () => page.evaluate(() => !!(window as any).__framedInputProbe.held),
        { timeout: 2000 },
      )
      .toBe(true);
  } catch (error) {
    const probe = await page.evaluate(() => ({
      operations: (window as any).__framedInputProbe.operations,
      keyTargets: (window as any).__framedInputProbe.keyTargets,
      focused: document.activeElement?.getAttribute("aria-label"),
      scripts: [...document.scripts].map((s) => s.src),
      readonly: (document.activeElement as HTMLTextAreaElement)?.readOnly,
    }));
    const runtime = await (
      await page.request.get("/api/fixture/runtime")
    ).json();
    console.info(
      "FRAMED_CAPTURE_STAGE",
      JSON.stringify({
        probe,
        frames: runtime.framedInput,
        commandFailures: runtime.commandFailures,
      }),
    );
    await test.info().attach("framed-capture-stage", {
      body: JSON.stringify({
        probe: await page.evaluate(() => ({
          operations: (window as any).__framedInputProbe.operations,
          focused: document.activeElement?.getAttribute("aria-label"),
        })),
        runtime: await (await page.request.get("/api/fixture/runtime")).json(),
      }),
      contentType: "application/json",
    });
    throw error;
  }
  const captured = await page.evaluate(() => ({
    ...(window as any).__framedInputProbe.held.message.args,
  }));
  expect(captured.epoch).toMatch(/^[a-f0-9]{64}$/);
  expect(captured.sequence).toBeGreaterThan(0);
  await page.locator(".winbox .wb-close").click();
  await page
    .getByRole("button", { name: "Close terminal", exact: true })
    .click();
  await expect(page.locator(".winbox")).toHaveCount(0);
  await page.evaluate((pane) => {
    const button = [...document.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "New terminal",
    );
    if (!button) throw Error("New terminal control missing");
    button.addEventListener(
      "click",
      () => {
        const original = crypto.randomUUID.bind(crypto);
        crypto.randomUUID = () => {
          crypto.randomUUID = original;
          return pane;
        };
      },
      { capture: true, once: true },
    );
  }, captured.pane);
  await page.getByRole("button", { name: "New terminal", exact: true }).click();
  try {
    await expect(page.locator(".xterm-rows")).toContainText(
      "DISPOSABLE DEVELOPMENT FIXTURE",
    );
  } catch (error) {
    console.info(
      "FRAMED_REPLACEMENT_STAGE",
      JSON.stringify({
        probe: await page.evaluate(() => ({
          operations: (window as any).__framedInputProbe.operations,
          events: (window as any).__framedInputProbe.events,
        })),
        runtime: await (await page.request.get("/api/fixture/runtime")).json(),
      }),
    );
    throw error;
  }
  await expect
    .poll(
      async () => {
        const runtime = await (
          await page.request.get("/api/fixture/runtime")
        ).json();
        return runtime.framedInput.accepted.some(
          (f: any) =>
            f.pane === captured.pane &&
            f.epoch !== captured.epoch &&
            f.kind === 1,
        );
      },
      { timeout: 5000 },
    )
    .toBe(true);
  await page.evaluate(() => (window as any).__framedInputProbe.release());
  await focusTerminal();
  await page.keyboard.type("fresh-漢-input");
  await page.keyboard.press("Enter");
  await expect(page.locator(".xterm-rows")).toContainText(
    "Echo: fresh-漢-input",
  );
  await expect(page.locator(".xterm-rows")).not.toContainText(
    "STALE_SHOULD_NOT_EXECUTE",
  );
  await expect(page.locator(".winbox")).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Exam paused" })).toHaveCount(
    0,
  );
  const current = await (await page.request.get("/api/student/exam")).json();
  expect(current.attempt).toMatchObject({
    id: initial.attempt.id,
    state: "ACTIVE",
    start: initial.attempt.start,
    deadline: initial.attempt.deadline,
    original_deadline: initial.attempt.original_deadline,
    generation: initial.attempt.generation,
  });
  expect(
    (await (await page.request.get("/api/fixture/runtime")).json())
      .authenticationCalls,
  ).toEqual(baseline.authenticationCalls);
});
