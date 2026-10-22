import React, { useState, useRef } from "react";
import { api } from "./api.js";
import { Modal } from "./modal.js";
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
  const [form, setForm] = useState({
    id: "",
    name: "Programming exam",
    template: "sample-exam",
    duration: 5400,
    webcam: true,
    terminals: 4,
    collection_file_mib: DEFAULT_COLLECTION_FILE_MIB,
    collection_total_mib: DEFAULT_COLLECTION_TOTAL_MIB,
    earliest: Date.now() - 60000,
    latest: Date.now() + 7 * 86400000,
    ...initial,
    ...(isSandbox(initial.id) && !hasSandboxWindow(initial)
      ? { earliest: NaN, latest: NaN }
      : {}),
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const intent = useRef({ fingerprint: "", requestID: "" });
  const dateValue = (n: number) =>
    Number.isFinite(n)
      ? new Date(n - new Date(n).getTimezoneOffset() * 60000)
          .toISOString()
          .slice(0, 16)
      : "";
  return (
    <Modal
      title={initial.id ? "Exam settings" : "New exam"}
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
            const fingerprint = JSON.stringify(form);
            if (intent.current.fingerprint !== fingerprint)
              intent.current = { fingerprint, requestID: crypto.randomUUID() };
            const result = await api("/admin/exams", {
              ...form,
              requestID: intent.current.requestID,
            });
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
        <label>
          Materials template
          <input
            required
            pattern="[a-zA-Z0-9_\-]{1,64}"
            disabled={busy}
            value={form.template}
            onChange={(e) => setForm({ ...form, template: e.target.value })}
          />
        </label>
        <small className="admin-field-help">
          Name of the exam template installed on the SSH server.
        </small>
        <fieldset className="admin-form-group">
          <legend>Start window</legend>
          <div className="admin-form-grid">
            <label>
              Earliest start
              <input
                required
                disabled={busy}
                type="datetime-local"
                value={dateValue(form.earliest)}
                onChange={(e) =>
                  setForm({
                    ...form,
                    earliest: new Date(e.target.value).getTime(),
                  })
                }
              />
            </label>
            <label>
              Latest start
              <input
                required
                disabled={busy}
                type="datetime-local"
                value={dateValue(form.latest)}
                onChange={(e) =>
                  setForm({
                    ...form,
                    latest: new Date(e.target.value).getTime(),
                  })
                }
              />
            </label>
          </div>
          <small>
            Times use your device timezone. This sets when students may begin.
            {isSandbox(form.id) &&
              " Required for repeatable practice; no new Begin outside this finite window. Existing started attempts keep their deadlines."}
          </small>
        </fieldset>
        {isSandbox(form.id) && (
          <p>
            Repeatable within the configured window · 5 minutes · no webcam ·
            automatic recovery approval
          </p>
        )}
        <div className="admin-form-grid">
          <label>
            Duration (minutes)
            <input
              required
              type="number"
              min={1}
              max={360}
              disabled={busy || isSandbox(form.id)}
              value={isSandbox(form.id) ? 5 : form.duration / 60}
              onChange={(e) =>
                setForm({ ...form, duration: Number(e.target.value) * 60 })
              }
            />
          </label>
          <label>
            Terminal limit
            <input
              required
              type="number"
              min={1}
              max={4}
              disabled={busy}
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
        <fieldset className="admin-form-group">
          <legend>Protected collection limits</legend>
          <div className="admin-form-grid">
            <label>
              Maximum file (MiB)
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
              Maximum submission (MiB)
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
          <small>
            Logical saved-file sizes; 1 MiB = 1,048,576 bytes. Entry/depth
            limits remain 10,000/32. These are not live disk quotas or
            monitoring limits. Qualify storage/runtime capacity before raising
            them.
          </small>
        </fieldset>
        <p>
          Attempts already prepared keep their settings and collection limits.
        </p>
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
            {busy ? "Saving…" : "Save exam"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
