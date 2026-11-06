import { z } from "zod";
import { attemptReference } from "./clock-management.js";

// SQLite/JSON store safe integers, not Infinity. This explicit sentinel records
// approval validity only; actual Continue still requires an unfinished exam.
export const NO_RESUME_EXPIRY = Number.MAX_SAFE_INTEGER;

export const interruptionShow = z.object({ id: attemptReference }).strict();
export const interruptionReview = interruptionShow
  .extend({
    section: z.enum(["history", "requests"]).default("history"),
    limit: z.number().int().min(1).max(100).default(20),
    after: attemptReference.optional(),
    revision: z.number().int().nonnegative().optional(),
  })
  .refine(
    (b) => !b.after || b.revision !== undefined,
    "Paging private history requires the first page's reviewed revision; restart paging if it changed",
  );
export const interruptionAuthorize = interruptionShow.extend({
  generation: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
  requestID: z.string().uuid(),
  reason: z.string().trim().min(8).max(1000),
  validForMinutes: z.number().int().min(1).max(525600).nullable().optional(),
});
