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
