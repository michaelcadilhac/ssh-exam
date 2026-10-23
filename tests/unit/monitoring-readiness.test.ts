import { afterEach, expect, it, vi } from "vitest";
import type { Attempt } from "../../apps/server/src/db.js";
import { MonitoringReadiness } from "../../apps/server/src/monitoring-readiness.js";

const clock = vi.hoisted(() => ({ now: 10000, fail: false }));
vi.mock("../../apps/server/src/monitoring-clock.js", () => ({
  monitoringBootTimeMS: () => {
    if (clock.fail) throw Error("synthetic clock unavailable");
    return clock.now;
  },
}));
afterEach(() => {
  clock.now = 10000;
  clock.fail = false;
});
const page = "synthetic-page",
  readiness = {
    fullscreen: true,
    visible: true,
    focus: true,
    keyboard: true,
    screen: true,
    webcam: true,
  };
const attempt = (id = "synthetic") =>
  ({
    id,
    page_hash: page,
    generation: 0,
    settings: '{"webcam":true}',
    state: "PREPARING",
  }) as Attempt;
it("bounded steady capture supports both sources without exhausting tickets", () => {
  const ledger = new MonitoringReadiness(),
    a = attempt();
  for (let seq = 1; seq <= 240; seq++) {
    for (const source of ["screen", "webcam"]) {
      const ticket = ledger.issue(a, page, source, seq - 1),
        input = { source, seq, challenge: ticket.challenge, readiness };
      ledger.confirm(a, page, input, { id: source + seq, hash: "hash" });
    }
    expect(ledger.inspect(a, page)).toMatchObject({
      complete: true,
      age_ms: 0,
    });
    clock.now += 5000;
  }
});
it("capacity refuses without evicting current evidence; abandoned scopes expire", () => {
  const ledger = new MonitoringReadiness();
  for (let i = 0; i < 512; i++)
    ledger.issue(attempt("scope-" + i), page, "screen", 0);
  expect(() => ledger.issue(attempt("overflow"), page, "screen", 0)).toThrow(
    "capacity",
  );
  clock.now += 120001;
  expect(() =>
    ledger.issue(attempt("replacement"), page, "screen", 0),
  ).not.toThrow();
});
it("a delayed negative observation requires a new challenge even after a newer positive reply", () => {
  const ledger = new MonitoringReadiness(),
    a = attempt();
  const old = ledger.issue(a, page, "screen", 0),
    camera = ledger.issue(a, page, "webcam", 0);
  ledger.confirm(
    a,
    page,
    { source: "webcam", seq: 1, challenge: camera.challenge, readiness },
    { id: "camera", hash: "hash" },
  );
  ledger.confirm(
    a,
    page,
    {
      source: "screen",
      seq: 1,
      challenge: old.challenge,
      readiness: { ...readiness, focus: false },
    },
    { id: "screen", hash: "hash" },
  );
  expect(ledger.inspect(a, page).complete).toBe(false);
  const fresh = ledger.issue(a, page, "screen", 1);
  ledger.confirm(
    a,
    page,
    { source: "screen", seq: 2, challenge: fresh.challenge, readiness },
    { id: "restored", hash: "hash" },
  );
  expect(ledger.inspect(a, page).complete).toBe(true);
});
it("restart and a regressing or invalid clock never reconstruct readiness", () => {
  const ledger = new MonitoringReadiness(),
    a = attempt();
  for (const source of ["screen", "webcam"]) {
    const ticket = ledger.issue(a, page, source, 0);
    ledger.confirm(
      a,
      page,
      { source, seq: 1, challenge: ticket.challenge, readiness },
      { id: source, hash: "hash" },
    );
  }
  expect(ledger.inspect(a, page).complete).toBe(true);
  expect(new MonitoringReadiness().inspect(a, page).complete).toBe(false);
  clock.fail = true;
  expect(() => ledger.inspect(a, page)).toThrow("monitoring clock");
  clock.fail = false;
  clock.now--;
  expect(() => ledger.inspect(a, page)).toThrow("clock");
  clock.now = NaN;
  expect(() => ledger.inspect(a, page)).toThrow("clock");
});
