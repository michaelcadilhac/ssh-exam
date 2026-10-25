# Root examctl gateway management — local foundation

October 21, 2026. C1 foundation implemented/tested locally; **not deployed**.
Exam-definition configuration, roster/CSV and alert inspection/test/manual-reminder
workflows are implemented locally. See alert-management.md for its validation,
metadata-only outcomes and migration 015. Attempt/clock workflows are in
attempt-clock-management.md; interruption review/authorization, migration 016 and
private read receipts are in interruption-management.md. Bounded monitoring
metadata/replay and its all-read transient receipts are in monitoring-cli.md. Full management,
saved-work grant migration and native reconciliation for legacy definition
retirement are still pending; tracked definitions have reviewed retirement in
exam-retirement.md. This is not CLI
completeness or production qualification. Enrollment-time initial, reviewed NEW
legacy-unused initial and additional empty/exact-template grants now have shared
CLI/web workflows (initial-grants-cli.md and additional-grants-cli.md). The C14
sandbox candidate uses those review/inspection paths with fixed practice policy;
its qualification status is in sandbox-grants.md.

The local attempt-provenance candidate adds the applied historical grant
revision/hash, issuance reason and workspace source to the existing shared
`web attempts list/show` projection and dashboard/review. Current grant revisions
never replace the applied snapshot. Inspect the grant via `web grants show GRANT`
and linked source via `web attempts show SOURCE-ID`; source metadata does not
verify current native archive integrity. See [attempt-provenance.md](attempt-provenance.md)
for qualification and unavailable/legacy behavior. It is not deployed.

The October22 administrator candidate adds named default-deny metadata list/show
and secret-safe creation through the same agent identity. Shared browser/root
validation, bounded Argon2 work, scoped strong-verifier intents and no-overwrite
retries are in [administrator-management.md](administrator-management.md). It is
implemented/tested locally (426 app/full native/114 browser), not deployed or full
management. Credential
fingerprints are sensitive salted verifiers, not generic fast body hashes or
public diagnostics; protect the entire database/backups accordingly.

## Supported workflow

Use `examctl help web` / `examctl web help`, then:

```sh
sudo examctl web exams list --limit 100
sudo examctl web exams list --after midterm
sudo examctl web exams show midterm
sudo examctl web exams create midterm --name 'Midterm' --template v1 --earliest '2026-10-22T09:00:00-05:00' --latest '2026-10-22T09:30:00-05:00'
sudo examctl web exams update midterm --revision HASH-FROM-SHOW --duration-seconds 7200
```

These use the existing root agent configuration, Ed25519 callback key, pinned
gateway signing key, HTTPS callback origin and optional private CA. No browser
login/cookie, separate token, student password, endpoint override or inbound
class-server control API is added. Help/syntax work without root/configuration;
actual operations require real/effective root and a protected root-owned key.
The key is opened without following a symlink and key buffers are wiped.
Web inspection does not create/edit native state, work or student attempts.

Gateway authorization is explicit and defaults to none. The optional agent
configuration field may authorize only named implemented operations, for example:

```json
"managementOperations": ["exams.list", "exams.show"]
```

This is an operator example, not a production configuration change. Reusing a
callback key does not implicitly authorize arbitrary management. A normal signed
callback, browser cookie or self-declared human name cannot grant these powers.
Browser role/Origin/CSRF protections are unchanged. Login-only mode refuses exam
management. Future operations require shared web/CLI validation and independent
named authorization, not a generic HTTP/command proxy.

Writes require separately authorizing `exams.create`/`exams.update`. See
[exam-definition-management.md](exam-definition-management.md) for shared web/CLI
revision checks, all setting flags, partial updates and browser retry semantics.
`examctl web students help` covers shared roster and CSV workflows; see
roster-cli.md. These require separate named students.* operation authorization.

## Request, audit and retry contract

Requests bind version, management purpose, exact gateway origin audience, agent,
root-machine actor, operation/arguments, a request UUID, fresh random nonce and
a bounded 30-second validity interval. The fixed HTTPS route independently
verifies the existing pinned agent signature. Freshness/scope/signature errors
are never treated as success. HTTPS redirects are forbidden.

Migration 013 adds persistent nonce and request/outcome tables. The gateway
transaction records replay protection, request fingerprint, audit and outcome
before signing a reply. Intent execution uses a nested transaction so a future
failed mutation can roll back without losing its authenticated failed outcome.
No external/native waits belong in that database transaction. Network loss or
reply-signing failure after commit is not permission to repeat an intent blindly.

Every CLI request prints its UUID on stderr. Retry a lost response with the same
command/arguments and `--request UUID`; each invocation signs a fresh nonce. The
same ID/arguments return the original cached outcome across gateway restart.
Different arguments with the same ID conflict. An exact nonce replay is refused.
This applies to reads too: use a new ID (the default) for a refreshed snapshot.
The explicit privacy exceptions are interruptions.review and monitoring.*: only scoped metadata
receipt is cached. A retry re-reads unchanged retained history after revision and
tombstone checks, or refuses changed/deleted data; it never returns private text
from permanent outcomes. See interruption-management.md for paginated review.
Monitoring retries reread retained bytes and the original inventory watermark,
without caching private payloads; see monitoring-cli.md. The separately named
monitoring.export operation uses one bounded purpose-signed NDJSON stream, not
the ordinary single-JSON reply. Each packet is bound to the same request/nonce,
agent/attempt and increasing sequence; clean EOF and private no-replace output
publication are required before CLI success. Only inventory/count watermarks are
durable; no images/transcripts or archive payloads enter request receipts.
List is bounded/paginated (default 100, maximum 200); returned config revision
hashes fence conditional updates. Stable partial-update bodies retain exact
request-ID retry semantics without reconstructing intent from newer defaults.

Replies bind the same request/nonce/operation and agent audience under the pinned
gateway signature. The native client checks scope, freshness and size before
printing confirmed JSON. Signed refusals explain authorization/argument problems;
unknown/lost/unverified replies retain the request ID and never claim success.
`confirmed` means an authenticated gateway operation, not native execution or access
release. Native offline inspection/reconciliation remains a separate workflow.

Audit attribution is `agent:AGENT:root`, not verified human identity. Do not trust
SUDO_USER or caller-supplied human names. Audit includes operation, target,
request and confirmed/refused/retry context; never student credentials.
Keep management request/outcome records through backup/rollback. Do not clear
them as monitoring-retention data or to force a retry to succeed.

## Evidence and rollout boundary

HTTP regressions cover pinned key/purpose/audience/actor/freshness, explicit
authorization, unknown human attribution, login-only mode, replay after restart,
idempotent original snapshots, changed-argument conflicts, pagination, missing
targets and unchanged browser authentication/student attempts. Native process
tests cover help/discovery/syntax and the actual CLI over TLS in an isolated root-
mapped user namespace: success, wrong signature/audience/nonce, signed refusal,
redirect and oversized replies. Cross-language integration builds the actual
examctl binary and calls the real gateway over local TLS, restarts the gateway,
retries the original ID and verifies fresh reads/authorization revocation. No
native state or student attempt is created. Namespace root is not host-root/PAM
or institutional SSH qualification.

Reproduce opt-in interface tests with `EXAM_MANAGEMENT_USERNS=1 npm test --
--silent true tests/integration/agent-management.test.ts` from the repository,
and `EXAM_MANAGEMENT_USERNS=1 go test -race ./cmd/examctl` from ssh-server.
Local Go/unshare/OpenSSL and synthetic keys/certificates only; no production
contact during these tests. The complete application suite passes 301 tests in 51 files with this
opt-in, and the native race suite passes with all local fault/CLI opt-ins enabled.

Migration 013 is additive and does not alter exam definitions, enrollments,
attempts, clocks, protected artifacts or grants. Preserve its tables on binary
rollback. Install matching gateway/native code and deliberately authorize only
supported operations after safe drain/backup; old gateways return no supported
management route. The documented gateway is on marco and the native agent on
csc-sys: verify actual topology and deployment scope before a coordinated cutover.
No deployment to another host is silently inferred from csc-sys authorization.

Later read-only deployment inspection attempts through the configured jump and
direct csc-sys routes timed out, without an authenticated session. No production
configuration/service/data was changed; access is not yet verified.
