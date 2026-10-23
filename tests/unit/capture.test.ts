import { afterEach, expect, it, vi } from "vitest";
import { api } from "../../apps/web/src/api.js";
import { Capture } from "../../apps/web/src/capture.js";

vi.mock("../../apps/web/src/api.js", () => ({ api: vi.fn() }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});
const ready = {
  fullscreen: true,
  visible: true,
  focus: true,
  keyboard: true,
  screen: true,
  webcam: false,
};
function fixture() {
  const draw = vi.fn(),
    create = vi.fn(() => ({
      getContext: () => ({ drawImage: draw }),
      toDataURL: () => "data:image/jpeg;base64,synthetic",
    }));
  vi.stubGlobal("document", { createElement: create });
  const incident = vi.fn(),
    mode = { preflight: true },
    capture = new Capture(
      "synthetic",
      "page",
      incident,
      () => ({ ...ready }),
      () => mode.preflight,
    );
  capture.videos.set("screen", {
    videoWidth: 40,
    videoHeight: 30,
  } as HTMLVideoElement);
  capture.queues.set("screen", []);
  return { capture, incident, mode, draw };
}
it("samples only after the challenge and never re-labels buffered legacy frames", async () => {
  const { capture, draw } = fixture();
  capture.queues.get("screen")!.push({ seq: 1, data: "old-buffer" });
  let release!: (value: any) => void;
  vi.mocked(api)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    )
    .mockResolvedValue({});
  const sample = capture.sample("screen");
  expect(draw).not.toHaveBeenCalled();
  expect(api).toHaveBeenCalledTimes(1);
  release({ challenge: "nonce", after_sequence: 12 });
  await sample;
  expect(draw).toHaveBeenCalledTimes(1);
  expect(api).toHaveBeenLastCalledWith(
    "/student/attempts/synthetic/frames/challenged",
    expect.objectContaining({
      challenge: "nonce",
      seq: 13,
      readiness: ready,
      data: "synthetic",
    }),
    "page",
    expect.any(AbortSignal),
  );
  expect(capture.queues.get("screen")).toEqual([
    { seq: 1, data: "old-buffer" },
  ]);
  capture.stop();
});
it("failed preflight uploads retry with a new challenge and no buffered permission", async () => {
  const { capture, incident } = fixture();
  vi.mocked(api)
    .mockResolvedValueOnce({ challenge: "expired", after_sequence: 0 })
    .mockRejectedValueOnce(Error("expired"))
    .mockResolvedValueOnce({ challenge: "fresh", after_sequence: 0 })
    .mockResolvedValue({});
  await expect(capture.sample("screen")).rejects.toThrow("expired");
  expect(capture.busy.size).toBe(0);
  expect(capture.queues.get("screen")).toEqual([]);
  await capture.sample("screen");
  expect(api).toHaveBeenLastCalledWith(
    expect.stringContaining("frames/challenged"),
    expect.objectContaining({ challenge: "fresh", seq: 2 }),
    "page",
    expect.any(AbortSignal),
  );
  expect(incident).not.toHaveBeenCalled();
  capture.stop();
});
it("stop fences a late challenge before canvas sampling or upload", async () => {
  const { capture, draw } = fixture();
  let release!: (value: any) => void;
  vi.mocked(api).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const sample = capture.sample("screen");
  capture.stop();
  release({ challenge: "late", after_sequence: 0 });
  await sample;
  expect(draw).not.toHaveBeenCalled();
  expect(api).toHaveBeenCalledTimes(1);
});
