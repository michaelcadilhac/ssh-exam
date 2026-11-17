import { afterEach, describe, expect, it, vi } from "vitest";
import type { Page } from "@playwright/test";
import { recoverRefusedStressPane } from "../fixtures/stress-navigation.js";
import { observeWasmBootstrap } from "../fixtures/wasm-bootstrap-diagnostics.js";

describe("recorded synthetic terminal retry", () => {
  function fixture(overrides: Record<string, unknown> = {}) {
    const order: string[] = [];
    const options = {
      visible: true,
      count: 3,
      responseOK: true,
      outcome: "refused",
      recordError: false,
      text: "This terminal could not open. Try again.",
      current: { id: "owned", state: "ACTIVE", generation: 0 },
      ...overrides,
    };
    const close = vi.fn(async () => {
      order.push("close");
    });
    const open = vi.fn(async () => {
      order.push("open");
    });
    const dialog = {
      isVisible: async () => options.visible,
      innerText: async () => options.text,
      getAttribute: async () => options.outcome,
      getByRole: () => ({ click: close }),
    };
    const page = {
      getByRole: (role: string) =>
        role === "alert" ? dialog : { click: open },
      request: {
        get: vi.fn(async () => {
          order.push("read");
          return {
            ok: () => options.responseOK,
            json: async () => ({ attempt: options.current }),
          };
        }),
      },
    } as unknown as Pick<Page, "getByRole" | "request">;
    return {
      order,
      options,
      close,
      open,
      run: () =>
        recoverRefusedStressPane({
          page,
          attempt: "owned",
          opened: () => options.count as number,
          expected: 4,
          record: async () => {
            order.push("record");
            if (options.recordError)
              throw Error("Captured failure; stop cohort");
          },
        }),
    };
  }
  it("records the refusal before fresh read and public Dismiss/New terminal", async () => {
    const f = fixture();
    await f.run();
    expect(f.order).toEqual(["record", "read", "close", "open"]);
  });
  it("stops immediately when the cohort preserves a refusal for diagnosis", async () => {
    const f = fixture({ recordError: true });
    await expect(f.run()).rejects.toThrow("stop cohort");
    expect(f.order).toEqual(["record"]);
    expect(f.close).not.toHaveBeenCalled();
    expect(f.open).not.toHaveBeenCalled();
  });
  it.each([
    { visible: false },
    { count: 4 },
    { responseOK: false },
    { outcome: "unconfirmed" },
    { outcome: undefined },
    { outcome: "page-ownership" },
    { current: null },
    { current: { id: "other", state: "ACTIVE", generation: 0 } },
    { current: { id: "owned", state: "LOCKED", generation: 1 } },
    { current: { id: "owned", state: "ACTIVE", generation: 1 } },
  ])("never retries uncertain or changed state: %j", async (overrides) => {
    const f = fixture(overrides);
    await expect(f.run()).rejects.toThrow("no retry");
    expect(f.close).not.toHaveBeenCalled();
    expect(f.open).not.toHaveBeenCalled();
  });
});

describe("private native pane diagnostic observer", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("retains bounded pane-only errors without authentication, tokens or results", async () => {
    class Worker extends EventTarget {}
    vi.stubGlobal("window", { Worker });
    const page = {
      on: vi.fn(),
      addInitScript: async (fn: () => void) => fn(),
      evaluate: async (fn: () => unknown) => fn(),
    } as unknown as Page;
    const read = await observeWasmBootstrap(page);
    const worker = new window.Worker("synthetic");
    const emit = (data: unknown) =>
      worker.dispatchEvent(new MessageEvent("message", { data }));
    emit({
      type: "rpc-result",
      diagnostic: { stage: "connect" },
      error: "SECRET MFA",
    });
    emit({
      type: "rpc-result",
      diagnostic: { stage: "open" },
      result: { token: "SECRET TOKEN" },
    });
    for (let i = 0; i < 12; i++)
      emit({
        type: "rpc-result",
        diagnostic: { stage: "open" },
        error: "session admission rejected" + "x".repeat(400),
        token: "SECRET TOKEN",
      });
    const result = await read();
    expect(result.paneRefusals).toHaveLength(8);
    expect(result.paneRefusals[0].error).toHaveLength(256);
    expect(JSON.stringify(result)).not.toContain("SECRET");
  });
});
