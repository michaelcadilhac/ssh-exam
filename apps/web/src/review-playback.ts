import type { MonitoringPlaybackVideo } from "../../../packages/protocol/monitoring-video.js";

export type PlaybackFrame = {
  id: string;
  source: string;
  captured: number;
  received: number;
  video?: MonitoringPlaybackVideo;
};
export const captureInterval = 5000;
export function orderedCaptures(frames: PlaybackFrame[], source?: string) {
  return frames
    .filter(
      (frame) =>
        (!source || frame.source === source) &&
        Number.isSafeInteger(frame.captured) &&
        frame.captured >= 0,
    )
    .sort(
      (a, b) =>
        a.captured - b.captured ||
        a.received - b.received ||
        a.id.localeCompare(b.id),
    );
}
// Do not substitute a future sample or stretch a missing capture indefinitely.
export function captureAt(frames: PlaybackFrame[], time: number) {
  let lo = 0,
    hi = frames.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (frames[mid].captured <= time) lo = mid + 1;
    else hi = mid;
  }
  const frame = frames[lo - 1];
  return frame && time - frame.captured < captureInterval ? frame : null;
}
