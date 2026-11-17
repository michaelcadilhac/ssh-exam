import { describe, expect, it, vi } from "vitest";
import { openUnauthenticatedStressWelcome } from "../fixtures/stress-navigation.js";

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
