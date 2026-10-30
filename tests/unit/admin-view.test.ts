import { expect, it } from "vitest";
import {
  attemptStatus,
  hasProtectedFiles,
  clockEditable,
  matchesDashboardView,
  needsAttention,
} from "../../packages/protocol/admin.js";
it("keeps unverified collection separate from a secured submission", () => {
  expect(attemptStatus({ state: "COMPLETED", protected: 0 }).label).toBe(
    "File protection unconfirmed",
  );
  expect(attemptStatus({ state: "COMPLETED", protected: 1 }).label).toBe(
    "Files saved",
  );
  expect(
    attemptStatus({ state: "COLLECTION_FAILED", protected: 0 }).label,
  ).toBe("File collection needs attention");
  expect(
    matchesDashboardView({ state: "COMPLETED", protected: 0 }, "secured"),
  ).toBe(false);
});
it("distinguishes verified work, unconfirmed contact, pauses and attention", () => {
  expect(attemptStatus({ state: "ACTIVE", working: true }).label).toBe(
    "Working",
  );
  expect(attemptStatus({ state: "ACTIVE", working: false }).label).toBe(
    "Connection unconfirmed",
  );
  expect(
    attemptStatus({ state: "ACTIVE", working: false, connected: true }).label,
  ).toBe("Status updating");
  for (const working of [1, "true", null, undefined])
    expect(attemptStatus({ state: "ACTIVE", working }).label).toBe(
      "Connection unconfirmed",
    );
  expect(attemptStatus({ state: "LOCKED" }).label).toBe("Work paused");
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
    label: "Server access needs attention",
    tone: "danger",
  });
  expect(
    attemptStatus({ ...a, policy_state: "RESTORE_PENDING", policy_error: null })
      .label,
  ).toBe("Restoring server access");
  expect(
    attemptStatus({ ...a, policy_state: "NORMAL", policy_error: null }).label,
  ).toBe("Files saved");
});

it("claims saved files only for positive protection evidence", () => {
  for (const protected_ of [
    true,
    1,
    false,
    0,
    null,
    undefined,
    "0",
    "1",
    "true",
  ]) {
    const a = { protected: protected_ },
      positive = protected_ === true || protected_ === 1;
    expect(hasProtectedFiles(a)).toBe(positive);
    expect(attemptStatus({ ...a, state: "COMPLETED" }).label).toBe(
      positive ? "Files saved" : "File protection unconfirmed",
    );
    expect(attemptStatus({ ...a, state: "COLLECTION_FAILED" }).label).toBe(
      positive
        ? "Files saved; cleanup needs attention"
        : "File collection needs attention",
    );
  }
});

it("measures timed work including pauses, freezes finished durations and caps a still-open expired attempt", async () => {
  const { attemptElapsed, preflightElapsed } = await import(
    "../../packages/protocol/admin.js"
  );
  const a = { preflight_started_at: 1000, start: 61000, deadline: 361000 };
  expect(preflightElapsed(a, 90000)).toBe(60);
  expect(attemptElapsed({ ...a, state: "LOCKED" }, 181000)).toBe(120);
  expect(attemptElapsed({ ...a, ended: 121000 }, 999000)).toBe(60);
  expect(attemptElapsed(a, 999000)).toBe(300);
  expect(attemptElapsed({ ...a, state: "COMPLETED" }, 999000)).toBeNull();
  expect(attemptElapsed({ ...a, start: null }, 999000)).toBeNull();
  expect(
    preflightElapsed({ preflight_started_at: 1000, ended: 31000 }, 999000),
  ).toBe(30);
  expect(preflightElapsed({ start: 61000 }, 999000)).toBeNull();
});
