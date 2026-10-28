# Deadline timing notifications

October28, deployed/verified on marco as web7d0b894; admissions reopened06:13 UTC. Controlled live acceptance
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

Release gate completed: exact-image production-maintenance/schema11/24→33 smoke
passed with native boot clock, UID10001/read-only/no-network/cap-drop restrictions,
unchanged qualified assets and removed private fixtures. Export SHA256
`1c85d55a7de1d647c2b2fad10ba7bc9b2a9e7f94569ea3763d10a9fa1735b680`.
Source-engine OCI manifest3cf5c9a5… and exported/target configd2ae5b01… differ by
Docker image-store presentation; every blob and eleven rootfs diff IDs were bound
to the exact artifact. Actual target compiled fix and all six assets pass.

After full native/web drain and fresh private backups, only the web image-selection
env line changed. Corrected container/source7d0b894 is healthy; all38 durable tables
match the fresh SQLite backup in both directions, prior audit remains, schema33
unchanged and all174 native authoritative histories agree. Fresh post-start signed
canonical readiness passed, with one canonical agent/socket and the earlier approved
temporary-service consolidation intact. No native/SSH/relay restart occurred.
The standard nginx exam site passed target syntax and reload, public health200,
normal auth initialization200 and unauthenticated preflight/Begin/session401;
all six public assets match. Outbox remains108sent/20cancelled, incidents33: no
new or duplicate mail from replacement. This is verified installation plus local
signed-HTTP/SMTP correction qualification, not another human timed run after it.

Retained harmless verifier failures: first comparison used the source engine's
manifest ID as target config ID; a generated-script placeholder then collided
inside nested code. Both failed BEFORE service stop. Structured parameters and
local syntax checking fixed the verifier, without artifact changes. An external
probe expected400 from auth/start; actual source intentionally returns200 with an
anonymous ten-minute nonce, before any SSH/authentication or exam record. The
probe oracle was corrected; no enforcement or product change made to fit it.

Fresh backups and rollback boundary: production-rollout-2026-10-27.md. Preserve
schema33 and all new grants/attempts/source pins/outbox/audit; never restore pre-test
DB/native state. If rollback is separately needed, fence starts, positively drain
and use a compatible image-only rollback retaining current data/native cohort.
Previous815a895 supports schema33 but reintroduces the false timing email. Old
schema11/old native cohorts are not established compatible rollback targets.
