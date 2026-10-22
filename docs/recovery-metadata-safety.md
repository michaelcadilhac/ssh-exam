# Recovery metadata safety (implemented/tested locally; not deployed)

October22,2026. Confirmed shared-agent correctness issue, not a demonstrated
production incident cause. No installed service/config/account/student record is
changed. Unified grants, technical-hold recovery and deployment remain separate.

## Reproduction and correction

Legacy `recoveryReference` opened a grant with blocking O_RDONLY and read its
consumption marker through an unbounded, link-following ReadFile. Begin calls
this while holding the shared state lock. Actual private child-process Begin
regressions reproduce two stalls using a FIFO grant or marker. Five more RED
cases accept a linked/public marker, hardlinked grant, trailing JSON or unknown
authority fields. The initial fixture stopped at readiness before reaching this
read; it is not evidence. The corrected fixture stages a real protected saved
copy first and has a valid control reaching an explicitly mocked OS guard. No
test starts an interval or claims privileged containment from that mocked guard.
Only exact owned test processes/files are faulted; no production data is used.

The candidate pins each root-private0700 catalog directory without following a
component link. Grant and marker opens are no-follow/nonblocking/close-on-exec,
with no-atime observations, owner/private/regular/single-link checks,16KiB/36-byte
bounds and post-read change detection. It rejects special files before reading.
Both ordinary admission and publication retry/legacy consumption use these
bounded reads. A shared strict parser aligns admission and deletion/catalog
inspection: one UTF-8 JSON object, exact known field spellings, no duplicates,
case aliases, unknown fields, trailing objects, excessive nesting or invalid
identity/checksum/allowance. Malformed private contents are never echoed.

Missing legacy authorization remains distinct from unreadable/unsafe metadata;
unsafe records never become a fresh-template fallback. An already-staged saved
receipt still refuses a missing or changed source. This does NOT solve the
separate old-protocol inability to declare an expected grant before first staging;
the recovery-aware/unified-grant contract remains an open TODO. Current windows,
webcam settings, consumed markers, clocks, archives and original holds are not
rewritten, refunded, released or reopened by this change.

Intentional safety compatibility: linked, public, ambiguous or nonprivate catalog
records that an older reader accepted now refuse. Do not chmod/clear/rewrite
authorities automatically or invent a consumed marker to pass a check. Private
directories created by supported code are0700; file modes may be more restrictive
than0600 but never grant group/other permissions. This is integrity validation,
not a new student policy or a supported legacy-grant issuance/repair editor.

## Operator workflow and acceptance

`examctl help recovery-grants` explains native legacy inspection. On refusal, use
the exact `examctl recovery-grants --exam EXAM` and `examctl info ATTEMPT --read-only`
commands printed for the selected identities. The latter bypasses locks/repair
and observes state, not live authority or source integrity. Preserve all grants,
markers, private staging, historical intervals and protected sources. Do not
remove markers, edit JSON, release accounts, restart services or choose starter
files to bypass the error. Full supported new issuance/revision remains dependent
on the unified model; this safety fix does not claim CLI completeness.

Expanded regression covers a valid source, the seven RED cases, duplicate/case-
aliased fields, unsafe parent/exam links/permissions, oversized and hardlinked
markers, exact diagnostic commands and unchanged native state/protected bytes.
Actual root-mapped CLI inspection must reject ambiguous authority without leaking
private fields or modifying records. Decoder fuzz is size-bounded and checks safe
errors/canonical stability. Full app/native race/resource/namespace/compiler/
default-size, static/vet/typecheck and exact-artifact guarded guest enforcement/
collector-death/pane tests are required before the local milestone is committed.
Browser source/runtime hashes must remain unchanged for reuse of prior evidence.

Final qualification passes all426 application tests92.61s, full native race/
resource/namespace/compiler/default-size core205.835s/CLI18.512s, static build/vet,
typecheck (unchanged application source) and35 Python tests. Two focused recovery/
workspace race repeats pass43.049s; two actual root-CLI checks pass1.423s. Bounded
two-worker decoder fuzz passes98664 executions/5.084s. Nine NEW browser checks
pass1.1m, including actual WASM SSH/monitoring final-reply loss, shell/close/logout/
fresh-auth/finish cleanup and protected handoff. All174 source/runtime hashes
match before/after, with no web rebuild; the prior114 combined browser result
remains separate, not a new combined browser/privileged claim.

Exact new artifact SHA-256:

| Artifact | SHA-256 |
| --- | --- |
| exam-agent | 9256db3f37ecea833b80ae338fc85df69d5821607436809ca437b6c49b600d24 |
| examctl | ac6774e73f0c15b0ce1487bc3ab8b5ff2e8aaaf1a3d53165d1bc863d9680dd33 |
| exam-login | cc5f180df71a52681e5e2ef4b8674b8a30965b530d10ec606b6ee0fda4dc4680 |
| core-qualification.test | 73698318a35fe12a0e36214551b4122d6e7d5210e387e7744d63bfd0be4a85ba |

The exact candidate passes three actual SSH ACK/two-shell/root-CLI repetitions
at /var/tmp/ssh-exam-overlay-loenead6,40 SSH/PAM/Begin/deadline/enforcement
assertions at /var/tmp/ssh-exam-overlay-p65pwb7q and11 real collector-death/
healthy-SSH assertions at /var/tmp/ssh-exam-overlay-mimzrgu9 (23 renewals,
max0.0851329s, exact40MiB retry). All host/base preservation checks pass. These
are fresh artifact receipts, not earlier-binary qualification. A later separate
workspace-receipt FIFO/hardlink/duplicate investigation is not included in these
hashes or claimed fixed here. Nothing is deployed.

Nonblocking opens prevent these special-file stalls; they cannot guarantee
bounded regular-file/storage/kernel latency. This is not C10 renewal durability,
independent root cutoff, complete C3 admission/freeze/input containment, buffer
retention or automatic recovery. No initiating production fault is claimed.

Future separately authorized rollout must drain old writers/temporary owners,
back up consistent private authority and verify actual legacy catalog safety,
then install/requalify matching binaries. No schema migration or historical
resnapshot is introduced. Older readers lose the refusal/bounds; keep admission
closed for compatible repair rather than restoring old state over later work.
Temporary-agent consolidation remains a proposal in todo-rollout-plan.md only.
