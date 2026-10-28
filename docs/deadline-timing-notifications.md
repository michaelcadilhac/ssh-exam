# Deadline timing notifications

October28, implemented/tested locally; not yet deployed. Controlled live acceptance
on the installed release exposed a false email at normal expiration: the agent
reported timing verification pending while awaiting the signed response, then
protected the submission about three seconds later. This is an authenticated
handshake state, not evidence of a student violation. No clock/hold was changed.

The web lifecycle now uses the existing durable notification episode/outbox to
wait two minutes before sending “Collection timing verification delayed”. Repeated
pending observations and gateway restart keep the original due time; they cannot
slide it indefinitely. Authenticated timing recovery or protected completion
resolves the episode and cancels unsent mail. Persistent failure still sends once
with inspection guidance: `examctl info ATTEMPT` and
`examctl web attempts show ATTEMPT`. Automatic verification continues; do not
refund time, reopen a completed attempt or release its hold to bypass verification.

This changes notification timing only. Pending status remains immediately visible,
writers remain frozen, committed deadlines remain authoritative, and protection/
cleanup/access restoration require the existing proof. There is no new schema,
native state, authority protocol, automatic reminder or administrative capability.
Existing alert inspection/reminders work consistently through web and examctl.
Mail handed to SMTP cannot be recalled; the historical false test email/audit stays.

Regression evidence: the old code fails two of the three new signed HTTP/real SMTP
cases. The third is an existing protected-history invariant. Healthy verification
now cancels the pending notice before actual dispatcher delivery; persistent
failure/restart sends one message without extending its due time; delayed timing
requests preserve already-protected history. Final focus24 tests/6 files passes;
full application626 tests/110 files passes, with its two opt-in root CLI/TLS cases
then separately passing (11.13s). Typecheck and build pass. All five affected alert
UI browser checks pass9.0s using private API fixtures, not another live SMTP/MFA
test. Native artifacts and browser source are unchanged: prior exact-artifact
race/capacity16students/64panes evidence and the completed human test still apply.

Remaining release gate: immutable image smoke, fresh full drain/private backup,
guarded web-only replacement and final public admission/readiness/history checks.
Preserve schema33 and all new synthetic grants/attempts/source pins/outbox/audit;
never restore a pre-test database or native state. A compatible image-only rollback
is possible after a verified drain; the previous image reintroduces the false email.
