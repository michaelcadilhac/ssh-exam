import { randomUUID } from "node:crypto";
import { Store, now } from "./db.js";
import { Agent } from "./agent.js";
import { Lifecycle } from "./lifecycle.js";
import {
  effectiveDeadline,
  timerPaused,
  timerState,
} from "../../../packages/protocol/timer.js";

export class ClockControl {
  private autoResumeAfter = "";
  constructor(
    private store: Store,
    private agent: Agent,
    private life: Lifecycle,
  ) {}
  pending(id: string): any | null {
    const row = this.store.db
      .prepare(
        "SELECT body FROM clock_reset_requests WHERE attempt=? AND status='pending'",
      )
      .get(id) as any;
    return row ? JSON.parse(row.body) : null;
  }
  // This is gateway-owned future clock authorization, not native work authority.
  // Keep it out of the unchanged signed native clock protocol.
  nativeIntent(body: any) {
    const {
      resume_on_work,
      resume_on_work_generation,
      resume_on_work_after,
      ...request
    } = body;
    return request;
  }
  resumeOnWorkEnabled(a: any): boolean {
    if (
      !timerPaused(a) ||
      a.protected ||
      !["ACTIVE", "LOCKED"].includes(a.state)
    )
      return false;
    return !!this.store.db
      .prepare(
        `SELECT 1 FROM clock_reset_requests r JOIN attempts a ON a.id=r.attempt
         WHERE r.attempt=? AND r.status='applied'
         AND json_extract(r.body,'$.resume_on_work')=1
         AND json_extract(r.body,'$.requested_at')=?
         AND r.id=(SELECT json_extract(h.value,'$.id') FROM json_each(a.clock_resets) h
           WHERE json_extract(h.value,'$.pause_timer')=1 ORDER BY CAST(h.key AS INTEGER) DESC LIMIT 1)`,
      )
      .get(a.id, timerState(a).timer_paused_at);
  }
  // Runtime callers: successful student Continue and the existing root clock
  // poll (including restart recovery). Only the durable successful continuation
  // audit supplies the acceptance instant; login, approval and status reads do not.
  resumeReadyTimers(id?: string) {
    const rows = this.store.db
      .prepare(
        `SELECT r.id,r.body,MIN(v.at) resumed_at FROM clock_reset_requests r
       JOIN attempts a ON a.id=r.attempt JOIN audit v ON v.target=a.id
       WHERE r.status='applied' AND a.state IN ('ACTIVE','LOCKED') AND a.protected=0
       AND json_extract(r.body,'$.resume_on_work')=1
       AND json_extract(a.clock_resets,'$[#-1].timer_paused_at')=json_extract(r.body,'$.requested_at')
       AND r.id=(SELECT json_extract(h.value,'$.id') FROM json_each(a.clock_resets) h
         WHERE json_extract(h.value,'$.pause_timer')=1 ORDER BY CAST(h.key AS INTEGER) DESC LIMIT 1)
       AND v.action IN ('resume-continuation','resume-technical-continuation')
       AND v.at>=json_extract(r.body,'$.requested_at')
       AND v.rowid>json_extract(r.body,'$.resume_on_work_after')
       AND CAST(v.detail AS INTEGER)>=json_extract(r.body,'$.resume_on_work_generation')
       AND NOT EXISTS(SELECT 1 FROM clock_reset_requests p WHERE p.attempt=a.id AND p.status='pending')
       AND (? IS NULL OR a.id=?) AND r.id>?
       GROUP BY r.id ORDER BY r.id LIMIT 100`,
      )
      .all(id ?? null, id ?? null, id ? "" : this.autoResumeAfter) as {
      id: string;
      body: string;
      resumed_at: number;
    }[];
    if (!id) this.autoResumeAfter = rows.length === 100 ? rows.at(-1)!.id : "";
    for (const row of rows) {
      const pause = JSON.parse(row.body),
        a = this.store.attempt(pause.id);
      if (!timerPaused(a) || this.life.isBusy(a.id)) continue;
      this.store.db.transaction(() => {
        const body = this.stage(
          a.id,
          0,
          pause.actor,
          a.clock_revision,
          randomUUID(),
          false,
          "resume",
          false,
          row.resumed_at,
        );
        this.store.audit(
          pause.actor,
          "countdown-auto-resume-requested",
          a.id,
          JSON.stringify({
            pauseRequest: row.id,
            resumeRequest: body.reset_id,
            resumedAt: row.resumed_at,
          }),
        );
      })();
    }
  }
  // Clock-only delivery over the existing authenticated native outbound path.
  // Requests (including conditional resume) were already authorized/audited by
  // web or examctl. Paging keeps one unapplicable request from starving later
  // students; delivery creates no execution permission or account reservation.
  dispatch(after: string) {
    this.resumeReadyTimers();
    const rows = this.store.db
      .prepare(
        `SELECT r.id,r.body FROM clock_reset_requests r JOIN attempts a ON a.id=r.attempt
       WHERE r.status='pending' AND a.state IN ('ACTIVE','LOCKED') AND a.protected=0
       AND r.id>? ORDER BY r.id LIMIT 101`,
      )
      .all(after) as { id: string; body: string }[];
    const page = rows.slice(0, 100);
    return {
      requests: page.map((row) => this.nativeIntent(JSON.parse(row.body))),
      after: rows.length > 100 ? page[page.length - 1].id : "",
    };
  }
  async deliver(id: string) {
    const request = this.pending(id);
    if (request && this.agent.connected(this.store.attempt(id).username))
      this.life.acceptRemote(
        await this.agent.call("reset-clock", this.nativeIntent(request)),
      );
  }
  // Synchronous durable intent only; safe within a management transaction. No
  // SSH, health/network wait or native confirmation is performed here.
  stage(
    id: string,
    minutes: number,
    actor: string,
    revision: number,
    requestID: string = randomUUID(),
    extend = false,
    timerAction?: "pause" | "resume",
    resumeOnWork = false,
    acceptedAt?: number,
  ) {
    if (
      timerAction
        ? minutes !== 0 || extend
        : !Number.isInteger(minutes) || minutes < 1 || minutes > 360
    )
      throw Error("Enter 1–360 minutes remaining");
    if (resumeOnWork && timerAction !== "pause")
      throw Error("Automatic countdown resume is available only when pausing");
    return this.store.db.transaction(() => {
      const a = this.store.attempt(id);
      const existing = this.store.db
        .prepare("SELECT body,status FROM clock_reset_requests WHERE id=?")
        .get(requestID) as any;
      if (existing) {
        if (existing.status === "closed")
          throw Error(
            "Clock change was not applied because the attempt finished",
          );
        const body = JSON.parse(existing.body);
        if (
          body.id !== id ||
          body.actor !== actor ||
          body.remaining_seconds !== (extend ? 0 : minutes * 60) ||
          (body.extend_seconds || 0) !== (extend ? minutes * 60 : 0) ||
          !!body.pause_timer !== (timerAction === "pause") ||
          !!body.resume_timer !== (timerAction === "resume") ||
          !!body.resume_on_work !== resumeOnWork ||
          body.clock_revision !== revision
        )
          throw Error("Conflicting clock reset retry");
        return body;
      }
      // One acceptance instant must fence BOTH eligibility and the signed body.
      // Crossing the old deadline between two Date.now calls otherwise records
      // an intent the native agent can never legally apply.
      const requestedAt = acceptedAt ?? now();
      if (
        !["ACTIVE", "LOCKED"].includes(a.state) ||
        !a.start ||
        !a.deadline ||
        effectiveDeadline(a) <= requestedAt ||
        a.protected
      )
        throw Error(
          "Only an unfinished exam before its current deadline can be reset",
        );
      if ((a.clock_revision || 0) !== revision)
        throw Error("Clock changed; refresh before resetting");
      if (resumeOnWork && a.state !== "LOCKED")
        throw Error(
          "Automatic countdown resume requires a stopped student; refresh their current status",
        );
      if (
        !Number.isSafeInteger(requestedAt) ||
        requestedAt < a.start! ||
        requestedAt > now()
      )
        throw Error("Invalid countdown acceptance instant");
      if (
        timerAction &&
        (a.monitoring_mode !== "v1" ||
          timerPaused(a) !== (timerAction === "resume"))
      )
        throw Error(
          "Timer state or native roles changed; refresh before pausing or resuming the countdown",
        );
      if (this.pending(id))
        throw Error("A clock reset is already awaiting agent confirmation");
      if (this.life.isBusy(id))
        throw Error("Another exam operation is in progress");
      const body = {
        id,
        reset_id: requestID,
        actor,
        requested_at: requestedAt,
        remaining_seconds: extend ? 0 : minutes * 60,
        ...(extend ? { extend_seconds: minutes * 60 } : {}),
        ...(timerAction === "pause" ? { pause_timer: true } : {}),
        ...(resumeOnWork
          ? {
              resume_on_work: true,
              resume_on_work_generation: a.generation,
              resume_on_work_after: (
                this.store.db
                  .prepare("SELECT COALESCE(MAX(rowid),0) n FROM audit")
                  .get() as { n: number }
              ).n,
            }
          : {}),
        ...(timerAction === "resume" ? { resume_timer: true } : {}),
        deadline: a.deadline,
        clock_revision: revision,
      };
      this.store.db
        .prepare(
          "INSERT INTO clock_reset_requests(id,attempt,body) VALUES(?,?,?)",
        )
        .run(requestID, id, JSON.stringify(body));
      this.store.audit(
        actor,
        "clock-reset-requested",
        id,
        JSON.stringify(body),
      );
      return body;
    })();
  }
  result(id: string) {
    return {
      confirmed: !this.pending(id),
      attempt: this.store.attempt(id),
      pending: this.pending(id),
    };
  }
  async reset(
    id: string,
    minutes: number,
    actor: string,
    revision: number,
    requestID: string = randomUUID(),
    deferDelivery = false,
    extend = false,
    timerAction?: "pause" | "resume",
    resumeOnWork = false,
  ) {
    this.stage(
      id,
      minutes,
      actor,
      revision,
      requestID,
      extend,
      timerAction,
      resumeOnWork,
    );
    // Delivery failure is explicitly pending. The root agent will obtain this
    // durable request during its outbound check before deadline collection.
    if (
      !deferDelivery &&
      this.pending(id) &&
      ["ACTIVE", "LOCKED"].includes(this.store.attempt(id).state) &&
      this.agent.connected(this.store.attempt(id).username)
    ) {
      try {
        await this.deliver(id);
      } catch {
        /* Keep the exact request for signed callback/deadline recovery. */
      }
    }
    return this.result(id);
  }
}
