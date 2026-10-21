import { z } from "zod";

export const managementPurpose = "ssh-exam-management/v1";
export const managementOperations = ["exams.list", "exams.show"] as const;
export const managementRequest = z
  .object({
    version: z.literal(1),
    purpose: z.literal(managementPurpose),
    audience: z.string(),
    agent: z.string(),
    actor: z.literal("agent-root"),
    request: z.string().uuid(),
    nonce: z.string().regex(/^[a-f0-9]{64}$/),
    issued: z.number().int(),
    expires: z.number().int(),
    operation: z.enum(managementOperations),
    body: z.unknown(),
  })
  .strict();
export const examListRequest = z
  .object({
    limit: z.number().int().min(1).max(200).default(100),
    after: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,64}$/)
      .optional(),
  })
  .strict();
export const examShowRequest = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  })
  .strict();
