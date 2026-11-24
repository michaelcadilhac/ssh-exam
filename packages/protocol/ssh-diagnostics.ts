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
      "relay-socket-close",
      "relay-socket-error",
      "browser-client-close",
      "browser-lifecycle",
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
      "channel-capacity",
      "admission-refused",
      "operation-rejected",
      "worker-error",
      "peer-close",
      "unknown",
      "client-close",
      "socket-error",
      "page-hide",
      "document-hidden",
      "document-visible",
      "network-offline",
      "network-online",
    ]),
    close_code: z.number().int().min(1000).max(4999).optional(),
    was_clean: z.boolean().optional(),
    page_persisted: z.boolean().optional(),
    visible: z.boolean().optional(),
    focused: z.boolean().optional(),
    online: z.boolean().optional(),
    close_intent: z
      .enum([
        "caller",
        "replace",
        "transport-loss",
        "worker-error",
        "control-close",
        "server-request",
        "recovery-expired",
        "sign-out",
        "sign-in-failed",
      ])
      .optional(),
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
