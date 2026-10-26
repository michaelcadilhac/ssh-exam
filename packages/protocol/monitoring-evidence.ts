import { z } from "zod";

// Authenticated capture/bootstrap/evidence for the guarded native supervisor.
// Installed retained admission remains disabled. Registered identity alone is
// not execution authorization and cannot reconstruct a live permit from disk.
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
    coverage_epoch: digest,
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

// Provisional pre-start observation. It cannot authorize work before native
// durable ACTIVE commit, exclusive live ownership and kernel peer verification.
export const monitoringBootstrap = z
  .object({
    type: z.literal("monitoring-bootstrap/v1"),
    control_retention: z.literal("v1"),
    policy_reports: z.literal("v1"),
    owner: monitoringOwner,
    coverage_epoch: digest,
    sequence: z.literal(1),
  })
  .strict();
export type MonitoringBootstrap = z.infer<typeof monitoringBootstrap>;

export const nativeMonitoringContinuation = z
  .object({
    type: z.literal("monitoring-continue/v1"),
    agent: name,
    nonce: digest,
    previous_owner: monitoringOwner,
    owner: monitoringOwner,
  })
  .strict();

// A distinct purpose cannot consume a reviewed approval without proving the
// original live monitoring stream. The nonce is a native memory acceptance
// anchor, not a permission restored from storage.
export const nativeTechnicalContinuation = nativeMonitoringContinuation
  .extend({
    type: z.literal("monitoring-technical-continue/v1"),
    continuity: z
      .object({
        owner: monitoringOwner,
        coverage_epoch: digest,
        after_sequence: counter,
        last_accepted_nonce: z.union([digest, z.literal("")]),
      })
      .strict(),
  })
  .strict();

export const nativeTechnicalPoll = z
  .object({
    type: z.literal("monitoring-technical-poll/v1"),
    agent: name,
    nonce: digest,
    generation: counter,
    owner: monitoringOwner,
  })
  .strict();
export const nativeTechnicalResult = z
  .object({
    type: z.literal("monitoring-technical-result/v1"),
    agent: name,
    request_nonce: digest,
    result: z
      .object({
        attempt: z
          .object({
            id: uuid,
            state: z.literal("ACTIVE"),
            monitoring_mode: z.literal("v1"),
            monitoring_resume_kind: z.literal("technical"),
            monitoring_resume_nonce: digest,
            registered_owner: monitoringOwner,
            retained_hold: z.literal("").optional(),
          })
          .passthrough(),
        input_epochs: z.record(z.string(), digest),
        monitoring_remaining_ms: z
          .number()
          .int()
          .positive()
          .max(MONITORING_EVIDENCE_WINDOW_MS),
      })
      .strict(),
  })
  .strict();

export const nativeMonitoringChallenge = z
  .object({
    type: z.literal("monitoring-execution-challenge-v1"),
    agent: name,
    nonce: digest,
    owner: monitoringOwner,
    after_sequence: counter,
    coverage_epoch: z.union([digest, z.literal("")]),
    policy_reports: z.literal("v1").optional(),
  })
  .strict()
  .refine(
    (v) => v.coverage_epoch !== "" || v.after_sequence === 0,
    "Established monitoring coverage must be named explicitly",
  );
