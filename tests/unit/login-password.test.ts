import { expect, it } from "vitest";
import {
  LoginPassword,
  isPasswordPrompt,
  wipeAuthPacket,
} from "../../apps/server/src/login-password.js";
it("holds one attempt, clears answer references and overwrites its buffer", () => {
  const scope = new LoginPassword();
  const answers = ["synthetic-secret"];
  scope.capture(answers);
  expect(answers).toEqual([""]);
  const original = (scope as any).value as Buffer;
  const copy = scope.copy();
  expect(copy.toString()).toBe("synthetic-secret");
  copy.fill(0);
  scope.clear();
  expect(original.equals(Buffer.alloc(original.length))).toBe(true);
  expect((scope as any).value).toBeUndefined();
  expect(scope.available).toBe(false);
  expect(() => scope.copy()).toThrow();
  const late = ["late-secret"];
  expect(() => scope.capture(late)).toThrow();
  expect(late).toEqual([""]);
});
it("rejects replacement and invalid capture without retaining their answers", () => {
  const scope = new LoginPassword();
  const invalid = ["one", "two"];
  expect(() => scope.capture(invalid)).toThrow();
  expect(invalid).toEqual(["", ""]);
  scope.capture(["first"]);
  const replacement = ["second"];
  expect(() => scope.capture(replacement)).toThrow();
  expect(replacement).toEqual([""]);
  expect(scope.copy().toString()).toBe("first");
  scope.clear();
});
it("recognizes only explicit hidden password prompts for the configured identity", () => {
  for (const prompt of [
    "Password:",
    "SSH password",
    "Jump password",
    "Entra Id Password: ",
    "student@csc-sys.cdm.depaul.edu's password:",
  ])
    expect(
      isPasswordPrompt(
        { prompt, echo: false },
        "student",
        "csc-sys.cdm.depaul.edu",
      ),
    ).toBe(true);
  for (const prompt of [
    "Verification code",
    "Passcode",
    "PIN",
    "New password",
    "Password or OTP",
    "Entra Id Passcode",
    "New Entra Id Password",
    "Select a method",
    "other@evil.example's password:",
    "Enter anything:",
  ])
    expect(
      isPasswordPrompt(
        { prompt, echo: false },
        "student",
        "csc-sys.cdm.depaul.edu",
      ),
    ).toBe(false);
  expect(
    isPasswordPrompt(
      { prompt: "Password", echo: true },
      "student",
      "csc-sys.cdm.depaul.edu",
    ),
  ).toBe(false);
});
it("overwrites websocket packet formats without retaining parsed secrets", () => {
  for (const packet of [
    Buffer.from("secret"),
    new Uint8Array([1, 2, 3]).buffer,
    [Buffer.from("secret"), Buffer.from("two")],
  ]) {
    wipeAuthPacket(packet);
    const bytes = Array.isArray(packet)
      ? Buffer.concat(packet)
      : Buffer.from(packet as any);
    expect([...bytes].every((b) => b === 0)).toBe(true);
  }
});
