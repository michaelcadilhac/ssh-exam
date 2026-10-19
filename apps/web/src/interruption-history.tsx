import React from "react";
import { chicago } from "./api.js";
import { formatDuration } from "../../../packages/protocol/time.js";
import {
  interruptionSeconds,
  authorizationStatus,
} from "../../../packages/protocol/interruptions.js";
export function InterruptionHistory({
  attempt,
  clock,
}: {
  attempt: any;
  clock: number;
}) {
  const entries = attempt.interruptions || [];
  if (attempt.interruptionHistoryDeleted)
    return (
      <p className="interruption-empty">
        Interruption history was deleted with monitoring.
      </p>
    );
  if (!entries.length)
    return (
      <p className="interruption-empty">
        {attempt.state === "LOCKED"
          ? "Pause details were not recorded."
          : "No interruptions recorded."}
      </p>
    );
  return (
    <ol
      className="interruption-list"
      aria-label={`Interruptions for ${attempt.username} attempt ${attempt.attempt_number}`}
    >
      {entries.map((entry: any, index: number) => {
        const seconds = interruptionSeconds(entry, attempt, clock);
        return (
          <li key={entry.id}>
            <div className="interruption-heading">
              <strong>Interruption {index + 1}</strong>
              <span>
                {seconds === null
                  ? "Duration not recorded"
                  : formatDuration(seconds)}{" "}
                ·{" "}
                {entry.outcome === "resumed"
                  ? "Resumed"
                  : entry.outcome === "attempt-ended"
                    ? "Ended with exam"
                    : entry.outcome === "historical"
                      ? "Past interruption"
                      : "Ongoing"}
              </span>
            </div>
            <p className="interruption-dates">
              Started{" "}
              {entry.opened ? chicago(entry.opened) : "at an unrecorded time"}
              {entry.ended
                ? ` · ${entry.outcome === "resumed" ? "Resumed" : "Ended"} ${chicago(entry.ended)}`
                : ""}
            </p>
            <div className="interruption-body">
              <div>
                <strong>Reason</strong>
                {entry.events.length ? (
                  <ul>
                    {entry.events.map((event: any, i: number) => (
                      <li key={i}>
                        {event.reason}
                        {entry.events.length > 1 && !!event.at && (
                          <time> · {chicago(event.at)}</time>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>Not recorded</p>
                )}
              </div>
              <div>
                <strong>Authorization</strong>
                {entry.authorizations.length ? (
                  <ul>
                    {entry.authorizations.map((grant: any, i: number) => (
                      <li key={i}>
                        <span>
                          {grant.automatic
                            ? "Automatically authorized"
                            : `Authorized by ${grant.actor}`}{" "}
                          · {chicago(grant.at)}
                        </span>
                        <small>
                          {authorizationStatus(grant, clock)}
                          {grant.used_at
                            ? ` · ${chicago(grant.used_at)}`
                            : grant.revoked_at
                              ? ` · ${chicago(grant.revoked_at)}`
                              : grant.replaced_at
                                ? ` · ${chicago(grant.replaced_at)}`
                                : grant.expires && !grant.historical
                                  ? ` · expires ${chicago(grant.expires)}`
                                  : ""}
                        </small>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>{entry.historical ? "Not recorded" : "Not authorized"}</p>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
