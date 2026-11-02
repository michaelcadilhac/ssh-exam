import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { chicago } from "./api.js";
import { monitoringPlaybackVideo } from "../../../packages/protocol/monitoring-video.js";
import {
  captureAt,
  captureInterval,
  orderedCaptures,
  type PlaybackFrame,
} from "./review-playback.js";

function CaptureView({
  attempt,
  source,
  frames,
  time,
  username,
  enabled,
  onReady,
  onDeleted,
}: {
  attempt: string;
  source: string;
  frames: PlaybackFrame[];
  time: number;
  username: string;
  enabled: boolean;
  onReady: (source: string, id: string, ready: boolean) => void;
  onDeleted: () => void;
}) {
  const frame = captureAt(frames, time),
    label = source === "screen" ? "Screen" : "Webcam";
  const clip = frame?.video;
  const video = useRef<HTMLVideoElement>(null);
  const previous = useRef<HTMLCanvasElement>(null);
  const [displayed, setDisplayed] = useState<PlaybackFrame | null>(null);
  const [aspectRatio, setAspectRatio] = useState<number>();
  const [asset, setAsset] = useState<{
    segment: string;
    url?: string;
    error?: string;
  } | null>(null);
  const [shown, setShown] = useState(""),
    [imageError, setImageError] = useState("");
  const [retry, setRetry] = useState(0);
  // Keep one bounded decoded preview, not another downloaded segment. It remains
  // visible while the next image downloads or the video decoder seeks.
  const remember = (
    element: HTMLVideoElement | HTMLImageElement,
    width: number,
    height: number,
  ) => {
    const canvas = previous.current;
    if (!enabled || !frame || !canvas || !width || !height) return false;
    const scale = Math.min(1, 1600 / width, 1200 / height);
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context) return false;
    context.drawImage(element, 0, 0, canvas.width, canvas.height);
    setDisplayed(frame);
    setAspectRatio((old) => old ?? width / height);
    setShown(frame.id);
    onReady(source, frame.id, true);
    return true;
  };
  useLayoutEffect(() => {
    const canvas = previous.current;
    return () => {
      if (canvas) canvas.width = canvas.height = 0;
    };
  }, []);
  useLayoutEffect(() => {
    if (!enabled || !frame) {
      const canvas = previous.current;
      if (canvas) canvas.width = canvas.height = 0;
      setDisplayed(null);
    }
  }, [enabled, frame?.id]);
  const segment = clip?.segment;
  useEffect(() => {
    setAsset(null);
    if (!enabled || !segment) return;
    const abort = new AbortController(),
      owned = video.current;
    let objectURL: string | undefined,
      disposed = false;
    void (async () => {
      try {
        const response = await fetch(
          `/api/admin/attempts/${encodeURIComponent(attempt)}/videos/${encodeURIComponent(segment)}`,
          {
            signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]),
            cache: "no-store",
          },
        );
        if (response.status === 410) {
          if (!disposed) onDeleted();
          return;
        }
        if (!response.ok)
          throw Error(
            response.status === 401
              ? "Sign in again to view recordings."
              : "Video unavailable. Retry this recording.",
          );
        if (!response.headers.get("content-type")?.startsWith("video/webm"))
          throw Error("Recording format unavailable.");
        const size = Number(response.headers.get("content-length"));
        if (!Number.isSafeInteger(size) || size < 1 || size > 32 * 1024 * 1024)
          throw Error("Recording size unavailable.");
        const blob = await response.blob();
        if (blob.size !== size)
          throw Error("Recording download was interrupted.");
        if (disposed) return;
        objectURL = URL.createObjectURL(blob);
        setAsset({ segment, url: objectURL });
      } catch (error) {
        if (!disposed) setAsset({ segment, error: (error as Error).message });
      }
    })();
    return () => {
      disposed = true;
      abort.abort();
      if (owned) {
        owned.pause();
        owned.removeAttribute("src");
        owned.load();
      }
      if (objectURL) URL.revokeObjectURL(objectURL);
    };
  }, [attempt, segment, enabled, retry, onDeleted]);
  const url = enabled && asset?.segment === segment ? asset?.url : undefined;
  const seek = useCallback(() => {
    const element = video.current;
    if (!frame || !clip || !url || !element || element.readyState < 1) return;
    if (!monitoringPlaybackVideo.safeParse(clip).success) {
      setAsset({
        segment: clip.segment,
        error: "Recording timing unavailable.",
      });
      return;
    }
    const target = (clip.offset_ms + 1) / 1000;
    if (Math.abs(element.currentTime - target) > 0.0005)
      element.currentTime = target;
  }, [frame?.id, clip?.offset_ms, url]);
  const decoded = () => {
    const element = video.current;
    if (
      !frame ||
      !clip ||
      !url ||
      !element ||
      element.currentSrc !== url ||
      element.readyState < 2 ||
      element.seeking
    )
      return;
    if (Math.abs(element.currentTime - (clip.offset_ms + 1) / 1000) < 0.02) {
      remember(element, element.videoWidth, element.videoHeight);
    }
  };
  useLayoutEffect(() => {
    setShown("");
    setImageError("");
    if (frame) onReady(source, frame.id, false);
    seek();
  }, [frame?.id, url, enabled, seek, onReady, source]);
  useEffect(() => {
    if (!frame?.video || !url || shown === frame.id) return;
    const timer = setTimeout(
      () =>
        setAsset((old) =>
          old?.url === url
            ? {
                segment: frame.video!.segment,
                error: "Video unavailable. Retry this recording.",
              }
            : old,
        ),
      10000,
    );
    return () => clearTimeout(timer);
  }, [frame?.id, url, shown]);
  const failure = frame?.video
    ? asset?.segment === segment
      ? asset?.error
      : undefined
    : imageError;
  const ready = !!frame && shown === frame.id && !failure;
  const retained = enabled && !!frame && !ready && !!displayed;
  const caption = enabled && frame ? (retained ? displayed : frame) : null;
  return (
    <figure aria-label={`${label} captures`}>
      <figcaption>
        <strong>{label}</strong>
        {caption && (
          <time
            dateTime={new Date(caption.captured).toISOString()}
            title={`Received ${chicago(caption.received)}`}
          >
            {chicago(caption.captured)}
          </time>
        )}
      </figcaption>
      <div
        className="capture-viewport"
        style={{ aspectRatio: aspectRatio ?? 4 / 3 }}
      >
        <canvas
          ref={previous}
          hidden={!retained}
          role="img"
          aria-label={`Previous ${source} capture for ${username}`}
          data-frame-id={retained ? displayed?.id : undefined}
        />
        {enabled &&
          frame &&
          (frame.video ? (
            <video
              ref={video}
              muted
              playsInline
              preload="auto"
              src={url}
              aria-label={`${label} recording for ${username}`}
              data-frame-id={shown === frame.id ? frame.id : undefined}
              hidden={!ready}
              onLoadedMetadata={seek}
              onLoadedData={decoded}
              onSeeked={decoded}
              onError={() => {
                if (url)
                  setAsset({
                    segment: segment!,
                    error: "Video unavailable. Retry this recording.",
                  });
              }}
            />
          ) : (
            <img
              key={`${frame.id}:${retry}`}
              alt={`${label} capture for ${username}`}
              src={`/api/admin/media/${frame.id}`}
              hidden={!ready}
              data-frame-id={ready ? frame.id : undefined}
              onLoad={(event) => {
                setImageError("");
                const image = event.currentTarget;
                remember(image, image.naturalWidth, image.naturalHeight);
              }}
              onError={() =>
                setImageError("Image unavailable. Retry this recording.")
              }
            />
          ))}
        {!frames.length ? (
          <p className="monitoring-empty">No {source} images received.</p>
        ) : !frame ? (
          <p className="monitoring-empty">No {source} capture at this time.</p>
        ) : !enabled ? null : failure ? (
          <p role="alert" className="capture-loading">
            {failure}{" "}
            <button onClick={() => setRetry((n) => n + 1)}>
              Retry {source}
            </button>
          </p>
        ) : !ready ? (
          <p role="status" className="capture-loading">
            Loading {source} {frame.video ? "recording" : "image"}…
          </p>
        ) : null}
      </div>
    </figure>
  );
}

export function CaptureTimeline({
  attempt,
  frames,
  username,
  working,
  webcam,
  active,
  deleted,
}: {
  attempt: string;
  frames: PlaybackFrame[];
  username: string;
  working: boolean;
  webcam: boolean;
  active: boolean;
  deleted: boolean;
}) {
  const tracks = useMemo(
    () => ({
      screen: orderedCaptures(frames, "screen"),
      webcam: orderedCaptures(frames, "webcam"),
    }),
    [frames],
  );
  const sources =
    webcam || tracks.webcam.length ? ["screen", "webcam"] : ["screen"];
  const all = useMemo(() => orderedCaptures(frames), [frames]),
    start = all[0]?.captured ?? 0,
    end = all.at(-1)?.captured ?? 0;
  const [follow, setFollow] = useState(working),
    [position, setPosition] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false),
    [speed, setSpeed] = useState(60);
  const [visible, setVisible] = useState(document.visibilityState !== "hidden");
  const [removed, setRemoved] = useState(deleted);
  const enabled = active && visible && !removed && !deleted;
  const time =
    follow && working ? end : Math.max(start, Math.min(end, position ?? start));
  const current = useRef(time),
    lastRendered = useRef(time);
  current.current = time;
  const [ready, setReady] = useState<
    Record<string, { id: string; ready: boolean }>
  >({});
  const report = useCallback(
    (source: string, id: string, value: boolean) =>
      setReady((old) =>
        old[source]?.id === id && old[source]?.ready === value
          ? old
          : { ...old, [source]: { id, ready: value } },
      ),
    [],
  );
  const remove = useCallback(() => {
    setRemoved(true);
    setPlaying(false);
  }, []);
  const loaded = sources.every((source) => {
    const frame = captureAt(tracks[source as "screen" | "webcam"], time);
    return !frame || (ready[source]?.id === frame.id && ready[source]?.ready);
  });
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  useEffect(() => {
    if (!enabled) setPlaying(false);
  }, [enabled]);
  useEffect(() => {
    if (follow && !working) {
      setPosition(lastRendered.current);
      setFollow(false);
    }
    lastRendered.current = time;
  }, [working, follow, time]);
  useEffect(() => {
    if (!playing || !enabled || !loaded) return;
    let previous = performance.now();
    const timer = setInterval(() => {
      const now = performance.now(),
        next = Math.min(
          end,
          current.current + Math.min(100, now - previous) * speed,
        );
      previous = now;
      current.current = next;
      setPosition(next);
      if (next >= end) setPlaying(false);
    }, 40);
    return () => clearInterval(timer);
  }, [playing, enabled, loaded, speed, end]);
  const choose = (next: number) => {
    setPlaying(false);
    setFollow(false);
    current.current = next;
    setPosition(next);
  };
  if (removed || deleted)
    return <p className="monitoring-empty">Recordings were deleted.</p>;
  return (
    <div className="synchronized-recordings">
      {!!all.length && (
        <div
          className="capture-controls"
          role="group"
          aria-label="Recording playback"
        >
          <div className="recording-playback-bar">
            <button
              disabled={all.length < 2}
              aria-label={playing ? "Pause recordings" : "Play recordings"}
              onClick={() => {
                if (playing) {
                  setPlaying(false);
                  return;
                }
                const next = time >= end ? start : time;
                current.current = next;
                setPosition(next);
                setFollow(false);
                setPlaying(true);
              }}
            >
              {playing ? "Pause" : "Play"}
            </button>
            <label>
              Speed{" "}
              <select
                aria-label="Playback speed"
                value={speed}
                onChange={(event) => setSpeed(Number(event.target.value))}
              >
                {[1, 5, 10, 30, 60, 125].map((value) => (
                  <option key={value} value={value}>
                    {value}×
                  </option>
                ))}
              </select>
            </label>
            {working && (
              <button
                aria-label="Live recordings"
                aria-pressed={follow}
                onClick={() => {
                  setPlaying(false);
                  setFollow(true);
                }}
              >
                Live
              </button>
            )}
            <time
              aria-label="Recording time"
              dateTime={new Date(time).toISOString()}
            >
              {chicago(time)}
            </time>
          </div>
          <input
            type="range"
            aria-label="Recording timeline"
            aria-valuetext={chicago(time)}
            min={start}
            max={end}
            step={1}
            value={time}
            disabled={start === end}
            onChange={(event) => choose(Number(event.target.value))}
            onKeyDown={(event) => {
              if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                event.preventDefault();
                choose(
                  Math.max(
                    start,
                    Math.min(
                      end,
                      time +
                        (event.key === "ArrowLeft"
                          ? -captureInterval
                          : captureInterval),
                    ),
                  ),
                );
              }
            }}
          />
          <div className="capture-bounds">
            <span>{chicago(start)}</span>
            <span>{chicago(end)}</span>
          </div>
        </div>
      )}
      <div className="review-images">
        {sources.map((source) => (
          <CaptureView
            key={source}
            attempt={attempt}
            source={source}
            frames={tracks[source as "screen" | "webcam"]}
            time={time}
            username={username}
            enabled={enabled}
            onReady={report}
            onDeleted={remove}
          />
        ))}
      </div>
    </div>
  );
}
