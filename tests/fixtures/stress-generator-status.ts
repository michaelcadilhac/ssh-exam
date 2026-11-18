import { readFile } from "node:fs/promises";
import { z } from "zod";

const identity = z.object({
  host: z.literal("marco"),
  observed_local_ms: z.number().int().nonnegative(),
  minimum_available_bytes: z.literal(4 * 1024 ** 3),
});
const ready = identity.extend({
  active: z.literal(true),
  available_bytes: z.number().int().nonnegative(),
});
const stopped = identity.extend({
  active: z.literal(false),
  error: z.string().max(2048).optional(),
});

// Called by the real cohort reader; a refusal never becomes a healthy sample.
export async function readRemoteStressHeadroom(path: string) {
  const raw: unknown = JSON.parse(await readFile(path, "utf8"));
  const refusal = stopped.safeParse(raw);
  if (refusal.success)
    throw Error(
      `Remote browser generator stopped: ${refusal.data.error ?? "owned unit unavailable"}. Inspect generator-status.json and the exact generator unit's journal on Marco.`,
    );
  const parsed = ready.safeParse(raw);
  if (!parsed.success)
    throw Error(
      "Remote browser generator status is invalid; inspect generator-status.json. Abort only the owned synthetic test.",
    );
  const status = parsed.data;
  const age = Date.now() - status.observed_local_ms;
  if (age < 0 || age > 20000 || status.available_bytes < status.minimum_available_bytes)
    throw Error(
      "Remote browser generator health/headroom is unavailable; abort only the owned synthetic test and inspect generator-status.json.",
    );
  return status.available_bytes;
}
