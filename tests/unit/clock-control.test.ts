import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { Store } from "../../apps/server/src/db.js";
import { Monitoring } from "../../apps/server/src/monitoring.js";
import { Lifecycle } from "../../apps/server/src/lifecycle.js";
import { ClockControl } from "../../apps/server/src/clock-control.js";
const stores: Store[] = [];
afterEach(() => {
  for (const s of stores) s.close();
  for (const s of stores) rmSync(s.dir, { recursive: true, force: true });
  stores.length = 0;
});
function setup(connected = true) {
  const store = new Store(mkdtempSync(tmpdir() + "/clock-control-"));
  stores.push(store);
  const start = Date.now() - 60000,
    deadline = start + 5400000;
  store.db.prepare("INSERT INTO exams VALUES('e','{}')").run();
  store.db
    .prepare(
      "INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline,last_contact) VALUES('a','e','alice',1001,'ACTIVE','{}',?,?,?,?)",
    )
    .run(start, deadline, deadline, Date.now());
  let remote: any = {
    id: "a",
    exam: "e",
    username: "alice",
    uid: 1001,
    state: "ACTIVE",
    start,
    deadline,
    original_deadline: deadline,
    generation: 0,
    clock_revision: 0,
    clock_resets: [],
  };
  const calls: string[] = [];
  const agent: any = {
    connected: () => connected,
    call: async (op: string, body: any) => {
      calls.push(op);
      if (op === "reset-clock") {
        const previous = remote.deadline;
        remote = {
          ...remote,
          deadline: body.extend_seconds
            ? previous + body.extend_seconds * 1000
            : body.requested_at + body.remaining_seconds * 1000,
          clock_revision: remote.clock_revision + 1,
          clock_resets: [
            ...remote.clock_resets,
            {
              id: body.reset_id,
              actor: body.actor,
              requested_at: body.requested_at,
              applied_at: Date.now(),
              previous_deadline: previous,
              deadline: body.extend_seconds
                ? previous + body.extend_seconds * 1000
                : body.requested_at + body.remaining_seconds * 1000,
              remaining_seconds: body.remaining_seconds,
              ...(body.extend_seconds
                ? { extend_seconds: body.extend_seconds }
                : {}),
              revision: remote.clock_revision + 1,
            },
          ],
        };
      }
      return remote;
    },
  };
  const life = new Lifecycle(store, agent, new Monitoring(store));
  const clocks = new ClockControl(store, agent, life);
  return { store, life, clocks, calls, remote: () => remote };
}
it("uses the same pre-deadline acceptance instant for eligibility and native request", () => {
  const f = setup(false);
  const at = Date.now();
  f.store.db
    .prepare("UPDATE attempts SET deadline=? WHERE id='a'")
    .run(at + 1000);
  const clock = vi
    .spyOn(Date, "now")
    .mockReturnValueOnce(at)
    .mockReturnValue(at + 2000);
  try {
    const request = f.clocks.stage("a", 10, "instructor", 0);
    expect(request.requested_at).toBe(at);
    expect(request.requested_at).toBeLessThan(request.deadline);
  } finally {
    clock.mockRestore();
  }
});
it("resets a live clock without logout, records instructor and retains the original interval", async () => {
  const f = setup();
  let changed = 0,
    ended = 0,
    paused = 0;
  f.life.onClockChanged = () => changed++;
  f.life.onEnd = () => ended++;
  f.life.onPaused = () => paused++;
  const before = f.store.attempt("a");
  const response = await f.clocks.reset("a", 20, "instructor", 0);
  const after = f.store.attempt("a");
  expect(response.confirmed).toBe(true);
  expect(after.deadline).toBeGreaterThan(Date.now() + 1199000);
  expect(after.start).toBe(before.start);
  expect(after.original_deadline).toBe(before.deadline);
  expect(after.state).toBe("ACTIVE");
  expect(after.generation).toBe(0);
  expect({ changed, ended, paused }).toEqual({
    changed: 1,
    ended: 0,
    paused: 0,
  });
  expect(f.calls).toEqual(["reset-clock"]);
  expect(JSON.parse(after.clock_resets)[0].actor).toBe("instructor");
});
it("retains disconnected resets across webserver restarts and applies a signed reconciliation once", async () => {
  const f = setup(false);
  const id = randomUUID();
  f.store.db.prepare("UPDATE attempts SET state='LOCKED' WHERE id='a'").run();
  const result = await f.clocks.reset("a", 90, "instructor", 0, id);
  expect(result.confirmed).toBe(false);
  expect(f.calls).toEqual([]);
  const request = f.clocks.pending("a");
  const second = new Store(f.store.dir);
  stores.push(second);
  const recovered = new ClockControl(
    second,
    {} as any,
    new Lifecycle(second, {} as any, new Monitoring(second)),
  );
  expect(recovered.pending("a")).toEqual(request);
  await expect(f.clocks.reset("a", 30, "instructor", 0)).rejects.toThrow(
    "already awaiting",
  );
  const remote = {
    ...f.remote(),
    state: "LOCKED",
    clock_revision: 1,
    deadline: request.requested_at + request.remaining_seconds * 1000,
    clock_resets: [
      {
        id: request.reset_id,
        actor: request.actor,
        requested_at: request.requested_at,
        applied_at: Date.now(),
        previous_deadline: request.deadline,
        deadline: request.requested_at + request.remaining_seconds * 1000,
        remaining_seconds: request.remaining_seconds,
        revision: 1,
      },
    ],
  };
  f.life.acceptRemote(remote);
  expect(recovered.pending("a")).toBeNull();
  f.life.acceptRemote(remote);
  expect(f.store.attempt("a").clock_revision).toBe(1);
  const retry = await f.clocks.reset("a", 90, "instructor", 0, id);
  expect(retry.confirmed).toBe(true);
  expect(f.calls).toEqual([]);
});
it("ignores pre-reset completion callbacks and rejects unversioned or conflicting clock changes", async () => {
  const f = setup();
  const old = { ...f.remote() };
  await f.clocks.reset("a", 90, "instructor", 0);
  f.life.acceptRemote({ ...old, state: "COMPLETED", protected: true });
  expect(f.store.attempt("a").state).toBe("ACTIVE");
  expect(() =>
    f.life.acceptRemote({
      ...f.remote(),
      deadline: f.remote().deadline + 1000,
    }),
  ).toThrow("without an instructor");
  expect(() =>
    f.life.acceptRemote({
      ...f.remote(),
      original_deadline: f.remote().original_deadline + 1000,
    }),
  ).toThrow("Original exam interval");
  await expect(f.clocks.reset("a", 90, "instructor", 0)).rejects.toThrow(
    "Clock changed",
  );
});
it.each(["COMPLETED", "FINALIZING", "COLLECTION_FAILED", "PREPARING"])(
  "cannot reset %s",
  async (state) => {
    const f = setup(false);
    f.store.db.prepare("UPDATE attempts SET state=? WHERE id='a'").run(state);
    await expect(f.clocks.reset("a", 90, "instructor", 0)).rejects.toThrow(
      "unfinished",
    );
  },
);

it("adds exact minutes to the existing deadline and retries once without losing original hold", async () => {
  const f = setup();
  const before = f.store.attempt("a");
  const id = randomUUID();
  const r = await f.clocks.reset("a", 7, "instructor", 0, id, false, true);
  expect(r.confirmed).toBe(true);
  expect(f.store.attempt("a").deadline).toBe(before.deadline! + 420000);
  expect(f.store.attempt("a").original_deadline).toBe(before.deadline);
  await f.clocks.reset("a", 7, "instructor", 0, id, false, true);
  expect(f.store.attempt("a").clock_revision).toBe(1);
});

it("a verified early finish closes a pending reset and never reports a retry as applied", async () => {
  const f = setup(false),
    requestID = randomUUID();
  await f.clocks.reset("a", 7, "instructor", 0, requestID);
  const remote = {
    ...f.remote(),
    state: "COMPLETED",
    protected: true,
    checksum: "a".repeat(64),
    ended: Date.now(),
    completed_at: Date.now(),
  };
  f.life.acceptRemote(remote, {
    attempt: remote,
    checksum: remote.checksum,
    collected: Date.now(),
    secured: Date.now(),
    files: [],
    omissions: [],
  });
  expect(f.clocks.pending("a")).toBeNull();
  expect(f.store.attempt("a").state).toBe("COMPLETED");
  await expect(
    f.clocks.reset("a", 7, "instructor", 0, requestID),
  ).rejects.toThrow("attempt finished");
});
