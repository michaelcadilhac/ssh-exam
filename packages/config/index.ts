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
  browserSSH: z
    .object({
      relay: z.string().url(),
      audience: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
    })
    .optional(),
  agent: z.object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
    signingKey: z.string(),
    callbackPublicKey: z.string(),
  }),
  smtp: z
    .union([
      z.object({
        host: z.string(),
        port: z.number().int(),
        secure: z.boolean(),
        user: z.string().optional(),
        passwordFile: z.string().optional(),
        from: z.string().email(),
        to: z.array(z.string().email()).min(1),
      }),
      z.object({
        socket: z.string().regex(/^\/[^\0]+$/),
        from: z.string().email(),
        to: z.array(z.string().email()).min(1),
      }),
    ])
    .optional(),
  maintenance: z.boolean().default(false),
  loginOnly: z.boolean().optional(),
  functionalTest: z.boolean().optional(),
  terminalRecordingLimitMiB: z.number().int().min(1).max(1048576).optional(),
  preflightIdleMs: z.number().int().min(1000).max(86400000).optional(),
  readinessFile: z.string().optional(),
});
export type Config = z.infer<typeof schema>;
export function productionReadinessIssues(c: Config): string[] {
  if (c.mode !== "production") return [];
  const issues: string[] = [];
  if (!c.smtp) issues.push("Notifications are not configured");
  if (!c.readinessFile)
    return [...issues, "Readiness signoff is not configured"];
  let report: any;
  try {
    report = JSON.parse(readFileSync(c.readinessFile, "utf8"));
  } catch {
    return [...issues, "Readiness signoff is unavailable"];
  }
  for (const k of [
    "institutionalSSH",
    "browserMatrix",
    "serverGuards",
    "protectedCollection",
    "sshCommandTransport",
    "statusCallbacks",
    "intervalAccessHold",
    "alerts",
  ])
    if (report[k] !== true) issues.push(`Production signoff missing: ${k}`);
  return issues;
}
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
    if (c.browserSSH && !c.browserSSH.relay.startsWith("wss://"))
      throw Error("Browser SSH requires a secure relay");
    if (!c.origin.startsWith("https://"))
      throw Error("Production requires HTTPS");
    if (
      [c.jump.host, c.class.host].some((h) =>
        ["localhost", "127.0.0.1", "mock-jump", "mock-class"].includes(h),
      )
    )
      throw Error("Fixture hosts forbidden in production");
    const issues = productionReadinessIssues(c);
    if (issues.length && !c.maintenance) throw Error(issues.join("; "));
  }
  return c;
}
