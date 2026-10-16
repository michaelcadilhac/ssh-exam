import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { Store } from "../../apps/server/src/db.js";
import { Monitoring } from "../../apps/server/src/monitoring.js";
import { Lifecycle } from "../../apps/server/src/lifecycle.js";
import { reportFocus } from "../../apps/server/src/focus-grace.js";
import {
  FOCUS_GRACE_REASON,
  focusGraceSeconds,
} from "../../packages/protocol/focus-grace.js";
import { messageSchema, readySchema } from "../../packages/protocol/index.js";
const stores: Store[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const s of stores) {
    s.close();
    rmSync(s.dir, { recursive: true, force: true });
  }
  stores.length = 0;
});
function setup(state = "ACTIVE") {
  const store = new Store(mkdtempSync(tmpdir() + "/focus-grace-"));
  stores.push(store);
  let at = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => at);
  store.db.prepare("INSERT INTO exams VALUES('e','{}')").run();
  store.db
    .prepare(
      "INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,last_contact) VALUES('a','e','alice',1001,?,'{}',?,?,?)",
    )
    .run(state, at - 10000, at + 5400000, at);
  let paused = 0;
  const life = new Lifecycle(
    store,
    { call: async () => ({ generation: 1 }) } as any,
    new Monitoring(store),
  );
  life.onPaused = () => paused++;
  return {
    store,
    life,
    paused: () => paused,
    advance(ms: number, contact = true) {
      at += ms;
      if (contact)
        store.db
          .prepare("UPDATE attempts SET last_contact=? WHERE id='a'")
          .run(at);
    },
  };
}
it("retains an active connection through focus loss up to 20 seconds, without extending deadline", async () => {
  const f = setup(),
    deadline = f.store.attempt("a").deadline;
  await reportFocus(f.life, "a", false);
  f.advance(19999);
  await f.life.tick();
  expect(f.store.attempt("a").state).toBe("ACTIVE");
  await reportFocus(f.life, "a", true);
  expect(f.store.attempt("a").focus_lost_at).toBeNull();
  f.advance(30000);
  await f.life.tick();
  expect(f.store.attempt("a").state).toBe("ACTIVE");
  expect(f.store.attempt("a").deadline).toBe(deadline);
  expect(f.paused()).toBe(0);
});
it("repeated blur and heartbeats cannot restart the server countdown", async () => {
  const f = setup();
  await reportFocus(f.life, "a", false);
  const first = f.store.attempt("a").focus_lost_at;
  f.advance(12000);
  await reportFocus(f.life, "a", false);
  expect(f.store.attempt("a").focus_lost_at).toBe(first);
  f.advance(8000);
  await f.life.tick();
  expect(f.store.attempt("a")).toMatchObject({
    state: "LOCKED",
    reason: FOCUS_GRACE_REASON,
  });
  expect(f.paused()).toBe(1);
});
it("a late focus return cannot evade the cutoff between server timer ticks", async () => {
  const f = setup();
  await reportFocus(f.life, "a", false);
  f.advance(20000);
  await reportFocus(f.life, "a", true);
  expect(f.store.attempt("a").state).toBe("LOCKED");
  await reportFocus(f.life, "a", true);
  expect(f.paused()).toBe(1);
});
it("does not delay other incidents or lost-network enforcement", async () => {
  const f = setup();
  await reportFocus(f.life, "a", false);
  f.advance(15001, false);
  await f.life.tick();
  expect(f.store.attempt("a").reason).toBe(
    "Client contact exceeded 15 seconds",
  );
});
it("ignores focus changes during preflight and keeps start/continue readiness strict", async () => {
  const f = setup("PREPARING");
  await reportFocus(f.life, "a", false);
  f.advance(30000);
  expect(f.store.attempt("a").focus_lost_at).toBeNull();
  expect(f.paused()).toBe(0);
  const ready = {
    fullscreen: true,
    focus: false,
    visible: true,
    keyboard: true,
    screen: true,
    webcam: false,
  };
  expect(readySchema.safeParse(ready).success).toBe(false);
  expect(
    messageSchema.safeParse({ v: 1, type: "heartbeat", ready }).success,
  ).toBe(true);
  expect(
    messageSchema.safeParse({
      v: 1,
      type: "heartbeat",
      ready: { ...ready, visible: false },
    }).success,
  ).toBe(false);
  expect(
    messageSchema.safeParse({
      v: 1,
      type: "heartbeat",
      ready: { ...ready, fullscreen: false },
    }).success,
  ).toBe(false);
});
it("shows a countdown with a full 20 seconds, including a monotonic zero start", () => {
  expect(focusGraceSeconds(null, 0)).toBeNull();
  expect(focusGraceSeconds(0, 0)).toBe(20);
  expect(focusGraceSeconds(0, 1)).toBe(20);
  expect(focusGraceSeconds(0, 1000)).toBe(19);
  expect(focusGraceSeconds(0, 19999)).toBe(1);
  expect(focusGraceSeconds(0, 20000)).toBe(0);
});
