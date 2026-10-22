import { z } from "zod";

// UNWIRED H2b/H3 contract. No live route, issuer, renewal or thaw consumes it.
// A valid object/signature alone is NOT native execution authorization.
export const MONITORING_EVIDENCE_WINDOW_MS = 15_000;
export const MONITORING_CHALLENGE_WINDOW_MS = 5_000;
export const MONITORING_EVIDENCE_MAX_BYTES = 4096;
const name = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
// Canonical lowercase UUID shape, including retained legacy version/variant
// values; do not invent a stricter RFC version policy for existing attempt IDs.
const uuid = z
  .string()
  .regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
const counter = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const monitoringOwner = z
  .object({
    attempt: uuid,
    exam: name,
    username: name,
    uid: z.number().int().min(1000).max(4294967294),
    transport_hash: digest,
    boot: uuid,
    page_epoch: digest,
    input_epoch: digest,
    generation: counter,
    clock_revision: counter,
  })
  .strict();
export const monitoringEvidence = z
  .object({
    type: z.literal("monitoring-execution-evidence-v1"),
    audience: name,
    nonce: digest,
    owner: monitoringOwner,
    sequence: counter.refine(
      (n) => n > 0,
      "Evidence sequence must be positive",
    ),
    age_ms: z
      .number()
      .int()
      .min(0)
      .max(MONITORING_EVIDENCE_WINDOW_MS - 1),
    complete: z.literal(true),
  })
  .strict();
export type MonitoringOwner = z.infer<typeof monitoringOwner>;
export type MonitoringEvidence = z.infer<typeof monitoringEvidence>;
