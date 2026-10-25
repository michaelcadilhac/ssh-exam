import React from "react";
import { chicago } from "./api.js";

export type SourceAttemptLink = { id: string; exam: string };
export function AttemptProvenance({
  attempt,
  compact = false,
  onGrant,
  onSource,
}: {
  attempt: any;
  compact?: boolean;
  onGrant?: (id: string) => void;
  onSource?: (source: SourceAttemptLink) => void;
}) {
  const g = attempt.grantContext;
  if (!g) return null; // Older cached metadata remains readable.
  if (g.state === "legacy")
    return (
      <small className="attempt-grant-summary">
        Legacy attempt · no grant snapshot recorded
      </small>
    );
  if (g.state !== "recorded")
    return (
      <small className="attempt-grant-summary warn">
        Grant linkage requires inspection{!compact && <span>{g.message}</span>}
      </small>
    );
  const source = g.source_attempt;
  const label =
    g.work.kind === "empty"
      ? "Empty work folder"
      : g.work.kind === "template"
        ? `Template ${g.work.name} · ${g.work.hash.slice(0, 12)}`
        : source?.available_in_gateway
          ? `Saved work · ${source.exam} · Attempt ${source.attempt_number}`
          : `Saved work · ${g.work.attempt}`;
  const grantButton = onGrant ? (
    <button
      type="button"
      title={`Grant ${g.id}`}
      onClick={() => onGrant(g.id)}
      aria-label={`Inspect grant for ${attempt.username} attempt ${attempt.attempt_number || 1}`}
    >
      Grant {g.issuance_order} · revision {g.revision}
    </button>
  ) : (
    <span>
      Grant {g.issuance_order} · revision {g.revision}
    </span>
  );
  const sourceButton =
    source?.available_in_gateway && onSource ? (
      <button
        type="button"
        onClick={() => onSource({ id: source.id, exam: source.exam })}
        aria-label={`Review saved source attempt ${source.attempt_number} for ${attempt.username}`}
      >
        Review source attempt
      </button>
    ) : null;
  if (compact)
    return (
      <div className="attempt-grant-summary">
        {grantButton}
        <span>{label}</span>
        {sourceButton}
        <span className="grant-reason" title={g.reason}>
          Granted: {g.reason}
        </span>
      </div>
    );
  return (
    <section className="grant-provenance" aria-label="Grant and workspace">
      <h3>Grant and workspace</h3>
      <p>
        {grantButton} · Current grant status:{" "}
        {String(g.current_status).toLowerCase().replaceAll("_", " ")}
      </p>
      {g.current_revision !== g.revision && (
        <p>
          This attempt used revision {g.revision}. The grant is now revision{" "}
          {g.current_revision}; later changes do not rewrite this attempt.
        </p>
      )}
      <dl className="review-facts">
        <div>
          <dt>Grant ID</dt>
          <dd>
            <code>{g.id}</code>
          </dd>
        </div>
        <div>
          <dt>Applied revision hash</dt>
          <dd>
            <code>{g.hash}</code>
          </dd>
        </div>
        <div>
          <dt>Granted allowance</dt>
          <dd>
            {g.settings.duration / 60} minutes · webcam{" "}
            {g.settings.webcam ? "required" : "optional"}
          </dd>
        </div>
        <div>
          <dt>Applied Begin window</dt>
          <dd>
            {chicago(g.settings.earliest)} — {chicago(g.settings.latest)}
          </dd>
        </div>
        <div>
          <dt>Issued</dt>
          <dd>
            {chicago(g.issued_at)} · {g.actor}
          </dd>
        </div>
        <div>
          <dt>Authorization reason</dt>
          <dd>{g.reason}</dd>
        </div>
        {g.revision > 1 && (
          <div>
            <dt>Applied revision reason</dt>
            <dd>{g.revision_reason}</dd>
          </div>
        )}
        <div>
          <dt>Workspace source</dt>
          <dd>
            {label} {sourceButton}
          </dd>
        </div>
        {g.work.kind === "saved" && (
          <div>
            <dt>Source archive checksum</dt>
            <dd>
              <code>{g.work.checksum}</code>
            </dd>
          </div>
        )}
        <div>
          <dt>Materials</dt>
          <dd>
            {g.settings.template} · <code>{g.settings.template_version}</code>
          </dd>
        </div>
      </dl>
      {source?.available_in_gateway && (
        <p>
          Source history:{" "}
          {String(source.state ?? "unavailable")
            .toLowerCase()
            .replaceAll("_", " ")}{" "}
          ·{" "}
          {source.recorded_protected
            ? "submission recorded secured"
            : "submission protection not recorded"}
          {!source.checksum_matches &&
            " · recorded checksum differs; inspect source history"}
          .
        </p>
      )}
      {g.work.kind === "saved" && !source?.available_in_gateway && (
        <p className="warn">
          Source gateway history is unavailable or differs from this account.
          Preserve the source ID and inspect the native archive; this does not
          establish archive loss.
        </p>
      )}
      <small>
        Recorded grant and history metadata. The original/current attempt
        deadlines govern its clock; native archive integrity and availability
        require fresh verification.
      </small>
    </section>
  );
}
