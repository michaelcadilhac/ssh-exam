import { z } from "zod";
import { managementExam } from "./management.js";
import { dashboardViews } from "./admin.js";

export const attemptReference = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
export const attemptPage = z
  .object({
    exam: managementExam,
    after: attemptReference.optional(),
    limit: z.number().int().min(1).max(200).default(100),
    q: z.string().max(64).default(""),
    view: z.enum(dashboardViews).default(""),
  })
  .strict();
export const attemptShow = z.object({ id: attemptReference }).strict();
export const clockSingle = z
  .object({
    id: attemptReference,
    minutes: z.number().int().min(1).max(360),
    revision: z.number().int().nonnegative(),
    requestID: z.string().uuid(),
  })
  .strict();
export const clockBatchBody = z
  .object({
    action: z.enum(["reset", "extend"]),
    minutes: z.number().int().min(1).max(360).optional(),
    targets: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            revision: z.number().int().nonnegative(),
            requestID: z.string().uuid(),
            expectedSeconds: z.number().int().min(60).max(21600).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();
export const clockBatch = clockBatchBody.extend({ exam: managementExam });
export const clockShow = z.object({ id: z.string().uuid() }).strict();
export const clockPreview = z
  .object({
    exam: managementExam,
    targets: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            revision: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();

// Inspection only: delivery keeps the exact authoritative body. Never copy an
// unknown legacy field into a persistent read result merely because it exists.
export function clockIntentMetadata(body: any) {
  if (!body) return null;
  return Object.fromEntries(
    [
      "id",
      "reset_id",
      "actor",
      "requested_at",
      "remaining_seconds",
      "extend_seconds",
      "deadline",
      "clock_revision",
    ]
      .filter((k) => body[k] !== undefined)
      .map((k) => [k, body[k]]),
  );
}
