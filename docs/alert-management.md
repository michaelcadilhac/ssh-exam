# Notification inspection and explicit reminders

October 21, 2026. Implemented/tested locally; qualification in todo-progress.md.
**Not deployed.** No production email, record or configuration was changed.

The web Alerts dialog and root examctl share one notification management service.
The existing agent identity, fixed pinned HTTPS origin, explicit named
`alerts.list`, `alerts.show`, `alerts.test`, `alerts.remind` authorization and audit
apply to CLI calls. No new credential/listener or SMTP-recipient override exists.
Browser administration retains session, Origin and CSRF checks. Desktop
notification permission and attention sound are settings of that browser/device,
not remotely managed server settings or substitutes for configured email.

## Discoverable workflow

```sh
examctl web alerts help
sudo examctl web alerts list --status failed
sudo examctl web alerts show OUTBOX_UUID
sudo examctl web alerts remind EPISODE_UUID --revision HASH-FROM-SHOW --reason 'Instructor requests deliberate follow-up'
sudo examctl web alerts show REMINDER-OUTBOX-UUID
sudo examctl web alerts test
sudo examctl web alerts show TEST-OUTBOX-UUID
```

Outbox IDs identify messages; episode IDs identify a durable failure occurrence.
Do not interchange them. List returns 50 rows by default (maximum 200), filters
pending/sent/failed/cancelled/all and paginates by exclusive UUID cursor. UUID
ordering is not chronological; refresh with a new management request ID.
Show/list expose bounded operational metadata, the episode revision and latest
ten reminders plus total count, not raw email bodies, causes, student review
messages, terminal/media payloads or SMTP secrets. Those bodies are not copied
into permanent management outcome caches. Do not put credentials in a reason.

Web Alerts offers the same status filters, pagination, exact Outbox ID lookup,
five-second non-overlapping refresh, test and deliberate reminder form. The
reviewed episode revision stays fixed while editing or retrying; polling cannot
silently substitute a newer revision. Lost replies reuse the same intent ID.
Changed input gets a new ID. On stale refusal, cancel, refresh and deliberately
review/select again. Stale/unavailable delivery data disables new choices.

Test/remind acknowledge **queued**, never delivered. Inspect the returned outbox
ID in either interface. Pending means waiting/retrying; failed means retries
were exhausted; cancelled means unsent mail was withdrawn; sent means SMTP
accepted, not that the instructor received/read it. Automatic SMTP retry keeps
the stable Message-ID for that outbox row. Acceptance followed by process death
before the database commit can still cause a repeated delivery; exactly-once
SMTP delivery is not promised. Missing SMTP configuration refuses the test rather
than displaying false success. Existing configured recipients are the only targets.

## Reminder and episode policy

No automatic reminders or periodic escalation are introduced. A manual reminder
requires a current unresolved episode, its reviewed revision and an audited
8..1000-character reason. The original notice and all earlier reminders must
not be pending. Resolution, obsolete generation/interruption, cancelled notices
and a competing deliberate reminder refuse with exact inspection guidance.
Each new reminder advances the revision. Repeated unchanged callbacks still
deduplicate to the original episode; no original retry/status/history is reset.
Test/legacy notices without a durable episode cannot receive an episode reminder.

The reminder is a separate outbox row explicitly labelled as an operator
follow-up. It includes current **gateway metadata, not fresh native verification**,
the episode/source linkage and reason, rather than copying the original review
or monitoring text. It never resumes work, grants continuation, changes time,
reopens completion or releases restrictions. Native `examctl info ATTEMPT` and
the authenticated dashboard remain necessary to diagnose actual exam state.

Episode resolution cancels unsent associated reminders atomically. Immediately
before SMTP, a final check cancels reminders whose episode became resolved,
generation changed, interruption resumed or preflight ceased to be unstarted.
Mail already handed to SMTP cannot be recalled. Cancellation is audited and
does not pretend that the underlying incident was repaired by sending a message.

## Durability and migration

Migration 015 adds reminder linkage and a successful browser-intent ledger plus
indexes. It does not re-enqueue historical messages, reset episodes or change
attempts. Queue insertion, linkage, revision fence, successful intent and audit
commit together. Failed audit rolls back the mutation. Root intents also retain
the existing signed management replay/outcome contract (migration 013).

Preserve migrations 012/013/015, outbox, reminders, intent records and audit through
backup/rollback. Do not delete rows to force resend or create a new incident.
Old browser clients posting an unversioned test must reload; new browser test
requires requestID to make lost replies retry-safe. Old gateway binaries do not
know how to cancel pending manual reminders after episode resolution: do not
downgrade mail delivery with pending reminders. Quiesce delivery, preserve all
records and reconcile/cancel eligible rows with compatible tooling before a
separately authorized rollback. No rollout, rollback or consolidation is executed.

Focused local regressions cover actual compiled root-mapped CLI against real
gateway TLS, browser-authenticated HTTP, SMTP rejection/retry/restart and stable
Message-IDs, durable intent conflicts, source-status preservation, resolution/
generation cancellation, audit failure, bounded metadata/privacy and desktop/
mobile lost-reply/stale-revision/lookup workflows. Full regression evidence is
recorded separately: all 309 application tests/54 files, native race/build/vet,
typecheck/application build and 31 browser alert/definition/admin checks pass.
This does not complete all examctl management capabilities.
