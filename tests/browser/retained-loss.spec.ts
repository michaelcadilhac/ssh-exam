import { test, expect, type Page } from "@playwright/test";
import { simulatedMedia, ready } from "./transition-fixture.js";

const origin = "http://localhost:3100";
async function begin(page: Page, username: string) {
  await simulatedMedia(page);
  await page.goto("/");
  expect(
    (await (await page.request.get("/api/login-test")).json()).browserSSH,
  ).toBe(true);
  await page.getByLabel("Exam ID", { exact: true }).fill("retained-loss");
  await page.getByLabel("Enrolled username").fill(username);
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
  const a = (await (await page.request.get("/api/student/exam")).json())
    .attempt;
  expect(a).toMatchObject({
    state: "ACTIVE",
    monitoring_mode: "v1",
    grant_id: expect.any(String),
  });
  return a;
}

// Actual gateway child/WASM/SSH failure. Native OS containment is deliberately
// simulated here and separately qualified in the guarded root driver.
test("a failed retained proxy re-verifies the original SSH and private buffer while a peer keeps working", async ({
  browser,
}) => {
  test.setTimeout(60000);
  const failed = await browser.newContext(),
    peer = await browser.newContext(),
    instructor = await browser.newContext();
  const alice = await failed.newPage(),
    bob = await peer.newPage(),
    admin = await instructor.newPage();
  try {
    const a = await begin(alice, "retained04"),
      b = await begin(bob, "retained05");
    const runtime = async () =>
      (await bob.request.get("/api/fixture/runtime")).json();
    const before = await runtime();
    expect(before.nativeBeginRequests).toEqual(
      expect.arrayContaining([a.id, b.id]),
    );
    const alicePid = before.workers.find(
      (w: any) => w.username === "retained04",
    ).pid;
    const bobPid = before.workers.find(
      (w: any) => w.username === "retained05",
    ).pid;
    expect(alicePid).not.toBe(bobPid);
    expect(before.panes.filter((p: any) => p.attempt === a.id)).toHaveLength(1);
    const owner = JSON.parse(a.registered_owner);
    expect(before.sshTransports).toContainEqual({
      transport: owner.transport_hash,
      username: "retained04",
      closed: false,
    });
    await alice.locator(".xterm-helper-textarea").last().focus();
    await alice.keyboard.type("proxy-private-");
    await expect(alice.locator(".xterm-rows")).toContainText("proxy-private-");
    const login = await admin.request.post(origin + "/api/admin/login", {
      headers: { origin },
      data: { username: "instructor", password: "fixture-password" },
    });
    expect(login.ok(), await login.text()).toBe(true);
    const headers = { origin, "x-csrf-token": (await login.json()).csrf };
    const fault = await admin.request.post(origin + "/api/fixture/fault", {
      headers,
      data: { username: "retained04", fault: "kill" },
    });
    expect(fault.ok(), await fault.text()).toBe(true);
    expect((await fault.json()).pid).toBe(alicePid);
    await expect
      .poll(
        async () =>
          (await runtime()).workers.some((w: any) => w.pid === alicePid),
        { timeout: 10000 },
      )
      .toBe(false);
    const current = (
      await (await alice.request.get("/api/student/exam")).json()
    ).attempt;
    expect(current).toMatchObject({
      id: a.id,
      state: "ACTIVE",
      generation: a.generation,
      clock_revision: a.clock_revision,
      registered_owner: a.registered_owner,
      start: a.start,
      deadline: a.deadline,
      original_deadline: a.original_deadline,
      grant_id: a.grant_id,
    });
    await expect
      .poll(
        async () =>
          (await runtime()).workers.find(
            (w: any) => w.username === "retained04",
          )?.pid,
        { timeout: 10000 },
      )
      .toEqual(expect.any(Number));
    await expect(
      alice.getByText("Reconnecting · input blocked", { exact: true }),
    ).toHaveCount(0, { timeout: 10000 });
    await expect(
      alice.getByRole("heading", { name: "Instructor review required" }),
    ).toHaveCount(0);
    await alice.locator(".xterm-helper-textarea").last().focus();
    await alice.keyboard.type("recovered");
    await alice.keyboard.press("Enter");
    await expect(alice.locator(".xterm-rows")).toContainText(
      "Echo: proxy-private-recovered",
    );
    await bob.locator(".xterm-helper-textarea").last().focus();
    await bob.keyboard.type("surviving-retained-peer");
    await bob.keyboard.press("Enter");
    await expect(bob.locator(".xterm-rows")).toContainText(
      "Echo: surviving-retained-peer",
      { timeout: 5000 },
    );
    const final = await runtime();
    expect(final.pid).toBe(before.pid);
    expect(
      final.workers.find((w: any) => w.username === "retained05").pid,
    ).toBe(bobPid);
    expect(final.authenticationCalls).toEqual(before.authenticationCalls);
    expect(final.sshTransports).toContainEqual({
      transport: owner.transport_hash,
      username: "retained04",
      closed: false,
    });
    expect(final.terminalOpens).toBe(before.terminalOpens);
    expect(
      final.workers.find((w: any) => w.username === "retained04").pid,
    ).not.toBe(alicePid);
    expect(
      (await (await bob.request.get("/api/student/exam")).json()).attempt,
    ).toMatchObject({
      id: b.id,
      state: "ACTIVE",
      start: b.start,
      deadline: b.deadline,
      original_deadline: b.original_deadline,
      grant_id: b.grant_id,
    });
    const alerts = final.outbox.filter(
      (m: any) => m.subject === "Exam control proxy failure: retained04",
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0].body).toContain(`Attempt: ${a.id}`);
    expect(JSON.stringify(final.outbox)).not.toMatch(
      /shared-password|Class agent unavailable/,
    );
  } finally {
    await failed.close();
    await peer.close();
    await instructor.close();
  }
});

test("uncooperative retained page closure retires its gateway owner after positive SSH transport exit", async ({
  browser,
  request,
}) => {
  test.setTimeout(45000);
  const context = await browser.newContext();
  const page = await context.newPage();
  const runtime = async () =>
    (await request.get(origin + "/api/fixture/runtime")).json();
  try {
    const a = await begin(page, "retained06");
    const login = await request.post(origin + "/api/admin/login", {
      headers: { origin },
      data: { username: "instructor", password: "fixture-password" },
    });
    expect(login.ok(), await login.text()).toBe(true);
    const headers = { origin, "x-csrf-token": (await login.json()).csrf };
    const held = await request.post(origin + "/api/fixture/ssh-exit-reports", {
      headers,
      data: { held: true },
    });
    expect(held.ok(), await held.text()).toBe(true);
    const owner = JSON.parse(a.registered_owner);
    const before = await runtime();
    const worker = before.workers.find((w: any) => w.username === "retained06");
    expect(worker.pid).toBeGreaterThan(0);
    expect(
      before.sshTransports.find(
        (t: any) => t.transport === owner.transport_hash,
      ),
    ).toMatchObject({ username: "retained06", closed: false });
    await page.evaluate(() => {
      const send = WebSocket.prototype.send;
      WebSocket.prototype.send = function (data) {
        if (typeof data === "string" && JSON.parse(data).type === "incident")
          return;
        return send.call(this, data);
      };
    });
    await context.close();
    // Positive observation from the actual synthetic SSH server, not a missed
    // contact timer, empty pane list, browser assertion or default test timeout.
    await expect
      .poll(
        async () =>
          (await runtime()).sshTransports.find(
            (t: any) => t.transport === owner.transport_hash,
          )?.closed,
        { timeout: 5000 },
      )
      .toBe(true);
    await expect
      .poll(async () => (await runtime()).pendingSSHExitReports, {
        timeout: 5000,
      })
      .toContain(owner.transport_hash);
    expect(
      (await runtime()).workers.some((w: any) => w.pid === worker.pid),
    ).toBe(true);
    const inspect = async () =>
      (
        await (await request.get(origin + "/api/admin/attempts")).json()
      ).attempts.find((value: any) => value.id === a.id);
    expect(await inspect()).toMatchObject({
      state: "ACTIVE",
      generation: a.generation,
      start: a.start,
      deadline: a.deadline,
      original_deadline: a.original_deadline,
      grant_id: a.grant_id,
    });
    const released = await request.post(
      origin + "/api/fixture/ssh-exit-reports",
      {
        headers,
        data: { held: false },
      },
    );
    expect(released.ok(), await released.text()).toBe(true);
    await expect
      .poll(async () => (await runtime()).sshExitReports, { timeout: 5000 })
      .toContainEqual({
        transport: owner.transport_hash,
        attempt: a.id,
        status: 200,
      });
    await expect
      .poll(
        async () =>
          (await runtime()).workers.some((w: any) => w.pid === worker.pid),
        { timeout: 20000, intervals: [200, 500, 1000] },
      )
      .toBe(false);
    const after = await runtime();
    expect(after.pid).toBe(before.pid);
    expect(after.authenticationCalls).toEqual(before.authenticationCalls);
    expect(after.panes.filter((p: any) => p.attempt === a.id)).toHaveLength(0);
    expect(await inspect()).toMatchObject({
      state: "LOCKED",
      monitoring_hold_kind: "technical",
      start: a.start,
      deadline: a.deadline,
      original_deadline: a.original_deadline,
      grant_id: a.grant_id,
    });
  } finally {
    await context.close();
  }
});
