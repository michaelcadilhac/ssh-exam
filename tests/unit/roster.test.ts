import { describe, it, expect } from "vitest";
import { parseRoster, exportRoster } from "../../apps/server/src/roster.js";
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
  it("handles BOM, CRLF, quoted commas and newlines", () =>
    expect(
      parseRoster(
        '\ufeffusername,display_name\r\na,"Last, First\nSecond"\r\n',
      )[0].display_name,
    ).toBe("Last, First\nSecond"));
  it.each([
    "username,username\na,a",
    "usernme\na",
    "username,host\na,evil",
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
      parseRoster(
        "username,require_webcam,duration_minutes,display_name\na,,,",
      )[0],
    ).toEqual({
      username: "a",
      webcam: null,
      duration: null,
      display_name: null,
    }));
  it("supports username lists", () =>
    expect(parseRoster("a\r\nb\n", "lines")).toHaveLength(2));
  it("neutralizes formula export", () =>
    expect(
      exportRoster([
        {
          username: "a",
          webcam: 0,
          duration: null,
          display_name: '=HYPERLINK("x")',
        },
      ]),
    ).toContain("'=HYPERLINK"));
});

it("streaming import handles UTF-8 chunks and 10,000 records", async () => {
  const { parseRosterAsync } = await import("../../apps/server/src/roster.js");
  const text =
    "username,display_name\n" +
    Array.from({ length: 10000 }, (_, i) => `student${i},José ${i}`).join("\n");
  expect(await parseRosterAsync(text)).toHaveLength(10000);
});
