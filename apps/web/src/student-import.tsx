import React, { useState } from "react";
import { api } from "./api.js";
import { Modal } from "./modal.js";
import { isSandbox } from "../../../packages/protocol/sandbox.js";
export function StudentImport({
  exam,
  adding = false,
  defaultWebcam = false,
  defaultDuration = 5400,
  onClose,
  onDone,
}: {
  exam: string;
  adding?: boolean;
  defaultWebcam?: boolean;
  defaultDuration?: number;
  onClose?: () => void;
  onDone: () => Promise<void>;
}) {
  const [csv, setCsv] = useState(
      "username,display_name,duration_minutes,require_webcam\n",
    ),
    [mode, setMode] = useState("csv");
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
  if (adding)
    return (
      <Modal
        title="Add student"
        onClose={() => {
          if (!busy) onClose?.();
        }}
      >
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
              pattern="[a-z][a-z0-9_\-]{0,31}"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <label>
            Webcam for this student
            <select value={webcam} onChange={(e) => setWebcam(e.target.value)}>
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
              disabled={isSandbox(exam)}
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
              disabled={inherit || isSandbox(exam)}
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
      </Modal>
    );
  return (
    <section className="card">
      <details className="bulk-import">
        <summary>Import multiple students (CSV)</summary>
        <p>
          Enrollment settings only: username, display_name, duration_minutes,
          require_webcam. Omitted columns stay unchanged; empty duration/webcam
          uses the exam default. Current attempts stay unchanged. Use the
          table’s bulk actions to reset or extend clocks.
        </p>
        <label>
          Import format
          <select
            disabled={busy}
            value={mode}
            onChange={(e) => {
              setMode(e.target.value);
              setPreview(null);
            }}
          >
            <option value="csv">CSV with headers</option>
            <option value="lines">One username per line</option>
          </select>
        </label>
        <input
          aria-label="Upload CSV file"
          type="file"
          disabled={busy}
          accept=".csv,text/csv"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            if (f.size > 10485760) {
              setError("File exceeds 10 MiB");
              return;
            }
            void f
              .text()
              .then((text) => {
                setCsv(text);
                setPreview(null);
              })
              .catch(() => setError("Unable to read CSV file"));
          }}
        />
        <textarea
          className="csv"
          aria-label="Roster CSV"
          disabled={busy}
          value={csv}
          onChange={(e) => {
            setCsv(e.target.value);
            setPreview(null);
          }}
        />
        <div className="actions">
          <button
            disabled={busy}
            onClick={() =>
              run(async () => {
                setPreview(
                  await api(`/admin/exams/${exam}/roster/import-preview`, {
                    text: csv,
                    mode,
                  }),
                );
              })
            }
          >
            Validate & preview
          </button>
          <a className="button" href={`/api/admin/exams/${exam}/roster/export`}>
            Export roster / template
          </a>
        </div>
        {error && (
          <p className="warn" role="alert">
            {error}
          </p>
        )}
        {preview && (
          <>
            <p>
              {preview.total} validated rows. Current attempts are unchanged.
            </p>
            <div className="preview">
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
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await api(`/admin/exams/${exam}/roster/import-confirm`, {
                    id: preview.id,
                  });
                  setPreview(null);
                  await onDone();
                })
              }
            >
              Confirm import
            </button>
          </>
        )}
      </details>
    </section>
  );
}
