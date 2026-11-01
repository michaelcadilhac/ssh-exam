import { z } from "zod";

export const videoHash = z.string().regex(/^[a-f0-9]{64}$/);
export const videoUUID = z.string().uuid();
export const videoAttempt = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
export const videoSource = z.enum(["screen", "webcam"]);
export const videoInputFrame = z
  .object({
    id: videoUUID,
    hash: videoHash,
    captured: z.number().int().safe().nonnegative(),
    width: z.number().int().min(1).max(2560),
    height: z.number().int().min(1).max(2560),
  })
  .strict();
export const videoRunInput = z
  .object({
    attempt: videoAttempt,
    segment: videoUUID,
    source: videoSource,
    work: z.string().min(1).max(4096),
    frames: z.array(videoInputFrame).min(1).max(12),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      new Set(value.frames.map((frame) => frame.id)).size !==
      value.frames.length
    )
      context.addIssue({ code: "custom", message: "Duplicate capture" });
    if (
      value.frames.some(
        (frame) =>
          frame.width !== value.frames[0].width ||
          frame.height !== value.frames[0].height,
      )
    )
      context.addIssue({
        code: "custom",
        message: "Partition segments at a dimension change",
      });
  });
export const videoOutputFrame = z
  .object({
    id: videoUUID,
    original_hash: videoHash,
    captured: z.number().int().safe().nonnegative(),
    index: z.number().int().min(0).max(11),
    presentation_ms: z.number().int().min(0).max(55000),
    decoded_sha256: videoHash,
  })
  .strict();
export const videoResult = z
  .object({
    version: z.literal(1),
    attempt: videoAttempt,
    segment: videoUUID,
    source: videoSource,
    file: z.string().regex(/^[a-f0-9-]{36}\.webm$/),
    sha256: videoHash,
    bytes: z
      .number()
      .int()
      .min(1)
      .max(32 * 1024 * 1024),
    width: z.number().int().min(2).max(1280),
    height: z.number().int().min(2).max(1280),
    duration_ms: z.number().int().min(5000).max(60000),
    frames: z.array(videoOutputFrame).min(1).max(12),
  })
  .strict();
export const videoFrameInput = z
  .object({
    attempt: videoAttempt,
    segment: videoUUID,
    sha256: videoHash,
    index: z.number().int().min(0).max(11),
    decoded_sha256: videoHash,
    width: z.number().int().min(2).max(1280),
    height: z.number().int().min(2).max(1280),
    thumbnail: z.boolean().default(false),
  })
  .strict();
export const videoFramesInput = z
  .object({
    attempt: videoAttempt,
    segment: videoUUID,
    sha256: videoHash,
    width: z.number().int().min(2).max(1280),
    height: z.number().int().min(2).max(1280),
    frames: z
      .array(
        z
          .object({
            index: z.number().int().min(0).max(11),
            decoded_sha256: videoHash,
          })
          .strict(),
      )
      .min(1)
      .max(12),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      new Set(value.frames.map((frame) => frame.index)).size !==
      value.frames.length
    )
      context.addIssue({ code: "custom", message: "Duplicate decoded frame" });
  });
export type VideoFramesInput = z.input<typeof videoFramesInput>;
export type VideoRenderedFrame = {
  index: number;
  original: Buffer;
  thumbnail: Buffer;
};
export type VideoRunInput = z.input<typeof videoRunInput>;
export type VideoResult = z.output<typeof videoResult>;
export type VideoFrameInput = z.input<typeof videoFrameInput>;
export const videoWorkerRequest = z.discriminatedUnion("operation", [
  z
    .object({
      version: z.literal(1),
      nonce: videoHash,
      root: z.string().min(1).max(4096),
      operation: z.literal("sync"),
      input: z.object({}).strict(),
    })
    .strict(),
  z
    .object({
      version: z.literal(1),
      nonce: videoHash,
      root: z.string().min(1).max(4096),
      operation: z.literal("encode"),
      input: videoRunInput,
    })
    .strict(),
  z
    .object({
      version: z.literal(1),
      nonce: videoHash,
      root: z.string().min(1).max(4096),
      operation: z.literal("frames"),
      input: videoFramesInput,
    })
    .strict(),
]);
