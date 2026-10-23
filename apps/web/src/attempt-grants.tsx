import React, { useEffect, useRef, useState } from "react";
import { api, chicago } from "./api.js";
import { Modal } from "./modal.js";

const fields = [
  ["name", "Saved exam name"],
  ["duration", "Allowance seconds"],
  ["earliest", "Earliest Begin (RFC3339 with zone)"],
  ["latest", "Latest Begin (RFC3339 with zone)"],
  ["terminals", "Terminal limit"],
  ["template", "Materials/starter template"],
  ["template_version", "Exact attested template hash"],
  ["collection_file_mib", "Per-file limit MiB"],
  ["collection_total_mib", "Total limit MiB"],
] as const;
export function beginTime(value: string) {
  const parts =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (!parts)
    throw Error(
      "Begin dates require full RFC3339 date/time with Z or an explicit offset",
    );
  const [year, month, day, hour, minute, second] = parts
      .slice(1, 7)
      .map(Number),
    date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second
  )
    throw Error("Invalid Begin calendar date/time");
  const at = Date.parse(value);
  if (!Number.isSafeInteger(at))
    throw Error("Invalid explicit Begin time zone");
  return at;
}
export function AttemptGrantsDialog({
  exam,
  username,
  onClose,
  onChanged,
}: {
  exam: string;
  username: string;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [grant, setGrant] = useState<any>(null),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [draft, setDraft] = useState<Record<string, string>>({}),
    [reason, setReason] = useState(""),
    [pending, setPending] = useState<{ operation: string; body: any } | null>(
      null,
    );
  const alive = useRef(true);
  const inspect = async (signal: AbortSignal) => {
    const page = await api(
      `/admin/exams/${encodeURIComponent(exam)}/grants?username=${encodeURIComponent(username)}`,
      undefined,
      undefined,
      signal,
    );
    const current = page.grants[0]
      ? await api(
          `/admin/grants/${page.grants[0].id}`,
          undefined,
          undefined,
          signal,
        )
      : null;
    if (!alive.current) return;
    setGrant(current);
    setLoaded(true);
    setError("");
    setPending(null);
    setReason("");
    setDraft(
      current
        ? Object.fromEntries([
            ...fields.map(([k]) => [
              k,
              ["earliest", "latest"].includes(k)
                ? new Date(current.settings[k]).toISOString()
                : String(current.settings[k]),
            ]),
            ["webcam", String(current.settings.webcam)],
          ])
        : {},
    );
  };
  useEffect(() => {
    const abort = new AbortController();
    alive.current = true;
    void inspect(abort.signal).catch((e) => {
      if (alive.current) {
        setError(e.message);
        setLoaded(true);
      }
    });
    return () => {
      alive.current = false;
      abort.abort();
    };
  }, [exam, username]);
  const submit = async (operation: string) => {
    if (!grant || busy) return;
    setError("");
    let intent = pending;
    try {
      if (!intent) {
        const changes: Record<string, unknown> = {};
        if (operation === "revise") {
          for (const [key] of fields) {
            const value = ["earliest", "latest"].includes(key)
              ? beginTime(draft[key])
              : [
                    "duration",
                    "terminals",
                    "collection_file_mib",
                    "collection_total_mib",
                  ].includes(key)
                ? Number(draft[key])
                : draft[key];
            if (typeof value === "number" && !Number.isSafeInteger(value))
              throw Error(
                "Enter complete finite settings; Begin dates require an explicit time zone",
              );
            if (value !== grant.settings[key]) changes[key] = value;
          }
          if ((draft.webcam === "true") !== grant.settings.webcam)
            changes.webcam = draft.webcam === "true";
          if (!Object.keys(changes).length)
            throw Error("Choose an explicit setting to revise");
        }
        intent = {
          operation,
          body: {
            revision: grant.revision,
            reason,
            request: crypto.randomUUID(),
            ...(operation === "revise" ? { changes } : {}),
          },
        };
        setPending(intent);
      }
      setBusy(true);
      const result = await api(
        `/admin/grants/${grant.id}/${intent.operation}`,
        intent.body,
        undefined,
        new AbortController().signal,
      );
      if (!alive.current) return;
      setGrant(result);
      setPending(null);
      setReason("");
      await onChanged();
      await inspect(new AbortController().signal);
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  return (
    <Modal title={`Attempt grants for ${username}`} wide onClose={onClose}>
      <p>
        Issued settings are fixed. Default or enrollment edits do not revise
        them. This workflow manages the initial ordinary grant only; legacy
        migration, extra and sandbox grant issuance are not enabled here.
      </p>
      {!loaded && <p role="status">Loading saved grant…</p>}
      {error && (
        <p role="alert" className="warn">
          {error}
        </p>
      )}
      {loaded && !grant && !error && (
        <p>
          No initial grant is recorded. Existing legacy enrollment/history is
          not automatically backfilled.
        </p>
      )}
      {grant && (
        <>
          <p style={{ overflowWrap: "anywhere" }}>
            Grant <code>{grant.id}</code> · revision {grant.revision} ·{" "}
            {grant.status}
          </p>
          <p>
            Saved allowance: {grant.settings.duration / 60} minutes. Webcam{" "}
            {grant.settings.webcam ? "required" : "not required"}. Begin{" "}
            {chicago(grant.settings.earliest)} through{" "}
            {chicago(grant.settings.latest)}; the full allowance starts only at
            Begin.
          </p>
          <p>
            Unresolved preparation/Begin or consumption blocks
            revision/revocation. A timeout never proves no start. Inspect the
            original native attempt; positively cancel only an unstarted
            preparation before making a new change.
          </p>
          <ul>
            {grant.claims.map((claim: any) => (
              <li key={claim.attempt} style={{ overflowWrap: "anywhere" }}>
                {claim.state} · attempt <code>{claim.attempt}</code>
              </li>
            ))}
          </ul>
          {grant.status === "AVAILABLE" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submit("revise");
              }}
            >
              <fieldset disabled={busy || !!pending}>
                <legend>Explicit unused-grant revision</legend>
                {fields.map(([key, label]) => (
                  <label key={key} style={{ display: "block" }}>
                    {label}
                    <input
                      value={draft[key] ?? ""}
                      onChange={(e) =>
                        setDraft({ ...draft, [key]: e.target.value })
                      }
                      required
                      style={{ width: "100%", minWidth: 0 }}
                    />
                  </label>
                ))}
                <label>
                  Saved webcam requirement
                  <select
                    value={draft.webcam}
                    onChange={(e) =>
                      setDraft({ ...draft, webcam: e.target.value })
                    }
                  >
                    <option value="true">Required</option>
                    <option value="false">Not required</option>
                  </select>
                </label>
                <label>
                  Reason
                  <input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    required
                    minLength={8}
                    maxLength={1000}
                  />
                </label>
              </fieldset>
              {pending && (
                <p style={{ overflowWrap: "anywhere" }}>
                  Original {pending.operation} request{" "}
                  <code>{pending.body.request}</code>. Retry this exact intent
                  or inspect current grant before another change.
                </p>
              )}
              <div className="actions">
                <button
                  type="submit"
                  disabled={
                    busy || (!!pending && pending.operation !== "revise")
                  }
                >
                  {busy
                    ? "Confirming…"
                    : pending
                      ? "Retry original revision"
                      : "Revise unused grant"}
                </button>
                <button
                  type="button"
                  disabled={
                    busy ||
                    (!pending && reason.trim().length < 8) ||
                    (!!pending && pending.operation !== "revoke")
                  }
                  onClick={() => void submit("revoke")}
                >
                  {pending?.operation === "revoke"
                    ? "Retry original revocation"
                    : "Revoke unused grant"}
                </button>
              </div>
            </form>
          )}
          <details>
            <summary>Immutable revision history</summary>
            <ol>
              {grant.history.map((r: any) => (
                <li key={r.revision}>
                  Revision {r.revision}: {r.settings.duration / 60} minutes ·
                  webcam {r.settings.webcam ? "required" : "not required"} ·{" "}
                  {r.actor} · {r.reason}
                </li>
              ))}
            </ol>
            {grant.history_next && (
              <p>
                Older revisions: examctl web grants show {grant.id} --before{" "}
                {grant.history_next}
              </p>
            )}
          </details>
        </>
      )}
      <div className="actions">
        <button
          disabled={busy}
          onClick={() =>
            void inspect(new AbortController().signal).catch((e) =>
              setError(e.message),
            )
          }
        >
          Inspect current grant
        </button>
        <button onClick={onClose}>Close grants</button>
      </div>
    </Modal>
  );
}
