import { useEffect, useState } from "react";
import { publishedFiles } from "./exam-file-options.js";
import { shortDateTime } from "./local-date-time.js";

export function TemplatePicker({
  name,
  hash,
  onChange,
  label = "Starter files",
  disabled = false,
}: {
  name: string;
  hash: string;
  onChange: (name: string, hash: string) => void;
  label?: string;
  disabled?: boolean;
}) {
  const [sources, setSources] = useState<any[] | null>(null),
    [error, setError] = useState(""),
    [reload, setReload] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    let live = true;
    void publishedFiles(abort.signal)
      .then((value) => {
        if (live) {
          setSources(value);
          setError("");
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
      abort.abort();
    };
  }, [reload]);
  const current = name && hash ? `${name}@${hash}` : "";
  return (
    <>
      <label>
        {label}
        <select
          required
          value={current}
          disabled={disabled}
          onChange={(e) => {
            const source = sources?.find(
              (s) => `${s.name}@${s.hash}` === e.target.value,
            );
            if (source) onChange(source.name, source.hash);
          }}
        >
          <option value="">
            {sources
              ? sources.length
                ? "Choose published files"
                : "No published starter files"
              : "Loading starter files…"}
          </option>
          {current &&
            !sources?.some((s) => `${s.name}@${s.hash}` === current) && (
              <option value={current}>Current files: {name}</option>
            )}
          {sources?.map((source) => (
            <option
              key={`${source.name}@${source.hash}`}
              value={`${source.name}@${source.hash}`}
            >
              {source.name} · {shortDateTime(source.first_acknowledged_at)} ·{" "}
              {source.files} files
            </option>
          ))}
        </select>
      </label>
      {error && (
        <div role="alert">
          <p>Could not load starter files.</p>
          <button
            type="button"
            disabled={disabled}
            onClick={() => setReload((n) => n + 1)}
          >
            Refresh files
          </button>
          <details>
            <summary>Details</summary>
            <p>{error}</p>
          </details>
        </div>
      )}
      {sources?.length === 0 && (
        <p>Ask the server administrator to publish starter files.</p>
      )}
      {current && (
        <details>
          <summary>File details</summary>
          <p style={{ overflowWrap: "anywhere" }}>
            {name} · {hash}
          </p>
        </details>
      )}
    </>
  );
}
