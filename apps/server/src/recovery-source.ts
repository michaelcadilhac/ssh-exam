import type { Store } from "./db.js";
import { now } from "./db.js";
import { recoveryPreflight } from "../../../packages/protocol/recovery-allowance.js";
import type { z } from "zod";

// Called only after an authenticated native reply, never from a browser body.
// Survives cancelled preflight retirement; supplies no execution/consumption.
export class RecoverySources {
  constructor(
    private store: Store,
    private agent: string,
  ) {}
  known(exam: string, username: string) {
    const row = this.store.db
      .prepare(
        "SELECT receipt FROM recovery_grant_sources WHERE agent=? AND exam=? AND username=?",
      )
      .get(this.agent, exam, username) as { receipt: string } | undefined;
    return row ? recoveryPreflight.parse(JSON.parse(row.receipt)) : null;
  }
  remember(raw: z.infer<typeof recoveryPreflight>) {
    const value = recoveryPreflight.parse(raw);
    this.store.db.transaction(() => {
      const previous = this.known(value.exam, value.username);
      if (
        previous &&
        (previous.uid !== value.uid ||
          previous.source_attempt !== value.source_attempt ||
          previous.checksum !== value.checksum ||
          previous.created_at !== value.created_at)
      )
        throw Error(
          "Recovery source differs from its retained authenticated identity; preserve both records/archives and inspect the grant before retrying; duration edits cannot change saved work",
        );
      this.store.db
        .prepare(
          "INSERT INTO recovery_grant_sources VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(agent,exam,username) DO UPDATE SET receipt=excluded.receipt,observed=excluded.observed",
        )
        .run(
          this.agent,
          value.exam,
          value.username,
          value.uid,
          value.source_attempt,
          value.checksum,
          value.created_at,
          JSON.stringify(value),
          now(),
        );
      if (!previous)
        this.store.audit(
          "class-agent",
          "remember-recovery-source",
          value.exam,
          JSON.stringify({
            username: value.username,
            uid: value.uid,
            source_attempt: value.source_attempt,
            checksum: value.checksum,
            created_at: value.created_at,
          }),
        );
    })();
  }
}
