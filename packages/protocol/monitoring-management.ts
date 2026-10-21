import { z } from "zod";
import { attemptReference } from "./clock-management.js";

export const monitoringShow = z.object({ id: attemptReference }).strict();
export const monitoringList = monitoringShow
  .extend({
    section: z.enum(["frames", "terminals"]).default("frames"),
    limit: z.number().int().min(1).max(200).default(50),
    after: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER)
      .default(0),
    through: z
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER)
      .optional(),
  })
  .refine(
    (b) => b.after === 0 || b.through !== undefined,
    "Paging needs the first page's through watermark",
  );
export const monitoringReplay = monitoringShow.extend({
  pane: z.string().uuid(),
  offset: z
    .number()
    .int()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER)
    .default(0),
});

export function parseMonitoring(operation: string, input: unknown) {
  switch (operation) {
    case "monitoring.show":
      return monitoringShow.parse(input);
    case "monitoring.list":
      return monitoringList.parse(input);
    case "monitoring.replay":
      return monitoringReplay.parse(input);
    default:
      throw Error("Unsupported monitoring read operation");
  }
}
