import { it, expect } from "vitest";
import { savedWorkLabel } from "../../apps/web/src/exam-file-options.js";
import {
  localDateTime,
  localTimeOptions,
  parseLocalDateTime,
  localOccurrence,
  windowLabel,
  timeLimit,
} from "../../apps/web/src/local-date-time.js";

it("uses the device timezone, preserves exact time labels and rejects nonexistent local minutes", () => {
  const previous = process.env.TZ;
  try {
    process.env.TZ = "America/Chicago";
    expect(() => parseLocalDateTime("2026-03-08T02:30")).toThrow("not valid");
    expect(() => parseLocalDateTime("2026-02-30T12:00")).toThrow("not valid");
    const choices = localTimeOptions("2026-11-01T01:30");
    expect(choices).toHaveLength(2);
    expect(choices[1] - choices[0]).toBe(3600000);
    expect(parseLocalDateTime("2026-11-01T01:30", 1)).toBe(choices[1]);
    expect(localOccurrence(choices[1] + 12345)).toBe(1);
    expect(windowLabel(choices[0], choices[1])).toContain("UTC−05:00");
    expect(windowLabel(choices[0], choices[1])).toContain("UTC−06:00");
    process.env.TZ = "Asia/Kathmandu";
    const at = Date.UTC(2026, 9, 30, 12, 15);
    expect(localDateTime(at)).toBe("2026-10-30T18:00");
    expect(parseLocalDateTime("2026-10-30T18:00")).toBe(at);
    expect(timeLimit(95)).toBe("1 min 35 sec");
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

it("distinguishes same-named source exams without exposing archive references", () => {
  const original = {
    id: "private-reference-a",
    exam: "midterm",
    settings: { name: "Midterm" },
    start: Date.UTC(2026, 9, 30, 12),
    attempt_number: 1,
  };
  const recovery = {
    ...original,
    id: "private-reference-b",
    exam: "midterm-recovery",
  };
  expect(savedWorkLabel(original, [original, recovery])).toContain(
    "Midterm (midterm)",
  );
  expect(savedWorkLabel(recovery, [original, recovery])).toContain(
    "Midterm (midterm-recovery)",
  );
  expect(savedWorkLabel(original, [original])).not.toContain("(midterm)");
  expect(savedWorkLabel(recovery, [original, recovery])).not.toContain(
    "private-reference",
  );
});
