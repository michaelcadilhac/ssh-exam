import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  monitoringEvidence,
  MONITORING_EVIDENCE_MAX_BYTES,
} from "../../packages/protocol/monitoring-evidence.js";

const fixture = JSON.parse(
  readFileSync(
    new URL("../fixtures/monitoring-evidence.json", import.meta.url),
    "utf8",
  ),
);

it("shares one exact bounded owner/evidence contract with the unwired native verifier, including zero revisions", () => {
  expect(monitoringEvidence.parse(fixture)).toEqual(fixture);
  expect(Buffer.byteLength(JSON.stringify(fixture))).toBeLessThan(
    MONITORING_EVIDENCE_MAX_BYTES,
  );
  expect(monitoringEvidence.parse({ ...fixture, age_ms: 0 }).age_ms).toBe(0);
  expect(
    monitoringEvidence.parse({ ...fixture, sequence: Number.MAX_SAFE_INTEGER })
      .sequence,
  ).toBe(Number.MAX_SAFE_INTEGER);
});

it("requires every scope and freshness field explicitly, without missing/null defaults or unknown fields", () => {
  for (const field of Object.keys(fixture)) {
    const copy = { ...fixture };
    delete copy[field];
    expect(monitoringEvidence.safeParse(copy).success, `missing ${field}`).toBe(
      false,
    );
    expect(
      monitoringEvidence.safeParse({ ...fixture, [field]: null }).success,
      `null ${field}`,
    ).toBe(false);
  }
  for (const field of Object.keys(fixture.owner)) {
    const owner = { ...fixture.owner };
    delete owner[field];
    expect(
      monitoringEvidence.safeParse({ ...fixture, owner }).success,
      `missing owner ${field}`,
    ).toBe(false);
    expect(
      monitoringEvidence.safeParse({
        ...fixture,
        owner: { ...fixture.owner, [field]: null },
      }).success,
      `null owner ${field}`,
    ).toBe(false);
  }
  expect(
    monitoringEvidence.safeParse({ ...fixture, extra: true }).success,
  ).toBe(false);
  expect(
    monitoringEvidence.safeParse({
      ...fixture,
      owner: { ...fixture.owner, extra: true },
    }).success,
  ).toBe(false);
});

it("refuses wrong-purpose, expired/future/incomplete, overflowing and malformed ownership evidence", () => {
  for (const patch of [
    { type: "deadline-timing" },
    { complete: false },
    { age_ms: 15000 },
    { age_ms: -1 },
    { age_ms: 1.5 },
    { sequence: 0 },
    { sequence: Number.MAX_SAFE_INTEGER + 1 },
    { nonce: "" },
    { audience: "other agent" },
    ...[
      { uid: 0 },
      { uid: 4294967295 },
      { generation: -1 },
      { clock_revision: Number.MAX_SAFE_INTEGER + 1 },
      { boot: "-".repeat(36) },
      { attempt: "-".repeat(36) },
      { page_epoch: "" },
      { input_epoch: "" },
      { transport_hash: "a".repeat(63) },
    ].map((owner) => ({ owner: { ...fixture.owner, ...owner } })),
  ])
    expect(monitoringEvidence.safeParse({ ...fixture, ...patch }).success).toBe(
      false,
    );
});
