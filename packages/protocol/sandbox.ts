import type { Exam } from "./index.js";
import { collectionSettings } from "./collection-limits.js";
export const SANDBOX_EXAM_ID = "sandbox";
export const SANDBOX_DURATION_SECONDS = 300;
export const isSandbox = (id: string) => id === SANDBOX_EXAM_ID;
export function hasSandboxWindow(settings: Pick<Exam, "earliest" | "latest">) {
  return (
    Number.isSafeInteger(settings.earliest) &&
    Number.isSafeInteger(settings.latest) &&
    settings.earliest > 0 &&
    settings.latest > settings.earliest &&
    settings.latest < 8640000000000000
  );
}
export function sandboxExam(
  template = "sample-exam",
  limits: Parameters<typeof collectionSettings>[0] &
    Partial<Pick<Exam, "earliest" | "latest" | "template_version">> = {},
): Exam {
  return {
    id: SANDBOX_EXAM_ID,
    name: "sandbox",
    duration: SANDBOX_DURATION_SECONDS,
    // Closed until an operator explicitly selects a finite window. Do not
    // manufacture a rolling window on startup or discard saved snapshots.
    earliest: limits.earliest ?? 0,
    latest: limits.latest ?? 1,
    webcam: false,
    terminals: 4,
    template,
    ...(limits.template_version
      ? { template_version: limits.template_version }
      : {}),
    ...collectionSettings(limits),
  };
}
