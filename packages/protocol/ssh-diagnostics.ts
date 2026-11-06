import { z } from "zod";

// Untrusted browser observations are diagnostic hints, never execution or
// misconduct evidence. Reject unknown/raw fields rather than copying errors.
export const sshDiagnostic = z
  .object({
    stage: z.enum([
      "relay-dial",
      "relay-ticket",
      "relay-ready",
      "ssh-wait",
      "ssh-keepalive",
      "worker-error",
      "connect",
      "command",
      "open",
      "handoff",
      "handoff-key",
      "change-input-epoch",
      "input-framed",
      "resize-framed",
      "input",
      "resize",
      "close-pane",
      "operation",
      "control-close",
      "control-grace-expired",
    ]),
    cause: z.enum([
      "started",
      "timeout",
      "cancelled",
      "eof",
      "closed",
      "reset",
      "broken-pipe",
      "remote-exit",
      "operation-rejected",
      "worker-error",
      "peer-close",
      "unknown",
    ]),
    close_code: z.number().int().min(1000).max(4999).optional(),
  })
  .strict();
export type SSHDiagnostic = z.infer<typeof sshDiagnostic>;
export const sshObservation = sshDiagnostic
  .extend({
    relay_reference: z
      .string()
      .regex(/^[a-f0-9]{24}$/)
      .optional(),
    pane: z.string().uuid().optional(),
  })
  .strict();
export type SSHObservation = z.infer<typeof sshObservation>;
export const safeSSHDiagnostic = (
  value: unknown,
): SSHDiagnostic | undefined => {
  const parsed = sshDiagnostic.safeParse(value);
  return parsed.success ? parsed.data : undefined;
};
