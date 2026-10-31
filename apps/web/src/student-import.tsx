import React, { useState } from "react";
import { api } from "./api.js";
import { Modal } from "./modal.js";
import { isSandbox } from "../../../packages/protocol/sandbox.js";
import { LocalDateTimeInput } from "./local-date-time-input.js";
import {
  deviceTimeZone,
  localDateTime,
  localOccurrence,
  parseLocalDateTime,
  timeLimit,
} from "./local-date-time.js";
export function StudentImport({
  exam,
  defaultWebcam = false,
  defaultDuration = 5400,
  defaultEarliest,
  defaultLatest,
  defaultRevision,
  onClose,
  onDone,
}: {
  exam: string;
  defaultWebcam?: boolean;
  defaultDuration?: number;
  defaultEarliest: number;
  defaultLatest: number;
  defaultRevision?: string;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [defaults] = useState(() => ({
    webcam: defaultWebcam,
    duration: defaultDuration,
    earliest: defaultEarliest,
    latest: defaultLatest,
    revision: defaultRevision,
  }));
  const [method, setMethod] = useState<"single" | "csv">("single");
  const [preview, setPreview] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [username, setUsername] = useState(""),
    [webcam, setWebcam] = useState("inherit"),
    [inherit, setInherit] = useState(true),
    [duration, setDuration] = useState(defaults.duration / 60),
    [csv, setCsv] = useState<{ name: string; text: string } | null>(null),
    [opens, setOpens] = useState(() =>
      localDateTime(defaults.earliest, "exact"),
    ),
    [closes, setCloses] = useState(() =>
      localDateTime(defaults.latest, "exact"),
    ),
    [openOccurrence, setOpenOccurrence] = useState(() =>
      localOccurrence(defaults.earliest, "exact"),
    ),
    [closeOccurrence, setCloseOccurrence] = useState(() =>
      localOccurrence(defaults.latest, "exact"),
    );
  const clearPreview = () => {
    setPreview(null);
    setError("");
  };
  const firstAttemptDates = () => {
    if (isSandbox(exam)) return {};
    const earliest = parseLocalDateTime(opens, openOccurrence, "exact"),
      latest = parseLocalDateTime(closes, closeOccurrence, "exact");
    if (latest <= earliest) throw Error("Closes must be after Opens.");
    return { earliest, latest };
  };
  const reviewCsv = async (text: string) => {
    setPreview(null);
    setPreview(
      await api(`/admin/exams/${exam}/roster/import-preview`, {
        text,
        mode: "csv",
        ...firstAttemptDates(),
      }),
    );
  };
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
      {isSandbox(exam) ? (
        <p>Practice dates come from Exam defaults.</p>
      ) : (
        <fieldset className="admin-form-group" disabled={busy}>
          <legend>First attempt start dates</legend>
          <div className="admin-form-grid">
            <LocalDateTimeInput
              label="Opens"
              precision="exact"
              value={opens}
              occurrence={openOccurrence}
              disabled={busy}
              onChange={(value) => {
                setOpens(value);
                clearPreview();
              }}
              onOccurrence={(value) => {
                setOpenOccurrence(value);
                clearPreview();
              }}
            />
            <LocalDateTimeInput
              label="Closes"
              precision="exact"
              value={closes}
              occurrence={closeOccurrence}
              disabled={busy}
              onChange={(value) => {
                setCloses(value);
                clearPreview();
              }}
              onOccurrence={(value) => {
                setCloseOccurrence(value);
                clearPreview();
              }}
            />
          </div>
          <small>
            These dates apply only to new first attempts. Times in{" "}
            {deviceTimeZone()}.
          </small>
        </fieldset>
      )}
      {method === "single" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await api(`/admin/exams/${exam}/roster/add`, {
                username,
                webcam: webcam === "inherit" ? null : webcam === "true",
                duration: inherit ? null : duration * 60,
                ...firstAttemptDates(),
                definition_revision: defaults.revision,
              });
              await onDone();
            });
          }}
        >
          <label>
            Username
            <input
              required
              disabled={busy}
              pattern="[a-zA-Z][a-zA-Z0-9_\-]{0,31}"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <label>
            Webcam
            <select
              disabled={busy}
              value={webcam}
              onChange={(e) => setWebcam(e.target.value)}
            >
              <option value="inherit">
                Exam default ({defaults.webcam ? "required" : "optional"})
              </option>
              <option value="true">Required</option>
              <option value="false">Optional</option>
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={inherit}
              disabled={busy || isSandbox(exam)}
              onChange={(e) => setInherit(e.target.checked)}
            />{" "}
            Use exam time limit ({timeLimit(defaults.duration)})
          </label>
          <label>
            Time limit (minutes)
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
          <p>Use an existing exam-server account.</p>
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
            with usernames and optional time limits or webcam settings.
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
                setCsv(null);
                if (!file) return;
                void run(async () => {
                  if (file.size > 10 * 1024 * 1024)
                    throw Error("File exceeds 10 MiB");
                  const text = await file.text();
                  setCsv({ name: file.name, text });
                  await reviewCsv(text);
                });
              }}
            />
          </label>
          {csv && !preview && (
            <div className="actions">
              <span>{csv.name}</span>
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(() => reviewCsv(csv.text))}
              >
                Review CSV
              </button>
            </div>
          )}
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
                .
              </p>
              <div className="preview" aria-label="Import preview">
                {preview.rows.slice(0, 100).map((r: any) => (
                  <p key={r.username}>
                    {r.action}: {r.username} · time limit{" "}
                    {r.duration === undefined && r.action !== "add"
                      ? "unchanged"
                      : r.duration == null
                        ? Number.isFinite(preview.defaults?.duration)
                          ? `${timeLimit(preview.defaults.duration)} (exam default)`
                          : "exam default"
                        : timeLimit(r.duration)}{" "}
                    · webcam{" "}
                    {r.webcam === undefined && r.action !== "add"
                      ? "unchanged"
                      : r.webcam == null
                        ? typeof preview.defaults?.webcam === "boolean"
                          ? `${preview.defaults.webcam ? "required" : "optional"} (exam default)`
                          : "exam default"
                        : r.webcam
                          ? "required"
                          : "optional"}
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
                  try {
                    await api(`/admin/exams/${exam}/roster/import-confirm`, {
                      id: preview.id,
                    });
                  } catch (e) {
                    if (
                      (e as Error & { code?: string })?.code ===
                      "ROSTER_REVIEW_REQUIRED"
                    )
                      setPreview(null);
                    throw e;
                  }
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
