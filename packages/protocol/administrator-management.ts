import { z } from "zod";

export const administratorUsername = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
export const administratorCredentials = z.object({
  username: administratorUsername,
  password: z.string().min(12).max(1024),
});
export const administratorCreate = administratorCredentials.strict();
export const administratorCreatedResult = z
  .object({ username: administratorUsername })
  .strict();
export const administratorShow = z
  .object({ username: administratorUsername })
  .strict();
export const administratorList = z
  .object({
    limit: z.number().int().min(1).max(200).default(100),
    after: administratorUsername.optional(),
  })
  .strict();
