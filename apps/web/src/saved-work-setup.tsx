import { useEffect, useState } from "react";
import { api } from "./api.js";
import { grantStatus } from "./grant-options.js";

// Native source confirmation remains the authority. Worker success by itself
// never changes the visible attempt into Ready.
export function SavedWorkSetup({
  id,
  revision,
  snapshot,
  onRefresh,
}: {
  id: string;
  revision: number;
  snapshot?: any;
  onRefresh?: () => void;
}) {
  const [grant, setGrant] = useState<any>(null),
    [setup, setSetup] = useState<any>(null),
    [error, setError] = useState(""),
    [refresh, setRefresh] = useState(0),
    [busy, setBusy] = useState(false),
    [retry, setRetry] = useState<string | null>(null);
  useEffect(() => {
    if (snapshot !== undefined) {
      setGrant(snapshot?.grant ?? null);
      setSetup(snapshot);
      setError(snapshot?.read_error ?? "");
      return;
    }
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const s = await api(
            `/admin/grants/${id}/source-setup?revision=${revision}`,
            undefined,
            undefined,
            abort.signal,
          ),
          g = s.grant;
        if (abort.signal.aborted) return;
        if (g.id !== id || s.id !== id || s.revision !== revision)
          throw Error("Saved-work status differs from this attempt.");
        setGrant(g);
        setSetup(s);
        setError("");
        if (
          g.revision === revision &&
          g.status === "PENDING_NATIVE" &&
          ["QUEUED", "RUNNING"].includes(s.status)
        )
          timer = setTimeout(() => void load(), 3000);
      } catch (e) {
        if (!abort.signal.aborted) setError((e as Error).message);
      }
    };
    void load();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [id, revision, refresh, snapshot]);
  const retrySetup = async () => {
    const request = retry ?? crypto.randomUUID();
    setRetry(request);
    setBusy(true);
    setError("");
    try {
      await api(
        `/admin/grants/${id}/source-setup`,
        { revision, request },
        undefined,
        new AbortController().signal,
      );
      setRetry(null);
      if (onRefresh) onRefresh();
      else setRefresh((n) => n + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const stale = grant && grant.revision !== revision;
  return (
    <div>
      <p role="status">
        {error
          ? "Saved-work status unconfirmed"
          : !grant
            ? "Checking saved work…"
            : stale
              ? "Settings changed since this request"
              : grantStatus(grant)}
      </p>
      {!stale &&
        grant?.status === "PENDING_NATIVE" &&
        setup?.status === "FAILED" && (
          <p className="warn">
            Saved-work setup failed. The attempt cannot start yet.
          </p>
        )}
      {!stale &&
        grant?.status === "PENDING_NATIVE" &&
        ["FAILED", "NOT_QUEUED"].includes(setup?.status) && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void retrySetup()}
          >
            Retry setup
          </button>
        )}
      {(error || setup?.error) && (
        <details>
          <summary>Details</summary>
          <p>{error || setup.error}</p>
        </details>
      )}
      {(error || setup?.status === "NOT_QUEUED") && (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (onRefresh) onRefresh();
            else setRefresh((n) => n + 1);
          }}
        >
          Refresh saved work
        </button>
      )}
    </div>
  );
}
