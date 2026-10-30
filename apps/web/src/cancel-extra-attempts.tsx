import { useEffect, useRef, useState } from "react";
import { api, chicago } from "./api.js";
import { allGrants, grantStatus, grantUnused } from "./grant-options.js";
import { Modal } from "./modal.js";
import { timeLimit } from "./local-date-time.js";

type Outcome = {
  state: "cancelled" | "unknown" | "refused";
  message: string;
  detail?: string;
};
export type CancellationIntents = Map<
  string,
  { revision: number; reason: string; request: string }
>;

export function CancelExtraAttempts({
  exam,
  students,
  requests,
  onClose,
  onChanged,
}: {
  exam: string;
  students: string[];
  requests: CancellationIntents;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [rows, setRows] = useState<any[] | null>(null),
    [selected, setSelected] = useState(new Set<string>()),
    [outcomes, setOutcomes] = useState<Record<string, Outcome>>({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [reload, setReload] = useState(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    const abort = new AbortController();
    void allGrants(exam, students, abort.signal)
      .then((grants) => {
        if (!alive.current) return;
        const extras = grants
          .filter(
            (g) =>
              students.includes(g.username) &&
              (g.issuance === "ADDITIONAL_TEMPLATE" ||
                (g.issuance === "PRACTICE" && g.actor !== "policy:sandbox")) &&
              (g.status !== "REVOKED" || requests.has(g.id)),
          )
          .sort(
            (a, b) =>
              a.username.localeCompare(b.username) || a.issued_at - b.issued_at,
          );
        setRows(extras);
        const recovered: Record<string, Outcome> = {};
        for (const row of extras)
          if (requests.has(row.id)) {
            if (row.status === "REVOKED") {
              recovered[row.id] = {
                state: "cancelled",
                message: "Cancelled — status confirmed",
              };
              requests.delete(row.id);
            } else
              recovered[row.id] = {
                state: "unknown",
                message: "Previous result unknown — retry",
              };
          }
        setOutcomes(recovered);
        setSelected(
          new Set(
            extras
              .filter((g) => grantUnused(g) || requests.has(g.id))
              .map((g) => g.id),
          ),
        );
      })
      .catch((e) => {
        if (alive.current) setError(e.message);
      });
    return () => {
      alive.current = false;
      abort.abort();
    };
  }, [exam, students, requests, reload]);
  const cancel = async () => {
    if (busy || !rows) return;
    setBusy(true);
    setError("");
    try {
      // Sequential requests keep partial outcomes explicit and reuse each exact
      // intent after reply loss. Server checks remain authoritative for each row.
      for (const row of rows.filter((g) => selected.has(g.id))) {
        if (
          outcomes[row.id]?.state === "cancelled" ||
          outcomes[row.id]?.state === "refused"
        )
          continue;
        let body = requests.get(row.id);
        if (!body) {
          body = {
            revision: row.revision,
            reason: "Instructor cancelled an unused extra attempt",
            request: crypto.randomUUID(),
          };
          requests.set(row.id, body);
        }
        let outcome: Outcome;
        try {
          const result = await api(
            `/admin/grants/${row.id}/revoke`,
            body,
            undefined,
            new AbortController().signal,
          );
          if (result.id !== row.id || result.status !== "REVOKED")
            throw Error(
              "Cancellation could not be confirmed. Retry this request.",
            );
          outcome = { state: "cancelled", message: "Cancelled" };
          requests.delete(row.id);
        } catch (e) {
          const confirmed = [400, 403, 404, 409].includes((e as any).status);
          outcome = {
            state: confirmed ? "refused" : "unknown",
            message: confirmed ? "Not cancelled" : "Result unknown — retry",
            detail: (e as Error).message,
          };
          // The exact diagnostic is available on the affected row, never hidden
          // behind a batch-success message or interpreted as a safe no-start.
          if (confirmed) requests.delete(row.id);
        }
        if (alive.current)
          setOutcomes((previous) => ({ ...previous, [row.id]: outcome }));
      }
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const remaining =
    rows?.filter(
      (g) =>
        selected.has(g.id) &&
        !["cancelled", "refused"].includes(outcomes[g.id]?.state ?? ""),
    ) ?? [];
  return (
    <Modal
      title="Cancel extra attempts"
      onClose={() => {
        if (!busy) onClose();
      }}
      wide
    >
      <p>
        Choose attempts that have not started. Earlier attempts and saved files
        are kept.
      </p>
      {error && (
        <div role="alert" className="error">
          <p>{error}</p>
          <button
            disabled={busy}
            onClick={() => {
              setError("");
              setRows(null);
              setReload((n) => n + 1);
            }}
          >
            Retry loading
          </button>
        </div>
      )}
      {!rows && !error && <p role="status">Loading extra attempts…</p>}
      {rows &&
        students
          .filter(
            (username) =>
              !rows.some(
                (g) =>
                  g.username === username &&
                  (g.status !== "CONSUMED" ||
                    outcomes[g.id] ||
                    requests.has(g.id)),
              ),
          )
          .map((username) => (
            <p key={username}>{username}: Nothing to cancel.</p>
          ))}
      {rows
        ?.filter(
          (row) =>
            row.status !== "CONSUMED" ||
            outcomes[row.id] ||
            requests.has(row.id),
        )
        .map((row) => {
          const unused = grantUnused(row),
            outcome = outcomes[row.id];
          return (
            <article key={row.id} className="admin-grant-choice">
              <label>
                <input
                  type="checkbox"
                  aria-label={`Cancel extra attempt for ${row.username} created ${chicago(row.issued_at)}`}
                  checked={selected.has(row.id)}
                  disabled={busy || !unused || !!outcome}
                  onChange={(e) =>
                    setSelected((old) => {
                      const next = new Set(old);
                      e.target.checked ? next.add(row.id) : next.delete(row.id);
                      return next;
                    })
                  }
                />
                <strong>{row.username}</strong> · Extra attempt ·{" "}
                {timeLimit(row.settings.duration)}
              </label>
              <p>
                Created {chicago(row.issued_at)} ·{" "}
                {row.work.kind === "saved"
                  ? "Saved work"
                  : row.work.kind === "empty"
                    ? "Empty folder"
                    : `Starter files: ${row.work.name}`}
              </p>
              <p>
                Start {chicago(row.settings.earliest)} –{" "}
                {chicago(row.settings.latest)}
              </p>
              {outcome ? (
                <p
                  role="status"
                  className={outcome.state === "cancelled" ? "" : "warn"}
                >
                  {outcome.message}
                </p>
              ) : (
                !unused && (
                  <p className="warn">Setup in progress. Cannot cancel.</p>
                )
              )}
              <details>
                <summary>Details</summary>
                {outcome?.detail && <p>{outcome.detail}</p>}
                <p>
                  Reference: {row.id} · Revision {row.revision}
                </p>
              </details>
            </article>
          );
        })}
      {!!rows?.some((row) => row.status === "CONSUMED") && (
        <details>
          <summary>Started extra attempts</summary>
          {rows
            ?.filter(
              (row) =>
                row.status === "CONSUMED" &&
                !outcomes[row.id] &&
                !requests.has(row.id),
            )
            .map((row) => (
              <p key={row.id}>
                {row.username} · {grantStatus(row)} · Created{" "}
                {chicago(row.issued_at)}
              </p>
            ))}
        </details>
      )}
      <div className="actions">
        {!!remaining.length && (
          <button
            className="danger"
            disabled={busy}
            onClick={() => void cancel()}
          >
            {busy
              ? "Cancelling…"
              : Object.values(outcomes).some((o) => o.state === "unknown")
                ? "Retry cancellation"
                : `Cancel ${remaining.length} extra ${remaining.length === 1 ? "attempt" : "attempts"}`}
          </button>
        )}
        <button disabled={busy} onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
