import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Attempt } from "./db.js";
import { monitoringBootTimeMS } from "./monitoring-clock.js";
import { readinessMessage } from "../../../packages/protocol/index.js";

// Runtime callers: authenticated capture-challenges/frames/challenged routes.
// This observes capture readiness only. It is NOT a native execution permit,
// ACTIVE-owner registration, uninterrupted-coverage or retained-hold proof.
const policy = z
  .object({
    fullscreen: z.boolean(),
    visible: z.boolean(),
    focus: z.boolean(),
    keyboard: z.boolean(),
    screen: z.boolean(),
    webcam: z.boolean(),
  })
  .strict();
type Source = "screen" | "webcam";
type Policy = z.infer<typeof policy>;
type Ticket = {
  scope: string;
  source: Source;
  issued: number;
  after: number;
  ordinal: number;
  recorded?: { seq: number; hash: string; id: string; policy: string };
};
type Entry = {
  scope: string;
  touched: number;
  webcam: boolean;
  ordinal: number;
  requireAfterOrdinal: number;
  tickets: Map<string, Ticket>;
  frames: Map<Source, { issued: number; seq: number; ordinal: number }>;
  policy?: { issued: number; ordinal: number; value: Policy };
};
const WINDOW = 15000;
export class MonitoringChallengeError extends Error {
  readonly statusCode = 409;
  constructor(readonly code: string) {
    const messages: Record<string, string> = {
      scope:
        "Capture belongs to a replaced page or preparation. Return to the current preflight and sample again.",
      expired:
        "Capture verification expired. Take a fresh sample before retrying Begin.",
      not_ready:
        "Fresh required capture and preflight conditions are not confirmed. Restore screen/camera sharing, fullscreen and keyboard lock, then retry Begin. No new clock was requested.",
      clock:
        "The server clock could not verify capture freshness. Ask the operator to check the monitoring clock, then retry.",
      capacity:
        "Capture verification capacity is temporarily full. Retry shortly; contact the instructor if this persists.",
      sequence:
        "Capture sequence is out of date. Request a fresh sample before retrying.",
      conflict:
        "This capture differs from its original accepted sample. Request a fresh sample before retrying.",
      policy:
        "Capture readiness checks are incomplete. Restore the required preflight conditions and sample again.",
      source:
        "This capture source is not required by the saved attempt settings. Reload the current preflight.",
    };
    super(
      messages[code.replace("monitoring_challenge_", "")] ??
        "Capture could not be verified. Return to preflight and sample again.",
    );
  }
}
const refuse = (kind: string): never => {
  throw new MonitoringChallengeError("monitoring_challenge_" + kind);
};

export class MonitoringReadiness {
  private entries = new Map<string, Entry>();
  private lastClock = 0;
  private now() {
    let now: number;
    try {
      now = monitoringBootTimeMS();
    } catch {
      return refuse("clock");
    }
    if (!Number.isSafeInteger(now) || now < this.lastClock || now < 0)
      return refuse("clock");
    this.lastClock = now;
    return now;
  }
  private scope(a: Attempt, page: string) {
    if (
      !page ||
      page !== a.page_hash ||
      !["PREPARING", "ACTIVE", "LOCKED"].includes(a.state)
    )
      return refuse("scope");
    return JSON.stringify([a.id, page, a.generation, a.settings]);
  }
  issue(a: Attempt, page: string, source: unknown, after: number) {
    const scope = this.scope(a, page),
      now = this.now(),
      webcam = !!JSON.parse(a.settings).webcam;
    if (
      (source !== "screen" && source !== "webcam") ||
      (source === "webcam" && !webcam)
    )
      return refuse("source");
    if (
      !Number.isSafeInteger(after) ||
      after < 0 ||
      after >= Number.MAX_SAFE_INTEGER
    )
      return refuse("sequence");
    let entry = this.entries.get(a.id);
    if (!entry || entry.scope !== scope) {
      for (const [id, e] of this.entries)
        if (now - e.touched > 120000) this.entries.delete(id);
      if (!entry && this.entries.size >= 512) return refuse("capacity");
      entry = {
        scope,
        touched: now,
        webcam,
        ordinal: 0,
        requireAfterOrdinal: 0,
        tickets: new Map(),
        frames: new Map(),
      };
      this.entries.set(a.id, entry);
    }
    for (const [id, ticket] of entry.tickets)
      if (now - ticket.issued > WINDOW * 2) entry.tickets.delete(id);
    if (entry.tickets.size >= 32) return refuse("capacity");
    if (entry.ordinal >= Number.MAX_SAFE_INTEGER) return refuse("sequence");
    const challenge = randomUUID();
    entry.tickets.set(challenge, {
      scope,
      source,
      issued: now,
      after,
      ordinal: ++entry.ordinal,
    });
    entry.touched = now;
    return { challenge, source, after_sequence: after, valid_for_ms: WINDOW };
  }
  validate(a: Attempt, page: string, input: any) {
    if (!input || typeof input !== "object" || Array.isArray(input))
      return refuse("scope");
    const scope = this.scope(a, page),
      now = this.now(),
      entry = this.entries.get(a.id),
      ticket = entry?.tickets.get(input.challenge);
    if (
      !entry ||
      entry.scope !== scope ||
      !ticket ||
      ticket.scope !== scope ||
      ticket.source !== input.source
    )
      return refuse("scope");
    if (!ticket.recorded && now - ticket.issued >= WINDOW)
      return refuse("expired");
    if (!Number.isSafeInteger(input.seq) || input.seq <= 0)
      return refuse("sequence");
    if (!ticket.recorded && input.seq <= ticket.after)
      return refuse("sequence");
    const last = entry.frames.get(ticket.source);
    if (
      !ticket.recorded &&
      last &&
      (input.seq <= last.seq || ticket.ordinal <= last.ordinal)
    )
      return refuse("sequence");
    const parsed = policy.safeParse(input.readiness);
    if (!parsed.success) return refuse("policy");
    if (
      ticket.recorded &&
      (ticket.recorded.seq !== input.seq ||
        ticket.recorded.policy !== JSON.stringify(parsed.data))
    )
      return refuse("conflict");
    return { entry, ticket, policy: parsed.data };
  }
  confirm(
    a: Attempt,
    page: string,
    input: any,
    frame: { id: string; hash: string },
  ) {
    const { entry, ticket, policy: value } = this.validate(a, page, input),
      now = this.now(),
      encoded = JSON.stringify(value);
    if (ticket.recorded) {
      const old = ticket.recorded;
      if (
        old.seq !== input.seq ||
        old.hash !== frame.hash ||
        old.id !== frame.id ||
        old.policy !== encoded
      )
        return refuse("conflict");
      return this.inspect(a, page); // Exact retry retains the ORIGINAL issue time.
    }
    const previous = entry.frames.get(ticket.source);
    if (
      previous &&
      (input.seq <= previous.seq || ticket.ordinal <= previous.ordinal)
    )
      return refuse("sequence");
    ticket.recorded = {
      seq: input.seq,
      hash: frame.hash,
      id: frame.id,
      policy: encoded,
    };
    entry.frames.set(ticket.source, {
      issued: ticket.issued,
      seq: input.seq,
      ordinal: ticket.ordinal,
    });
    // A late negative observation must not be hidden by an earlier-arriving
    // positive reply. Require a challenge issued AFTER learning of that loss.
    if (readinessMessage(value, entry.webcam, "Begin"))
      entry.requireAfterOrdinal = entry.ordinal;
    if (!entry.policy || ticket.ordinal > entry.policy.ordinal)
      entry.policy = { issued: ticket.issued, ordinal: ticket.ordinal, value };
    entry.touched = now;
    return this.inspect(a, page);
  }
  inspect(a: Attempt, page: string) {
    const scope = this.scope(a, page),
      now = this.now(),
      entry = this.entries.get(a.id);
    const sources: Source[] = JSON.parse(a.settings).webcam
      ? ["screen", "webcam"]
      : ["screen"];
    if (!entry || entry.scope !== scope)
      return { complete: false, age_ms: null, observation_only: true };
    const facts = sources.map((source) => entry.frames.get(source));
    const oldest = Math.min(
      entry.policy?.issued ?? -Infinity,
      ...facts.map((fact) => fact?.issued ?? -Infinity),
    );
    const age = Number.isFinite(oldest) ? Math.max(0, now - oldest) : null;
    const complete =
      age !== null &&
      age < WINDOW &&
      !!entry.policy &&
      entry.policy.ordinal > entry.requireAfterOrdinal &&
      !readinessMessage(entry.policy.value, entry.webcam, "Begin");
    return { complete, age_ms: age, observation_only: true };
  }
}
