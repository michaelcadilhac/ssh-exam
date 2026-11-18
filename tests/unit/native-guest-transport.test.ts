import { it, expect, vi } from "vitest";
import { PassThrough } from "node:stream";
import { createServer, type RequestListener } from "node:http";
import type { AddressInfo } from "node:net";
import {
  readNativeBridgeRequest,
  forwardNativeBridgeRequest,
} from "../fixtures/native-guest.js";

async function gateway(
  handler: RequestListener,
  run: (port: number) => Promise<void>,
) {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await run((server.address() as AddressInfo).port);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

const request = {
  path: "/api/agent/monitoring-evidence",
  headers: { "X-Exam-Signature": "original" },
  body: Buffer.from('{ "signed": "unchanged" }').toString("base64"),
};
it("handles a coalesced native request and late transport refusal without treating a pipe chunk as JSON", () => {
  const stream = new PassThrough(),
    accepted = vi.fn(),
    refused = vi.fn();
  readNativeBridgeRequest(stream, accepted, refused);
  expect(() =>
    stream.end(
      JSON.stringify(request) +
        "\n" +
        JSON.stringify({
          bridge_error: "TimeoutError",
          stage: "gateway.sock",
        }) +
        "\n",
    ),
  ).not.toThrow();
  expect(accepted).toHaveBeenCalledExactlyOnceWith(request);
  expect(refused).toHaveBeenCalledTimes(1);
});
it("preserves one split signed request across chunks and rejects a second request on its one-request link", () => {
  const stream = new PassThrough(),
    accepted = vi.fn(),
    refused = vi.fn();
  readNativeBridgeRequest(stream, accepted, refused);
  const wire = JSON.stringify(request) + "\n";
  stream.write(wire.slice(0, 13));
  stream.write(wire.slice(13, -1));
  expect(accepted).not.toHaveBeenCalled();
  stream.write(wire.slice(-1));
  expect(accepted).toHaveBeenCalledExactlyOnceWith(request);
  stream.end(wire);
  expect(accepted).toHaveBeenCalledTimes(1);
  expect(refused).toHaveBeenCalledTimes(1);
});
it("reuses a private link across idle and split requests only after each reply completes", async () => {
  const stream = new PassThrough(),
    refused = vi.fn();
  const gates: { promise: Promise<void>; resolve: () => void }[] = [];
  const accepted = vi.fn(() => {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    gates.push({ promise, resolve });
    return promise;
  });
  readNativeBridgeRequest(stream, accepted, refused, true);
  const wire = JSON.stringify(request) + "\n";
  stream.write('{"idle":true}\n' + wire.slice(0, 15));
  expect(accepted).not.toHaveBeenCalled();
  stream.write(wire.slice(15));
  expect(accepted).toHaveBeenCalledExactlyOnceWith(request);
  gates[0].resolve();
  await gates[0].promise;
  stream.write(wire);
  expect(accepted).toHaveBeenCalledTimes(2);
  expect(accepted.mock.calls[1]).toEqual([request]);
  gates[1].resolve();
  await gates[1].promise;
  stream.end('{"idle":true}\n');
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(refused).not.toHaveBeenCalled();
});
it("refuses a second persistent request before its outstanding reply and never rearms after refusal", async () => {
  const stream = new PassThrough(),
    refused = vi.fn();
  let resolve!: () => void;
  const reply = new Promise<void>((done) => {
    resolve = done;
  });
  const accepted = vi.fn(() => reply);
  readNativeBridgeRequest(stream, accepted, refused, true);
  const wire = JSON.stringify(request) + "\n";
  stream.write(wire + wire);
  expect(accepted).toHaveBeenCalledExactlyOnceWith(request);
  expect(refused).toHaveBeenCalledTimes(1);
  resolve();
  await reply;
  stream.end(wire);
  expect(accepted).toHaveBeenCalledTimes(1);
  expect(refused).toHaveBeenCalledTimes(1);
});
it.each([
  "{bad}\n",
  "x".repeat(1024 * 1024 + 1),
  JSON.stringify({ ...request, path: "/api/admin/attempts" }) + "\n",
])(
  "bounds/refuses malformed native transport input without forwarding it",
  (wire) => {
    const stream = new PassThrough(),
      accepted = vi.fn(),
      refused = vi.fn();
    readNativeBridgeRequest(stream, accepted, refused);
    stream.end(wire);
    expect(accepted).not.toHaveBeenCalled();
    expect(refused).toHaveBeenCalledTimes(1);
  },
);

it("forwards a delayed legitimate callback in the seventy-student transport without rewriting its signed bytes", async () => {
  const reply = Buffer.from(
    '{ "payload": "unchanged signed bytes", "signature": "original" }',
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await gateway(
      (req, res) => {
        expect(req.url).toBe(request.path);
        expect(req.headers["x-exam-signature"]).toBe("original");
        const chunks: Buffer[] = [];
        req.on("data", (chunk) => chunks.push(chunk));
        req.on("end", () => {
          expect(Buffer.concat(chunks)).toEqual(
            Buffer.from(request.body, "base64"),
          );
          timer = setTimeout(() => {
            res.writeHead(200);
            res.end(reply);
          }, 2700);
        });
      },
      async (port) => {
        const notes: Record<string, unknown>[] = [];
        const result = await forwardNativeBridgeRequest(
          request,
          port,
          new AbortController().signal,
          70,
          (receipt) => notes.push(receipt),
        );
        expect(result).toEqual({ status: 200, body: reply });
        expect(notes).toEqual([]);
      },
    );
  } finally {
    clearTimeout(timer);
  }
}, 10000);

it("retains the smaller native transport timeout and identifies its own generated503 without exposing request bytes", async () => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await gateway(
      (_req, res) => {
        timer = setTimeout(() => res.end("late"), 2700);
      },
      async (port) => {
        const notes: Record<string, unknown>[] = [];
        const result = await forwardNativeBridgeRequest(
          request,
          port,
          new AbortController().signal,
          16,
          (receipt) => notes.push(receipt),
        );
        expect(result?.status).toBe(503);
        expect(notes).toContainEqual(
          expect.objectContaining({
            source: "private-transport",
            reason: "fetch-timeout",
            timeout_ms: 2500,
          }),
        );
        expect(JSON.stringify(notes)).not.toContain("unchanged");
        expect(JSON.stringify(notes)).not.toContain("original");
      },
    );
  } finally {
    clearTimeout(timer);
  }
}, 10000);

it("distinguishes an origin503 from a private forwarding failure and preserves the exact refusal", async () => {
  const reply = Buffer.from('{"error":"PRIVATE_REPLY_MARKER"}');
  await gateway(
    (_req, res) => {
      res.writeHead(503);
      res.end(reply);
    },
    async (port) => {
      const notes: Record<string, unknown>[] = [];
      const result = await forwardNativeBridgeRequest(
        request,
        port,
        new AbortController().signal,
        70,
        (receipt) => notes.push(receipt),
      );
      expect(result).toEqual({ status: 503, body: reply });
      expect(notes).toContainEqual(
        expect.objectContaining({ source: "gateway-response", status: 503 }),
      );
      expect(JSON.stringify(notes)).not.toContain("PRIVATE_REPLY_MARKER");
    },
  );
});

it("does not replace an origin refusal when optional private diagnostics fail", async () => {
  const reply = Buffer.from("original refusal");
  await gateway(
    (_req, res) => {
      res.writeHead(422);
      res.end(reply);
    },
    async (port) => {
      const result = await forwardNativeBridgeRequest(
        request,
        port,
        new AbortController().signal,
        70,
        () => {
          throw Error("private diagnostic unavailable");
        },
      );
      expect(result).toEqual({ status: 422, body: reply });
    },
  );
});

it("bounds an unavailable seventy-student callback before the guest's existing five-second reply limit", async () => {
  await gateway(
    () => {},
    async (port) => {
      const notes: Record<string, unknown>[] = [],
        started = performance.now();
      const result = await forwardNativeBridgeRequest(
        request,
        port,
        new AbortController().signal,
        70,
        (receipt) => notes.push(receipt),
      );
      expect(result?.status).toBe(503);
      expect(notes).toContainEqual(
        expect.objectContaining({
          source: "private-transport",
          reason: "fetch-timeout",
          timeout_ms: 4000,
        }),
      );
      expect(performance.now() - started).toBeLessThan(4900);
    },
  );
}, 10000);

it("never returns a late callback reply after its exact private link is cancelled", async () => {
  let received!: () => void;
  const arrival = new Promise<void>((resolve) => {
    received = resolve;
  });
  await gateway(
    () => received(),
    async (port) => {
      const controller = new AbortController(),
        notes: Record<string, unknown>[] = [];
      const result = forwardNativeBridgeRequest(
        request,
        port,
        controller.signal,
        70,
        (receipt) => notes.push(receipt),
      );
      await arrival;
      controller.abort();
      expect(await result).toBeUndefined();
      expect(notes).toEqual([]);
    },
  );
});
