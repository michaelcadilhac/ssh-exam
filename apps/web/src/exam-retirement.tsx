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
          "Exam review changed target; close this dialog and inspect the intended exam.",
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
                "Retirement outcome did not match this exam. Preserve the request and inspect current state before another action.",
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
          <p role="status">Loading current exam and dependencies…</p>
        ) : (
          review && (
            <>
              <p>
                {action === "delete"
                  ? "Permanently remove this unused definition. Audit and request history remain."
                  : action === "archive"
                    ? "Hide this definition from the current exam list. Preserve all student history, grants, submissions and restrictions."
                    : "Restore this definition to the current exam list. Completed attempts and elapsed Begin windows stay unchanged."}
              </p>
              <dl className="admin-review-summary">
                <dt>Roster records</dt>
                <dd>{review.counts.enrollments}</dd>
                <dt>Attempt records</dt>
                <dd>{review.counts.attempts}</dd>
                <dt>Grant records</dt>
                <dd>{review.counts.grants}</dd>
                <dt>Grant claims</dt>
                <dd>{review.counts.claims}</dd>
                <dt>Saved-work expectations</dt>
                <dd>{review.counts.recoverySources}</dd>
                <dt>Allowance authorizations</dt>
                <dd>{review.counts.allowanceEdits}</dd>
                <dt>Retained grant modes</dt>
                <dd>{review.counts.modes}</dd>
                <dt>Import and grant reviews</dt>
                <dd>
                  {review.counts.rosterPreviews + review.counts.grantPreviews}
                </dd>
                {review.native && review.native.status !== "not-required" && (
                  <>
                    <dt>Class-server check</dt>
                    <dd>
                      {(
                        {
                          required: "Required",
                          stale: "Needs refresh",
                          verified: "Verified for this review",
                        } as Record<string, string>
                      )[review.native.status] || "Unavailable"}
                    </dd>
                    <dt>Native attempt records</dt>
                    <dd>{review.native.attempts}</dd>
                    <dt>Legacy permission records</dt>
                    <dd>{review.native.permissions}</dd>
                  </>
                )}
              </dl>
              {!review.allowed && (
                <div role="alert">
                  <p>This action is unavailable:</p>
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
              <p>
                Keep this review open to retry the same request:{" "}
                <code>{intent.current.request}</code>.
              </p>
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
            Refresh review
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
                ? "Delete unused definition"
                : action === "archive"
                  ? "Archive definition"
                  : "Restore definition"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
