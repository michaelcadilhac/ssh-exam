import React, { useEffect, useRef, useState } from "react";
import { api, chicago } from "./api.js";

const deliveryLabels: Record<string, string> = {
  all: "All messages",
  pending: "Queued",
  sent: "Accepted by mail server",
  failed: "Failed",
  cancelled: "Cancelled",
};

// Operational metadata only. Selection captures the reviewed revision; polling
// must not silently advance it under an unsent/retried manual reminder.
export function AlertDelivery() {
  const [data, setData] = useState<any>(null);
  const [status, setStatus] = useState("all");
  const [cursor, setCursor] = useState("");
  const [lookup, setLookup] = useState("");
  const [outboxQuery, setOutboxQuery] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [stale, setStale] = useState(true);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [reason, setReason] = useState("");
  const active = useRef(false);
  const testRequest = useRef("");
  const reminder = useRef({ key: "", request: "" });
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    let alive = true,
      pending = false;
    const abort = new AbortController();
    setStale(true);
    const load = async () => {
      if (pending) return;
      pending = true;
      try {
        const fetched = await api(
          lookup
            ? `/admin/notifications/${encodeURIComponent(lookup)}`
            : `/admin/notifications?status=${status}&limit=50${cursor ? `&after=${cursor}` : ""}`,
          undefined,
          undefined,
          abort.signal,
        );
        if (alive) {
          setData(
            lookup
              ? {
                  alerts: [fetched],
                  next: null,
                  smtpConfigured: fetched.smtpConfigured,
                }
              : fetched,
          );
          setStale(false);
          setLoadError("");
        }
      } catch (e) {
        if (alive) {
          setStale(true);
          setLoadError((e as Error).message);
        }
      } finally {
        pending = false;
      }
    };
    void load();
    const timer = setInterval(load, 5000);
    return () => {
      alive = false;
      abort.abort();
      clearInterval(timer);
    };
  }, [status, cursor, lookup, refresh]);

  const execute = async (kind: "test" | "remind") => {
    if (active.current) return;
    active.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      let result;
      if (kind === "test") {
        testRequest.current ||= crypto.randomUUID();
        result = await api("/admin/notifications/test", {
          requestID: testRequest.current,
        });
        testRequest.current = "";
      } else {
        const intent = {
          revision: selected.episode.revision,
          reason: reason.trim(),
        };
        const key = JSON.stringify({ id: selected.episode.id, ...intent });
        if (reminder.current.key !== key)
          reminder.current = { key, request: crypto.randomUUID() };
        result = await api(
          `/admin/notifications/${selected.episode.id}/remind`,
          { ...intent, requestID: reminder.current.request },
        );
        if (mounted.current) {
          setSelected(null);
          setReason("");
        }
      }
      if (mounted.current) {
        setOutboxQuery(result.outbox);
        setNotice("Email queued. Delivery is not confirmed.");
        setRefresh((v) => v + 1);
      }
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      active.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  return (
    <section aria-label="Email delivery">
      <h3>Email delivery</h3>
      <p>
        Mail-server acceptance does not confirm inbox delivery. Reminders are
        sent only when you request one.
      </p>
      {error && <p role="alert">{error}</p>}
      {loadError && <p role="alert">{loadError}</p>}
      {notice && (
        <p role="status" style={{ overflowWrap: "anywhere" }}>
          {notice}
        </p>
      )}
      {stale && (
        <p role="status">Updates paused. Refresh before sending a reminder.</p>
      )}
      {data && !data.smtpConfigured && <p>Email is not configured.</p>}
      <button
        disabled={busy || stale || !data?.smtpConfigured}
        onClick={() => void execute("test")}
      >
        Send test email
      </button>
      <label>
        Delivery status{" "}
        <select
          aria-label="Delivery status"
          value={status}
          disabled={busy}
          onChange={(e) => {
            setStatus(e.target.value);
            setCursor("");
            setLookup("");
          }}
        >
          {["all", "pending", "sent", "failed", "cancelled"].map((v) => (
            <option key={v} value={v}>
              {deliveryLabels[v]}
            </option>
          ))}
        </select>
      </label>
      <button
        disabled={busy}
        onClick={() => {
          setError("");
          setRefresh((v) => v + 1);
        }}
      >
        Refresh
      </button>
      <details>
        <summary>Technical details</summary>
        <p>Desktop alerts and sound apply only to this browser.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setError("");
            setLookup(outboxQuery.trim());
            setRefresh((v) => v + 1);
          }}
        >
          <label>
            Outbox ID{" "}
            <input
              required
              minLength={36}
              maxLength={36}
              pattern="[a-f0-9-]{36}"
              value={outboxQuery}
              onChange={(e) => setOutboxQuery(e.target.value)}
              disabled={busy}
            />
          </label>
          <button type="submit" disabled={busy}>
            Inspect message
          </button>
          {lookup && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setLookup("");
                setCursor("");
              }}
            >
              Back to messages
            </button>
          )}
        </form>
      </details>
      {selected && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void execute("remind");
          }}
        >
          <h4>Send reminder</h4>
          <p>
            Send another email about {selected.subject} to the alert recipients?
          </p>
          <label>
            Reason{" "}
            <textarea
              required
              minLength={8}
              maxLength={1000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={busy}
            />
          </label>
          <p>If this alert changes, cancel and review it again.</p>
          <button
            type="submit"
            disabled={busy || stale || reason.trim().length < 8}
          >
            Send reminder
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setSelected(null);
              setReason("");
              setError("");
            }}
          >
            Cancel
          </button>
        </form>
      )}
      <ul aria-label="Delivery history">
        {(data?.alerts || []).map((row: any) => (
          <li key={row.id} style={{ overflowWrap: "anywhere" }}>
            <h4>{row.subject}</h4>
            <p>{deliveryLabels[row.status] ?? "Status unavailable"}</p>
            <details>
              <summary>Details</summary>
              <p>
                Outbox {row.id}: {row.status}; retries {row.tries}
                {row.status === "pending" ? `; next ${chicago(row.next)}` : ""}.
              </p>
              {row.episode && (
                <p>
                  Episode {row.episode.id}: {row.episode.event}; generation{" "}
                  {row.episode.generation};{" "}
                  {row.episode.resolved === null ? "unresolved" : "resolved"};{" "}
                  {row.episode.reminderCount} manual reminders.
                </p>
              )}
            </details>
            {row.refusal && <p>{row.refusal}</p>}
            <button
              disabled={busy || stale || !row.remindable}
              onClick={() => {
                setSelected(row);
                setReason("");
                setError("");
              }}
            >
              Send reminder
            </button>
          </li>
        ))}
      </ul>
      {data && !data.alerts.length && <p>No messages.</p>}
      {cursor && (
        <button disabled={busy} onClick={() => setCursor("")}>
          First page
        </button>
      )}
      {data?.next && (
        <button disabled={busy || stale} onClick={() => setCursor(data.next)}>
          Next page
        </button>
      )}
    </section>
  );
}
