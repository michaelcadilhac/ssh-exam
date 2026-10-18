import React, { useState } from "react";
import { api } from "./api.js";
import { Modal } from "./modal.js";
import { isSandbox } from "../../../packages/protocol/sandbox.js";
export function StudentImport({
  exam,
  defaultWebcam = false,
  defaultDuration = 5400,
  onClose,
  onDone,
}: {
  exam: string;
  defaultWebcam?: boolean;
  defaultDuration?: number;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [method, setMethod] = useState<"single" | "csv">("single");
  const [preview, setPreview] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [username, setUsername] = useState(""),
    [webcam, setWebcam] = useState("inherit"),
    [inherit, setInherit] = useState(true),
    [duration, setDuration] = useState(defaultDuration / 60);
  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title="Add students"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div
        className="actions enrollment-method"
        role="group"
        aria-label="Add students using"
      >
        {(
          [
            ["single", "One student"],
            ["csv", "CSV file"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={method === value}
            disabled={busy}
            onClick={() => {
              if (method !== value) {
                setMethod(value);
                setError("");
                setPreview(null);
              }
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {method === "single" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await api(`/admin/exams/${exam}/roster/add`, {
                username,
                webcam: webcam === "inherit" ? null : webcam === "true",
                duration: inherit ? null : duration * 60,
              });
              await onDone();
            });
          }}
        >
          <label>
            Student username
            <input
              required
              disabled={busy}
              pattern="[a-zA-Z][a-zA-Z0-9_\-]{0,31}"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <label>
            Webcam for this student
            <select
              disabled={busy}
              value={webcam}
              onChange={(e) => setWebcam(e.target.value)}
            >
              <option value="inherit">
                Exam default ({defaultWebcam ? "required" : "not required"})
              </option>
              <option value="true">Required</option>
              <option value="false">Not required</option>
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={inherit}
              disabled={busy || isSandbox(exam)}
              onChange={(e) => setInherit(e.target.checked)}
            />{" "}
            Use exam duration ({defaultDuration / 60} minutes)
          </label>
          <label>
            Duration (minutes)
            <input
              type="number"
              min={1}
              max={360}
              step={1}
              required
              disabled={busy || inherit || isSandbox(exam)}
              value={duration}
              onChange={(e) => setDuration(Number(e.target.value))}
            />
          </label>
          <p>Use an existing course-server account.</p>
          {error && (
            <p className="warn" role="alert">
              {error}
            </p>
          )}
          <div className="actions">
            <button type="button" disabled={busy} onClick={onClose}>
              Cancel
            </button>
            <button className="primary" disabled={busy}>
              Add student
            </button>
          </div>
        </form>
      ) : (
        <>
          <p>
            <a href={`/api/admin/exams/${exam}/roster/example`}>
              Download example CSV
            </a>{" "}
            and replace the example usernames with course-server accounts.
            Optional duration and webcam settings apply to future attempts.
          </p>
          <label>
            CSV file
            <input
              type="file"
              disabled={busy}
              accept=".csv,text/csv"
              onChange={(e) => {
                const file = e.target.files?.[0];
                setPreview(null);
                setError("");
                if (!file) return;
                void run(async () => {
                  if (file.size > 10 * 1024 * 1024)
                    throw Error("File exceeds 10 MiB");
                  const text = await file.text();
                  setPreview(
                    await api(`/admin/exams/${exam}/roster/import-preview`, {
                      text,
                      mode: "csv",
                    }),
                  );
                });
              }}
            />
          </label>
          {busy && !preview && <p role="status">Checking CSV…</p>}
          {error && (
            <p className="warn" role="alert">
              {error}
            </p>
          )}
          {preview && (
            <>
              <p role="status">
                {preview.total} validated {preview.total === 1 ? "row" : "rows"}
                . Current attempts are unchanged.
              </p>
              <div className="preview" aria-label="Import preview">
                {preview.rows.slice(0, 100).map((r: any) => (
                  <p key={r.username}>
                    {r.action}: {r.username} · duration{" "}
                    {r.duration === undefined
                      ? "unchanged"
                      : r.duration === null
                        ? "exam default"
                        : `${r.duration / 60} minutes`}{" "}
                    · webcam{" "}
                    {r.webcam === undefined
                      ? "unchanged"
                      : r.webcam === null
                        ? "exam default"
                        : r.webcam
                          ? "required"
                          : "not required"}
                  </p>
                ))}
              </div>
            </>
          )}
          <div className="actions">
            <button type="button" disabled={busy} onClick={onClose}>
              Cancel
            </button>
            <button
              className="primary"
              disabled={busy || !preview}
              onClick={() =>
                void run(async () => {
                  await api(`/admin/exams/${exam}/roster/import-confirm`, {
                    id: preview.id,
                  });
                  await onDone();
                })
              }
            >
              Confirm import
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
