import { afterEach, describe, expect, it, vi } from "vitest";
import type { Page } from "@playwright/test";
import {
  openUnauthenticatedStressWelcome,
  waitForStressStartResponse,
  waitForStressExamSummary,
} from "../fixtures/stress-navigation.js";

describe("acknowledged exam summary read recovery", () => {
  const identity = { username: "synthetic", exam: "synthetic-exam" };
  function setup(
    options: {
      visible?: boolean;
      sessionOK?: boolean;
      examOK?: boolean;
      user?: unknown;
      attempt?: unknown;
      repeated?: boolean;
    } = {},
  ) {
    let visible = options.visible ?? false;
    const summary = {
      isVisible: vi.fn(async () => visible),
      waitFor: vi.fn(async () => {
        if (!visible) throw Error("Summary still unavailable");
      }),
      or: vi.fn(() => ({ waitFor: vi.fn(async () => {}) })),
    };
    const retry = {
      click: vi.fn(async () => {
        visible = !options.repeated;
      }),
    };
    const get = vi.fn(async (path: string) => ({
      ok: () =>
        path === "/api/session"
          ? options.sessionOK !== false
          : options.examOK !== false,
      json: async () =>
        path === "/api/session"
          ? (options.user ?? { role: "student", ...identity })
          : {
              attempt: Object.hasOwn(options, "attempt")
                ? options.attempt
                : null,
            },
    }));
    const page = {
      getByRole: (_: string, options: { name: string }) =>
        options.name === "Retry opening exam" ? retry : summary,
      request: { get },
    } as unknown as Pick<Page, "getByRole" | "request">;
    return { page, get, retry, summary, note: vi.fn() };
  }
  it("leaves an already visible summary alone", async () => {
    const f = setup({ visible: true });
    await waitForStressExamSummary(f.page, identity, () => false, f.note);
    expect(f.get).not.toHaveBeenCalled();
    expect(f.retry.click).not.toHaveBeenCalled();
    expect(f.note).not.toHaveBeenCalled();
  });
  it("checks the signed-in unstarted account before one normal retry", async () => {
    const f = setup();
    await waitForStressExamSummary(f.page, identity, () => true, f.note);
    expect(f.get.mock.calls.map((call) => call[0])).toEqual([
      "/api/session",
      "/api/student/exam",
    ]);
    expect(f.retry.click).toHaveBeenCalledTimes(1);
    expect(f.note).toHaveBeenCalledTimes(1);
  });
  it("never retries unacknowledged authentication", async () => {
    const f = setup();
    await expect(
      waitForStressExamSummary(f.page, identity, () => false, f.note),
    ).rejects.toThrow("acknowledged authentication");
    expect(f.get).not.toHaveBeenCalled();
    expect(f.retry.click).not.toHaveBeenCalled();
  });
  it.each([
    { sessionOK: false },
    { user: { role: "admin", ...identity } },
    { user: { role: "student", ...identity, username: "another" } },
    { user: { role: "student", ...identity, exam: "another" } },
    { attempt: { state: "PREPARING", start: null } },
    { attempt: { state: "ACTIVE", start: 1 } },
    { attempt: undefined },
    { examOK: false },
  ])("refuses ambiguous or changed authority: %j", async (options) => {
    const f = setup(options);
    await expect(
      waitForStressExamSummary(f.page, identity, () => true, f.note),
    ).rejects.toThrow("no retry performed");
    expect(f.retry.click).not.toHaveBeenCalled();
    expect(f.note).not.toHaveBeenCalled();
  });
  it("does not turn a repeated read failure into a retry loop", async () => {
    const f = setup({ repeated: true });
    await expect(
      waitForStressExamSummary(f.page, identity, () => true, f.note),
    ).rejects.toThrow("Summary still unavailable");
    expect(f.retry.click).toHaveBeenCalledTimes(1);
  });
});

describe("unauthenticated stress welcome navigation", () => {
  const origin = "https://127.0.0.1:9444";
  it("leaves a successful navigation unchanged", async () => {
    const page = {
      goto: vi.fn().mockResolvedValue(null),
      waitForTimeout: vi.fn(),
    };
    const note = vi.fn();
    await openUnauthenticatedStressWelcome(page, origin, note);
    expect(page.goto).toHaveBeenCalledTimes(1);
    expect(page.waitForTimeout).not.toHaveBeenCalled();
    expect(note).not.toHaveBeenCalled();
  });
  it("records a network change and retries the welcome GET once", async () => {
    const page = {
      goto: vi
        .fn()
        .mockRejectedValueOnce(new Error("page.goto: net::ERR_NETWORK_CHANGED"))
        .mockResolvedValueOnce(null),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
    };
    const note = vi.fn();
    await openUnauthenticatedStressWelcome(page, origin, note);
    expect(page.goto.mock.calls).toEqual([
      [origin, { timeout: 10000 }],
      [origin, { timeout: 10000 }],
    ]);
    expect(page.waitForTimeout).toHaveBeenCalledWith(500);
    expect(JSON.parse(note.mock.calls[0][0])).toMatchObject({
      phase: "welcome-network-retry",
      retries: 1,
    });
  });
  it("refuses a repeated network change without a third navigation", async () => {
    const error = new Error("page.goto: net::ERR_NETWORK_CHANGED");
    const page = {
      goto: vi.fn().mockRejectedValue(error),
      waitForTimeout: vi.fn(),
    };
    await expect(
      openUnauthenticatedStressWelcome(page, origin, vi.fn()),
    ).rejects.toBe(error);
    expect(page.goto).toHaveBeenCalledTimes(2);
  });
  it.each([
    "net::ERR_CONNECTION_RESET",
    "net::ERR_CERT_AUTHORITY_INVALID",
    "Timeout 10000ms exceeded",
  ])("preserves %s without retry", async (message) => {
    const error = new Error(message);
    const page = {
      goto: vi.fn().mockRejectedValue(error),
      waitForTimeout: vi.fn(),
    };
    await expect(
      openUnauthenticatedStressWelcome(page, origin, vi.fn()),
    ).rejects.toBe(error);
    expect(page.goto).toHaveBeenCalledTimes(1);
    expect(page.waitForTimeout).not.toHaveBeenCalled();
  });
});

describe("public stress Start stages", () => {
  afterEach(() => vi.useRealTimers());
  it("allows preparation beyond30s while preserving separate60s request/response bounds", async () => {
    vi.useFakeTimers();
    let finish!: (value: any) => void;
    const response = new Promise((resolve) => {
      finish = resolve;
    });
    const request = { response: () => response };
    const page = {
      waitForRequest: vi
        .fn()
        .mockImplementation(
          () =>
            new Promise((resolve) => setTimeout(() => resolve(request), 31000)),
        ),
    };
    const note = vi.fn(),
      result = waitForStressStartResponse(page, note);
    await vi.advanceTimersByTimeAsync(31000);
    expect(page.waitForRequest.mock.calls[0][1]).toEqual({ timeout: 60000 });
    const matches = page.waitForRequest.mock.calls[0][0];
    expect(
      matches({
        url: () => "https://127.0.0.1:9444/api/student/preflight",
        method: () => "POST",
      }),
    ).toBe(false);
    expect(
      matches({
        url: () => "https://127.0.0.1:9444/api/student/attempts/test/begin",
        method: () => "GET",
      }),
    ).toBe(false);
    expect(
      matches({
        url: () => "https://127.0.0.1:9444/api/student/attempts/test/begin",
        method: () => "POST",
      }),
    ).toBe(true);
    await vi.advanceTimersByTimeAsync(50000);
    const reply = { status: () => 409 };
    finish(reply);
    expect(await result).toBe(reply); // Refusals are returned to the existing strict caller.
    expect(note.mock.calls.map(([value]) => JSON.parse(value).phase)).toEqual([
      "start-request",
      "start-response",
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("fails an unanswered Start after its own60s budget without retry", async () => {
    vi.useFakeTimers();
    const page = {
      waitForRequest: vi
        .fn()
        .mockResolvedValue({ response: () => new Promise(() => {}) }),
    };
    const result = waitForStressStartResponse(page, vi.fn());
    const failed = expect(result).rejects.toThrow("60-second operation budget");
    await vi.advanceTimersByTimeAsync(60000);
    await failed;
    expect(page.waitForRequest).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("preserves a preparation refusal", async () => {
    const error = new Error("No public Start request within60s");
    const page = { waitForRequest: vi.fn().mockRejectedValue(error) };
    await expect(waitForStressStartResponse(page, vi.fn())).rejects.toBe(error);
    expect(page.waitForRequest).toHaveBeenCalledTimes(1);
  });
  it("reports a failed request without inventing a response", async () => {
    const page = {
      waitForRequest: vi.fn().mockResolvedValue({ response: async () => null }),
    };
    await expect(waitForStressStartResponse(page, vi.fn())).rejects.toThrow(
      "without an HTTP response",
    );
  });
});
