# Native pane management (implemented/tested locally; not deployed)

Local follow-up adds `panes supervisor ATTEMPT [--state DIR]`: bounded root-only
Unix diagnostic capture without global state/initialization/keys/audit writes.
It distinguishes attached units from received normal startup notices, never
execution/monitoring/cleanup authority. Missing/changed/time-out means unavailable,
not misconduct or process death. Existing offline list/show/close remain; see
terminal-supervisor-observation.md for exact semantics and qualification limits.

C12a local practice-owner follow-up adds captured `recorded_supervisors` to the
same bounded CLI list/show and revision fingerprint. Help distinguishes this from
actual liveness, authentication, monitoring or retained-lockout support. Existing
close still targets only its exact pane; idle owners expire after their panes/
bounded handshakes settle. Timed panes retain coordinator recording and no C3
mode is enabled. See terminal-supervision.md for scope/state review and current
qualification; no old guest receipt qualifies the new owner role.

October22 closed-startup follow-up: ordinary scope launch waits now run behind
an inherited closed exec gate outside shared state. Read-only `panes list/show`
distinguishes `closed_startups`, `cancelled_startups` and the original
`earliest_startup_expiry`. A reviewed close cancels the same exact incarnation as
signed student Close; it cannot release a late shell. `closed_startups_revoked`
qualifies the result: a root bootstrap may still finish/refuse after cancellation,
not proof every root setup process has already vanished. Activation changes the
review revision. Unconfirmed workload tracking stays retained. No new force-close,
clock/hold change or retained mode. Full workflow/evidence and pending root-guest
qualification are in closed-pane-launch.md; older receipts below are historical.

October22,2026. C1's firm CLI policy covers targeted native management; the
existing signed student `close-pane` has no discoverable root equivalent. This
increment does not need a new lockout/grant policy decision. Do not substitute
whole-attempt finish, direct JSON edits, process-name kills or service restart.
Nothing here is deployed or qualifies C3 retention/cleanup.

Implemented workflows are `examctl panes list ATTEMPT`, `panes show ATTEMPT
PANE` and `panes close ATTEMPT PANE --revision SNAPSHOT --reason TEXT`. Help must
be accessible without root/configuration. Read paths use the existing bounded,
pinned, no-atime read-only state reader before Engine initialization: no lock,
chmod, audit, reconciliation, key load, network, manager query or permission repair.
They report recorded units/pending admission counts, not live SSH, monitoring,
kernel writer absence or work permission. Paginate/bound output; preserve unknown
recorded data and refuse unsafe state without echoing its private contents.

Each pane gets a scoped opaque revision from nonsecret recorded authority,
matching units and matching hashed one-use capabilities. Healthy lease renewals,
diagnostics and unrelated pane changes must not spuriously invalidate it. Binding
the target owner/generation and exact pending/recorded incarnation prevents a
stale close from ending a replacement using the same UI pane UUID. A changed
clock/owner/incarnation requires fresh inspection, never automatic adoption of a
new revision. Do not expose tokens, credentials, SSH private keys or raw state as
metadata or use a fast fingerprint of secrets for the revision.

Only real/effective root may mutate. Require an8..1000-byte explicit valid UTF-8
reason, with kernel root/machine attribution (not inferred human identity).
Durably append a safe pinned audit intent BEFORE revocation/termination; audit
failure must leave the pane's authority intact. Reuse the same targeted close
logic as the student route, including queued-token revocation even when scope
termination fails. Preserve tracked scopes on unconfirmed cleanup. Do not trigger
unrelated preflight cancellation/reconciliation merely by this targeted action.

Explicit close irreversibly terminates that pane and its detached descendants;
unsaved buffers may be lost, as with student Close terminal. It never pauses or
resets time, unlocks accounts, deletes work/submissions/history, closes other panes
or changes grants. Output must distinguish verified recorded-target termination
from missing metadata/unknown outside writers. A lost reply requires fresh
read-only inspection with the old reviewed revision retained; a retry must never
silently close a newer incarnation. No fake success on audit/storage/termination
failure or automatic privilege/hold override.

Acceptance: initial missing CLI/help RED; real process help/usage/root refusal;
bounded scoped read-only output while a native state lock is held, missing keys
and byte/metadata preservation; actual compiled static CLI under private root
user/mount namespaces; stale revision/owner/generation/clock/replacement races;
matching pending-token revocation without another-pane changes; audit failure and
unconfirmed termination preserving authority/tracking; same shared student close
semantics; actual guest system-manager target close/other pane/renewal and exact
deadline/hold checks. Full app/native race/resource/default-size/build/vet and
unchanged browser artifact checks remain required. No production service action,
deployment or temporary-agent consolidation is authorized.

## Incarnation and compatibility fences

Each newly admitted native unit now includes a random incarnation in addition
to its attempt/pane UUIDs. Activation is recorded only after system-manager
readiness, as `pane_instances` metadata with the current boot. This observation
does NOT renew execution, prove current SSH/monitoring or permit restart thaw.
Reusing a UI pane UUID cannot alias an old reviewed close revision. The revision
also binds the selected state directory inode/device and current boot; a copied
backup is not the original control source.

Both student and root close use the same exact-target helper. Legacy units and
startup records without an observed matching incarnation remain inspectable but
have no root close revision. Student close revokes pending admissions and refuses
to drop/terminate an unverified recorded incarnation. Never manufacture readiness
or clear tracking to bypass this refusal. This is an intentional fail-closed
safety change, NOT the approved C3 retained-buffer lockout policy. Whole-attempt
finalization retains its independent existing writer/protection/access checks.

All cooperating writers of the main native audit now share a checked no-follow,
private, single-link regular-file append and nonblocking file lock. Checked
management operations refuse a busy/unsafe/unwritable audit before control;
legacy best-effort diagnostics retain their existing error contract. Interrupted
tails are preserved verbatim and separated from new complete JSON by a newline,
not silently repaired or overwritten. Successful checked append includes file
and parent-directory synchronization. No caller-supplied human identity is trusted.

Future separately authorized rollout requires a verified drain of old launchers,
workloads, admission tokens and temporary agent owners, consistent private backups
and matching native binaries. An older writer can discard the new metadata and
reuse static unit names: mixed-version live control and downgrade are unsafe.
Do not install the new CLI alone against live old launchers or restart exams to
force compatibility. Preserve all observations, history, holds and work on rollback;
keep admission closed until a compatible drained candidate is qualified.

## Verification record

Missing CLI/help was reproduced RED. Local process help/refusal, read-only busy-
lock/privacy/metadata preservation, actual compiled root-namespace CLI and scoped
pending close pass. Stale owner/generation/clock/token/source/replacement reviews
refuse; healthy renewal/other-pane/private-key changes leave the scoped revision
unchanged. Unsafe audit, interrupted-tail preservation, busy-audit no-revocation
and24 concurrent complete audit writers pass ten race repeats. An initial final
audit refactor failed compilation on two unused imports; fixed before acceptance.

The actual private guest profile now covers authenticated late ACK refusal plus
two real SSH practice shells and reviewed root CLI closure: target descendants
stop, the peer still prints an acknowledged probe, and clocks/state/restrictions
are unchanged. The first fixture timed out on terminal-marker matching before
CLI control; it is NOT counted as a passing run. The corrected fixture passes
three repeats; no live-policy or input-loss cause is inferred from that fixture.
Final product/audit source passes all426 application tests90.89s, full native
race/resource/namespace/compiler/default-size tests core181.090s/CLI14.107s,
static builds/vet, typecheck and35 Python tests. Ten final pane/audit race repeats
pass2.206s. All174 source/runtime hashes match the prior114-browser qualification;
no web/WASM rebuild and no new combined browser/privileged claim.

Exact qualification artifacts (new, not the earlier successful fixture binaries):

| Artifact | SHA-256 |
| --- | --- |
| exam-agent | c607492b4ab309331cc1cc38ce6ffd02989abc976ca970dbccf41e804ec5d7bb |
| examctl | 3045b722ccf642a0bfb3972604ffd38491c071ce7725c250f08d47b7b6d8a266 |
| exam-login | cab1993cde7465a78fcfaa1f436417ca56ee5bfb22876ef8b32b3e85b7a6875a |
| core-qualification.test | e06195dfa11305c8a9f9734c22e468edb413109039e27e6f71884eb2f9477c75 |

These exact files pass three actual authenticated ACK/two-shell/root-CLI repeats
1.58/0.99/0.79s, with host/base preservation, at
/var/tmp/ssh-exam-overlay-3ho_0z7m. The same exact candidate passes40 real
SSH/PAM/Begin/deadline/enforcement assertions at
/var/tmp/ssh-exam-overlay-9ip43xwz and11 collector-death/healthy-peer assertions
at /var/tmp/ssh-exam-overlay-smfx9rdr (23 renewals, maximum0.0923081s, exact40MiB
retry). All host/base preservation checks pass. These are fresh candidate
receipts, not reuse of prior binaries. Nothing is deployed. Broader C1 management
and critical C3/C9–C11 remain open.
