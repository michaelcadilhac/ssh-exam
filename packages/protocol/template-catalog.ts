import { z } from "zod";

export const templateName = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
export const templateHash = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const nativeCreated = timestamp.refine(
  (n) => n > 0,
  "Invalid native creation timestamp",
);
const mib = 1048576;

export const nativeTemplateVersion = z
  .object({
    schema: z.literal(1),
    name: templateName,
    hash: templateHash,
    entries: z.number().int().min(2).max(20002),
    files: z.number().int().min(0).max(20000),
    bytes: z
      .number()
      .int()
      .min(0)
      .max(16384 * mib),
    max_file_bytes: z
      .number()
      .int()
      .min(0)
      .max(4096 * mib),
    created: nativeCreated,
  })
  .strict()
  .refine(
    (v) =>
      v.files <= v.entries - 2 &&
      v.max_file_bytes <= v.bytes &&
      v.bytes <= v.max_file_bytes * v.files,
    "Inconsistent template counters",
  );

export const templateCatalogSync = z
  .object({
    version: nativeTemplateVersion,
    reason: z
      .string()
      .trim()
      .refine((s) => {
        if (s.length > 1000) return false;
        const bytes = new TextEncoder().encode(s).length;
        return bytes >= 8 && bytes <= 1000;
      }, "Reason must be 8..1000 UTF-8 bytes"),
  })
  .strict();
export const templateCatalogShow = z
  .object({ name: templateName, hash: templateHash })
  .strict();
export const templateCatalogPage = z
  .object({
    name: templateName.optional(),
    after: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,64}@[a-f0-9]{64}$/)
      .optional(),
    limit: z.number().int().min(1).max(200).default(50),
  })
  .strict();

// These are timestamped authenticated source attestations, NOT live filesystem
// probes, leases, grant/Begin permission, or copies of exam text/inventories.
export const templateCatalogSource = z
  .object({
    schema: z.literal(1),
    agent: templateName,
    name: templateName,
    hash: templateHash,
    entries: z.number().int().min(2).max(20002),
    files: z.number().int().min(0).max(20000),
    bytes: z
      .number()
      .int()
      .min(0)
      .max(16384 * mib),
    max_file_bytes: z
      .number()
      .int()
      .min(0)
      .max(4096 * mib),
    first_native_created: nativeCreated,
    last_native_created: nativeCreated,
    first_acknowledged_at: timestamp,
    last_attested_at: timestamp,
    last_acknowledged_at: timestamp,
    last_request: z.string().uuid(),
    revision: templateHash,
  })
  .strict()
  .refine(
    (v) =>
      v.files <= v.entries - 2 &&
      v.max_file_bytes <= v.bytes &&
      v.bytes <= v.max_file_bytes * v.files &&
      v.first_acknowledged_at <= v.last_acknowledged_at,
    "Inconsistent template source metadata",
  );
export type NativeTemplateVersion = z.infer<typeof nativeTemplateVersion>;
export type TemplateCatalogSource = z.infer<typeof templateCatalogSource>;

export const templateCatalogPageResult = z
  .object({
    agent: templateName,
    sources: z.array(templateCatalogSource).max(200),
    next: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,64}@[a-f0-9]{64}$/)
      .nullable(),
    observed: timestamp,
    note: z.string().min(1).max(2000),
  })
  .strict()
  .refine(
    (r) => r.sources.every((s) => s.agent === r.agent),
    "Mixed source identities",
  );
export const templateCatalogShowResult = z
  .object({
    agent: templateName,
    source: templateCatalogSource,
    observed: timestamp,
    note: z.string().min(1).max(2000),
  })
  .strict()
  .refine((r) => r.source.agent === r.agent, "Wrong source identity");
