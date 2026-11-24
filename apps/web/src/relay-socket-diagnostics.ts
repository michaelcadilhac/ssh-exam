import type { SSHDiagnostic } from "../../../packages/protocol/ssh-diagnostics.js";

// Runtime caller: the SSH worker, before Go creates its browser WebSocket.
// Preserve the CloseEvent before NetConn maps normal/going-away into plain EOF.
// No payload, URL, close reason, ticket, credential or new network request is sent.
export function installRelaySocketDiagnostics(
  scope: { WebSocket: typeof WebSocket },
  notify: (value: SSHDiagnostic) => void,
) {
  const Original = scope.WebSocket;
  if (typeof Original !== "function")
    return { select(_url: unknown) {}, dispose() {} };
  type Lifetime = { url: string; reports: number; seen: Set<string> };
  let current: Lifetime | undefined;
  const owners = new WeakMap<WebSocket, Lifetime>();
  const report = (socket: WebSocket, value: SSHDiagnostic) => {
    const owner = owners.get(socket);
    if (!owner || owner !== current || owner.reports >= 12) return;
    const key = `${value.stage}:${value.cause}:${value.close_code ?? ""}`;
    if (owner.seen.has(key)) return;
    owner.seen.add(key);
    owner.reports++;
    try {
      notify(value);
    } catch {
      /* Observation cannot break the socket. */
    }
  };
  class Observed extends Original {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      if (!current || typeof url !== "string" || url !== current.url) return;
      owners.set(this, current);
      this.addEventListener("close", (event) =>
        report(this, {
          stage: "relay-socket-close",
          cause: "peer-close",
          ...(Number.isInteger(event.code) &&
          event.code >= 1000 &&
          event.code <= 4999
            ? { close_code: event.code }
            : {}),
          was_clean: event.wasClean,
        }),
      );
      this.addEventListener("error", () =>
        report(this, { stage: "relay-socket-error", cause: "socket-error" }),
      );
    }
    close(code?: number, reason?: string) {
      const requested =
        this.readyState === Original.OPEN ||
        this.readyState === Original.CONNECTING;
      super.close(code, reason);
      if (requested)
        report(this, {
          stage: "relay-socket-close",
          cause: "client-close",
          ...(code !== undefined &&
          Number.isInteger(code) &&
          code >= 1000 &&
          code <= 4999
            ? { close_code: code }
            : {}),
        });
    }
  }
  try {
    scope.WebSocket = Observed;
  } catch {
    /* Optional metadata only. */
  }
  return {
    select(url: unknown) {
      current =
        typeof url === "string"
          ? { url, reports: 0, seen: new Set() }
          : undefined;
    },
    dispose() {
      current = undefined;
      if (scope.WebSocket === Observed) scope.WebSocket = Original;
    },
  };
}
