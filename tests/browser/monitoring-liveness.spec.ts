import { test, expect } from "@playwright/test";
import { fixture, begin, simulatedMedia, ready } from "./transition-fixture.js";

test("contact-only acknowledgements cannot bind a page or substitute for initial state", async ({
  page,
}) => {
  const f = await fixture(page);
  f.model.onBind = async (socket, binding) => {
    socket.send(
      JSON.stringify({
        type: "monitoring-contact",
        attempt: f.model.attempt.id,
        confirmation: binding,
        state: "ACTIVE",
      }),
    );
  };
  await page.goto("/");
  await page.getByRole("button", { name: "Open preflight & practice" }).click();
  await expect.poll(() => f.model.bindSeen).toBe(true);
  await expect(
    page.getByRole("button", { name: "Practice terminal", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Begin exam", exact: true }),
  ).toBeDisabled();
  const last = f.model.bindings.at(-1)!;
  last.socket.send(
    JSON.stringify({ type: "state", binding: last.binding, ...f.snapshot() }),
  );
  await expect(
    page.getByRole("button", { name: "Practice terminal", exact: true }),
  ).toBeEnabled();
});

test("contact-only acknowledgements never thaw a policy lock", async ({
  page,
}) => {
  const f = await fixture(page);
  f.model.onMonitoring = async (socket, m) => {
    if (m.confirmation)
      socket.send(
        JSON.stringify({
          type: "monitoring-contact",
          attempt: f.model.attempt.id,
          confirmation: m.confirmation,
          state: "ACTIVE",
        }),
      );
  };
  await begin(page, f);
  Object.assign(f.model.attempt, {
    state: "LOCKED",
    generation: 1,
    reason: "Workspace exited fullscreen",
  });
  f.model.state = "LOCKED";
  f.send();
  await expect(
    page.getByRole("heading", { name: "Exam paused" }),
  ).toBeVisible();
  const previous = f.model.messages.length;
  await expect.poll(() => f.model.messages.length).toBeGreaterThan(previous);
  await expect(
    page.getByRole("heading", { name: "Exam paused" }),
  ).toBeVisible();
  expect(f.model.messages.filter((m) => m.type === "input")).toEqual([]);
});

test("real browser SSH keeps contact and terminal input when only final heartbeat state replies are lost", async ({
  page,
}) => {
  test.setTimeout(60000);
  let loseState = false,
    lost = 0,
    contacts = 0,
    uploads = 0;
  await page.routeWebSocket("**/api/student/session", (socket) => {
    const upstream = socket.connectToServer();
    upstream.onMessage((raw) => {
      const m = JSON.parse(String(raw));
      if (loseState && m.type === "state" && m.confirmation) {
        lost++;
        return;
      }
      if (loseState && m.type === "monitoring-contact") contacts++;
      socket.send(raw);
    });
  });
  page.on("response", (response) => {
    if (
      loseState &&
      response.url().endsWith("/frames") &&
      response.status() === 200
    )
      uploads++;
  });
  await simulatedMedia(page);
  await page.goto("/");
  await page.getByLabel("Exam ID", { exact: true }).fill("monitoring-liveness");
  await page.getByLabel("Enrolled username").fill("monitoring01");
  await page
    .getByRole("button", { name: "Start SSH sign-in", exact: true })
    .click();
  await page.getByLabel("Shared SSH password").fill("shared-password");
  await page
    .getByRole("button", { name: "Respond to this host", exact: true })
    .click();
  await page.getByRole("button", { name: "Open preflight & practice" }).click();
  await ready(page);
  await page.getByRole("button", { name: "Begin exam", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Begin exam", exact: true })
    .click();
  await expect(page.locator(".winbox")).toHaveCount(1);
  const original = (await (await page.request.get("/api/student/exam")).json())
    .attempt;
  loseState = true;
  // Exceed the original 15-second browser confirmation threshold. Native
  // renewals still succeed: this test drops only their final browser snapshots.
  await page.waitForTimeout(17500);
  expect(lost).toBeGreaterThanOrEqual(7);
  expect(contacts).toBeGreaterThanOrEqual(7);
  expect(uploads).toBeGreaterThanOrEqual(3);
  const current = (await (await page.request.get("/api/student/exam")).json())
    .attempt;
  expect(current).toMatchObject({
    id: original.id,
    state: "ACTIVE",
    generation: original.generation,
    deadline: original.deadline,
    original_deadline: original.original_deadline,
  });
  await expect(page.getByRole("heading", { name: "Exam paused" })).toHaveCount(
    0,
  );
  await page.locator(".xterm-helper-textarea").last().focus();
  await page.keyboard.type("contact-independent-terminal");
  await page.keyboard.press("Enter");
  await expect(page.locator(".xterm-rows")).toContainText(
    "Echo: contact-independent-terminal",
  );
  loseState = false;
});
