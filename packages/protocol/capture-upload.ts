import { z } from "zod";

export const CAPTURE_UPLOAD_TYPE = "application/vnd.ssh-exam-capture";
export const CAPTURE_IMAGE_LIMIT = 1_500_000;
export const CAPTURE_METADATA_LIMIT = 4096;
export const captureUploadMetadata = z
  .object({
    version: z.literal(1),
    encoding: z.enum(["jpeg", "vp9"]),
    source: z.enum(["screen", "webcam"]),
    seq: z.number().int().positive().safe(),
    captured: z.number().int().nonnegative().safe(),
    monotonic: z.number().finite().nonnegative(),
    challenge: z.string().uuid(),
    readiness: z
      .object({
        fullscreen: z.boolean(),
        visible: z.boolean(),
        focus: z.boolean(),
        keyboard: z.boolean(),
        screen: z.boolean(),
        webcam: z.boolean(),
      })
      .strict(),
    video: z
      .object({
        chain: z.string().uuid(),
        previous: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .nullable(),
        key: z.boolean(),
        width: z.number().int().min(1).max(1280),
        height: z.number().int().min(1).max(1280),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.encoding === "vp9") !== !!value.video ||
      (value.video &&
        (value.video.key !== (value.video.previous === null) ||
          (value.source === "webcam" &&
            Math.max(value.video.width, value.video.height) > 320)))
    )
      context.addIssue({
        code: "custom",
        message: "Invalid capture encoding metadata",
      });
  });
export type CaptureUploadMetadata = z.infer<typeof captureUploadMetadata>;

// One bounded metadata document followed by the exact encoded image bytes.
// Authentication/CSRF/page identity stay in the ordinary request headers.
export function encodeCaptureUpload(
  metadata: CaptureUploadMetadata,
  image: Uint8Array,
) {
  const json = new TextEncoder().encode(JSON.stringify(metadata));
  if (
    json.length > CAPTURE_METADATA_LIMIT ||
    image.length > CAPTURE_IMAGE_LIMIT ||
    image.length < (metadata.encoding === "jpeg" ? 32 : 1)
  )
    throw Error("Capture upload size invalid");
  const body = new Uint8Array(4 + json.length + image.length);
  new DataView(body.buffer).setUint32(0, json.length);
  body.set(json, 4);
  body.set(image, 4 + json.length);
  return body;
}
export function decodeCaptureUpload(body: Uint8Array) {
  if (
    body.length < 4 ||
    body.length > 4 + CAPTURE_METADATA_LIMIT + CAPTURE_IMAGE_LIMIT
  )
    throw Error("Capture upload size invalid");
  const length = new DataView(
    body.buffer,
    body.byteOffset,
    body.byteLength,
  ).getUint32(0);
  if (
    length < 2 ||
    length > CAPTURE_METADATA_LIMIT ||
    body.length - length - 4 < 1 ||
    body.length - length - 4 > CAPTURE_IMAGE_LIMIT
  )
    throw Error("Capture upload size invalid");
  const metadata = captureUploadMetadata.parse(
    JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        body.subarray(4, 4 + length),
      ),
    ),
  );
  if (metadata.encoding === "jpeg" && body.length - length - 4 < 32)
    throw Error("Capture image size invalid");
  return { metadata, image: body.subarray(4 + length) };
}
