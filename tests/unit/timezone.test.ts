import { expect, it } from "vitest";
import { chicago, remaining } from "../../apps/web/src/api.js";

it("shows an explicit Chicago timezone and preserves elapsed minutes across daylight-saving changes", () => {
  for (const [startText, endText, startLabel, endLabel] of [
    [
      "2026-03-08T07:30:00Z",
      "2026-03-08T09:00:00Z",
      "1:30:00 AM CST",
      "4:00:00 AM CDT",
    ],
    [
      "2026-11-01T06:30:00Z",
      "2026-11-01T08:00:00Z",
      "1:30:00 AM CDT",
      "2:00:00 AM CST",
    ],
  ]) {
    const start = Date.parse(startText),
      deadline = Date.parse(endText);
    expect(chicago(start)).toContain(startLabel);
    expect(chicago(deadline)).toContain(endLabel);
    expect(deadline - start).toBe(90 * 60000);
    expect(remaining(deadline, start)).toBe("90:00");
    expect(remaining(deadline, start + 45 * 60000)).toBe("45:00");
    expect(remaining(deadline, deadline)).toBe("0:00");
    expect(remaining(deadline, deadline + 1)).toBe("0:00");
  }
  expect(chicago(Date.parse("2026-01-16T01:05:00Z"))).toContain("Jan 15, 2026");
  expect(chicago(Date.parse("2026-01-16T01:05:00Z"))).toContain(
    "7:05:00 PM CST",
  );
  expect(chicago(null)).toBe("—");
  expect(remaining(null)).toBe("Not started");
});
