import { afterEach, expect, it, vi } from "vitest";
import { observeSetupHealth } from "../../apps/server/src/setup-health.js";
import { OPERATION_TIMEOUT_MS } from "../../packages/protocol/timeouts.js";

const busy = () =>
  Error("native readiness verification already in progress; private detail");
afterEach(() => vi.useRealTimers());

it("retries only the exact busy observation once", async () => {
  vi.useFakeTimers();
  const command = vi
    .fn()
    .mockRejectedValueOnce(busy())
    .mockResolvedValueOnce({ ready: true });
  const observation = observeSetupHealth({ command });
  await vi.advanceTimersByTimeAsync(150);
  expect(await observation).toEqual({ ready: true });
  expect(command.mock.calls).toEqual([["health"], ["health"]]);
});

it("keeps persistent contention bounded to two observations", async () => {
  vi.useFakeTimers();
  const command = vi.fn().mockRejectedValue(busy());
  const refused = expect(observeSetupHealth({ command })).rejects.toThrow(
    "native readiness",
  );
  await vi.advanceTimersByTimeAsync(150);
  await refused;
  expect(command).toHaveBeenCalledTimes(2);
});

it.each([
  "unrelated failure",
  "prefix: native readiness verification already in progress;",
  "Command timed out",
])("does not replay an unrelated observation error: %s", async (message) => {
  const command = vi.fn().mockRejectedValue(Error(message));
  await expect(observeSetupHealth({ command })).rejects.toThrow(message);
  expect(command).toHaveBeenCalledTimes(1);
});

it("shares the original budget and ignores a late healthy reply", async () => {
  vi.useFakeTimers();
  let late!: (value: any) => void;
  const command = vi
    .fn()
    .mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 59000));
      throw busy();
    })
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          late = resolve;
        }),
    );
  const refused = expect(observeSetupHealth({ command })).rejects.toThrow(
    "time limit",
  );
  await vi.advanceTimersByTimeAsync(OPERATION_TIMEOUT_MS);
  await refused;
  expect(command).toHaveBeenCalledTimes(2);
  late({ ready: true });
  await vi.advanceTimersByTimeAsync(1000);
  expect(command).toHaveBeenCalledTimes(2);
});

it("does not issue a retry after the budget expires during the delay", async () => {
  vi.useFakeTimers();
  const command = vi.fn().mockImplementation(async () => {
    await new Promise((resolve) =>
      setTimeout(resolve, OPERATION_TIMEOUT_MS - 50),
    );
    throw busy();
  });
  const refused = expect(observeSetupHealth({ command })).rejects.toThrow(
    "time limit",
  );
  await vi.advanceTimersByTimeAsync(OPERATION_TIMEOUT_MS + 200);
  await refused;
  expect(command).toHaveBeenCalledTimes(1);
});
