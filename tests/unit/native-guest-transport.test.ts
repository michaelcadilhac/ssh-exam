import { it, expect, vi } from "vitest";
import { PassThrough } from "node:stream";
import { readNativeBridgeRequest } from "../fixtures/native-guest.js";

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
