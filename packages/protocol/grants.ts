import { z } from "zod";
import { examConfiguration, username } from "./index.js";
import { monitoringOwner } from "./monitoring-evidence.js";

export const grantWorkspace = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("empty") }).strict(),
  z
    .object({
      kind: z.literal("template"),
      name: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
      hash: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict(),
  z
    .object({
      kind: z.literal("saved"),
      attempt: z.string().uuid(),
      checksum: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict(),
]);
export const grantBinding = z
  .object({
    id: z.string().uuid(),
    revision: z.number().int().positive(),
    hash: z.string().regex(/^[a-f0-9]{64}$/),
    kind: z.enum(["ADDITIONAL", "PRACTICE"]).optional(),
    issuance_order: z.number().int().positive().safe().optional(),
    initial_grant: z.string().uuid().optional(),
    work: grantWorkspace.optional(),
  })
  .strict()
  .refine(
    (g) =>
      (!g.kind || g.issuance_order !== undefined) &&
      (!g.initial_grant ||
        (g.kind === "ADDITIONAL" && g.initial_grant !== g.id)),
    "Additional authority requires its issued order and a distinct original initial-grant identity",
  );
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
export const grantReviewList = grantList
  .pick({ exam: true, after: true })
  .extend({
    limit: z.number().int().min(1).max(20).default(20),
  })
  .strict();
export const grantSourceRequest = z
  .object({
    id: z.string().uuid(),
    revision: z.number().int().positive().safe(),
  })
  .strict();
export const grantSourceConfirmation = grantSourceRequest
  .extend({
    grant_hash: z.string().regex(/^[a-f0-9]{64}$/),
    state: z.enum(["RETAINED", "RELEASED"]),
    source: z
      .object({
        attempt: z.string().uuid(),
        checksum: z.string().regex(/^[a-f0-9]{64}$/),
        metadata_hash: z.string().regex(/^[a-f0-9]{64}$/),
        uid: z.number().int().min(1000).safe(),
      })
      .strict(),
    retention_hash: z.string().regex(/^[a-f0-9]{64}$/),
    retained_at: z.number().int().positive().safe(),
  })
  .strict();
export const grantRevision = z
  .object({
    revision: z.number().int().positive(),
    changes: examConfiguration.omit({ id: true }).partial().strict(),
    work: grantWorkspace.optional(),
    reason: z.string().trim().min(8).max(1000),
    request: z.string().uuid().optional(),
  })
  .strict();
export const grantRevocation = grantRevision
  .omit({ changes: true, work: true })
  .strict();
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
export const grantAdditionalPreview = grantIssuePreview
  .extend({
    duration: z.number().int().min(60).max(21600).optional(),
    preserve_duration: z.literal(true).optional(),
    webcam: z.boolean().optional(),
    work: grantWorkspace.optional(),
    student_settings: z
      .array(
        z
          .object({
            username,
            duration: z.number().int().min(60).max(21600).optional(),
            webcam: z.boolean().optional(),
          })
          .strict()
          .refine(
            (row) => row.duration !== undefined || row.webcam !== undefined,
            "Name an explicit per-student setting",
          ),
      )
      .min(1)
      .max(200)
      .optional(),
    saved_sources: z
      .array(
        z
          .object({
            username,
            attempt: z.string().uuid(),
            checksum: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict(),
      )
      .min(1)
      .max(200)
      .optional(),
    work_sources: z
      .array(z.object({ username, work: grantWorkspace }).strict())
      .min(1)
      .max(200)
      .optional(),
  })
  .strict()
  .superRefine((b, ctx) => {
    if ((b.duration !== undefined) === (b.preserve_duration === true))
      ctx.addIssue({
        code: "custom",
        path: ["duration"],
        message: "Choose an explicit duration OR preserve_duration, never both",
      });
    if (b.student_settings) {
      const names = new Set(b.student_settings.map((row) => row.username));
      if (
        names.size !== b.student_settings.length ||
        b.student_settings.some((row) => !b.usernames.includes(row.username))
      )
        ctx.addIssue({
          code: "custom",
          path: ["student_settings"],
          message: "Per-student settings must name distinct selected students",
        });
    }
    if (
      [b.work, b.saved_sources, b.work_sources].filter(
        (value) => value !== undefined,
      ).length > 1
    )
      ctx.addIssue({
        code: "custom",
        path: ["work_sources"],
        message:
          "Choose shared work, saved_sources OR work_sources, never more than one",
      });
    const sources = b.work_sources ?? b.saved_sources;
    if (!sources) return;
    const selected = new Set(b.usernames),
      mapped = new Set(sources.map((s) => s.username));
    if (
      mapped.size !== sources.length ||
      mapped.size !== selected.size ||
      sources.some((s) => !selected.has(s.username))
    )
      ctx.addIssue({
        code: "custom",
        path: [b.work_sources ? "work_sources" : "saved_sources"],
        message: b.work_sources
          ? "Choose starting files for every selected student exactly once"
          : "Provide exactly one protected attempt/checksum for every selected student; no duplicates, omissions or unselected owners",
      });
  });
export const grantBeginRequest = z
  .object({
    type: z.enum(["grant-begin/v2", "grant-begin/v3"]),
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
    page_epoch: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    settings: examConfiguration.strict(),
    initial_owner: monitoringOwner.optional(),
  })
  .strict()
  .refine(
    (b) => (b.type === "grant-begin/v3") === (b.initial_owner !== undefined),
    "New monitoring Begin requires its exact provisional owner; legacy Begin cannot carry one",
  );
