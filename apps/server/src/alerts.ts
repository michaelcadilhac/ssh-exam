import { randomUUID } from "node:crypto";
import { Store, now, type Attempt } from "./db.js";

export interface AlertKey {
  attempt: string;
  event: string;
  generation: number;
  cause: string;
}

export class Alerts {
  constructor(private store: Store) {}

  enqueue(subject: string, body: string, key?: AlertKey, notBefore = 0) {
    return this.store.db.transaction(() => {
      if (key) {
        const existing = this.store.db
          .prepare(
            "SELECT * FROM alert_episodes WHERE attempt=? AND event=? AND generation=? AND resolved IS NULL",
          )
          .get(key.attempt, key.event, key.generation) as any;
        if (existing?.cause === key.cause) {
          this.store.db
            .prepare("UPDATE alert_episodes SET last_seen=? WHERE id=?")
            .run(now(), existing.id);
          return existing.outbox as string;
        }
        if (existing) this.resolve(key.attempt, key.event, key.generation);
      }
      // Never merge different students or truncate a failure report by subject.
      const id = randomUUID();
      this.store.db
        .prepare("INSERT INTO outbox(id,subject,body,next) VALUES(?,?,?,?)")
        .run(id, subject, body, Math.max(now(), notBefore));
      if (key) {
        const episode = randomUUID();
        this.store.db
          .prepare(
            "INSERT INTO alert_episodes(id,attempt,event,generation,cause,opened,last_seen,outbox) VALUES(?,?,?,?,?,?,?,?)",
          )
          .run(
            episode,
            key.attempt,
            key.event,
            key.generation,
            key.cause,
            now(),
            now(),
            id,
          );
        this.store.audit(
          "gateway",
          "alert-episode-opened",
          key.attempt,
          JSON.stringify({
            episode,
            event: key.event,
            generation: key.generation,
            outbox: id,
          }),
        );
      }
      return id;
    })();
  }

  resolve(attempt: string, event: string, generation?: number) {
    this.store.db.transaction(() => {
      const rows = this.store.db
        .prepare(
          "SELECT id,outbox,generation FROM alert_episodes WHERE attempt=? AND event=? AND resolved IS NULL",
        )
        .all(attempt, event) as {
        id: string;
        outbox: string;
        generation: number;
      }[];
      for (const row of rows) {
        if (generation !== undefined && row.generation !== generation) continue;
        this.store.db
          .prepare("UPDATE alert_episodes SET resolved=? WHERE id=?")
          .run(now(), row.id);
        this.store.db
          .prepare(
            "UPDATE outbox SET status='cancelled' WHERE id=? AND status='pending'",
          )
          .run(row.outbox);
        this.store.audit("gateway", "alert-episode-resolved", attempt, row.id);
      }
    })();
  }
}

const date = (at: number | null | undefined) =>
  at
    ? new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Chicago",
        dateStyle: "full",
        timeStyle: "long",
      }).format(at)
    : "not recorded";

export function alertContext(a: Attempt) {
  return [
    `Student: ${a.username}`,
    `Exam: ${a.exam}`,
    `Attempt: ${a.id}`,
    `Observed: ${date(now())} (America/Chicago)`,
    `Attempt state: ${a.state}; generation: ${a.generation}`,
    `Original deadline: ${date(a.original_deadline || a.deadline)}`,
    `Current deadline: ${date(a.deadline)}`,
    `Submission: ${a.protected ? "verified protected copy secured" : "protection not verified"}`,
    `Account restriction: ${a.access_state}; policy: ${a.policy_state || "unconfirmed"}`,
    `Dashboard: /admin; select exam ${JSON.stringify(a.exam)}, student ${JSON.stringify(a.username)}, Review attempt ${a.id}.`,
    `Local inspection: examctl info ${a.id}`,
  ];
}
