import { expect, it } from "vitest";
import {
  safeSSHDiagnostic,
  sshObservation,
} from "../../packages/protocol/ssh-diagnostics.js";
it("accepts only bounded failure categories, never raw error or credential fields", () => {
  const diagnostic = { stage: "ssh-wait", cause: "eof" };
  expect(safeSSHDiagnostic(diagnostic)).toEqual(diagnostic);
  for (const value of [
    { ...diagnostic, password: "SECRET" },
    { ...diagnostic, cause: "password=SECRET" },
    { ...diagnostic, stage: "private terminal" },
    { ...diagnostic, close_code: Infinity },
    { ...diagnostic, close_code: 999 },
  ])
    expect(safeSSHDiagnostic(value)).toBeUndefined();
  expect(
    sshObservation.parse({ ...diagnostic, relay_reference: "a".repeat(24) }),
  ).toMatchObject({ relay_reference: "a".repeat(24) });
  expect(
    sshObservation.safeParse({
      ...diagnostic,
      relay_reference: "reusable-ticket",
    }).success,
  ).toBe(false);
});
