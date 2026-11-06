import { expect, test } from "@playwright/test";
import { fixture, begin, readyTerminal } from "./transition-fixture.js";

// UI metadata/clock fixture; actual signed timer controls, expiry, monitored
// input and shell preservation are separately exercised in the native suite.
test("student countdown stays fixed while paused and keeps its terminal past the old deadline", async ({
  page,
}) => {
  test.setTimeout(90000);
  const f = await fixture(page, "NONE", "student", "timer-student-fixture", 60);
  Object.assign(f.model.attempt, { monitoring_mode: "v1" });
  f.model.onMonitoring = async (socket, message) => {
    if (["preflight-contact", "heartbeat"].includes(message.type))
      socket.send(
        JSON.stringify({
          type: "state",
          ...f.snapshot(),
          confirmation: message.confirmation,
        }),
      );
  };
  await begin(page, f);
  const input = async (text: string) => {
    const pane = await readyTerminal(page, 1, 0);
    await pane.locator(".xterm-helper-textarea").evaluate((el, text) => {
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
  };
  await input("before");
  await expect
    .poll(() =>
      f.model.messages
        .filter((m) => m.type === "input")
        .map((m) => m.data)
        .join(""),
    )
    .toBe("before");
  const a: any = f.model.attempt,
    original = a.deadline,
    at = Date.now();
  const record = {
    id: "33333333-3333-4333-8333-333333333333",
    actor: "instructor",
    requested_at: at,
    applied_at: at,
    previous_deadline: original,
    deadline: original,
    remaining_seconds: 0,
    revision: 1,
    pause_timer: true,
    timer_paused_at: at,
    timer_remaining_ms: original - at,
  };
  Object.assign(a, {
    clock_revision: 1,
    original_deadline: original,
    clock_resets: JSON.stringify([record]),
    timer_paused_at: at,
    timer_remaining_ms: record.timer_remaining_ms,
  });
  f.send();
  await expect(page.locator(".time")).toContainText("Countdown paused");
  const value = await page.locator(".time b").textContent();
  // Keep browser timers, xterm event scheduling and synthetic server time on
  // the SAME real clock. Virtual jumps can outrun asynchronous socket replies
  // and manufacture the unrelated coordination loss this test must not cause.
  await expect
    .poll(() => Date.now() > original + 200, {
      timeout: 70000,
      intervals: [1000],
    })
    .toBe(true);
  await expect(page.locator(".time b")).toHaveText(value!);
  await expect(
    page.getByRole("button", { name: "Finish exam", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("heading", { name: "Saving your files", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".winbox")).toHaveCount(1);
  await input("still working");
  await expect
    .poll(() =>
      f.model.messages
        .filter((m) => m.type === "input")
        .map((m) => m.data)
        .join(""),
    )
    .toBe("beforestill working");
  expect(a.deadline).toBe(original);
});
