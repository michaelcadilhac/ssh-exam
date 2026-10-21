import { Store } from "./db.js";
import { ClockControl } from "./clock-control.js";
import { AttemptManagement } from "./attempt-management.js";
import {
  clockSingle,
  clockBatch,
  clockShow,
  clockIntentMetadata,
  clockPreview,
} from "../../../packages/protocol/clock-management.js";
import { isSandbox } from "../../../packages/protocol/sandbox.js";

export function assertClockCapabilities(health: any, extend: boolean) {
  if (
    !health?.fixture &&
    ![
      "clock-reset",
      "deadline-timing-check",
      ...(extend ? ["clock-extend"] : []),
    ].every((c) => health?.capabilities?.includes(c))
  )
    throw Error(
      "Update the class-server agent before changing clocks; inspect examctl health",
    );
}

// Same synchronous validation/staging for root and browser. Delivery remains
// outside transactions through existing authenticated SSH/timing reconciliation.
export class ClockManagement {
  constructor(
    private store: Store,
    private clocks: ClockControl,
    private attempts: AttemptManagement,
  ) {}
  private current(id: string) {
    return (
      this.store.db
        .prepare(
          "SELECT id,exam,state,clock_revision,start,deadline,original_deadline,protected,access_state,policy_state FROM attempts WHERE id=?",
        )
        .get(id) || null
    );
  }
  single(input: unknown, actor: string, extend = false) {
    const b = clockSingle.parse(input);
    try {
      return this.store.db.transaction(() => {
        this.clocks.stage(
          b.id,
          b.minutes,
          actor,
          b.revision,
          b.requestID,
          extend,
        );
        return this.describe(b.id, b.requestID);
      })();
    } catch (error) {
      throw Object.assign(
        Error(
          `${(error as Error).message}; gateway state ${JSON.stringify(this.current(b.id))}; inspect examctl web attempts show ${b.id} and native examctl info ${b.id}; after review use a new management intent`,
        ),
        {
          statusCode:
            (error as Error & { statusCode?: number }).statusCode || 409,
        },
      );
    }
  }
  describe(id: string, requestID: string) {
    const intent = this.store.db
      .prepare(
        "SELECT status FROM clock_reset_requests WHERE id=? AND attempt=?",
      )
      .get(requestID, id) as { status: string } | undefined;
    return {
      confirmed: intent?.status === "applied",
      status: intent?.status || "unknown",
      requestID,
      attempt: this.attempts.show(id).attempt,
      pending: clockIntentMetadata(this.clocks.pending(id)),
    };
  }
  show(input: unknown) {
    const b = clockShow.parse(input);
    const row = this.store.db
      .prepare(
        "SELECT attempt,body,status FROM clock_reset_requests WHERE id=?",
      )
      .get(b.id) as
      | { attempt: string; body: string; status: string }
      | undefined;
    if (!row)
      throw Object.assign(
        Error(
          "Clock intent not found; inspect examctl web attempts show ATTEMPT for pending request ID",
        ),
        { statusCode: 404 },
      );
    return {
      ...this.describe(row.attempt, b.id),
      request: clockIntentMetadata(JSON.parse(row.body)),
    };
  }
  private defaultSeconds(exam: string, username: string, config: any): number {
    const enrollment = this.store.db
      .prepare("SELECT duration FROM enrollments WHERE exam=? AND username=?")
      .get(exam, username) as { duration: number | null } | undefined;
    const seconds = isSandbox(exam)
      ? 300
      : (enrollment?.duration ?? config.duration);
    if (
      !Number.isInteger(seconds) ||
      seconds < 60 ||
      seconds > 21600 ||
      seconds % 60 !== 0
    )
      throw Error(
        "Current default is not a supported whole-minute clock allowance; choose explicit web clocks reset --minutes or review future configuration",
      );
    return seconds;
  }
  preview(input: unknown) {
    const b = clockPreview.parse(input);
    const row = this.store.db
      .prepare("SELECT config FROM exams WHERE id=?")
      .get(b.exam) as { config: string } | undefined;
    if (!row) throw Error("Exam not found; use examctl web exams list");
    if (new Set(b.targets.map((t) => t.id)).size !== b.targets.length)
      throw Error("Duplicate attempt selection");
    const config = JSON.parse(row.config);
    const targets = b.targets.map((t) => {
      const a = this.store.attempt(t.id);
      if (a.exam !== b.exam)
        throw Object.assign(Error("Attempt is not in the selected exam"), {
          statusCode: 403,
        });
      if (a.clock_revision !== t.revision)
        throw Error(`Clock changed; inspect examctl web attempts show ${t.id}`);
      const expectedSeconds = this.defaultSeconds(b.exam, a.username, config);
      return {
        ...t,
        username: a.username,
        expectedSeconds,
        target: `${t.id}:${t.revision}:${expectedSeconds}`,
        state: a.state,
        pending: clockIntentMetadata(this.clocks.pending(t.id)),
      };
    });
    return {
      targets,
      note: "Read-only preview, no reservation/time change. Review expectedSeconds; reset-default requires these target amounts and refuses changed defaults.",
    };
  }
  batch(input: unknown, actor: string) {
    const b = clockBatch.parse(input);
    const row = this.store.db
      .prepare("SELECT config FROM exams WHERE id=?")
      .get(b.exam) as { config: string } | undefined;
    if (!row) throw Error("Exam not found; use examctl web exams list");
    const exam = JSON.parse(row.config);
    if (b.action === "extend" && b.minutes === undefined)
      throw Error("Enter minutes to add");
    if (
      b.action === "reset" &&
      b.targets.some((t) => t.expectedSeconds === undefined)
    )
      throw Error(
        "Reload and review each default allowance before resetting; CLI: examctl web clocks preview EXAM --target ATTEMPT:REV, then reset-default with the returned amount",
      );
    if (new Set(b.targets.map((t) => t.id)).size !== b.targets.length)
      throw Error("Duplicate attempt selection");
    for (const t of b.targets)
      if (this.store.attempt(t.id).exam !== b.exam)
        throw Object.assign(Error("Attempt is not in the selected exam"), {
          statusCode: 403,
        });
    const results = [];
    for (const t of b.targets) {
      try {
        results.push(
          this.store.db.transaction(() => {
            const attempt = this.store.attempt(t.id);
            const prior = this.store.db
              .prepare("SELECT 1 FROM clock_reset_requests WHERE id=?")
              .get(t.requestID);
            if (
              b.action === "reset" &&
              !prior &&
              this.defaultSeconds(b.exam, attempt.username, exam) !==
                t.expectedSeconds
            )
              throw Error(
                "Default allowance changed after review; refresh/review the amount and use a new intent",
              );
            const minutes =
              b.action === "extend" ? b.minutes! : t.expectedSeconds! / 60;
            this.clocks.stage(
              t.id,
              minutes,
              actor,
              t.revision,
              t.requestID,
              b.action === "extend",
            );
            const result = this.describe(t.id, t.requestID);
            return {
              id: t.id,
              ...result,
              status: result.confirmed ? "confirmed" : "pending",
            };
          })(),
        );
      } catch (error) {
        results.push({
          id: t.id,
          requestID: t.requestID,
          status: "failed",
          confirmed: false,
          current: this.current(t.id),
          error: `${(error as Error).message}; inspect examctl web attempts show ${t.id} and native examctl info ${t.id}`,
        });
      }
    }
    return { results };
  }
}
