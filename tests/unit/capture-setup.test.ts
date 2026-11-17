import { afterEach, expect, it, vi } from "vitest";
import { api } from "../../apps/web/src/api.js";
import { Capture } from "../../apps/web/src/capture.js";
vi.mock("../../apps/web/src/api.js", () => ({
  api: vi.fn(),
  apiBinary: vi.fn(),
}));
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

function fixture() {
  vi.useFakeTimers();
  const track = {
    readyState: "live",
    muted: false,
    stop: vi.fn(),
    getSettings: () => ({ displaySurface: "monitor" }),
  };
  const stream = { getVideoTracks: () => [track], getTracks: () => [track] };
  const request = vi.fn().mockResolvedValue(stream),
    play = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { mediaDevices: { getDisplayMedia: request } });
  vi.stubGlobal("document", {
    createElement: (tag: string) =>
      tag === "video"
        ? { videoWidth: 40, videoHeight: 30, play }
        : {
            getContext: () => ({ drawImage: vi.fn() }),
            toDataURL: () => "data:image/jpeg;base64,synthetic",
          },
  });
  const health = vi.fn(() => true),
    incident = vi.fn();
  const capture = new Capture(
    "synthetic",
    "page",
    incident,
    () => ({}),
    () => true,
    health,
  );
  vi.mocked(api).mockResolvedValue({ challenge: "fresh", after_sequence: 0 });
  return { capture, stream, track, request, play, health, incident };
}

it.each(["network", "unavailable"])(
  "keeps a selected stream during initial %s failure and freshly verifies the next sample",
  async (kind) => {
    const f = fixture();
    vi.mocked(api).mockRejectedValueOnce(
      Object.assign(
        Error("synthetic failure"),
        kind === "network" ? { transportUnavailable: true } : { status: 503 },
      ),
    );
    try {
      expect(await f.capture.setup("screen")).toBe(f.stream);
      expect(f.health).toHaveBeenLastCalledWith("screen", false);
      expect(f.track.stop).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(5000);
      expect(f.health).toHaveBeenLastCalledWith("screen", true);
      expect(f.request).toHaveBeenCalledTimes(1);
      expect(f.incident).not.toHaveBeenCalled();
      expect(
        vi
          .mocked(api)
          .mock.calls.filter(([url]) => url.endsWith("capture-challenges")),
      ).toHaveLength(2);
    } finally {
      f.capture.stop();
    }
  },
);

it("does not suppress a page/permission refusal", async () => {
  const f = fixture();
  vi.mocked(api).mockRejectedValueOnce(
    Object.assign(Error("Page replaced"), { status: 403 }),
  );
  try {
    await expect(f.capture.setup("screen")).rejects.toThrow("Page replaced");
    expect(f.health).not.toHaveBeenCalled();
  } finally {
    f.capture.stop();
  }
});

it.each(["permission", "play"])(
  "stops late media after cancellation during %s without sampling",
  async (stage) => {
    const f = fixture();
    let release!: (value: any) => void;
    const delayed = new Promise((resolve) => {
      release = resolve;
    });
    if (stage === "permission") f.request.mockReturnValue(delayed);
    else f.play.mockReturnValue(delayed);
    const setup = f.capture.setup("screen");
    const rejected = expect(setup).rejects.toMatchObject({
      name: "AbortError",
    });
    await Promise.resolve();
    f.capture.stop();
    release(stage === "permission" ? f.stream : undefined);
    await rejected;
    expect(f.track.stop).toHaveBeenCalledTimes(1);
    expect(api).not.toHaveBeenCalled();
    expect(f.capture.streams.size).toBe(0);
  },
);

it("shares one in-flight media prompt between repeated clicks", async () => {
  const f = fixture();
  let release!: (value: any) => void;
  f.request.mockReturnValue(
    new Promise((resolve) => {
      release = resolve;
    }),
  );
  const a = f.capture.setup("screen"),
    b = f.capture.setup("screen");
  release(f.stream);
  try {
    expect(await a).toBe(f.stream);
    expect(await b).toBe(f.stream);
    expect(f.request).toHaveBeenCalledTimes(1);
  } finally {
    f.capture.stop();
  }
});

it("releases newly granted media if its preview cannot start", async () => {
  const f = fixture();
  f.play.mockRejectedValueOnce(Error("Preview unavailable"));
  try {
    await expect(f.capture.setup("screen")).rejects.toThrow(
      "Preview unavailable",
    );
    expect(f.track.stop).toHaveBeenCalledTimes(1);
    expect(f.capture.streams.size).toBe(0);
    expect(api).not.toHaveBeenCalled();
  } finally {
    f.capture.stop();
  }
});
