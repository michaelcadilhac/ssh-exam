import { test, expect } from "@playwright/test";
import { z } from "zod";
import { simulatedMedia, ready } from "./transition-fixture.js";

// types.go Attempt serializes retained_hold as a STRING. The independent live
// supervisor has a separate view; kernel observations are mandatory below.
const nativeProbe = z.object({
  private_guest: z.literal(true),
  editor_exists: z.boolean(),
  attempt: z
    .object({
      state: z.string(),
      start: z.number(),
      deadline: z.number(),
      original_deadline: z.number(),
      transport: z.string(),
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
  if (!process.env.EXAM_BROWSER_NATIVE_BUNDLE || info.status === "passed" || !failureAttempt) return;
  try {
    const response = await page.request.get("/api/fixture/native-state", { params: { attempt: failureAttempt }, timeout: 10000 });
    await info.attach("native-boundary-state", { body: await response.body(), contentType: "application/json" });
    await info.attach("student-control-boundary", { body: Buffer.from(JSON.stringify(failureStates)), contentType: "application/json" });
    const focus = await page.evaluate(() => ({ activeTag: document.activeElement?.tagName, activeClass: document.activeElement?.className, activeLabel: document.activeElement?.getAttribute("aria-label"), visible: document.visibilityState, focused: document.hasFocus(), fullscreen: !!document.fullscreenElement }));
    await info.attach("browser-input-boundary", { body: Buffer.from(JSON.stringify(focus)), contentType: "application/json" });
  } catch { /* Preserve the original failure if the independent probe refuses. */ }
});

test("actual native kernel hold and explicit Continue preserve the same browser SSH and private buffer through protected finish", async ({
  page,
  request,
}) => {
  test.skip(
    !process.env.EXAM_BROWSER_NATIVE_BUNDLE,
    "Requires the guarded disposable native guest and private code-only bundle",
  );
  test.setTimeout(150000);
  page.setDefaultTimeout(10000);
  failureAttempt = "";
  failureStates.length = 0;
  page.on("websocket", (socket) => {
    if (new URL(socket.url()).pathname !== "/api/student/session") return;
    socket.on("framereceived", ({ payload }) => {
      try {
        const message = JSON.parse(String(payload));
        failureStates.push({ type: message.type, binding: !!message.binding, pane: message.pane, input: message.input, state: message.attempt?.state, generation: message.attempt?.generation });
        if (failureStates.length > 32) failureStates.shift();
      } catch { /* Only bounded public state metadata, no terminal/password data. */ }
    });
  });
  const origin = "https://127.0.0.1:9444";
  expect(
    (await (await request.get("/api/fixture/native-ready")).json())
      .privateGuest,
  ).toBe(true);
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
  const pane = page.locator(".xterm-helper-textarea").last();
  await pane.focus();
  await expect(pane).toBeFocused();
  await page.keyboard.type("printf 'NATIVE-%s-END\\n' 'retained-private-");
  await expect(page.locator(".xterm-rows")).toContainText("retained-private-");
  const login = await request.post("/api/admin/login", {
    headers: { origin },
    data: { username: "instructor", password: "fixture-password" },
  });
  expect(login.ok(), await login.text()).toBe(true);
  const pauseAndContinue = async () => {
    await page.evaluate(() => document.exitFullscreen());
    await expect(page.locator(".lock-overlay")).toBeVisible();
    await expect
      .poll(
        async () => {
          const held = await native();
          return {
            state: held.attempt.state,
            phase: held.attempt.retained_hold,
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
        populatedFrozen: true,
        ssh: "pinned-live",
        pid: before.supervisor!.pid,
      });
    const paused = await current();
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
    await page
      .getByRole("button", { name: "Restore fullscreen", exact: true })
      .click();
    const keyboard = page.getByRole("button", {
      name: "Restore keyboard lock",
      exact: true,
    });
    if ((await keyboard.getAttribute("aria-pressed")) !== "true")
      await keyboard.click();
    const captured = page.waitForResponse(
      (response) =>
        response.url().endsWith("/frames/challenged") &&
        response.status() === 200 &&
        response.request().postDataJSON().readiness?.fullscreen === true,
      { timeout: 15000 },
    );
    await captured;
    const continued = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/attempts/${original.id}/continue`) &&
        response.request().method() === "POST",
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
  await pane.focus();
  await page.keyboard.type("verified'");
  await page.keyboard.press("Enter");
  await expect(page.locator(".xterm-rows")).toContainText(
    "NATIVE-retained-private-verified-END",
  );
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
  paused = await pauseAndContinue();
  await pane.focus();
  await page.keyboard.press("Control+x");
  await expect(page.locator(".xterm-rows")).toContainText(
    "Save modified buffer",
  );
  await page.keyboard.type("y");
  await expect(page.locator(".xterm-rows")).toContainText("File Name to Write");
  await page.keyboard.press("Enter");
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
