import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  examSchema,
  examDefinitionSchema,
} from "../../packages/protocol/index.js";
import { grantRevision } from "../../packages/protocol/grants.js";
import { sandboxExam } from "../../packages/protocol/sandbox.js";

it("exam-wide review policy never changes immutable grant settings or their hash", () => {
  const settings = examSchema.parse({
    id: "exam",
    name: "Exam",
    template: "sample",
    template_version: "a".repeat(64),
    earliest: 1000,
    latest: 2000,
  });
  const work = { kind: "template", name: "sample", hash: "a".repeat(64) };
  const hash = (value: unknown) =>
    createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const original = hash({ settings, work });
  for (const enabled of [true, false]) {
    const exam = examDefinitionSchema.parse({
      ...settings,
      pause_on_review: enabled,
    });
    expect(exam.pause_on_review).toBe(enabled);
    const saved = examSchema.parse(exam);
    expect(saved).toEqual(settings);
    expect(saved).not.toHaveProperty("pause_on_review");
    expect(hash({ settings: saved, work })).toBe(original);
  }
  expect(examDefinitionSchema.parse(settings)).not.toHaveProperty(
    "pause_on_review",
  );
  expect(
    grantRevision.safeParse({
      revision: 1,
      changes: { pause_on_review: true },
      reason: "Synthetic policy change",
    }).success,
  ).toBe(false);
});

it("sandbox keeps its explicit exam policy without changing its fixed grant settings", () => {
  const exam = sandboxExam("sample", {
    earliest: 1000,
    latest: 2000,
    pause_on_review: true,
  });
  expect(exam.pause_on_review).toBe(true);
  expect(examSchema.parse(exam)).toMatchObject({
    duration: 300,
    webcam: false,
    terminals: 4,
  });
  expect(examSchema.parse(exam)).not.toHaveProperty("pause_on_review");
  expect(
    examDefinitionSchema.safeParse({ ...exam, pause_on_review: "true" })
      .success,
  ).toBe(false);
});
