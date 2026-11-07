import { createHash } from "node:crypto";
import { z } from "zod";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const captureUploadReceipt = z
  .object({
    encoding: z.literal("vp9-upload-v1"),
    packet_sha256: digest,
    prediction_sha256: digest,
    metadata_sha256: digest,
    initial_jpeg_sha256: digest,
    representation_jpeg_sha256: digest,
  })
  .strict();
export type CaptureUploadReceipt = z.infer<typeof captureUploadReceipt>;
export const captureDigest = (data: Uint8Array) =>
  createHash("sha256").update(data).digest("hex");
const magic = Buffer.from("SSH-EXAM-UPLOAD-V1\0");

// Reserved APP15 metadata travels with the retained JPEG and ordinary CLI export.
// It is provenance only; readiness never consumes this receipt.
export function withCaptureReceipt(
  jpeg: Buffer,
  receipt: CaptureUploadReceipt,
) {
  if (jpeg[0] !== 255 || jpeg[1] !== 216)
    throw Error("Invalid capture representation");
  const value = captureUploadReceipt.parse({
    ...receipt,
    representation_jpeg_sha256: captureDigest(jpeg),
  });
  const payload = Buffer.concat([magic, Buffer.from(JSON.stringify(value))]);
  if (payload.length > 2048) throw Error("Capture receipt too large");
  const marker = Buffer.alloc(4);
  marker[0] = 255;
  marker[1] = 239;
  marker.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([
    jpeg.subarray(0, 2),
    marker,
    payload,
    jpeg.subarray(2),
  ]);
}
export function readCaptureReceipt(
  jpeg: Buffer,
): CaptureUploadReceipt | undefined {
  let offset = 2;
  while (offset + 4 <= jpeg.length && jpeg[offset] === 255) {
    const marker = jpeg[offset + 1];
    if (marker === 218 || marker === 217) break;
    const length = jpeg.readUInt16BE(offset + 2),
      end = offset + 2 + length;
    if (length < 2 || end > jpeg.length) break;
    const payload = jpeg.subarray(offset + 4, end);
    if (marker === 239 && payload.subarray(0, magic.length).equals(magic)) {
      if (payload.length > 2048) throw Error("Invalid capture receipt");
      const receipt = captureUploadReceipt.parse(
        JSON.parse(payload.subarray(magic.length).toString("utf8")),
      );
      const without = Buffer.concat([
        jpeg.subarray(0, offset),
        jpeg.subarray(end),
      ]);
      if (captureDigest(without) !== receipt.representation_jpeg_sha256)
        throw Error("Invalid capture receipt digest");
      return receipt;
    }
    offset = end;
  }
}
