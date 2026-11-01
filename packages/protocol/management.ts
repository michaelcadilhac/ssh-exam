import { z } from "zod";

export const managementPurpose = "ssh-exam-management/v1";
export const managementOperations = [
  "administrators.list",
  "administrators.show",
  "administrators.create",
  "exams.list",
  "exams.show",
  "exams.create",
  "exams.update",
  "exams.retire-preview",
  "exams.native-reconcile",
  "exams.delete",
  "exams.archive",
  "exams.unarchive",
  "templates.list",
  "templates.show",
  "templates.sync",
  "students.list",
  "students.add",
  "students.remove",
  "students.settings",
  "students.import-preview",
  "students.import-confirm",
  "students.export",
  "students.example",
  "grants.list",
  "grants.show",
  "grants.revise",
  "grants.revoke",
  "grants.issue-preview",
  "grants.issue-show",
  "grants.issue-list",
  "grants.issue-confirm",
  "grants.issue-cancel",
  "grants.additional-preview",
  "grants.source-plan",
  "grants.source-confirm",
  "grants.source-status",
  "grants.source-retry",
  "grants.source-next",
  "grants.source-report",
  "alerts.list",
  "alerts.show",
  "alerts.test",
  "alerts.remind",
  "attempts.list",
  "attempts.show",
  "clocks.show",
  "clocks.reset",
  "clocks.extend",
  "clocks.batch",
  "clocks.preview",
  "interruptions.show",
  "interruptions.review",
  "interruptions.authorize",
  "monitoring.show",
  "monitoring.list",
  "monitoring.replay",
  "monitoring.image",
  "monitoring.export",
  "monitoring.delete",
  "monitoring.purges",
  "monitoring.purge",
  "monitoring.optimize",
] as const;
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
    lifecycle: z.enum(["active", "archived", "all"]).default("active"),
  })
  .strict();
export const examShowRequest = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  })
  .strict();
export const examCreateRequest = z
  .object({
    exam: z.record(z.string(), z.unknown()),
    source_selection: z.literal("template-version/v1").optional(),
    reason: z.string().trim().min(8).max(1000).optional(),
  })
  .strict();
export const examRetirementPreviewRequest = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
    action: z.enum(["delete", "archive", "unarchive"]),
  })
  .strict();
export const examRetirementRequest = examRetirementPreviewRequest
  .omit({ action: true })
  .extend({
    revision: z.string().regex(/^[a-f0-9]{64}$/),
    review: z.string().regex(/^[a-f0-9]{64}$/),
    reason: z.string().trim().min(8).max(1000),
  })
  .strict();
const retirementNativeAttempt = z
  .object({
    id: z.string().uuid(),
    username: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
    uid: z.number().int().min(1000).max(2147483647),
    state: z.enum(["COMPLETED", "CANCELLED_BEFORE_START"]),
    start: z.number().int().nonnegative().safe(),
    deadline: z.number().int().nonnegative().safe(),
    original_deadline: z.number().int().nonnegative().safe(),
    protected: z.boolean(),
    checksum: z.string().max(64),
    access_state: z.enum(["", "RELEASED", "OVERRIDDEN"]),
  })
  .strict()
  .refine((a) =>
    a.state === "COMPLETED"
      ? a.start > 0 &&
        a.deadline > a.start &&
        a.original_deadline > a.start &&
        a.protected &&
        /^[a-f0-9]{64}$/.test(a.checksum) &&
        a.access_state !== ""
      : a.start === 0 &&
        a.deadline === 0 &&
        a.original_deadline === 0 &&
        !a.protected &&
        a.checksum === "",
  );
export const examNativeEvidence = z
  .object({
    version: z.literal(1),
    agent: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
    exam: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
    observed_at: z.number().int().positive().safe(),
    state_hash: z.string().regex(/^[a-f0-9]{64}$/),
    attempts: z.array(retirementNativeAttempt).max(1000),
    permissions: z
      .array(
        z
          .object({
            username: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
            uid: z.number().int().min(1000).max(2147483647),
            source_attempt: z.string().uuid(),
            checksum: z.string().regex(/^[a-f0-9]{64}$/),
            disposition: z.enum(["revoked", "consumed"]),
          })
          .strict(),
      )
      .max(1000),
    released_retentions: z.number().int().min(0).max(1000),
  })
  .strict()
  .refine(
    (e) =>
      new Set(e.attempts.map((a) => a.id)).size === e.attempts.length &&
      new Set(e.permissions.map((p) => p.username)).size ===
        e.permissions.length,
  );
export const examNativeReconcileRequest = examRetirementRequest
  .extend({
    action: z.enum(["delete", "archive"]),
    evidence: examNativeEvidence,
  })
  .strict();
export const examUpdateRequest = z
  .object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
    changes: z.record(z.string(), z.unknown()),
    source_selection: z.literal("template-version/v1").optional(),
    reason: z.string().trim().min(8).max(1000).optional(),
    revision: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export const managementExam = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
export const studentManagement = z
  .object({ exam: managementExam })
  .passthrough();
export const studentListRequest = z
  .object({
    exam: managementExam,
    limit: z.number().int().min(1).max(200).default(100),
    after: z
      .string()
      .regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/)
      .optional(),
  })
  .strict();
