import { expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { Store } from "../../apps/server/src/db.js";
import { studentContinuationStatus } from "../../apps/server/src/continuation-status.js";
import {
  ContinuationStatusTracker,
  continuationNotice,
} from "../../apps/web/src/continuation-status.js";

function fixture() {
  const dir = mkdtempSync(tmpdir() + "/student-approval-");
  const store = new Store(dir);
  store.db.exec(
    "INSERT INTO exams VALUES('e','{}'); INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline,generation,page_hash,access_state) VALUES('a','e','alice',1001,'LOCKED','{}',1,900000,900000,2,'PRIVATE-PAGE','HELD')",
  );
  store.interruptions.pause(store.attempt("a"), "PRIVATE-REASON", 1000);
  return {
    store,
    close: () => {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

it("presents current, expired, consumed and superseded approval without granting work or changing records", () => {
  const f = fixture();
  try {
    const a = f.store.attempt("a"),
      before = JSON.stringify(
        f.store.db.prepare("SELECT * FROM attempts").all(),
      );
    expect(
      studentContinuationStatus(f.store, a, undefined, 100000),
    ).toMatchObject({ state: "waiting", execution: false });
    const current = { generation: 2, expires: 400000, consumed: 0 };
    expect(
      studentContinuationStatus(f.store, a, current, 100000),
    ).toMatchObject({ state: "approved", expires: 400000, execution: false });
    expect(studentContinuationStatus(f.store, a, current, 400000).state).toBe(
      "expired",
    );
    expect(
      studentContinuationStatus(f.store, a, { ...current, consumed: 1 }, 100000)
        .state,
    ).toBe("used");
    expect(
      studentContinuationStatus(
        f.store,
        a,
        { ...current, generation: 1 },
        100000,
      ).state,
    ).toBe("superseded");
    expect(
      studentContinuationStatus(
        f.store,
        { ...a, deadline: 200000 },
        current,
        100000,
      ).expires,
    ).toBe(200000);
    for (const patch of [
      { protected: 1 },
      { start: null },
      { ended: 99999 },
      { deadline: 100000 },
    ])
      expect(
        studentContinuationStatus(f.store, { ...a, ...patch }, current, 100000)
          .state,
      ).toBe("unavailable");
    expect(
      studentContinuationStatus(
        f.store,
        { ...a, state: "ACTIVE" },
        { ...current, consumed: 1 },
        100000,
      ).state,
    ).toBe("resumed");
    expect(
      JSON.stringify(f.store.db.prepare("SELECT * FROM attempts").all()),
    ).toBe(before);
    expect(
      JSON.stringify(studentContinuationStatus(f.store, a, current, 100000)),
    ).not.toContain("PRIVATE");
  } finally {
    f.close();
  }
});

it("uses bounded operational history to explain removed grants but never reconstructs approval from it", () => {
  const f = fixture();
  try {
    f.store.interruptions.authorize(
      f.store.attempt("a"),
      "PRIVATE-INSTRUCTOR",
      400000,
      false,
      100000,
    );
    let a = f.store.attempt("a");
    // History says authorized but the operational grant does not exist: no
    // presentation of usable permission may be reconstructed from the history.
    expect(studentContinuationStatus(f.store, a, undefined, 110000).state).toBe(
      "revoked",
    );
    expect(studentContinuationStatus(f.store, a, undefined, 400000).state).toBe(
      "expired",
    );
    f.store.db.exec("UPDATE attempts SET generation=3 WHERE id='a'");
    f.store.interruptions.pause(
      f.store.attempt("a"),
      "NEW-PRIVATE-REASON",
      120000,
    );
    a = f.store.attempt("a");
    const result = studentContinuationStatus(f.store, a, undefined, 130000);
    expect(result).toMatchObject({
      state: "revoked",
      generation: 3,
      execution: false,
    });
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
    f.store.db
      .prepare(
        "UPDATE attempt_interruptions SET authorizations=? WHERE attempt='a'",
      )
      .run("{bad-private");
    expect(
      studentContinuationStatus(
        f.store,
        f.store.attempt("a"),
        undefined,
        130000,
      ).state,
    ).toBe("unknown");
    f.store.db
      .prepare(
        "UPDATE attempt_interruptions SET authorizations=? WHERE attempt='a'",
      )
      .run("x".repeat(65537));
    expect(
      studentContinuationStatus(
        f.store,
        f.store.attempt("a"),
        undefined,
        130000,
      ).state,
    ).toBe("unknown");
  } finally {
    f.close();
  }
});

const scope = { id: "a", generation: 2, continuation_revision: 3 };
const presentation = (patch: Record<string, unknown> = {}) => ({
  v: 1,
  attempt: "a",
  generation: 2,
  revision: 3,
  state: "approved",
  expires: 400000,
  observedAt: 100000,
  execution: false,
  ...patch,
});

it("fences wrong target, generation, review revision, observation and malformed status without state or input authority", () => {
  const t = new ContinuationStatusTracker();
  t.observeAttempt(scope);
  expect(t.accept(presentation(), scope, 100000)).toBe(true);
  for (const patch of [
    { attempt: "b" },
    { generation: 1 },
    { revision: 2 },
    { observedAt: 99999 },
    { execution: true },
    { state: "ACTIVE" },
    { expires: 99999 },
    { private: "MUST-NOT-RENDER" },
  ])
    expect(t.accept(presentation(patch), scope, 100000)).toBe(false);
  expect(t.view(scope, 100000)).toMatchObject({ state: "approved" });
  expect(t.view(scope, 400000)).toMatchObject({ state: "expired" });
  expect(t.accept(presentation({ observedAt: 200000 }), scope, 200000)).toBe(
    true,
  );
  expect(t.view(scope, 200000)).toMatchObject({ state: "expired" });
  expect(scope).toEqual({ id: "a", generation: 2, continuation_revision: 3 });
});

it("does not replace revocation with an older approval or confuse a new interruption with waiting on the old approval", () => {
  const t = new ContinuationStatusTracker();
  t.observeAttempt(scope);
  t.accept(presentation(), scope, 100000);
  const changed = { ...scope, continuation_revision: 4 };
  t.observeAttempt(changed);
  expect(t.view(changed, 110000).state).toBe("unknown");
  expect(t.accept(presentation(), changed, 100000)).toBe(false);
  expect(
    t.accept(
      presentation({ revision: 4, state: "revoked", observedAt: 110000 }),
      changed,
      110000,
    ),
  ).toBe(true);
  expect(t.accept(presentation({ observedAt: 120000 }), changed, 120000)).toBe(
    false,
  );
  const next = { ...changed, generation: 3, continuation_revision: 5 };
  t.observeAttempt(next);
  expect(t.view(next, 120000).state).toBe("superseded");
  expect(
    t.accept(presentation({ revision: 999, observedAt: 130000 }), next, 130000),
  ).toBe(false);
  expect(
    t.accept(
      presentation({
        generation: 3,
        revision: 5,
        state: "waiting",
        expires: null,
        observedAt: 130000,
      }),
      next,
      130000,
    ),
  ).toBe(true);
  expect(t.view(next, 130000).state).toBe("waiting");
});

it("gives distinct current/expired/revoked instructions and never asks a retained path to sign in solely for approval", () => {
  expect(
    continuationNotice({ state: "approved", expires: 400000 }, true),
  ).toContain("SSH is disconnected");
  expect(
    continuationNotice({ state: "approved", expires: 400000 }, false),
  ).toContain("only if it is actually disconnected");
  for (const state of [
    "waiting",
    "expired",
    "revoked",
    "superseded",
    "used",
    "unknown",
    "resumed",
  ] as const)
    expect(continuationNotice({ state, expires: null }, false)).not.toBe(
      continuationNotice({ state: "approved", expires: 400000 }, false),
    );
});
