import { expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { CaptureVideoIngress } from "../../apps/server/src/capture-video-ingress.js";
import type { CaptureUploadMetadata } from "../../packages/protocol/capture-upload.js";

function metadata(key = true): CaptureUploadMetadata {
  return {
    version: 1,
    encoding: "vp9",
    source: "screen",
    seq: 1,
    captured: Date.now(),
    monotonic: 1,
    challenge: randomUUID(),
    readiness: {
      fullscreen: true,
      visible: true,
      focus: true,
      keyboard: true,
      screen: true,
      webcam: false,
    },
    video: {
      chain: randomUUID(),
      previous: key ? null : "a".repeat(64),
      key,
      width: 128,
      height: 72,
    },
  };
}

it("identifies missing prediction without invoking the codec or changing the public refusal", async () => {
  const ingress = new CaptureVideoIngress();
  try {
    await expect(
      ingress.accept(
        "synthetic",
        metadata(false),
        Buffer.alloc(64),
        async () => {},
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "capture_video_reset",
      stage: "prediction-chain",
      message:
        "Take a fresh JPEG capture; video verification is temporarily unavailable",
    });
    expect(ingress.active).toBe(0);
  } finally {
    await ingress.close();
  }
});

it("distinguishes actual invalid-codec termination from an absent prediction", async () => {
  const ingress = new CaptureVideoIngress();
  try {
    await expect(
      ingress.accept(
        "synthetic",
        metadata(),
        Buffer.alloc(64, 17),
        async () => {},
      ),
    ).rejects.toMatchObject({ stage: "codec-exit" });
    expect(ingress.active).toBe(0);
  } finally {
    await ingress.close();
  }
});

it("preserves the five-second queue refusal and drains the original four slots", async () => {
  const ingress = new CaptureVideoIngress();
  const jpeg = await sharp({
    create: { width: 128, height: 72, channels: 3, background: "white" },
  })
    .jpeg()
    .toBuffer();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const decode = vi
    .spyOn(ingress as any, "decode")
    .mockImplementation(async () => {
      await gate;
      return jpeg;
    });
  vi.useFakeTimers();
  const running = Array.from({ length: 4 }, (_, n) =>
    ingress.accept(
      `synthetic-${n}`,
      metadata(),
      Buffer.alloc(64),
      async () => {},
    ),
  );
  try {
    const queued = ingress
      .accept("queued", metadata(), Buffer.alloc(64), async () => {})
      .then(
        () => null,
        (error) => error,
      );
    await vi.advanceTimersByTimeAsync(5001);
    expect(await queued).toMatchObject({
      stage: "queue-timeout",
      statusCode: 409,
    });
    expect(decode).toHaveBeenCalledTimes(4);
  } finally {
    release();
    await Promise.all(running);
    vi.useRealTimers();
    decode.mockRestore();
    await ingress.close();
  }
});
