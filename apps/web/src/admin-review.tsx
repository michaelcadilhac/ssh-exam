import { formatDuration } from "../../../packages/protocol/time.js";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { api, chicago, remaining } from "./api.js";
import { InterruptionHistory } from "./interruption-history.js";
import { CaptureTimeline } from "./capture-timeline.js";
import { Modal } from "./modal.js";
import { RefreshButton } from "./refresh-button.js";
import {
  AttemptProvenance,
  type SourceAttemptLink,
} from "./attempt-provenance.js";
import {
  attemptStatus,
  hasProtectedFiles,
  attemptElapsed,
  preflightElapsed,
  webcamRequired,
} from "../../../packages/protocol/admin.js";

function accessDescription(a: any) {
  if (a.functional_test)
    return "Administrator test: server access is retained.";
  if (a.policy_state === "RESTORE_FAILED")
    return `Account restoration failed: ${a.policy_error || "administrator recovery required"}.`;
  if (["RESTORE_PENDING", "RESTORING"].includes(a.policy_state))
    return "Restoring normal server access.";
  if (
    ["APPLYING", "READY", "APPLY_FAILED"].includes(a.policy_state) &&
    !a.start
  )
    return `Temporary access setup: ${a.policy_state.toLowerCase().replaceAll("_", " ")}. The exam clock has not started.`;
  if (a.access_state === "OVERRIDDEN")
    return "An administrator restored normal server access.";
  if (a.access_state === "RELEASED")
    return "Normal server access has been restored.";
  if (a.start)
    return `Normal server access remains blocked until at least ${chicago(Math.max(a.original_deadline || 0, a.deadline || 0))} and secured collection. Finishing early does not release this restriction.`;
  return "Server access is not restricted.";
}
// One request at a time; reconnecting or returning to the page refreshes immediately.
function useReviewRefresh(
  load: (signal: AbortSignal) => Promise<void>,
  enabled = true,
) {
  const refresh = useRef<(() => Promise<void>) | null>(null);
  useEffect(() => {
    if (!enabled) {
      refresh.current = null;
      return;
    }
    const controller = new AbortController();
    let pending: Promise<void> | null = null;
    const run = () => {
      if (controller.signal.aborted) return Promise.resolve();
      if (pending) return pending;
      pending = load(controller.signal).finally(() => {
        pending = null;
      });
      return pending;
    };
    refresh.current = run;
    const update = () => {
      void run();
    };
    update();
    const timer = setInterval(update, 5000);
    window.addEventListener("online", update);
    window.addEventListener("focus", update);
    return () => {
      controller.abort();
      refresh.current = null;
      clearInterval(timer);
      window.removeEventListener("online", update);
      window.removeEventListener("focus", update);
    };
  }, [load, enabled]);
  return useCallback(() => refresh.current?.() || Promise.resolve(), []);
}
function Replay({
  id,
  pane,
  positions,
  active,
}: {
  id: string;
  pane: string;
  positions: Map<string, number>;
  active: boolean;
}) {
  const root = useRef<HTMLDivElement>(null),
    terminal = useRef<Terminal | null>(null),
    offset = useRef(0),
    events = useRef<any[]>([]),
    drawn = useRef(-1),
    rendering = useRef(0);
  const [length, setLength] = useState(0),
    [position, setPosition] = useState(() => positions.get(pane) || 0),
    [error, setError] = useState("");
  useEffect(() => {
    const t = new Terminal({
      disableStdin: true,
      scrollback: 2000,
      cols: 100,
      rows: 24,
    });
    terminal.current = t;
    t.parser.registerOscHandler(52, () => true);
    t.parser.registerOscHandler(8, () => true);
    t.open(root.current!);
    return () => {
      terminal.current = null;
      t.dispose();
    };
  }, [id, pane]);
  const load = useCallback(
    async (signal: AbortSignal) => {
      try {
        // Catch up in bounded batches without re-downloading the existing recording.
        let more = true,
          batches = 0;
        while (more && batches++ < 8 && !signal.aborted) {
          const batch = await api(
            `/admin/attempts/${id}/recordings/${pane}?offset=${offset.current}`,
            undefined,
            undefined,
            signal,
          );
          if (signal.aborted) return;
          const next = batch.text
            .split("\n")
            .filter(Boolean)
            .map((line: string) => JSON.parse(line));
          for (const event of next) events.current.push(event);
          offset.current = batch.nextOffset;
          if (next.length) setLength(events.current.length);
          more = batch.more;
        }
        if (!signal.aborted) setError("");
      } catch (e) {
        if (!signal.aborted) setError((e as Error).message);
      }
    },
    [id, pane],
  );
  const refresh = useReviewRefresh(load, active);
  useEffect(() => {
    const t = terminal.current;
    if (!t || !length) return;
    const target = Math.min(position, length - 1);
    // Appending new events must not redraw or advance a paused replay.
    if (drawn.current === target) return;
    const revision = ++rendering.current;
    const current = () =>
      rendering.current === revision && terminal.current === t;
    const advance = (from: number) => {
      if (!current()) return;
      for (let i = from; i <= target; i++) {
        const e = events.current[i];
        if (e.event === "output")
          t.write(Uint8Array.from(atob(e.data), (c) => c.charCodeAt(0)));
        if (e.event === "resize") {
          // Apply resizes after preceding asynchronous terminal writes finish.
          t.write("", () => {
            if (!current()) return;
            t.resize(e.cols, e.rows);
            advance(i + 1);
          });
          return;
        }
      }
    };
    t.write("", () => {
      if (!current()) return;
      t.reset();
      t.resize(100, 24);
      advance(0);
    });
    drawn.current = target;
  }, [length, position]);
  return (
    <section className="admin-replay">
      {error && (
        <p role="alert">
          {error} <button onClick={() => void refresh()}>Retry replay</button>
        </p>
      )}
      <label>
        Replay position{" "}
        {chicago(events.current[Math.min(position, length - 1)]?.at)}
        <input
          type="range"
          min={0}
          max={Math.max(0, length - 1)}
          value={Math.min(position, Math.max(0, length - 1))}
          onChange={(e) => {
            const next = Number(e.target.value);
            positions.set(pane, next);
            setPosition(next);
          }}
        />
      </label>
      <div ref={root} />
    </section>
  );
}
export function AdminReview({
  attempt: a,
  clock,
  stale,
  onClose,
  onChanged,
  onGrant,
  onSource,
}: {
  attempt: any;
  clock: number;
  stale: boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onGrant?: (id: string) => void;
  onSource?: (source: SourceAttemptLink) => void;
}) {
  const [refreshError, setRefreshError] = useState("");
  const [section, setSection] = useState("Monitoring"),
    [media, setMedia] = useState<any>(null),
    [error, setError] = useState("");
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const [pane, setPane] = useState("");
  const [deleting, setDeleting] = useState<{
    id: string;
    confirm: string;
    revision: string;
    requestID: string;
    reason: string;
    sent: boolean;
  } | null>(null);
  const [replayOpen, setReplayOpen] = useState(false);
  const [authorization, setAuthorization] = useState<{
    id: string;
    generation: number;
    revision: number;
    requestID: string;
    reason: string;
  } | null>(null);
  const authorizeButton = useRef<HTMLButtonElement>(null);
  const positions = useRef(new Map<string, number>());
  const fetchMonitoring = useCallback(
    async (signal: AbortSignal) => {
      setLoading(true);
      try {
        const next = await api(
          `/admin/attempts/${a.id}/recordings`,
          undefined,
          undefined,
          signal,
        );
        if (signal.aborted) return;
        setMedia(next);
        setPane((selected) =>
          next.terminals.some((r: any) => r.pane === selected) ? selected : "",
        );
        setRefreshError("");
      } catch (e) {
        if (!signal.aborted) setRefreshError((e as Error).message);
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    },
    [a.id],
  );
  const load = useReviewRefresh(fetchMonitoring);
  useEffect(() => {
    setNotice("");
  }, [a.generation]);
  const run = async (fn: () => Promise<void | string>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const message = await fn();
      if (message) setNotice(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const status = attemptStatus(a),
    frames = media?.frames || [],
    incidents = media?.incidents || [];
  const activityIncidents = a.interruptions
    ? incidents.filter((i: any) => i.message || i.review_at)
    : incidents;
  const activityCount = a.interruptions
    ? a.interruptions.length + activityIncidents.length
    : incidents.length;
  let duration: number | null = null;
  let clockChanges: any[] = [];
  try {
    const history =
      typeof a.clock_resets === "string"
        ? JSON.parse(a.clock_resets)
        : a.clock_resets;
    if (Array.isArray(history)) clockChanges = history;
  } catch {
    /* Historical clock details can be unavailable. */
  }
  try {
    const settings =
      typeof a.settings === "string" ? JSON.parse(a.settings) : a.settings;
    if (Number.isFinite(settings?.duration)) duration = settings.duration;
  } catch {
    /* Unknown historical settings are displayed as unavailable. */
  }

  return (
    <Modal
      wide
      title={`${a.username} · Attempt ${a.attempt_number || 1}`}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="review-heading">
        <div>
          <span className={`attempt-status ${status.tone}`}>
            {status.label}
          </span>
          {["ACTIVE", "LOCKED"].includes(a.state) && (
            <strong className="review-clock">
              {remaining(a.deadline, clock)} remaining
            </strong>
          )}
        </div>
        <div className="review-heading-actions">
          {a.state === "LOCKED" && (
            <button
              ref={authorizeButton}
              className="primary"
              disabled={
                busy ||
                stale ||
                !!authorization ||
                a.deadline <= clock ||
                !!a.protected ||
                !Number.isSafeInteger(a.continuation_revision)
              }
              onClick={() =>
                setAuthorization({
                  id: a.id,
                  generation: a.generation,
                  revision: a.continuation_revision,
                  requestID: crypto.randomUUID(),
                  reason: "Allow exam to resume",
                })
              }
            >
              Allow resume
            </button>
          )}
          <RefreshButton
            label="Refresh"
            disabled={busy || loading}
            onClick={() => void load()}
          />
          <button data-initial-focus disabled={busy} onClick={onClose}>
            Close review
          </button>
        </div>
      </div>
      {authorization && (
        <fieldset
          className="continuation-confirmation"
          disabled={busy}
          aria-label="Confirm resume approval"
        >
          <legend>Allow {a.username} to resume?</legend>
          <p>
            Approval lasts up to five minutes, or until the deadline. The clock
            keeps running.{" "}
            {a.monitoring_mode === "v1"
              ? "The student must restore the checks and choose Resume exam on the same page and connection. A lost session needs another attempt."
              : "The student must sign in again and restore the checks."}
          </p>
          <details>
            <summary>Technical details</summary>
            <p>
              Reviewed revision {authorization.revision} · generation{" "}
              {authorization.generation}
            </p>
          </details>
          {error && (
            <p className="warn" role="alert">
              {error}
            </p>
          )}
          <div className="continuation-actions">
            <button
              autoFocus
              className="primary"
              disabled={stale || a.deadline <= clock}
              onClick={() =>
                void run(async () => {
                  const { id, ...body } = authorization;
                  const result = await api(
                    `/admin/attempts/${id}/authorize`,
                    body,
                  );
                  setAuthorization(null);
                  await onChanged();
                  return `Resume allowed until ${chicago(result.expires)}. ${
                    a.monitoring_mode === "v1"
                      ? "The student must restore the checks and choose Resume exam on the same page and connection."
                      : "The student must sign in again and restore the checks."
                  }`;
                })
              }
            >
              Allow resume
            </button>
            <button
              onClick={() => {
                setAuthorization(null);
                setError("");
                setTimeout(() => authorizeButton.current?.focus(), 0);
              }}
            >
              Cancel
            </button>
          </div>
        </fieldset>
      )}
      {a.reason && <p className="review-reason">{a.reason}</p>}
      <AttemptProvenance attempt={a} onGrant={onGrant} onSource={onSource} />
      {(a.access_error || a.policy_error) && (
        <div className="warn" role="alert">
          <p>Server access needs attention.</p>
          <details>
            <summary>Details</summary>
            <p>{a.policy_error || a.access_error}</p>
          </details>
        </div>
      )}
      <dl className="review-facts review-overview" aria-label="Attempt timing">
        <div>
          <dt>Setup started</dt>
          <dd>
            {a.preflight_started_at
              ? chicago(a.preflight_started_at)
              : "Not recorded"}
          </dd>
        </div>
        <div>
          <dt>Exam started</dt>
          <dd>{chicago(a.start)}</dd>
        </div>
        <div>
          <dt>{a.start ? "Exam ended" : "Setup ended"}</dt>
          <dd>{chicago(a.ended)}</dd>
        </div>
        <div>
          <dt>
            {a.ended || a.state === "COMPLETED" ? "Time used" : "Time used"}
          </dt>
          <dd>
            {attemptElapsed(a, clock) === null
              ? a.start
                ? "Not recorded"
                : "Not started"
              : formatDuration(attemptElapsed(a, clock)!)}
          </dd>
        </div>
        <div>
          <dt>Deadline</dt>
          <dd>{chicago(a.deadline)}</dd>
        </div>
        <div>
          <dt>Connection</dt>
          <dd>
            {a.connected === true ? "Connected" : "Connection unconfirmed"}
            {Number.isFinite(a.terminalCount)
              ? ` · ${a.terminalCount} ${a.terminalCount === 1 ? "terminal" : "terminals"}`
              : ""}
          </dd>
        </div>
      </dl>
      <details className="review-timing-details">
        <summary>Timing details</summary>
        <dl className="review-facts">
          <div>
            <dt>Setup time</dt>
            <dd>
              {preflightElapsed(a, clock) === null
                ? "Not recorded"
                : formatDuration(preflightElapsed(a, clock)!)}
            </dd>
          </div>
          <div>
            <dt>Time limit</dt>
            <dd>{duration === null ? "—" : formatDuration(duration)}</dd>
          </div>
          <div>
            <dt>Original deadline</dt>
            <dd>{chicago(a.original_deadline || a.deadline)}</dd>
          </div>
          <div>
            <dt>Last browser contact</dt>
            <dd>{chicago(a.last_contact)}</dd>
          </div>
          <div>
            <dt>Webcam</dt>
            <dd>
              {webcamRequired(a) === null
                ? "Unknown"
                : webcamRequired(a)
                  ? "Required"
                  : "Optional"}
            </dd>
          </div>
          <div>
            <dt>Time changes</dt>
            <dd>{a.clock_revision || 0}</dd>
          </div>
        </dl>
        {!!clockChanges.length && (
          <ol className="clock-change-history" aria-label="Time-change history">
            {clockChanges.map((change, i) => (
              <li key={change.id || i}>
                <strong>
                  {change.extend_seconds
                    ? `Extended by ${formatDuration(change.extend_seconds)}`
                    : `Reset to ${formatDuration(change.remaining_seconds)}`}
                </strong>
                <span>
                  Requested {chicago(change.requested_at)} by {change.actor};
                  confirmed {chicago(change.applied_at)}. Deadline{" "}
                  {chicago(change.deadline)}.
                </span>
              </li>
            ))}
          </ol>
        )}
        <details>
          <summary>Technical details</summary>
          <p className="review-attempt-id">
            Attempt ID: <code>{a.id}</code>
          </p>
        </details>
      </details>
      {a.pendingClockReset && (
        <p className="warn" role="status">
          Time change awaiting server confirmation. The displayed deadline still
          applies.
        </p>
      )}
      {stale && (
        <p className="warn" role="status">
          Updates paused. Refresh before allowing resume.
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {((!authorization && error) || refreshError) && (
        <p className="warn" role="alert">
          {(!authorization && error) || refreshError}{" "}
          <button disabled={busy} onClick={() => void load()}>
            Retry
          </button>
        </p>
      )}
      <div
        className="review-navigation"
        role="group"
        aria-label="Review sections"
      >
        {["Monitoring", "Activity", "Submission"].map((name) => (
          <button
            key={name}
            aria-pressed={section === name}
            onClick={() => setSection(name)}
          >
            {name === "Monitoring" ? "Recordings" : name}
            {name === "Activity" && activityCount ? ` (${activityCount})` : ""}
          </button>
        ))}
      </div>
      {(section === "Monitoring" || media) && (
        <section aria-label="Recordings" hidden={section !== "Monitoring"}>
          {loading && !media && <p role="status">Loading recordings…</p>}
          {media && (
            <>
              <div className="review-images">
                {["screen", "webcam"]
                  .filter(
                    (source) =>
                      source !== "webcam" ||
                      webcamRequired(a) ||
                      frames.some((f: any) => f.source === source),
                  )
                  .map((source) => (
                    <CaptureTimeline
                      key={source}
                      source={source}
                      frames={frames}
                      username={a.username}
                      working={!!a.working && !stale}
                      clock={clock}
                    />
                  ))}
              </div>
              {!!media.terminals.length && (
                <div className="review-selectors">
                  <button
                    aria-expanded={replayOpen}
                    onClick={() => setReplayOpen(!replayOpen)}
                  >
                    {replayOpen
                      ? "Close terminal replay"
                      : "Open terminal replay"}
                  </button>
                  {replayOpen && (
                    <label>
                      Terminal replay
                      <select
                        value={pane}
                        onChange={(e) => setPane(e.target.value)}
                      >
                        <option value="">Choose a terminal</option>
                        {media.terminals.map((r: any, i: number) => (
                          <option key={r.pane} value={r.pane}>
                            Terminal {i + 1}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
              )}
              {pane && replayOpen && (
                <Replay
                  key={pane}
                  id={a.id}
                  pane={pane}
                  positions={positions.current}
                  active={section === "Monitoring"}
                />
              )}
              {!!a.ended && (
                <details className="monitoring-deletion">
                  <summary>Recording retention</summary>
                  <p>
                    Recordings are deleted after 60 days. Submissions are kept
                    separately.
                  </p>
                  {media.monitoringDeleted && (
                    <p role="status">
                      Recordings are inaccessible. File deletion:{" "}
                      {media.physicalPurge?.status || "not verified"}.
                      {media.physicalPurge?.status === "verified-absent"
                        ? " The recording files were confirmed absent; backups have separate retention."
                        : " File deletion is pending or needs retry; access remains blocked."}
                    </p>
                  )}
                  {!deleting ? (
                    <button
                      className="danger"
                      disabled={
                        busy ||
                        media.monitoringDeleted ||
                        !media.deletionReview?.eligible
                      }
                      onClick={() =>
                        setDeleting({
                          id: a.id,
                          confirm: media.deletionReview.confirm,
                          revision: media.deletionReview.revision,
                          requestID: crypto.randomUUID(),
                          reason: "Delete attempt recordings",
                          sent: false,
                        })
                      }
                    >
                      Delete recordings…
                    </button>
                  ) : (
                    <div role="group" aria-label="Confirm recording deletion">
                      <p>
                        Permanently delete recordings for {a.username}, attempt{" "}
                        {a.attempt_number || 1}? Saved submissions are kept.
                      </p>
                      <p>
                        Recordings become inaccessible now; file deletion is
                        completed separately. Time limits and server
                        restrictions stay unchanged.
                      </p>
                      {deleting.sent && (
                        <p>
                          Retry repeats the same deletion request. To change it,
                          cancel and review again.
                        </p>
                      )}
                      <div className="actions">
                        <button
                          disabled={busy}
                          onClick={() => setDeleting(null)}
                        >
                          Cancel deletion
                        </button>
                        <button
                          className="danger"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              const { sent: _sent, ...intent } = deleting;
                              setDeleting({ ...deleting, sent: true });
                              await api(
                                `/admin/attempts/${a.id}/delete-monitoring`,
                                intent,
                              );
                              setPane("");
                              setDeleting(null);
                              await load();
                              await onChanged();
                            })
                          }
                        >
                          Permanently delete monitoring
                        </button>
                      </div>
                    </div>
                  )}
                </details>
              )}
            </>
          )}
        </section>
      )}
      {section === "Activity" && (
        <section aria-label="Attempt activity">
          {a.interruptions && <InterruptionHistory attempt={a} clock={clock} />}
          {loading && !media ? (
            <p role="status">Loading activity…</p>
          ) : !activityIncidents.length ? (
            !a.interruptions ? (
              <p className="admin-empty-inline">
                No incidents recorded for this attempt.
              </p>
            ) : null
          ) : (
            <ol className="incident-list">
              {activityIncidents.map((i: any) => (
                <li key={i.id}>
                  <time>{chicago(i.opened)}</time>
                  <div>
                    {!a.interruptions &&
                      JSON.parse(i.events).map((e: any, n: number) => (
                        <p key={n}>{e.reason}</p>
                      ))}
                    {i.message && <blockquote>{i.message}</blockquote>}
                    {i.review_at && (
                      <small>Reviewed {chicago(i.review_at)}</small>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
      {section === "Submission" && (
        <section aria-label="Submission and server access">
          {a.state === "CANCELLED_BEFORE_START" ? (
            <p>Setup ended before the exam started. No exam time was used.</p>
          ) : (
            <>
              <p
                className={`collection-summary ${hasProtectedFiles(a) ? "good" : a.state === "COLLECTION_FAILED" ? "danger" : ""}`}
              >
                {hasProtectedFiles(a)
                  ? "Files saved"
                  : a.state === "COLLECTION_FAILED"
                    ? "Files need administrator attention"
                    : a.state === "FINALIZING" || a.ended
                      ? "File protection is not confirmed"
                      : "Files are collected when time ends or the student finishes."}
              </p>
              <p>Saved files stay on the exam server.</p>
              <dl className="review-facts">
                <div>
                  <dt>Reason</dt>
                  <dd>
                    {a.reason || (a.ended ? "Not recorded" : "Not ended")}
                  </dd>
                </div>
                <div>
                  <dt>Work ended</dt>
                  <dd>{chicago(a.completed_at)}</dd>
                </div>
                <div>
                  <dt>Files collected</dt>
                  <dd>{chicago(a.collected_at)}</dd>
                </div>
                <div>
                  <dt>Files protected</dt>
                  <dd>{chicago(a.secured_at)}</dd>
                </div>
              </dl>
              {media?.manifest && (
                <div className="submission-inventory">
                  <p>
                    {media.manifest.files?.length || 0}{" "}
                    {media.manifest.files?.length === 1 ? "file" : "files"}{" "}
                    collected · {media.manifest.omissions?.length || 0}{" "}
                    {media.manifest.omissions?.length === 1
                      ? "entry"
                      : "entries"}{" "}
                    omitted
                  </p>
                  {!!media.manifest.omissions?.length && (
                    <details>
                      <summary>Omitted entries</summary>
                      <ul>
                        {media.manifest.omissions.map(
                          (entry: any, i: number) => (
                            <li key={i}>
                              {typeof entry === "string" ? (
                                entry
                              ) : (
                                <>
                                  <code>{entry.path}</code>: {entry.reason}
                                </>
                              )}
                            </li>
                          ),
                        )}
                      </ul>
                    </details>
                  )}
                </div>
              )}
              <details>
                <summary>Technical file details</summary>
                <p>Source: {a.work_path || "/work"}</p>
                {a.checksum && (
                  <p>
                    SHA-256: <code>{a.checksum}</code>
                  </p>
                )}
                {media?.manifest && (
                  <details>
                    <summary>Technical manifest</summary>
                    <p>
                      Raw timestamps are Unix milliseconds. Duration,
                      remaining_seconds and extend_seconds are in seconds.
                    </p>
                    <pre>{JSON.stringify(media.manifest, null, 2)}</pre>
                  </details>
                )}
              </details>
            </>
          )}
          <details className="review-access">
            <summary>Server access</summary>
            <p>{accessDescription(a)}</p>
            {a.access_override && <p>Audited override: {a.access_override}</p>}
            {a.access_error && (
              <p className="warn">Server access error: {a.access_error}</p>
            )}
            <dl className="review-facts">
              <div>
                <dt>Restriction began</dt>
                <dd>{chicago(a.access_held_at)}</dd>
              </div>
              <div>
                <dt>Access restored</dt>
                <dd>{chicago(a.access_released_at)}</dd>
              </div>
            </dl>
            {!!a.access_checked_at && (
              <small>Last checked {chicago(a.access_checked_at)}</small>
            )}
          </details>
        </section>
      )}
    </Modal>
  );
}
