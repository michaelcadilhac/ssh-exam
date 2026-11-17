import { afterEach, expect, it, vi } from "vitest";
import { api } from "../../apps/web/src/api.js";

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function stalledFetch() {
  vi.useFakeTimers();
  // Route the platform's active-time timer through the synthetic test clock.
  vi.spyOn(AbortSignal, "timeout").mockImplementation((milliseconds) => {
    const controller = new AbortController();
    setTimeout(
      () =>
        controller.abort(new DOMException("Request timed out", "TimeoutError")),
      milliseconds,
    );
    return controller.signal;
  });
  const fetch = vi.fn(
    (_url: string, options: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = options.signal!;
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      }),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

it("keeps an ordinary stalled request pending until sixty seconds, then aborts it", async () => {
  const fetch = stalledFetch();
  const request = api("/student/exam");
  const refusal = expect(request).rejects.toMatchObject({
    name: "TimeoutError",
  });
  await vi.advanceTimersByTimeAsync(59_999);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][1].signal!.aborted).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  await refusal;
  expect(fetch.mock.calls[0][1].signal!.aborted).toBe(true);
});

it("still cancels immediately when the owning view cancels its request", async () => {
  stalledFetch();
  const owner = new AbortController();
  const request = api("/student/exam", undefined, undefined, owner.signal);
  const refusal = expect(request).rejects.toMatchObject({ name: "AbortError" });
  owner.abort(new DOMException("View closed", "AbortError"));
  await refusal;
});

it("labels only a transport failure with actionable wording, without replaying the request", async () => {
  const fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
  vi.stubGlobal("fetch", fetch);
  await expect(api("/student/exam")).rejects.toMatchObject({
    transportUnavailable: true,
    message:
      "The server could not be reached. Check your connection and try again.",
  });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("keeps HTTP refusals distinct from local transport failures", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: "Page replaced" }), {
          status: 403,
        }),
      ),
  );
  const error = await api("/student/exam").catch((error) => error);
  expect(error.status).toBe(403);
  expect(error.transportUnavailable).toBeUndefined();
});
