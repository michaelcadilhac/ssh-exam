import { afterEach, expect, it, vi } from "vitest";
import { api } from "../../apps/web/src/api.js";
import { Capture } from "../../apps/web/src/capture.js";

vi.mock("../../apps/web/src/api.js", () => ({ api: vi.fn() }));
afterEach(() => {
  vi.useRealTimers();
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
function fixture(sampleAllowed = () => true) {
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
      undefined,
      sampleAllowed,
    );
  capture.videos.set("screen", {
    videoWidth: 40,
    videoHeight: 30,
  } as HTMLVideoElement);
  capture.queues.set("screen", []);
  return { capture, incident, mode, draw };
}

it("an unacknowledged local policy report withholds positive samples without destroying capture", async () => {
  let acknowledged = false;
  const { capture, draw } = fixture(() => acknowledged);
  vi.mocked(api).mockResolvedValue({
    challenge: "after-report",
    after_sequence: 0,
  });
  try {
    await capture.sample("screen");
    expect(api).not.toHaveBeenCalled();
    expect(draw).not.toHaveBeenCalled();
    expect(capture.stopped).toBe(false);
    expect(capture.videos.has("screen")).toBe(true);
    acknowledged = true;
    await capture.sample("screen");
    expect(api).toHaveBeenLastCalledWith(
      "/student/attempts/synthetic/frames/challenged",
      expect.objectContaining({ challenge: "after-report", seq: 1 }),
      "page",
      expect.any(AbortSignal),
    );
  } finally {
    capture.stop();
  }
});

it("a policy report arising during a challenge fences the late positive upload", async () => {
  let allowed = true,
    release!: (value: any) => void;
  const { capture, draw } = fixture(() => allowed);
  vi.mocked(api).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const sample = capture.sample("screen");
  expect(api).toHaveBeenCalledTimes(1);
  allowed = false;
  release({ challenge: "before-policy-loss", after_sequence: 0 });
  await sample;
  expect(api).toHaveBeenCalledTimes(1);
  expect(draw).not.toHaveBeenCalled();
  expect(capture.queues.get("screen")).toEqual([]);
  expect(capture.stopped).toBe(false);
  capture.stop();
});
it("an active challenged-capture transport timeout is technical; actual track loss remains a policy event", async () => {
  vi.useFakeTimers();
  const incident = vi.fn(),
    health = vi.fn(() => true),
    track = {
      readyState: "live",
      muted: false,
      getSettings: () => ({ displaySurface: "monitor" }),
      stop: vi.fn(),
      onended: undefined as undefined | (() => void),
    },
    stream = { getVideoTracks: () => [track], getTracks: () => [track] },
    video = {
      videoWidth: 40,
      videoHeight: 30,
      play: vi.fn().mockResolvedValue(undefined),
    };
  vi.stubGlobal("navigator", {
    mediaDevices: { getDisplayMedia: vi.fn().mockResolvedValue(stream) },
  });
  vi.stubGlobal("document", {
    createElement: (tag: string) =>
      tag === "video"
        ? video
        : {
            getContext: () => ({ drawImage: vi.fn() }),
            toDataURL: () => "data:image/jpeg;base64,synthetic",
          },
  });
  const capture = new Capture(
    "synthetic",
    "page",
    incident,
    () => ({ ...ready }),
    () => true,
    health,
  );
  vi.mocked(api).mockResolvedValue({ challenge: "initial", after_sequence: 0 });
  try {
    await capture.setup("screen");
    vi.mocked(api).mockRejectedValueOnce(
      Error("Synthetic capture challenge timeout"),
    );
    await vi.advanceTimersByTimeAsync(5000);
    expect(incident).not.toHaveBeenCalled();
    expect(health).toHaveBeenCalledWith("screen", false);
    vi.mocked(api).mockResolvedValue({ challenge: "fresh", after_sequence: 1 });
    await vi.advanceTimersByTimeAsync(5000);
    expect(health).toHaveBeenLastCalledWith("screen", true);
    track.onended!();
    expect(incident).toHaveBeenCalledExactlyOnceWith("screen track ended");
  } finally {
    capture.stop();
  }
});

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
