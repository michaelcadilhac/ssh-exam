import React, { useEffect, useRef, useState } from "react";
import { api } from "./api.js";
import { isSandbox } from "../../../packages/protocol/sandbox.js";
import { timeLimit } from "./local-date-time.js";

export function EnrollmentSetting({
  exam,
  student,
  kind,
  disabled,
  onSaved,
}: {
  exam: any;
  student: any;
  kind: "duration" | "webcam";
  disabled: boolean;
  onSaved: () => Promise<void>;
}) {
  const value = student.enrollment[kind] ?? null;
  const [confirmed, setConfirmed] = useState(value),
    [editing, setEditing] = useState(false),
    [draft, setDraft] = useState(""),
    [inherit, setInherit] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const trigger = useRef<HTMLButtonElement>(null),
    control = useRef<HTMLInputElement | HTMLSelectElement | null>(null),
    inheritControl = useRef<HTMLInputElement | null>(null),
    mounted = useRef(true);
  useEffect(() => setConfirmed(value), [value]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!editing) return;
    if (kind === "duration" && inherit) {
      inheritControl.current?.focus();
      return;
    }
    control.current?.focus();
    if (control.current instanceof HTMLInputElement) control.current.select();
  }, [editing]);
  const name =
    kind === "duration" ? "future time limit" : "future webcam setting";
  const effective = confirmed ?? exam[kind];
  const text =
    kind === "duration"
      ? `Default: ${timeLimit(Number(effective))}`
      : effective
        ? "Webcam default: Required"
        : "Webcam default: Optional";
  const locked = kind === "duration" && isSandbox(exam.id);
  const close = () => {
    setEditing(false);
    setError("");
    requestAnimationFrame(() => {
      if (mounted.current) trigger.current?.focus();
    });
  };
  return (
    <div className="enrollment-setting">
      {!editing ? (
        <>
          <button
            ref={trigger}
            type="button"
            className="setting-value"
            aria-label={`Edit ${name} for ${student.username}`}
            disabled={disabled || locked}
            title={
              locked
                ? "Sandbox time limit is fixed at five minutes"
                : `Edit ${name}`
            }
            onClick={() => {
              setDraft(
                kind === "duration"
                  ? String(Number(effective) / 60)
                  : confirmed == null
                    ? "inherit"
                    : confirmed
                      ? "true"
                      : "false",
              );
              setInherit(confirmed == null);
              setEditing(true);
            }}
          >
            {text}
          </button>
          {confirmed == null && <small>Exam default</small>}
        </>
      ) : (
        <form
          className="setting-editor"
          aria-label={`Edit ${name} for ${student.username}`}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              if (!busy) close();
            }
          }}
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy || disabled) return;
            const next =
              kind === "duration"
                ? inherit
                  ? null
                  : Number(draft) * 60
                : draft === "inherit"
                  ? null
                  : draft === "true";
            setBusy(true);
            setError("");
            try {
              await api(`/admin/exams/${exam.id}/roster/settings`, {
                usernames: [student.username],
                [kind]: next,
              });
              if (!mounted.current) return;
              setConfirmed(next);
              close();
              void onSaved();
            } catch (e) {
              if (mounted.current) setError((e as Error).message);
            } finally {
              if (mounted.current) setBusy(false);
            }
          }}
        >
          {kind === "duration" ? (
            <>
              <label>
                Minutes
                <input
                  ref={(el) => {
                    control.current = el;
                  }}
                  type="number"
                  min={1}
                  max={360}
                  step={1}
                  required
                  value={draft}
                  disabled={disabled || busy || inherit}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    setInherit(false);
                  }}
                />
              </label>
              <label className="setting-inherit">
                <input
                  type="checkbox"
                  ref={inheritControl}
                  checked={inherit}
                  disabled={disabled || busy}
                  onChange={(e) => {
                    setInherit(e.target.checked);
                    if (e.target.checked) setDraft(String(exam.duration / 60));
                    if (!e.target.checked)
                      requestAnimationFrame(() => control.current?.focus());
                  }}
                />
                Exam default ({timeLimit(exam.duration)})
              </label>
            </>
          ) : (
            <label>
              Webcam
              <select
                ref={(el) => {
                  control.current = el;
                }}
                value={draft}
                disabled={disabled || busy}
                onChange={(e) => setDraft(e.target.value)}
              >
                <option value="inherit">
                  Exam default ({exam.webcam ? "required" : "optional"})
                </option>
                <option value="true">Required</option>
                <option value="false">Optional</option>
              </select>
            </label>
          )}
          <small>
            Started attempts keep their settings.
            {student.grant && " Change unused attempts separately."}
            {kind === "duration" &&
              " For older unused recovery attempts, saving this time limit also authorizes updates at the student's next setup. Changing exam defaults does not."}
          </small>
          {error && (
            <span className="warn" role="alert">
              {error}
            </span>
          )}
          <div className="setting-editor-actions">
            <button type="submit" disabled={disabled || busy}>
              {busy ? "Saving…" : "Save"}
            </button>
            <button type="button" disabled={busy} onClick={close}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
