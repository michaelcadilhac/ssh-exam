import { Readable } from "node:stream";
import { parse as streamParse } from "csv-parse";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import { username } from "../../../packages/protocol/index.js";
export type RosterRow = {
  username: string;
  webcam?: boolean | null;
  duration?: number | null;
};
export function parseRoster(
  text: string,
  mode: "csv" | "lines" = "csv",
): RosterRow[] {
  if (Buffer.byteLength(text) > 10 * 1024 * 1024)
    throw Error("Roster exceeds 10 MiB");
  if (mode === "lines")
    return validate(
      text
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => ({ username: username.parse(s) })),
    );
  const table = parse(text, {
    bom: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: false,
    max_record_size: 8192,
  }) as string[][];
  return decodeTable(table);
}
function decodeTable(table: string[][]): RosterRow[] {
  if (!table.length) throw Error("CSV is empty");
  const headers = table.shift()!;
  const allowed = ["username", "require_webcam", "duration_minutes"];
  if (
    !headers.includes("username") ||
    new Set(headers).size !== headers.length ||
    headers.some((h) => !allowed.includes(h))
  )
    throw Error("Missing, duplicate or unsupported headers");
  return validate(
    table.map((cells, i) => {
      const item = Object.fromEntries(headers.map((h, j) => [h, cells[j]]));
      const row: RosterRow = { username: username.parse(item.username) };
      if ("require_webcam" in item) {
        const v = item.require_webcam.toLowerCase();
        if (["", "inherit"].includes(v)) row.webcam = null;
        else if (["true", "yes", "1"].includes(v)) row.webcam = true;
        else if (["false", "no", "0"].includes(v)) row.webcam = false;
        else throw Error(`Row ${i + 2}: invalid webcam setting`);
      }
      if ("duration_minutes" in item) {
        const v = item.duration_minutes;
        if (!v || v === "inherit") row.duration = null;
        else if (/^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 360)
          row.duration = Number(v) * 60;
        else throw Error(`Row ${i + 2}: duration must be 1–360 whole minutes`);
      }
      return row;
    }),
  );
}
function validate(rows: RosterRow[]) {
  if (!rows.length || rows.length > 10000)
    throw Error("Import must contain 1–10,000 students");
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.username)) throw Error(`Duplicate username: ${r.username}`);
    seen.add(r.username);
  }
  return rows;
}
const escapeCell = (s: string) => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s);
export function exportRoster(rows: any[]) {
  return stringify(
    rows.map((r) => ({
      username: escapeCell(r.username),
      require_webcam:
        r.webcam === null ? "inherit" : r.webcam ? "true" : "false",
      duration_minutes: r.duration === null ? "" : r.duration / 60,
    })),
    {
      header: true,
      columns: ["username", "require_webcam", "duration_minutes"],
    },
  );
}

export async function parseRosterAsync(
  text: string,
  mode: "csv" | "lines" = "csv",
): Promise<RosterRow[]> {
  if (Buffer.byteLength(text) > 10 * 1024 * 1024)
    throw Error("Roster exceeds 10 MiB");
  if (mode === "lines") return parseRoster(text, mode);
  const bytes = Buffer.from(text);
  async function* chunks() {
    for (let offset = 0; offset < bytes.length; offset += 65536) {
      yield bytes.subarray(offset, offset + 65536);
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }
  const parser = Readable.from(chunks()).pipe(
    streamParse({
      bom: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: false,
      max_record_size: 8192,
    }),
  );
  const table: string[][] = [];
  for await (const row of parser) {
    table.push(row);
    if (table.length > 10001) {
      parser.destroy();
      throw Error("Import exceeds 10,000 students");
    }
  }
  return decodeTable(table);
}
