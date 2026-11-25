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
  vi.stubGlobal("navigator", {
    mediaDevices: { getDisplayMedia: request, getUserMedia: request },
  });
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

it.each(["screen", "webcam"] as const)(
  "disables picture-in-picture on the %s capture without stopping recording",
  async (source) => {
    const f = fixture();
    try {
      await f.capture.setup(source);
      expect(f.capture.videos.get(source)?.disablePictureInPicture).toBe(true);
      expect(f.capture.healthy(source)).toBe(true);
      expect(f.track.stop).not.toHaveBeenCalled();
      expect(f.health).toHaveBeenLastCalledWith(source, true);
    } finally {
      f.capture.stop();
    }
  },
);

it.each(["capture", "preflight"])(
  "closes an existing %s pop-out without stopping the camera or sending authority requests",
  async (kind) => {
    const f = fixture();
    try {
      await f.capture.setup("webcam");
      let popped: HTMLVideoElement | null =
        kind === "capture"
          ? f.capture.videos.get("webcam")!
          : ({ srcObject: f.stream } as unknown as HTMLVideoElement);
      Object.defineProperty(document, "pictureInPictureElement", {
        get: () => popped,
        configurable: true,
      });
      const exit = vi.fn(async () => {
        popped = null;
      });
      Object.assign(document, { exitPictureInPicture: exit });
      vi.mocked(api).mockClear();
      await f.capture.closeFloatingPreview();
      expect(exit).toHaveBeenCalledOnce();
      expect(popped).toBeNull();
      expect(f.capture.healthy("webcam")).toBe(true);
      expect(f.track.stop).not.toHaveBeenCalled();
      expect(api).not.toHaveBeenCalled();
    } finally {
      f.capture.stop();
    }
  },
);

it.each(["unavailable", "unrelated"])(
  "leaves %s picture-in-picture alone",
  async (kind) => {
    const f = fixture();
    const exit = vi.fn();
    Object.assign(document, {
      ...(kind === "unrelated"
        ? { pictureInPictureElement: { srcObject: {} } }
        : {}),
      exitPictureInPicture: exit,
    });
    try {
      await f.capture.closeFloatingPreview();
      expect(exit).not.toHaveBeenCalled();
      expect(api).not.toHaveBeenCalled();
    } finally {
      f.capture.stop();
    }
  },
);

it.each(["rejected", "still-open", "stalled"])(
  "refuses activation with guidance if closing a pop-out is %s",
  async (mode) => {
    const f = fixture();
    try {
      await f.capture.setup("screen");
      Object.assign(document, {
        pictureInPictureElement: f.capture.videos.get("screen"),
        exitPictureInPicture: vi.fn(() =>
          mode === "rejected"
            ? Promise.reject(Error("Browser refused"))
            : mode === "stalled"
              ? new Promise<void>(() => {})
              : Promise.resolve(),
        ),
      });
      vi.mocked(api).mockClear();
      const refused = expect(f.capture.closeFloatingPreview()).rejects.toThrow(
        "Close the floating video preview, click the exam page, then try again.",
      );
      if (mode === "stalled") await vi.advanceTimersByTimeAsync(2000);
      await refused;
      expect(f.capture.healthy("screen")).toBe(true);
      expect(f.track.stop).not.toHaveBeenCalled();
      expect(api).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(1); // Only the existing capture interval.
    } finally {
      f.capture.stop();
    }
  },
);
