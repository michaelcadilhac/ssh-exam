import type { Exam } from "./index.js";
import { collectionSettings } from "./collection-limits.js";
export const SANDBOX_EXAM_ID = "sandbox";
export const SANDBOX_DURATION_SECONDS = 300;
export const isSandbox = (id: string) => id === SANDBOX_EXAM_ID;
export function sandboxExam(
  template = "sample-exam",
  limits: Parameters<typeof collectionSettings>[0] = {},
): Exam {
  return {
    id: SANDBOX_EXAM_ID,
    name: "sandbox",
    duration: SANDBOX_DURATION_SECONDS,
    earliest: 0,
    latest: 8640000000000000,
    webcam: false,
    terminals: 4,
    template,
    ...collectionSettings(limits),
  };
}
