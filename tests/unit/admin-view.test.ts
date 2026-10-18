import { expect, it } from "vitest";
import {
  attemptStatus,
  clockEditable,
  matchesDashboardView,
  needsAttention,
} from "../../packages/protocol/admin.js";
it("keeps unverified collection separate from a secured submission", () => {
  expect(attemptStatus({ state: "COMPLETED", protected: 0 }).label).toBe(
    "Collection pending",
  );
  expect(attemptStatus({ state: "COMPLETED", protected: 1 }).label).toBe(
    "Submission secured",
  );
  expect(
    attemptStatus({ state: "COLLECTION_FAILED", protected: 0 }).label,
  ).toBe("Collection failed");
  expect(
    matchesDashboardView({ state: "COMPLETED", protected: 0 }, "secured"),
  ).toBe(false);
});
it("distinguishes connected work, disconnection, pauses and attention", () => {
  expect(attemptStatus({ state: "ACTIVE", working: true }).label).toBe(
    "Working",
  );
  expect(attemptStatus({ state: "ACTIVE", working: false }).label).toBe(
    "Disconnected",
  );
  expect(attemptStatus({ state: "LOCKED" }).label).toBe("Paused");
  expect(needsAttention({ state: "LOCKED" })).toBe(true);
  expect(needsAttention({ state: "COLLECTION_FAILED" })).toBe(true);
  expect(needsAttention({ state: "FINALIZING" })).toBe(false);
  expect(
    matchesDashboardView({ state: "ACTIVE", working: false }, "working"),
  ).toBe(false);
});
it("limits clock selection to live, unprotected attempts without a pending change", () => {
  const a = { state: "ACTIVE", deadline: 2000, protected: 0 };
  expect(clockEditable(a, 1000)).toBe(true);
  for (const blocked of [
    { ...a, deadline: 1000 },
    { ...a, protected: 1 },
    { ...a, pendingClockReset: {} },
    { ...a, state: "COMPLETED" },
  ])
    expect(clockEditable(blocked, 1000)).toBe(false);
});

it("shows restoration failures independently of a secured submission", () => {
  const a = {
    state: "COMPLETED",
    protected: 1,
    policy_state: "RESTORE_FAILED",
    policy_error: "NSS verification failed",
  };
  expect(needsAttention(a)).toBe(true);
  expect(matchesDashboardView(a, "attention")).toBe(true);
  expect(matchesDashboardView(a, "secured")).toBe(true);
  expect(attemptStatus(a)).toEqual({
    label: "Access recovery required",
    tone: "danger",
  });
  expect(
    attemptStatus({ ...a, policy_state: "RESTORE_PENDING", policy_error: null })
      .label,
  ).toBe("Restoring access");
  expect(
    attemptStatus({ ...a, policy_state: "NORMAL", policy_error: null }).label,
  ).toBe("Submission secured");
});
