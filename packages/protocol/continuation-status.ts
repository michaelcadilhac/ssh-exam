import { z } from "zod";
import { attemptReference } from "./clock-management.js";

// Presentation of existing approval only, never a capability/lease/thaw proof.
export const continuationStatus = z
  .object({
    v: z.literal(1),
    attempt: attemptReference,
    generation: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    state: z.enum([
      "waiting",
      "approved",
      "expired",
      "revoked",
      "superseded",
      "used",
      "resumed",
      "not-paused",
      "unavailable",
      "unknown",
    ]),
    expires: z
      .number()
      .int()
      .positive()
      .max(Number.MAX_SAFE_INTEGER)
      .nullable(),
    observedAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    execution: z.literal(false),
  })
  .strict()
  .refine(
    (s) =>
      s.state !== "approved" ||
      (s.expires !== null && s.expires > s.observedAt),
    "Approved presentation must have unexpired server-time metadata",
  );
export type ContinuationStatus = z.infer<typeof continuationStatus>;
