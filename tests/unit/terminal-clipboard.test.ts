import { expect, it } from "vitest";
import {
  decodeTerminalClipboard,
  MAX_TERMINAL_CLIPBOARD_BYTES,
} from "../../apps/web/src/terminal-clipboard.js";
const encode = (text: string) => Buffer.from(text).toString("base64");
it.each(["c", "p", "cp", "pc", ""])(
  "accepts UTF-8 clipboard writes for selection %j",
  (selection) => {
    const text = "Emacs λ\nsecond line 🦊";
    expect(decodeTerminalClipboard(`${selection};${encode(text)}`)).toBe(text);
  },
);
it("accepts explicit clearing and never treats invalid input as empty text", () => {
  expect(decodeTerminalClipboard("c;")).toBe("");
  for (const payload of [
    "c;?",
    "p;?",
    ";?",
    "c;!!!",
    "c;Zg",
    "c;Zh==",
    "c;Zg===",
    "c;Zg==\n",
    "c;Zg==;",
    "c;Zg==?",
    "s;Zg==",
    "0;Zg==",
    "c;p;Zg==",
    "missing separator",
    "c;/w==",
  ]) {
    expect(decodeTerminalClipboard(payload), payload).toBeNull();
  }
});
it("bounds decoded payloads without truncating text", () => {
  const text = "x".repeat(MAX_TERMINAL_CLIPBOARD_BYTES);
  expect(decodeTerminalClipboard(`c;${encode(text)}`)).toBe(text);
  expect(decodeTerminalClipboard(`c;${encode(text + "x")}`)).toBeNull();
  expect(
    decodeTerminalClipboard(
      `c;${encode("λ".repeat(MAX_TERMINAL_CLIPBOARD_BYTES))}`,
    ),
  ).toBeNull();
});
