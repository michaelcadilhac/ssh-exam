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

// The selection dialogs need a complete result, not only the first metadata page.
export async function allGrants(
  exam: string,
  usernames: string[],
  signal?: AbortSignal,
) {
  const rows: any[] = [],
    seen = new Set<string>(),
    cursors = new Set<string>();
  for (const username of [...new Set(usernames)]) {
    let after: string | null = null;
    cursors.clear();
    do {
      const page = await api(
        `/admin/exams/${encodeURIComponent(exam)}/grants?username=${encodeURIComponent(username)}&limit=200${after ? `&after=${encodeURIComponent(after)}` : ""}`,
        undefined,
        undefined,
        signal,
      );
      if (!Array.isArray(page.grants) || !("next" in page))
        throw Error("Could not load allowed attempts. Refresh and try again.");
      for (const row of page.grants) {
        if (
          row.exam !== exam ||
          row.username !== username ||
          typeof row.id !== "string" ||
          seen.has(row.id)
        )
          throw Error(
            "The attempt list changed. Refresh before making changes.",
          );
        seen.add(row.id);
        rows.push(row);
      }
      if (
        rows.length > 10000 ||
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
  return rows;
}
