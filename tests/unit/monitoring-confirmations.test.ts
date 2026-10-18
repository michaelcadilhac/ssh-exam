import { expect, it } from "vitest";
import { MonitoringConfirmations } from "../../apps/web/src/monitoring-confirmations.js";

it("confirms a recent round trip once, including a request issued at monotonic zero", () => {
  let time = 0;
  const c = new MonitoringConfirmations(() => time);
  c.issue("current");
  time = 3000;
  expect(c.confirm("unrelated state reply")).toBe(false);
  expect(c.confirm("current")).toBe(true);
  expect(c.confirm("current")).toBe(false);
});
it("rejects late and retired-connection acknowledgments without relying on wall-clock snapshots", () => {
  let time = 0;
  const c = new MonitoringConfirmations(() => time);
  c.issue("late");
  time = 15000;
  expect(c.confirm("late")).toBe(false);
  c.issue("old-socket");
  c.clear();
  expect(c.confirm("old-socket")).toBe(false);
  c.issue("new-socket");
  time += 14999;
  expect(c.confirm("new-socket")).toBe(true);
});
it("bounds outstanding requests on a silent connection", () => {
  const c = new MonitoringConfirmations(() => 0);
  for (let i = 0; i < 100; i++) c.issue(String(i));
  expect(c.confirm("0")).toBe(false);
  expect(c.confirm("83")).toBe(false);
  expect(c.confirm("84")).toBe(true);
  expect(c.confirm("99")).toBe(true);
});
