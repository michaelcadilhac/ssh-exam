import { test, expect, type Page } from "@playwright/test";
import { simulatedMedia, ready } from "./transition-fixture.js";

const origin = "http://localhost:3100";
async function begin(page: Page, username: string) {
  await simulatedMedia(page);
  await page.goto("/");
  expect(
    (await (await page.request.get("/api/login-test")).json()).browserSSH,
  ).toBe(true);
  await page.getByLabel("Exam ID", { exact: true }).fill("retained-control");
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
test("a killed retained gateway child requests fresh SSH without changing time or interrupting a peer", async ({
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
    const a = await begin(alice, "retained01"),
      b = await begin(bob, "retained02");
    const runtime = async () =>
      (await bob.request.get("/api/fixture/runtime")).json();
    const before = await runtime();
    expect(before.nativeBeginRequests).toEqual(
      expect.arrayContaining([a.id, b.id]),
    );
    const alicePid = before.workers.find(
      (w: any) => w.username === "retained01",
    ).pid;
    const bobPid = before.workers.find(
      (w: any) => w.username === "retained02",
    ).pid;
    expect(alicePid).not.toBe(bobPid);
    expect(before.panes.filter((p: any) => p.attempt === a.id)).toHaveLength(1);
    const login = await admin.request.post(origin + "/api/admin/login", {
      headers: { origin },
      data: { username: "instructor", password: "fixture-password" },
    });
    expect(login.ok(), await login.text()).toBe(true);
    const headers = { origin, "x-csrf-token": (await login.json()).csrf };
    const fault = await admin.request.post(origin + "/api/fixture/fault", {
      headers,
      data: { username: "retained01", fault: "kill" },
    });
    expect(fault.ok(), await fault.text()).toBe(true);
    expect((await fault.json()).pid).toBe(alicePid);
    await expect(
      alice.getByRole("heading", { name: "Instructor review required" }),
    ).toBeVisible({ timeout: 15000 });
    await expect
      .poll(
        async () =>
          (await runtime()).workers.some((w: any) => w.pid === alicePid),
        { timeout: 10000 },
      )
      .toBe(false);
    await expect
      .poll(
        async () =>
          (await runtime()).panes.filter((p: any) => p.attempt === a.id),
        { timeout: 10000 },
      )
      .toHaveLength(0);
    const current = (
      await (await alice.request.get("/api/student/exam")).json()
    ).attempt;
    expect(current).toMatchObject({
      id: a.id,
      state: "LOCKED",
      start: a.start,
      deadline: a.deadline,
      original_deadline: a.original_deadline,
      grant_id: a.grant_id,
    });
    expect(current.reason).toContain("connection process failed");
    await alice
      .getByRole("button", { name: "Reconnect SSH", exact: true })
      .click({ timeout: 5000 });
    await expect(alice.getByRole("alert")).toContainText(
      "Instructor authorization required",
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
      final.workers.find((w: any) => w.username === "retained02").pid,
    ).toBe(bobPid);
    expect(final.authenticationCalls).toEqual(before.authenticationCalls);
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
      (m: any) => m.subject === "Exam connection failure: retained01",
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
