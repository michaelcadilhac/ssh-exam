# Durable notification episodes

Local implementation, October 20, 2026. **Not deployed.** Production maintenance
deferrals remain in force. Migration 012 is additive and preserves attempts,
submissions, timing, restrictions and the existing outbox.

An attempt notification is identified by attempt UUID, event type, generation and
cause. A repeated observation updates the durable episode instead of enqueuing a
new email, even after SMTP delivery, exhausted retries or application restart.
A changed cause resolves the previous episode and creates another; explicit
resolution followed by recurrence creates a new episode. Different attempts and
events never merge based on subject, and bodies are never truncated into a shared
summary. Resolution cancels unsent obsolete notifications/retries while preserving
their records. It cannot recall an email already accepted by SMTP.

Actual SMTP deliveries keep one stable Message-ID per outbox row across retries.
SMTP is not a transactional participant in SQLite: a crash after SMTP accepts a
message but before the sent status commits can still redeliver that same ID.
This mechanism prevents duplicate callback/reconciliation enqueueing; it cannot
promise exactly-once delivery by arbitrary mail servers. Delivery failures and
attempt failures remain distinct. Reminders/escalation are not automatic; the
supported management workflow still needs implementation of the C1-approved
agent-authenticated root CLI path before adding explicit escalation controls.

Failure messages include student, exam, attempt, observed time in America/Chicago,
original/current deadlines, verified protection status, account restriction state,
dashboard selection and local inspection. Untrusted filenames/reasons/messages
are quoted. A verified archive with failed workload cleanup is described as
secured work requiring termination/restoration recovery, not lost collection.
Never recollect/replace a protected bundle to clear an alert.

Policy/access alerts use the newly authenticated restriction and policy state,
not the preceding callback's state. A class-agent protected flag alone is described
as reported, not gateway-verified; only validated manifest processing establishes
the latter. Preflight cleanup diagnostics also include this context and quoted
causes. Worker failures use bound attempt context when available; otherwise the
message explicitly says no attempt is bound and leaves existing holds untouched.
Host-key diagnostics identify student/exam, observed time, reported host and safe
trusted-key verification steps without requesting credentials or recommending a
pin bypass. These notification improvements do not change enforcement.

Every accepted review request updates the dashboard and records an audit entry.
Each distinct trimmed message emails once per interruption generation. Duplicate
clicks, reloads and retries retain useful requests without another email; changed
messages and new interruptions can notify, subject to the existing rate limit.
There are no timed reminders and a request grants no continuation permission.

Intentional policy change: routine Emacs `.#NAME` symlink omission records no
longer require a saved sibling to suppress email. Mixed reports exclude those
entries but retain all other omissions. Every entry stays in the protected
manifest; restoration never follows links. Collection errors remain independent.

Deploy only in an authorized drained window after the regression suite, actual
controlled SMTP recipient delivery and callback replay checks. Preserve migration
012, alert episodes, outbox and audit on backup/rollback. Old code can read the
additive schema but does not enforce episode deduplication; an old-code rollback
can resume duplicate notifications. Do not delete delivery history to retry mail.
