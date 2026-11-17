import { afterEach, describe, expect, it, vi } from "vitest";
import { openUnauthenticatedStressWelcome, waitForStressStartResponse } from "../fixtures/stress-navigation.js";

describe("unauthenticated stress welcome navigation", () => {
  const origin = "https://127.0.0.1:9444";
  it("leaves a successful navigation unchanged", async () => {
    const page = { goto: vi.fn().mockResolvedValue(null), waitForTimeout: vi.fn() };
    const note = vi.fn();
    await openUnauthenticatedStressWelcome(page, origin, note);
    expect(page.goto).toHaveBeenCalledTimes(1);
    expect(page.waitForTimeout).not.toHaveBeenCalled();
    expect(note).not.toHaveBeenCalled();
  });
  it("records a network change and retries the welcome GET once", async () => {
    const page = { goto: vi.fn().mockRejectedValueOnce(new Error("page.goto: net::ERR_NETWORK_CHANGED"))
      .mockResolvedValueOnce(null), waitForTimeout: vi.fn().mockResolvedValue(undefined) };
    const note = vi.fn();
    await openUnauthenticatedStressWelcome(page, origin, note);
    expect(page.goto.mock.calls).toEqual([[origin, { timeout: 10000 }], [origin, { timeout: 10000 }]]);
    expect(page.waitForTimeout).toHaveBeenCalledWith(500);
    expect(JSON.parse(note.mock.calls[0][0])).toMatchObject({ phase: "welcome-network-retry", retries: 1 });
  });
  it("refuses a repeated network change without a third navigation", async () => {
    const error = new Error("page.goto: net::ERR_NETWORK_CHANGED");
    const page = { goto: vi.fn().mockRejectedValue(error), waitForTimeout: vi.fn() };
    await expect(openUnauthenticatedStressWelcome(page, origin, vi.fn())).rejects.toBe(error);
    expect(page.goto).toHaveBeenCalledTimes(2);
  });
  it.each(["net::ERR_CONNECTION_RESET", "net::ERR_CERT_AUTHORITY_INVALID", "Timeout 10000ms exceeded"])(
    "preserves %s without retry", async message => {
      const error = new Error(message);
      const page = { goto: vi.fn().mockRejectedValue(error), waitForTimeout: vi.fn() };
      await expect(openUnauthenticatedStressWelcome(page, origin, vi.fn())).rejects.toBe(error);
      expect(page.goto).toHaveBeenCalledTimes(1);
      expect(page.waitForTimeout).not.toHaveBeenCalled();
    });
});

describe("public stress Start stages", () => {
  afterEach(() => vi.useRealTimers());
  it("allows preparation beyond30s while preserving separate60s request/response bounds", async () => {
    vi.useFakeTimers();
    let finish!: (value: any) => void;
    const response = new Promise(resolve => { finish = resolve; });
    const request = { response: () => response };
    const page = { waitForRequest: vi.fn().mockImplementation(() => new Promise(resolve => setTimeout(() => resolve(request), 31000))) };
    const note = vi.fn(), result = waitForStressStartResponse(page, note);
    await vi.advanceTimersByTimeAsync(31000);
    expect(page.waitForRequest.mock.calls[0][1]).toEqual({ timeout: 60000 });
    const matches = page.waitForRequest.mock.calls[0][0];
    expect(matches({ url: () => "https://127.0.0.1:9444/api/student/preflight", method: () => "POST" })).toBe(false);
    expect(matches({ url: () => "https://127.0.0.1:9444/api/student/attempts/test/begin", method: () => "GET" })).toBe(false);
    expect(matches({ url: () => "https://127.0.0.1:9444/api/student/attempts/test/begin", method: () => "POST" })).toBe(true);
    await vi.advanceTimersByTimeAsync(50000);
    const reply = { status: () => 409 };
    finish(reply);
    expect(await result).toBe(reply); // Refusals are returned to the existing strict caller.
    expect(note.mock.calls.map(([value]) => JSON.parse(value).phase)).toEqual(["start-request", "start-response"]);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("fails an unanswered Start after its own60s budget without retry", async () => {
    vi.useFakeTimers();
    const page = { waitForRequest: vi.fn().mockResolvedValue({ response: () => new Promise(() => {}) }) };
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
    const page = { waitForRequest: vi.fn().mockResolvedValue({ response: async () => null }) };
    await expect(waitForStressStartResponse(page, vi.fn())).rejects.toThrow("without an HTTP response");
  });
});
