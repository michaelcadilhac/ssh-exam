import { z } from "zod";

export const recoveryAllowanceEdit = z
  .object({
    revision: z.number().int().positive(),
    duration: z.number().int().min(60).max(21600).multipleOf(60),
    actor: z.string().min(1).max(128),
    at: z.number().int().positive(),
  })
  .strict();
export const recoveryPreflight = z
  .object({
    version: z.literal(1),
    exam: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
    username: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
    uid: z.number().int().min(0),
    duration: z.number().int().min(60).max(21600),
    source_attempt: z.string().uuid(),
    checksum: z.string().regex(/^[a-f0-9]{64}$/),
    grant_hash: z.string().regex(/^[a-f0-9]{64}$/),
    created_at: z.number().int().positive(),
    allowance_revision: recoveryAllowanceEdit.nullable(),
  })
  .strict();
export const recoveryAllowanceReply = z
  .object({
    version: z.literal(1),
    recovery: recoveryPreflight.nullable(),
  })
  .strict();
