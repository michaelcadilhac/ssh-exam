import { z } from "zod";
import { readFileSync } from "node:fs";
const schema = z.object({
  mode: z.enum(["development", "production"]).default("production"),
  origin: z.string().url(),
  data: z.string().default("/data"),
  port: z.number().int().default(3000),
  jump: z.object({
    host: z.string(),
    port: z.number().int().default(22),
    pins: z.array(z.string().regex(/^[a-f0-9]{64}$/)).min(1),
  }),
  class: z.object({
    host: z.string(),
    port: z.number().int().default(22),
    pins: z.array(z.string().regex(/^[a-f0-9]{64}$/)).min(1),
  }),
  agent: z.object({
    url: z.string().url(),
    ca: z.string(),
    cert: z.string(),
    key: z.string(),
  }),
  smtp: z
    .object({
      host: z.string(),
      port: z.number().int(),
      secure: z.boolean(),
      user: z.string().optional(),
      passwordFile: z.string().optional(),
      from: z.string().email(),
      to: z.array(z.string().email()).min(1),
    })
    .optional(),
  maintenance: z.boolean().default(false),
  loginOnly: z.boolean().optional(),
  functionalTest: z.boolean().optional(),
  preflightIdleMs: z.number().int().min(1000).max(86400000).optional(),
  readinessFile: z.string().optional(),
});
export type Config = z.infer<typeof schema>;
export function loadConfig(
  path = process.env.EXAM_CONFIG || "config.json",
): Config {
  const c = schema.parse(JSON.parse(readFileSync(path, "utf8")));
  if (process.env.NODE_ENV === "production" && c.mode !== "production")
    throw Error("Development configuration forbidden in production image");
  if (c.loginOnly && c.mode !== "development")
    throw Error("Login-only testing requires development mode");
  if (c.functionalTest && c.mode !== "development")
    throw Error("Privileged functional testing requires development mode");
  if (c.mode === "production") {
    if (!c.origin.startsWith("https://") || !c.agent.url.startsWith("https://"))
      throw Error("Production requires HTTPS and mTLS");
    if (
      [c.jump.host, c.class.host].some((h) =>
        ["localhost", "127.0.0.1", "mock-jump", "mock-class"].includes(h),
      )
    )
      throw Error("Fixture hosts forbidden in production");
    if (!c.smtp || !c.readinessFile)
      throw Error(
        "Production requires tested notifications and readiness signoff",
      );
    const report = JSON.parse(readFileSync(c.readinessFile, "utf8"));
    for (const k of [
      "institutionalSSH",
      "browserMatrix",
      "serverGuards",
      "protectedCollection",
      "intervalAccessHold",
      "alerts",
    ])
      if (report[k] !== true) throw Error(`Production signoff missing: ${k}`);
  }
  return c;
}
