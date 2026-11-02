# Direct next-attempt editing

November 2, 2026. Implemented and tested locally; no push or deployment.
Validated source: backend/native/CLI `51b311c`; interface/browser `e950b6a`.

The requested workflow is the instructor's exam table: click the printed webcam,
time limit or start dates to edit only that field in place. Save actually saves;
Cancel discards the draft. Starting files has its own column and opens a small
current-source picker. Remove the full Edit settings button and student Actions
menu. Use accessible 44px camera/plus/bin buttons; camera states are Required/Off.
The existing student capture and server enforcement already turn camera off when
false. No new camera policy or optional student recording is introduced.

Prof's source review agrees on this layout, stacked labelled fields on mobile,
one cancellation confirmation, no hidden advanced attempt settings and at most
two dialog states for files, creation or bulk changes. Rendered 320/430/1280px
checks pass for expanded editors, files, cancellation, focus and 44px targets;
Prof accepted the actual images. Repeated timezone/window text is removed, and
the files-only picker shows a wrapped filename when its sole published choice
exactly matches the saved version. A different version remains an explicit choice.

Dependency-ordered milestones:

1. Table cells, files picker, compact cancellation and student plus/bin actions.
   Reuse the existing fresh-revision, claim, exact-request retry and persisted
   outcome machinery. A claimed/pending permission also hides the plus. Preserve
   recovery of unknown saves even if the next-attempt row disappears. Bulk Add
   skips existing next attempts; bulk editing offers only time/webcam/dates/files.
   Test actual clicks, field prefills, no-op/exact seconds/DST, stale claims,
   lost replies/reload and320/430/1280px keyboard/mobile behavior.
2. Shared terminals, collection limits and exam materials belong to Exam settings.
   New attempts take shared fields from the current definition; student time and
   webcam accommodations remain local. New per-attempt shared-field edits refuse
   actionably through web and CLI, while identical historical request retries
   retain their durable result. The instructor explicitly requires shared terminal/file limits to apply to ALL
   unopened, setup and running attempts, saved once without a student confirmation
   list. This intentionally replaces the earlier fixed-at-issuance policy for
   these execution limits. Preserve immutable timing/camera/source/grant snapshots;
   use a separately authenticated, versioned exam execution policy. Existing panes
   survive a lower count; new pane/job admission uses current limits. Pin each
   collection job/archive to its actual bounds so later recovery/verification never
   reinterprets protected archives under changed limits.
   Test public HTTP/CLI refusal, inherited current shared settings, old receipt
   replay, source retention, camera-off capture refusal and full start allowance.
3. Read focused results before affected application/realCLI/race/browser checks,
   fresh types/build and rendered Prof review. Update design/operator docs,
   record the matched release requirements and commit coherent local increments.
   No production installation, record changes or service restart is authorized.

Settled deletion policy remains in force: any attempt or permission history keeps
the student in the exam list. Cancelling an unused permission does not make that
student removable; show the student bin only when the server says removable.
Cancelling a next attempt preserves its audit/history and protected work.

Previous locally prepared student-list release `e5e10f3` remains a valid artifact
for that earlier milestone; it does not contain these interface/policy changes.


Live-policy integration is a necessary safety dependency of the new scope, not a
student-by-student revision operation. Reuse existing exam instance/version and
root authenticated outbound HTTPS/signatures, plus existing pane/Finish/timing
channels. No new inbound listener, source-worker purpose or shared secret. Native
policy network/disk I/O must not block monitoring authority. A collection failure
keeps frozen work and account holds without truncation; increasing limits and an
explicit retry starts a new job with current policy. Existing published archives
retain their pinned policy and legacy archives keep their saved-settings meaning.
Matched native capability and actual admission/collection qualification are required
before enablement; no production native/service changes are authorized here.

The instructor's single Save is atomic: an unsupported or unavailable live
agent/watchdog/source-worker cohort refuses before changing settings or metadata.
For an empty exam or one with only completed history, settings can be saved while
the class server is offline. A later attempt still needs fresh authenticated
admission. Current policy is separate from the historical settings displayed in an
attempt's audit record.

If the web service is unavailable, the original deadline and Finish still revoke
execution and freeze work. A NEW collection job waits for verified current limits;
it fails inspectably without losing files or releasing account restrictions.
An explicit retry fetches current limits. A job whose policy was already pinned
may finish under that policy, and a published archive remains verifiable offline.
This availability consequence preserves consistent exam-wide settings without
silently collecting under old limits.

Pending edits and creation requests remain recoverable from the dashboard even
when a successful operation has removed their original row or hidden its plus.
**Resume saved request** reopens only the retained original request for inspection
or exact retry. It cannot turn an invalid/missing cache into a new creation form.

## Verification

The 18-file application cohort passes 166 cases with one existing opt-in skip.
Focused policy HTTP tests and the real SSH/public-WebSocket admission refusal
tests also pass. The latter verifies a concise student error, unchanged sibling
pane/deadline/generation/settings/holds, no incident, and a successful retry.

The initial real-WASM browser cohort passed 49/52. Its first failure omitted an
explicit starter-file selection; the remaining two scenarios then encountered its
unfinished permission. After correction the complete four-scenario workflow
reached a separate HTTP 429: independent scenarios shared an instructor's rate
bucket. Separate synthetic instructors fixed the fixture without relaxing limits;
all four now pass through actual SSH, setup, Start, Finish and saved-work workflows.
All 22 migrated unused-attempt cases pass. Original failures and corrected receipts
are retained. The retired combined-editor scenarios are replaced by field-specific
prefill, no-op, exact-seconds/DST, revision/claim, source and retry checks.

Native whole-core and CLI races pass; the guarded disposable run exposed a real
archive projection defect after passing monitoring, shell preservation and higher-
limit collection. Public manifest serialization stripped the collection job needed
by its policy proof. Both native CLI/callback producers now preserve that archive-
only identity, while ordinary attempt status stays redacted. Actual signed callback
bytes pass the production TypeScript validator; the stripped-job mutation is rejected.
Affected native races and rebuilt artifacts pass. The corrected guarded guest
passes seven actual SSH/monitored-start/pane/collection/deadline assertions plus
healthy, missing, stopped and differently loaded source-worker checks. Its unit
is absent/inactive/dead; the guest base has no live processes or mounts, and host
binaries, configuration and authority data are unchanged. The actual compiled
CLI result also passes the production TypeScript validator.

Final qualification uses the rebuilt WASM: all 72 affected administration, real SSH,
initial Start/Finish, saved-work, import and sandbox workflows pass. The focused
16-case predecessor also passes. Full fixture typechecking and the complete npm
production build pass. The final browser receipt verifies 229 unchanged inputs,
its exact fixture process gone and both owned ports closed. Prof accepted the
320/430/1280px renders. All ten pre-existing dirty documentation images are intact.

Primary evidence under `var/collection-tests/`:

- `exam-execution-policy-application.32kx99m2/completion.json`: application cohort.
- `exam-execution-policy-http22.20261102a/completion.json` and
  `student-pane-policy-focused.20261102a/completion.json`: accurate summaries of
  collected tool completions; full stdout was not redirected for these two runs.
- `final-admin-release-browser.20261102a/completion.json`: final 72-case browser run;
  `prof-unused-and-bulk-complete.20261102a` retains the 22 passing unused-editor
  cases and the old bulk uncertainty-oracle failure corrected in the final run.
- `next-cell-prof-accepted.n46v2x8r` and `retry-and-live-focus.i1r_vjvh`: renders,
  exact-version preservation, retained creation requests and live pane hints.
- `execution-policy-native.lyox26l4/completion.json`: native races/build/vet,
  31 Python checks, exact candidate, guarded execution and verified cleanup;
  its `native-policy-ts-validation.json` records actual cross-language evidence.

This completes the implementation milestone. A matched production installation
and recovery/reopening rehearsal is a separate gate; this is not a web-only
release and no production-readiness or deployment claim is made.

## Proposed release and recovery

No deployment is authorized by this development request. After qualification,
freeze a matched web image and all four native executables: `exam-agent`, `examctl`,
`exam-login` and `exam-info`. The loaded agent, watchdog and source-worker must use
that cohort; an older linked state writer must not remain installed. Keep the
relay and the existing consolidated service arrangement unchanged. Qualify the complete startup/poll-expiry, installation, backups,
preservation, recovery and reopening procedure before calling it release ready.

Use the existing maintenance page/admission fence, require zero sessions and a
full native exam drain, and take a fresh database/small-file backup using verified
existing media coverage. Do not copy recordings again. Stop only the drained
owned services, install the matched cohort, restart it, and verify loaded role
identity plus capability before reopening. Do not modify existing grants, clocks,
deadlines, archives, student records or account holds to pass the guard. This
change adds native policy/job metadata and optional manifest metadata, not a new
web database schema or a per-student migration.

Older writers do not enforce the new shared policy. Recovery must retain CURRENT
records and protected files behind the fence; prefer the rehearsed compatible
forward repair. Do not reopen an older writer or restore a stale database to make
the new checks disappear. A rollback is safe only if the exact matched recovery
cohort has been qualified with the current policy and archive metadata.
