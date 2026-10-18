import React, { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { api, chicago, remaining } from "./api.js";
import { Modal } from "./modal.js";
import {
  attemptStatus,
  webcamRequired,
} from "../../../packages/protocol/admin.js";

function accessDescription(a: any) {
  if (a.functional_test)
    return "Administrator test: normal SSH access is retained.";
  if (a.access_state === "OVERRIDDEN")
    return "Normal server access was released by an administrator override.";
  if (a.access_state === "RELEASED")
    return "Normal server access has been restored.";
  if (a.start)
    return `Normal server access remains blocked until at least ${chicago(Math.max(a.original_deadline || 0, a.deadline || 0))} and secured collection. Finishing early does not release this restriction.`;
  return "The server access restriction has not started.";
}
function Replay({ id, pane }: { id: string; pane: string }) {
  const root = useRef<HTMLDivElement>(null),
    terminal = useRef<Terminal | null>(null);
  const [events, setEvents] = useState<any[]>([]),
    [position, setPosition] = useState(0),
    [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setError("");
    setEvents([]);
    setPosition(0);
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
    api(`/admin/attempts/${id}/recordings/${pane}`)
      .then((text) => {
        if (!cancelled)
          setEvents(
            text
              .split("\n")
              .filter(Boolean)
              .map((line: string) => JSON.parse(line)),
          );
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
      terminal.current = null;
      t.dispose();
    };
  }, [id, pane, revision]);
  useEffect(() => {
    const t = terminal.current;
    if (!t) return;
    t.reset();
    for (const e of events.slice(0, position + 1)) {
      if (e.event === "output")
        t.write(Uint8Array.from(atob(e.data), (c) => c.charCodeAt(0)));
      if (e.event === "resize") t.resize(e.cols, e.rows);
    }
  }, [events, position]);
  return (
    <section className="admin-replay">
      {error && (
        <p role="alert">
          {error}{" "}
          <button onClick={() => setRevision((r) => r + 1)}>
            Retry replay
          </button>
        </p>
      )}
      <label>
        Replay position {chicago(events[position]?.at)}
        <input
          type="range"
          min={0}
          max={Math.max(0, events.length - 1)}
          value={position}
          onChange={(e) => setPosition(Number(e.target.value))}
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
}: {
  attempt: any;
  clock: number;
  stale: boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [section, setSection] = useState("Monitoring"),
    [media, setMedia] = useState<any>(null),
    [error, setError] = useState("");
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const [pane, setPane] = useState(""),
    [frame, setFrame] = useState(""),
    [deleting, setDeleting] = useState(false);
  const version = useRef(0);
  const load = async () => {
    const request = ++version.current;
    setLoading(true);
    setError("");
    try {
      const next = await api(`/admin/attempts/${a.id}/recordings`);
      if (request === version.current) {
        setMedia(next);
        setFrame("");
      }
    } catch (e) {
      if (request === version.current) setError((e as Error).message);
    } finally {
      if (request === version.current) setLoading(false);
    }
  };
  useEffect(() => {
    void load();
    return () => {
      ++version.current;
    };
  }, [a.id]);
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
  const oldFrame = frames.find((f: any) => f.id === frame);
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
              className="primary"
              disabled={busy || stale || a.deadline <= clock || !!a.protected}
              onClick={() =>
                void run(async () => {
                  await api(`/admin/attempts/${a.id}/authorize`, {});
                  await onChanged();
                  return "Resume authorized. The student must reconnect and restore monitoring.";
                })
              }
            >
              Authorize resume
            </button>
          )}
          <button disabled={busy || loading} onClick={() => void load()}>
            Refresh monitoring
          </button>
          <button data-initial-focus disabled={busy} onClick={onClose}>
            Close review
          </button>
        </div>
      </div>
      {a.reason && <p className="review-reason">{a.reason}</p>}
      {a.pendingClockReset && (
        <p className="warn" role="status">
          Clock change pending confirmation. The displayed deadline remains in
          force.
        </p>
      )}
      {stale && (
        <p className="warn" role="status">
          Dashboard updates are paused. Reconnect before authorizing recovery.
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p className="warn" role="alert">
          {error}{" "}
          <button disabled={busy} onClick={() => void load()}>
            Retry monitoring
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
            {name}
            {name === "Activity" && incidents.length
              ? ` (${incidents.length})`
              : ""}
          </button>
        ))}
      </div>
      {section === "Monitoring" && (
        <section aria-label="Monitoring">
          {loading && !media && <p role="status">Loading monitoring…</p>}
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
                  .map((source) => {
                    const latest = frames
                      .filter((f: any) => f.source === source)
                      .at(-1);
                    const label = source === "screen" ? "Screen" : "Webcam";
                    return (
                      <figure key={source}>
                        <figcaption>
                          <strong>{label}</strong>
                          {latest && (
                            <span
                              title={`Captured ${chicago(latest.captured)}; received ${chicago(latest.received)}`}
                            >
                              {Math.max(
                                0,
                                Math.floor((clock - latest.captured) / 1000),
                              )}
                              s ago
                            </span>
                          )}
                        </figcaption>
                        {latest ? (
                          <img
                            alt={`Latest ${source} capture for ${a.username}`}
                            src={`/api/admin/media/${latest.id}`}
                          />
                        ) : (
                          <p className="monitoring-empty">
                            No {source} images received.
                          </p>
                        )}
                      </figure>
                    );
                  })}
              </div>
              <div className="review-selectors">
                <label>
                  Image timeline
                  <select
                    value={frame}
                    onChange={(e) => setFrame(e.target.value)}
                  >
                    <option value="">Choose an image</option>
                    {frames.map((f: any) => (
                      <option key={f.id} value={f.id}>
                        {f.source} · {chicago(f.captured)}
                      </option>
                    ))}
                  </select>
                </label>
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
              </div>
              {oldFrame && (
                <figure className="review-history-image">
                  <img
                    alt={`${oldFrame.source} capture at ${chicago(oldFrame.captured)}`}
                    src={`/api/admin/media/${oldFrame.id}`}
                  />
                  <figcaption>
                    Captured {chicago(oldFrame.captured)} · received{" "}
                    {chicago(oldFrame.received)}
                  </figcaption>
                </figure>
              )}
              {pane && <Replay key={pane} id={a.id} pane={pane} />}
              {!!a.ended && (
                <details className="monitoring-deletion">
                  <summary>Monitoring retention</summary>
                  <p>
                    Monitoring is deleted after 60 days. Submissions have
                    separate retention.
                  </p>
                  {!deleting ? (
                    <button
                      className="danger"
                      disabled={busy}
                      onClick={() => setDeleting(true)}
                    >
                      Delete monitoring…
                    </button>
                  ) : (
                    <div role="group" aria-label="Confirm monitoring deletion">
                      <p>
                        Permanently delete monitoring for {a.username}, attempt{" "}
                        {a.attempt_number || 1}? The submission is kept.
                      </p>
                      <div className="actions">
                        <button
                          disabled={busy}
                          onClick={() => setDeleting(false)}
                        >
                          Cancel deletion
                        </button>
                        <button
                          className="danger"
                          disabled={busy}
                          onClick={() =>
                            void run(async () => {
                              await api(
                                `/admin/attempts/${a.id}/delete-monitoring`,
                                { confirm: true },
                              );
                              setPane("");
                              setDeleting(false);
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
          {loading && !media ? (
            <p role="status">Loading activity…</p>
          ) : !incidents.length ? (
            <p className="admin-empty-inline">
              No incidents recorded for this attempt.
            </p>
          ) : (
            <ol className="incident-list">
              {incidents.map((i: any) => (
                <li key={i.id}>
                  <time>{chicago(i.opened)}</time>
                  <div>
                    {JSON.parse(i.events).map((e: any, n: number) => (
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
            <p>
              Preflight ended before the exam started. No exam time was
              consumed.
            </p>
          ) : (
            <>
              <p
                className={`collection-summary ${a.protected ? "good" : a.state === "COLLECTION_FAILED" ? "danger" : ""}`}
              >
                {a.protected
                  ? "Submission secured"
                  : a.state === "COLLECTION_FAILED"
                    ? "Collection failed — administrator attention required"
                    : a.state === "FINALIZING" || a.ended
                      ? "Collection pending — a protected copy is not yet confirmed"
                      : "Collection occurs when time expires or the student finishes."}
              </p>
              <p>Submissions are retained on the SSH server.</p>
              <dl className="review-facts">
                <div>
                  <dt>Started</dt>
                  <dd>{chicago(a.start)}</dd>
                </div>
                <div>
                  <dt>Current deadline</dt>
                  <dd>{chicago(a.deadline)}</dd>
                </div>
                <div>
                  <dt>Original deadline</dt>
                  <dd>{chicago(a.original_deadline || a.deadline)}</dd>
                </div>
                <div>
                  <dt>Collection reason</dt>
                  <dd>{a.reason || "Not ended"}</dd>
                </div>
                <div>
                  <dt>Collected</dt>
                  <dd>{chicago(a.collected_at)}</dd>
                </div>
                <div>
                  <dt>Secured</dt>
                  <dd>{chicago(a.secured_at)}</dd>
                </div>
              </dl>
              <details>
                <summary>Collection details</summary>
                <p>
                  Source: {a.work_path || "/work"} · Execution ended:{" "}
                  {chicago(a.completed_at)}
                </p>
                {a.checksum && (
                  <p>
                    SHA-256: <code>{a.checksum}</code>
                  </p>
                )}
                {media?.manifest && (
                  <pre>{JSON.stringify(media.manifest, null, 2)}</pre>
                )}
              </details>
            </>
          )}
          <details className="review-access">
            <summary>Server access</summary>
            <p>{accessDescription(a)}</p>
            {a.access_override && <p>Audited override: {a.access_override}</p>}
            {a.access_error && (
              <p className="warn">Access recovery: {a.access_error}</p>
            )}
            {!!a.access_checked_at && (
              <small>Last checked {chicago(a.access_checked_at)}</small>
            )}
          </details>
        </section>
      )}
    </Modal>
  );
}
