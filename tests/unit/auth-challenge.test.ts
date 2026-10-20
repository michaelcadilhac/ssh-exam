import { expect, it } from "vitest";
import {
  authMessageBlocks,
  isPhoneApprovalChallenge,
  updateAuthChallenge,
} from "../../apps/web/src/auth-challenge.js";

it("reflows terminal-width banners without joining paragraphs or losing MFA instructions", () => {
  expect(
    authMessageBlocks(
      "----------------------------------------\r\nThis is a DePaul University resource. This computer\r\nsystem, and all\r\nrelated equipment are provided for\r\nauthorized use only.\r\n----------------------------------------\r\n\r\nOpen your Authenticator app, and enter the number\r\n'96' to sign in.",
    ),
  ).toEqual([
    { kind: "separator", text: "----------------------------------------" },
    {
      kind: "paragraph",
      text: "This is a DePaul University resource. This computer system, and all related equipment are provided for authorized use only.",
    },
    { kind: "separator", text: "----------------------------------------" },
    {
      kind: "paragraph",
      text: "Open your Authenticator app, and enter the number '96' to sign in.",
    },
  ]);
});

it("preserves lists, indented output and separate paragraphs", () => {
  expect(
    authMessageBlocks(
      "Choose a method:\n\n1. Phone\n2. Security key\n\n  Code: 42\n  Status: pending\n\nApproval pending",
    ),
  ).toEqual([
    { kind: "paragraph", text: "Choose a method:" },
    { kind: "formatted", text: "1. Phone\n2. Security key" },
    { kind: "formatted", text: "  Code: 42\n  Status: pending" },
    { kind: "paragraph", text: "Approval pending" },
  ]);
});
const challenge = (
  instruction: string,
  host = "jump",
  prompts: any[] = [],
) => ({
  type: "challenge" as const,
  host,
  instruction,
  prompts,
  round: crypto.randomUUID(),
});
it("recognizes only DePaul's explicit phone number-matching empty Code acknowledgment", () => {
  const phone = {
    ...challenge(
      "Open your Authenticator app, and enter the number\n'59' to sign in.",
      "sshjump.depaul.edu",
      [{ prompt: "Code:", echo: false }],
    ),
    instructions: [
      "Open your Authenticator app, and enter the number '59' to sign in.",
    ],
  };
  expect(isPhoneApprovalChallenge(phone)).toBe(true);
  expect(
    isPhoneApprovalChallenge({ ...phone, host: "other.example.edu" }),
  ).toBe(false);
  expect(
    isPhoneApprovalChallenge({
      ...phone,
      instruction: "Enter your six-digit verification code.",
      instructions: [
        ...phone.instructions,
        "Enter your six-digit verification code.",
      ],
    }),
  ).toBe(false);
  expect(
    isPhoneApprovalChallenge({
      ...phone,
      prompts: [{ prompt: "OTP:", echo: false }],
    }),
  ).toBe(false);
  expect(
    isPhoneApprovalChallenge({
      ...phone,
      prompts: [{ prompt: "Code:", echo: true }],
    }),
  ).toBe(false);
  expect(
    isPhoneApprovalChallenge({
      ...phone,
      prompts: [...phone.prompts, { prompt: "Security key:", echo: false }],
    }),
  ).toBe(false);
  expect(isPhoneApprovalChallenge(null)).toBe(false);
});
it("retains number matching across empty rounds and later notices without duplicating messages", () => {
  let state = updateAuthChallenge(
    null,
    challenge("Enter number 42 in your app."),
  );
  state = updateAuthChallenge(state, challenge(""));
  state = updateAuthChallenge(state, challenge("Approval pending"));
  state = updateAuthChallenge(state, challenge("Enter number 42 in your app."));
  expect(state.instructions).toEqual([
    "Enter number 42 in your app.",
    "Approval pending",
  ]);
});
it("notices preserve the pending prompt and round, while a new host clears old MFA instructions", () => {
  const password = challenge("Password required", "class", [
    { prompt: "Password", echo: false },
  ]);
  let state = updateAuthChallenge(null, password);
  state = updateAuthChallenge(state, {
    ...challenge("A host notice", "class"),
    type: "notice",
  });
  expect(state.round).toBe(password.round);
  expect(state.prompts).toEqual(password.prompts);
  expect(state.instructions).toEqual(["Password required", "A host notice"]);
  state = updateAuthChallenge(state, challenge("New host", "other"));
  expect(state.instructions).toEqual(["New host"]);
});
it("ignores late notices from an earlier host and clears history for a fresh authentication", () => {
  const state = updateAuthChallenge(
    null,
    challenge("Enter class password", "class"),
  );
  expect(
    updateAuthChallenge(state, { ...challenge("Old code 42"), type: "notice" }),
  ).toBe(state);
  expect(
    updateAuthChallenge(null, challenge("Fresh password")).instructions,
  ).toEqual(["Fresh password"]);
});
