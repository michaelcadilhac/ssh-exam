import { useState } from "react";
import { api, chicago } from "./api.js";
import { Modal } from "./modal.js";
import { beginTime } from "./attempt-grants.js";

export function GrantIssuanceDialog({
  initial,
  onClose,
  onChanged,
}: {
  initial: any;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [definition, setDefinition] = useState(initial),
    [usernames, setUsernames] = useState(""),
    [earliest, setEarliest] = useState(
      new Date(initial.earliest).toISOString(),
    ),
    [latest, setLatest] = useState(new Date(initial.latest).toISOString()),
    [reason, setReason] = useState(""),
    [review, setReview] = useState<any>(null),
    [previewID, setPreviewID] = useState(""),
    [pending, setPending] = useState<{
      operation: string;
      path: string;
      body: any;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const perform = async (operation: "preview" | "confirm" | "cancel") => {
    if (busy) return;
    setError("");
    try {
      if (!pending && operation === "preview") {
        const names = usernames
          .trim()
          .split(/[\s,]+/)
          .filter(Boolean);
        if (
          !names.length ||
          names.length > 200 ||
          new Set(names).size !== names.length ||
          names.some((n) => !/^[a-zA-Z][a-zA-Z0-9_-]{0,31}$/.test(n))
        )
          throw Error(
            "Name 1..200 valid enrolled students, each once, to preview NEW grants",
          );
        if (reason.trim().length < 8 || reason.length > 1000)
          throw Error(
            "Give a concrete 8..1000 character reason for NEW issuance",
          );
        if (beginTime(latest) <= beginTime(earliest))
          throw Error(
            "Latest Begin must be after earliest Begin; use an explicit finite window",
          );
      }
      const intent =
        pending ??
        (operation === "preview"
          ? {
              operation,
              path: `/admin/exams/${encodeURIComponent(definition.id)}/grants/issue-preview`,
              body: {
                definition_revision: definition.revision,
                template_version: definition.template_version,
                earliest: beginTime(earliest),
                latest: beginTime(latest),
                usernames: usernames
                  .trim()
                  .split(/[\s,]+/)
                  .filter(Boolean),
                reason,
                request: crypto.randomUUID(),
              },
            }
          : {
              operation,
              path: `/admin/grant-issuance/${review.id}/${operation}`,
              body: { revision: review.revision, request: crypto.randomUUID() },
            });
      setPending(intent);
      setBusy(true);
      const result = await api(intent.path, intent.body);
      setReview(result);
      setPreviewID(result.id);
      setPending(null);
      if (result.status === "CONFIRMED") await onChanged();
    } catch (e) {
      if ([400, 403, 409].includes((e as any).status)) setPending(null);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const inspect = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await api(
        `/admin/grant-issuance/${encodeURIComponent(previewID.trim())}`,
      );
      if (result.exam !== initial.id)
        throw Error(
          "This review belongs to another exam; select that exam to inspect it",
        );
      setReview(result);
      setPending(null);
      if (result.status === "CONFIRMED") await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const reload = async () => {
    setBusy(true);
    setError("");
    try {
      const exams = await api("/admin/exams"),
        current = exams.find((e: any) => e.id === initial.id);
      if (!current)
        throw Error("Exam definition unavailable; inspect the selected exam");
      setDefinition(current);
      setEarliest(new Date(current.earliest).toISOString());
      setLatest(new Date(current.latest).toISOString());
      setReview(null);
      setPending(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const close = () => {
    if (!busy) onClose();
  };
  return (
    <Modal title="Issue legacy grants" onClose={close} wide>
      <p>
        Create NEW initial grants for enrolled students with no grant or attempt
        history. These use selected current settings; they do not reconstruct
        historical enrollment settings. Preview reserves no account or
        allowance.
      </p>
      <p>
        Exam: {definition.name} · {definition.id}. Current materials/starter:{" "}
        {definition.template}
      </p>
      <p style={{ overflowWrap: "anywhere" }}>
        Selected exact source:{" "}
        {definition.template_version ||
          "Choose an exact attested version in Exam settings first"}
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!review && (
        <fieldset disabled={busy || !!pending}>
          <label>
            Legacy unused students (one per line, up to200)
            <textarea
              aria-label="Legacy unused students"
              value={usernames}
              onChange={(e) => setUsernames(e.target.value)}
              rows={4}
            />
          </label>
          <label>
            Earliest Begin (RFC3339 with zone)
            <input
              value={earliest}
              onChange={(e) => setEarliest(e.target.value)}
            />
          </label>
          <label>
            Latest Begin (RFC3339 with zone)
            <input value={latest} onChange={(e) => setLatest(e.target.value)} />
          </label>
          <label>
            Reason for NEW issuance
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
            />
          </label>
          <p>
            Each student's current effective allowance and webcam requirement
            will be shown for review. The chosen Begin window can be outside the
            exam defaults.
          </p>
        </fieldset>
      )}
      {review && (
        <section aria-label="Reviewed new grants">
          <p>
            Status: <strong>{review.status}</strong> · Review expires{" "}
            {chicago(review.expires)}
          </p>
          <p style={{ overflowWrap: "anywhere" }}>Review ID: {review.id}</p>
          <p>{review.reason}</p>
          {review.rows.map((row: any) => (
            <article key={row.username}>
              <h3>{row.username}</h3>
              <p>
                {row.settings.name} · {row.settings.duration / 60} minutes ·
                Webcam {row.settings.webcam ? "required" : "not required"} ·{" "}
                {row.settings.terminals} terminals
              </p>
              <p>
                Begin from {new Date(row.settings.earliest).toISOString()} until{" "}
                {new Date(row.settings.latest).toISOString()}. Full allowance
                starts only at actual Begin.
              </p>
              <p>
                Collection: {row.settings.collection_file_mib} MiB per file,{" "}
                {row.settings.collection_total_mib} MiB total.
              </p>
              <p style={{ overflowWrap: "anywhere" }}>
                Materials/starter: {row.work.name} · {row.work.hash}
              </p>
              {review.issued.find((g: any) => g.username === row.username) && (
                <p style={{ overflowWrap: "anywhere" }}>
                  Issued grant:{" "}
                  {
                    review.issued.find((g: any) => g.username === row.username)
                      .grant
                  }
                </p>
              )}
            </article>
          ))}
          <p>
            Native saved-work authorizations remain protected and may prevent
            preparation. This review does not convert them or bypass account
            restrictions.
          </p>
        </section>
      )}
      <div className="actions">
        {pending ? (
          <button
            disabled={busy}
            onClick={() =>
              void perform(
                pending.operation as "preview" | "confirm" | "cancel",
              )
            }
          >
            Retry {pending.operation}
          </button>
        ) : review?.status === "REVIEW" ? (
          <>
            <button
              className="primary"
              disabled={busy}
              onClick={() => void perform("confirm")}
            >
              Confirm NEW grants
            </button>
            <button disabled={busy} onClick={() => void perform("cancel")}>
              Cancel review
            </button>
          </>
        ) : !review ? (
          <button
            className="primary"
            disabled={busy || !definition.template_version}
            onClick={() => void perform("preview")}
          >
            Preview NEW grants
          </button>
        ) : null}
        {!pending && (
          <button disabled={busy} onClick={() => void reload()}>
            Reload current settings
          </button>
        )}
        <button disabled={busy} onClick={close}>
          Close
        </button>
      </div>
      <label>
        Saved review ID
        <input
          value={previewID}
          onChange={(e) => setPreviewID(e.target.value)}
          disabled={busy || pending?.operation === "preview"}
        />
      </label>
      <button
        disabled={busy || !previewID.trim() || pending?.operation === "preview"}
        onClick={() => void inspect()}
      >
        Inspect saved review
      </button>
    </Modal>
  );
}
