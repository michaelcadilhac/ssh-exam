import { expect, it, vi } from "vitest";
import { installRelaySocketDiagnostics } from "../../apps/web/src/relay-socket-diagnostics.js";

function fixture(notify = vi.fn()) {
  class Socket extends EventTarget {
    static OPEN = 1;
    static CONNECTING = 0;
    readyState = 1;
    closes: unknown[][] = [];
    constructor(
      readonly url: string,
      readonly protocols?: string | string[],
    ) {
      super();
    }
    close(code?: number, reason?: string) {
      if (code === 1001)
        throw new DOMException("Invalid close code", "InvalidAccessError");
      this.closes.push([code, reason]);
      this.readyState = 2;
    }
  }
  const Original = Socket as unknown as typeof WebSocket;
  const scope = { WebSocket: Original };
  const observer = installRelaySocketDiagnostics(scope, notify);
  return { scope, observer, notify, Original };
}
const closeEvent = (code: number, wasClean: boolean) =>
  Object.assign(new Event("close"), {
    code,
    wasClean,
    reason: "PRIVATE CLOSE REASON",
  });

it("preserves normal/going-away/abnormal close codes and cleanliness without logging close text or URLs", () => {
  for (const [code, wasClean] of [
    [1000, true],
    [1001, true],
    [1006, false],
  ] as const) {
    const f = fixture();
    f.observer.select("wss://relay.invalid/PRIVATE");
    const socket = new f.scope.WebSocket("wss://relay.invalid/PRIVATE");
    socket.dispatchEvent(closeEvent(code, wasClean));
    expect(f.notify).toHaveBeenCalledExactlyOnceWith({
      stage: "relay-socket-close",
      cause: "peer-close",
      close_code: code,
      was_clean: wasClean,
    });
    expect(JSON.stringify(f.notify.mock.calls)).not.toContain("PRIVATE");
    f.observer.dispose();
  }
});
it("records a deliberate socket close without changing its arguments or suppressing original API errors", () => {
  const f = fixture();
  f.observer.select("wss://relay.invalid/");
  const socket = new f.scope.WebSocket("wss://relay.invalid/");
  socket.close(1000, "SECRET");
  expect((socket as any).closes).toEqual([[1000, "SECRET"]]);
  expect(f.notify).toHaveBeenCalledExactlyOnceWith({
    stage: "relay-socket-close",
    cause: "client-close",
    close_code: 1000,
  });
  f.notify.mockClear();
  expect(() => socket.close(1001, "SECRET")).toThrow();
  expect(f.notify).not.toHaveBeenCalled();
  f.observer.dispose();
});
it("ignores other sockets and retired connect lifetimes, and restores only its own constructor", () => {
  const f = fixture(),
    Original = f.Original;
  f.observer.select("wss://relay.invalid/a");
  const old = new f.scope.WebSocket("wss://relay.invalid/a"),
    other = new f.scope.WebSocket("wss://other.invalid/");
  f.observer.select("wss://relay.invalid/b");
  old.dispatchEvent(closeEvent(1000, true));
  other.dispatchEvent(new Event("error"));
  expect(f.notify).not.toHaveBeenCalled();
  const active = new f.scope.WebSocket("wss://relay.invalid/b");
  active.dispatchEvent(new Event("error"));
  expect(f.notify).toHaveBeenCalledExactlyOnceWith({
    stage: "relay-socket-error",
    cause: "socket-error",
  });
  f.observer.dispose();
  active.dispatchEvent(closeEvent(1006, false));
  expect(f.notify).toHaveBeenCalledTimes(1);
  expect(f.scope.WebSocket).toBe(Original);
});
it("deduplicates, bounds forged events and tolerates a failed diagnostic sink", () => {
  const f = fixture();
  f.observer.select("wss://relay.invalid/");
  const socket = new f.scope.WebSocket("wss://relay.invalid/");
  for (let i = 0; i < 40; i++)
    socket.dispatchEvent(closeEvent(1000 + i, false));
  expect(f.notify).toHaveBeenCalledTimes(12);
  const failed = fixture(
    vi.fn(() => {
      throw Error("sink unavailable");
    }),
  );
  failed.observer.select("wss://relay.invalid/");
  const working = new failed.scope.WebSocket("wss://relay.invalid/");
  expect(() => working.close()).not.toThrow();
  expect(working.readyState).toBe(2);
  f.observer.dispose();
  failed.observer.dispose();
});
