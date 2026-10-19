import { randomUUID } from "node:crypto";
import type { Attempt, Store } from "./db.js";

type Grant = {
  at: number;
  actor: string;
  automatic: boolean;
  expires: number | null;
  generation: number;
  used_at?: number;
  revoked_at?: number;
  replaced_at?: number;
  historical?: boolean;
  consumed?: boolean;
};
type Entry = {
  id: string;
  attempt: string;
  opened: number | null;
  generation: number;
  events: { at: number; reason: string }[];
  authorizations: Grant[];
  ended: number | null;
  outcome: null | "resumed" | "attempt-ended" | "historical";
  historical: boolean;
};
function parse(row: any): Entry {
  return {
    ...row,
    events: JSON.parse(row.events),
    authorizations: JSON.parse(row.authorizations),
    historical: !!row.historical,
  };
}
export class InterruptionHistory {
  constructor(private store: Store) {}
  private open(id: string): Entry | undefined {
    const r = this.store.db
      .prepare(
        "SELECT * FROM attempt_interruptions WHERE attempt=? AND outcome IS NULL",
      )
      .get(id);
    return r ? parse(r) : undefined;
  }
  private save(e: Entry) {
    this.store.db
      .prepare(
        "INSERT INTO attempt_interruptions VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET generation=excluded.generation,events=excluded.events,authorizations=excluded.authorizations,ended=excluded.ended,outcome=excluded.outcome",
      )
      .run(
        e.id,
        e.attempt,
        e.opened,
        e.generation,
        JSON.stringify(e.events),
        JSON.stringify(e.authorizations),
        e.ended,
        e.outcome,
        e.historical ? 1 : 0,
      );
  }
  pause(a: Attempt, reason: string, at = Date.now()) {
    if (!a.start || a.state !== "LOCKED" || this.deleted(a.id)) return;
    this.store.db.transaction(() => {
      const e = this.open(a.id) || {
        id: randomUUID(),
        attempt: a.id,
        opened: at,
        generation: a.generation,
        events: [],
        authorizations: [],
        ended: null,
        outcome: null,
        historical: false,
      };
      if (!e.events.some((v) => v.reason === reason)) {
        if (e.events.length < 100) e.events.push({ at, reason });
        else
          e.events[99] = {
            at,
            reason:
              "Additional reasons omitted after the per-interruption event limit.",
          };
      }
      if (a.generation > e.generation) {
        for (const grant of e.authorizations)
          if (
            !grant.used_at &&
            !grant.consumed &&
            !grant.revoked_at &&
            !grant.replaced_at &&
            (!grant.expires || grant.expires > at)
          )
            grant.revoked_at = at;
        e.generation = a.generation;
      }
      this.save(e);
    })();
  }
  authorize(
    a: Attempt,
    actor: string,
    expires: number,
    automatic = false,
    at = Date.now(),
  ) {
    this.pause(a, a.reason || "Exam paused", at);
    const e = this.open(a.id);
    if (!e) return;
    for (const grant of e.authorizations)
      if (
        !grant.used_at &&
        !grant.consumed &&
        !grant.revoked_at &&
        !grant.replaced_at &&
        (!grant.expires || grant.expires > at)
      )
        grant.replaced_at = at;
    e.authorizations.push({
      at,
      actor,
      automatic,
      expires,
      generation: a.generation,
    });
    this.save(e);
  }
  resume(a: Attempt, at = Date.now()) {
    const e = this.open(a.id);
    if (!e) return;
    const grant = e.authorizations.findLast(
      (g) =>
        g.generation === a.generation &&
        !g.revoked_at &&
        !g.replaced_at &&
        !g.used_at,
    );
    if (grant) grant.used_at = at;
    e.ended = at;
    e.outcome = "resumed";
    this.save(e);
  }
  end(a: Attempt) {
    const e = this.open(a.id);
    if (!e || !a.ended) return;
    e.ended = a.ended;
    e.outcome = "attempt-ended";
    for (const grant of e.authorizations)
      if (
        !grant.used_at &&
        !grant.consumed &&
        !grant.revoked_at &&
        !grant.replaced_at &&
        (!grant.expires || grant.expires > a.ended)
      )
        grant.revoked_at = a.ended;
    this.save(e);
  }
  private deleted(id: string) {
    return !!this.store.db
      .prepare("SELECT 1 FROM tombstones WHERE attempt=?")
      .get(id);
  }
  forExam(exam: string) {
    const map = new Map<string, Entry[]>();
    const rows = this.store.db
      .prepare(
        "SELECT i.* FROM attempt_interruptions i JOIN attempts a ON a.id=i.attempt WHERE a.exam=? ORDER BY i.generation,i.opened,i.id",
      )
      .all(exam);
    for (const row of rows) {
      const e = parse(row);
      if (!map.has(e.attempt)) map.set(e.attempt, []);
      map.get(e.attempt)!.push(e);
    }
    return map;
  }
  list(id: string): Entry[] {
    return this.store.db
      .prepare(
        "SELECT * FROM attempt_interruptions WHERE attempt=? ORDER BY generation,opened,id",
      )
      .all(id)
      .map(parse);
  }

  recover() {
    const open = this.store.db
      .prepare(
        "SELECT a.* FROM attempts a JOIN attempt_interruptions i ON i.attempt=a.id WHERE i.outcome IS NULL",
      )
      .all() as Attempt[];
    for (const a of open) {
      if (a.ended) this.end(a);
      else if (a.state === "ACTIVE") {
        // A previous server version may have resumed without recording when.
        const e = this.open(a.id)!;
        e.outcome = "historical";
        this.save(e);
      }
    }
    const missing = this.store.db
      .prepare(
        "SELECT a.* FROM attempts a WHERE a.state='LOCKED' AND a.start IS NOT NULL AND NOT EXISTS (SELECT 1 FROM attempt_interruptions i WHERE i.attempt=a.id AND i.outcome IS NULL)",
      )
      .all() as Attempt[];
    for (const a of missing)
      if (!this.deleted(a.id))
        this.save({
          id: randomUUID(),
          attempt: a.id,
          opened: null,
          generation: a.generation,
          events: a.reason ? [{ at: 0, reason: a.reason }] : [],
          authorizations: [],
          ended: null,
          outcome: null,
          historical: true,
        });
  }

  // Old incident/audit records prove pauses and approvals, but not when Continue
  // succeeded. Preserve those facts; never infer a resumed timestamp or duration.
  seedLegacy() {
    const attempts = this.store.db
      .prepare(
        "SELECT * FROM attempts WHERE start IS NOT NULL AND id NOT IN (SELECT attempt FROM tombstones)",
      )
      .all() as Attempt[];
    for (const a of attempts) {
      const incidents = this.store.db
        .prepare(
          "SELECT * FROM incidents WHERE attempt=? ORDER BY opened,rowid",
        )
        .all(a.id) as any[];
      const entries: Entry[] = incidents.map((i) => ({
        id: randomUUID(),
        attempt: a.id,
        opened: i.opened,
        generation: i.generation,
        events: JSON.parse(i.events),
        authorizations: [],
        ended: null,
        outcome: "historical",
        historical: true,
      }));
      const audits = this.store.db
        .prepare(
          "SELECT * FROM audit WHERE target=? AND action IN ('agent-lock','authorize-continuation','automatic-continuation') ORDER BY at,rowid",
        )
        .all(a.id) as any[];
      for (const log of audits.filter((l) => l.action === "agent-lock")) {
        let detail: any;
        try {
          detail = JSON.parse(log.detail);
        } catch {
          continue;
        }
        let entry = entries.find((e) => e.generation === detail.generation);
        if (!entry) {
          entry = {
            id: randomUUID(),
            attempt: a.id,
            opened: log.at,
            generation: detail.generation || 0,
            events: [],
            authorizations: [],
            ended: null,
            outcome: "historical",
            historical: true,
          };
          entries.push(entry);
        }
        if (
          typeof detail.reason === "string" &&
          !entry.events.some((e) => e.reason === detail.reason)
        )
          entry.events.push({ at: log.at, reason: detail.reason });
      }
      entries.sort((x, y) => (x.opened || 0) - (y.opened || 0));
      if (a.state === "LOCKED") {
        let e = entries.at(-1);
        if (!e || e.generation !== a.generation) {
          e = {
            id: randomUUID(),
            attempt: a.id,
            opened: null,
            generation: a.generation,
            events: [],
            authorizations: [],
            ended: null,
            outcome: null,
            historical: true,
          };
          entries.push(e);
        }
        e.outcome = null;
        e.generation = a.generation;
        if (!e.events.length && a.reason)
          e.events.push({ at: e.opened || 0, reason: a.reason });
      }
      const currentGrant = this.store.db
        .prepare("SELECT * FROM continuations WHERE attempt=?")
        .get(a.id) as any;
      for (const log of audits.filter((l) => l.action !== "agent-lock")) {
        const e = entries.findLast(
          (e) => e.opened !== null && e.opened <= log.at,
        );
        if (e)
          e.authorizations.push({
            at: log.at,
            actor: log.actor,
            automatic: log.action === "automatic-continuation",
            expires: null,
            generation: e.generation,
            historical: true,
          });
      }
      if (currentGrant) {
        const entry = entries.findLast(
          (e) => e.generation === currentGrant.generation,
        );
        const latest = entry?.authorizations.at(-1);
        if (latest) {
          latest.expires = currentGrant.expires;
          latest.consumed = !!currentGrant.consumed;
        }
      }
      for (const e of entries) this.save(e);
    }
  }
}
