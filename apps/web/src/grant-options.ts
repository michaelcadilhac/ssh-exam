import { api } from "./api.js";

export function grantStatus(grant: any, now = Date.now()) {
  if (grant.status === "REVOKED") return "Cancelled";
  if (grant.status === "CONSUMED") return "Started";
  if (!Array.isArray(grant.claims)) return "Needs review";
  if (grant.claims?.some((claim: any) => claim.state !== "CANCELLED"))
    return "Setup in progress";
  if (
    !grant.settings ||
    !Number.isFinite(grant.settings.earliest) ||
    !Number.isFinite(grant.settings.latest)
  )
    return "Needs review";
  if (now > grant.settings.latest) return "Start window closed";
  if (grant.status === "PENDING_NATIVE") return "Preparing saved work";
  if (now < grant.settings.earliest) return "Available later";
  return grant.status === "AVAILABLE" ? "Ready" : "Needs review";
}

export const grantUnused = (grant: any) =>
  ["AVAILABLE", "PENDING_NATIVE"].includes(grant.status) &&
  Array.isArray(grant.claims) &&
  grant.claims.every((claim: any) => claim.state === "CANCELLED");

// Bulk reads use current permissions for the whole exam, never one history
// request per selected student. Personal inspection retains complete history.
export async function allGrants(
  exam: string,
  usernames: string[],
  signal?: AbortSignal,
  nextOnly = false,
) {
  const rows: any[] = [],
    seen = new Set<string>(),
    wanted = new Set(usernames),
    cursors = new Set<string>();
  for (const username of nextOnly ? [null] : [...wanted]) {
    let after: string | null = null;
    cursors.clear();
    do {
      const query = new URLSearchParams({ limit: "200" });
      if (username) query.set("username", username);
      if (nextOnly) query.set("next_only", "true");
      if (after) query.set("after", after);
      const page = await api(
        `/admin/exams/${encodeURIComponent(exam)}/grants?${query}`,
        undefined,
        undefined,
        signal,
      );
      if (!page || !Array.isArray(page.grants) || !("next" in page))
        throw Error("Could not load attempt settings. Refresh and try again.");
      for (const row of page.grants) {
        if (
          !row ||
          row.exam !== exam ||
          typeof row.username !== "string" ||
          (!nextOnly && row.username !== username) ||
          typeof row.id !== "string" ||
          seen.has(row.id) ||
          (nextOnly &&
            (!["AVAILABLE", "PENDING_NATIVE"].includes(row.status) ||
              !Array.isArray(row.claims) ||
              row.claims.some((c: any) => !c || typeof c.state !== "string") ||
              !row.settings ||
              !row.work))
        )
          throw Error(
            "Attempt settings changed or are incomplete. Refresh before making changes.",
          );
        seen.add(row.id);
        if (!nextOnly || wanted.has(row.username)) rows.push(row);
      }
      if (
        seen.size > 10000 ||
        (page.next != null &&
          (typeof page.next !== "string" ||
            !page.next ||
            cursors.has(page.next)))
      )
        throw Error(
          "The attempt list could not be loaded completely. Narrow the selection and try again.",
        );
      after = page.next ?? null;
      if (after) cursors.add(after);
    } while (after);
  }
  return nextOnly
    ? rows.sort((a, b) => a.username.localeCompare(b.username))
    : rows;
}
