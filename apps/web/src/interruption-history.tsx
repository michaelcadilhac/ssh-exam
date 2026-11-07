import { useExamDates } from "./exam-timezone.js";
import React from "react";

import { formatDuration } from "../../../packages/protocol/time.js";
import { NO_RESUME_EXPIRY } from "../../../packages/protocol/interruption-management.js";
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
  const { dateTime } = useExamDates();

  const entries = attempt.interruptions || [];
  if (attempt.interruptionHistoryDeleted)
    return (
      <p className="interruption-empty">
        Interruption history was deleted with recordings.
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
                    ? "Attempt ended"
                    : entry.outcome === "historical"
                      ? "Past interruption"
                      : "Ongoing"}
              </span>
            </div>
            <p className="interruption-dates">
              Started{" "}
              {entry.opened ? dateTime(entry.opened) : "at an unrecorded time"}
              {entry.ended
                ? ` · ${entry.outcome === "resumed" ? "Resumed" : "Ended"} ${dateTime(entry.ended)}`
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
                          <time> · {dateTime(event.at)}</time>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>Not recorded</p>
                )}
              </div>
              <div>
                <strong>Permission to resume</strong>
                {entry.authorizations.length ? (
                  <ul>
                    {entry.authorizations.map((grant: any, i: number) => (
                      <li key={i}>
                        <span>
                          {grant.automatic
                            ? "Allowed automatically"
                            : `Allowed by ${grant.actor}`}{" "}
                          · {dateTime(grant.at)}
                        </span>
                        <small>
                          {authorizationStatus(grant, clock)}
                          {grant.used_at
                            ? ` · ${dateTime(grant.used_at)}`
                            : grant.revoked_at
                              ? ` · ${dateTime(grant.revoked_at)}`
                              : grant.replaced_at
                                ? ` · ${dateTime(grant.replaced_at)}`
                                : grant.expires === NO_RESUME_EXPIRY
                                  ? " · no approval expiry"
                                  : grant.expires && !grant.historical
                                    ? ` · expires ${dateTime(grant.expires)}`
                                    : ""}
                        </small>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>
                    {entry.historical
                      ? "Not recorded"
                      : "No permission recorded"}
                  </p>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
