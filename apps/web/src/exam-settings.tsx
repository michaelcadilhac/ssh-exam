import React, { useState, useRef } from "react";
import { api } from "./api.js";
import { Modal } from "./modal.js";
import { TemplatePicker } from "./template-picker.js";
import { LocalDateTimeInput } from "./local-date-time-input.js";
import {
  deviceTimeZone,
  localDateTime,
  localOccurrence,
  parseLocalDateTime,
  timeLimit,
} from "./local-date-time.js";
import {
  isSandbox,
  hasSandboxWindow,
} from "../../../packages/protocol/sandbox.js";
import {
  DEFAULT_COLLECTION_FILE_MIB,
  DEFAULT_COLLECTION_TOTAL_MIB,
  MAX_COLLECTION_FILE_MIB,
  MAX_COLLECTION_TOTAL_MIB,
} from "../../../packages/protocol/collection-limits.js";
export function ExamSettings({
  initial,
  onClose,
  onSaved,
}: {
  initial: any;
  onClose: () => void;
  onSaved: (exam: any) => void;
}) {
  const { lifecycle: _lifecycle, ...editableInitial } = initial;
  const [form, setForm] = useState({
    id: "",
    name: "Programming exam",
    template: "sample-exam",
    template_version: "",
    duration: 5400,
    webcam: true,
    terminals: 4,
    collection_file_mib: DEFAULT_COLLECTION_FILE_MIB,
    collection_total_mib: DEFAULT_COLLECTION_TOTAL_MIB,
    earliest: Date.now() - 60000,
    latest: Date.now() + 7 * 86400000,
    ...editableInitial,
    ...(isSandbox(initial.id) && !hasSandboxWindow(initial)
      ? { earliest: NaN, latest: NaN }
      : {}),
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [durationDraft, setDurationDraft] = useState(
      initial.id && !Number.isInteger(initial.duration / 60)
        ? ""
        : String((initial.duration ?? 5400) / 60),
    ),
    [earliestDraft, setEarliestDraft] = useState(
      localDateTime(form.earliest, "exact"),
    ),
    [latestDraft, setLatestDraft] = useState(
      localDateTime(form.latest, "exact"),
    );
  const [earliestOccurrence, setEarliestOccurrence] = useState(
      localOccurrence(form.earliest, "exact"),
    ),
    [latestOccurrence, setLatestOccurrence] = useState(
      localOccurrence(form.latest, "exact"),
    );
  const intent = useRef({ fingerprint: "", requestID: "" });
  return (
    <Modal
      title={initial.id ? "Exam defaults" : "New exam"}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        className="admin-exam-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          setError("");
          try {
            const changes = {
              ...form,
              earliest:
                Number.isFinite(form.earliest) &&
                earliestDraft === localDateTime(form.earliest, "exact") &&
                earliestOccurrence === localOccurrence(form.earliest, "exact")
                  ? form.earliest
                  : parseLocalDateTime(
                      earliestDraft,
                      earliestOccurrence,
                      "exact",
                    ),
              latest:
                Number.isFinite(form.latest) &&
                latestDraft === localDateTime(form.latest, "exact") &&
                latestOccurrence === localOccurrence(form.latest, "exact")
                  ? form.latest
                  : parseLocalDateTime(latestDraft, latestOccurrence, "exact"),
            };
            if (changes.latest <= changes.earliest)
              throw Error("Latest start must be after earliest start.");
            const fingerprint = JSON.stringify(changes);
            if (intent.current.fingerprint !== fingerprint)
              intent.current = { fingerprint, requestID: crypto.randomUUID() };
            const result = await api(
              form.template_version ? "/admin/exams/versioned" : "/admin/exams",
              {
                ...changes,
                requestID: intent.current.requestID,
              },
            );
            onSaved(result);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="admin-form-grid">
          <label>
            Exam ID
            <input
              required
              value={form.id}
              disabled={!!initial.id || busy}
              pattern="[a-zA-Z0-9_\-]{1,64}"
              onChange={(e) => setForm({ ...form, id: e.target.value })}
            />
          </label>
          <label>
            Name
            <input
              required
              maxLength={120}
              disabled={busy}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
        </div>
        <TemplatePicker
          label="Exam files"
          name={form.template}
          hash={form.template_version ?? ""}
          disabled={busy}
          onChange={(template, template_version) =>
            setForm({ ...form, template, template_version })
          }
        />
        <fieldset className="admin-form-group">
          <legend>{initial.id ? "Default start dates" : "Start window"}</legend>
          <div className="admin-form-grid">
            <LocalDateTimeInput
              label="Opens"
              precision="exact"
              value={earliestDraft}
              onChange={setEarliestDraft}
              occurrence={earliestOccurrence}
              onOccurrence={setEarliestOccurrence}
              disabled={busy}
            />
            <LocalDateTimeInput
              label="Closes"
              precision="exact"
              value={latestDraft}
              onChange={setLatestDraft}
              occurrence={latestOccurrence}
              onOccurrence={setLatestOccurrence}
              disabled={busy}
            />
          </div>
          <small>
            Times in {deviceTimeZone()}. Students may start between these times.
          </small>
        </fieldset>
        {isSandbox(form.id) && (
          <p>Practice: 5 minutes, no webcam, 4 terminals.</p>
        )}
        <div className="admin-form-grid">
          <label>
            Time limit (minutes)
            <input
              required={!initial.id || Number.isInteger(initial.duration / 60)}
              type="number"
              min={1}
              max={360}
              disabled={busy || isSandbox(form.id)}
              value={isSandbox(form.id) ? 5 : durationDraft}
              placeholder={
                initial.id ? `Keep ${timeLimit(initial.duration)}` : "90"
              }
              onChange={(e) => {
                setDurationDraft(e.target.value);
                setForm({
                  ...form,
                  duration:
                    e.target.value === "" && initial.id
                      ? initial.duration
                      : Number(e.target.value) * 60,
                });
              }}
            />
          </label>
          <label>
            Terminal limit
            <input
              required
              type="number"
              min={1}
              max={4}
              disabled={busy || isSandbox(form.id)}
              value={form.terminals}
              onChange={(e) =>
                setForm({ ...form, terminals: Number(e.target.value) })
              }
            />
          </label>
        </div>
        <label>
          <input
            type="checkbox"
            disabled={busy || isSandbox(form.id)}
            checked={isSandbox(form.id) ? false : form.webcam}
            onChange={(e) => setForm({ ...form, webcam: e.target.checked })}
          />{" "}
          Default webcam requirement
        </label>
        <details>
          <summary>File limits</summary>
          <fieldset className="admin-form-group">
            <legend>File limits</legend>
            <div className="admin-form-grid">
              <label>
                Maximum file size (MiB)
                <input
                  required
                  type="number"
                  min={1}
                  max={MAX_COLLECTION_FILE_MIB}
                  disabled={busy}
                  value={form.collection_file_mib}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      collection_file_mib: Number(e.target.value),
                    })
                  }
                />
              </label>
              <label>
                Maximum total size (MiB)
                <input
                  required
                  type="number"
                  min={form.collection_file_mib}
                  max={MAX_COLLECTION_TOTAL_MIB}
                  disabled={busy}
                  value={form.collection_total_mib}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      collection_total_mib: Number(e.target.value),
                    })
                  }
                />
              </label>
            </div>
          </fieldset>
        </details>
        {initial.id && (
          <p>
            Used for new attempts unless you choose different settings. Existing
            allowed attempts keep their saved settings.
          </p>
        )}
        {error && (
          <p role="alert" className="warn">
            {error}
          </p>
        )}
        <div className="actions">
          <button type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button disabled={busy} className="primary">
            {busy ? "Saving…" : initial.id ? "Save defaults" : "Save exam"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
