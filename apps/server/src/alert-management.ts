import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Store, hash, now, type Attempt } from "./db.js";
import { alertContext } from "./alerts.js";

const uuid = z.string().uuid();
const revision = z.string().regex(/^[a-f0-9]{64}$/);
const reason = z.string().trim().min(8).max(1000);
export const alertPage = z
  .object({
    after: uuid.optional(),
    limit: z.number().int().min(1).max(200).default(50),
    status: z
      .enum(["all", "pending", "sent", "failed", "cancelled"])
      .default("all"),
  })
  .strict();
export const alertShow = z.object({ id: uuid }).strict();
export const alertReminder = z.object({ id: uuid, revision, reason }).strict();
export const alertTest = z.object({}).strict();
const fail = (message: string, statusCode = 409): never => {
  throw Object.assign(Error(message), { statusCode });
};

// Shared browser/root service. Inspection and durable intent outcomes contain
// metadata only: never copy raw mail bodies or monitoring/review text into a
// permanent management cache. Recipients/trust remain configured, not arguments.
export class AlertManagement {
  constructor(
    private store: Store,
    private configured: () => boolean,
  ) {}

  withRequest<T>(
    actor: string,
    request: string,
    intent: unknown,
    execute: () => T,
  ): T {
    uuid.parse(request);
    const fingerprint = hash(JSON.stringify(intent));
    return this.store.db.transaction(() => {
      const prior = this.store.db
        .prepare(
          "SELECT fingerprint,result FROM alert_management_requests WHERE actor=? AND request=?",
        )
        .get(actor, request) as
        | { fingerprint: string; result: string }
        | undefined;
      if (prior) {
        if (prior.fingerprint !== fingerprint)
          return fail(
            "Alert request ID conflicts with different arguments; inspect delivery and use a new intent",
          );
        return JSON.parse(prior.result) as T;
      }
      const result = execute();
      this.store.db
        .prepare("INSERT INTO alert_management_requests VALUES(?,?,?,?,?)")
        .run(actor, request, fingerprint, JSON.stringify(result), now());
      return result;
    })();
  }

  private episode(id: string) {
    const episode = this.store.db
      .prepare("SELECT * FROM alert_episodes WHERE id=?")
      .get(id) as any;
    if (!episode)
      return fail(
        "Alert episode not found; list alerts and show the original outbox ID",
        404,
      );
    const reminders = this.store.db
      .prepare(
        "SELECT r.outbox,r.created,o.status,o.tries,o.next FROM alert_reminders r JOIN outbox o ON o.id=r.outbox WHERE r.episode=? ORDER BY r.created DESC,r.outbox DESC LIMIT 10",
      )
      .all(id) as {
      outbox: string;
      created: number;
      status: string;
      tries: number;
      next: number;
    }[];
    // last_seen and SMTP retry counters do not invalidate reviewed intent.
    // Resolution or another deliberate reminder always does.
    const count = (
      this.store.db
        .prepare("SELECT count(*) n FROM alert_reminders WHERE episode=?")
        .get(id) as { n: number }
    ).n;
    const token = hash(
      JSON.stringify({
        id: episode.id,
        attempt: episode.attempt,
        event: episode.event,
        generation: episode.generation,
        cause: episode.cause,
        resolved: episode.resolved,
        outbox: episode.outbox,
        reminderCount: count,
        reminders: reminders.map((r) => r.outbox),
      }),
    );
    const { cause: _cause, ...metadata } = episode;
    const hasPendingReminder = !!this.store.db
      .prepare(
        "SELECT 1 FROM alert_reminders r JOIN outbox o ON o.id=r.outbox WHERE r.episode=? AND o.status='pending' LIMIT 1",
      )
      .get(id);
    return {
      ...metadata,
      revision: token,
      reminders,
      reminderCount: count,
      hasPendingReminder,
    };
  }

  private obsolete(episode: any): string | null {
    if (episode.resolved !== null)
      return "Episode is resolved; a reminder cannot reopen it";
    const a = this.store.db
      .prepare("SELECT generation,state,start FROM attempts WHERE id=?")
      .get(episode.attempt) as
      | Pick<Attempt, "generation" | "state" | "start">
      | undefined;
    if (a && a.generation !== episode.generation)
      return "Episode generation is stale; inspect the current interruption instead";
    if (
      a &&
      (["interruption", "pause-confirmation"].includes(episode.event) ||
        episode.event.startsWith("review-request:"))
    ) {
      if (a.state !== "LOCKED")
        return "This interruption is no longer paused; inspect current attempt status";
    }
    if (
      a &&
      episode.event === "preflight-cleanup" &&
      (a.state !== "PREPARING" || a.start !== null)
    )
      return "Preflight is no longer an unstarted preparation; inspect current attempt status";
    const original = this.store.db
      .prepare("SELECT status FROM outbox WHERE id=?")
      .get(episode.outbox) as { status: string };
    if (original.status === "cancelled")
      return "Original notice was cancelled; inspect current attempt status";
    return null;
  }

  show(id: string) {
    uuid.parse(id);
    const mail = this.store.db
      .prepare(
        "SELECT id,substr(subject,1,512) subject,status,tries,next FROM outbox WHERE id=?",
      )
      .get(id) as any;
    if (!mail)
      return fail("Outbox message not found; use examctl web alerts list", 404);
    const binding = this.store.db
      .prepare(
        "SELECT id FROM alert_episodes WHERE outbox=? UNION ALL SELECT episode id FROM alert_reminders WHERE outbox=? LIMIT 1",
      )
      .get(id, id) as { id: string } | undefined;
    const episode = binding ? this.episode(binding.id) : null;
    const original = episode
      ? (this.store.db
          .prepare("SELECT status FROM outbox WHERE id=?")
          .get(episode.outbox) as { status: string })
      : null;
    const obsolete = episode ? this.obsolete(episode) : null;
    let refusal: string | null = null;
    if (!this.configured())
      refusal = "SMTP is not configured; no delivery is possible";
    else if (!episode)
      refusal =
        "No durable failure episode; this test/legacy notice cannot receive an episode reminder";
    else if (obsolete) refusal = obsolete;
    else if (original?.status === "pending" || episode.hasPendingReminder)
      refusal =
        "A message is pending; inspect delivery instead of queuing another reminder";
    return {
      ...mail,
      episode,
      smtpConfigured: this.configured(),
      remindable: refusal === null,
      refusal,
    };
  }

  // Recheck immediately before SMTP; a batch may have been selected before
  // resolution, continuation or generation replacement. Mail already accepted
  // by SMTP cannot be unsent, and this does not claim exactly-once delivery.
  prepareForDelivery(id: string) {
    return this.store.db.transaction(() => this.prepareReminder(id))();
  }

  private prepareReminder(id: string) {
    const reminder = this.store.db
      .prepare("SELECT episode FROM alert_reminders WHERE outbox=?")
      .get(id) as { episode: string } | undefined;
    if (!reminder) return true;
    const episode = this.episode(reminder.episode);
    const refusal = this.obsolete(episode);
    if (!refusal) return true;
    const changed = this.store.db
      .prepare(
        "UPDATE outbox SET status='cancelled' WHERE id=? AND status='pending'",
      )
      .run(id);
    if (changed.changes)
      this.store.audit("gateway", "alert-reminder-cancelled", id, refusal);
    return false;
  }

  page(input: unknown) {
    const b = alertPage.parse(input);
    const rows = this.store.db
      .prepare(
        "SELECT id FROM outbox WHERE id>? AND (?='all' OR status=?) ORDER BY id LIMIT ?",
      )
      .all(b.after || "", b.status, b.status, b.limit + 1) as { id: string }[];
    return {
      alerts: rows.slice(0, b.limit).map((r) => this.show(r.id)),
      next: rows.length > b.limit ? rows[b.limit - 1]!.id : null,
      smtpConfigured: this.configured(),
      note: "Metadata only; queued is not delivered. Browser desktop permission/sound are device-local.",
    };
  }

  test(actor: string) {
    if (!this.configured())
      return fail(
        "SMTP is not configured; configure notifications before testing delivery",
      );
    return this.store.db.transaction(() => {
      const id = randomUUID();
      this.store.db
        .prepare("INSERT INTO outbox(id,subject,body,next) VALUES(?,?,?,?)")
        .run(
          id,
          "SSH Exam notification test",
          "Test notification. Sign in to the instructor dashboard to review delivery status.",
          now(),
        );
      this.store.audit(actor, "alert-test-queued", id);
      return { queued: true, delivered: false, outbox: id };
    })();
  }

  remind(input: unknown, actor: string) {
    const b = alertReminder.parse(input);
    return this.store.db.transaction(() => {
      const episode = this.episode(b.id);
      if (episode.revision !== b.revision)
        return fail(
          `Alert episode changed; run examctl web alerts show ${episode.outbox}, review resolution/reminders and use a new intent`,
        );
      const current = this.show(episode.outbox);
      if (!current.remindable)
        return fail(
          `${current.refusal}; inspect with examctl web alerts show ${episode.outbox}`,
        );
      const a = this.store.db
        .prepare("SELECT * FROM attempts WHERE id=?")
        .get(episode.attempt) as Attempt | undefined;
      const id = randomUUID();
      const body = [
        "Explicit manual operator reminder, not a newly detected incident or permission to resume.",
        `Operator: ${JSON.stringify(actor)}`,
        `Reason: ${JSON.stringify(b.reason)}`,
        `Episode: ${episode.id}; event: ${JSON.stringify(episode.event)}; generation: ${episode.generation}`,
        `Original notice: ${episode.outbox}; opened: ${new Date(episode.opened).toISOString()}`,
        "Current gateway metadata below is not a fresh native verification. Inspect the dashboard and class-server attempt before acting.",
        ...(a
          ? alertContext(a)
          : [
              `Attempt: ${episode.attempt}; historical attempt metadata is unavailable. Preserve native history and inspect locally.`,
            ]),
      ].join("\n");
      this.store.db
        .prepare("INSERT INTO outbox(id,subject,body,next) VALUES(?,?,?,?)")
        .run(id, `Reminder: ${current.subject}`, body, now());
      this.store.db
        .prepare("INSERT INTO alert_reminders VALUES(?,?,?,?,?)")
        .run(id, episode.id, actor, b.reason, now());
      this.store.audit(
        actor,
        "alert-reminder-queued",
        episode.attempt,
        JSON.stringify({
          episode: episode.id,
          outbox: id,
          reason: b.reason,
          revision: b.revision,
        }),
      );
      return {
        queued: true,
        delivered: false,
        outbox: id,
        episode: episode.id,
      };
    })();
  }
}
