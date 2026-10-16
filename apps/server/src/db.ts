import Database from "better-sqlite3";
import { mkdirSync, readFileSync } from "node:fs";
import { randomUUID, createHash, randomBytes } from "node:crypto";
import type { State } from "../../../packages/protocol/index.js";
export const now = () => Date.now();
export const hash = (s: string | Buffer) =>
  createHash("sha256").update(s).digest("hex");
export const secret = () => randomBytes(32).toString("hex");
export interface Attempt {
  id: string;
  exam: string;
  username: string;
  uid: number;
  state: State;
  settings: string;
  start: number | null;
  deadline: number | null;
  original_deadline: number | null;
  clock_revision: number;
  clock_resets: string;
  ended: number | null;
  generation: number;
  page_hash: string | null;
  last_contact: number | null;
  focus_lost_at: number | null;
  reason: string | null;
  work_path: string | null;
  export_status: string | null;
  checksum: string | null;
  protected: number;
  completed_at: number | null;
  collected_at: number | null;
  secured_at: number | null;
  access_state: string;
  access_held_at: number | null;
  access_released_at: number | null;
  access_override: string | null;
  access_checked_at: number | null;
  access_error: string | null;
  functional_test: number;
}
export class Store {
  db: Database.Database;
  constructor(public dir: string) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.db = new Database(`${dir}/metadata.sqlite`);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
    this.db.exec(readFileSync("migrations/001.sql", "utf8"));
    if (!this.db.prepare("SELECT 1 FROM schema_version WHERE version=2").get())
      this.db.transaction(() =>
        this.db.exec(readFileSync("migrations/002.sql", "utf8")),
      )();
    if (!this.db.prepare("SELECT 1 FROM schema_version WHERE version=3").get())
      this.db.transaction(() =>
        this.db.exec(readFileSync("migrations/003.sql", "utf8")),
      )();
    if (!this.db.prepare("SELECT 1 FROM schema_version WHERE version=4").get())
      this.db.transaction(() =>
        this.db.exec(readFileSync("migrations/004.sql", "utf8")),
      )();
    if (
      !this.db.prepare("SELECT 1 FROM schema_version WHERE version=5").get()
    ) {
      this.db.pragma("foreign_keys = OFF");
      try {
        this.db.transaction(() => {
          this.db.exec(readFileSync("migrations/005.sql", "utf8"));
          if ((this.db.pragma("foreign_key_check") as unknown[]).length)
            throw Error("Attempt migration foreign-key check failed");
        })();
      } finally {
        this.db.pragma("foreign_keys = ON");
      }
    }
    if (!this.db.prepare("SELECT 1 FROM schema_version WHERE version=6").get())
      this.db.transaction(() =>
        this.db.exec(readFileSync("migrations/006.sql", "utf8")),
      )();
    if (!this.db.prepare("SELECT 1 FROM schema_version WHERE version=7").get())
      this.db.transaction(() =>
        this.db.exec(readFileSync("migrations/007.sql", "utf8")),
      )();
    if (!this.db.prepare("SELECT 1 FROM schema_version WHERE version=8").get())
      this.db.transaction(() =>
        this.db.exec(readFileSync("migrations/008.sql", "utf8")),
      )();
  }
  audit(actor: string, action: string, target: string, detail = "") {
    this.db
      .prepare("INSERT INTO audit VALUES(?,?,?,?,?,?)")
      .run(randomUUID(), now(), actor, action, target, detail);
  }
  attempt(id: string) {
    const a = this.db.prepare("SELECT * FROM attempts WHERE id=?").get(id) as
      | Attempt
      | undefined;
    if (!a) throw Error("Attempt not found");
    return a;
  }
  transition(id: string, from: State[], to: State, reason?: string) {
    const a = this.attempt(id);
    if (!from.includes(a.state))
      throw Error(`Cannot transition ${a.state} to ${to}`);
    this.db
      .prepare(
        "UPDATE attempts SET state=?,reason=COALESCE(?,reason) WHERE id=? AND state=?",
      )
      .run(to, reason || null, id, a.state);
    return this.attempt(id);
  }
  session(role: string, username: string, exam: string | null) {
    const token = secret(),
      csrf = secret();
    this.db
      .prepare("INSERT INTO sessions VALUES(?,?,?,?,?,?)")
      .run(hash(token), role, username, exam, now() + 8 * 3600000, csrf);
    return { token, csrf };
  }
  close() {
    this.db.close();
  }
}
