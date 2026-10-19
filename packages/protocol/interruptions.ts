// Presentation only. These records never grant continuation or change clocks.
export function interruptionSeconds(
  entry: any,
  attempt: any,
  clock: number,
): number | null {
  if (!entry.opened) return null;
  if (entry.ended)
    return entry.ended >= entry.opened
      ? (entry.ended - entry.opened) / 1000
      : null;
  if (entry.outcome) return null;
  const end = Math.min(clock, attempt.ended || attempt.deadline || clock);
  return end >= entry.opened ? (end - entry.opened) / 1000 : null;
}
export function authorizationStatus(grant: any, clock: number): string {
  if (grant.used_at || grant.consumed) return "Used to resume";
  if (grant.replaced_at) return "Replaced by a later approval";
  if (grant.revoked_at) return "Revoked";
  if (grant.historical) return "Resumption not recorded";
  if (grant.expires && grant.expires <= clock)
    return "Expired without resuming";
  return "Awaiting resume";
}
