import { z } from "zod";
import { examConfiguration, username } from "./index.js";

export const grantBinding = z
  .object({
    id: z.string().uuid(),
    revision: z.number().int().positive(),
    hash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export const grantList = z
  .object({
    exam: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
    username: username.optional(),
    after: z.string().uuid().optional(),
    limit: z.number().int().min(1).max(200).default(100),
  })
  .strict();
export const grantShow = z
  .object({
    id: z.string().uuid(),
    before: z.number().int().positive().optional(),
  })
  .strict();
export const grantRevision = z
  .object({
    revision: z.number().int().positive(),
    changes: examConfiguration.omit({ id: true }).partial().strict(),
    reason: z.string().trim().min(8).max(1000),
    request: z.string().uuid().optional(),
  })
  .strict();
export const grantRevocation = grantRevision.omit({ changes: true }).strict();
export const grantIssuePreview = z
  .object({
    exam: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
    definition_revision: z.string().regex(/^[a-f0-9]{64}$/),
    template_version: z.string().regex(/^[a-f0-9]{64}$/),
    earliest: z.number().int().safe(),
    latest: z.number().int().safe(),
    usernames: z
      .array(username)
      .min(1)
      .max(200)
      .refine(
        (a) => new Set(a).size === a.length,
        "Choose each student only once",
      ),
    reason: z.string().trim().min(8).max(1000),
    request: z.string().uuid().optional(),
  })
  .strict();
export const grantIssueIntent = z
  .object({
    revision: z.string().regex(/^[a-f0-9]{64}$/),
    request: z.string().uuid().optional(),
  })
  .strict();
export const grantBeginRequest = z
  .object({
    type: z.literal("grant-begin/v1"),
    agent: z.string(),
    nonce: z.string().regex(/^[a-f0-9]{64}$/),
    at: z.number().int(),
    attempt: z.string().uuid(),
    exam: z.string(),
    username,
    uid: z.number().int().min(1000),
    grant: grantBinding,
    intent: z.string().uuid(),
    transport: z.string().min(1).max(512),
    boot: z.string().uuid(),
    settings: examConfiguration.strict(),
  })
  .strict();
