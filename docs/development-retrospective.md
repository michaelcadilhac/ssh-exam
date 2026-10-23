# Development retrospective — October 22, 2026

The instructor asked why roughly two days of work had not finished a backlog
that initially looked small. The expanded TODO then had 11 checked main items
out of 38. That count is neither the original scope nor a percentage of effort.
Useful fixes were made, but the critical monitoring/retained-SSH workflow and
unified grants were not integrated. No deployment was performed.

## What happened

Real fault tests uncovered shared-state blocking, unsafe recovery metadata and
partial one-use markers under disk failure. These warranted fixes. Preserving
shell/editor state also exposed a real compatibility problem: ordinary freezing
could cancel outstanding linked asynchronous writes. Safety investigation was
necessary; neither skipping it nor merely extending timeouts is acceptable.

Execution nevertheless drifted into an expanding prerequisite tree. The renewal
authority, process lifetime/identity checks, input adapters and workload readers
were developed and qualified in separate increments without their live runtime
integration. Recent commits 90f2c54, d1b26d1 and 1630456 exemplify useful but
unwired groundwork. Repeated broad suites qualified components while the central
workflow remained unfinished. Recent native suites took about five minutes and
application suites about a minute and a half per cycle; unchanged browser inputs
were repeatedly compared. Testing overhead contributed, but does not alone
explain the elapsed time. Excessive decomposition, investigation and duplicated
checkpoint prose were the larger process problems.

Passing component tests and numerous commits were incorrectly allowed to stand
in for progress toward a usable outcome. The remedy is better integration and
milestone boundaries, not lower safety standards or misleading TODO checkmarks.

## Operating changes

C8 follow-up October23: an oversized combined read truncated the operator
document's native-only recovery-grant caveat. The initial state review therefore
covered gateway dependencies but missed legacy authority. Catching it after a
broad launch required another full application run and delayed delivery. The
bounded repair is a conservative migration fence: every pre-existing definition
refuses retirement until supported native reconciliation; newly tracked definitions
use the integrated web/CLI workflow. No new synchronization prototype was added.
Treat truncated output as unread evidence and reread only the missing relevant
span before making scope/safety assumptions. Existing grant tests must read the
public revision rather than recreate an old implementation hash. Browser fixtures
should reuse valid sessions instead of exhausting or disabling real login limits.

AGENTS.md now requires one bounded interface-level milestone, named runtime
callers for new components, immediate scope reassessment when prerequisites grow,
focused tests during editing and risk-appropriate broad checks at milestone
boundaries. Consequential choices remain with the instructor; routine details
and authorized local commits do not require questions. Existing approved policy
and all production restrictions remain unchanged.

The already-written hierarchy reader will be closed out using its existing
completed verification, not expanded into another prototype. Subsequent work
must connect to an actual supported workflow. Current status belongs in
todo-current-checkpoint.md; feature documents retain detailed evidence. This
retrospective records a process correction, not completion of the critical fix.

Follow-up during the integrated pane-opening milestone: broad qualification was
started in the same orchestration batch that collected an as-yet-unknown focused
WS result. An invalid synthetic UUID then failed the intended native-error setup
and was also picked up by the broad runner. The fixture was corrected without
relaxing validation; the actual WS oracle passed, and fresh broad qualification
was required. AGENTS.md now makes the sequencing explicit: inspect focused
completion before launching broad suites. A failed setup is never proof of the
behavior under test, and a passing earlier artifact never qualifies a later one.

C12 follow-up: review found the first timed-recorder fallback would transiently
load global state in each per-attempt supervisor. It was removed before broad
qualification. The implementation boundary was narrowed to preflight practice
ownership; timed recording stays unchanged until coordinator-owned event/owner/
restart integration is ready. This is an explicitly incomplete C12, not a new
claim that the critical fix works. Tool churn also exposed duplicated cwd prefixes
and out-of-order patch hunks. AGENTS.md now requires current plain-text context,
consistent paths and ordered per-target patches instead of repeated guessed fixes.

The next timed-recording trace found a confirmed stale asynchronous lock bug.
Its first fencing-only correction also hid current loss because normal cleanup
could retire the proof first; the positive-control regression correctly refused
that candidate. An attempted full IO join then grew into legacy blocking-input/
backpressure lifecycle work. That extra lifecycle change was withdrawn, not
declared qualified from its narrow success. The fix joins only a fault already
observed before PTY closure, outside shared state, and tests both stale and current
outcomes. Keep the fault fix separate from the next complete timed-owner lifecycle;
do not let every neighboring cleanup issue become a prerequisite of a bounded fix.

Live-owner diagnostics exposed two test-process errors. Go testing.TempDir's leaf
was not private0700, so the correct reader refused before a mock's unbounded
Accept; only the exact owned runner (no children) was stopped for its stack. The
fixture now sets/asserts private prerequisites, bounds accept/completion and proves
the intended reply was sent. Separately, shell output preceded the parent's
completion-ownership notice; an immediate synthetic kill legitimately produced
UNKNOWN. Tests now observe that exact notice boundary before claiming post-notice
death, while UNKNOWN semantics remain intact. AGENTS.md records these controls;
neither an earlier passing artifact nor an unreached refusal closes the workflow.

The integrated grant work exposed a smaller repeated source of avoidable churn:
calling existing helpers from guessed signatures (session argument order, browser
API body position and a nonexistent standalone React setter), then letting a
label locator wait for the whole long browser workflow timeout. Read the actual
definition/nearby caller before using an existing helper, preserve its composite
state ownership, and bound individual browser actions against observed accessible
roles. AGENTS.md now states this explicitly. Failed setup/locator results remain
recorded and are not counted as product regressions or passes.

The C14 full browser pass also exposed stale shared fixture producers: new
definitions without exact sources, reuse of another test's reserved account and
an unstarted retry that retained its old mocked transport. Inventory producers
alongside consumers when migrating admission contracts; do not test only the
new feature file. A clipboard test additionally raced Modal's asynchronous focus
restoration. Wait for that actual boundary before moving focus and pressing keys.
Global fake UTC across real worker processes was also unsuitable for signed
freshness; use an explicitly controlled release dependency while keeping protocol
UTC real. Corrections retain the failed receipts and preserve enforcement. The
existing AGENTS.md rules already require these controls; applying them before
broad qualification saves repeated suite time.

The additional-grant state review also caught a real authority-proof gap BEFORE
the first broad run: sequence alone could not prove the original initial grant
after missing web history. A two-case missing/foreign-identity control failed;
the integrated protocol now retains that exact initial UUID in native/web lineage.
Keep such positive-evidence reviews before artifact freeze. Finish one integrated
workflow and reuse unchanged matching evidence; do not restart unrelated broad
qualification for a corrected text assertion or expand the next source mechanism
before identifying its real caller, retention races and acceptance boundary.

October23 timed ownership integrated the real gate/recording/report/CLI workflow,
but its first state review was incomplete. Late checks found diagnostic ACKs
invalidating both reviewed closure and final exec release, manual close dropping
acknowledgement before report unlink, and real recorder containment waiting on a
startup notice. Earlier ordinary coordinator-kill and post-start fault tests did
not exercise those blocked protocol boundaries. Broad native runs therefore had
to be repeated for changed artifacts; those earlier passes cannot qualify them.

The correction is to enumerate all writers/forgetters of each proof before freeze,
distinguish immutable authority from receipt diagnostics, and place actual-entry
barriers at readiness/reply/ack transitions. Test faults while those handshakes
are blocked, rather than assuming a post-start fault covers startup. The new
two-case admission test is RED2.417s, then three fixed repetitions PASS3.327s.
Temporary cleanup uncertainty also needed a forced actual-interface retry
(RED1.362s), rather than a broad pass without injected uncertainty. These narrow
tests should have preceded the first six-minute native qualification. AGENTS.md
now makes that missing protocol review explicit. Keep unrelated architecture and
UI expansion deferred; finish the integrated milestone, qualify its frozen source,
then continue the already-approved definition-retirement workflow.

## Registered-owner integration: inspect real process and absence semantics

The initial design assumed Agent.sign ran with Store; production signs inside an
isolated worker constructed without it. Direct signed/unit checks could pass
while actual Chromium Begin omitted the page. The real worker now delegates its
small canonical authorization decisions to the owning parent over bounded IPC.
A second miss used Store.attempt for optional enrichment even though it throws
on absence: native-only recovery/source IDs legitimately have no web row. Six
full-suite recovery failures exposed the regression. Optional lookup now remains
optional; present-account and absent-positive-pane refusal still hold. These real
callers/constructor ownership and missing-ID cases belong in the FIRST source/API
inventory and focused entry tests, not discovery after broad qualification.

Positive admission and negative authenticated replies also need separate tests:
new generation checks hid an intentional LOCKED reason. The actual signed native
regression was RED0.017s before correction. Browser clock tests waited for a window
rather than its native opened ACK, then invalidated a still-pending admission;
awaiting the exact protocol boundary and exercising live command output fixed the
oracle without weakening scope. The continuation fixture likewise had to model
an approved new page instead of demanding the old one. Existing AGENTS.md rules
already require these reviews; follow them rather than adding more generic rules.
Only affected/remaining browser cases were repeated after fixture-only changes;
unchanged full application/native/client evidence was retained with checked hashes.
