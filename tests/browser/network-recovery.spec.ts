import { test, expect, type Page } from "@playwright/test";
import {
  fixture,
  begin,
  openPreflight,
  ready,
  gate,
  resetScreens,
  onlyScreens,
} from "./transition-fixture.js";

async function type(page: Page, text: string) {
  // Exercise xterm's actual input handler even when its parent has become inert.
  await page
    .locator(".xterm-helper-textarea")
    .first()
    .evaluate((el, text) => {
      const area = el as HTMLTextAreaElement;
      area.value = text;
      area.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          data: text,
          inputType: "insertText",
        }),
      );
    }, text);
}
const inputs = (f: Awaited<ReturnType<typeof fixture>>) =>
  f.model.messages
    .filter((m) => m.type === "input")
    .map((m) => m.data)
    .join("");

for (const offline of [false, true]) {
  test(`brief ${offline ? "offline event" : "socket loss"} blocks input until a fresh bind acknowledgment without changing screens`, async ({
    page,
  }) => {
    const f = await fixture(page);
    await begin(page, f);
    await expect(page.locator(".winbox")).toHaveCount(1);
    await type(page, "before");
    await expect.poll(() => inputs(f)).toBe("before");
    await resetScreens(page);
    const ack = gate();
    f.model.onBind = async (socket, binding) => {
      await ack.promise;
      socket.send(JSON.stringify({ type: "state", binding, ...f.snapshot() }));
    };
    try {
      const old = f.model.socket!;
      if (offline) {
        await page.evaluate(() => window.dispatchEvent(new Event("offline")));
      } else old.close({ code: 1012, reason: "Network interruption" });
      await expect(
        page.getByText("Reconnecting · input blocked", { exact: true }),
      ).toBeVisible();
      await type(page, "discarded");
      if (offline)
        await page.evaluate(() => window.dispatchEvent(new Event("online")));
      await expect.poll(() => f.model.bindings.length).toBe(2);
      // An open WebSocket and unrelated state/HTTP replies do not establish ownership.
      const current = f.model.bindings.at(-1)!;
      current.socket.send(
        JSON.stringify({
          type: "state",
          binding: f.model.bindings[0].binding,
          ...f.snapshot(),
        }),
      );
      await expect(
        page.getByText("Reconnecting · input blocked", { exact: true }),
      ).toBeVisible();
      await type(page, "also-discarded");
      expect(inputs(f)).toBe("before");
      await onlyScreens(page, ["active", "Reconnecting"]);
      ack.release();
      await expect(
        page.getByText("Reconnecting · input blocked", { exact: true }),
      ).toHaveCount(0);
      await type(page, "after");
      await expect.poll(() => inputs(f)).toBe("beforeafter");
      await onlyScreens(page, ["active", "Reconnecting"]);
    } finally {
      ack.release();
    }
  });
}

test("an open but unacknowledged reconnect cannot outlive recovery grace or replay input; late ACTIVE replies cannot unlock", async ({
  page,
}) => {
  const f = await fixture(page),
    ack = gate();
  await begin(page, f);
  await expect(page.locator(".winbox")).toHaveCount(1);
  const original = { ...f.model.attempt };
  await resetScreens(page);
  f.model.onBind = async (socket, binding) => {
    await ack.promise;
    socket.send(JSON.stringify({ type: "state", binding, ...f.snapshot() }));
  };
  try {
    await page.clock.install();
    f.model.socket!.close({ code: 1012 });
    await expect(
      page.getByText("Reconnecting · input blocked", { exact: true }),
    ).toBeVisible();
    await page.clock.runFor(1500);
    await expect.poll(() => f.model.bindings.length).toBe(2);
    await type(page, "blocked");
    await page.clock.runFor(16000);
    await expect(
      page.getByRole("heading", { name: "Exam paused" }),
    ).toBeVisible();
    ack.release();
    await type(page, "late");
    await expect(
      page.getByRole("heading", { name: "Exam paused" }),
    ).toBeVisible();
    expect(inputs(f)).toBe("");
    expect(f.model.attempt.deadline).toBe(original.deadline);
    expect(f.model.messages.filter((m) => m.type === "incident")).toHaveLength(
      1,
    );
    await onlyScreens(page, ["active", "Reconnecting", "Exam paused"]);
    // Recovery cannot bypass the instructor's decision even after a late bind ACK.
    f.model.continuation = async (route) =>
      route.fulfill({
        status: 403,
        json: { error: "Instructor authorization required" },
      });
    await page
      .getByRole("button", { name: "Continue exam", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText(
      "Instructor authorization required",
    );
    await type(page, "unauthorized");
    expect(inputs(f)).toBe("");
  } finally {
    ack.release();
  }
});

test("a silent open connection with no heartbeat acknowledgments expires without enabling queued input", async ({
  page,
}) => {
  const f = await fixture(page);
  await begin(page, f);
  await expect(page.locator(".winbox")).toHaveCount(1);
  await page.clock.install();
  await resetScreens(page);
  await page.clock.runFor(15250);
  await expect(
    page.getByRole("heading", { name: "Exam paused" }),
  ).toBeVisible();
  f.send();
  await type(page, "blocked");
  expect(inputs(f)).toBe("");
  await onlyScreens(page, ["active", "Reconnecting", "Exam paused"]);
});

test("reloading ACTIVE waits for server-side recovery, preserves the deadline and renders only the recovery destination", async ({
  page,
}) => {
  const f = await fixture(page),
    recovery = gate();
  await begin(page, f);
  const deadline = f.model.attempt.deadline;
  let seen = false,
    fail = true;
  f.model.recover = async (route) => {
    seen = true;
    await recovery.promise;
    if (fail)
      return route.fulfill({
        status: 503,
        json: { error: "Recovery service unavailable" },
      });
    f.model.attempt.state = f.model.state = "LOCKED";
    f.model.attempt.generation++;
    f.model.authenticationGap = true;
    await route.fulfill({ json: f.snapshot() });
  };
  try {
    await page.reload();
    await expect.poll(() => seen).toBe(true);
    await expect(page.getByRole("status")).toHaveText("Loading…");
    await expect(page.locator(".workspace, form")).toHaveCount(0);
    await onlyScreens(page, ["loading", "empty"]);
    recovery.release();
    await expect(page.getByRole("alert")).toContainText(
      "Recovery service unavailable",
    );
    await expect(page.locator(".workspace, form")).toHaveCount(0);
    fail = false;
    await page.getByRole("button", { name: "Retry loading" }).click();
    await expect(
      page.getByRole("button", { name: "Restore page", exact: true }),
    ).toBeVisible();
    expect(f.model.attempt.deadline).toBe(deadline);
    await expect(page.locator(".workspace, form")).toHaveCount(0);
    await onlyScreens(page, ["loading", "empty", "summary"]);
  } finally {
    recovery.release();
  }
});

test("a delayed authorized continuation cannot unlock after a second interruption", async ({
  page,
}) => {
  const f = await fixture(page, "LOCKED"),
    response = gate();
  f.model.bind.release();
  await page.goto("/");
  await page.getByRole("button", { name: "Restore page", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Exam paused" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Restore screen sharing", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Restore fullscreen", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Restore keyboard lock", exact: true })
    .click();
  let seen = false;
  f.model.continuation = async (route) => {
    seen = true;
    await response.promise;
    f.model.attempt.state = "ACTIVE";
    await route.fulfill({ json: f.snapshot() });
  };
  try {
    await resetScreens(page);
    await page
      .getByRole("button", { name: "Continue exam", exact: true })
      .click();
    await expect.poll(() => seen).toBe(true);
    await page.evaluate(() => window.dispatchEvent(new Event("offline")));
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await expect.poll(() => f.model.bindings.length).toBe(2);
    response.release();
    await expect(page.getByRole("alert")).toContainText(
      "connection interrupted during setup",
    );
    await expect(
      page.getByRole("heading", { name: "Exam paused" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "New terminal", exact: true }),
    ).toBeDisabled();
    f.send();
    await expect(
      page.getByRole("heading", { name: "Exam paused" }),
    ).toBeVisible();
    expect(inputs(f)).toBe("");
    await onlyScreens(page, ["Exam paused"]);
  } finally {
    response.release();
  }
});

test("fresh delayed monitoring replies remain live when HTTP snapshots arrive first", async ({
  page,
}) => {
  test.setTimeout(50000);
  const f = await fixture(page);
  let running = true;
  f.model.onMonitoring = async (socket, message) => {
    if (!["preflight-contact", "heartbeat"].includes(message.type)) return;
    const reply = {
      type: "state",
      ...f.snapshot(),
      confirmation: message.confirmation,
    };
    // An ordinary HTTP poll overtakes the WebSocket reply. The snapshot is older,
    // but this is still a fresh response to this connection's monitoring request.
    await new Promise((resolve) => setTimeout(resolve, 3000));
    if (running) socket.send(JSON.stringify(reply));
  };
  await page.route("**/api/student/attempts/*/begin", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 9600));
    f.model.attempt.state = f.model.state = "ACTIVE";
    f.model.attempt.start = Date.now();
    f.model.attempt.deadline = Date.now() + 300000;
    await route.fulfill({ json: f.snapshot() });
  });
  try {
    await openPreflight(page, f);
    await ready(page);
    await page.waitForTimeout(18000);
    expect(f.model.bindings).toHaveLength(1);
    await expect(
      page.getByRole("button", { name: "Practice terminal", exact: true }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "Begin exam", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Begin exam", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Finish exam", exact: true }),
    ).toBeEnabled({ timeout: 15000 });
    await expect(page.locator(".winbox")).toHaveCount(1);
    // Replies generated before activation must not return the UI to preflight.
    await page.waitForTimeout(4000);
    await expect(
      page.getByRole("button", { name: "New terminal", exact: true }),
    ).toBeEnabled();
    await type(page, "working");
    await expect.poll(() => inputs(f)).toBe("working");
    expect(f.model.messages.filter((m) => m.type === "incident")).toHaveLength(
      0,
    );
  } finally {
    running = false;
  }
});

test("a fresh reconnect bind still confirms ownership when HTTP has a newer snapshot", async ({
  page,
}) => {
  const f = await fixture(page),
    ack = gate();
  await begin(page, f);
  let generated = 0;
  f.model.onBind = async (socket, binding) => {
    const snapshot = f.snapshot();
    generated = snapshot.serverNow;
    await ack.promise;
    socket.send(JSON.stringify({ type: "state", binding, ...snapshot }));
  };
  try {
    f.model.socket!.close({ code: 1012 });
    await expect.poll(() => f.model.bindings.length).toBe(2);
    await expect(
      page.getByText("Reconnecting · input blocked", { exact: true }),
    ).toBeVisible();
    await type(page, "discarded");
    let polled = 0;
    f.model.status = async (route) => {
      const snapshot = f.snapshot();
      polled = snapshot.serverNow;
      await route.fulfill({ json: snapshot });
    };
    await expect.poll(() => polled).toBeGreaterThan(generated);
    ack.release();
    await expect(
      page.getByText("Reconnecting · input blocked", { exact: true }),
    ).toHaveCount(0);
    await type(page, "after");
    await expect.poll(() => inputs(f)).toBe("after");
    expect(f.model.messages.filter((m) => m.type === "incident")).toHaveLength(
      0,
    );
  } finally {
    ack.release();
  }
});
