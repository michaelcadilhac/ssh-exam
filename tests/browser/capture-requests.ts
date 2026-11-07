import type { Request } from "@playwright/test";
import { CAPTURE_UPLOAD_TYPE, decodeCaptureUpload } from "../../packages/protocol/capture-upload.js";

// Capture assertions and fault injection must follow both actual wire formats.
// In particular, silently watching only the old JSON route weakens refusal tests.
export const isChallengedCapture = (url: string) => /\/frames\/(challenged|binary)$/.test(new URL(url).pathname);
export function captureMetadata(request: Request): Record<string, any> {
  return request.headers()["content-type"] === CAPTURE_UPLOAD_TYPE
    ? decodeCaptureUpload(request.postDataBuffer()!).metadata
    : request.postDataJSON();
}
