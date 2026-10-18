import { describe, it, expect } from "vitest";
import {
  parseRoster,
  parseRosterAsync,
  exportRoster,
} from "../../apps/server/src/roster.js";
describe("roster import", () => {
  it("resolves explicit false separately from inherit", () => {
    expect(
      parseRoster("username,require_webcam\na,false\nb,inherit\nc,YES"),
    ).toEqual([
      { username: "a", webcam: false },
      { username: "b", webcam: null },
      { username: "c", webcam: true },
    ]);
  });
  it("preserves missing optional fields", () =>
    expect(parseRoster("username\na")[0]).toEqual({ username: "a" }));
  it("handles BOM, CRLF and quoted settings", () =>
    expect(
      parseRoster(
        '\ufeff"username","require_webcam","duration_minutes"\r\n"a","yes","90"\r\n',
      ),
    ).toEqual([{ username: "a", webcam: true, duration: 5400 }]));
  it.each([
    "username,username\na,a",
    "usernme\na",
    "username,host\na,evil",
    "username,display_name\na,Alice",
    "username\na\na",
    "username,require_webcam\na,nope",
    "username,duration_minutes\na,1.5",
    "username,duration_minutes\na,0",
    "username\nroot",
    "username\n../x",
  ])("rejects invalid roster %s", (text) =>
    expect(() => parseRoster(text)).toThrow(),
  );
  it("imports 10,000 students", () =>
    expect(
      parseRoster(
        "username\n" +
          Array.from({ length: 10000 }, (_, i) => `student${i}`).join("\n"),
      ),
    ).toHaveLength(10000));
  it("clears explicit blanks", () =>
    expect(
      parseRoster("username,require_webcam,duration_minutes\na,,")[0],
    ).toEqual({
      username: "a",
      webcam: null,
      duration: null,
    }));
  it("supports username lists", () =>
    expect(parseRoster("a\r\nb\n", "lines")).toHaveLength(2));
  it("neutralizes formula export", () =>
    expect(
      exportRoster([
        {
          username: '=HYPERLINK("x")',
          webcam: 0,
          duration: null,
        },
      ]),
    ).toContain("'=HYPERLINK"));
});

it("streaming import handles BOM, quoted CRLF records and 10,000 students across chunks", async () => {
  const { parseRosterAsync } = await import("../../apps/server/src/roster.js");
  const text =
    "\ufeffusername,require_webcam,duration_minutes\r\n" +
    Array.from(
      { length: 10000 },
      (_, i) => `"student${i}","inherit","90"`,
    ).join("\r\n");
  const rows = await parseRosterAsync(text);
  expect(rows).toHaveLength(10000);
  expect(rows[9999]).toEqual({
    username: "student9999",
    webcam: null,
    duration: 5400,
  });
});

it("exports only the supported fields and round-trips enrollment settings", () => {
  const csv = exportRoster([
    { username: "a", webcam: 0, duration: 8100, display_name: "Legacy name" },
  ]);
  expect(csv.split("\n")[0]).toBe("username,require_webcam,duration_minutes");
  expect(csv).not.toContain("Legacy name");
  expect(parseRoster(csv)).toEqual([
    { username: "a", webcam: false, duration: 8100 },
  ]);
});

describe.each([
  ["synchronous", parseRoster],
  ["streaming", parseRosterAsync],
] as const)("%s roster username validation", (_name, parse) => {
  it("preserves uppercase and mixed-case account identities", async () => {
    expect(
      await parse(
        "username,require_webcam,duration_minutes\nSTUDENT31,true,90\nStudent_2,false,90\nstudent_2,true,90",
      ),
    ).toEqual([
      { username: "STUDENT31", webcam: true, duration: 5400 },
      { username: "Student_2", webcam: false, duration: 5400 },
      { username: "student_2", webcam: true, duration: 5400 },
    ]);
  });
  it.each([
    "bad.name",
    "1student",
    "STUDENT@school.edu",
    "../student",
    "A".repeat(33),
  ])("reports the row and value for invalid username %s", async (value) => {
    await expect(
      Promise.resolve().then(() => parse(`username\nGOOD\n${value}`)),
    ).rejects.toThrow(
      `Row 3: invalid username ${JSON.stringify(value)}. Usernames must be 1–32 characters`,
    );
  });
  it("keeps original line numbers when blank lines are skipped", async () => {
    await expect(
      Promise.resolve().then(() => parse("GOOD\n\nBAD.NAME", "lines")),
    ).rejects.toThrow('Line 3: invalid username "BAD.NAME"');
  });
  it.each(["root", "ROOT", "Daemon"])(
    "rejects reserved identity %s",
    async (value) => {
      await expect(
        Promise.resolve().then(() => parse(`username\n${value}`)),
      ).rejects.toThrow(
        `Row 2: invalid username ${JSON.stringify(value)}. Privileged/service account forbidden`,
      );
    },
  );
});
