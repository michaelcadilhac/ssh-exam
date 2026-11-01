import { api } from "./api.js";
import { templateCatalogPageResult } from "../../../packages/protocol/template-catalog.js";
import { shortDateTime } from "./local-date-time.js";

export function examChoiceLabel(exam: {
  id: string;
  name?: string;
  lifecycle?: string;
}) {
  const label =
    exam.name && exam.name !== exam.id ? `${exam.name} · ${exam.id}` : exam.id;
  return exam.lifecycle === "archived" ? `${label} · Archived` : label;
}

export async function publishedFiles(signal?: AbortSignal) {
  const sources: any[] = [],
    seen = new Set<string>(),
    cursors = new Set<string>();
  let after: string | null = null;
  do {
    const value = templateCatalogPageResult.parse(
      await api(
        `/admin/templates?limit=200${after ? `&after=${encodeURIComponent(after)}` : ""}`,
        undefined,
        undefined,
        signal,
      ),
    );
    for (const source of value.sources) {
      const key = `${source.name}@${source.hash}`;
      if (seen.has(key))
        throw Error(
          "The starter-file list changed. Refresh it before choosing files.",
        );
      seen.add(key);
      sources.push(source);
    }
    if (sources.length > 10000 || (value.next && cursors.has(value.next)))
      throw Error(
        "Could not load the complete starter-file list. Refresh and try again.",
      );
    after = value.next;
    if (after) cursors.add(after);
  } while (after);
  return sources;
}

export async function attemptsForExam(
  exam: string,
  username?: string,
  signal?: AbortSignal,
) {
  const attempts: any[] = [],
    seen = new Set<string>(),
    cursors = new Set<string>();
  let after: string | null = null,
    scanned = 0;
  do {
    const value = await api(
      `/admin/exams/${encodeURIComponent(exam)}/attempts?limit=200${username ? `&q=${encodeURIComponent(username)}` : ""}${after ? `&after=${encodeURIComponent(after)}` : ""}`,
      undefined,
      undefined,
      signal,
    );
    if (
      !Array.isArray(value.attempts) ||
      !("next" in value) ||
      !Number.isInteger(value.scanned) ||
      value.scanned < 0
    )
      throw Error("Could not read the attempt list. Refresh and try again.");
    scanned += value.scanned;
    for (const attempt of value.attempts) {
      if (
        attempt.exam !== exam ||
        typeof attempt.id !== "string" ||
        seen.has(attempt.id)
      )
        throw Error(
          "The attempt list changed. Refresh before choosing saved work.",
        );
      seen.add(attempt.id);
      if (!username || attempt.username === username) attempts.push(attempt);
    }
    if (
      scanned > 10000 ||
      (value.next != null &&
        (typeof value.next !== "string" ||
          !value.next ||
          cursors.has(value.next)))
    )
      throw Error(
        "Could not load the complete history. Choose fewer exams and try again.",
      );
    after = value.next;
    if (after) cursors.add(after);
  } while (after);
  return attempts;
}

export const savedWorkUsable = (a: any) =>
  typeof a.id === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
    a.id,
  ) &&
  Number.isSafeInteger(a.uid) &&
  a.uid >= 1000 &&
  a.state === "COMPLETED" &&
  (a.protected === true || a.protected === 1) &&
  typeof a.checksum === "string" &&
  /^[a-f0-9]{64}$/.test(a.checksum) &&
  Number.isSafeInteger(a.start) &&
  a.start > 0 &&
  Number.isSafeInteger(a.original_deadline) &&
  a.original_deadline > a.start;

export function latestStarted(attempts: any[], username: string) {
  const started = attempts
    .filter(
      (a) =>
        a.username === username && Number.isSafeInteger(a.start) && a.start > 0,
    )
    .sort((a, b) => b.start - a.start);
  if (started.length > 1 && started[0].start === started[1].start)
    throw Error(
      `${username}: Several attempts started at the same time. Choose the saved work explicitly.`,
    );
  return started[0] ?? null;
}

export const savedWorkLabel = (a: any, choices: any[] = []) => {
  const name = a.settings?.name || a.exam;
  const duplicate = choices.some(
    (other) =>
      other &&
      other.exam !== a.exam &&
      (other.settings?.name || other.exam) === name,
  );
  return `${name}${duplicate ? ` (${a.exam})` : ""}${a.attempt_number ? ` · Attempt ${a.attempt_number}` : ""} · ${shortDateTime(a.start)}`;
};
