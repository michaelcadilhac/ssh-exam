import React, { useState } from "react";
import { api, remaining } from "./api.js";
import { Modal } from "./modal.js";
import { isSandbox } from "../../../packages/protocol/sandbox.js";
export type StudentAction = {
  kind: "duration" | "webcam" | "reset" | "extend";
  students: any[];
  attempts: any[];
};
export function StudentActions({
  exam,
  operation: op,
  onClose,
  onDone,
}: {
  exam: any;
  operation: StudentAction;
  onClose: () => void;
  onDone: (text: string) => Promise<void>;
}) {
  const settings = op.kind === "duration" || op.kind === "webcam";
  const first = op.students[0]?.enrollment;
  const [minutes, setMinutes] = useState(
    op.kind === "extend" ? 5 : (first?.duration ?? exam.duration) / 60,
  );
  const [inherit, setInherit] = useState(
      isSandbox(exam.id) || first?.duration == null,
    ),
    [webcam, setWebcam] = useState(
      first?.webcam == null ? "inherit" : first.webcam ? "true" : "false",
    );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [results, setResults] = useState<any[] | null>(null);
  const title = {
    duration: "Set duration",
    webcam: "Set webcam requirement",
    reset: "Reset clock",
    extend: "Extend time",
  }[op.kind];
  return (
    <Modal
      title={title}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          setError("");
          try {
            if (settings) {
              await api(`/admin/exams/${exam.id}/roster/settings`, {
                usernames: op.students.map((s) => s.username),
                ...(op.kind === "duration"
                  ? { duration: inherit ? null : minutes * 60 }
                  : {
                      webcam: webcam === "inherit" ? null : webcam === "true",
                    }),
              });
              await onDone("Future attempt settings updated.");
              onClose();
            } else {
              const r = await api(`/admin/exams/${exam.id}/attempts/clocks`, {
                action: op.kind,
                ...(op.kind === "extend" ? { minutes } : {}),
                targets: op.attempts.map((a) => ({
                  id: a.id,
                  revision: a.clock_revision || 0,
                  requestID: a.requestID,
                })),
              });
              setResults(r.results);
              await onDone(
                "Clock changes requested. Pending changes await agent confirmation.",
              );
              if (r.results.every((r: any) => r.status !== "failed")) onClose();
            }
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="admin-operation-scope">
          <strong>
            {settings
              ? `${op.students.length} ${op.students.length === 1 ? "student" : "students"}`
              : `${op.attempts.length} ${op.attempts.length === 1 ? "attempt" : "attempts"}`}
          </strong>{" "}
          · {settings ? "Future attempts only" : "Current clocks"}
        </p>
        <ul className="admin-target-list">
          {(settings ? op.students : op.attempts).map((a) => (
            <li key={a.id || a.username}>
              <strong>{a.username}</strong>
              {!settings && (
                <span>
                  Attempt {a.attempt_number || 1} · {remaining(a.deadline)}{" "}
                  remaining
                  {op.kind === "reset" ? ` → ${a.allowance} minutes` : ""}
                </span>
              )}
            </li>
          ))}
        </ul>
        {settings && <p>Current attempts keep their existing settings.</p>}
        {op.kind === "duration" && (
          <>
            <label>
              <input
                type="checkbox"
                checked={inherit}
                disabled={busy || isSandbox(exam.id)}
                onChange={(e) => setInherit(e.target.checked)}
              />{" "}
              Use exam default ({exam.duration / 60} minutes)
            </label>
            <label>
              Duration (minutes)
              <input
                type="number"
                min={1}
                max={360}
                step={1}
                required
                disabled={inherit || busy || isSandbox(exam.id)}
                value={minutes}
                onChange={(e) => setMinutes(Number(e.target.value))}
              />
            </label>
            {isSandbox(exam.id) && (
              <p>Sandbox attempts always start with five minutes.</p>
            )}
          </>
        )}
        {op.kind === "webcam" && (
          <label>
            Webcam for future attempts
            <select
              value={webcam}
              disabled={busy}
              onChange={(e) => setWebcam(e.target.value)}
            >
              <option value="inherit">
                Exam default ({exam.webcam ? "required" : "not required"})
              </option>
              <option value="true">Required</option>
              <option value="false">Not required</option>
            </select>
          </label>
        )}
        {op.kind === "reset" && (
          <p>
            Reset each selected clock to that student’s configured allowance, or
            the exam default ({exam.duration / 60} minutes). The countdown
            starts when you apply the reset.
          </p>
        )}
        {op.kind === "extend" && (
          <label>
            Minutes to add
            <input
              type="number"
              required
              min={1}
              max={360}
              step={1}
              value={minutes}
              disabled={busy || !!results}
              onChange={(e) => setMinutes(Number(e.target.value))}
            />
          </label>
        )}
        {!settings && (
          <>
            <p>
              Clock changes do not disconnect students or authorize recovery.
              Changes remain pending until the exam server confirms them.
            </p>
          </>
        )}
        {results && (
          <ul>
            {results.map((r) => (
              <li key={r.id} className={r.status === "failed" ? "warn" : ""}>
                {op.attempts.find((a) => a.id === r.id)?.username}: {r.status}
                {r.error && ` · ${r.error}`}
              </li>
            ))}
          </ul>
        )}
        {error && (
          <p className="warn" role="alert">
            {error}
          </p>
        )}
        <div className="actions">
          <button type="button" disabled={busy} onClick={onClose}>
            {results ? "Close" : "Cancel"}
          </button>
          <button className="primary" disabled={busy}>
            {busy
              ? "Applying…"
              : results
                ? "Retry request"
                : op.kind === "reset"
                  ? "Apply reset"
                  : op.kind === "extend"
                    ? "Apply extension"
                    : "Apply settings"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
