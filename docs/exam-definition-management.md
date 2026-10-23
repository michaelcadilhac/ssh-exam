# Shared definition configuration — local implementation

October 21, 2026. Implemented/tested locally; **not deployed**. C1b supports all
current exam-definition settings in web administration and root examctl through
the same ExamDefinitions validation/transaction/audit service. Full management,
definition retirement, templates and unified grants remain incomplete.

## CLI workflow

`examctl help web` documents every flag, default, unit, range and refusal. Use
list/show to inspect definitions and revision hashes. Creation requires an exam
ID, installed template name and explicit earliest/latest Begin instants in
RFC3339 with zones. Defaults match web creation: name Programming exam, duration
5400 seconds (90 minutes), webcam required, four terminals and collection limits
128 MiB/file plus 512 MiB total logical contents. `--collection-file-mib` and
`--collection-total-mib` configure those limits; see collection-limits.md for
historical compatibility, storage requirements and unchanged worker bounds.
Supported duration
range is 60..21600 seconds; terminal count 1..4. These are future defaults, not
current attempt-clock controls. Latest Begin is not latest finish.

```sh
sudo examctl web exams create midterm --name 'Midterm' --template v1 --earliest '2026-10-22T09:00:00-05:00' --latest '2026-10-22T09:30:00-05:00' --webcam optional
sudo examctl web exams show midterm
sudo examctl web exams update midterm --revision HASH-FROM-SHOW --duration-seconds 7200 --terminals 2 --reason 'Approved future default change'
```

All definition fields have supported flags; operators do not need ad hoc scripts
or direct database/authoritative JSON edits. Template installation is separate;
creating a definition does not install material. Root authorization explicitly
names exams.create/update in gateway managementOperations (default deny). The
existing agent-key purpose/audience/replay/reply contract remains in force; see
agent-management.md. Browser session/Origin/CSRF checks are unchanged.

## Exact source selection (October22 local candidate)

After root `examctl templates install/verify` and `templates sync NAME HASH`,
inspect `examctl web templates show NAME HASH` (or Administration → Template
catalog). Use that exact name and lowercase64-hex hash, not `latest`, a path or
the metadata revision:

```sh
sudo examctl web exams create midterm --template v1 --template-version SOURCE-HASH --earliest '2026-10-22T09:00:00-05:00' --latest '2026-10-22T09:30:00-05:00'
sudo examctl web exams update midterm --revision DEFINITION-REVISION --template-version SOURCE-HASH --reason 'Reviewed exact source for future preparations'
```

Web Exam settings has the separate **Immutable template hash (optional)** field.
The shared writer requires a catalog acknowledgement for the configured class
agent and exact name/hash. Historical acknowledgement does not prove present
availability: loaded native capabilities and actual bytes are checked during
preflight/Begin. Missing/damaged sources refuse; never fall back to mutable or
latest. Template-name edits preserve the hash and must select a matching version.

To explicitly return future defaults to legacy mutable source semantics, clear
that browser field or use `--template-version legacy`. This never changes saved
preparations, started intervals, histories or submissions. No grant is issued or
revised by editing a definition; enrollment-time issuance/migration remains open.

Older gateways refuse the new versioned browser route or root protocol marker
before mutation. Older agents refuse the distinct versioned Begin purpose before
starting time. A lost reply is uncertain until status is reconciled, not evidence
that no start occurred. Do not downgrade any state writer that can discard saved
hashes. See template-source-selection.md for state review, evidence and limits.

## Concurrency, partial updates and retry

Creation never silently upserts an existing ID. Updates require the revision of
the configuration the operator reviewed. A stale or missing revision refuses
overwrite with reload/review/new-intent guidance. Old browser clients must reload
to obtain current revision metadata. The browser captures the revision when its
form opens; background polling cannot silently adopt a newer revision under
unsaved edits.

CLI updates send only named settings. The server validates and merges those
fields within the revision-fenced transaction, then validates the full result.
Create-time schema defaults never reset omitted duration/webcam/terminal values.
The resulting stable partial-update body can be retried after the first write
changed the revision: the same root request ID returns its original outcome
before reexecuting a mutation. Different arguments with that ID conflict; use a
new request ID after reviewing/correcting a stale or failed intent.

Browser settings similarly retain one UUID for the same form after network loss,
and generate a new UUID after edited input. Migration 014 adds a small successful
definition-intent ledger, keyed by authenticated actor/request, committed with the
configuration and audit. A retry across restart returns the original result and
does not duplicate the configuration write. No request IDs are stored as exam
settings. Preserve this table through backup/rollback; do not clear it as part of
monitoring retention. Invalid/conflicting mutations roll back, not partially save.

Audit records authenticated actor, target, reason/purpose and before/after
configuration/revisions. The default purpose is exam-definition configuration;
it is not fabricated human attribution. Root attribution remains agent:ID:root.
Sandbox fixed policy is normalized through the same service as before. Updating
definitions never rewrites historical attempt settings, current/original
deadlines, access restrictions, protected submissions, receipts or grants.

## Evidence and remaining work

### Finite sandbox practice window (C14, local candidate October22)

Sandbox remains repeatable, five minutes/no webcam, with all account/collection
holds and protected history preserved. Configure its finite Begin window using
the existing shared revision-fenced writer:

```sh
sudo examctl web exams show sandbox
sudo examctl web exams update sandbox --revision HASH-FROM-SHOW --earliest '2026-10-22T09:00:00-05:00' --latest '2026-10-22T17:00:00-05:00' --reason 'Open supervised practice window'
```

Web Exam settings exposes the same required date/time fields in device timezone.
New installs have no open window. Legacy indefinite configuration is preserved
for inspection, not silently rewritten or treated as finite permission. Its form
requires explicit dates; unsupported updates explain the working CLI workflow.
The gateway and root both refuse unconfigured/outside-window new starts. New
preflight also refuses before native preparation or account reservation. A signed
loaded-agent capability is required; old-agent refusal occurs before time starts.

Preparation snapshots retain their selected window despite later default edits.
An old indefinite unstarted preparation must be explicitly cancelled and recreated;
do not edit its saved settings. Changing defaults does not revoke existing saved
preparations. Window closure never truncates a started deadline, prevents its
permitted continuation or resets an exact Begin retry. Termination/protection and
failed-collection restrictions still gate the next repeat.

Safety review: this adds no pending/durable operation kind. Existing preparation
cancellation/restart/expiry fences remain; expiry during native setup is rechecked
under the final commit fence, and gateway setup also rechecks after its awaited
handoff. No timeout grants permission, refund or automatic reopening. Ordinary
admission is unchanged except for repeating its existing window check after setup.
No schema/backfill/service change is executed. Full fixed-settings grant issuance,
revision/withdrawal and migration remain open in unified-grant-protocol-proposal.md.

Validation: native bypass/late-setup/preflight regressions RED0.369s after correcting
the fixture UID; initial unit/HTTP cases also reproduce the unbounded defaults.
Focused native sandbox races pass1.390s. Full429 application tests/81 files pass
106.95s, including compiled root-mapped examctl over actual local TLS, shared web
configuration and synthetic SSH/HTTP preflight/Begin, old-agent refusals and saved
deadline checks. Four actual Chromium/WASM/SSH definition/repeat/resume/history
checks pass32.5s. Full local native race/resource suite passes core298.106s and
CLI27.430s with namespace, user-systemd, compiler and large-collection opt-ins.
App/WASM build/typecheck, static native build/vet and diff checks pass.
Logs: /tmp/ssh-exam-sandbox-window-{app,native,browser,build}.log. No missing command.
These use synthetic identities/data; native OS activation is supplied by test
guards and the browser shell is a fixture, not privileged containment proof.
The pinned boolean host guard reports BUSY; no new guest or upload is attempted.
Nothing is deployed. The October23 unified fixed-settings practice candidate
supersedes the earlier grantless practice path; implementation/qualification is
tracked in sandbox-grants.md. Existing expired/revoked authority requires an
explicit unused revision or reviewed NEW practice, not silent regeneration.
Exam-default edits change future automatic issuance only; issued snapshots and
started deadlines remain fixed. Matching CLI/web workflows are documented in
additional-grants-cli.md.027 and matching native writers require a future verified
drain; the earlier429-test result does not qualify these new artifacts.

All 301 application tests in 51 files pass with actual compiled CLI-to-gateway
TLS create/update, explicit-zone conversion, partial preservation, stale refusal
and gateway-restart retry. Authenticated web/root regressions preserve historical
attempt snapshots and refuse unversioned overwrites. Native race checks with all
local fault/CLI opt-ins, typecheck, static native build/vet and app/WASM build pass.
All 40 Chromium definition retry/conflict, admin and seven-timezone workflows
pass. The first new tests exposed an old served bundle; a completed build plus
fresh server fixed the test setup, then the full group passed. Do not rebuild
assets concurrently with a static browser fixture.

Only synthetic local state/accounts/keys were used. Read-only SSH topology checks
via the configured jump and direct csc-sys routes timed out before authentication.
No production record, configuration or service was changed. Safe drain, matching
artifacts, backups, privileged qualification and working deployment access remain
release gates. Do not run old global-lock native writers with new job workers.

C8 retirement is deliberately not claimed here: source inspection confirms legacy
unused recovery grants exist only in root native JSON. A gateway-only dependency
count cannot safely conclude there are no such grants. Complete unified grant
migration/visibility and admission/Begin fences before implementing safe archive/
unused-only deletion. Preserve the legacy files/consumption markers/history while
that work continues; do not strand them or silently cancel authorizations.
