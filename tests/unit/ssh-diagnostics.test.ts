import { expect, it } from "vitest";
import {
  safeSSHDiagnostic,
  sshObservation,
} from "../../packages/protocol/ssh-diagnostics.js";
it("accepts only bounded failure categories, never raw error or credential fields", () => {
  const diagnostic = { stage: "ssh-wait", cause: "eof" };
  expect(safeSSHDiagnostic(diagnostic)).toEqual(diagnostic);
  expect(
    safeSSHDiagnostic({ stage: "open", cause: "channel-capacity" }),
  ).toEqual({ stage: "open", cause: "channel-capacity" });
  expect(
    safeSSHDiagnostic({ stage: "open", cause: "admission-refused" }),
  ).toEqual({ stage: "open", cause: "admission-refused" });
  for (const value of [
    { ...diagnostic, password: "SECRET" },
    { ...diagnostic, cause: "password=SECRET" },
    { ...diagnostic, stage: "private terminal" },
    { ...diagnostic, close_code: Infinity },
    { ...diagnostic, close_code: 999 },
    { ...diagnostic, was_clean: "true" },
    { ...diagnostic, visible: "visible" },
    { ...diagnostic, close_intent: "private reason" },
    { ...diagnostic, url: "wss://PRIVATE" },
    { ...diagnostic, reason: "PRIVATE CLOSE TEXT" },
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
it("accepts fixed socket/lifecycle metadata while keeping it untrusted and bounded", () => {
  expect(
    safeSSHDiagnostic({
      stage: "relay-socket-close",
      cause: "peer-close",
      close_code: 1006,
      was_clean: false,
      visible: true,
      focused: false,
      online: true,
    }),
  ).toEqual({
    stage: "relay-socket-close",
    cause: "peer-close",
    close_code: 1006,
    was_clean: false,
    visible: true,
    focused: false,
    online: true,
  });
  expect(
    safeSSHDiagnostic({
      stage: "browser-client-close",
      cause: "client-close",
      close_intent: "sign-out",
    }),
  ).toBeDefined();
  expect(
    safeSSHDiagnostic({
      stage: "browser-lifecycle",
      cause: "page-hide",
      page_persisted: true,
    }),
  ).toBeDefined();
});
