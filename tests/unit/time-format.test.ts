import { expect, it } from "vitest";
import {
  formatCountdown,
  formatDuration,
} from "../../packages/protocol/time.js";
it.each([
  [0, "0s"],
  [-10, "0s"],
  [59.9, "59s"],
  [60, "1min"],
  [125, "2min 5s"],
  [3600, "1h"],
  [5400, "1h 30min"],
  [90061, "1d 1h 1min 1s"],
  [NaN, "—"],
])("formats %s seconds with readable units", (value, expected) => {
  expect(formatDuration(value as number)).toBe(expected);
});
it.each([
  [0, "0:00"],
  [-5, "0:00"],
  [0.01, "0:01"],
  [59.1, "1:00"],
  [3599, "59:59"],
  [3600, "1:00:00"],
  [5400, "1:30:00"],
  [7200, "2:00:00"],
  [NaN, "—"],
])("formats an exact countdown for %s seconds", (value, expected) => {
  expect(formatCountdown(value as number)).toBe(expected);
});
