# Local TODO implementation record

Updated 2026-10-22 (America/Chicago). This is a local development record, not a
deployment receipt. The instructor's latest October 21 instruction revokes the
earlier conditional csc-sys deployment authorization: **do not deploy, including
at the end of local work.** Provide a rollout/migration/rollback proposal only;
do not execute temporary-agent consolidation. Never interrupt exams, reset clocks
or change production student records. No production cutover has been executed.
Stop immediately if a command is not found. Preserve unrelated changes.

October22 decisions received: C10 now authorizes positively verified renewals in
the current live root authority without waiting for disk sync. Restart requires
fresh verification; grants/starts/deadlines/ownership/epochs/audit remain durable.
C11 now authorizes development/full qualification of stop-assisted freezing,
preserving originally stopped jobs. Neither approval enables a live mode or
authorizes deployment/signals on production. Historical awaiting-decision entries
below describe their earlier checkpoints; see todo-design-decisions.md for the
current decisions. Legacy unused-enrollment migration remains unanswered.

Recovery atomicity is now local commit2c2b9c3; C10/C11 decisions are1635822.
An independent expanded staging-storage regression is RED0.476s: actual ENOSPC
while extracting a valid saved file was masked as verification failure. Copy/
sync/close failures now preserve their IO causes, without changing hash checks,
sources or authority. Eight real private-namespace fault scenarios pass three
race repeats5.349s, including usable repaired stages, signed healthy peers and
root CLI committed repair. Initial fixture-only unmapped-UID failures were fixed
before recording the real RED. Static build/vet pass; full native race/resource/
namespace/compiler/default-size passes core279.751s/CLI23.357s. All426 app/80files
pass96.01s with both opt-in root CLI tests enabled;35 Python checks pass0.023s
and all174 browser source/runtime hashes still match the nine-check run.
See recovery-storage-diagnostics.md. No production change or privileged PASS.

Staging-storage correction is now local commit623e218. Current C10 candidate
separates complete verified in-memory renewal acceptance from optional metadata
publication; neither a busy writer nor its old cutoff blocks a newer proof. The
old model is RED0.018s. An additional retired-ticket launcher regression is
RED0.095s and now refuses before subprocess launch without retiring its replacement.
Ten authority/process/publisher/storage races pass44.607s, including actual child/
OOM/runtime/ENOSPC/readonly/root-CLI boundaries. Four new cases pass twenty race
repeats3.428s, including actual blocked children, six fresh signed proofs across
the earlier cutoff, coalesced metadata and32 concurrent exact retries. Seals/clocks
are synthetic; no production actor/freeze or live mode is enabled. Full native
race/resource/namespace/compiler/default-size passes core284.346s/CLI22.157s;
426 app/80files pass95.78s, static build/vet and35 Python pass. All174 browser
source/runtime hashes still match the nine-check run. See live-monitoring-renewals.md.

Saved-work process-death/CLI/watchdog qualification is now local commit6cfd9d4.
The next independent C7 correctness regression now confirms actual isolated
ENOSPC leaves an empty consumption marker and prevents supported root CLI repair;
readonly catalog failures also lose their IO category. Both are RED0.853s. The
local candidate shares complete unnamed-inode/single-link/no-replace/fsynced
publication across current/legacy writers and an early isolated staging probe.
No retained malformed marker is repaired/overwritten. Three expanded focused
race repeats pass12.678s including48 actual child-death cases, real storage/CLI/
healthy-peer checks; marker-only five repeats pass1.312s after correcting only a
nonprivate unit fixture. A second RED signed-Begin case accepted a matching
consumed UUID with unknown original clocks; shared chronological interval checks
now refuse before admission/time consumption. Broader recovery races pass42.895s.
The first full native run exposed two unstarted raw-decoder fixtures; they now
use the nonconsuming extractor and assert no marker, without relaxing the start
guard. Final full native race/resource/namespace/compiler/default-size passes
core273.777s/CLI23.267s;426 app/80files pass97.88s, static build/vet,35 Python and
actual CLI help pass. All174 prior browser source/runtime hashes still match.
The explicitly approved exact code-only bundle is uploaded and checksum-verified
in private0700 /var/tmp/ssh-exam-atomic-consumption-upload.QBtItC on csc-sys.
The next boolean-only raw host guard reports BUSY; no candidate guest started.
See recovery-consumption-atomicity.md; no production/privileged completion claim.

Latest validated local milestones: healthd37463a, bounded NSS76fd030, simultaneous
default-size workload d9cc715 and grant/progress proposal9e28edf. None is deployed.
Current independent C7 qualification adds six actual workspace publication child-
death boundaries, real namespace-root repair/refusal, native watchdog-first order
and healthy signed peers. Thirty-six cases/24 root CLI operations/102 renewal
samples pass three race repeats6.452s; a removed durable-start-save mutant makes
the targeted test fail and is restored. Stronger source manifest/identity/hold/
answer-hash assertions pass the repeated matrix6.465s. Full native race/resource/
namespace/compiler/default-size passes core256.144s/CLI21.434s; all426 app/80files
pass91.32s, static builds/vet and35 Python checks pass. New exact-artifact guest
qualification remains pending; the17:07UTC boolean raw host guard reports BUSY,
no guest started. See
workspace-publication-crash-qualification.md. This is not a new grant protocol,
actual privileged writer/SSH containment or a completed broad recovery TODO.

Health observation is now local commitd37463a; its final11 guarded worker checks
remain pending on host-idle eligibility, not falsely reported as PASS. A new
separate concurrent512MiB-per-source test verifies both archives/holds and healthy
authority, but its subsecond signed-inspection criterion fails in three runs.
Runtime tracing attributes the longest exchange to durable fsync/rename rather
than read-only diagnostics (under11ms). C10 has been re-asked with this evidence.
The initial full native run then passes including that experiment. A subsequent
test-criterion correction applies the pre-existing3s durable-IO workload budget
to signed inspection/registration/pane operations while retaining1s no-write
diagnostics and separate controlled-lock checks; three final race repeats pass
116.594s with exact source/archive verification, live worker controls and
35/41/42 healthy renewals. No
runtime timeout/lease/resource policy changes. Preserve the earlier failed
measurements and open liveness investigation; see concurrent-collection-latency.md.

Next independent readiness correction: actual compiled namespace-root health
reproduces unbounded configured-account NSS waiting6.67s. A candidate now bounds
the whole lookup walk to5s with4KiB/account output and250ms pipe drain, retaining
all current UID/managed/sandbox checks and fresh admission verification. It marks
provider failure unavailable, not changed policy/misconduct, and caches nothing.
Two initial focused race repeats pass core3.115s/CLI13.696s; late-cutoff and full
native race/resource/namespace/compiler/default-size pass core242.620s/CLI23.556s.
All426 app/80files pass91.33s, static builds/vet and35 Python checks pass; all174
prior browser hashes match; nine fresh real browser/WASM SSH checks pass1.2m.
New exact-artifact guest evidence remains pending;
the16:48UTC boolean-only raw host check reports BUSY, no guest started. See
native-readiness-accounts.md; no deployed or completed-parent-TODO claim.

Unified-grant authority investigation now has a concrete source map and proposed
claim/Begin/crash/migration protocol in unified-grant-protocol-proposal.md.
It preserves live signed UID verification independently of enrollment-time
settings, one-use/unknown-start fencing and authoritative holds. The legacy
unused-enrollment choice remains unanswered; native outbound Begin reachability
and sandbox finite-window transition are identified as further consequential
boundaries, not implemented assumptions. No schema/index/history change occurs.

Workspace-receipt milestone is local commitde16a5c, recovery metadata iscb5b809
and pane management is0c2a529. Health-observation is local commitd37463a and
passes local checks but is NOT fully privileged-qualified. The first csc-sys
guard refused live/unresolved work BEFORE guest creation; no test unit/production
state/service was changed. A later boolean-only raw recheck reported idle. The
unchanged guarded retry passes3 real signed-SSH held-health/independent-inspection,
late-ACK/root-CLI/two-shell repeats1.79/0.86/0.79s with host/base preservation at
/var/tmp/ssh-exam-overlay-vvl49xqt. The same artifact passes40 guest enforcement
assertions with host/base preservation at /var/tmp/ssh-exam-overlay-ynys70us.
The final worker-isolation run was refused BEFORE guest creation when new
live/unresolved host work appeared; its11 assertions remain pending, not PASS.
Pending C10/C11/legacy-unused migration answers are not inferred.
Descriptor correction is local
commita50067b, fully qualified as recorded below.
C1 native pane management is implemented/tested locally: no-write bounded list/show,
source/owner/incarnation-scoped reviewed revision, checked durable root audit and
shared targeted close without preflight/account/clock side effects. Required
help/refusal regression was RED; final426 app90.89s, full native race/resource/
namespace/compiler/default-size core181.090s/CLI14.107s, static/vet/typecheck and35
Python tests pass. Ten pane/audit race repeats pass2.206s. Exact-artifact guest
ACK/two-shell/root-CLI passes three repeats1.58/0.99/0.79s with host/base preserved;
same exact artifact also passes40 guest enforcement and11 collector-death/
healthy-peer assertions (23 renewals,max0.0923081s, exact40MiB retry); every
host/base preservation check passes. All174 prior browser
source/runtime hashes match; no web rebuild. Exact acceptance/hashes/compatibility
and failed fixture evidence are in native-pane-management.md. C10/C11/legacy unused-enrollment choices have been
re-presented asynchronously; independent correctness work continues without assuming answers.

Implemented recovery correctness increment: recoveryReference opened legacy grant
files with blocking O_RDONLY under the shared state lock and reads consumed
markers through unbounded/following ReadFile. The separate deletion catalog already
has bounded no-follow/nonblocking file checks. Reproduce special/unsafe metadata
before changing shared validation. Seven actual Begin-process regressions are now
RED: two FIFO stalls and five accepted unsafe/ambiguous records; a valid source
reaches the explicitly mocked OS-guard boundary without starting time. An initial
fixture stopped at earlier readiness rather than testing the suspect read; it
was corrected before recording RED. The candidate now pins private path components,
uses bounded no-follow/nonblocking metadata and publication-retry marker reads,
and shares strict canonical-field JSON validation with the deletion catalog.
Sixteen Begin-process cases pass two race repeats with surrounding recovery/
workspace tests43.049s; actual root-mapped CLI privacy/refusal checks pass1.423s.
Bounded two-worker decoder fuzz passes98664 executions/5.084s; all426 application
tests92.61s, static/vet and35 Python checks pass. All174 prior browser hashes
match. Full native race/resource/namespace/compiler/default-size passes
core205.835s/CLI18.512s. New exact-artifact ACK/two-shell/root-CLI guest passes
three times,40 enforcement and11 collector-death/healthy-peer checks pass
(23 renewals,max0.0851329s, exact40MiB retry), all host/base preservation passing.
Nine fresh browser/WASM SSH/handoff/monitoring/cleanup checks pass1.1m with all174
hashes unchanged before/after. See recovery-metadata-safety.md. Do not treat malformed authority as missing,
fall back to starter files, change intervals or rewrite legacy grants/history.

The completed local receipt increment reproduces a FIFO stall in Begin's
readWorkspaceReceipt plus accepted hardlinked/duplicate JSON receipts; valid
control reaches only a mocked OS guard. Its candidate shares a pinned bounded
private-file reader and rejects ambiguous top-level/nested source keys. This is
not part of the preceding exact hashes or deployed behavior. Two focused full
recovery/workspace race repeats pass63.038s; actual root CLI start refusal passes
1.080s. Full426 app90.72s, native race/resource/namespace/compiler/default-size
core215.970s/CLI16.320s, static/vet and35 Python checks pass; bounded two-worker
receipt decoder fuzz passes81863 executions/5.833s. Final exact-artifact guest
passes3 ACK/two-shell/root-CLI repeats,40 enforcement and11 collector-death/
healthy-peer assertions (23 renewals,max0.0820979s, exact40MiB retry), every
host/base preservation check passing. All174 browser hashes match; no web rebuild.
See workspace-receipt-safety.md. Preserve every private receipt/work
directory; never recopy source, restart time or invent readiness to bypass failure.

Current health-observation investigation confirms slow readiness IO is called inside
WithState by native health, signed health and configuration reporting. All three
controlled kernel-pipe/signed-inspection regressions are RED. An uncommitted
candidate authorizes/durably consumes signed nonces first, probes outside state
and publishes configuration afterward, preserving initial broken-state refusal.
It never caches health for Begin and bounds concurrent probes per Engine only,
not across all processes. Ten focused race repeats including busy/replay/restart/
untrusted-request/no-false-publication cases pass1.370s, now also requiring the real
Begin guard despite a healthy observation. Actual static root CLI concurrency and
synthetic NSS/manager checks pass3.185s; full426 app90.47s, native race/resource/
namespace/compiler/default-size core208.587s/CLI12.946s, static/vet and35 Python
checks pass. After the initial safe idle-guard refusal, a later read-only recheck
reported idle and the unchanged guarded guest retry passes3 actual signed SSH
held-health/inspection plus prior pane/root-CLI repeats with host/base preserved.
The same artifact passes40 enforcement assertions with host/base preservation;
its final worker run was refused before guest creation on new live/unresolved
host work and remains pending. Do not change host work or substitute a prior
binary's receipt. See native-health-isolation.md. No incident cause,
C3/C9 completion, C10/C11 answer or deployment is inferred.

Pane-admission correction is local commitfad7e51. Next correctness investigation:
local gate receives SCM_RIGHTS before JSON/account/SSH/capability validation but
only adopts/closes them on the later accepted-pane path. Reproduce malformed,
unapproved, ordinary/control, early pane refusal and truncated/extra-descriptor
paths with exact owned synthetic inodes. All seven are RED (one or two leaked
descriptors each). The candidate now owns/closes returned rights immediately and
transfers a valid single PTY once; actual truncation, CLOEXEC, short headers,
idempotent cleanup and valid protocol regressions pass. Twenty final focused race
repeats10.099s, five actual gate/PTY repeats16.345s, all426 app90.80s, static/vet
and35 Python checks pass. New exact-artifact actual SSH ACK/late-close profile
passes three times with host/base preservation. Full final native race/resource/
namespace/compiler/default-size now passes core180.278s/CLI8.009s; exact-artifact
guest passes40 SSH/PAM/Begin/enforcement and11 collector-death/healthy-peer
assertions (23 peer renewals,max0.0823481s), all host/base preservation passing.
All174 prior114-browser source/runtime hashes match; no web rebuild. A test-layer
initialization assertion was corrected without weakening leak/authority checks;
see native-gate-descriptors.md for evidence, exact hashes and policy boundaries.
No production cause, deployment, C3 enablement or global capacity claim. The next
independent C1 increment is targeted root pane management; investigated workflow,
snapshot fences, auditing, no-write inspection and acceptance are in
native-pane-management.md. That proposal is not yet implementation/completion.

After test-only commitd53de3f, the next confirmed correctness milestone isolates
client ready/ACK network IO from pane admission's global state transaction and
revokes unused pane capabilities on close. Signed renewals already bypass that
lock; do not call this a proven renewal-lock cause. Exact late-authority fences,
scope/clock/hold preservation and interface acceptance are planned in
pane-admission-isolation.md. Candidate passes426 app/91.11s, final full native
race/resource/namespace/compiler/default-size core177.149s/CLI8.957s, static/vet,
35 Python checks and ten final focused race repeats6.456s. Actual guest passes40
SSH/PAM/Begin/enforcement assertions and11 real collector-death/healthy-SSH
assertions (23 peer renewals,max0.0800769s), plus three actual authenticated SSH
delayed-ACK/late-close repeats. The old-locking test-only mutant fails all three;
corrected source is restored byte-identical and all three final positive repeats
pass again0.40..0.81s with host/base preservation. Detailed failed fixture/quota evidence, exact hashes and remaining
boundaries are in pane-admission-isolation.md. No deployment/C3 completion claim.
C10/C11 and legacy migration remain awaiting decisions; per-pane root CLI remains
an identified C1 gap. All174 existing browser source/runtime hashes are unchanged.

Development scratch note: only generated qualification bundles and the Go build
cache were moved off quota-limited /tmp into the private owned child
/home/micha/src/ssh-exam/var/collection-tests/qualification-artifacts.qTDysU.
Use GOCACHE at that child's go-build; GOMODCACHE remains
/tmp/ssh-exam-toolcheck.OA9pbg/go-mod. These are generated test artifacts, not
student workspaces or cleanup eligibility; no broad deletion/quota change occurred.

Administrator milestone is local commitb42129d; previous writer correction is
76cf926. The TEST-ONLY C11 dead-leader foreground investigation now passes ten
repeats,60 actual freeze/discard/thaw cycles across cgroup-only and exact
shell-first/worker stop-assisted modes. Every cycle retains the acknowledged
private worker buffer, foreground group, parent shell and original stopped job;
actual stale terminal input is discarded. Host/base preservation passes, evidence
/var/tmp/ssh-exam-overlay-r_r9rril. Full uncached native race/resource/namespace/
compiler/default-size checks pass core173.400s/CLI8.263s;34 Python checks and ten
focused writer/host-refusal repeats pass. Static build/vet pass. Exact hashes and
limitations are in native-async-io-investigation.md. No browser runtime changed or
was rebuilt. This does not adopt signals as live policy, repair the cgroup-only
linked-IO failure, implement retained SSH/all-root admission or answer pending
C10/C11/legacy migration choices. No deployment or consolidation.

Current validated checkpoint: administrator metadata/secret-safe creation CLI
and same-form browser retry are implemented/tested locally. Final426 app/80files
with production-mode CGO-disabled actual TLS CLI passes88.57s (preceding92.37s);
full final native race/resource/namespace/compiler/default-size core173.285s/
CLI10.458s, static build/vet/typecheck/complete build pass. Final ten focused
CLI/core/real-PTY/refusal cases pass7.603s/1.663s; bounded two-worker metadata fuzz
passes150369 executions/11.011s. All114 combined browser checks pass12.6m with
all174 frozen server/web/protocol source/runtime hashes unchanged before/after.
Nine generated documentation screenshots are restored to their verified baseline.
See administrator-management.md for exact hashes, security/rollback limits and
failed-candidate/fixture evidence. The full TODO count remains11/38 checked,
27 open; no deployment, production account/configuration change, push, service
consolidation, C3/C4 completion or initiating-incident cause is claimed.

Implementation trail AFTER writer commit76cf926: administrator CLI parity under C1.
The old CLI help/discovery regression is RED; shared browser/root credential
service, additive migration021 and named default-deny list/show/create routes are
being implemented, not qualified or deployed. Expensive64MiB Argon2 work has two
no-wait slots outside SQLite; retries bind the username to the SAME strong salted
verifier, never generic SHA(password/body). Fresh authorization/receipt checks
fence competing/missing receipts. Initial shared/native memory tests pass:18 app
checks/1 opt-in skip across3files, typecheck,20 race repeats of owned HTTP-body
read/close/wiping. Browser lost-reply/security tests pass, but root compiled CLI,
PTY cancellation/echo restoration, actual TLS, full regressions/build/browser and
documentation remain pending. New native CLI input/help/result-scope and hidden
TTY code is uncommitted and under qualification; do not count it completed.
No production access/account change, push, deployment or missing command occurred.
Detailed acceptance and investigation: administrator-cli-plan.md.
Administrator continuation: shared server/security and actual compiled root-
mapped CLI/private TLS checks now pass19 across3files (10.11s), including exact
finite stdin/Unicode/newline limits, restart/same-ID original-password retries,
signed scope/error corruption, lost replies and unchanged native state/attempts.
Native help/input/result-whitelist/duplicate-key checks plus actual hidden PTY
confirmation/mismatch and SIGINT/TERM/HUP/QUIT restoration pass ten race repeats
7.381s;20 synchronized request-body wiping/read-close race repeats pass2.338s.
The first PTY test fixture incorrectly opened a read-only slave; all six fixture
cases failed and were NOT qualification. Correct explicit TIOCGPTPEER read/write
flags repair only the owned fixture, with unchanged echo/restoration assertions.
An additional RED candidate regression exposed unchecked corrupted saved creation
results; strict scoped metadata receipts now refuse those, and misplaced top-level
password fields never reach a generic fast request fingerprint. Those final checks
are running. Browser form now retains a nonsecret intent UUID and clears/reasks
the password on a lost reply; its new actual lost-response browser check, full
build/browser/native/application regressions and operator docs are still pending.
No administrator milestone commit/completed-TODO/deployment claim yet.
The administrator malformed-browser JSON regression passes the EXISTING safe
Fastify parser; no parser policy change is made. All426 app/80files pass91.36s,
native core170.866s/CLI8.989s, static/build/vet/typecheck and complete app/WASM build
pass. Two actual administrator browser cases pass11.6s; all174 frozen web/server/
protocol source/runtime hashes match before/after. The combined114 browser run
is in progress against these NEW hashes, not the older113-check artifact.
A final native-only usability RED shows that generic secret-safe refusals hid
the useful conflict cause. Exact public refusal whitelists now retain actionable
duplicate/conflict/receipt/authorization guidance while suppressing arbitrary
signed secrets. Actual compiled CLI/private TLS now passes22 focused app checks
10.63s; final all426 app repeat passes92.37s. Full final native/static/vet and
combined browser completion/hash comparison/screenshot restoration remain pending.
No web source/runtime edits/rebuild occur during that frozen browser run.

Previous validated checkpoint: the surviving-thread writer correctness fix is implemented/
tested locally. Old zombie-leader/missing-executable shortcuts could miss a live
writer; pinned kernel lifetime/proc observations and pinned signals now refuse
that unsafe result. All414 app/79files86.86s, full uncached native race/resource/
namespace/compiler/default-size core175.114s/CLI8.024s, static build/vet, ten
focused native/kernel-denial/host-refusal repeats and33 Python checks pass. Exact
candidate guest passes five writer-group repeats,40 SSH/PAM/Begin/protection/
hold/watchdog/restart assertions,11 real worker-death/healthy-SSH assertions and
three actual health/kernel-property cycles; every host/base preservation check
passes. All140 web source/runtime hashes remain the prior113-browser/12.8m
artifact; no web rebuild is claimed. See writer-thread-groups.md.
Count remains11 of38 top-level items implemented/tested locally,27 open; the
complete monitoring export milestone is in monitoring-export-qualification.md.
This is not deployment, C3/root admission/C4 completion, the production incident
cause or whole-host capacity certification. No missing command, installed
production binary/configuration/service change, push, deployment or temporary-agent
consolidation occurred; the separately authorized disposable test unit is documented.

C2a5's final guest-only increment now passes actual template CLI validate/install/
show/verify/list/jobs/clean against the real system manager and bounded supplied
slice. Two exact-artifact128MiB runs pass4.21s each, with host/base preservation:
/var/tmp/ssh-exam-overlay-gc3qjte_ and /var/tmp/ssh-exam-overlay-q72z3s0n.
Testf6cf8fe6c4254618db901b116ce4ca0f3f03c4af8e440bfeeb5ac67fe239edbc;
examctlde4679447bc1f869c2e6c2f0db79d8b0518bc0aba67dede97604dca76e387098.
All31 Python checks,20 host-refusal/preservation repeats, final full native
race/resource/namespace/compiler/default-size (core171.016s/CLI6.960s) and static
build/vet pass. Product/browser runtime hashes remain unchanged; this qualifies
the narrow real catalog CLI/system-manager gate, not version-bound guest Begin,
unified grants, legacy migration, C8 retirement or deployment. Failed fixture
runs remain explicitly recorded below and in template-guest-qualification.md.

Next independent C1h increment is bounded read-only native configuration show/
candidate validation. Existing LoadConfig/legacy diagnosis are not safe inspection
substitutes; no supported config command exists. Help/actual CLI RED regression
and acceptance plan are in native-configuration-inspection.md. No configuration
apply, service probe/restart, state initialization or new credential workflow is
authorized by a successful check. Root-administrator creation also remains an
unimplemented CLI gap; investigate secret-safe retries before adding it.
C1h now wires root config show/validate before Engine initialization. The missing
CLI-help workflow is RED on the old command; new help/syntax, root refusal and
actual compiled root-mapped CLI pass. Configuration observation does not open keys;
validate adds pinned bounded key/optional-CA checks. Unknown/duplicate/deep/invalid
JSON, links/parents/hardlinks/FIFO/unsafe modes/oversize, missing/damaged keys and
observed mutations refuse safely. Invalid known values (including pasted URL
credentials) cannot leak even with explicit path output. System root is refused
as private state/work/catalog metadata, distinct from supported rootfs=/.
Five actual CLI/native repeats pass. Full414-app/79files passes88.93s; initial
full native compatibility is running. Final extra mutation/broken-state cases,
native repeat/static/vet and exact unchanged-browser-artifact evidence remain
pending. No completed-TODO/deployed/configuration-apply claim. The initial atime
assertion was a test-order defect: its own generic /proc/fd content comparison
ran before the atime check. Measuring the reader before that separate test read
passes repeated checks; no atime assertion or O_NOATIME guard was removed.
Final native C1h repeat passes core174.276s/CLI6.514s with all race/resource/
namespace/compiler/default-size opt-ins; static build/vet pass. The final extra
CLI/core cases pass five repeats (CLI4.010s/core1.158s). All140 browser source/
runtime hashes match the prior113-check/12.8m run exactly; no web/UI/compiled
artifact edit or rebuild occurs. Full application final repeat and C1h commit
are in progress. No config apply, production probe/change or completed-TODO claim.
C1h final application repeat now passes414/79files (86.57s); full native final
core174.276s/CLI6.514s, build/vet and all nine top-level configuration regressions
five times pass. All140 exact web artifact/source hashes remain identical to the
113-browser/12.8m run; no web rebuild or deployed/native privilege claim. Read-only
configuration observation/candidate validation is implemented/tested locally,
not full configuration management or apply. Next confirmed collection-safety
increment: workers already enforce zero swap, but aggregate slice readiness does
not request/check the supplied MemorySwapMax=0 property. Tighten that existing
bound without changing worker limits, timing, history, holds or live services;
require parser RED plus actual isolated CLI/readiness refusal and full regressions.
C1h is local commit0c4b11a. The following collection-pool check is a separate
confirmed source gap, not an explanation of the production crash: individual
workers already set MemorySwapMax=0 and the supplied aggregate slice also does,
but readiness/launch guard neither requests nor validates that aggregate field.
Add exact-property refusal for absent/nonzero/unbounded values, preserve the
existing single bounded systemctl query and all worker limits, and exercise the
actual compiled CLI readiness with a private user/mount-namespace adapter. Do not
edit/reload any installed slice or production service; local tests only.
The aggregate no-swap regression is RED on the prior parser (missing field
accepted); restored candidate requires/request MemorySwapMax=0 in the same
two-second query. Focused parser/actual compiled CLI checks pass: private mapped
user/mount adapter proves exact query, missing/nonzero/unbounded refusal and fresh
zero recovery without contacting a host manager or touching saved work/attempts.
A separate collection-pool disposable guest profile is being added to check the
real guest kernel property and actual CLI readiness before/after an overlay-only
temporary nonzero setting and repair. It retains all host/base idle/preservation
guards; no installed-host action or outcome is assumed. Full qualification pending.
The actual collection-pool guest profile now passes three exact-artifact cycles
3.82s/2.80s/2.81s: real kernel memory.swap.max0/healthy CLI, overlay-only runtime
1048576/refused CLI, restored0/healthy CLI. Native authority and host/base
preservation pass; private evidence /var/tmp/ssh-exam-overlay-j5zfm945.
Agent03d74a468ca23f6118132797f81acc3ea11a3a639240acd0953a0f3e22f338e4;
examctlca86cafae31abe7eec400c3518738e0952cd4828f5f4188a2f5dcb3f8f0b21d2;
testd72c22aca4c5faee2509348c6a753ea53b1e8f607a474e2869b6d4d3e4975b34.
Full414 app/79files passes86.76s;32 Python and focused repeated native/root-CLI/
all-profile host refusals pass, static build/vet pass. Full native compatibility
and exact-candidate worker-death/healthy privileged SSH regression are running;
broader enforcement repeat remains pending. See collection-pool-readiness.md.
No production configuration/service action or deployed/completed-TODO claim.
Collection-pool full local native qualification passes core169.485s/CLI8.439s;
all414 app/79files86.76s,32 Python, focused native/actual CLI/host refusals and
build/vet pass. Exact candidate worker-isolation guest passes all11 assertions,
with23 uninterrupted peer renewals/max0.0814354s, protected retry of all original
40MiB, unchanged PTY/new admission/owners/generation/deadlines and correct account
restoration. Host/base preservation passes; evidence
/var/tmp/ssh-exam-overlay-hv2g85b7. Full enforcement guest repeat now runs against
the same exact artifact; no production or consolidated service is changed.
The same collection-pool candidate now also passes all39 normal-filesystem
enforcement assertions with host/base preservation; evidence
/var/tmp/ssh-exam-overlay-uh4nayi8. All140 source/runtime hashes remain exactly the
113-browser/12.8m artifact; no web/UI edit/rebuild occurs. Aggregate no-swap guard
is implemented/tested locally (full app414/79files86.76s, native core169.485s/
CLI8.439s, build/vet,32 Python, focused root-CLI/guard repeats and real guest
property/worker-death/enforcement). Broader C6 capacity and critical C3 remain open;
this is not deployment or permission for service consolidation.
C6 aggregate readiness hardening is local commitd8abc8a. The next independent
C4b0 prerequisite now has an internal UNWIRED bounded mountinfo parser, pinned
descriptor mount/device-to-filesystem-root mapping and cross-view source-root
relationship observations. It never returns eligibility/busy/safe or mounts/
deletes anything. First synthetic refusal and actual private-namespace same-device
file/directory bind checks pass; escaped whitespace paths and host-refusal repeats
are being qualified. A complete namespace/process/fd/cwd/root/mmap inventory,
admission/private-path fences, fresh archive/holds and destructive-phase proof
remain open. No CLI cleanup or C3 mode is enabled; see
workspace-mount-observations.md. Critical C10/C11 and legacy migration choices
remain pending; no answer/policy is assumed.
C4b0's expanded ten native race repeats pass3.341s with actual same-device
directory/file aliases and escaped-path bytes preserved. A deliberately wrong
mountpoint-only TEST mutant makes both synthetic mapping and actual kernel
namespace-bind checks RED; restored immediately. Source-root mapping remains
unwired/no eligibility output. Restored repeat, bounded fuzz, full app/native/
build and unchanged web-artifact confirmation are now being qualified, not yet
claimed complete. Complete namespace/process-use proof and supported cleanup
remain open; no writer is killed or workspace deleted by this increment.
C4b0 final local qualification passes restored10 race repeats3.254s, bounded
two-worker fuzz57445 executions/11.020s, full native race/resource/namespace/
compiler/default-size core172.616s/CLI10.615s, all414 app/79files88.29s and static
build/vet. All140 source/runtime hashes remain the113-browser/12.8m artifact;
no web/UI edit/rebuild. This closes the private topology primitive only, not full
usage proof, dry-run eligibility, cleanup or C3. The full TODO remains unchecked.
Further source review flags a potential correctness gap worth reproducing before
continuing usage inventory: UID writer enumerators skip a zombie leader, although
pthread_exit can leave another thread running and leader /proc views may be
incomplete. Reproduce with a bounded owned synthetic process before calling it a
confirmed bug; do not signal unrelated UIDs or assume this caused production.
C4b0 is local commitc32b74c. The surviving-thread hypothesis now has an owned
unprivileged C fixture and real pidfd/file-progress regression. It never calls
UID-wide termination or touches real state/accounts; only its exact child is
stopped on cleanup. Run it RED before changing the writer enumerator. Primary
kernel/userspace contracts and required containment/SSH/freeze caveats are in
writer-thread-groups.md. Investigation remains open; no production cause/remedy
or C11 behavior is assumed.
The owned dead-leader regression is RED on the old code while its process pidfd
is live and file grows. Candidate pinned UID/proc/group handles now fix that
skip and the missing-executable exemption; ordinary termination uses its original
kernel handle, never a late numeric PID lookup. Ten focused race repeats and
actual child-only syscall-denial readiness regressions pass3.989s;33 Python checks
pass. The first guest fixture permission failure is not counted; private input
permissions remain strict and only a new guest test directory receives the fixture.
Corrected five-repeat guest and40 real SSH/PAM/Begin/collection/hold/restart checks
pass with host/base preservation. Final readiness-probe candidate additionally
passes five writer-group repetitions at /var/tmp/ssh-exam-overlay-zh1yrwdx;
enforcement/healthy-worker isolation and final full native compatibility remain
pending. All414 app/79files pass86.86s, static build/vet pass, all140 web hashes
remain the exact113-browser/12.8m artifact. Limits/remaining root-monitor/C3/C4
gates and exact native artifact hashes are in writer-thread-groups.md. No new
policy, root mode, completed-TODO, deployment or initiating production cause claim.
Final process-lifetime candidate full native race/resource/namespace/compiler/
default-size passes core175.114s/CLI8.024s; all414 app/79files86.86s and33 Python
checks pass. Five exact-artifact writer guest repetitions and40 full actual
SSH/PAM/Begin/protection/hold/watchdog/restart/restoration assertions pass with
host/base preservation at /var/tmp/ssh-exam-overlay-zh1yrwdx and
/var/tmp/ssh-exam-overlay-wdgvovdn. Same-candidate healthy peer/real worker-death
and actual CLI health property-cycle qualification is next; no production change.
The same final artifact now also passes all11 real worker-death/healthy privileged
SSH/PTY/admission assertions:23 fresh peer renewals/max0.0833635s, unchanged
owners/generation/original/current deadlines, all40MiB source bytes protected by
explicit retry, account restoration only at unchanged deadlines. Host/base
preservation passes at /var/tmp/ssh-exam-overlay-dbi52qp6. Actual root health/
kernel property-cycle checks are the final pending narrow gate before committing
this writer correctness milestone; the critical C3/C10/C11 choices are not inferred.
Final actual root CLI health/kernel no-swap refusal/repair cycles pass three
repetitions3.87/2.92/2.90s with unchanged authority and host/base at
/var/tmp/ssh-exam-overlay-zke40le5. Writer fix is implemented/tested locally, no
broader TODO completion or deployment;11/38 remain checked. Next independent
administrator CLI parity investigation/acceptance is in administrator-cli-plan.md;
the old CLI fails the new help/discovery regression. That next test is a deliberate
uncommitted RED, not a missing executable or a failed writer qualification. Do not
commit it as completed work before implementing/qualifying the actual workflow.

Q5 investigation afterb8587b9: basic/SQPOLL io_uring is demonstrably
available to the synthetic UID, so test deferred pipe-read/linked-file-write and
timer-hardlinked-write, with explicit unfrozen baselines and forced-worker
variants. Require no file change after confirmed freeze, then inspect completion
and resumption rather than assuming CPU pause covers kernel effects. Use only
the existing guarded disposable guest, known compiler and synthetic owned files/
pipes/scopes. No syscall is restricted, no new retained mode is enabled and no
result or design choice is assumed. Every baseline must work before interpreting
a freeze result; the full C3/critical TODO remains open.
The initial Q5 run is NOT qualified: all18 unfrozen baselines succeed and none
of18 frozen observations sees a file write, but12 frozen normal-dispatch linked
writes complete with -ECANCELED after the first read/timeout completes; all six
forced-worker pipe cases resume normally. This repeats identically three times
on6.8.0-111-generic. Host/base preservation passes; evidence
/var/tmp/ssh-exam-overlay-h_ruyjs5. Test29712638a5e8842d50cb1a8875235429d44483e378a5898d9ffdb6abfd0d919e;
static IO fixture c27fc71b015be1630a20ab7654903ac4fd70a98d850e5400f7b5dee23bc85a30.
Investigate fixture-versus-kernel cancellation path before selecting a remedy;
do not weaken the acceptance assertion, claim all IO is preserved, disable a
syscall or enable retained mode. No initiating production fault is established.
See native-async-io-investigation.md. A separate exact synthetic pidfd job-stop
experiment is being qualified without deleting any original assertion/case or
changing live workload policy. It is not yet a remedy or full admission barrier.
The final synthetic stopped IO matrix passes36 cases, and the actual interactive
Bash/Nano fixture passes ten repeats/thirty cycles with exact unsaved text and
original stopped-job/foreground preservation; same test artifact
0e205925fe9dfb762bcc9726247ba8be68d9fc1f083ea5d0142ab7360c49843d.
Evidence /var/tmp/ssh-exam-overlay-ztsu8i3o and
/var/tmp/ssh-exam-overlay-sk3ag8z7; host/base preservation passes both. Native
full compatibility passes core172.21s/CLI6.13s, static build/vet,30 Python and20
all-five-profile host-refusal race repeats (1.92s) pass. This closes neither the
general root admission/stop protocol nor retained SSH. The final original
cgroup-only gate on that exact artifact again fails12 linked writes;24 other
writes succeed, host/base preservation passes. Evidence
/var/tmp/ssh-exam-overlay-0skckf9p. It remains unqualified, not mislabeled fixed.
The application-visible stop/continue versus separately qualified kernel choice
is now explicitly awaiting instructor input. Independent monitoring-export work
continues while that and renewal durability are pending; no policy is assumed.
Q5 investigation is recorded in local commit6d6cf13. Independent increments are
C1gc1 scoped bounded image parity, then C1gc2 complete private export; ordered
acceptance/fault criteria are in monitoring-export-plan.md. C1gc1's final local
qualification is below; C1gc2 and the monitoring-management TODO remain open.
The C1gc1 candidate now passes15 focused shared-media/HTTP/actual compiled root-
CLI/TLS checks (3.54s), including same-request/restart/private-output/deleted retry,
signed scope/variant/digest mismatches before stdout/files and the shared16-reader
limit across web/root with responsive health outside SQLite. A deliberately
disabled final publication fence makes the late-deletion test RED; restored.
Native image/help checks pass ten race repeats. Final all400 application checks/
75files (81.46s), full native race/resource/namespace/compiler/default-size suite
(core169.499s/CLI7.090s), static build/vet/typecheck/build and all49 selected browser
checks (3.5m) pass. All18 runtime/source hashes match before/after; nine screenshot
baselines are unchanged. See monitoring-image-qualification.md. No full export,
deployed or completed-TODO claim. Docker remains absent on the local Unix socket
in the renewed read-only check; no daemon/service/group/permission changes made.
C1gc1 is local commitdc68921. C1gc2 is now starting with a bounded purpose-signed
stream on the existing outbound management route, one actual export/cleanup slot,
shared media bounds, exact partial-tail recording prefixes and no-replace private
CLI publication. See monitoring-export-plan.md for the concrete proposal and
fault matrix. C1gc2 is now wired locally, not yet finally qualified: actual
streaming TLS/root-mapped CLI, multi-chunk raw binary tails, append exclusion,
overwrite/truncation, oversized history, deletion before signed completion,
bad signed scope/file/digest, trailing/truncated stream and no-replace destination
races pass focused regressions. Actual socket cancellation keeps its owner until
cleanup; uncertain close retains/poisons the bounded slot. A removed ignored-close
mutant makes the shared image reader regression RED. Held export IO leaves actual
authenticated SSH, signed renewals, new panes, uploads and health responsive.
The first full app run passes413/79files (87.32s); final suite including the last
SSH regression, full native compatibility and fresh frozen browser checks remain
pending. No deployed/completed-TODO claim. C10/C11/legacy migration decisions and
the local Docker-engine prerequisite remain pending; no policy is assumed.
Final export candidate application suite passes414 checks/79files (85.99s),
native uncached race/resource/namespace/compiler/default-size passes
core173.882s/CLI6.637s, static build/vet/typecheck/build pass. Fresh113-browser
qualification is running with140 runtime/source files frozen; no web/runtime
edits or rebuilds during that run. Final browser evidence/commit is still pending.
Independent C2a5 qualification is now being prepared: exact guarded
template-catalog guest profile, actual root CLI/system manager/supplied separate
slice,128MiB import, exact retry/source mutation/conflicting intent/link refusal,
inventory/verify and unchanged synthetic/native authority. Thirteen Python runner
checks and20 host-refusal repeats pass. This is not yet privileged qualification
or grant issuance. C8 still depends on legacy-grant visibility/migration, not a
gateway-only zero-dependency count. No installed service/configuration change.
The first C2a5 guest run fails a fixture-only cgroup-path assumption after real
128MiB validation: systemd correctly places exam-template.slice under exam.slice,
not directly at cgroup root. Host/base preservation passes; private evidence
/var/tmp/ssh-exam-overlay-urmj72yk. The fixture now checks the exact documented
hierarchy and the same unchanged kernel limits. This failure is not called a
qualified run and no installed unit/limit is modified.
The second/third runs expose an overly broad byte-equality assertion against the
independent idle guest agent's state file. Scoped diagnosis proves ONLY callback
sequence/events differ; private CLI-state and protected sentinels are unchanged.
Evidence /var/tmp/ssh-exam-overlay-cd4kd5b_ and
/var/tmp/ssh-exam-overlay-91j3h3u7; both host/base preservation checks pass.
The fixture now excludes exactly callback events/sequence/reported bookkeeping,
while comparing all remaining parsed fields, including every attempt and unknown
future authority field. A local regression must still reject changed deadlines,
holds, protected state, settings and added authority. No live policy is changed;
the corrected guest run and final qualification are pending.

Next C3 qualification increment is in progress, not a live mode: a private guest
test combines actual root cgroup freeze/UID inspection with the unused local
PTY gate/discard. It will check repeated preservation of synthetic in-memory
state/PIDs, a background descendant stopping/resuming, real queued old PTY input
and late old-epoch refusal, plus refusal of an uncontained same-UID process.
These are controlled memory/IO fixtures, not actual editor or retained SSH
workflow qualification. Closed native admission, cross-process epoch/authority
transitions, asynchronous-kernel IO and positive live recovery remain open.
The first Q4 guest run passes five repeats (0.56..0.80s each), covering15 actual
freeze/discard/thaw cycles with preserved host/base state. Private evidence:
/var/tmp/ssh-exam-overlay-xhhzhgov; test artifact e8520e363b0ff6589f9c2346c45fe8e766ff46d0c27b47ced32ef8450e58f031.
A deliberate TEST-ONLY missing-discard mutant makes all five repetitions RED:
the thawed reader receives STALE, not FRESH. Host/base preservation still passes;
evidence /var/tmp/ssh-exam-overlay-xckp4pge. The mutant is removed. Final rebuild
and qualification are in progress, with read-only guest kernel/async-IO setup
observations added (availability is not async-IO freeze qualification). No runtime
product source is mutated.
The added IO probe first exposed a fixture ordering failure: Python forked after
creating kernel IO helpers and emitted its multi-threaded-fork warning. This was
not counted as qualified; no warning filtering was added. The background child is
now forked before the capability probe. That failed guest still passed host/base
preservation (/var/tmp/ssh-exam-overlay-a07hchv9). Final Q4 passes five repetitions
(0.54..0.72s),15 actual cycles, on kernel6.8.0-111-generic, with host/base preservation:
/var/tmp/ssh-exam-overlay-3u8w6mlt. Basic and SQPOLL setup both return errno0 as
the synthetic UID; deferred IO is therefore a real remaining qualification gate,
not assumed absent/disabled. Full native compatibility passes core171.16s/CLI5.92s,
static build/vet,27 Python checks and20 host-refusal race repeats (1.20s) pass.
See native-freeze-qualification.md for exact hashes and open admission/epoch/
real-editor/retained-SSH/deferred-IO limitations. The final shared-validator Q3
also passes five repeats (0.23..0.35s) on the same exact artifact, preserving
host/base state; evidence /var/tmp/ssh-exam-overlay-ue_wdjrm. No C3 mode or deployed
claim. Continue with deferred-IO behavior and native admission/epoch integration.
Kernel-source investigation is separate:
cgroup.freeze confirmation is asynchronous; process/mount moves and privileged
kernel IO cannot be assumed covered from a live SSH pidfd or CPU pause alone.
No syscall restriction or host clock/service/configuration change is introduced.

Actual SSH-owner qualification is being added as a separate opt-in disposable
guest profile. The local helper compiles as a Go test executable only (not an
installed native command); it refuses non-fixture/non-nspawn contexts. It will
listen only after the guest wrapper stops that overlay's agent, never replace an
existing guard socket, accept actual SO_PEERCRED from the installed exam-login
over authenticated loopback SSH, refuse ordinary execution, and compare exact
root-monitor pidfds across short-lived commands/owned connection exit. No ACTIVE
seal, attempt, lease or held recovery is created. Twenty-six local Python safety
checks and existing process guards pass. The first guest run failed safely on
the removed RuntimeDirectory; the repaired actual OpenSSH/SO_PEERCRED test passes,
then passes five repeats (0.23..0.29s each), with exact monitor identity across
two refused command exits and exact connection exit. No ordinary work is allowed.
Host binary/config/authority and guest-base preservation pass. Evidence:
/var/tmp/ssh-exam-overlay-xkvs9bgs. The final test-binary rebuild adds a negative
host guard passing20 race repeats (1.20s); its five exact-artifact guest repeats
also pass (0.24..0.28s each), preserving host/base state. Final private evidence:
/var/tmp/ssh-exam-overlay-orunyydb. See isolated-native-qualification.md for hashes.
Full local native compatibility passes core173.28s/CLI6.35s, static build/vet pass.
The existing shared csc-sys connection is available. A bounded read-only raw-state
guard currently reports zero live/unresolved host attempts; no installed service,
configuration or student record was changed. Any eventual test must recheck that
guard throughout and abort its exact guest unit on new host work.

During the approval candidate's expanded frozen-artifact browser run, a separate
browser queue regression confirms that unsent input and late rejection can target
a replacement pane with the same UI identifier. Both success/failure cases are
RED on the old client. A local per-pane object fence now captures ownership before
the asynchronous queue, invalidates it on close/exit/logout and prevents late
rejection from closing the replacement. Thirteen focused client/cleanup/Unicode
checks pass, including worker-reported natural exit and an unaffected sibling.
This separate source change is NOT in the currently frozen browser
build and must receive its own build/browser qualification before being committed
as tested. It does not fence already-sent worker/SSH bytes or enable C3.
Fresh qualification now passes all398 application checks/74files (80.82s),
typecheck/build; all113 fresh browser checks pass (12.7m). All nine runtime hashes
match before/after, and nine generated screenshots are restored to their verified
baseline. See browser-input-lifetime.md. This browser-only fix is locally tested;
the wider native C3 TODO remains open and nothing is deployed.

Continuation after2928bc0: the paused student page is being given bounded,
attempt/generation/review-revision-scoped approval presentation. Source inspection
confirmed that the status endpoint already returns authorization but the page
ignores it. The candidate adds explicit waiting/approved/expired/revoked/replaced
messages, server-time expiry and stale-reply fences without granting work,
reconnecting SSH, submitting review or invoking Continue automatically. Operational
history can explain removal, never reconstruct usable permission. Six focused
unit/HTTP checks and all395 application checks/74files (81.05s), typecheck/build,
four focused browser checks and all111 expanded frozen-artifact browser checks
(12.5m) pass. A disabled status-handler mutant makes the actual gateway/WASM SSH
approval test RED; removed before final build. Nine runtime hashes (and all30
including historical unused assets) match before/after. Nine generated screenshots
were restored to their verified clean baseline. All six desktop/narrow and
backward-time follow-up browser checks pass (32.2s) on the same frozen artifacts;
no deployed claim is made.
Retained-transport UI fixtures do not qualify real C3 containment;
the full TODO stays open until coordinated native integration is verified.

While clock/browser artifacts are frozen, a separate unused native process-lifetime
guard is under qualification. Exact kernel pidfds are bracketed by full boot/start/
UID-tuple/executable snapshots; current checks are nonblocking, never PID-only or
cached positive flags. Stalled/stopped processes and other command exits are not
auth loss; handle uncertainty and explicit close are distinct. Six substantive
cases pass20 native race repeats (2.63s), including actual owned-child stop/continue/
death/reap, JSON/identity/close races, fake root-peer refusal and a pending synthetic
authority fence. No positive actual SSH/PAM proof or live ACTIVE seal factory is
claimed. No actual SSH service or exam process is signalled. See
native-monitoring-process.md. Full frozen native race/resource/namespace/compiler/
default-size qualification passes (core172.99s/CLI7.29s); static build/vet pass.
These are lifetime/model fences, not actual positive SSH authentication, native
registration/epochs or all-writer containment; the ACTIVE seal factory stays absent.

Continuation after9cf1511: the unused gateway evidence ledger now has a local
checked CLOCK_BOOTTIME C Node-API8 reader, build/container packaging and typed
clock errors; no live signer/route/mode uses it. Actual Node reads/restart, C
integer-boundary UBSan, invalid APIs/errors, default-ledger, existing policy/
coverage and compiled-Go interoperability checks pass28 tests. A raw-error-path
mutant fails the typed-clock test; removed. A separate RED regression confirms
stale blur after an earlier monitoring gap was misclassified as policy-blocked;
the candidate keeps it technical, never resets unfocused grace and preserves
coverage-gap identities/native rejection. Continuous fresh20s blur remains
enforced. No actual host time/suspend is changed and no production cause is
claimed. Frozen qualification passes389 app tests/72files (79.72s), typecheck,
complete build/packaged native load and all91 browser checks (11.4m). All nine
recorded WASM/runtime/JS/CSS/worker/HTML/native-addon/server-module hashes match
before/after. Go's rebuilt WASM contains newer repository metadata; it is NOT
assigned H4a's earlier qualification. See gateway-monitoring-clock.md for exact
hashes and remaining gates. Nine generated screenshots are restored to their
verified clean baseline. These increments are being committed separately;
nothing is deployed and the critical TODO remains open.

Docker packaging qualification is currently blocked by absent local engine:
the Docker command exists, its sole context is local unix:///var/run/docker.sock,
but the socket is absent. No missing command has occurred. Do not start/restart
services or use a remote/production daemon to conceal that gap. Independent
local tests continue; native source/header builds pass on the current Linux host.

Continuation afterf8fcb89: private bounded provisional publication is under
qualification; see native-monitoring-publication.md. Actual child death, late/
malformed replies, concurrent retry, independent second-owner publication and
cutoff, compiled namespace-root examctl/agent entry, user-manager inherited-fd/
OOM/runtime controls, and disposable namespace ENOSPC/readonly-view cases pass.
A disabled one-worker CAS made concurrent retry RED; the mutant is removed.
Race child exit sleep is disabled only by test command, not by extending live
timeouts. A real readonly fixture EBUSY was resolved using a fresh bind view,
without dropping current claims. This is not privileged retained-mode/capacity
qualification and does not enable a live monitoring path. Frozen full native
race/resource/namespace/compiler/default-size checks pass (core170.74s/CLI8.31s),
all383 application tests/71files pass (80.35s), process/unit twenty race repeats
pass (15.19s), static build/vet/typecheck pass and bounded two-worker metadata
fuzz passes774 executions (11.01s elapsed). Slice verification passes; the local
systemd emits an existing parent exam.slice CPUAccounting-deprecation warning,
not a new publisher-unit error. No unit is installed/reloaded. All six browser
artifact hashes match H4a's91-check run exactly; no client import or rebuild.

A consequential active-renewal durability question is outstanding (asked October
22): recommend live native renewals without waiting for disk sync, while retaining
durable deadlines/grants/owner/epoch transitions/audit and verified restart
freeze/recovery. Mandatory per-renewal sync retains an availability failure mode
during storage stalls. No decision is assumed and no existing runtime policy is
changed; independent work continues. Fair bounded multi-owner scheduling and
measured admission capacity remain required before either mode is enabled.

Continuation after9284522: private per-attempt ownership claims are being
qualified separately. Persistent empty private lock inodes are never truncated,
removed, replaced or explicitly unlocked. A publisher inherits the same open-file
description so it continues excluding replacement actors after coordinator death.
Four substantive cases (including twelve unsafe-target variants), actual child
SIGKILL/survivor tests and twenty race repeats pass (1.55s). An explicit-unlock
mutant made both survivor regressions RED, then was removed. Static build/vet pass;
frozen claim-only full native race/resource/namespace/compiler/default-size
qualification passes (core171.82s/CLI6.59s). These results precede and do not
qualify the next publisher increment. No live caller creates a seal from this
claim; actual root SSH/ACTIVE verification and all-writer containment remain open.
Next: independent bounded provisional publication, not the collection/template
pool. The launch design must preserve inherited claims; see
native-monitoring-publication.md. No production is accessed or modified.

October22 continuation aftercdaf37b: a private unused per-attempt monitoring
authority/publication arbiter is under qualification in monitoring_authority.go.
Source investigation shows a durable file/lock alone is insufficient: fsync may
stall, a late publication must not undo revocation, and persisted positive-looking
data cannot be treated as current authority after restart. The candidate performs
no disk/network callback under its lock. It retains only prior valid allowance
while publication is pending/failed, expires against current owned authority (not
an old state snapshot), retires failed tickets and rejects late success/errors
against replacement/revoked contexts. Fresh internally generated incarnation and
monotonic challenge counter prevent nonce re-anchoring after bounded pruning.
Initial sequence-zero contexts are awaiting-evidence, not permission for new-mode
work; a RED regression exposed inheriting the longer bootstrap interval after
first proof and that is now corrected to the verified first cutoff. Exact retries
retain immutable original outcomes. Verified policy/auth/operator/recording causes
remain sticky; timeout/publication failure alone does not become such a cause.
Fourteen focused signed-evidence model cases passed twenty race repeats (2.86s);
no real publisher, ownership claim, IPC, signed native receipt, bridge registration,
all-writer freeze or held recovery calls it. No persisted record or native deadline
is changed. Root actor ownership exclusion, bounded isolated publisher/storage,
crash fencing and actual root/native workflow qualification remain next. Continue
this increment and the coordinated integration; do not call it a live journal or
completed critical fix.

The native coordination contract is in native-monitoring-authority.md. It also
records a pane-replacement replay prerequisite: packet epochs must be fresh per
native pane incarnation, distinct from the attempt authorization epoch, even when
the UI reuses a pane UUID. No runtime pane or packet path is changed by that note.
Frozen arbiter qualification passes: full native race/resource/namespace/compiler/
default-size checks (core166.49s/CLI8.29s), all383 application tests/71files
(82.09s), static native build/vet, application typecheck and diff checks. All six
browser WASM/runtime/JS/CSS/worker/HTML hashes still match the91-check H4a run;
no rebuild or client import occurred. These results precede the next separate
ownership-claim increment and do not qualify that increment or live containment.

October22 continuation after9594087: native coordination clock foundation is in
progress, with all live legacy clock/deadline/access calculations unchanged. A
private unused checked CLOCK_BOOTTIME integer-millisecond reader rejects read/
negative/nanosecond-range/overflow failures without inventing time. A RED candidate
test demonstrates that an existing long Go timer can conceal an elapsed supplied
boot clock during an in-flight write. The private gate now rechecks current
authority at most100ms apart (and at every write), retaining current-cutoff renewal
fences; no authority window is lengthened. Clock callbacks now return explicit
errors and those also revoke/cancel input without fabricated timestamps or leaked
syscall details. All22 clock/gate/PTY cases pass20 race repeats (18.94s). Final
full native race/resource/namespace/compiler checks pass (core168.0s/CLI7.7s),
static build/vet and26 focused contract/ledger/compiled-Go/HTTP/WS/SSH checks pass
(11.85s). Browser assets are unchanged; no client import/build occurred.
No host suspend, clock adjustment or production call is used. Root cross-process
journal/admission/lease/freeze integration remains next and unimplemented.

Gateway clock inspection is NOT closed: the unused coverage ledger currently uses
performance.now. Pinned Node26.12/libuv source shows Linux high-resolution time is
CLOCK_MONOTONIC; os.uptime reads coarse /proc/uptime, falling back to whole-second
CLOCK_BOOTTIME. Do not blindly substitute it and claim precise evidence ages or
unchanged focus boundaries. Select/qualify an explicit suspend/failure/precision
rule or native-anchored evidence before enabling the alternate issuer. Existing
/proc float uptime also has unchecked failure handling; do not replace it with
zero/infinity or prematurely finalize/release on an unknown clock. Preserve all
authoritative deadlines/restrictions and add typed operational failure handling
with the coordinated native state, not an unsafe shortcut. This is source-derived
candidate investigation, not evidence of the production initiating fault.

October22 continuation after9af06c7: explicit native `list/info --read-only`
diagnostics are being implemented/qualified locally before root coordination.
Source inspection confirms legacy list/info reconcile and Engine.New creates/
chmods state; incident observation must bypass both. The candidate takes no state
locks and performs no initialization, permission repair, audit/network/subprocess,
or lease application. Private pinned single-component native openat/NOFOLLOW and
bounded duplicate/depth-checked JSON feed a scoped whitelist, never admission
tokens, transport proofs, private keys/certificates/nonces or raw private JSON.
Explicit --state bypasses config/keys; otherwise only the protected configured
state path is read. State and separate leases are labelled independent observations,
not execution/SSH/monitoring/archive/freeze proof. Eight focused core cases, actual
compiled namespace-root CLI/help/zero-side-effect workflows, full native race/
resource/namespace/compiler (core168.0s/CLI9.2s), all383 app tests (81.89s), static
build/vet and typecheck pass. Bounded two-worker JSON fuzz passes119353 executions
(10s requested,11.02s elapsed). All six browser artifact hashes remain exact matches
to H4a's91-check run; no rebuild. No
production use/change or C3 enablement is implied. Continue this increment, then
the durable native revocation/lease/admission/bridge coordination plan in
retained-ssh-input-protocol.md; the critical item remains open.

Critical continuation afterdf197ff: H4c private cancellable pinned-PTY writer and
kernel-input discard candidate is unused by all live paths. Explicit O_NONBLOCK/
poller and TIOCGPTPEER pinned-pair/N_TTY checks refuse unsafe descriptors. Cancel
callbacks are stopped/joined and write deadlines cleared before acknowledging
drain. Current already-drained receipts and an IO-outside-controller-lock discard
reservation fence arm; failed discard prevents local re-arm even if ignored.
Actual PTY checks cover backpressure, raw/control/UTF-8 and incomplete canonical
input, output preservation,20 repeated hold/discard/new-epoch cycles, stale/foreign/
undrained receipts, stalled-discard revocation and two-pane independence. Eight
adapter plus ten gate cases pass final20-repeat race checks (15.91s), full native
race/resource/namespace/compiler passes (core170.3s/CLI6.4s), static build/vet pass
and all383 application checks/71files pass (82.82s). Browser WASM/runtime/JS/CSS/
worker/HTML hashes remain exact matches to the91-check H4a run; no rebuild occurred.
Complete kernel ioctl inspection corrected an
initial incomplete-source inference: slave TCIFLUSH already flushes pending buffers
before its line-discipline handler; no second/output flush is added. No production
cause or absolute guarantee is inferred from that source review. Do not qualify
unsupported line disciplines by autoloading host kernel modules. Legacy raw bridge
flags remain unchanged; no browser rebuild is needed or performed. Native durable
cross-process registration/epoch/authority plus all-writer freeze and authenticated
mode negotiation remain next; no runtime retention/thaw is enabled.

Critical continuation after83af9ec: H4b local per-pane revocation/drain controller
candidate is unused by all production paths and under full native qualification.
It starts revoked, bounds one in-flight frame/no queue, consumes increasing
sequences before any write, binds current receipts to the controller/revision and
rejects stale/consumed/foreign receipts, old epochs, unsafe cutoffs and expired
self-renewal. Revocation cancels outside-IO independently; an uncooperative write
cannot falsely acknowledge drain. Clock regression/revision exhaustion fail closed.
A RED regression reproduced an initial-write timer revoking a healthy later
renewal; the candidate now rechecks the current cutoff and coalesces timer wakes.
Ten focused cases pass ten race repeats (7.10s), including actual Linux PTY
backpressure and partial delayed-frame parser→gate→PTY epoch/byte/output checks.
Static build/vet pass. Full native race/resource/namespace/compiler repeat passes
(core171.9s/CLI5.8s);26 focused contract/ledger/compiled-Go and real HTTP/WS/SSH
checks pass (11.60s). No browser artifact changed from83af9ec's exact
91-check run. Cross-process durable authority/admission/bridge registration,
all-writer freeze/queue discard, negotiation and hold/thaw remain open. Continue
with that native barrier design/integration, not feature expansion or deployment.

Critical continuation after7f443b1: H4a/C3 unused framed-input codecs, canonical
byte fixture and delivery/revocation controller design are under local
qualification. Real encrypted SSH-channel and raw Linux PTY checks preserve
binary control/UTF-8 bytes; invalid/oversized headers refuse before reading bodies,
truncation exposes no partial input and empty input has no authority. The32KiB
limit matches existing worker bytes and accepts current8000-code-unit Unicode
pastes. Decoder fuzz passes176647 executions/10s/two workers; focused Go race
passes. All383 app checks/71files pass (82.03s); full native race/resource/namespace/
compiler checks pass (core163.9s/CLI6.0s), static build/vet and app typecheck/build
pass. All91 browser checks pass again (11.2m), with exact WASM/runtime/JS/CSS/
worker/HTML hashes verified unchanged before/after the frozen run.
The earlier H2b/H3b unchanged-WASM claims below were unsupported and are corrected:
printed JS/CSS/worker filenames matched, but no earlier WASM hash comparison was
made. Rebuilt H4a WASM SHA256 is
071ee17c59ff7c39d44eec6514def75ba15b627ef541f23431003e4a036a54ad.
No runtime input bridge, capability, policy or authority path uses these codecs.
Root durable epoch/lease/revocation control, authenticated negotiation, all-writer
freeze/input discard and technical-hold recovery remain open. Continue with the
per-pane revocation/drain controller; never wait behind IO under its mutex or
claim an undrained write is safely stopped. See retained-ssh-input-protocol.md.

Critical continuation afterf26234b: H3b bounded, internal/unwired evidence ledger
and explicit continuous-coverage identity are under qualification. Complete
challenged policy plus required validated-frame metadata never freshen on receipt;
frames alone cannot extend expired readiness. Focus grace remains20s, repeated
blur cannot reset it and actual condition loss is sticky. Owner/receipt/challenge
limits are explicit and one owner cannot evict another. Unknown gaps rotate the
coverage identity; native verification rejects crossing it. A failing old-bootstrap-
receipt-across-gap regression was fixed. A private compiled Go test binary accepts
real Node-signed ledger proofs and rejects changed scope/signature/expiry/coverage.
All22 focused cases pass, including a five-minute deterministic cadence/latency
model with zero false holds in its declared envelope. This is not a production
endpoint or privileged availability claim. Full app repeat passes 383 tests/71
files (80.49s); native race/resource/namespace/compiler passes core173.0s/CLI6.6s,
static build/vet and typecheck/build pass. Coverage-bound metadata fuzz passes 268
executions in 10 seconds with two workers. Printed JS/CSS/worker filenames were
unchanged from the 91-check run; WASM hashes were not compared. This is not
evidence that the rebuilt WASM artifact was qualified by that earlier run.
Fresh exact-artifact browser qualification follows in H4a. Verified epoch handover,
durable native receipt/revocation, alternate
routes and C3 input/writer containment remain open; no thaw is enabled. Native
Cutoff's current independent boundary is deadlines, not a safe standalone
monitoring-expiry transition; investigate/fence that with C3, never blind-freeze
a possibly superseded snapshot. See monitoring-evidence-contract.md.

Critical continuation after7930f84 (H2a contact isolation) and9b26217 (separately
qualified preserved C2a4): H2b/H3 signed-evidence candidate is internal/unwired.
Strict Go/TypeScript scope, required/null/duplicate/unknown fields, bounded signed
metadata and challenge/sequence/monotonic evidence-age/current deadline arithmetic
do not start a new allowance on delayed receipt/retry. Focused native race and
three shared-contract tests pass; short two-worker fuzz passes376 executions.
No lease, callback, live route, thaw, capability or configuration uses it. Full
app repeat passes364 tests/69 files (79.49s); full native race/resource/namespace/
compiler repeat passes core169.7s/CLI6.5s. Static build/vet, typecheck/build pass;
printed JS/CSS/worker filenames match H2a/C2a4, with no live client import. WASM
identity was not compared and the earlier browser run does not qualify that
rebuilt artifact. Owner epoch
assignment, coverage/receipt ledger, alternate exchange and C3 verified input/
writer containment remain prerequisites; no automatic recovery is enabled. See
monitoring-evidence-contract.md. Continue beyond this internal checkpoint.

Critical-priority continuation: the instructor approved automatic recovery of
positively verified infrastructure-only technical holds, retaining current
recovery requirements for actual policy violations/authentication loss. H1/H2 in
monitoring-liveness-plan.md now precede nonessential expansion: reproduce the
serial session/SSH-renewal acknowledgement blockage with real authenticated
WebSocket/SSH/PTY and independent HTTP captures, then isolate bounded contact and
renewal handling without manufacturing native work permission. H3 alternate
evidence and H4/C3 all-writer/input-epoch verified containment remain prerequisites
for complete nondestructive automatic recovery; no partial queue change completes
the critical TODO. C2a4's existing uncommitted implementation is preserved, not
discarded or falsely marked qualified/committed. No production work is authorized.

H1/H2a candidate: the old serial handler fails the real-interface confirmation
regression while fresh screen/webcam HTTP uploads and an authenticated SSH terminal
channel still work (simulated shell/policy, not privileged native enforcement).
Independent bounded monitoring/policy handling now returns contact-only one-use
receipts without waiting for SSH or terminal operations. Handler-local snapshots,
current socket/page fences and connection-cancel/handler-drain shutdown protect
stale ownership and remove a newly exposed closed-DB unhandled rejection. Nine
focused tests and all361 application tests pass (79.97s), typecheck/build pass;
three receipt-authority/actual WASM SSH browser tests plus four preserved catalog
UI checks pass together (32.8s). All91 combined browser checks pass (11.2m) against
the frozen gateway/browser candidate. Full native race/resource/namespace/compiler
qualification passes (core167.9s/CLI5.9s); static build/vet pass. H2's
native renewal/receipt scheduling, H3 alternate evidence and H4/C3 freeze/input
epochs remain open. No native safety hold or automatic thaw is enabled, and a
native lease can still expire if all renewal paths stall. This checkpoint does
not close the critical item; the production initiating fault remains unproven.

Preserved pre-interruption C2a4 candidate is now qualified locally and being
checkpointed separately from H2a; the latter remains the critical active priority.
Root templates sync first runs actual bounded native verification, then signed
named root-agent management stores metadata-only source observations in020.
Shared web/root list/show and read-only admin catalog preserve exact source scope,
as-of status, private output fences and no-selection/no-grant behavior. Exact
sync retries/restart retain original acknowledgements; new request IDs refresh.
Confirmed UTF-8 reason-length inconsistency was reproduced then fixed (four
two-byte characters satisfy eight bytes). All361 app tests (79.97s), all91 combined
browser checks (11.2m), fresh native race/resource/namespace/compiler tests
(core167.9s/CLI5.9s), static build/vet and typecheck/build pass. CLI verification uses
private synthetic manager adapters, distinct from actual local kernel-control
tests and still-pending privileged system-manager guest qualification. Generated
screenshots were restored to their pre-run tracked versions. No attempt/grant
source, window, account restriction, protected byte or production record changed.
Registry visibility is not live availability, unified grants or deployment.

Earlier implementation plan after validated **965ebb0** (C2a3 binding): C2a4
authenticated catalog visibility. Reuse C1's existing root-agent signed outbound
HTTPS management, named default-deny operations, nonce/intent/revision/audit and
strict pre-output scope validation. A root `templates sync NAME HASH` must first
verify local actual bytes in the bounded worker, then send only exact-name/hash/
count metadata and an audited reason; no source paths, inventories/question text,
student credentials, inbound API or filesystem proxy. Stable request retries keep
the original acknowledged observation; a new request explicitly refreshes it.
Store immutable logical version metadata plus bounded timestamped attestation
facts, not a claim of current liveness or permanent filesystem availability.
Read-only root `web templates list/show` and authenticated administrator inspection
must share one service with bounded pagination and explicit as-of/no-grant status.
No source is implicitly selected, no existing snapshot rewritten, and no new
grant/definition retirement is enabled. Keep native exact verification before
Begin. Acceptance: signed authorization/replay/conflict/restart/out-of-order
attestations, immutable metadata/counters, no private payloads, shared HTTP/CLI
reads, actual compiled CLI/TLS with private synthetic manager adapters, malicious
signed wrong-scope stdout-empty refusal, browser inspection, full app/native race/
build/typecheck qualification and updated operator/rollout docs. This earlier
plan is now locally implemented/tested as recorded above; no production change.

Active continuation after validated local commit **4b29df3**: C2a3 exact-version
reader binding. Add optional omitted legacy settings/source hash fields; preserve
historical JSON/hash/receipt compatibility. Stage work only from the recorded
catalog version, bind normal/admin materials and read welcome from that same
version, with practice bypassing all private catalog reads. Full byte verification
before Begin must run in a separately bounded OS worker outside WithState, then
existing ownership/settings/generation/window fences recheck before any interval
or hold commit. Missing/damaged explicit versions refuse, never mutable fallback.
The ordinary exam-agent may expose the same private root-only worker entry as
examctl (never the student gate); no listener or new student privilege. Legacy
test-only initialize must refuse versioned inputs rather than become an alternate
mutable copier. Gateway issuance/selection is not enabled until authenticated
catalog visibility and shared CLI/web changes exist. Acceptance: legacy bytes,
signed prepare/stage/Begin/restart, author edits/new panes/welcome/mounts, missing/
corrupt version and actual verifier death/hang, practice confidentiality, healthy
signed operations plus full native race/build/integration/browser checks. This is
in progress, not implemented or deployed; the previous checkpoint is not a stop.

C2a3 native candidate is now implemented/tested locally; not deployed or enabled
for gateway issuance, and privileged system-manager qualification remains pending:
optional omitted hash fields preserve legacy encodings, version-bound private
starter receipt/copy, existing-only material/welcome readers and both mount modes,
separate bounded pre-Begin verifier plus snapshot recheck. Practice never reads
the catalog; the old test-only initializer refuses versioned inputs. Focused race
tests pass11.5s, including signed stage/Begin/restart, author/new-version edits,
missing/corrupt/link refusal, actual verifier SIGKILL/panic/hang, stale snapshot and
real read-only bubblewrap material IO. A local missing /materials target was a
fixture error; the test now uses an existing private mountpoint without changing
the host. Four old launch fixtures also lacked a real mandatory template ID;
corrected them rather than relaxing validation. The first focused socket/net test
needed the normal local test sandbox escalation; the rerun passes. No command
was missing. Full native repeat passes **core163.1s/CLI7.3s**; all350
application tests pass again (73.2s), typecheck/application-WASM build/static/vet
pass. All3 fresh browser-SSH isolation/credential-cleanup checks pass (1.6m), in
addition to the previous29 interface/closure checks. Final catalog/binding/compiled
CLI repeat passes core13.6s/CLI2.7s after scope-message clarification; static/vet
pass again. Browser assets retain their prior hashes; no screenshots changed in
this three-test repeat. Native-only support does not confirm versions or issue/
migrate grants. Next independent dependency is authenticated bounded catalog
metadata visibility/acknowledgement and discoverable root/web inspection; do not
stop because the legacy enrollment migration question or guest gate is pending.

Continuation correction: a validated checkpoint is not a stopping condition for
the unfinished backlog. The legacy-unused-enrollment decision does not block
independent work. The resumed C2a2 milestone adds separate resource-bounded native
template worker/pool and complete local templates CLI (validate/install/list/show/
verify plus owned failed-staging inspection/cleanup). Publish only exact named
content versions, never replace legacy sources or implicitly select latest; keep
all student readers unchanged until separately qualified version binding. Local
installation must explicitly report not gateway-confirmed. Acceptance requires
actual CLI help/refusals, bounded strict IPC, worker death/hang/resource/storage/
retry/concurrent isolation, atomic no-replace publication, safe job cleanup and
unchanged protected/attempt/account/clock authority. C2a2 is now implemented and
tested locally as a separate catalog candidate, not deployed, confirmed to the
gateway or connected to student readers. No routine/local-commit approval is requested.

C2a2 current qualification: fresh full native race/resource/namespace/compiler/
default-size suite passes **core155.8s/CLI5.7s**; **350 application tests/65 files
(74.4s)**, typecheck, application-WASM build, static native build and vet pass.
All29 fresh browser-SSH interface/closure checks pass (6.1m). Focused regressions
include actual child panic/exit/SIGKILL before intent/before publication/after
publication, hang/fatal allocation/file-size failure, strict malformed/scope/
required-flag/overflow IPC, real private ENOSPC/read-only and root/nested/file bind
cleanup refusals, retained flock versus healthy signed lease/admission, exact
published retry/corruption/budget fences and unknown-intent cleanup tombstones.
Actual local user-systemd failures report oom-kill/timeout. A real128MiB import
passes under unchanged256MiB/no-swap/32-task controls (observed peak165588992,
not an exact peak guarantee), and installed bytes verify. The compiled root-mapped
CLI exercises all workflows with a private **synthetic manager interface**; this
does not replace privileged system-manager qualification.

The csc-sys read-only precheck finds **two live or unresolved host attempts**;
the strict idle-host test guard therefore prohibits the disposable guest run.
No guest, host service/configuration/account/record mutation or production
reconciliation was attempted. Existing host work is not test setup. Independent
local work continues. The first full native run correctly refused the CLI fixture's
memory-backed /tmp state; corrected it to private disk scratch, not the guard.
The initial app build used the unwritable default Go cache; the repeat with the
established /tmp caches passes. Neither failure was a missing command.
See template-catalog.md; all-reader/version visibility/grant work remains open.
Final CLI/help repeat passes5.1s; read-only systemd slice validation passes, with
the existing parent exam.slice CPUAccounting deprecation warning. Browser assets
retain their prior hashes; nine generated screenshots were restored to the
pre-run tracked versions. Next active milestone: exact-version reader binding,
preserving legacy settings JSON/hashes and practice confidentiality. Do not stop
at this commit or treat the pending legacy migration question as a global blocker.

Current validated checkpoint: initial ordinary issuance remains enrollment/import
with explicit unused revisions (decision38f3fbc). C2a1 private copying is local
commit1d4026c and remains internal/unwired. Image link/bounds/retention fixes and
pre-output CLI scope refusal pass **350 application tests/65 files (74.0s)**,
typecheck/application-WASM build, **84 browser-SSH checks (10.7m)** and fresh
native race/resource/namespace/compiler/default-size tests (**core118.8s,
CLI3.2s**), static build and vet. Actual512MiB worker checks now inspect live
kernel controls; no limits were raised. Fallback closure passes2/one explicit
browser-only skip (2.3m); that guarded case separately passes in browser-SSH mode
(16.2s). Generated screenshots are restored, not product edits.

The backlog is NOT complete. The bounded immutable template worker/pool and
publication/CLI plus optional native all-reader binding now pass locally. Next dependencies: signed catalog
acknowledgement, then unified grant issuance/revision/claim/Begin/migration and C8;
independently, coordinated C3 native input/liveness/verified-freeze work, C4 fresh
archive/usage proof/manual cleanup, full monitoring export and remaining management.
The consequential legacy-unused-enrollment migration question is still open:
reviewed bulk issuance from current effective settings/unchanged windows/selected
immutable version (recommended), or explicit selected initial reissuance. Never
invent historical enrollment snapshots or rewrite preparations/started history.
No production access/change, missing command, push, deployment or temporary-agent
consolidation was performed in this increment. Proposed rollout only.

Validated local commits for this checkpoint: `1d4026c` exclusive verified private
template copies (unwired); `670e71e` bounded no-follow media reads/final retention
fence; `ca1ea7c` pre-output CLI resource validation with scoped partial-clock
diagnostics; `87388fd` real live worker-control observations and explicit browser
transport qualification modes. This documentation update records their scope,
remaining decisions and future-only rollout; it does not finish the backlog.

Current native final repeat exposed a measurement-assumption failure, not a
successful qualification: default-size collection/restore/hash checks and healthy
renewals succeeded, but memory.peak was268,439,552 bytes (256MiB+one4KiB page).
The primary kernel spec explicitly permits transient memory.max excess. The test
now verifies actual LIVE kernel memory.max=268435456/swap.max=0/pids.max=32/
oom.group=1 and reports finite peak observations, rather than comparing the peak
to a fictional exact ceiling. Missing/altered/unbounded controls fail; no resource
limit is raised and real OOM/runtime fault regressions remain. A focused512MiB
repeat and fresh full native qualification now pass as recorded above. See collection-limits.md.

All84 browser-SSH checks pass (10.7m) on the frozen gateway/UI candidate, including
the delayed-open and control-rebind cases that the fallback run could not exercise.
A mode-specific skip now identifies the delayed-open case in fallback transport;
fallback closure/recovery is running separately. README explains both fixture
modes and truthful skip reporting. Full application350/65 (74.0s), typecheck,
application build, static native build/vet and focused CLI race checks pass.
No production changes, missing command, push, deployment or consolidation.

New confirmed CLI output-order bug: actual compiled root-mapped CLI/TLS testing
printed private review text from a correctly signed wrong nested target BEFORE
reporting target mismatch/exit1. Scope validators now precede all output/file
creation. The first straightforward move also hid valid partial clock results;
the existing interface test caught that regression. A typed exception now permits
only fully validated partial batches to print diagnostics/exit1; malformed targets
still produce empty stdout. Actual CLI/TLS/restart/private-output and partial
clock workflows pass; a dedicated companion-target unit regression is added.
No gateway authorization, approval, interval, hold or retention policy changed.
Full application/native CLI qualification now passes as recorded above. No deployment.

Browser qualification correction: the first current84-case command omitted
EXAM_BROWSER_SSH=1. Its browser-control-only case skipped and the delayed browser
terminal-open interception correctly never fired on fallback transport (81pass,
1fail,1skip,1serial-not-run). This is NOT a passing84 result. Full browser-SSH
repeat passes84; the delayed-open case is now explicitly mode-guarded, with
fallback and browser-SSH guarded repeats passing. README documents the modes.
Native C2a1 full112.5s/static/vet pass
and local commit1d4026c do not depend on this browser fixture mode.

C2a1 private-copy foundation is implemented internally and unwired, not a catalog
management/installation capability. Exclusive fresh owned 0700 staging, pinned
source/output, physical ancestry/bind-alias exclusion, streaming hashes, ordinary
modes/nsec mtimes, independent copied-byte/source verification and flushes preserve
authored input. Actual owned child SIGKILL leaves unpublished private partial
staging; existing-target retry refuses, fresh-target retry succeeds. Focused
source/copy race/userns tests pass (6.4s), including 128 MiB streaming and actual bind
aliases. The initial Go fixture lacked explicit 0700 on its staging subdirectory;
fixed the fixture, not the ownership/private-mode guard. Fresh full native race/
resource/namespace/compiler/default-size tests pass (core112.5s, CLI3.0s), static
build/vet pass, and local commit1d4026c records this increment. Separate worker/pool, durable publication/
owned cleanup and supported CLI remain open. No deployment/missing command.

New confirmed monitoring image defects: a real authenticated HTTP regression
returned unrelated protected-fixture bytes through a stored image symlink, and
removing the new final response fence reproduces a deletion-during-async-read
200 instead of 410. The local candidate now pins private root/attempt descriptors,
opens no-follow/nonblocking regular single-link owned images, bounds originals to
the existing 1,500,000-byte upload ceiling and thumbnails to 2 MiB, verifies original
capture hashes and rejects observed concurrent changes. Async reads have 16 active
slots; descriptor closing precedes a final synchronous response tombstone check.
Legacy thumbnail provenance is NOT cryptographically verified (no stored hash),
and async IO is NOT a separate OS/process fault sandbox. No retention, archive,
clock or hold policy changes. Four actual HTTP regressions pass, including real
FIFOs in an owned disposable server with concurrent healthy HTTP traffic; full
application350/65 and build/typecheck pass; browser qualification is underway. The
wrong-role fixture first expected403; corrected to the existing principal's401,
not an auth policy change.
No deployment, missing command or production access.

Final reserved-starter/C2a0 local qualification: fresh full native race/resource/
namespace/compiler/default-size suite passes (core110.4s, CLI3.3s), including real
same-device template bind mounts, 128MiB streaming and the signed/legacy reserved-
name regressions. Full app **346/64 (72.7s)**, typecheck/application-WASM build,
static native build/vet pass. UI assets are unchanged from the **84 combined
browser pass (10.6m)**. The narrow privileged test-host evidence still identifies
its older artifact; no new production/host installation claim is made. Source
inspector remains internal/unwired, not catalog/CLI or grant implementation.
No deadlines, holds, protected copies, issued snapshots or production records were
changed. No missing command or deployment. The legacy-unused-enrollment migration
question is still awaiting an answer; independent catalog work can continue.

New confirmed native starter correctness bug: Collect rejects root MANIFEST.json,
but starter staging accepted it, including retained pre-upgrade ready trees whose
receipt/inode still matched. A legacy-stage regression failed against the old
adoption/Begin path. New copy validation and cheap stage-adoption/Begin checks
refuse before time/consumption; source/private bytes stay intact. Guidance is
inspect/correct source/cancel only that unstarted preparation, not overwrite its
frozen receipt. Nested MANIFEST.json remains permitted. Signed fresh preparation/
explicit author repair/legacy Begin regressions pass; the signed fixture's key
helper initially reset UID/GID and was corrected without weakening identity checks.
Full native/application/build qualification is running. No deployment/policy change.

C2a0 internal source-inspection primitive has been implemented **unwired**: no
new CLI/public capability, installer, grant issuance, settings/source binding or
agent path. Pinned roots, same-device mount-ID fences, UTF-8 paths, no links/special
files, per-tree10000 entries/depth32, declared logical bounds, material readability,
ordinary mode/second+nsec mtime fingerprints and bounded streaming hashes. Pre/post
inventories reject observed mutations; this is not a hostile-writer freeze/atomic
FS snapshot. Future worker must copy quiescent input and verify its own private
bytes before publication. Focused race/userns tests pass (3.8s), including actual
same-device bind mount, 10,000-entry boundary, 128 MiB streaming and source
link/special/layout/reserved-name/readability refusal cases. Final full tests are
recorded above; this does NOT complete catalog investigation.

C1gb4 final audit fix and combined qualification: **all84 combined browser checks
pass (10.6m)** on the frozen gateway/UI; all nine generated documentation screenshots
are restored. The root-only inventory request resource-label regression now passes
in the final full **346/64 app repeat (71.8s)**. Request audit rows correctly retain
their request UUID target; the resource label is in detail.target. The first
regression inspected the wrong column; the corrected detail-field test was proved
failing against the old fallback, then passing with monitoring-purges. Typecheck/
build pass with unchanged UI hashes, static build/vet/race compatibility pass.
This closes the bounded inventory/audit increment locally, not full management,
immutable catalog/grants, retained SSH or workspace deletion. Migration019 and all
other candidate migrations remain LOCAL ONLY. No production changes or missing
command. Next: source/version catalog foundation while awaiting the newly asked
legacy-unused-enrollment migration choice; never claim that proposal is implemented.

New consequential migration question sent asynchronously: legacy unused
enrollments have no original settings/enrollment timestamp, so choose reviewed
bulk issuance at eventual migration using current effective settings/unchanged
windows/selected immutable version, or explicit selected reissuance before those
legacy rows become available. New enrollment/import issuance remains approved;
preparations/started snapshots/history are not rewritten. Independent immutable
catalog investigation continues; details/source findings in template-grant-
investigation.md. No answer assumed and no production migration performed.

C1gb4 final-review finding: the generic root management audit target fallback
labels targetless monitoring.purges as "clocks". The service's own purge audit is
correct, but the request audit also needs a precise monitoring-purges target.
Add an actual compiled CLI regression, then correct the scoped gateway label after
the currently frozen combined browser run; do not commit the milestone with this
known discrepancy. This changes no authority or UI policy. Other read inventory
qualification above remains evidence, not proof the final-review bug is fixed.

C1gb4 final targeted qualification: full app **346/64 (72.4s)**, actual compiled
CLI/TLS/restart/pagination/snapshot-versus-fresh requests and two dedicated unit/
authenticated HTTP inventory tests pass. Typecheck/build/static native build/vet
and race compatibility pass (CLI3.6s; unchanged native enforcement uses valid
cache; prior fresh108.1s remains scoped to C1gb3). UI assets remain
index-BUxRZ6XW.js/index-CHDebkQt.css with the passing31-check admin result. A fresh
combined84-browser run is underway on the frozen gateway/UI candidate. The first
inventory CLI test incorrectly assumed no earlier restart-created retry jobs;
corrected to page actual IDs and preserve all backlog, not erase it. Migration019
adds only the stored-status index. This closes retired-job read workflows locally,
not whole-media export, grant/catalog migration or deployment. No missing command,
production record/config/service change, push or deployment.

C1gb4 candidate now adds shared bounded `web monitoring purges` list/filter/ID
pagination and `purge-status ATTEMPT`, including durable tombstones after preparation
retirement. Default 50/max100, metadata only; unfiltered pages include unbackfilled
legacy tombstones, while stored-state filters use additive migration019's index.
These read-only management outcomes are explicitly timestamped metadata snapshots
(NEW request for fresh status), not private-media caches or new FS verification.
Authenticated no-store HTTP/role/bounds tests, unit epoch-zero/orphan/index tests
and CLI help/syntax/reply checks pass. Actual compiled CLI/TLS/restart/cached-versus-
fresh status is under qualification. No purge/reset/delete control is added, no
production change or missing command. Full app/native/build and unchanged-UI
compatibility repeats remain before commit.

Final C1gb3: **344 app tests/62 files (73.8s)** and all **31 admin/monitoring browser
checks (2.1m)** pass, including desktop/mobile exact lost-reply retries and stale
review refusal. Actual compiled CLI/TLS/restart/new-parent child retries/default
deny/audit pass. The added authenticated HTTP missing-session/student/CSRF/Origin
checks plus real SSH/purge faults pass separately (7.1s). Fresh uncached full
native race/resource/namespace/compiler/default-size opt-ins pass (core108.1s,
CLI4.1s); typecheck and build pass (index-BUxRZ6XW.js). Static build/vet are repeated
before commit. This closes shared deletion locally, not full export/retired-job
inventory, unified grants, retained SSH, workspace cleanup or deployment. No
production work, missing command or push. Next independent monitoring increment:
supported bounded purge-job inventory, including retired preparation tombstones;
then remaining export/template-version/grant work under the recorded dependency plan.

C1gb3 candidate: shared web/root monitoring.delete now requires named student,
exact reviewed revision, ended eligibility, reason and stable child intent.
Migration 018 stores metadata-only acceptance; exact retries/new-parent child
retries never requeue/reset backoff. Browser captures review and immutable sent
reason; old boolean clients refuse with reload guidance. Four focused shared/
real SSH tests, Go CLI help/syntax/reply checks and actual compiled CLI/TLS/restart
pass. The first CLI run correctly refused the clock fixture's COMPLETED row with
no ended timestamp; only synthetic setup was corrected, not eligibility. An
initial unit setup also changed a review counter; the corrected test uses a
separate active target without rewinding counters. Full suite and 31 browser
checks are running. No deployment, push, production data edit or missing command.

Final C1gb2 qualification: **341 app tests/61 files (72.0s)**, actual compiled
CLI/TLS/status, typecheck and application/WASM build pass. **All 28 administrator/
monitoring browser checks pass (2.0m)**, including retry/verified-absence status
and independent protected-submission review. Native race compatibility passes
(CLI 3.3s; unchanged core cache; preceding uncached 107.3s remains correctly scoped).
The UI status increment builds index-CU3NgkSN.js/index-CHDebkQt.css. This closes the
durable isolated purge caller/job increment locally, not shared reviewed deletion
or full management. Broader combined 81-browser qualification remains the earlier
run, not a fresh claim for these changed assets. No deployment or missing command.

C1gb2 local candidate now wires durable purge jobs into existing manual/retention/
preflight-retirement callers. Migration 017 has no attempt FK; atomic first-time
tombstone/scrub/enqueue performs no FS IO. Indexed bounded backfill/retention,
owned worker backoff, restart/late-reply fences and unrecorded result-write retry
preserve deletion and history. CLI show/web review distinguish logical deletion
from current-directory verified absence, with private safe guidance. Focused 24
monitoring checks passed; final full app **341/61 (72.0s)** includes actual compiled
root CLI/TLS/restart/status and five job tests, eight process tests and a real
HTTP/SSH/PTY/signed-renewal nine-fault integration. Typecheck/build pass; 28 admin/
monitoring browser checks are running. A temporary path-helper naming collision,
synchronous-test assumptions and synthetic hold/pane fixture mistakes were caught
and fixed before the passing repeat; none of those runs was claimed as passing.
CLI shared delete/whole export/reviewed intents and retired-job inventory remain
open. No production change, deployment, push or missing command.

C1gb1 lock follow-up: a persistent validated private inode and no-fork flock now
serialize real workers across coordinators until actual process exit. Seven
focused process checks pass (including busy/death/retry and unsafe lock inodes),
full app **334/59 (66.3s)**, typecheck and application/WASM build pass. Browser
assets and native binaries are unchanged; existing browser/native evidence remains
scoped to them. The restricted sandbox's flock probe did not exec its child;
the outside-sandbox probe and real fault tests passed. util-linux is explicit in
the candidate runtime Dockerfile, not installed on production. Still unwired:
durable jobs, removal of synchronous callers and shared CLI/web deletion remain
open. No missing command, push, rollout or deployment.

October 21 decision refinement: the instructor selected enrollment/import, not
first preflight, for initial ordinary grant issuance and the saved settings copy.
Later defaults require explicit unused-grant revisions. This is unrelated to the
SSH/process freeze. Catalog/version and finite Begin-window validation must precede
issuance; existing enrollment migration remains unimplemented. The question is
answered; the larger grant/source investigation remains open. Independent next
increment: verify cross-process purge ownership, then durable jobs and shared
CLI/web deletion/status. `flock` is installed at /usr/bin/flock; no missing command.

October 21 qualification scope update: the instructor permits csc-sys tests that
do not change the current installation or interrupt exams. The earlier attempt
stopped immediately when systemd-nspawn was missing; after installation by the
operator, version 255 and a resource-bounded disposable-overlay/private-network
shell smoke test passed. Its process/scope exited and neither guest-base nor host
probe remained. The shared authenticated SSH connection and noninteractive sudo
work. These facts do not qualify the full native enforcement or authorize a
deployment, production restart, account/configuration change or consolidation.

Next ordered qualification increment: update the fixture-only Linux harness for
mandatory private staging and zero-clock/one-use fences; run candidate binaries
in a volatile overlay of the existing private guest, with private networking and
an aggregate bounded transient test unit. Preserve the guest base and live host
state/configuration/binaries. Required acceptance: real SSH/PAM/cgroup collection,
handoff/cancellation/restart/hold restoration, private staging before Begin, exact
protected checksums and clean container exit, followed by native race/build and
test-harness regressions. Do not treat old fixture assertions or the smoke test
as evidence that candidate qualification passed. Independently continue confirmed
monitoring tombstone/retention failure investigation and remaining CLI coverage.

Q1 qualification is now complete for its deliberately narrow scope: **39 actual
private-guest assertions pass** (three handoff, two setup and 34 strict main),
including ordinary staging/Begin inode and zero-clock fences, real SSH/PAM/cgroups,
writer termination, protected early finish, original holds, watchdog collection,
failure/restart/explicit repair and exact account restoration. The container
exited and installed binaries/config/host attempt authority plus guest-base
preservation checks passed. Earlier failed fixture runs are recorded honestly in
isolated-native-qualification.md, not counted as passes. All 39 local Python
checks pass; fresh native race/resource/compiler/default-size opt-ins pass (core
105.1s), all three Go-module race checks, static build and vet pass. No production
changes/deployment or command-not-found. Next Q2: kill a real bounded collection
worker while another real synthetic SSH PTY/signed renewal remains healthy;
cross-namespace cleanup and full concurrent sizing remain separate open gates.

Monitoring correctness increment: two failing regressions confirmed deleted
legacy recording resurrection and real purge permission failure escaping
retention/stopping other attempts. All recording paths now obey tombstones;
bounded replay refuses retained orphan bytes. Retention contains per-attempt
failures, startup/interval exceptions are contained/redacted, and durable deletion
records remain for retry. Seven focused regressions, including actual authenticated
HTTP/session/health availability under purge/inventory failure, pass. Full app
suite passes 323/57 (62.2s), typecheck/build and fresh native race/resource/compiler/
default-size opt-ins pass (105.1s); all three Go-module race/static build/vet pass.
Combined 81-check browser qualification is running. No new management capability,
policy change, isolated purge claim or deployment; see monitoring-retention-fixes.md.

Final monitoring correctness qualification: all **81 combined browser checks pass
(10.5m)** with the fixed gateway, including monitoring deletion, real synthetic
SSH, worker failures, browser closure/recovery and seven timezones. App 323/57,
typecheck/build, fresh full native race/resource/compiler/default-size opt-ins
(105.1s), static build/vet and all three Go-module race checks pass. Generated
screenshots are restored. This closes the two confirmed correctness bugs locally,
not complete monitoring management, isolated purge or deployment.

Q1 is local commit f6a4459. Q2 implementation is under separate qualification:
two synthetic guest identities/real PTYs, continuous signed healthy renewals,
exact collector-unit/pidfd SIGKILL, target-only failure/hold/interval checks,
healthy admission/owners/clock fences, explicit byte-verified retry and ordinary
release. The initial peer authorization path and collector-observer fixture
errors were corrected, not counted as passes. A relative-path hypothesis was not
a confirmed product defect. Native product binaries
are unchanged from Q1; no current installation or real identity is modified.

Q2 stopped as instructed when python3 was missing in the fixture's **legacy
minimal student rootfs**, not in the guest OS or csc-sys production environment.
Read-only diagnosis confirms production host_filesystem=true/rootfs=/ and Python
present; the old guest config selected /srv/exam-workspace/rootfs instead. This
was a representative-fixture setup mistake, not a missing production dependency
or a request for the operator to install individual tools. On resumption, prepare
only the disposable overlay with normal-filesystem mode, private endpoint masks,
same-root public-command inventory and read-only real homes before repeating Q2
and the enforcement profile. Keep the original guest base/host untouched. Prior
Q1 legacy-rootfs evidence remains valid only for its documented narrow scope;
normal-filesystem qualification and real worker-death results remain pending.

Q2 final local/test-host qualification now passes: the disposable overlay uses
normal-filesystem mode, not the old minimal rootfs. All 11 crash/healthy-PTY/
private-filesystem assertions pass with 629 same-root public commands, Python
SSL/SQLite/ctypes, read-only root/home, hidden endpoints and zero capabilities.
A real collector SIGKILL affects only its target; explicit retry protects all
40 MiB of original random files, and both accounts retain their original holds/
deadlines until normal release. Healthy signed renewals: 23; maximum 0.084501s.
Evidence: /var/tmp/ssh-exam-overlay-ld_bqclt. Full enforcement repeat in normal
mode passes all 39 assertions; evidence: /var/tmp/ssh-exam-overlay-6e8srork.
Both containers exited and all installed binary/config/host-authority/base
preservation checks passed. Forty local Python tests pass. Native product is
unchanged from Q1 (7fdad62 artifact); these are fixture improvements, not deployed
software. This closes the narrow real worker-death/healthy privileged PTY gate;
cross-namespace cleanup, saved-source/every-boundary recovery and concurrent
default-size capacity remain open. No missing command occurred after resumption.

C1g ordered management increment: first add shared bounded monitoring summary,
append-order frame/terminal metadata pages and terminal replay to web/root CLI.
Private replies must never be persisted in permanent management outcomes; retain
only scoped metadata receipts and recheck tombstones on every initial/retried
read. Fence list pagination to an explicit row watermark, validate reply target/
pane/offset before output, and preserve current clocks/holds/submission receipts.
Acceptance: actual compiled CLI/local TLS/restart/deletion and output-file/error
workflows, shared admin/student/CSRF HTTP boundaries, unit bounds/pagination and
privacy regressions, full app/native race/build/browser checks. Whole media export,
shared audited deletion intents and durable bounded OS-worker physical purge are
subsequent increments, not claimed complete by metadata/replay. Existing sync
physical purge remains unchanged in this read milestone; retention fixes remain
e44d20c, not process-isolated/nonblocking purge proof.

Q2 normal-filesystem/healthy-PTY qualification is local commit cb33f24. C1ga now
implements shared web/root monitoring show/list/replay with bounded whitelisted
metadata, append-watermark paging, same-descriptor replay sizes, regular/no-follow/
nonblocking leaf checks and transient metadata-only retry receipts. Every read
rechecks tombstones; signed target/pane/cursor/byte counts are validated before
private CLI output. Explicit 0600 output is one batch, never whole-media export.
The old no-offset web route refuses oversized/partial batches with incremental
guidance. Shared roles/no-store/CSRF and independent clocks/holds/receipts remain.
The first actual CLI test found the native named-operation allowlist omission;
fixed before the passing 16 focused tests. Full app passes **326 tests/58 files
(62.9s)**, including actual compiled CLI/local TLS/restart/deletion/output tests.
Fresh full native race with worker/user-systemd/namespace/CLI/compiler/default-size
opt-ins passes (**107.3s core**); static build/vet, all three Go-module race checks,
typecheck and app/WASM build pass. Browser assets are unchanged from C1f but all
81 combined checks are being repeated against this gateway. See monitoring-cli.md.
No whole-media export/shared deletion/isolated purge completion or deployment is
claimed. No missing command after resumption.

C2 dependency investigation continues during C1ga browser qualification. Source
confirms D1a freezes starter work at preflight, while normal/admin workload mounts
and welcome still resolve mutable Templates/Settings.Template/materials. Fixed-at-
issuance settings require an immutable catalog/all-reader binding before unified
issuance. Removing ordinary_exam_once alone is unsafe; account_busy/original-hold
triggers must remain. Source map, ordered increments and acceptance are recorded
in template-grant-investigation.md. No catalog/grant implementation, migration or
completed investigation is claimed. C2/C5/C7 policy is already approved.

The first C1ga combined browser repeat exposed a timing-dependent fixture issue:
after five actual worker faults, the sixth deliberately fresh sign-in occurred
inside the existing five-attempt/60-second window. Five fault emails and four
successful continuations plus the gateway's pre-identity refusals confirm the
sequence. No crash-isolation/deadline protection was relaxed. The test now waits
for the original window before its sixth sign-in. The related confirmed message
bug is corrected: rate limiting reports the wait/continuing clock rather than
blaming passwords, and audits a bounded rate-limit stage. A real WebSocket
regression checks first-five admission, sixth refusal and post-window eligibility
without credentials/native work. Full qualification will be repeated; the failed
combined run is not reported as passing.

C1gb process-boundary work has started **unwired** in monitoring-purge-process.ts
and monitoring-purge-worker.ts. The parent requires a durable tombstone and permits
one owned child at a time; minimal environment, 32 MiB V8 heap (not hard RSS),
bounded request/reply, timeout, exact reply/exit scope and EOF/owned-child shutdown.
The Linux child pins root/target directory descriptors, only unlinks flat entries,
never follows links/opens FIFO contents or recursively traverses subdirectories,
and redacts IO failures. Initial real process death/heap/hang/protocol/permission/
link/FIFO/retry tests pass. This does **not** remove current synchronous purge:
durable job scheduling/restart claims, all production/lifecycle callers, shared
audited web/CLI deletion intents/status and full healthy-workflow qualification
remain to implement. No new deletion workflow is exposed or deployed by these
internal files. Keep this separate from the frozen C1ga validation/commit.

Final C1ga/message qualification: **all 81 combined browser checks pass together
(10.5m)** on the fresh gateway after fixture pacing. All five worker faults and
recoveries, unaffected healthy SSH, monitoring review/deletion, closure recovery
and seven timezones pass with the five-sign-in limit intact. Full app **327/58
(64.7s)**, actual CLI/TLS/restart/private output/deletion and real WebSocket limit
regressions pass. Native full fresh race/resource/namespace/compiler/default-size
opt-ins pass (107.3s), all three Go modules' race checks, static build/vet,
typecheck and app/WASM build pass. Final FIFO/no-writer replay test also passes.
Unchanged browser assets are index-Clle9fMk.js/index-CHDebkQt.css; generated nine
baseline screenshots are restored. This closes C1ga and the misleading rate-limit
diagnosis locally, not full monitoring export/deletion/purge, grants, retained SSH,
workspace cleanup or deployment. The earlier 80/81 run remains a failed run.

C1ga is local commit d98317c. C1gb1's still-unwired process boundary now passes
five real fault/safe traversal/busy/shutdown tests, typecheck and build. Full
working-tree application repeat passes **332/59 (66.4s)**, including actual CLI/
TLS and these five tests. Its single-child/heap/protocol limits are not hard RSS
or uninterruptible-IO guarantees. Scope and next durable-job/interface acceptance
are in monitoring-purge-isolation.md. The production synchronous purge remains;
do not call C1gb complete. No production work or missing command.

Additional confirmed retention read bug: a synthetic older backup containing
frame/recording/incident metadata and image bytes alongside a retained tombstone
was still served by the legacy media route (failing HTTP regression: 200, expected
410). Legacy full/thumbnail media now checks the ledger before file IO; aggregate
review hides all restored monitoring while retaining the protected manifest.
The regression also preserves independent protected bytes. Sixteen focused actual
CLI/HTTP/unit tests pass, and the full 332/59 app repeat passes. The 28 admin/
monitoring browser checks are running; native implementation/browser assets are
unchanged. This is a read-fence correctness fix, not physical purge completion.

Final restored-orphan follow-up: all 28 monitoring/admin browser checks pass
(2.0m), preserving protected submission review after monitoring deletion. Full
working-tree app 332/59 (66.4s), 16 focused actual CLI/HTTP/unit checks, typecheck/
build and native race compatibility pass (CLI 2.9s; unchanged core cached).
The prior full native uncached 107.3s and combined 81-browser result remain
evidence for their unchanged components, not new installed-host claims. No
schema/policy/deployment change. See monitoring-retention-fixes.md.

C2 identified an issuance-timing choice (subsequently answered: enrollment/import;
see the decision refinement at the top of this record). Originally sent via an
asynchronous question: first ordinary grant at first preflight (recommended,
preserving roster-before-template workflow), enrollment/import (requires version
then), or explicit initial issuance (new required instructor step). Extra grants
remain fixed at explicit authorization in all cases. Existing C1–C8 approvals
remain in force; no routine/local-commit approval is requested. See template-grant-
investigation.md. Independent C1gb purge work continued during the question.

The instructor asked what settings "frozen" meant before answering. Clarified:
a saved settings snapshot, not an SSH/process/filesystem freeze; exam default
edits do not silently change an issued grant, while explicit unused revisions
remain available. Reasked using the 90-to-120-minute example; no issuance-timing
decision is inferred from the clarification. Independent purge work continues.

Final frozen follow-up repeat: all **332 app tests/59 files pass** after strict
worker field validation and independent asynchronous removal verification, with
the focused five process tests also passing all wrong/extra/forged-success,
death/heap/hang/permission and shutdown variants. Typecheck/build and 28 admin/
monitoring browser checks pass; native race compatibility passes (unchanged core
cached). These are local milestones only, with synchronous production purge still
unmodified and deployment/consolidation unexecuted.

## Baseline and method

The working tree was clean when work resumed. TODO.md and design.md have been
read, along with the recovery, native cleanup incident, deployment and operator
guidance. No applicable AGENTS.md was found. Implementation inspection confirms
that alert coalescing, the deadline/renewal race, NULL-contact housekeeping,
recovery metadata restoration and CLI discoverability still need work.

Local baseline: typecheck/build pass, 278 unit/integration tests pass, race tests
pass in all three Go modules, and 28 selected Chromium tests pass. Tests use
synthetic local fixtures only. Loopback and dependency downloads require sandbox
escalation. Generated screenshot changes must not become product changes.

## Dependency-ordered milestones

| Milestone | Dependencies | Acceptance criteria and required verification | Status |
| --- | --- | --- | --- |
| M0: inventory and proposals | baseline | Map web/native/incident operations to CLI; map attempt/initialization/lock boundaries; present decisions with migration and acceptance cases | Investigating |
| M1: durable alert episodes and notification correctness | baseline + approved C1 | Distinct attempts/causes never merge; unchanged failures deduplicate after delivery/retry/restart; resolution/recurrence and manual web/CLI reminders work; review requests remain audited; editor lock-only omissions are silent; actionable status/context. Regression, actual CLI/TLS/SMTP/browser, native race/build | Implemented/tested locally, including explicit manual reminders; not deployed |
| M2: renewal races and preparation housekeeping | M1 | Normal expiry has no new interruption; intentional actions survive delayed renewal results; stale replies cannot affect replacement ownership; never-contacted reservations do not generate cleanup; uncertain committed starts retained. Real WS/callback regressions and full integration suite | Implemented/tested locally; not deployed |
| M3: recovery restoration correctness | M0 source review | Preserve archived ordinary modes and mtimes safely; document absent metadata; test restrictive umask, nested files, make, failure/crash fences and other healthy attempts. Native race suite/build | Metadata and publication restart fences tested locally; full crash repair investigation open |
| M4: supported CLI workflows | M0 authority proposal | Ship coherent help/error improvements now; add full web-owned management only after authority/authentication decision. Exercise actual CLI help, refusals, local recovery and idempotency; native race/build and HTTP tests | Existing native help/refusals/export tested locally; C1/C2 approved, management/grant implementation and qualification pending |
| C1a: root-agent management foundation | approved C1 | Explicit named authorization/purpose/audience; persistent replay/idempotency across restart; root-machine audit and pinned HTTPS replies; actual examctl/gateway list/show workflows, help/refusals and no native/student mutation | Implemented/tested locally; mutations/full coverage and deployment pending |
| C1b: shared definition configuration | C1a | Shared web/CLI create/update for every definition field, stale/missing revision refusal, partial preservation, durable web/root retry and historical immutability; actual CLI/HTTP/browser/build/native race tests | Implemented/tested locally; not deployed |
| C1c: roster/CSV management parity | C1b | Shared web/CLI list/add/remove/settings, CSV preview/confirm/example/export; same inheritance, sandbox, UID-verification, active-snapshot, stale-preview/idempotency rules; actual CLI/HTTP/browser/race/build tests | Implemented/tested locally: 302 application tests, native race/build/typecheck/vet, 28 browser roster/interface/SSH checks; not deployed |
| C1e: attempts and current clocks | C1a + existing clock policy | Shared atomic staging, bounded private-safe inspection, single/bulk/reset-default workflows, exact amount/revision/child retry fences, honest pending/native status; compiled CLI/TLS/HTTP/browser/race/build | Implemented/tested locally: 313 app tests, all three Go-module race checks, static build/vet/typecheck/build, 46 admin/alert/definition/timezone and 28 interface/real synthetic SSH browser checks; not deployed |
| C1f: interruption review and authorization | C1a + current continuation policy | Shared generation/review-counter/reason fence, unchanged expiry/SSH/readiness, atomic audit/intent, private retention-safe review, exact retries/pagination; actual CLI/TLS/HTTP/browser/race/build | Implemented/tested locally: 320 app tests, native race/build/vet/typecheck/build and 81 browser checks together; not deployed |
| C1ga: bounded monitoring inspection/replay | C1a + tombstone correctness | Shared web/root summary and watermark pages, bounded complete-event replay, transient receipts, deletion/restart rechecks and validated private outputs; actual CLI/TLS/HTTP/unit/native race/build/browser | Implemented/tested locally: 327 application tests, native race/resource/compiler/default-size opt-ins (107.3s), static build/vet/typecheck/build and all 81 combined browser checks (10.5m). Not deployed |
| C1gb: monitoring deletion/purge parity | C1ga + current retention rules | Shared explicit audited/retry-safe web/root deletion; immediate durable tombstones, separate honest physical status; isolated supervised bounded purge, durable retries, restart/fatal/hang/permission/healthy-session tests; actual CLI/HTTP/browser/build | Durable isolated jobs/shared reviewed deletion/retired-job reads and safe image reads pass locally: 350 app/65 files, 84 browser-SSH checks, real HTTP-SSH faults and compiled CLI-TLS. Full export remains open; not deployed |
| C1gc: complete private monitoring copy | C1ga/C1gb + pinned bounded media | Discoverable named-authorized root image/export workflows, scoped signed bounded stream, exact raw prefixes/tails, no private durable payloads, tombstone/cancel/cleanup fences, private no-replace outputs; actual TLS/CLI/HTTP/SSH failures, native race/build and fresh browser checks | Implemented/tested locally:414 app/79files, full native race/resource/default-size, static/vet/typecheck/build and113 frozen-artifact browser checks; all140 hashes match. Monitoring workflow/purge TODO checked; not deployed or hardware IO/capacity certification |
| C8: definition retirement | C1b + unified grant migration/visibility | Previews, unused-only delete/history archive, no stranded active preparations/unused legacy or unified grants, conflict/retry/browser/native CLI tests | Approved; implementation/qualification pending migration of native-only legacy grants |
| M5: screenshot-first review | baseline | No terminal fetch/play until deliberately opened; screenshot/replay/tab positions survive polling; active/completed browser coverage, no recording/retention change | Implemented/tested locally; not deployed |
| M6: stress, limits and final qualification | M1–M5 | Simultaneous synthetic attempts and failures, documented workload limits; integration/native race/build/browser checks; deployment/migration/rollback plan including all three live agent daemons | Worker/fatal/resource/disk increment tested locally; larger limits, privileged combined qualification and rollout still open |
| M6a: collection process-failure isolation | investigate current native collection; prerequisite to enabling larger limits | Real isolated collection worker death/hang/resource/disk faults leave shared agent/PTYs, healthy monitoring, deadlines and admissions unaffected; durable protected publication/restart and native race/integration checks | Native implementation/fatal/resource/disk/race passes locally; Q2 now passes actual worker SIGKILL with healthy privileged SSH/PTY/admission/renewals in a normal-root disposable guest. Worst-case concurrent workload/initialization/cleanup qualification remains open |
| Q2: representative privileged guest crash/enforcement | M6a + D1a + explicit isolated-host test scope | Normal-root software/private mounts, real root-controlled SSH/PAM/cgroups/watchdog, exact collector pidfd kill, unaffected healthy PTY/admission/owners/clocks, byte-verified retry, ordinary holds/release and unchanged installed host/base | Implemented/tested in cb33f24: 11 crash/private-root assertions plus all 39 enforcement assertions; 40 Python checks. Disposable fixture only, not installation/default-size capacity certification |
| Q5: deferred IO and real editor investigation | Q3/Q4 + isolated-host scope | Real linked IO baselines/confirmed freeze/completion matrix, actual shell/editor buffer and original job-state preservation, unchanged host/base; no inferred all-writer/SSH permission | Investigated, not completed C3: cgroup-only12 cancellations remain RED; separate stop-assisted36 IO cases and ten real Bash/Nano repeats/thirty cycles pass. Consequential signal-policy choice awaiting input; see native-async-io-investigation.md |
| D1: unified attempt grants/workspaces | M0 + instructor decision | Explicit grant policy, source/version freezing, monitoring/start window, 90-minute second attempt, callback/migration/idempotency acceptance cases | C1/C2/C5/C7 approved; implementation, migration, safe source-recovery and crash/race investigation remain open |
| D1a: isolated private preflight staging | M6a + approved C2/C7 | No clock/marker consumption or exposure before Begin; exact source/owner receipt; bounded copy/restore; crash/retry, cancellation/UID/Begin fences and explicit no-reopen repair; native race, SSH/HTTP/browser/build | Implemented/tested locally: 304 app tests, all three Go-module race checks, native resource opt-ins, static build/vet/typecheck/build and 28 browser/SSH checks; unified grants/privileged qualification/deployment remain open |
| D1b: legacy source dependency safety | D1a + preservation policy | Supported read-only native catalog; refuse unused/uncertain/unfinished source deletion; serialize consumption/deletion; preserve all markers/child submissions/history; actual CLI, malformed catalogs/worker replies and race/resource checks | Implemented/tested locally: full native race with worker/systemd/user-namespace/CLI opt-ins, static build/vet and actual root-mapped CLI; migration/C8/privileged deployment gates remain open |
| D1c: immutable template/material versions | D1a + C2 fixed issuance | Supported native catalog/CLI, atomic bounded worker installation, all-reader exact version binding and authenticated metadata visibility; mutation/crash/restart/practice confidentiality/CLI/race/integration tests | C2a2 catalog/publication/CLI, C2a3 optional native readers, C2a4 signed metadata acknowledgement and C2a5 actual system-manager CLI/128MiB guest gate pass locally. Current gateway snapshots remain legacy; issuance/claim/Begin, version-bound guest Begin, legacy migration and full investigation stay open. See template-catalog.md, template-guest-qualification.md and template-grant-investigation.md |
| D2: retained SSH during lockouts | M0 + instructor decision | Writer freeze strategy, shell/buffer survival, native containment and ownership/loss cleanup agreed; current fresh-auth policy remains until coherent implementation/test | C3 approved; source investigation confirms both PTY input bridges need a revocation/queued-input barrier, not just omitted termination. Coordinated implementation and containment/liveness qualification remain open |
| D3: workspace retention and collection limits | M0 + instructor decision | Agree grace/holds/eligibility, CLI dry-run/cleanup and workload limits before deletion/limit policy changes | C4/C6 approved; C6 shared setting/snapshot/collector/restore, default-size worker and full local regression pass in 7ef7ac5; manual cleanup and privileged/concurrent sizing remain open |
| C4a: workspace metadata and operator holds | C4 + D1a fences | Known-attempt inventory, exact private identity, separate durable hold revisions/loss markers, audit failure and stale/busy refusals, no eligibility/deletion claim; actual CLI/native race/build | Implemented/tested locally: actual namespace-root CLI/help, frozen full native race/resource/compiler/default-size opt-ins, static build/vet, 320 app tests and unchanged typechecked/built browser assets. Fresh proof/cleanup remain open; not deployed |

Each implemented milestone gets documentation, focused regressions, proportional
integration/build/race/browser checks, then a coherent local commit. Never label
an investigation finished solely because a proposal exists. TODO checkboxes only
mean implemented and tested locally when explicitly qualified; deployed status is
separate and remains **not deployed** throughout this work.

## Current native increment (October 21)

M1/C1d is local commit a2aa155; C1e is local commit d23aa9a. C1e plan (existing C1 authority and existing
clock semantics, no new policy approval needed): add bounded/redacted gateway
attempt and clock-intent inspection plus supported individual/bulk root clock
workflows. Extract synchronous ClockControl staging shared by browser/root; never
await native SSH/health/network inside management SQLite transactions. Persist
exact revision/request identities, preserve original intervals/access holds and
refuse completed/expired/protected attempts. Root acknowledgements must distinguish
gateway acceptance from pending versus native-confirmed application; fresh reads
and native info diagnose lost replies. Bulk retries keep each child request ID and
report partial failures without silently adding minutes twice. Existing signed
SSH heartbeat/deadline-timing delivery remains the only native control path.
Acceptance: compiled CLI/local TLS create/read/reset/extend/default-batch and
restart/partial-conflict tests; shared HTTP/browser workflows; no page/session/
monitoring payload in persistent management reads; unchanged native deadlines,
holds, SSH ownership and failure isolation; full app/race/build/browser checks.
This increment is implemented/tested locally, not deployed; evidence follows.

C1e source/tests now implement that plan plus two confirmed clock fences: one
captured acceptance instant prevents eligibility/body timestamps crossing the
old deadline, and default-reset targets carry the allowance reviewed in the web
dialog/CLI preview. A changed default refuses a new intent; an already-issued
intent retains its old amount on retry after later edits. Old clients missing
reviewed amounts must reload. Native clocks/original holds are unchanged until
authenticated application reports, and no root wait runs inside SQLite.
25 focused app/HTTP/actual compiled CLI-to-TLS tests pass; helper reports are
explicitly synthetic, including signed callback/timing application, not privileged
host-root/PAM proof. The full application suite passes all 313 tests/55 files,
native race with the worker/namespace/CLI/default-size opt-ins and typecheck pass.
The first browser group passed 45/46: an existing interruption-history test raced
the five-second polling interval against a five-second assertion limit; its error
snapshot already contained the resumed state. Both that check and the new default
refresh check now synchronize on the actual updated dashboard response, then
assert rendered state; runtime polling/enforcement is unchanged. Repeating all
46 browser admin/alert/definition/timezone checks now pass (2.7m). A frozen full
application repeat passes 313 tests/55 files (61.7s); native full race with all
worker/systemd/namespace/compiler/default-size opt-ins, static build/vet and
typecheck/build pass. All 28 interface/real synthetic SSH browser checks also pass
(3.8m), including active resets with live terminals and preserved original holds.
All three Go-module race checks pass. Generated screenshots are restored, not
product changes. C1e is locally qualified; unified grants/freeze/cleanup and full
management remain open. No deployment or command-not-found.
See attempt-clock-management.md. No deployment.

Next C1f investigation confirms that the existing authorize endpoint accepts an
empty body and reads the current generation at submission, rather than fencing
the interruption the instructor reviewed. Additional reasons/student requests
can also change while a lock keeps the same generation. Plan: a shared bounded
review/authorization service, exact generation plus monotonic review revision,
audited reason and durable retry with the original five-minute/deadline expiry.
New reason/review/authorization/state changes must invalidate stale review, never
silently authorize the replacement; retries cannot extend/replace permission.
For private CLI review, persist only scoped metadata receipts in management
outcomes. Re-read bounded current history after authorization checks, refuse a
changed receipt/tombstone, and never replay deleted student text from a cache.
No new listener, native control path or relaxed monitoring/SSH policy. Acceptance:
actual root CLI/TLS/restart/retention workflows, HTTP authority and same-generation
change/expiry/rollback tests, browser confirmation/lost-reply/stale/mobile checks,
full app/native race/build/typecheck and browser interface/SSH qualification.
This is implementation planning, not a completed investigation or deployed fix.

C1f now implements the shared review/authorization service, migration 016's
conditional monotonic counters and successful intent ledger, CLI help/workflows
and fixed-selection browser confirmation. Private read outcomes persist only a
metadata receipt; fresh/retried reads enforce tombstones/current revision before
returning bounded text. Pagination also binds the first page's review counter.
Deliberately renewed approvals remain supported; exact retries cannot renew or
overwrite them. Existing fresh SSH/monitoring Continue policy remains unchanged.
20 focused unit/HTTP/actual compiled CLI-to-TLS tests pass, including restart and
deleted-history replay refusal. Initial fixture failures (missing UUID import,
synthetic locked records lacking history before a restart snapshot) were fixed
without weakening assertions. Native process help found a missing explicit
"transient" explanation; help now names it and native CLI race passes. Four
focused browser deliberate/lost-reply/stale/mobile checks pass. The first mobile
screenshot exposed a dense/default fieldset and low-contrast hover; the scoped
confirmation is now compact/styled, with errors next to the input and a readable
hover. The full application repeat passes 320 tests/56 files (62.1s); two initial
test assumptions were corrected: generation changes intentionally advance review
counters, and each incident needs a distinct generation. Assertions still verify
that alert handling changes no attempt authority/counter by itself. All 49 admin/
alert/definition/timezone browser checks pass (3.1m). Native full race with the
worker/systemd/namespace/compiler/default-size opt-ins, static build/vet and
typecheck/build pass. The extended 32 interface/real synthetic SSH/worker-fault/
browser-abandonment checks are running; the five-recovery healthy-sibling fault
workflow and actual browser-close/reload recovery already pass. See
interruption-management.md; implementation is not yet marked fully qualified or
deployed. No production changes or command-not-found.

The first combined 32-check run exposed fixture isolation, not an admission bug:
fault tests deliberately left student08/09 paused/held, and browser-closure tests
left student06/07 held; later interface cases reused those synthetic identities.
Correct global UID restrictions refused the unrelated fresh sign-ins. Three
checks failed; the identified local Playwright process was stopped gracefully
(23 passed, one interrupted, five not run). No production process/exam was
touched. Fault and closure workflows now have distinct fixture-only accounts/
UIDs; no holds, deadlines or enforcement were cleared to make tests pass.
Repeating all 81 selected browser checks together on one fresh isolated fixture
to prove the cross-file workflow, rather than claiming the failed run passed.

Final C1f qualification: **all 81 selected browser checks pass together (10.7m)**
after the fixture identity fix, including all 32 extended interface/real synthetic
SSH/worker-fault/browser-abandonment checks. The combined run preserves every
restriction; no test bypasses held UIDs or clears a protected/history record to
obtain a fresh sign-in. Mobile confirmation screenshots were inspected after the
scoped style/error/contrast fix. Full application repeat passes 320/56; native
full race/resource opt-ins, static build/vet and typecheck/build pass. Matching
gateway/browser/CLI and migration 016 rollback cautions are documented. C1f is
implemented/tested locally, not deployed. Generated baseline screenshots are
restored rather than committed. Full management/grants/retained SSH/manual
cleanup and privileged installed-host qualification remain open.

C1f is local commit 65e3b25. C4 source investigation is now recorded in workspace-retention.md. Confirmed:
finalization retains old work; COMPLETED drops recorded units; existing release
verification can terminate and is not a dry run; saved-work grants depend on the
archive, not old work; WithState is not a rollback transaction and native Audit
is best effort. Proposed ordered increments are safe inventory/holds, isolated
fresh archive/mount/process-use proof, then explicit exact-target crash-retry
cleanup. No cleanup implementation/deletion or completed investigation is claimed.

C4a is now under local implementation/qualification: actual native `workspaces
list/show/hold/release-hold` and process-tested help/syntax, private separately
persisted hold revisions/identity, fsynced operator intent audit, atomic record/
loss-marker publication, malformed/missing metadata refusal and nonblocking
special-file opens. Metadata candidates explicitly remain ineligible/unverified;
no recursive deletion command or worker proof is exposed. Initial focused native
race/actual namespace-root CLI tests pass, including lost/stale control, old
state writers, missing metadata, corruption/links/audit failure and unchanged
saved work/deadlines/access. The full app suite repeats 320/56 (62.2s), including
actual web management CLI/TLS. Full native race with resource/compiler/default-
size/namespace opt-ins and static build/vet are running on the frozen increment.
No C4b/c mount/process-use proof or cleanup completion is claimed; no deployment
or production/student data change and no command-not-found.

Final C4a qualification: frozen full native race passes with worker/user-systemd/
user-namespace/actual CLI/compiler/default-size opt-ins (113.2s), including the
final busy-not-queued and FIFO/missing-marker regressions. Actual root-mapped CLI
tests cover list/show/hold/release, stale/busy/audit failures, old state writers
and missing hold records with unchanged answer bytes and original/current holds.
All three Go-module race checks, static build/vet, typecheck and application/WASM
build pass. Application suite passes 320 tests/56 files (62.2s). This increment
changes no gateway/browser code; built browser asset hashes remain the exact
C1f assets exercised by its combined 81-check run. No fresh browser result is
claimed for C4a. Generated screenshot baselines remain unchanged. Inspection/
hold controls are implemented/tested locally; actual cleanup/eligibility and
privileged installed-host qualification remain open and nothing is deployed.

C6 is local commit 7ef7ac5. M1/C1d alert management now adds shared metadata-only
web/root list/show/test and explicit audited reminders, migration 015, stable
browser request IDs and episode revisions, cancellation of obsolete unsent
reminders and unchanged automatic episode deduplication. Original retries and
exam clocks/holds/continuation do not change. Actual compiled CLI/gateway TLS
workflows pass; browser-authenticated HTTP plus real SMTP rejection/retry/restart
pass after correcting synthetic test ordering and the existing role-refusal
status expectation. Four initial browser lost-reply/stale/mobile checks pass;
an exact outbox lookup workflow is added. All 31 new-alert/definition/admin
browser checks pass (1.6m), as do native race, static build/vet and typecheck.
The added bounded-history regression found that a pending reminder with an older
timestamp could sit outside the displayed ten and be overlooked. Eligibility now
checks all linked pending rows through indexed SQL independently of the bounded
display; the focused regression passes. The frozen full application suite then
passes all 309 tests/54 files (60.6s), including actual CLI/gateway TLS and SMTP
rejection/restart/retry. Final build/typecheck/static native build/vet and native
race CLI suite pass; all three Go-module race checks remain green (unchanged
core/relay/browser modules reuse valid cache from C6 qualification). M1/C1d is
implemented/tested locally. No automatic reminders, deployment or production
changes. Full management and architectural grants/freeze/cleanup remain open.
See alert-management.md. No production changes and no command-not-found.

C6 limits increment after local commit 1874c65 (D1b) now implements explicit
128 MiB/file and 512 MiB total new defaults, shared web/CLI validation, frozen
native snapshots and compatible legacy 32/64 MiB interpretation. No historical
attempt/clock is migrated. Collector/verifier/private starter/saved restore agree;
directory enumeration is bounded before allocation. Defensive nil refusal is
paired with a repaired unsafe-archive fixture so tests still exercise traversal.
The native capability and production gateway admission require matching versions.
Full application suite passes: 306 tests/53 files; typecheck and 40 definition/
admin/seven-timezone browser checks pass. Exact/exceeded logical limits, source/
target mismatch without consumption or false corruption, immutable legacy
settings encoding, historical holds/clocks and custom sandbox limits are covered.

The real 512 MiB high-entropy disk-backed collection/restore passes under unchanged
256 MiB/no-swap/32-task/120-second user-systemd workers: observed collection
15.57s, 27 concurrent healthy signed renewals; restore 19 renewals; maximum
acknowledgement 1.129s, unchanged healthy generation/deadline, exact file hashes,
536,915,257-byte archive and no target interval/legacy-marker consumption. Live
MemoryPeak samples reached 268,435,456 bytes in both workers without OOM. This
includes reclaimable disk page cache and is not unlimited memory/capacity proof.
Two earlier tmpfs runs actually OOM-killed only the worker at that bound; new
production admission refuses known tmpfs/ramfs State/Work storage with preserve/
drained-migration guidance. No existing data is moved/deleted. A slow-renewal test
first included unflushed fixture creation; flushing setup before measurement
corrected that contamination. Test-only RemainAfterExit instrumentation blocked
systemd-run --wait; removed, using live peak samples instead. Do not present those
failed test runs as successful qualification. Separate blocked-lock tests retain
sub-second bounds; the real I/O test requires renewals below three seconds versus
the 15-second execution lease. Full native race/resource/compiler/default-size,
build/vet/static pass. All three Go-module race checks pass; the full native
suite with actual worker/systemd/user-namespace/CLI/compiler/default-size opt-ins
passes in 109.5s. Application/WASM build passes (existing large-bundle warning).
All 28 browser interface/real synthetic SSH checks pass (3.8m), in addition to
the 40 definition/admin/timezone checks. Final capability regression also rejects
an otherwise-ready agent missing only collection-limits-v1. Generated screenshots
are restored, not product edits. This C6 setting/compatibility/default-size
increment is implemented/tested locally; Full
privileged SSH/PAM/PTYS and simultaneous worst-case capacity remain open. See
collection-limits.md. No deployment and no command-not-found.

D1a is local commit b70ff78: private staging now precedes Begin.
Full native race suite with opt-ins passes, including actual child death and
resource/runtime failure/retry. Focused tests cover source immutability/metadata,
cancellation/owner/settings/expiry, signed Begin freshness, UID admission fencing
and no-reopen publication repair. Actual synthetic SSH/gateway regressions cover
lost staging replies and replaced-page Begin. All 304 app tests/52 files pass;
the first full run caught an outdated readiness fixture, corrected with a new
old-agent fail-closed assertion before rerunning. Static build/vet/typecheck and
application build pass. All 28 browser/interface/real synthetic SSH checks pass
(3.6m), including required staging in the fixture before Begin. Final native race
suite with opt-ins passes again after corrupt-source and healthy signed-monitoring
resource regressions. All three Go-module race checks pass. Generated screenshots
were restored to baseline, not committed as product changes. See
private-workspace-staging.md. Unified grants, legacy migration/source dependency
fences, raised limits, retained SSH and complete management remain actionable.
Nothing deployed; no command-not-found has occurred.

D1b in progress: confirmed native source-deletion dependency gap now has bounded
read-only `recovery-grants` inspection and isolated deletion checks. Unused,
uncertain and unfinished saved-work dependencies refuse; completed consumed
history remains immutable and does not force retaining sources forever. Actual
staging/Begin/collection/deletion, child/source/history preservation, malformed/
unsafe/uncertain metadata, worker-protocol refusal and catalog/Begin locks pass
focused regressions. The real root-mapped CLI lists/filters without state writes
and gives actionable held-source refusal. Full native race/resource/CLI suite
passes (35.5s), as do CGO-free build/vet and diff checks. Application/browser
evidence is unchanged from b70ff78; this increment changes no web/Node behavior.
Existing manual root issuers must be quiesced; catalog inspection
does not complete unified authority/migration or enable C8 retirement. See
legacy-recovery-dependencies.md. No production changes.

C8/deployment scope recorded in local commit 807d3af. M6a now implements separate
bounded OS workers, persistent per-attempt/slot locks, short fenced protection/
completion commits and isolated manifest/export/access verification. Healthy
signed renewals/admissions/registration and ordinary state inspection remain
available during fatal/hung collection. Real child panic/exit/SIGKILL, malformed
replies, address-space/file limits, publication-before-state and protected-before-
cleanup death/retry pass. Actual local user-systemd OOM/runtime and isolated tmpfs
ENOSPC/read-only plus unprivileged permission faults pass; source/holds survive
and retry completes. One failed cutoff no longer suppresses other collections.
See collection-worker-isolation.md for architecture, commands and honest limits.

Full native race suite with both opt-ins passes; application 296/50 unit/integration
tests, typecheck/build, native CGO-free build/vet and other Go-module race checks
pass. All 52 Chromium admin/interface/real synthetic SSH-cleanup tests pass (5.1m);
generated screenshots were restored to their clean baseline. No missing command
has occurred. User-systemd and user namespaces are available; local Docker daemon
is absent and sudo requires a password. Do not infer installed root/PAM/real PTY
qualification from test writer hooks. Continue approved independent work while
privileged qualification remains a rollout gate. No production contact/cutover,
workspace deletion, archive limit increase or service consolidation has occurred.

Local commit 2891567 records that worker increment. C1a now adds default-deny
named root-agent HTTPS management, purpose/audience/freshness, persistent request/
nonce records (migration 013), machine-root audit and pinned signed responses.
`examctl web exams list/show` is tested through the actual compiled CLI and real
gateway via isolated local TLS, including restart-safe same-ID retry, refreshed
reads and authorization revocation. No native state or student attempt is created.
All 300 application tests / 51 files pass with the namespace interface opt-in;
full native race checks pass with worker/systemd/user-namespace/CLI opt-ins,
plus build/typecheck/vet/static build. See agent-management.md. This is a read-only
foundation, not full management. Browser 52/52 evidence above is the preceding
worker milestone; no new browser UI changed in C1a. Continue shared definition
mutations/retirement and remaining approved increments; no production contact.

C1a is local commit 6cd9a1e. C1b: a shared definition reader/writer replaces
browser upsert. Flag-driven `web exams create/update` supports every current
definition field, explicit RFC3339 windows, conditional revision and partial
patches that preserve omitted settings. Browser forms retain request IDs on lost
replies; migration 014 stores successful browser definition intents. Historical
attempt settings/deadlines/holds are not changed. All 301 application tests / 51
files pass with actual compiled CLI/gateway TLS create/update/restart coverage;
all 40 browser retry/conflict, admin and seven-timezone checks pass, as do full
native race checks with opt-ins, build/typecheck/vet/static build. No production
deployment is implied; see exam-definition-management.md.
Local commit f208a4c records C1b. Next: extract roster/CSV services without
weakening unresolved UID=0 (only trusted student SSH resolves identity), explicit
inheritance, sandbox duration, preview conflict/consumption and history/snapshot
preservation. Parse large CSV outside management SQLite transactions; do not
introduce a generic admin-route proxy. Further clock/review/alert/monitoring/admin/
template/config workflows remain in the coverage inventory. Do not persist fast
plaintext-password fingerprints when later adding administrator credential
operations; design their secret handling before implementation.

C1c: RosterManagement now owns web/root roster/CSV operations;
`web students` exposes every current workflow with inheritance/minute units,
named removal confirmation, bounded file/stdin preview, confirm, pagination and
exclusive private CSV outputs. Pure async CSV parsing runs outside SQLite; the
management transaction repeats authorization/freshness before publication.
Request/reply bounds now cover the existing 10 MiB import workflow (12 MiB signed
requests, 16 MiB reply envelopes). Already-consumed previews confirm idempotently
even after expiry; unused expired previews still refuse. Root validation receipts
omit raw invalid-username values while preserving row/reason; browser diagnostics
remain compatible. Actual compiled CLI/gateway tests cover all roster operations,
verified UID preservation/no trust in caller-supplied UIDs, active snapshots, stale imports,
atomic failed batches, safe outputs and restart/idempotency. All 302/51 application
tests pass and native race/build/typecheck/vet pass; all 28 browser roster/
interface/SSH-cleanup checks pass. Generated screenshots were restored. See
roster-cli.md; no production changes occurred.
Source review found legacy recovery grants only in root native JSON, invisible
to a gateway-only archive check. Complete their unified migration/visibility
before claiming C8 can retire definitions without stranding unused grants.

Deployment access check: only non-mutating SSH service-status inspection was
attempted. The configured csc-sys jump route timed out during banner exchange;
one direct-route attempt also timed out on port 22. No authenticated remote
session, service/configuration change or student-record access occurred. Local
SSH config was inspected without printing key/proxy-command contents. Do not
claim deployment access verified, change host-key policy or repeatedly retry
credentials. Continue independent local work; a functioning route is a rollout
prerequisite. Browser assets must finish building before starting the static
test server: the first C1b run's two new tests saw an old bundle; both pass with
a fresh server/current build, and the full 40-test group passes.

## Decision log

Approved C1 (October 20): root-run examctl on the class server reuses existing
agent authentication for outbound management, with explicit authorization and
auditing. This replaces the earlier browser-session recommendation. It is not
fully implemented or deployed yet; the later C1a entry records the tested read-only
foundation. Human attribution is not inferred from a root/agent
signature. See todo-design-decisions.md for required shared validation and replay/
idempotency/conflict safeguards. Local commits remain authorized without further
approval requests.

Approved C2 (October 20): unified grants with settings fixed at issuance and
explicit audited revisions for unused grants. Stage verified sources privately
before Begin, consume once with the new committed interval, preserve default
single-attempt policy/history/holds, and safely fence revisions against preparation
and Begin. This is an approved design, not implementation/migration/deployment.
Webcam/start-window policy is approved separately in C5; C7 selects explicit new
attempts for crash recovery rather than automatic refunds/old-attempt reopening.

Approved C3 (October 21): retain authenticated SSH and preserve shells/editor
buffers through a verified workload freeze during policy lockouts. Input/channels/
background writes remain forbidden; only current readiness and valid scoped
continuation authorization permit thaw. Keep the running clock, independent
deadline collection, focus grace and credential cleanup. Separate locked-page
liveness from execution permission; actual ownership/transport loss may require
fresh SSH. Failed freeze stays fail closed. This is not implemented or deployed.

Approved C4 (October 21): manual workspace cleanup with no grace period; no
automatic deletion. Retain verification, writer/mount/use/dependency checks,
explicit holds, dry-run, exact-target concurrency fences and audit. Preserve all
protected submissions/history/grants, account restrictions/deadlines and separate
monitoring retention. The earlier 14-day recommendation is superseded. No cleanup
has been implemented or performed.

Approved C5 (October 21): new grants preserve the student's current effective
webcam requirement unless explicitly overridden, and require an explicit finite
Begin window fixed at issuance. An extra-attempt window may be outside the exam's
default window; do not intersect windows or reopen ordinary admissions. All
admission/Begin layers must honor the selected grant, while preserving account
holds. Latest Begin is not latest finish and does not shorten a started interval.
No existing production windows, webcam snapshots or records were changed.
Implementation/migration and interface/native regressions remain outstanding.

Approved C6 (October 21): configurable per-exam collection defaults of 128 MiB/file
and 512 MiB total, retaining 10,000 entries/depth 32. Explicit mandatory acceptance:
a collection crash/hang must not crash the shared agent, disrupt healthy PTY/SSH
ownership or lock out other students. Implement supervised bounded per-attempt OS
workers and short fenced state commits; preserve independent renewals/cutoff and
all writer/protection/access checks. Test actual fatal worker/resource/disk/hang
failures with another active attempt and admission/reconnect, not only returned
errors. The instructor's reported earlier crash is recorded as motivation, not an
unverified diagnosis. Code/limits are not changed or deployed by this approval.

Approved C7 (October 21): outage recovery uses explicitly authorized new attempts
from verified saved work, with an instructor-chosen allowance. No automatic
refunds or reopening completed attempts. Secure old saved work first if collection
failed; otherwise use the existing immutable protected snapshot. Copy into a
separate workspace, preserve all original history/markers and prior account holds,
and start the new allowance only at Begin. Existing ordinary manual clock controls
remain available but are not a separate crash repair/refund system. Technical
source recovery still needs implementation and failure tests; no records changed.

Approved C8 (October 21): delete only unused exam definitions; archive definitions
with history while preserving attempts/submissions and distinct retention rules.
All eight choices are approved and implementation is resumed. See
todo-design-decisions.md. Actual workload/storage, source-recovery
and privileged crash qualification remain open; approval is not implementation/
test evidence.

Implementation order update: investigate/isolate native collection failure before
enabling higher collection ceilings. CLI authentication/shared management work can
proceed independently; larger workloads must not amplify the unresolved crash/
shared-lock failure domain. Current implementation order: M6a process-isolated
collection/short transactions; C6 compatible limits and C4 manual cleanup; C1
shared authenticated management; C2/C5/C7 grants/private initialization and C8
retirement; C3 coordinated retained SSH/UI; full qualification and safe rollout.

## Verification and commits

M1 local evidence: all 282 unit/integration tests pass (48 files), including
real local SMTP rejection/retry across application restart, duplicate review
requests, fourteen repeated secured-submission failure callbacks, omission
filtering, distinct causes/students/generations and resolution/recurrence.
Typecheck and application/WASM build pass. The earlier targeted run caught a
legacy pending-report dedup regression; fixed before the full passing run.
Migration 012 is additive. See alert-episodes.md for SMTP's acceptance/commit
boundary and the explicit reminder capability still pending C1.

M0 source map and concrete proposals are in todo-design-decisions.md. Four
questions (C1–C4) were initially presented without assuming approval. All four
are now approved as recorded above, as are C5–C8; implementation/investigation
remain open.
No production access or deployment performed. Verification entries below describe
the decisions and implementation state at their original milestones.

Local commit f9f2232 records M1 and the plan/proposals. M2 evidence: 294 tests
pass (50 files); typecheck/build and full native race suite pass. Real SSH →
worker IPC → monitoring WS regressions cover deadline, administrator pause/finish
and genuine failure. Additional fences cover seven owner/revision changes; native
tests cover authenticated rejection state and refused started cancellation.
Housekeeping tests cover restart and uncertain activation. See
renewal-cleanup-correctness.md for mixed-version rollout/rollback behavior.

Local commit a6eecf5 records M2. M3 metadata/restart regressions pass in the full
native race suite. Recovery preserves available regular-file metadata under 0077
umask; real make/PAX/legacy tests and unchanged-source checks pass. Publication
restart fences preserve clocks, consumption and later student edits. The larger
initialization/repair transaction and every-boundary process-death/ENOSPC tests
remain explicitly incomplete, pending C1/C2. See recovery-metadata.md.

Local commit 09880d7 records M3. M4 native race suite passes, including real CLI
subprocess help/usage checks for all current commands and immutable, durably
audited protected exports with audit-write failure. Full web-owned management,
explicit alert escalation and recovery grant/repair workflows remain C1/C2
dependent; no claim of complete CLI coverage is made.

Local commit a3f87df records M4. M5 typecheck/build and 52 Chromium checks pass
(admin redesign, real browser SSH interface and SSH cleanup suites). Tests cover
active/completed screenshot-first review, zero unrequested replay reads, tab/pane/
slider retention, close/reopen, incremental refresh and network recovery. Generated
documentation screenshots are excluded from the implementation commit. See
review-on-demand.md; no recording/retention/security policy changed.

Local commit 97a2c6c records M5. M6 adds a 16-attempt native concurrency regression
with real protected archive IO, blocked/refused termination, independent renewal/
cutoff and delayed signed TLS callbacks. Full native race checks and opt-in real
GCC workload measurements pass. The corrected local load harness passes with 16
ACTIVE synthetic students, 64 panes, 89 heartbeat acknowledgements, zero pending
and zero errors. It now exits unsuccessfully on missing admissions/acknowledgements;
the first run exposed a stale fixture rather than a production identity bug.
See todo-local-qualification.md for exact observations and remaining shared-lock/
privileged qualification gaps. todo-rollout-plan.md proposes additive migration,
controlled verification, all-three-daemon consolidation and compatible rollback;
none has been executed.

Final M1 follow-up: policy/access alert context now uses current authenticated
state and distinguishes reported from gateway-verified protection. Preflight,
worker and host-key diagnostics have observed timezone/identity and safe next
steps; untrusted reasons are quoted. New signed HTTP and real SSH regressions
pass. One focused test initially mislabeled a reported hostname as a host role;
the label/assertion were corrected, then all 296 tests in 50 files passed.
Final typecheck, gateway/WASM build, native static build/vet, three-module race
checks and the separate compiler measurement pass. The 52-test browser result
covers the unchanged final review implementation. No command was found missing.

Checkpoint: further unified-grant/full management/retained-SSH/cleanup policy
implementation now has C1–C8 approval, recorded in
todo-design-decisions.md. Shared-lock isolation,
every-boundary recovery repair and actual course workload sizing remain open;
proposals and synthetic measurements are not completion evidence for them.

## Proposed rollout boundary

Separate instructor authorization and a verified maintenance/drain window are
required. Back up current authoritative state, timing requests, per-UID policy
journals, signed event/nonce state, recovery grants/consumption markers, protected
archives and receipts. Do not roll back by restoring old state over new work.
Consolidate the canonical agent plus exam-agent-live-upgrade and
exam-agent-deferred-recovery only after active attempts, actual preflights,
pending timing and collection/access recovery drain. Preserve the independent
watchdog/reconciler; verify socket ownership, callbacks, capabilities and boot.
Detailed rollout/rollback instructions will follow the validated local changes.
