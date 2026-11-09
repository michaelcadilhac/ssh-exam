import { Alerts, signInAlertContext } from "./alerts.js";
import { now, type Store } from "./db.js";

export const SIGN_IN_NOTICE_GRACE_MS = 5 * 60 * 1000;
const IDLE_MS = 30 * 60 * 1000;
const EVENT = "sign-in-timeout";

// Notification metadata only: this scope is deliberately NOT an attempt UUID,
// account reservation, grant, clock or statement about authentication success.
export function signInNoticeAccount(scope: string) {
  const parts = scope.split("/");
  if (parts.length !== 4 || parts[0] !== "sign-in") return;
  try {
    const [agent, exam, username] = parts.slice(1).map(decodeURIComponent);
    if (agent && exam && username) return { agent, exam, username };
  } catch {
    /* Invalid historical metadata cannot identify an account. */
  }
}

export class SignInNotifications {
  private alerts: Alerts;
  constructor(
    private store: Store,
    private agent: string,
  ) {
    this.alerts = new Alerts(store);
  }
  private scope(username: string, exam: string) {
    return (
      "sign-in/" +
      [this.agent, exam, username].map(encodeURIComponent).join("/")
    );
  }
  failed(
    username: string,
    exam: string,
    connection: { id: string; created: number },
  ) {
    return this.store.db.transaction(() => {
      const scope = this.scope(username, exam);
      const recovered = this.store.db
        .prepare(
          "SELECT at,detail FROM audit WHERE action='sign-in-notice-recovered' AND target=? ORDER BY rowid DESC LIMIT 1",
        )
        .get(scope) as { at: number; detail: string } | undefined;
      // A late failure from an older connection must not reopen a recovered notice.
      if (
        recovered &&
        recovered.at > connection.created &&
        recovered.detail !== connection.id
      )
        return;
      const prior = this.store.db
        .prepare(
          "SELECT last_seen FROM alert_episodes WHERE attempt=? AND event=? AND resolved IS NULL",
        )
        .get(scope, EVENT) as { last_seen: number } | undefined;
      if (prior && now() - prior.last_seen >= IDLE_MS)
        this.alerts.resolve(scope, EVENT);
      const outbox = this.alerts.enqueue(
        `Sign-in help needed: ${username}`,
        [
          ...signInAlertContext(username, exam),
          "",
          "Repeated SSH sign-in/setup timeouts remain unresolved. Ask the student to retry and check the server connection if the problem persists.",
          "No new exam timer was started by these failures. Existing attempts, deadlines and account restrictions are unchanged.",
          "This is one consolidated notification; individual retries remain in the server diagnostics.",
        ].join("\n"),
        {
          attempt: scope,
          event: EVENT,
          generation: 0,
          cause: "connection-timeout",
        },
        now() + SIGN_IN_NOTICE_GRACE_MS,
      );
      const episode = this.store.db
        .prepare("SELECT id FROM alert_episodes WHERE outbox=?")
        .get(outbox) as { id: string };
      this.store.audit(
        "gateway",
        "sign-in-timeout-recorded",
        scope,
        episode.id,
      );
      return outbox;
    })();
  }
  recovered(username: string, exam: string, connection: string) {
    this.store.db.transaction(() => {
      const scope = this.scope(username, exam);
      this.alerts.resolve(scope, EVENT);
      this.store.audit(
        "gateway",
        "sign-in-notice-recovered",
        scope,
        connection,
      );
    })();
  }
  prepareForDelivery(outbox: string) {
    return this.store.db.transaction(() => {
      const episode = this.store.db
        .prepare(
          "SELECT id,attempt,resolved,last_seen FROM alert_episodes WHERE outbox=? AND event=?",
        )
        .get(outbox, EVENT) as
        | {
            id: string;
            attempt: string;
            resolved: number | null;
            last_seen: number;
          }
        | undefined;
      if (!episode) return true;
      if (episode.resolved !== null) return false;
      const failures = this.store.db
        .prepare(
          "SELECT count(*) n FROM audit WHERE action='sign-in-timeout-recorded' AND target=? AND detail=?",
        )
        .get(episode.attempt, episode.id) as { n: number };
      if (failures.n < 2 || now() - episode.last_seen >= IDLE_MS) {
        this.alerts.resolve(episode.attempt, EVENT);
        return false;
      }
      return true;
    })();
  }
}
