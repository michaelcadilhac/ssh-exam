import { z } from "zod";
import { attemptReference } from "./clock-management.js";

// Capture hashes always identify the received JPEG. These additional fields
// identify a verified, lossy video-derived representation, never fresh evidence.
export const monitoringFrameProvenance = z
  .object({
    encoding: z.literal("vp9-webm-v1"),
    capture_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    capture_width: z.number().int().min(1).max(2560),
    capture_height: z.number().int().min(1).max(2560),
    segment: z.string().uuid(),
    segment_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    index: z.number().int().min(0).max(11),
    // SHA256 over the decoded frame's packed RGB24 pixels, not JPEG bytes.
    decoded_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type MonitoringFrameProvenance = z.infer<
  typeof monitoringFrameProvenance
>;

export const monitoringOptimizationStatus = z.enum([
  "not-queued",
  "pending",
  "running",
  "retry",
  "paused",
  "complete",
  "deleted",
  "ineligible",
]);
export const monitoringOptimization = z
  .object({
    status: monitoringOptimizationStatus,
    eligible: z.boolean(),
    frames: z.number().int().nonnegative(),
    converted_frames: z.number().int().nonnegative(),
    remaining_frames: z.number().int().nonnegative(),
    segments: z.number().int().nonnegative(),
    // Sizes refer only to the converted subset, excluding terminal/submission
    // bytes and any originals still awaiting confirmed physical cleanup.
    source_bytes: z.number().int().nonnegative(),
    video_bytes: z.number().int().nonnegative(),
    verified_at: z.number().int().nonnegative().nullable(),
    error: z.string().max(80).nullable(),
  })
  .strict();
export type MonitoringOptimization = z.infer<typeof monitoringOptimization>;

export const monitoringOptimize = z
  .object({
    id: attemptReference,
    action: z.enum(["request", "retry", "cancel"]),
    requestID: z.string().uuid(),
  })
  .strict();
