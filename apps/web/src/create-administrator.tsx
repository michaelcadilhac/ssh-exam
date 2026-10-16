import React, { useRef, useState } from "react";
import { api } from "./api.js";
import { Modal } from "./modal.js";

export function CreateAdministrator({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (username: string) => void;
}) {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal
      title="Add administrator"
      onClose={() => {
        if (!pending.current) onClose();
      }}
    >
      <p>
        Administrators can manage all exams and create other administrators.
      </p>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (pending.current) return;
          const form = event.currentTarget;
          const username = (
            form.elements.namedItem("username") as HTMLInputElement
          ).value;
          const passwordField = form.elements.namedItem(
            "password",
          ) as HTMLInputElement;
          const confirmation = form.elements.namedItem(
            "confirmation",
          ) as HTMLInputElement;
          let password = passwordField.value;
          const matches = password === confirmation.value;
          passwordField.value = confirmation.value = "";
          setError("");
          if (!matches) {
            password = "";
            setError("Passwords do not match. Enter them again.");
            passwordField.focus();
            return;
          }
          pending.current = true;
          setBusy(true);
          try {
            const request = api("/admin/administrators", {
              username,
              password,
            });
            password = "";
            const result = await request;
            onCreated(result.username);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            password = "";
            pending.current = false;
            setBusy(false);
          }
        }}
      >
        <label>
          Administrator username
          <input
            name="username"
            autoComplete="off"
            required
            maxLength={64}
            pattern="[a-zA-Z0-9_\-]{1,64}"
            disabled={busy}
            title="Letters, numbers, underscores and hyphens"
          />
        </label>
        <label>
          Password
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            maxLength={1024}
            disabled={busy}
          />
        </label>
        <label>
          Confirm password
          <input
            name="confirmation"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            maxLength={1024}
            disabled={busy}
          />
        </label>
        <small>12–1024 characters.</small>
        {error && (
          <p className="warn" role="alert">
            {error}
          </p>
        )}
        <div className="actions">
          <button type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy}>
            {busy ? "Creating…" : "Create administrator"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
