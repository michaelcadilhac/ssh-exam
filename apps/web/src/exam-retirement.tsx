import React, { useEffect, useRef, useState } from "react";
import { api } from "./api.js";
import { Modal } from "./modal.js";

export type RetirementAction = "delete" | "archive" | "unarchive";
export function ExamRetirement({
  exam,
  action,
  onClose,
  onDone,
}: {
  exam: any;
  action: RetirementAction;
  onClose: () => void;
  onDone: (result: any) => Promise<void>;
}) {
  const [review, setReview] = useState<any>(null),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [reason, setReason] = useState("");
  const live = useRef(true),
    intent = useRef({ fingerprint: "", request: "" });
  const load = async () => {
    setLoading(true);
    setError("");
    setReview(null);
    try {
      const result = await api(`/admin/exams/${exam.id}/retirement-preview`, {
        action,
      });
      if (!live.current) return;
      if (result.id !== exam.id || result.action !== action)
        throw Error(
          "This review does not match the exam. Close it and open the intended exam.",
        );
      setReview(result);
    } catch (e) {
      if (live.current) setError((e as Error).message);
    } finally {
      if (live.current) setLoading(false);
    }
  };
  useEffect(() => {
    live.current = true;
    void load();
    return () => {
      live.current = false;
    };
  }, [exam.id, action]);
  const title =
    action === "delete"
      ? "Delete unused exam"
      : action === "archive"
        ? "Archive exam"
        : "Restore archived exam";
  return (
    <Modal
      title={title}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy || loading || !review?.allowed || reason.trim().length < 8)
            return;
          const body = {
              action,
              revision: review.revision,
              review: review.review,
              reason: reason.trim(),
            },
            fingerprint = JSON.stringify(body);
          if (intent.current.fingerprint !== fingerprint)
            intent.current = { fingerprint, request: crypto.randomUUID() };
          setBusy(true);
          setError("");
          try {
            const result = await api(`/admin/exams/${exam.id}/retire`, {
              ...body,
              requestID: intent.current.request,
            });
            if (result.id !== exam.id || result.action !== action)
              throw Error(
                "The result could not be confirmed for this exam. Keep this review open to retry.",
              );
            await onDone(result);
          } catch (e) {
            if (live.current) setError((e as Error).message);
          } finally {
            if (live.current) setBusy(false);
          }
        }}
      >
        <p>
          <strong>{review?.exam?.name || exam.name}</strong> · {exam.id}
        </p>
        {loading ? (
          <p role="status">Checking the exam…</p>
        ) : (
          review && (
            <>
              <p>
                {action === "delete"
                  ? "Permanently delete this unused exam. Audit history is kept."
                  : action === "archive"
                    ? "Hide this exam from the current list. Attempts, saved files, history and access restrictions are kept."
                    : "Show this exam in the current list again. Existing attempts and start windows stay unchanged."}
              </p>
              <dl className="admin-review-summary">
                <dt>Students</dt>
                <dd>{review.counts.enrollments}</dd>
                <dt>Attempts</dt>
                <dd>{review.counts.attempts}</dd>
              </dl>
              <details>
                <summary>Details</summary>
                <dl className="admin-review-summary">
                  <dt>Allowed attempts</dt>
                  <dd>{review.counts.grants}</dd>
                  <dt>Attempt setup records</dt>
                  <dd>{review.counts.claims}</dd>
                  <dt>Saved-work references</dt>
                  <dd>{review.counts.recoverySources}</dd>
                  <dt>Recovery time changes</dt>
                  <dd>{review.counts.allowanceEdits}</dd>
                  <dt>Compatibility records</dt>
                  <dd>{review.counts.modes}</dd>
                  <dt>Reviews</dt>
                  <dd>
                    {review.counts.rosterPreviews + review.counts.grantPreviews}
                  </dd>
                  {review.native && review.native.status !== "not-required" && (
                    <>
                      <dt>Exam server check</dt>
                      <dd>
                        {(
                          {
                            required: "Required",
                            stale: "Needs refresh",
                            verified: "Verified for this review",
                          } as Record<string, string>
                        )[review.native.status] || "Unavailable"}
                      </dd>
                      <dt>Exam server attempts</dt>
                      <dd>{review.native.attempts}</dd>
                      <dt>Earlier permissions</dt>
                      <dd>{review.native.permissions}</dd>
                    </>
                  )}
                </dl>
              </details>
              {!review.allowed && (
                <div role="alert">
                  <p>This action is blocked:</p>
                  <ul>
                    {review.blockers.map((message: string) => (
                      <li key={message}>{message}</li>
                    ))}
                  </ul>
                </div>
              )}
              {review.allowed && (
                <label>
                  Reason
                  <input
                    data-initial-focus
                    required
                    minLength={8}
                    maxLength={1000}
                    value={reason}
                    disabled={busy}
                    onChange={(event) => setReason(event.target.value)}
                  />
                </label>
              )}
            </>
          )
        )}
        {error && (
          <div role="alert">
            <p>{error}</p>
            {intent.current.request && (
              <>
                <p>Keep this review open to retry the same request.</p>
                <details>
                  <summary>Details</summary>
                  <p>
                    Reference: <code>{intent.current.request}</code>
                  </p>
                </details>
              </>
            )}
          </div>
        )}
        <div className="modal-actions">
          <button type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || loading}
            onClick={() => void load()}
          >
            Refresh
          </button>
          <button
            className={action === "delete" ? "danger" : "primary"}
            disabled={
              busy || loading || !review?.allowed || reason.trim().length < 8
            }
          >
            {busy
              ? "Saving…"
              : action === "delete"
                ? "Delete unused exam"
                : action === "archive"
                  ? "Archive exam"
                  : "Restore exam"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
