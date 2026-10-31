import React from "react";
import { chicago } from "./api.js";
import { timeLimit } from "./local-date-time.js";

const permissionLabels: Record<string, string> = {
  AVAILABLE: "Unused",
  PENDING_NATIVE: "Preparing saved work",
  REVOKED: "Cancelled",
  CONSUMED: "Started",
};

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
      <div className="attempt-grant-summary">
        <small>Earlier attempt · saved settings unavailable</small>
      </div>
    );
  if (g.state !== "recorded")
    return (
      <div className="attempt-grant-summary warn">
        <small>Attempt settings need review</small>
        {!compact && (
          <details>
            <summary>Details</summary>
            <p>{g.message}</p>
          </details>
        )}
      </div>
    );
  const source = g.source_attempt;
  const label =
    g.work.kind === "empty"
      ? "Empty folder"
      : g.work.kind === "template"
        ? `Starter files: ${g.work.name}`
        : source?.available_in_gateway
          ? `Saved work · ${source.exam} · Attempt ${source.attempt_number}`
          : "Saved work · source details unavailable";
  const grantButton = onGrant ? (
    <button
      type="button"
      title="Attempt settings"
      onClick={() => onGrant(g.id)}
      aria-label={`View settings for ${attempt.username} attempt ${attempt.attempt_number || 1}`}
    >
      Attempt settings
    </button>
  ) : (
    <span>Attempt settings</span>
  );
  const sourceButton =
    source?.available_in_gateway && onSource ? (
      <button
        type="button"
        onClick={() => onSource({ id: source.id, exam: source.exam })}
        aria-label={`Review saved source attempt ${source.attempt_number} for ${attempt.username}`}
      >
        View previous attempt
      </button>
    ) : null;
  if (compact)
    return (
      <div className="attempt-grant-summary">
        {grantButton}
        <span>{label}</span>
        {sourceButton}
      </div>
    );
  return (
    <details className="grant-provenance">
      <summary>Starting files and settings</summary>
      <p>
        {grantButton} · Current permission status:{" "}
        {permissionLabels[g.current_status] ?? "Needs review"}
      </p>
      {g.current_revision !== g.revision && (
        <p>This attempt keeps its saved settings despite later changes.</p>
      )}
      <dl className="review-facts">
        <div>
          <dt>Time limit</dt>
          <dd>{timeLimit(g.settings.duration)}</dd>
        </div>
        <div>
          <dt>Webcam</dt>
          <dd>{g.settings.webcam ? "Required" : "Optional"}</dd>
        </div>
        <div>
          <dt>Start window</dt>
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
          <dt>Reason</dt>
          <dd>{g.reason}</dd>
        </div>
        {g.revision > 1 && (
          <div>
            <dt>Setting-change reason</dt>
            <dd>{g.revision_reason}</dd>
          </div>
        )}
        <div>
          <dt>Starting files</dt>
          <dd>
            {label} {sourceButton}
          </dd>
        </div>
        <div>
          <dt>Exam files</dt>
          <dd>{g.settings.template}</dd>
        </div>
      </dl>
      <details>
        <summary>Technical details</summary>
        <dl className="review-facts">
          <div>
            <dt>Permission reference</dt>
            <dd>
              <code>{g.id}</code>
            </dd>
          </div>
          <div>
            <dt>Saved revision hash</dt>
            <dd>
              <code>{g.hash}</code>
            </dd>
          </div>
          {g.work.kind === "saved" && (
            <div>
              <dt>Archive checksum</dt>
              <dd>
                <code>{g.work.checksum}</code>
              </dd>
            </div>
          )}
          <div>
            <dt>Exam files version</dt>
            <dd>
              <code>{g.settings.template_version}</code>
            </dd>
          </div>
          {g.work.kind === "saved" && (
            <div>
              <dt>Previous attempt reference</dt>
              <dd>
                <code>{g.work.attempt}</code>
              </dd>
            </div>
          )}
        </dl>
      </details>
      {source?.available_in_gateway && (
        <p>
          Source history:{" "}
          {String(source.state ?? "unavailable")
            .toLowerCase()
            .replaceAll("_", " ")}{" "}
          ·{" "}
          {source.recorded_protected
            ? "files recorded protected"
            : "file protection not confirmed"}
          {!source.checksum_matches &&
            " · verification differs; check source history"}
          .
        </p>
      )}
      {g.work.kind === "saved" && !source?.available_in_gateway && (
        <p className="warn">
          Source history is unavailable. An administrator must check the saved
          files.
        </p>
      )}
      <small>
        These are saved settings. Files are verified again before a new attempt
        starts.
      </small>
    </details>
  );
}
