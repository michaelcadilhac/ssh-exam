import { z } from "zod";
import {
  MAX_COLLECTION_FILE_MIB,
  MAX_COLLECTION_TOTAL_MIB,
} from "./collection-limits.js";

export const examExecutionPolicyCapability = "live-exam-execution-policy-v1";
const identifier = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const positive = z.number().int().safe().positive();

// Separate live execution bounds, never a replacement for frozen grant settings.
export const examExecutionPolicy = z
  .object({
    schema: z.literal(1),
    agent: identifier,
    exam: identifier,
    instance: z.string().regex(/^[a-f0-9]{32}$/),
    revision: positive,
    terminals: z.number().int().min(1).max(4),
    collection_file_mib: positive.max(MAX_COLLECTION_FILE_MIB),
    collection_total_mib: positive.max(MAX_COLLECTION_TOTAL_MIB),
  })
  .strict()
  .refine(
    (p) => p.collection_total_mib >= p.collection_file_mib,
    "Collection total must be at least the per-file limit",
  );
export type ExamExecutionPolicy = z.infer<typeof examExecutionPolicy>;

export const collectionExecutionPolicy = z
  .object({
    job: z.string().regex(/^[a-f0-9]{64}$/),
    policy: examExecutionPolicy,
  })
  .strict();

export const examExecutionPolicyRequest = z
  .object({
    agent: identifier,
    exam: identifier,
    nonce: z.string().regex(/^[a-f0-9]{64}$/),
    at: positive,
  })
  .strict();

export const examExecutionPolicyReply = z
  .object({
    type: z.literal("exam-execution-policy"),
    audience: identifier,
    nonce: z.string().regex(/^[a-f0-9]{64}$/),
    expires: positive,
    policy: examExecutionPolicy,
  })
  .strict()
  .refine((r) => r.policy.agent === r.audience, "Policy audience differs");

export const executionPolicySupport = z
  .object({
    schema: z.literal(1),
    capability: z.literal(examExecutionPolicyCapability),
    observation_only: z.literal(true),
    supported: z.boolean(),
    observed: positive,
    roles: z.array(z.string()).max(3),
    issues: z.array(z.string()).max(32),
  })
  .strict()
  .refine(
    (s) =>
      !s.supported ||
      (s.issues.length === 0 &&
        s.roles.length === 3 &&
        ["agent", "watchdog", "source-worker"].every((role) =>
          s.roles.includes(role),
        )),
    "Live settings need matching agent, watchdog and source-worker observations",
  );
