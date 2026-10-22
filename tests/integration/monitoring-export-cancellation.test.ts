import { expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import { randomBytes, randomUUID, sign } from "node:crypto";
import { exportFixture } from "../fixtures/monitoring-export.js";
import {
  liveMonitoring,
  monitoringReady,
} from "../fixtures/live-monitoring.js";
import { monitoringExportContentType } from "../../packages/protocol/monitoring-export.js";
import { managementPurpose } from "../../packages/protocol/management.js";

const fault = vi.hoisted(() => ({
  hold: false,
  entered: 0,
  wait: Promise.resolve(),
  closeFailure: false,
}));
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: async (path: any, flags: any, mode?: any) => {
      const file = await actual.open(path, flags, mode);
      if (
        !String(path).endsWith(".jpg") ||
        (!fault.hold && !fault.closeFailure)
      )
        return file;
      return new Proxy(file, {
        get(target, property) {
          if (property === "read")
            return async (...args: any[]) => {
              fault.entered++;
              await fault.wait;
              return (target.read as any)(...args);
            };
          if (property === "close" && fault.closeFailure)
            return async () => {
              await target.close();
              throw Error("PRIVATE-UNCONFIRMED-CLOSE");
            };
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
  };
});

it("holds the export owner until actual cleanup after a real socket abort, while metadata/capture/health stay responsive", async () => {
  const f = await exportFixture();
  let release = () => {};
  const abort = new AbortController();
  try {
    await f.app.listen({ host: "127.0.0.1", port: 0 });
    const origin =
      "http://127.0.0.1:" + (f.app.server.address() as AddressInfo).port;
    fault.hold = true;
    fault.entered = 0;
    fault.wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const request = f.request(),
      signed = f.signed(request);
    const response = await fetch(origin + "/api/agent/management", {
      method: "POST",
      headers: signed.headers,
      body: signed.payload,
      signal: abort.signal,
    });
    expect(response.headers.get("content-type")).toContain(
      monitoringExportContentType,
    );
    const reader = response.body!.getReader();
    expect((await reader.read()).done).toBe(false);
    await vi.waitFor(() => expect(fault.entered).toBe(1), { timeout: 3000 });
    expect(f.store.db.inTransaction).toBe(false);
    abort.abort();
    await reader.cancel().catch(() => {});
    const busy = f.unpack((await f.post(f.request())).body);
    expect(busy).toMatchObject({ ok: false, status: 503 });
    expect(busy.error).toContain("busy");
    expect((await f.app.inject({ url: "/health/live" })).statusCode).toBe(200);
    const captured = await f.monitoring.frame(
      f.store.attempt("a"),
      {
        source: "screen",
        seq: 2,
        captured: Date.now(),
        monotonic: 2,
        data: f.data.toString("base64"),
      },
      "still-capturing",
    );
    expect(captured.id).toBeTruthy();
    expect(
      (
        await f.app.inject({
          url: "/api/admin/attempts/a/monitoring",
          headers: f.headers,
        })
      ).statusCode,
    ).toBe(200);
    release();
    fault.hold = false;
    await vi.waitFor(
      async () => {
        const request = f.request(),
          response = await f.post(request);
        expect(response.headers["content-type"]).toContain(
          monitoringExportContentType,
        );
        expect(f.packets(response, request).at(-1).event.kind).toBe("end");
      },
      { timeout: 5000 },
    );
    expect(f.store.attempt("a")).toEqual(f.before);
  } finally {
    release();
    fault.hold = false;
    fault.closeFailure = false;
    abort.abort();
    await f.close();
  }
});

it("reports unconfirmed descriptor cleanup without success and keeps that export slot poisoned instead of recycling resources", async () => {
  const f = await exportFixture();
  try {
    fault.closeFailure = true;
    fault.wait = Promise.resolve();
    const request = f.request(),
      response = await f.post(request),
      events = f.packets(response, request).map((p) => p.event);
    expect(events.at(-1)).toMatchObject({
      kind: "error",
      code: "media-cleanup",
    });
    expect(
      events.some(
        (event) => event.kind === "end" || event.kind === "file-data",
      ),
    ).toBe(false);
    expect(JSON.stringify(events)).not.toContain("PRIVATE-UNCONFIRMED-CLOSE");
    fault.closeFailure = false;
    const retry = f.unpack((await f.post(f.request())).body);
    expect(retry).toMatchObject({ ok: false, status: 503 });
    expect(retry.error).toContain("previous-cleanup-unconfirmed");
    expect((await f.app.inject({ url: "/health/live" })).statusCode).toBe(200);
    expect(
      (await f.app.inject({ url: f.url, headers: f.headers })).statusCode,
    ).toBe(200);
    expect(f.store.attempt("a")).toEqual(f.before);
  } finally {
    fault.hold = false;
    fault.closeFailure = false;
    await f.close();
  }
});

it("keeps an authenticated real SSH pane, signed renewal, HTTP captures and new pane admission healthy during held export IO", async () => {
  const f = await liveMonitoring(),
    abort = new AbortController();
  let release = () => {};
  try {
    (f.h.agentConfig as any).managementOperations = ["monitoring.export"];
    const pane = await f.connection.open(f.id, randomUUID()),
      transport = f.connection.transport,
      before = f.store.attempt(f.id);
    let text = "",
      renewals = 0;
    pane.on("data", (data: Buffer) => {
      text += data.toString();
    });
    pane.resume();
    f.h.control.command = async (operation, body) => {
      if (operation === "renew-execution-lease") {
        renewals++;
        return {
          id: f.id,
          state: "ACTIVE",
          generation: 0,
          deadline: before.deadline,
        };
      }
      return f.h.agent.call(operation, body);
    };
    fault.hold = true;
    fault.entered = 0;
    fault.wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const origin = f.headers.origin,
      payload = Buffer.from(
        JSON.stringify({
          version: 1,
          purpose: managementPurpose,
          audience: origin,
          agent: "class",
          actor: "agent-root",
          request: randomUUID(),
          nonce: randomBytes(32).toString("hex"),
          issued: Date.now(),
          expires: Date.now() + 20000,
          operation: "monitoring.export",
          body: { id: f.id },
        }),
      ),
      response = await fetch(origin + "/api/agent/management", {
        method: "POST",
        signal: abort.signal,
        body: payload,
        headers: {
          "content-type": "application/vnd.ssh-exam-management",
          "x-exam-signature": sign(null, payload, f.h.callbackKey).toString(
            "base64",
          ),
        },
      });
    expect(response.headers.get("content-type")).toContain(
      monitoringExportContentType,
    );
    const reader = response.body!.getReader();
    expect((await reader.read()).done).toBe(false);
    await vi.waitFor(() => expect(fault.entered).toBe(1));
    const confirmation = randomUUID();
    f.send({ type: "heartbeat", confirmation, ready: monitoringReady });
    await vi.waitFor(() => expect(renewals).toBeGreaterThan(0));
    await vi.waitFor(() =>
      expect(
        f.messages.some(
          (message) =>
            message.type === "state" && message.confirmation === confirmation,
        ),
      ).toBe(true),
    );
    expect((await f.capture()).map((r) => r.statusCode)).toEqual([200, 200]);
    expect((await f.app.inject({ url: "/health/live" })).statusCode).toBe(200);
    pane.write("export-independent-ssh\n");
    await vi.waitFor(() =>
      expect(text).toContain("Echo: export-independent-ssh"),
    );
    const additional = await f.connection.open(f.id, randomUUID());
    additional.resume();
    expect(f.connection.alive).toBe(true);
    expect(f.connection.transport).toBe(transport);
    expect(f.store.attempt(f.id)).toMatchObject({
      state: before.state,
      generation: before.generation,
      deadline: before.deadline,
      original_deadline: before.original_deadline,
      protected: before.protected,
    });
    expect(f.store.db.prepare("SELECT * FROM incidents").all()).toEqual([]);
    abort.abort();
    await reader.cancel().catch(() => {});
    release();
    fault.hold = false;
  } finally {
    abort.abort();
    release();
    fault.hold = false;
    fault.closeFailure = false;
    await f.close();
  }
}, 20000);
