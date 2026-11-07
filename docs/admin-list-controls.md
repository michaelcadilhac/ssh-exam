# Admin student list and exam timezone

November6: implementation/push/deployment authorized. No production changes yet.
Milestone1 locally validated:14focused HTTP/presentation checks and4built-browser
workflows pass, including reviewed1360px/390px screenshots. Types/build pass.
The first synthetic pagination fixture attempted to add raw enrollments after
grant issuance, then to invent history for an already-issued unused permission.
Both correctly refused. The fixture now keeps legacy history and new enrollment/
initial-grant issuance distinct; no trigger or enforcement was changed.

Milestone2 is implemented: exam timezone is definition metadata, never a grant
snapshot/hash, clock or native execution setting. Existing exams render in Chicago;
new web exams start with the device zone saved explicitly. All instructor date
entry/display, source choices and review inherit the selected exam zone. Changing
the zone converts form values while preserving their instants; gaps refuse and
repeated hours require a choice. Open attempt-date editors pin their original zone
and refuse changed-date submission if a later poll sees a different exam zone.
The main date banner and redundant dialog banners are removed.

CLI: `examctl web exams update EXAM --revision HASH --timezone America/Chicago`
(or UTC/another valid IANA name), with matching create support, help and strict
scope/bounds/intent validation on signed replies. The first positive TLS test
caught the missing optional field in that reply decoder; it is now validated
without relaxing unknown-field or exact-intent checks.21focused checks, the actual
compiled root/TLS journey, CLI races, and UTC/DST plus cross-instructor editor
browser checks pass. Selector failures were corrected against observed controls:
native combobox roles, the Dates cell and the inline Save button, without changing
product enforcement. Wider seven-zone and application/browser checks remain.

Release scope: registered reviewed-web-cli/exam-dashboard-timezone-v1, schema37.
Only web and the installed examctl change; all four live native/relay role PIDs and
the loaded source-worker binary stay fixed. The existing atomic CLI installer
takes private current metadata/configuration/old-CLI backups. The current-data
forward recovery path is shared with the existing incompatible-reader workflow;
an older writer could discard the new timezone metadata.48operator scenarios pass,
including original-snapshot preservation and already-running-candidate recovery.
No new deploy controller or native authority mechanism. Exact image/startup,
packaged CLI, migration/preservation/proxy and fresh drain gates remain before
push/cutover. Reuse existing media recovery coverage, never replicate recordings.

Bounded delivery plan:

1. Dashboard HTTP and web list: independent All students/Working/Needs attention
   tabs, extra available/paused/webcam filters and latest-completion sorting.
   Select students before pagination, keep their complete history, count students
   in tabs, and reset selection/pagination when controls change. Remove Files saved
   tab. Give Next attempt a blue inset panel, explicit upcoming label/icon and
   dashed separation from muted completed history, including mobile layouts.
   Acceptance: public HTTP pagination/composition/sorting and browser controls,
   selection, history and mobile regression tests.
2. Exam settings: validated IANA timezone, Chicago fallback for existing exams,
   display/entry only. Store outside immutable grant/attempt settings. Update all
   admin date controls and review displays, preserving instants and DST overlap/
   gap handling. Provide matching examctl flag/help and signed interface tests.
   Acceptance: multiple device/exam zones, DST folds/gaps, unchanged grant hashes,
   attempts/deadlines and exact retry/revision behavior; types/build/affected suites.
3. Freeze exact artifacts and qualify the existing same-schema web/CLI release
   workflow, preservation, recovery and reopening. Reuse unchanged native evidence;
   no authority/watchdog/relay mechanism changes. Push/deploy only after the gates,
   with fresh student/unfinished guards and authorized admin-only signout.

Available means an authorized, unused, unexpired next attempt; scheduled future
starts are included, while setup claims and pending saved-work verification are
not. Paused includes both paused work and a paused countdown. These are list
filters only, never new admission or monitoring permission.

Release qualification evidence is in `var/collection-tests/admin-list.20261106/`.
The full application run passed857 cases with one existing opt-in skip and two
old history-filter expectations failing. Both affected files now pass all18 cases
with full matching-student history asserted; backend inputs did not change after
that full run. The broad admin browser run passed163 cases and exposed two mobile
camera-alignment failures plus seven stale/rate-limited timezone fixtures. Mobile
row decoration now uses an inset stripe and outline without changing grid widths;
320/430/1280px checks pass. Timezone fixtures use independent synthetic actors/IPs,
current Webcam: Off wording, and wait for the actual native clock acknowledgement.
No rate limit, clock or monitoring enforcement was relaxed. An accidentally broad
follow-up selected unrelated legacy instructor workflows; its interrupted run is
retained as diagnostic evidence and is not a release pass.

The final runtime is a5a0b07. Exact-image schema37 startup/media compatibility and
the real66.74-second signed-poll startup/current-data recovery test pass, including
41preservation contracts, existing tombstones/due purge rechecks,11 independent
mutation refusals and recovery without another start or snapshot replacement.
The actual nginx maintenance/reload check passed in0.23seconds. The exact packaged
CLI is reused from8615d90: its entire Go tree is unchanged, and root/TLS, native
race and root-mapped atomic replacement/refusal tests pass. All14seven-zone workflows and8exact-final-image browser workflows now pass,
including mobile alignment, full history/late replies and the real WASM student
clock/collection journey.163unchanged broader admin browser passes are retained;
this is explicit full-plus-targeted qualification, not a claimed all-green rerun.
Fresh production guards and guarded deployment remain before declaring ONLINE.
