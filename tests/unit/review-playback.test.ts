import { expect, it } from "vitest";
import {
  captureAt,
  orderedCaptures,
  type PlaybackFrame,
} from "../../apps/web/src/review-playback.js";
const frames: PlaybackFrame[] = [
  { id: "screen-a", source: "screen", captured: 1000, received: 40000 },
  { id: "screen-b", source: "screen", captured: 6000, received: 6002 },
  { id: "screen-c", source: "screen", captured: 21000, received: 21001 },
  { id: "camera-a", source: "webcam", captured: 1500, received: 1501 },
  { id: "camera-b", source: "webcam", captured: 6500, received: 6501 },
];
it("uses one original timestamp across staggered camera/screen captures, never receipt order", () => {
  const screen = orderedCaptures(frames, "screen"),
    camera = orderedCaptures(frames, "webcam");
  expect(captureAt(screen, 6500)?.id).toBe("screen-b");
  expect(captureAt(camera, 6500)?.id).toBe("camera-b");
  expect(captureAt(screen, 6000)?.id).toBe("screen-b");
  expect(captureAt(camera, 6000)?.id).toBe("camera-a");
});
it("shows gaps rather than future, indefinitely stale or missing captures", () => {
  const screen = orderedCaptures(frames, "screen");
  expect(captureAt(screen, 999)).toBeNull();
  expect(captureAt(screen, 10999)?.id).toBe("screen-b");
  expect(captureAt(screen, 11000)).toBeNull();
  expect(captureAt(screen, 21000)?.id).toBe("screen-c");
  expect(captureAt([], 21000)).toBeNull();
});
it("orders deterministically without mutating evidence and retains exact stored offsets", () => {
  const before = structuredClone(frames),
    mapped = {
      ...frames[0],
      video: {
        segment: "11111111-1111-4111-8111-111111111111",
        offset_ms: 10000,
        duration_ms: 15000,
      },
    };
  expect(captureAt(orderedCaptures([mapped]), 1000)?.video).toEqual(
    mapped.video,
  );
  orderedCaptures(frames);
  expect(frames).toEqual(before);
  expect(
    orderedCaptures([
      { ...frames[0], id: "z" },
      { ...frames[0], id: "a" },
    ]).map((f) => f.id),
  ).toEqual(["a", "z"]);
});
