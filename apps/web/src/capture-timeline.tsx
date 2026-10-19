import React, { useEffect, useState } from "react";
import { chicago } from "./api.js";
import { formatDuration } from "../../../packages/protocol/time.js";

type Frame = { id: string; source: string; captured: number; received: number };
export function CaptureTimeline({
  source,
  frames,
  username,
  working,
  clock,
}: {
  source: string;
  frames: Frame[];
  username: string;
  working: boolean;
  clock: number;
}) {
  const label = source === "screen" ? "Screen" : "Webcam";
  const ordered = frames
    .filter((f) => f.source === source)
    .sort(
      (a, b) =>
        a.captured - b.captured ||
        a.received - b.received ||
        a.id.localeCompare(b.id),
    );
  const latest = ordered.at(-1);
  const [selection, setSelection] = useState(() =>
    working ? "live" : latest?.id || "latest",
  );
  const [failed, setFailed] = useState("");
  const [retry, setRetry] = useState(0);
  const live = working && selection === "live";
  const index =
    selection === "live" || selection === "latest"
      ? ordered.length - 1
      : ordered.findIndex((f) => f.id === selection);
  const shown = ordered[index] || latest;
  // A pause/finish freezes the selected capture. A later resume must not silently
  // move an instructor out of history; they explicitly choose Live again.
  useEffect(() => {
    if (selection === "live" && !working) setSelection(latest?.id || "latest");
    else if (selection !== "live" && selection !== "latest" && index < 0)
      setSelection(latest?.id || "latest");
  }, [selection, working, latest?.id, index]);
  return (
    <figure aria-label={`${label} captures`}>
      <figcaption>
        <strong>{label}</strong>
        <span>
          {live ? "Live · " : ""}
          {shown
            ? `${formatDuration((clock - shown.captured) / 1000)} ago`
            : "No captures"}
        </span>
      </figcaption>
      {shown ? (
        <>
          <img
            key={`${shown.id}:${retry}`}
            alt={`${label} capture for ${username}`}
            src={`/api/admin/media/${shown.id}`}
            hidden={failed === shown.id}
            onError={() => setFailed(shown.id)}
          />
          {failed === shown.id && (
            <p className="monitoring-empty" role="alert">
              Image unavailable.{" "}
              <button
                onClick={() => {
                  setFailed("");
                  setRetry((n) => n + 1);
                }}
              >
                Retry image
              </button>
            </p>
          )}
          <div className="capture-controls">
            <div className="capture-selected">
              <time
                dateTime={new Date(shown.captured).toISOString()}
                title={`Received ${chicago(shown.received)}`}
              >
                {chicago(shown.captured)}
              </time>
              {working && (
                <button
                  className={live ? "live-selected" : ""}
                  aria-label={`Live ${source}`}
                  aria-pressed={live}
                  title="Follow incoming captures"
                  onClick={() => setSelection("live")}
                >
                  Live
                </button>
              )}
            </div>
            <input
              type="range"
              aria-label={`${label} timeline`}
              aria-valuetext={`${chicago(shown.captured)}${live ? ", live" : ""}`}
              min={0}
              max={Math.max(0, ordered.length - 1)}
              value={Math.max(0, index)}
              disabled={ordered.length < 2}
              onChange={(event) => {
                const f = ordered[Number(event.target.value)];
                if (f) setSelection(f.id);
              }}
            />
            <div className="capture-bounds">
              <span>{chicago(ordered[0].captured)}</span>
              <span>{chicago(latest!.captured)}</span>
            </div>
          </div>
        </>
      ) : (
        <p className="monitoring-empty">No {source} images received.</p>
      )}
    </figure>
  );
}
