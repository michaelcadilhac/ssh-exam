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
