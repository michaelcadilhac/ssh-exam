import { z } from "zod";
import {
  DEFAULT_COLLECTION_FILE_MIB,
  DEFAULT_COLLECTION_TOTAL_MIB,
  MAX_COLLECTION_FILE_MIB,
  MAX_COLLECTION_TOTAL_MIB,
} from "./collection-limits.js";
export const username = z
  .string()
  .regex(
    /^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/,
    "Usernames must be 1–32 characters, start with a letter, and contain only letters, digits, underscores, or hyphens.",
  )
  .refine(
    (v) =>
      ![
        "root",
        "daemon",
        "bin",
        "sys",
        "sync",
        "games",
        "man",
        "lp",
        "mail",
        "news",
        "uucp",
        "proxy",
        "www-data",
        "backup",
        "nobody",
        "systemd-network",
      ].includes(v.toLowerCase()),
    "Privileged/service account forbidden",
  );
export const examConfiguration = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  name: z.string().min(1).max(120),
  earliest: z.number().int(),
  latest: z.number().int(),
  duration: z.number().int().min(60).max(21600).default(5400),
  webcam: z.boolean().default(true),
  terminals: z.number().int().min(1).max(4).default(4),
  template: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  // Empty is an explicit legacy-default selection on writes. The shared
  // writer removes it; saved versioned snapshots always contain the exact hash.
  template_version: z
    .string()
    .regex(/^([a-f0-9]{64})?$/)
    .optional(),
  collection_file_mib: z
    .number()
    .int()
    .min(1)
    .max(MAX_COLLECTION_FILE_MIB)
    .default(DEFAULT_COLLECTION_FILE_MIB),
  collection_total_mib: z
    .number()
    .int()
    .min(1)
    .max(MAX_COLLECTION_TOTAL_MIB)
    .default(DEFAULT_COLLECTION_TOTAL_MIB),
});
export const examSchema = examConfiguration
  .refine((e) => e.latest > e.earliest, "Invalid start window")
  .refine(
    (e) => e.collection_total_mib >= e.collection_file_mib,
    "Collection total must be at least the per-file limit",
  );
export type Exam = z.infer<typeof examSchema>;
export type AccessState = "UNKNOWN" | "HELD" | "RELEASED" | "OVERRIDDEN";
export type State =
  | "PREPARING"
  | "ACTIVE"
  | "LOCKED"
  | "FINALIZING"
  | "COMPLETED"
  | "COLLECTION_FAILED"
  | "CANCELLED_BEFORE_START";
export const readySchema = z.object({
  fullscreen: z.literal(true),
  focus: z.literal(true),
  visible: z.literal(true),
  keyboard: z.literal(true),
  screen: z.literal(true),
  webcam: z.boolean(),
});
export { readinessMessage } from "./readiness.js";
export const messageSchema = z.discriminatedUnion("type", [
  z.object({
    v: z.literal(1),
    type: z.literal("preflight-contact"),
    confirmation: z.string().uuid().optional(),
  }),
  z.object({
    v: z.literal(1),
    type: z.literal("heartbeat"),
    confirmation: z.string().uuid().optional(),
    ready: readySchema.extend({ focus: z.boolean() }),
  }),
  z.object({ v: z.literal(1), type: z.literal("focus"), focused: z.boolean() }),
  z.object({
    v: z.literal(1),
    type: z.literal("incident"),
    reason: z.string().min(1).max(300),
    diagnostics: z
      .object({
        acknowledgmentAgeMs: z
          .number()
          .int()
          .nonnegative()
          .max(Number.MAX_SAFE_INTEGER),
        rejectedSnapshots: z
          .number()
          .int()
          .nonnegative()
          .max(Number.MAX_SAFE_INTEGER),
      })
      .optional(),
  }),
  z.object({
    v: z.literal(1),
    type: z.literal("open"),
    pane: z.string().uuid(),
  }),
  z.object({
    v: z.literal(1),
    type: z.literal("input"),
    pane: z.string().uuid(),
    data: z.string().max(16384),
    generation: z.number().int(),
  }),
  z.object({
    v: z.literal(1),
    type: z.literal("resize"),
    pane: z.string().uuid(),
    cols: z.number().int().min(2).max(500),
    rows: z.number().int().min(2).max(200),
  }),
  z.object({
    v: z.literal(1),
    type: z.literal("close"),
    pane: z.string().uuid(),
  }),
]);
export const authMessage = z.discriminatedUnion("type", [
  z.object({
    v: z.literal(1),
    type: z.literal("start"),
    exam: z.string().max(64),
    username,
  }),
  z.object({
    v: z.literal(1),
    type: z.literal("answers"),
    round: z.string().uuid(),
    answers: z.array(z.string().max(4096)).max(16),
  }),
  z.object({ v: z.literal(1), type: z.literal("cancel") }),
]);
export const ended = (s: State) =>
  ["COMPLETED", "COLLECTION_FAILED", "CANCELLED_BEFORE_START"].includes(s);
