import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { fixture, begin } from "./transition-fixture.js";

type Fixture = Awaited<ReturnType<typeof fixture>>;
const pasted = (f: Fixture) =>
  f.model.messages
    .filter((m) => m.type === "input")
    .map((m) => m.data)
    .join("");
function output(f: Fixture, data: Buffer, pane?: string) {
  pane ||= f.model.messages.find((m) => m.type === "open").pane;
  f.model.socket!.send(
    JSON.stringify({ type: "output", pane, data: data.toString("base64") }),
  );
}
function osc(text: string) {
  return Buffer.from(`\x1b]52;c;${Buffer.from(text).toString("base64")}\x1b\\`);
}
async function paste(page: Page) {
  await page
    .locator(".winbox")
    .last()
    .locator(".xterm-helper-textarea")
    .focus();
  await page.keyboard.press("Control+Shift+V");
}
async function setup(page: Page) {
  await page.addInitScript(() => {
    (window as any).__clipboardCalls = 0;
    Object.defineProperty(navigator, "clipboard", {
      value: {
        writeText: () => {
          (window as any).__clipboardCalls++;
          throw Error("OS clipboard write");
        },
        readText: () => {
          (window as any).__clipboardCalls++;
          throw Error("OS clipboard read");
        },
      },
    });
  });
  const f = await fixture(page);
  await begin(page, f);
  await expect(page.locator(".winbox")).toHaveCount(1);
  return f;
}

test("real terminal Emacs C-w feeds the attempt clipboard and pastes into another pane", async ({
  page,
}) => {
  const bytes = execFileSync("python3", ["tests/fixtures/emacs-clipboard.py"], {
    timeout: 20000,
  });
  expect(bytes.includes(Buffer.from("\x1b]52;c;"))).toBe(true);
  const f = await setup(page);
  output(f, bytes);
  // xterm processes output asynchronously; a visible redraw marks the write drained.
  await expect(page.locator(".xterm-rows")).toContainText("clipboard-test");
  await page.getByRole("button", { name: "New terminal", exact: true }).click();
  await expect(page.locator(".winbox")).toHaveCount(2);
  await paste(page);
  const secondPane = f.model.messages
    .filter((m) => m.type === "open")
    .at(-1).pane;
  await expect
    .poll(() =>
      f.model.messages
        .filter((m) => m.type === "input" && m.pane === secondPane)
        .map((m) => m.data)
        .join(""),
    )
    .toBe("Emacs clipboard λ 🌍\rsecond line");
  expect(await page.evaluate(() => (window as any).__clipboardCalls)).toBe(0);
});

test("large OSC writes paste losslessly in bounded input messages; queries and malformed writes have no effect", async ({
  page,
}) => {
  const f = await setup(page);
  const text = "x".repeat(15999) + "🌍" + "y".repeat(22000);
  output(
    f,
    Buffer.concat([
      osc(text),
      Buffer.from("\x1b]52;c;?\x07\x1b]52;c;not-base64!\x07DONE"),
    ]),
  );
  await expect(page.locator(".xterm-rows")).toContainText("DONE");
  // Queries must not elicit a reply to the remote application.
  expect(pasted(f)).toBe("");
  await paste(page);
  await expect.poll(() => pasted(f)).toBe(text);
  expect(
    f.model.messages
      .filter((m) => m.type === "input")
      .every((m) => m.data.length <= 16000),
  ).toBe(true);
  expect(await page.evaluate(() => (window as any).__clipboardCalls)).toBe(0);
});

test("covered and locked terminals cannot replace or paste the attempt clipboard", async ({
  page,
}) => {
  const f = await setup(page);
  output(f, Buffer.concat([osc("allowed"), Buffer.from("READY")]));
  await expect(page.locator(".xterm-rows")).toContainText("READY");
  const finish = page.getByRole("button", { name: "Finish exam", exact: true });
  await finish.click();
  await expect(
    page.getByRole("dialog", { name: "Finish exam?", exact: true }),
  ).toBeVisible();
  output(f, Buffer.concat([osc("covered"), Buffer.from("IGNORED")]));
  await expect(page.locator(".xterm-rows")).toContainText("IGNORED");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // Modal cleanup restores its opener in an animation frame. Observe that
  // boundary before intentionally moving focus to the terminal for paste.
  await expect(finish).toBeFocused();
  await paste(page);
  await expect.poll(() => pasted(f)).toBe("allowed");
  await page.evaluate(() => document.exitFullscreen());
  await expect(
    page.getByRole("heading", { name: "Exam paused" }),
  ).toBeVisible();
  output(f, osc("locked"));
  await page.keyboard.press("Control+Shift+V");
  expect(pasted(f)).toBe("allowed");
});
