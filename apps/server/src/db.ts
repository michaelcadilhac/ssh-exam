import { InterruptionHistory } from "./interruptions.js";
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
  preflight_started_at: number | null;
  start: number | null;
  deadline: number | null;
  original_deadline: number | null;
  clock_revision: number;
  clock_resets: string;
  ended: number | null;
  generation: number;
  continuation_revision: number;
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
  policy_state: string | null;
  policy_expires: number | null;
  policy_error: string | null;
  access_state: string;
  access_held_at: number | null;
  access_released_at: number | null;
  access_override: string | null;
  access_checked_at: number | null;
  access_error: string | null;
  functional_test: number;
  recovery_preflight: string | null;
  grant_id: string | null;
  grant_revision: number | null;
  grant_hash: string | null;
  grant_begin_intent: string | null;
  grant_kind: string | null;
  grant_issued_order: number | null;
  grant_initial: string | null;
  grant_work: string | null;
  registered_owner: string | null;
  monitoring_mode?: "legacy" | "v1" | null;
  retained_hold?: "pending" | "unverified" | "held" | "resuming" | null;
  monitoring_hold_kind?: "policy" | "technical" | null;
}
export class Store {
  db: Database.Database;
  interruptions: InterruptionHistory;
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
    if (!this.db.prepare("SELECT 1 FROM schema_version WHERE version=9").get())
      this.db.transaction(() =>
        this.db.exec(readFileSync("migrations/009.sql", "utf8")),
      )();
    if (!this.db.prepare("SELECT 1 FROM schema_version WHERE version=10").get())
      this.db.transaction(() =>
        this.db.exec(readFileSync("migrations/010.sql", "utf8")),
      )();
    this.interruptions = new InterruptionHistory(this);
    if (!this.db.prepare("SELECT 1 FROM schema_version WHERE version=11").get())
      this.db.transaction(() => {
        this.db.exec(readFileSync("migrations/011.sql", "utf8"));
        this.interruptions.seedLegacy();
      })();
    this.interruptions.recover();
    if (!this.db.prepare("SELECT 1 FROM schema_version WHERE version=12").get())
      this.db.transaction(() =>
        this.db.exec(readFileSync("migrations/012.sql", "utf8")),
      )();
    if (!this.db.prepare("SELECT 1 FROM schema_version WHERE version=13").get())
      this.db.transaction(() =>
        this.db.exec(readFileSync("migrations/013.sql", "utf8")),
      )();
    if (!this.db.prepare("SELECT 1 FROM schema_version WHERE version=14").get())
      this.db.transaction(() =>
        this.db.exec(readFileSync("migrations/014.sql", "utf8")),
      )();
    if (!this.db.prepare("SELECT 1 FROM schema_version WHERE version=15").get())
      this.db.transaction(() =>
        this.db.exec(readFileSync("migrations/015.sql", "utf8")),
      )();
    if (!this.db.prepare("SELECT 1 FROM schema_version WHERE version=16").get())
      this.db.transaction(() =>
        this.db.exec(readFileSync("migrations/016.sql", "utf8")),
      )();
    if (!this.db.prepare("SELECT 1 FROM schema_version WHERE version=17").get())
      this.db.transaction(() =>
        this.db.exec(readFileSync("migrations/017.sql", "utf8")),
      )();
    if (!this.db.prepare("SELECT 1 FROM schema_version WHERE version=18").get())
      this.db.transaction(() =>
        this.db.exec(readFileSync("migrations/018.sql", "utf8")),
      )();
    if (!this.db.prepare("SELECT 1 FROM schema_version WHERE version=19").get())
      this.db.transaction(() =>
        this.db.exec(readFileSync("migrations/019.sql", "utf8")),
      )();
    if (!this.db.prepare("SELECT 1 FROM schema_version WHERE version=20").get())
      this.db.transaction(() =>
        this.db.exec(readFileSync("migrations/020.sql", "utf8")),
      )();
    if (!this.db.prepare("SELECT 1 FROM schema_version WHERE version=21").get())
      this.db.transaction(() =>
        this.db.exec(readFileSync("migrations/021.sql", "utf8")),
      )();
    if (!this.db.prepare("SELECT 1 FROM schema_version WHERE version=22").get())
      this.db.transaction(() =>
        this.db.exec(readFileSync("migrations/022.sql", "utf8")),
      )();
    if (!this.db.prepare("SELECT 1 FROM schema_version WHERE version=23").get())
      this.db.transaction(() =>
        this.db.exec(readFileSync("migrations/023.sql", "utf8")),
      )();
    if (!this.db.prepare("SELECT 1 FROM schema_version WHERE version=24").get())
      this.db.transaction(() =>
        this.db.exec(readFileSync("migrations/024.sql", "utf8")),
      )();
    if (
      !this.db.prepare("SELECT 1 FROM schema_version WHERE version=25").get()
    ) {
      this.db.pragma("foreign_keys = OFF");
      try {
        this.db.transaction(() => {
          this.db.exec(readFileSync("migrations/025.sql", "utf8"));
          if ((this.db.pragma("foreign_key_check") as unknown[]).length)
            throw Error(
              "Additional-grant migration foreign-key check failed; preserve the original database and repair before admission",
            );
        })();
      } finally {
        this.db.pragma("foreign_keys = ON");
      }
    }
    if (!this.db.prepare("SELECT 1 FROM schema_version WHERE version=26").get())
      this.db.transaction(() =>
        this.db.exec(readFileSync("migrations/026.sql", "utf8")),
      )();
    if (!this.db.prepare("SELECT 1 FROM schema_version WHERE version=27").get())
      this.db.transaction(() =>
        this.db.exec(readFileSync("migrations/027.sql", "utf8")),
      )();
    if (!this.db.prepare("SELECT 1 FROM schema_version WHERE version=28").get())
      this.db.transaction(() =>
        this.db.exec(readFileSync("migrations/028.sql", "utf8")),
      )();
    if (!this.db.prepare("SELECT 1 FROM schema_version WHERE version=29").get())
      this.db.transaction(() =>
        this.db.exec(readFileSync("migrations/029.sql", "utf8")),
      )();
    if (!this.db.prepare("SELECT 1 FROM schema_version WHERE version=30").get())
      this.db.transaction(() =>
        this.db.exec(readFileSync("migrations/030.sql", "utf8")),
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
