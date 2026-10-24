import { hash, now, type Store } from "./db.js";
import {
  interruptionShow,
  interruptionReview,
  interruptionAuthorize,
} from "../../../packages/protocol/interruption-management.js";

const refuse = (message: string, statusCode = 409): never => {
  throw Object.assign(Error(message), { statusCode });
};

// No native/network waits, no cached student text. Approval is permission to
// attempt the existing fresh SSH/monitoring Continue workflow, never execution.
export class InterruptionManagement {
  constructor(private store: Store) {}
  show(input: unknown) {
    const { id } = interruptionShow.parse(input);
    const a = this.store.db
      .prepare(
        `SELECT id,exam,username,state,generation,
      continuation_revision revision,start,deadline,original_deadline,clock_revision,
      ended,protected,access_state,monitoring_mode,retained_hold,monitoring_hold_kind FROM attempts WHERE id=?`,
      )
      .get(id) as any;
    if (!a)
      return refuse(
        "Attempt not found; use examctl web attempts list EXAM",
        404,
      );
    const authorization = this.store.db
      .prepare(
        "SELECT generation,expires,consumed FROM continuations WHERE attempt=?",
      )
      .get(id) as any;
    return {
      ...a,
      authorization: authorization || null,
      historyDeleted: !!this.store.db
        .prepare("SELECT 1 FROM tombstones WHERE attempt=?")
        .get(id),
      serverNow: now(),
      source: "gateway metadata, not native freeze/readiness verification",
    };
  }
  receipt(input: unknown) {
    const b = interruptionReview.parse(input);
    const current = this.show({ id: b.id });
    if (current.historyDeleted)
      return refuse(
        "Interruption monitoring history was deleted; it cannot be replayed",
        410,
      );
    if (b.revision !== undefined && current.revision !== b.revision)
      return refuse(
        "Interruption changed while paging; use a new intent and restart review from the first page with the current revision",
      );
    return {
      id: b.id,
      generation: current.generation,
      revision: current.revision,
      transient: true,
    };
  }
  // Called AFTER durable management outcome storage. Only the small receipt is
  // cached. Every read/retry rechecks retention and revision in a read snapshot.
  review(
    input: unknown,
    receipt: { generation: number; revision: number },
    actor: string,
  ) {
    const b = interruptionReview.parse(input);
    return this.store.db.transaction(() => {
      const current = this.show({ id: b.id });
      if (current.historyDeleted)
        return refuse(
          "Interruption monitoring history was deleted; it cannot be replayed",
          410,
        );
      if (
        current.generation !== receipt.generation ||
        current.revision !== receipt.revision
      )
        return refuse(
          `Interruption review changed (generation ${current.generation}, revision ${current.revision}); use a NEW --request for a fresh review before authorization`,
        );
      const history = b.section === "history";
      const rows = this.store.db
        .prepare(
          history
            ? "SELECT id,attempt,opened,generation,substr(events,1,65537) events,substr(authorizations,1,65537) authorizations,ended,outcome,historical FROM attempt_interruptions WHERE attempt=? AND id>? ORDER BY id LIMIT ?"
            : "SELECT id,attempt,generation,opened,substr(events,1,65537) events,substr(message,1,1001) message,review_at FROM incidents WHERE attempt=? AND id>? ORDER BY id LIMIT ?",
        )
        .all(b.id, b.after || "", b.limit + 1) as any[];
      const selected = rows.slice(0, b.limit).map((r) => {
        if (
          r.events.length > 65536 ||
          (r.authorizations?.length || 0) > 65536 ||
          (r.message?.length || 0) > 1000
        )
          return refuse(
            "Stored interruption exceeds review bounds; preserve history and inspect the authenticated dashboard/native info",
          );
        try {
          return {
            ...r,
            events: JSON.parse(r.events),
            ...(history
              ? { authorizations: JSON.parse(r.authorizations) }
              : {}),
          };
        } catch {
          return refuse(
            "Stored interruption data is malformed; preserve history and inspect the authenticated dashboard/native info",
          );
        }
      });
      // UTF-8 and signature/base64 overhead must also fit the transport budget.
      if (Buffer.byteLength(JSON.stringify(selected)) > 5 * 1024 * 1024)
        return refuse(
          "Review page exceeds transport bounds; use a smaller --limit",
        );
      this.store.audit(
        actor,
        "review-interruption",
        b.id,
        JSON.stringify({
          section: b.section,
          revision: current.revision,
          after: b.after || null,
        }),
      );
      return {
        current,
        section: b.section,
        entries: selected,
        next: rows.length > b.limit ? selected.at(-1)!.id : null,
        retention:
          "transient read; durable retry record contains metadata receipt only; new intent needed after changes",
      };
    })();
  }
  authorize(input: unknown, actor: string) {
    const b = interruptionAuthorize.parse(input);
    const fingerprint = hash(JSON.stringify(b));
    return this.store.db.transaction(() => {
      const prior = this.store.db
        .prepare(
          "SELECT fingerprint,result FROM continuation_requests WHERE actor=? AND request=?",
        )
        .get(actor, b.requestID) as any;
      if (prior) {
        if (prior.fingerprint !== fingerprint)
          return refuse(
            "Continuation intent conflicts with different arguments; inspect current interruption and review a new intent",
          );
        return JSON.parse(prior.result);
      }
      const a = this.store.attempt(b.id),
        at = now();
      const current = this.show({ id: b.id });
      const guidance = `Current state ${a.state}, generation ${a.generation}, review revision ${current.revision}, deadline ${a.deadline}; inspect examctl web interruptions show ${b.id}, review ${b.id} and native examctl info ${b.id}`;
      if (a.generation !== b.generation || current.revision !== b.revision)
        return refuse(
          `Interruption changed after review; do not authorize the replacement without fresh review. ${guidance}`,
        );
      if (
        a.state !== "LOCKED" ||
        !a.start ||
        a.ended ||
        a.protected ||
        !a.deadline ||
        a.deadline <= at
      )
        return refuse(`Attempt cannot continue. ${guidance}`);
      const expires = Math.min(a.deadline, at + 300000);
      this.store.db
        .prepare("INSERT OR REPLACE INTO continuations VALUES(?,?,?,0)")
        .run(a.id, a.generation, expires);
      this.store.interruptions.authorize(a, actor, expires, false, at);
      this.store.audit(
        actor,
        "authorize-continuation",
        a.id,
        JSON.stringify({
          requestID: b.requestID,
          generation: b.generation,
          revision: b.revision,
          reason: b.reason,
          expires,
        }),
      );
      if (a.monitoring_mode !== "v1")
        this.store.audit(
          actor,
          "authorized-authentication-gap",
          a.id,
          String(a.generation),
        );
      const result = {
        id: a.id,
        generation: a.generation,
        requestID: b.requestID,
        expires,
        status: "authorized",
        execution: false,
        note: "Approval does not resume work. Existing fresh SSH, current page/monitoring and native Continue checks still apply. Inspect fresh status; a cached reply is not a current permission.",
      };
      this.store.db
        .prepare("INSERT INTO continuation_requests VALUES(?,?,?,?,?)")
        .run(actor, b.requestID, fingerprint, JSON.stringify(result), at);
      return result;
    })();
  }
}
