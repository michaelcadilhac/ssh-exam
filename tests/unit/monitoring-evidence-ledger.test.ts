import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import {
  MonitoringEvidenceLedger,
  MonitoringEvidenceUnavailable,
  type MonitoringEvidenceBinding,
} from "../../apps/server/src/monitoring-evidence-ledger.js";

const owner = JSON.parse(
  readFileSync(
    new URL("../fixtures/monitoring-evidence.json", import.meta.url),
    "utf8",
  ),
).owner;
const ready = {
  fullscreen: true,
  visible: true,
  keyboard: true,
  screen: true,
  webcam: true,
  focus: true,
};
const nonce = () => randomBytes(32).toString("hex");

it("technical continuity needs the exact accepted native receipt across an outage, preserving sample ages", () => {
  const f = fixture();
  f.full();
  const proof = f.ledger.issueForNativeChallenge(f.binding, f.request());
  const witness = {
    owner,
    coverage_epoch: proof.coverage_epoch,
    after_sequence: proof.sequence,
    last_accepted_nonce: proof.nonce,
  };
  for (let at = 5000; at <= 25000; at += 5000) {
    f.at(at);
    f.full();
  }
  f.at(26000);
  expect(f.ledger.technicalSnapshot(f.binding, witness)).toMatchObject({
    coverageEpoch: proof.coverage_epoch,
    remainingMS: 14000,
  });
  for (const patch of [
    { last_accepted_nonce: nonce() },
    { after_sequence: proof.sequence + 1 },
    { coverage_epoch: nonce() },
    { last_accepted_nonce: "" },
  ])
    expect(() =>
      f.ledger.technicalSnapshot(f.binding, { ...witness, ...patch }),
    ).toThrow(/technical-gap/);
  // A trusted clock-only carry retains original facts and native acceptance.
  const changed = { ...owner, clock_revision: owner.clock_revision + 1 };
  f.ledger.transferTrustedClock(f.binding, changed);
  expect(
    f.ledger.technicalSnapshot(f.binding, { ...witness, owner: changed })
      .remainingMS,
  ).toBe(14000);
  const next = {
      ...changed,
      generation: changed.generation + 1,
      input_epoch: nonce(),
    },
    accepted = nonce(),
    snapshot = f.ledger.technicalSnapshot(f.binding, {
      ...witness,
      owner: changed,
    });
  f.ledger.transferTechnicalOwner(f.binding, next, {
    nonce: accepted,
    sequence: snapshot.sequence,
    coverage: snapshot.coverageEpoch,
  });
  expect(
    f.ledger.technicalSnapshot(f.binding, {
      owner: next,
      coverage_epoch: snapshot.coverageEpoch,
      after_sequence: snapshot.sequence,
      last_accepted_nonce: accepted,
    }).remainingMS,
  ).toBe(14000);
});

it("fresh frames and technical identity transfer never cure a gap or genuine negative", () => {
  for (const negative of [false, true]) {
    const f = fixture();
    f.full();
    const proof = f.ledger.issueForNativeChallenge(f.binding, f.request());
    f.at(negative ? 1000 : 15000);
    f.full(negative ? { ...ready, visible: false } : ready);
    const next = {
      ...owner,
      generation: owner.generation + 1,
      input_epoch: nonce(),
    };
    f.ledger.transferTechnicalOwner(f.binding, next, {
      nonce: proof.nonce,
      sequence: proof.sequence,
      coverage: proof.coverage_epoch,
    });
    const retryNonce = nonce();
    f.ledger.transferTechnicalOwner(f.binding, next, {
      nonce: retryNonce,
      sequence: proof.sequence,
      coverage: proof.coverage_epoch,
    });
    expect(() =>
      f.ledger.technicalSnapshot(f.binding, {
        owner: next,
        coverage_epoch: proof.coverage_epoch,
        after_sequence: proof.sequence,
        last_accepted_nonce: retryNonce,
      }),
    ).toThrow(negative ? /policy-blocked/ : /technical-gap/);
  }
});

it("technical recovery waits through focus grace without declaring a violation or renewing age", () => {
  const f = fixture();
  f.full();
  const proof = f.ledger.issueForNativeChallenge(f.binding, f.request()),
    witness = {
      owner,
      coverage_epoch: proof.coverage_epoch,
      after_sequence: proof.sequence,
      last_accepted_nonce: proof.nonce,
    };
  f.at(1000);
  f.full({ ...ready, focus: false });
  expect(() => f.ledger.technicalSnapshot(f.binding, witness)).toThrow(
    /challenge/,
  );
  f.at(2000);
  f.policy();
  expect(f.ledger.technicalSnapshot(f.binding, witness)).toMatchObject({
    coverageEpoch: proof.coverage_epoch,
    remainingMS: 14000,
  });
});
function fixture(webcam = true, limit = 32) {
  let now = 0,
    sequence = 0;
  const ledger = new MonitoringEvidenceLedger("class", () => now, limit);
  const binding = ledger.registerTrustedOwner(owner, webcam);
  const frame = (source: "screen" | "webcam") =>
    ledger.confirmValidatedFrame(
      binding,
      ledger.issueBrowserChallenge(binding, source),
      source,
      ++sequence,
    );
  const policy = (value = ready) =>
    ledger.confirmPolicy(
      binding,
      ledger.issueBrowserChallenge(binding, "policy"),
      value,
    );
  const full = (value = ready) => {
    frame("screen");
    if (webcam) frame("webcam");
    policy(value);
  };
  const request = (coverage = "", after = 0, id = nonce()) => ({
    type: "monitoring-execution-challenge-v1",
    agent: "class",
    owner,
    nonce: id,
    after_sequence: after,
    coverage_epoch: coverage,
  });
  return {
    ledger,
    binding,
    frame,
    policy,
    full,
    request,
    at: (n: number) => {
      now = n;
    },
  };
}

it("aligns a pristine restarted stream only to a verified policy-report cohort without refreshing facts", () => {
  const f = fixture();
  f.full();
  f.at(250);
  const request = { ...f.request("e".repeat(64), 9000), policy_reports: "v1" };
  expect(() =>
    f.ledger.issueForNativeChallenge(f.binding, {
      ...request,
      policy_reports: undefined,
    }),
  ).toThrow(/technical-gap/);
  const first = f.ledger.issueForNativeChallenge(f.binding, request);
  expect(first).toMatchObject({
    coverage_epoch: request.coverage_epoch,
    sequence: 9001,
    age_ms: 250,
  });
  f.at(500);
  // A native watermark beyond all sequences EVER issued here belongs to the
  // previous gateway. Reindex the same fresh facts, retaining their original age.
  const later = f.ledger.issueForNativeChallenge(f.binding, {
    ...request,
    nonce: nonce(),
    after_sequence: 9500,
  });
  expect(later).toMatchObject({
    sequence: 9501,
    age_ms: 500,
    coverage_epoch: first.coverage_epoch,
  });
  expect(f.ledger.issueForNativeChallenge(f.binding, request)).toBe(first);
  expect(() =>
    f.ledger.issueForNativeChallenge(f.binding, {
      ...request,
      nonce: nonce(),
      after_sequence: 9501,
    }),
  ).toThrow(/sequence/);
  const before = f.ledger.inspect(f.binding);
  expect(() =>
    f.ledger.issueForNativeChallenge(f.binding, {
      ...request,
      after_sequence: 9600,
    }),
  ).toThrow(/conflict/);
  expect(f.ledger.inspect(f.binding)).toEqual(before);
});

it("never aligns a witnessed gap, a negative or unknown focus history", () => {
  for (const mode of ["gap", "negative", "blur"] as const) {
    const f = fixture();
    f.full(
      mode === "negative"
        ? { ...ready, fullscreen: false }
        : mode === "blur"
          ? { ...ready, focus: false }
          : ready,
    );
    if (mode === "gap") {
      f.at(15000);
      f.full();
    }
    const before = f.ledger.inspect(f.binding);
    expect(() =>
      f.ledger.issueForNativeChallenge(f.binding, {
        ...f.request("e".repeat(64), 9000),
        policy_reports: "v1",
      }),
    ).toThrow(mode === "negative" ? /policy-blocked/ : /technical-gap/);
    expect(f.ledger.inspect(f.binding)).toEqual(before);
  }
});

it("cannot replace an established namespace or partially align an exhausted sequence", () => {
  const established = fixture();
  established.full();
  established.ledger.issueForNativeChallenge(
    established.binding,
    established.request(),
  );
  expect(() =>
    established.ledger.issueForNativeChallenge(established.binding, {
      ...established.request("e".repeat(64), 9000),
      policy_reports: "v1",
    }),
  ).toThrow(/technical-gap/);
  const f = fixture();
  f.full();
  const before = f.ledger.inspect(f.binding);
  expect(() =>
    f.ledger.issueForNativeChallenge(f.binding, {
      ...f.request("e".repeat(64), Number.MAX_SAFE_INTEGER),
      policy_reports: "v1",
    }),
  ).toThrow(/sequence/);
  expect(f.ledger.inspect(f.binding)).toEqual(before);
  expect(
    f.ledger.issueForNativeChallenge(f.binding, {
      ...f.request("e".repeat(64), 9000),
      policy_reports: "v1",
    }).sequence,
  ).toBe(9001);
});

it("carries identical trusted clock facts without refreshing age, cutoff, coverage or sequence", () => {
  const f = fixture();
  f.full();
  const request = f.request(),
    first = f.ledger.issueForNativeChallenge(f.binding, request),
    next = { ...owner, clock_revision: owner.clock_revision + 1 };
  f.at(4000);
  const before = f.ledger.inspect(f.binding);
  expect(f.ledger.transferTrustedClock(f.binding, next)).toBe(f.binding);
  expect(f.ledger.inspect(f.binding)).toEqual({
    ...before,
    retainedNativeReceipts: 0,
  });
  expect(() => f.ledger.issueForNativeChallenge(f.binding, request)).toThrow(
    /ownership/,
  );
  expect(
    f.ledger.issueForNativeChallenge(f.binding, {
      ...f.request(),
      owner: next,
    }),
  ).toMatchObject({
    owner: next,
    sequence: first.sequence,
    coverage_epoch: first.coverage_epoch,
    age_ms: 4000,
  });
  for (const changed of [
    { ...next, clock_revision: next.clock_revision + 2 },
    {
      ...next,
      clock_revision: next.clock_revision + 1,
      generation: next.generation + 1,
    },
    {
      ...next,
      clock_revision: next.clock_revision + 1,
      input_epoch: "f".repeat(64),
    },
  ])
    expect(() => f.ledger.transferTrustedClock(f.binding, changed)).toThrow(
      /ownership/,
    );
  f.at(15000);
  f.ledger.transferTrustedClock(f.binding, {
    ...next,
    clock_revision: next.clock_revision + 1,
  });
  expect(() =>
    f.ledger.issueForNativeChallenge(f.binding, {
      ...f.request(),
      owner: { ...next, clock_revision: next.clock_revision + 1 },
    }),
  ).toThrow(/technical-gap/);
});

it("combined capture preserves original challenge age and requires every saved capture source", () => {
  const f = fixture();
  const screen = f.ledger.issueBrowserChallenge(f.binding, "screen");
  f.at(1000);
  f.ledger.confirmValidatedCapture(f.binding, screen, "screen", 1, ready);
  expect(() =>
    f.ledger.issueForNativeChallenge(f.binding, f.request()),
  ).toThrow(/technical-gap/);
  const webcam = f.ledger.issueBrowserChallenge(f.binding, "webcam");
  f.at(4000);
  f.ledger.confirmValidatedCapture(f.binding, webcam, "webcam", 2, ready);
  expect(
    f.ledger.issueForNativeChallenge(f.binding, f.request()),
  ).toMatchObject({ age_ms: 4000, sequence: 1 });
  expect(() =>
    f.ledger.confirmValidatedCapture(f.binding, webcam, "webcam", 3, ready),
  ).toThrow(/challenge/);
});

it("late negative combined capture cannot hide behind newer positive policy, while older blur cannot restart an already-restored focus grace", () => {
  const f = fixture();
  const old = f.ledger.issueBrowserChallenge(f.binding, "screen");
  const fresh = f.ledger.issueBrowserChallenge(f.binding, "webcam");
  f.at(1000);
  f.ledger.confirmValidatedCapture(f.binding, fresh, "webcam", 2, ready);
  f.at(2000);
  f.ledger.confirmValidatedCapture(f.binding, old, "screen", 1, {
    ...ready,
    focus: false,
  });
  expect(f.ledger.inspect(f.binding)).toMatchObject({
    state: "fresh",
    remainingMS: 13000,
  });
  const negative = f.ledger.issueBrowserChallenge(f.binding, "screen");
  const positive = f.ledger.issueBrowserChallenge(f.binding, "webcam");
  f.ledger.confirmValidatedCapture(f.binding, positive, "webcam", 3, ready);
  f.ledger.confirmValidatedCapture(f.binding, negative, "screen", 2, {
    ...ready,
    fullscreen: false,
  });
  expect(f.ledger.inspect(f.binding).state).toBe("policy-blocked");
  expect(() =>
    f.ledger.issueForNativeChallenge(f.binding, f.request()),
  ).toThrow(/policy-blocked/);
});

it("combined focus loss keeps the existing grace and cannot mature across missing capture coverage into a violation", () => {
  const f = fixture(false);
  const observe = (focus: boolean, sequence: number) =>
    f.ledger.confirmValidatedCapture(
      f.binding,
      f.ledger.issueBrowserChallenge(f.binding, "screen"),
      "screen",
      sequence,
      { ...ready, focus },
    );
  observe(false, 1);
  f.at(5000);
  observe(false, 2);
  f.at(10000);
  observe(false, 3);
  f.at(15000);
  observe(false, 4);
  f.at(19999);
  expect(f.ledger.issueForNativeChallenge(f.binding, f.request()).age_ms).toBe(
    14999,
  );
  f.at(20000);
  expect(f.ledger.inspect(f.binding).state).toBe("policy-blocked");
  const gap = fixture(false);
  const challenge = gap.ledger.issueBrowserChallenge(gap.binding, "screen");
  gap.ledger.confirmValidatedCapture(gap.binding, challenge, "screen", 1, {
    ...ready,
    focus: false,
  });
  gap.at(21000);
  expect(gap.ledger.inspect(gap.binding).state).toBe("technical-gap");
});

it("requires complete fresh policy and every required challenged frame; receipt never freshens old sampling", () => {
  const f = fixture();
  const screen = f.ledger.issueBrowserChallenge(f.binding, "screen");
  const camera = f.ledger.issueBrowserChallenge(f.binding, "webcam");
  const policy = f.ledger.issueBrowserChallenge(f.binding, "policy");
  f.at(2500);
  f.ledger.confirmValidatedFrame(f.binding, screen, "screen", 1);
  expect(() =>
    f.ledger.issueForNativeChallenge(f.binding, f.request()),
  ).toThrow(MonitoringEvidenceUnavailable);
  f.ledger.confirmPolicy(f.binding, policy, ready);
  expect(() =>
    f.ledger.issueForNativeChallenge(f.binding, f.request()),
  ).toThrow(MonitoringEvidenceUnavailable);
  f.ledger.confirmValidatedFrame(f.binding, camera, "webcam", 1);
  const proof = f.ledger.issueForNativeChallenge(f.binding, f.request());
  expect(proof).toMatchObject({
    complete: true,
    age_ms: 2500,
    owner,
    sequence: 1,
  });
  expect(f.ledger.inspect(f.binding)).toMatchObject({
    state: "fresh",
    remainingMS: 12500,
    gaps: 0,
  });
});

it("keeps original proof age/sequence on exact retry despite new observations and rejects changed/expired requests", () => {
  const f = fixture();
  f.full();
  const request = f.request(),
    first = f.ledger.issueForNativeChallenge(f.binding, request);
  f.at(1000);
  f.full();
  expect(f.ledger.issueForNativeChallenge(f.binding, request)).toBe(first);
  expect(() => {
    (first as any).age_ms = 0;
  }).toThrow();
  expect(() => {
    (first.owner as any).generation = 123;
  }).toThrow();
  expect(f.ledger.registerTrustedOwner(owner, true)).toBe(f.binding);
  expect(() =>
    f.ledger.issueForNativeChallenge(f.binding, {
      ...request,
      after_sequence: first.sequence,
      coverage_epoch: first.coverage_epoch,
    }),
  ).toThrow(/conflict/);
  const next = f.ledger.issueForNativeChallenge(
    f.binding,
    f.request(first.coverage_epoch, first.sequence),
  );
  expect(next.sequence).toBeGreaterThan(first.sequence);
  f.at(5000);
  expect(() => f.ledger.issueForNativeChallenge(f.binding, request)).toThrow(
    /challenge/,
  );
  expect(first.age_ms).toBe(0);
});

it("rejects stale, replayed and out-of-order challenges without refreshing coverage", () => {
  const f = fixture();
  f.full();
  const old = f.ledger.issueBrowserChallenge(f.binding, "policy");
  const fresh = f.ledger.issueBrowserChallenge(f.binding, "policy");
  f.ledger.confirmPolicy(f.binding, fresh, ready);
  const before = f.ledger.inspect(f.binding);
  expect(() => f.ledger.confirmPolicy(f.binding, old, ready)).toThrow(
    /challenge/,
  );
  expect(() => f.ledger.confirmPolicy(f.binding, fresh, ready)).toThrow(
    /challenge/,
  );
  expect(f.ledger.inspect(f.binding)).toMatchObject({
    state: before.state,
    sequence: before.sequence,
    coverageEpoch: before.coverageEpoch,
    remainingMS: before.remainingMS,
    gaps: before.gaps,
    pendingChallenges: 0,
  });
  const delayed = f.ledger.issueBrowserChallenge(f.binding, "screen");
  f.at(15000);
  expect(() =>
    f.ledger.confirmValidatedFrame(f.binding, delayed, "screen", 100),
  ).toThrow(/challenge/);
  expect(f.ledger.inspect(f.binding)).toMatchObject({
    state: "technical-gap",
    gaps: 1,
  });
});

it("assigns a new coverage identity after an unknown gap, never repairing the earlier interval", () => {
  const f = fixture();
  f.full();
  const before = f.ledger.issueForNativeChallenge(f.binding, f.request());
  f.at(15000);
  f.full();
  const after = f.ledger.issueForNativeChallenge(f.binding, f.request());
  expect(after.coverage_epoch).not.toBe(before.coverage_epoch);
  expect(after.sequence).toBeGreaterThan(before.sequence);
  expect(f.ledger.inspect(f.binding)).toMatchObject({
    state: "fresh",
    gaps: 1,
  });
  expect(() =>
    f.ledger.issueForNativeChallenge(
      f.binding,
      f.request(before.coverage_epoch, before.sequence),
    ),
  ).toThrow(/technical-gap/);
});

it("does not replay an old bootstrap proof as current coverage after a short gap", () => {
  const f = fixture();
  f.full();
  f.at(13000);
  const request = f.request();
  f.ledger.issueForNativeChallenge(f.binding, request);
  f.at(15100);
  f.full();
  expect(() => f.ledger.issueForNativeChallenge(f.binding, request)).toThrow(
    /technical-gap/,
  );
});

it.each(["fullscreen", "visible", "keyboard", "screen", "webcam"] as const)(
  "keeps actual %s loss sticky instead of automatically recovering it",
  (condition) => {
    const f = fixture();
    f.full();
    f.policy({ ...ready, [condition]: false });
    expect(f.ledger.inspect(f.binding).state).toBe("policy-blocked");
    expect(() => f.policy()).toThrow(/policy-blocked/);
    expect(() =>
      f.ledger.issueForNativeChallenge(f.binding, f.request()),
    ).toThrow(/policy-blocked/);
    expect(() =>
      f.ledger.registerTrustedOwner({ ...owner, generation: 1 }, true),
    ).toThrow(/conflict/);
    f.ledger.retire(f.binding);
    const replacement = f.ledger.registerTrustedOwner(
      { ...owner, generation: 1, input_epoch: "a".repeat(64) },
      true,
    );
    expect(() => f.ledger.inspect(f.binding)).toThrow(/ownership/);
    expect(f.ledger.inspect(replacement).state).toBe("technical-gap");
  },
);

it("preserves focus grace across repeated reports, clips evidence to its cutoff and never accepts late restoration", () => {
  const f = fixture();
  f.full({ ...ready, focus: false });
  const coverage = f.ledger.inspect(f.binding).coverageEpoch;
  f.at(10000);
  f.full({ ...ready, focus: false });
  f.at(19500);
  f.full({ ...ready, focus: false });
  const proof = f.ledger.issueForNativeChallenge(
    f.binding,
    f.request(coverage!),
  );
  expect(proof.age_ms).toBe(14500);
  expect(f.ledger.inspect(f.binding)).toMatchObject({
    state: "fresh",
    remainingMS: 500,
    gaps: 0,
  });
  f.at(20000);
  expect(() => f.policy()).toThrow(/policy-blocked/);
  expect(f.ledger.inspect(f.binding).state).toBe("policy-blocked");
});

it("does not mature stale blur across an unknown monitoring gap into a policy violation or restart its grace", () => {
  const f = fixture();
  f.full({ ...ready, focus: false });
  const original = f.ledger.issueForNativeChallenge(f.binding, f.request());
  // No observations across this interval: e.g. a suspended gateway. Required
  // monitoring expires at15s, BEFORE the20s focus grace. Time alone proves no
  // continuous blur; work still stops and the old coverage cannot be restored.
  f.at(21000);
  expect(f.ledger.inspect(f.binding)).toMatchObject({
    state: "technical-gap",
    gaps: 1,
  });
  f.full({ ...ready, focus: false });
  expect(f.ledger.inspect(f.binding)).toMatchObject({
    state: "technical-gap",
    gaps: 1,
  });
  expect(() =>
    f.ledger.issueForNativeChallenge(f.binding, f.request()),
  ).toThrow(/technical-gap/);
  f.policy(ready);
  const fresh = f.ledger.issueForNativeChallenge(f.binding, f.request());
  expect(fresh.coverage_epoch).not.toBe(original.coverage_epoch);
  expect(() =>
    f.ledger.issueForNativeChallenge(
      f.binding,
      f.request(original.coverage_epoch, original.sequence),
    ),
  ).toThrow(/technical-gap/);
});

it("accepts focus restored within grace, retains coverage and inherits webcam policy only from registration", () => {
  const f = fixture(false);
  f.full({ ...ready, webcam: false, focus: false });
  const coverage = f.ledger.inspect(f.binding).coverageEpoch;
  f.at(10000);
  f.full({ ...ready, webcam: false, focus: true });
  f.at(20000);
  f.full({ ...ready, webcam: false, focus: true });
  expect(f.ledger.inspect(f.binding)).toMatchObject({
    state: "fresh",
    coverageEpoch: coverage,
    gaps: 0,
  });
  expect(() => f.ledger.issueBrowserChallenge(f.binding, "webcam")).toThrow(
    /challenge/,
  );
  expect(() => f.ledger.registerTrustedOwner(owner, true)).toThrow(/conflict/);
});

it("fences all owner/issuer identities, foreign handles, missing coverage and private error output", () => {
  const f = fixture();
  f.full();
  for (const key of Object.keys(owner)) {
    const value =
      typeof owner[key] === "number"
        ? owner[key] + 1
        : key === "attempt" || key === "boot"
          ? "22222222-2222-4222-8222-222222222222"
          : key.endsWith("epoch") || key === "transport_hash"
            ? "f".repeat(64)
            : "PRIVATE-NOT-FOR-ERRORS";
    expect(() =>
      f.ledger.issueForNativeChallenge(f.binding, {
        ...f.request(),
        owner: { ...owner, [key]: value },
      }),
    ).toThrow(/ownership/);
  }
  expect(() =>
    f.ledger.issueForNativeChallenge(f.binding, {
      ...f.request(),
      agent: "other",
    }),
  ).toThrow(/ownership/);
  expect(() =>
    f.ledger.issueForNativeChallenge(f.binding, {
      ...f.request(),
      after_sequence: 1,
    }),
  ).toThrow(/challenge/);
  expect(() =>
    f.ledger.issueForNativeChallenge(
      {} as MonitoringEvidenceBinding,
      f.request(),
    ),
  ).toThrow(/ownership/);
  const other = fixture();
  expect(() => f.ledger.inspect(other.binding)).toThrow(/ownership/);
  try {
    f.ledger.issueForNativeChallenge(f.binding, {
      ...f.request(),
      owner: { ...owner, username: "PRIVATE-NOT-FOR-ERRORS" },
    });
  } catch (error) {
    expect(String(error)).not.toContain("PRIVATE-NOT-FOR-ERRORS");
  }
});

it("bounds owner/challenge/receipt capacity without evicting another current student or changing exact retries", () => {
  const f = fixture(false, 1);
  f.full();
  expect(() =>
    f.ledger.registerTrustedOwner(
      { ...owner, attempt: "22222222-2222-4222-8222-222222222222" },
      false,
    ),
  ).toThrow(/capacity/);
  const firstChallenge = f.ledger.issueBrowserChallenge(f.binding, "policy");
  for (let i = 0; i < 20; i++)
    f.ledger.issueBrowserChallenge(f.binding, "policy");
  expect(f.ledger.inspect(f.binding).pendingChallenges).toBe(16);
  expect(() =>
    f.ledger.confirmPolicy(f.binding, firstChallenge, ready),
  ).toThrow(/challenge/);
  const original = f.request(),
    proof = f.ledger.issueForNativeChallenge(f.binding, original);
  for (let i = 1; i < 32; i++)
    f.ledger.issueForNativeChallenge(f.binding, f.request());
  expect(() =>
    f.ledger.issueForNativeChallenge(f.binding, f.request()),
  ).toThrow(/capacity/);
  expect(f.ledger.issueForNativeChallenge(f.binding, original)).toBe(proof);
  expect(f.ledger.inspect(f.binding)).toMatchObject({
    state: "fresh",
    retainedNativeReceipts: 32,
  });
});

it("uses only monotonic time and refuses backwards/nonfinite clock readings", () => {
  const f = fixture();
  f.full();
  f.at(1000);
  expect(f.ledger.issueForNativeChallenge(f.binding, f.request()).age_ms).toBe(
    1000,
  );
  f.at(999);
  expect(() => f.ledger.inspect(f.binding)).toThrow(/clock/);
  f.at(NaN);
  expect(() => f.ledger.inspect(f.binding)).toThrow(/clock/);
});

it("new frames alone cannot extend expired complete-policy evidence", () => {
  const f = fixture();
  f.full();
  f.at(14000);
  f.frame("screen");
  f.frame("webcam");
  expect(f.ledger.issueForNativeChallenge(f.binding, f.request()).age_ms).toBe(
    14000,
  );
  f.at(15000);
  f.frame("screen");
  f.frame("webcam");
  expect(() =>
    f.ledger.issueForNativeChallenge(f.binding, f.request()),
  ).toThrow(/technical-gap/);
  expect(f.ledger.inspect(f.binding)).toMatchObject({
    state: "technical-gap",
    gaps: 1,
  });
});

it("one owner's full receipt cache does not block another current owner", () => {
  const f = fixture(false, 2);
  f.full();
  for (let i = 0; i < 32; i++)
    f.ledger.issueForNativeChallenge(f.binding, f.request());
  const secondOwner = {
    ...owner,
    attempt: "22222222-2222-4222-8222-222222222222",
    username: "second",
    uid: 10002,
  };
  const second = f.ledger.registerTrustedOwner(secondOwner, false);
  f.ledger.confirmValidatedFrame(
    second,
    f.ledger.issueBrowserChallenge(second, "screen"),
    "screen",
    1,
  );
  f.ledger.confirmPolicy(
    second,
    f.ledger.issueBrowserChallenge(second, "policy"),
    ready,
  );
  expect(
    f.ledger.issueForNativeChallenge(second, {
      ...f.request(),
      owner: secondOwner,
    }).complete,
  ).toBe(true);
  expect(f.ledger.inspect(f.binding).state).toBe("fresh");
});

it("has zero modelled false holds across five minutes of healthy cadence with independently delayed samples, policy and native checks", () => {
  const f = fixture();
  f.full();
  let seed = 0x125764ab,
    sourceSequence = 10,
    after = 0,
    coverage = "",
    nativeUntil = 115000;
  const randomDelay = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return 1 + ((seed >>> 0) % 700);
  };
  const events: { at: number; apply: () => void }[] = [];
  let accepted = 0;
  for (let at = 0; at <= 300000; at += 100) {
    events.sort((a, b) => a.at - b.at);
    while (events[0] && events[0].at <= at) {
      const event = events.shift()!;
      f.at(event.at);
      event.apply();
    }
    f.at(at);
    if (at && at % 2000 === 0) {
      const challenge = f.ledger.issueBrowserChallenge(f.binding, "policy");
      events.push({
        at: at + randomDelay(),
        apply: () => f.ledger.confirmPolicy(f.binding, challenge, ready),
      });
    }
    if (at && at % 5000 === 0)
      for (const source of ["screen", "webcam"] as const) {
        const challenge = f.ledger.issueBrowserChallenge(f.binding, source),
          sequence = ++sourceSequence;
        events.push({
          at: at + randomDelay(),
          apply: () =>
            f.ledger.confirmValidatedFrame(
              f.binding,
              challenge,
              source,
              sequence,
            ),
        });
      }
    const status = f.ledger.inspect(f.binding);
    expect(status.state).toBe("fresh");
    expect(status.gaps).toBe(0);
    if (at % 1000 === 0 && status.sequence > after) {
      const proof = f.ledger.issueForNativeChallenge(
        f.binding,
        f.request(coverage, after),
      );
      coverage ||= proof.coverage_epoch;
      expect(proof.coverage_epoch).toBe(coverage);
      // Model the separately tested native conservative budget with an
      // additional independent 700 ms request/reply round trip. Not a kernel or
      // real-network availability claim; those remain H5 release requirements.
      nativeUntil = 100000 + at - 700 + 15000 - proof.age_ms;
      after = proof.sequence;
      accepted++;
    }
    expect(nativeUntil).toBeGreaterThan(100000 + at);
    expect(status.pendingChallenges).toBeLessThanOrEqual(16);
    expect(status.retainedNativeReceipts).toBeLessThanOrEqual(32);
  }
  expect(accepted).toBeGreaterThan(100);
});
