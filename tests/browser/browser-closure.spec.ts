import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import {
  simulatedMedia,
  ready,
  observeScreens,
  onlyScreens,
} from "./transition-fixture.js";
const origin = "http://localhost:3100";
let lastCleanup = 0,
  serverPid = 0;
const runtime = async (request: APIRequestContext) =>
  (await request.get("/api/fixture/runtime")).json();
async function admin(request: APIRequestContext) {
  const r = await request.post("/api/admin/login", {
    headers: { origin },
    data: { username: "instructor", password: "fixture-password" },
  });
  expect(r.ok()).toBe(true);
  return { origin, "X-CSRF-Token": (await r.json()).csrf };
}
async function attempt(request: APIRequestContext, id: string) {
  return (
    await (await request.get("/api/admin/attempts")).json()
  ).attempts.find((a: any) => a.id === id);
}
async function login(page: Page, exam: string, username: string) {
  await page.getByLabel("Exam ID", { exact: true }).fill(exam);
  await page.getByLabel("Enrolled username").fill(username);
  await page
    .getByRole("button", { name: "Start SSH sign-in", exact: true })
    .click();
  await page.getByLabel("Shared SSH password").fill("shared-password");
  await page
    .getByRole("button", { name: "Respond to this host", exact: true })
    .click();
}
async function begin(page: Page, exam: string, username: string) {
  await page.goto("/");
  await login(page, exam, username);
  await page.getByRole("button", { name: "Open preflight & practice" }).click();
  await ready(page);
  await page.getByRole("button", { name: "Begin exam", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Begin exam", exact: true })
    .click();
  await expect(page.locator(".winbox")).toHaveCount(1);
  await page.getByRole("button", { name: "New terminal", exact: true }).click();
  await expect(page.locator(".winbox")).toHaveCount(2);
  return (await (await page.request.get("/api/student/exam")).json()).attempt;
}
async function type(page: Page, text: string) {
  await page
    .locator(".winbox")
    .last()
    .locator(".xterm-helper-textarea")
    .focus();
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
}
async function deny(page: Page) {
  await expect(page.locator(".workspace,form")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Reconnect SSH", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Instructor authorization required",
  );
  await expect(page.locator(".workspace,form")).toHaveCount(0);
}
async function restore(
  page: Page,
  request: APIRequestContext,
  headers: any,
  original: any,
  exam: string,
  user: string,
) {
  const selected = await (
    await request.get(`/api/admin/attempts/${original.id}/interruption`)
  ).json();
  const grant = await request.post(
    `/api/admin/attempts/${original.id}/authorize`,
    {
      headers,
      data: {
        generation: selected.generation,
        revision: selected.revision,
        requestID: crypto.randomUUID(),
        reason: "Reviewed synthetic browser closure",
      },
    },
  );
  expect(grant.ok()).toBe(true);
  await page.reload();
  await page
    .getByRole("button", { name: "Reconnect SSH", exact: true })
    .click();
  await login(page, exam, user);
  await page
    .getByRole("button", {
      name: "Restore page after instructor authorization",
      exact: true,
    })
    .click();
  await expect(page.locator(".winbox")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "New terminal", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "Restore screen sharing", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Restore fullscreen", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Restore keyboard lock", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Continue exam after authorization",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", { name: "New terminal", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "New terminal", exact: true }).click();
  await expect(page.locator(".winbox")).toHaveCount(1);
  expect(
    (await (await page.request.get("/api/student/exam")).json()).attempt,
  ).toMatchObject({
    id: original.id,
    state: "ACTIVE",
    deadline: original.deadline,
    original_deadline: original.original_deadline,
  });
}
async function oldControlRejected(page: Page, token: string) {
  const result = await page.evaluate(
    (token) =>
      new Promise<string>((resolve) => {
        const socket = new WebSocket(`ws://${location.host}/api/browser/ssh`);
        const timer = setTimeout(() => {
          socket.close();
          resolve("timeout");
        }, 2000);
        socket.onopen = () =>
          socket.send(
            JSON.stringify({ v: 1, type: "browser-bind", controlToken: token }),
          );
        socket.onmessage = () => {
          clearTimeout(timer);
          socket.close();
          resolve("accepted");
        };
        socket.onclose = () => {
          clearTimeout(timer);
          resolve("rejected");
        };
        socket.onerror = () => {};
      }),
    token,
  );
  expect(result).toBe("rejected");
}

test.describe.serial("browser abandonment and recovery", () => {
  test("closing the full browser context without a cooperative incident retires panes and requires a new grant after each interruption", async ({
    browser,
    request,
  }) => {
    test.setTimeout(90000);
    const headers = await admin(request);
    serverPid = (await runtime(request)).pid;
    let context = await browser.newContext({ baseURL: origin });
    let page = await context.newPage();
    await simulatedMedia(page);
    let token = "";
    await page.routeWebSocket("**/api/auth/dialogue", (socket) => {
      const server = socket.connectToServer();
      server.onMessage((message) => {
        const m = JSON.parse(String(message));
        if (m.type === "browser-request" && m.op === "connect")
          token = m.args.controlToken;
        socket.send(message);
      });
    });
    try {
      const original = await begin(page, "closure", "closure01");
      await type(page, "save preserved closure answer");
      await expect(
        page.locator(".winbox").last().locator(".xterm-rows"),
      ).toContainText("Saved fixture text");
      const oldPanes = (await runtime(request)).panes
        .filter((p: any) => p.attempt === original.id)
        .map((p: any) => p.pane);
      expect(oldPanes).toHaveLength(2);
      // Suppress the actual incident transport, not just navigator.sendBeacon:
      // the app sends incidents over its monitoring WebSocket.
      await page.evaluate(() => {
        const send = WebSocket.prototype.send;
        WebSocket.prototype.send = function (data) {
          if (typeof data === "string" && JSON.parse(data).type === "incident")
            return;
          return send.call(this, data);
        };
      });
      const state = await context.storageState();
      lastCleanup = Date.now();
      await context.close();
      await expect
        .poll(async () => (await attempt(request, original.id)).state, {
          timeout: 25000,
          intervals: [200, 500, 1000],
        })
        .toBe("LOCKED");
      await expect
        .poll(
          async () =>
            (await runtime(request)).panes.filter(
              (p: any) => p.attempt === original.id,
            ).length,
        )
        .toBe(0);
      expect((await runtime(request)).pid).toBe(serverPid);
      context = await browser.newContext({
        baseURL: origin,
        storageState: state,
      });
      page = await context.newPage();
      await simulatedMedia(page);
      await observeScreens(page);
      await page.goto("/");
      await deny(page);
      await onlyScreens(page, ["empty", "loading", "summary"]);
      await oldControlRejected(page, token);
      await restore(page, request, headers, original, "closure", "closure01");
      await oldControlRejected(page, token);
      await type(page, "cat");
      await expect(page.locator(".xterm-rows")).toContainText(
        "preserved closure answer",
      );
      const active = (await runtime(request)).panes.filter(
        (p: any) => p.attempt === original.id,
      );
      expect(active).toHaveLength(1);
      expect(oldPanes).not.toContain(active[0].pane);
      const resumed = (await page.request.get("/api/student/exam")).json();
      const resumedGeneration = (await resumed).attempt.generation;
      const secondState = await context.storageState();
      await context.close();
      await expect
        .poll(async () => (await attempt(request, original.id)).state, {
          timeout: 25000,
          intervals: [200, 500, 1000],
        })
        .toBe("LOCKED");
      context = await browser.newContext({
        baseURL: origin,
        storageState: secondState,
      });
      page = await context.newPage();
      await simulatedMedia(page);
      await page.goto("/");
      await deny(page);
      expect(await attempt(request, original.id)).toMatchObject({
        deadline: original.deadline,
        original_deadline: original.original_deadline,
        generation: resumedGeneration + 1,
      });
      await expect
        .poll(
          async () =>
            (await runtime(request)).panes.filter(
              (p: any) => p.attempt === original.id,
            ).length,
        )
        .toBe(0);
    } finally {
      await context.close();
    }
  });
  test("reload during an unacknowledged terminal open retires old panes and permits only authorized fresh SSH", async ({
    page,
    request,
  }) => {
    test.skip(
      process.env.EXAM_BROWSER_SSH !== "1",
      "Requires browser SSH control requests; qualify with EXAM_BROWSER_SSH=1",
    );
    test.setTimeout(45000);
    const headers = await admin(request);
    if (!serverPid) serverPid = (await runtime(request)).pid;
    await simulatedMedia(page);
    let hold = false,
      held = false;
    const opens = new Set<string>();
    await page.routeWebSocket("**/api/auth/dialogue", (socket) => {
      const server = socket.connectToServer();
      server.onMessage((message) => {
        const m = JSON.parse(String(message));
        if (m.type === "browser-request" && m.op === "open") opens.add(m.id);
        socket.send(message);
      });
      socket.onMessage((message) => {
        const m = JSON.parse(String(message));
        if (hold && m.type === "browser-result" && opens.has(m.id)) {
          held = true;
          return;
        }
        server.send(message);
      });
    });
    const original = await begin(page, "reload-opening", "closure02");
    await type(page, "save preserved reload answer");
    await expect(
      page.locator(".winbox").last().locator(".xterm-rows"),
    ).toContainText("Saved fixture text");
    hold = true;
    await page
      .getByRole("button", { name: "New terminal", exact: true })
      .click();
    await expect.poll(() => held).toBe(true);
    await page.evaluate(() => {
      const send = WebSocket.prototype.send;
      WebSocket.prototype.send = function (data) {
        if (typeof data === "string" && JSON.parse(data).type === "incident")
          return;
        return send.call(this, data);
      };
    });
    await page.reload();
    hold = false;
    await deny(page);
    await expect
      .poll(
        async () =>
          (await runtime(request)).panes.filter(
            (p: any) => p.attempt === original.id,
          ).length,
      )
      .toBe(0);
    await restore(
      page,
      request,
      headers,
      original,
      "reload-opening",
      "closure02",
    );
    await type(page, "cat");
    await expect(page.locator(".xterm-rows")).toContainText(
      "preserved reload answer",
    );
    expect((await runtime(request)).pid).toBe(serverPid);
    await page
      .getByRole("button", { name: "Finish exam", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Finish exam", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Connect to your exam" }),
    ).toBeVisible();
    expect(await attempt(request, original.id)).toMatchObject({
      state: "COMPLETED",
      protected: 1,
    });
    await page.getByLabel("Exam ID", { exact: true }).fill("reload-opening");
    await page.getByLabel("Enrolled username").fill("closure02");
    await page
      .getByRole("button", { name: "Start SSH sign-in", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText("already completed");
    await expect(page.getByLabel("Shared SSH password")).toHaveCount(0);
    await expect(page.locator(".winbox")).toHaveCount(0);
    lastCleanup = Date.now(); // Include reload and completion in the timeout window.
  });
  test("the same server remains healthy past the former two-minute orphan-request failure window", async ({
    request,
  }) => {
    test.setTimeout(150000);
    expect(lastCleanup).toBeGreaterThan(0);
    while (Date.now() - lastCleanup < 125000) {
      expect((await request.get("/health/live")).ok()).toBe(true);
      expect((await runtime(request)).pid).toBe(serverPid);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
    expect((await runtime(request)).pid).toBe(serverPid);
    expect((await runtime(request)).panes).toEqual([]);
  });
});
