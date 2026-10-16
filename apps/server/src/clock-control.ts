import { randomUUID } from "node:crypto";
import { Store, now } from "./db.js";
import { Agent } from "./agent.js";
import { Lifecycle } from "./lifecycle.js";

export class ClockControl {
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
  async deliver(id: string) {
    const request = this.pending(id);
    if (request && this.agent.connected(this.store.attempt(id).username))
      this.life.acceptRemote(await this.agent.call("reset-clock", request));
  }
  async reset(
    id: string,
    minutes: number,
    actor: string,
    revision: number,
    requestID: string = randomUUID(),
  ) {
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 360)
      throw Error("Enter 1–360 minutes remaining");
    const request = this.store.db.transaction(() => {
      const a = this.store.attempt(id);
      const existing = this.store.db
        .prepare("SELECT body FROM clock_reset_requests WHERE id=?")
        .get(requestID) as any;
      if (existing) {
        const body = JSON.parse(existing.body);
        if (
          body.id !== id ||
          body.actor !== actor ||
          body.remaining_seconds !== minutes * 60 ||
          body.clock_revision !== revision
        )
          throw Error("Conflicting clock reset retry");
        return body;
      }
      if (
        !["ACTIVE", "LOCKED"].includes(a.state) ||
        !a.start ||
        !a.deadline ||
        a.deadline <= now() ||
        a.protected
      )
        throw Error(
          "Only an unfinished exam before its current deadline can be reset",
        );
      if ((a.clock_revision || 0) !== revision)
        throw Error("Clock changed; refresh before resetting");
      if (this.pending(id))
        throw Error("A clock reset is already awaiting agent confirmation");
      if (this.life.isBusy(id))
        throw Error("Another exam operation is in progress");
      const body = {
        id,
        reset_id: requestID,
        actor,
        requested_at: now(),
        remaining_seconds: minutes * 60,
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
    // Delivery failure is explicitly pending. The root agent will obtain this
    // durable request during its outbound check before deadline collection.
    if (
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
    return {
      confirmed: !this.pending(id),
      attempt: this.store.attempt(id),
      pending: this.pending(id),
    };
  }
}
