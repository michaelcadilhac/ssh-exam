# Admin student list and exam timezone

Pushed and deployed November6 at22:56:15Chicago (November7,04:56:15UTC).
Runtimea5a0b07ab8b9f7e56abf6814350d7caee01905ea, schema37, image Config
b36dd649d36f6861e4143c30dfc74244db5a1c2da01153c1f141e01e9ed3c2d5.
No remaining step or policy decision for this request.

## Student list behavior

All students, Working and Needs attention select students first. Independent
available/paused/webcam filters then narrow that subset, followed by username or
most-recent-completion sorting, before100student pagination. Complete history and
stable attempt numbers remain visible for each selected student. Tab counters
count students; changing controls clears stale selection and pagination. Clearing
extra filters retains the chosen tab. The Files saved tab is removed.

Available means an authorized, unused, unexpired next attempt, including scheduled
future starts; setup claims and pending saved-work verification are excluded.
Paused includes paused work and paused countdowns. These list filters create no
admission or monitoring permission. Grant projection is grouped before pagination
without per-student grant lookups; invalid/ambiguous metadata cannot invent usable
permission or crash SQLite JSON extraction.

Next attempt has a blue background/inset stripe, upcoming arrow and dashed
separation. History is quieter. Mobile decoration uses outline/inset shadow so
camera columns stay aligned;1360/390px screenshots and320/430/1280px interactions
were reviewed/tested. Existing documentation images remain unchanged.

## Exam timezone

Validated IANA timezone is exam-definition metadata outside immutable grant and
attempt settings/hashes. Existing exams fall back to Chicago; new website exams
save the device zone explicitly. All instructor date entry/display, source labels
and review use the selected exam zone. Changing the zone preserves saved instants,
original deadlines and settings snapshots. Nonexistent DST times refuse; repeated
hours require a choice. Open date editors pin their zone and refuse reinterpretation
if another instructor changes it. Redundant Dates-in/timezone banners are removed.

CLI parity: `examctl web exams update EXAM --revision HASH --timezone America/Chicago`
(or UTC/another valid IANA name), plus create support, help and strict signed reply
scope/bounds/intent validation. Initial root/TLS qualification caught the missing
optional field in the reply decoder; it now validates timezone without weakening
unknown-field or exact-intent checks. Student clock/transport semantics are fixed.

## Qualification and limitations

Evidence: `var/collection-tests/admin-list.20261106/`.

- Full application run:857pass, two stale history-filter oracles, one existing
  opt-in skip. Corrected full affected cohort18/18 passes;859cases pass across the
  full run plus targeted rerun. No backend input changed after that full run.
- Broad admin browsers:163pass; two mobile alignment failures fixed; seven timezone
  fixtures corrected for Webcam: Off, independent actors/IPs and actual native clock
  acknowledgement. No rate limit or enforcement was relaxed. All14seven-zone and
 8exact-final-image workflows pass, including real WASM start/clock/input/collection,
  full history/late replies, list composition and mobile controls. An accidental
  overbroad follow-up selected unrelated legacy instructor tests; its interrupted
  receipt is retained, not counted as a pass or as qualification of those workflows.
-21focused presentation/HTTP/date checks, actual root/TLS CLI, CLI races,
 48operator workflows, types/build and real nginx maintenance/reload pass.
- Exact final image passes schema37 startup/media compatibility, actual66.74-second
  signed startup, existing tombstone/due purge rechecks,41preservation contracts,
 11mutation refusals and current-data recovery without another start or snapshot
  replacement. Root-mapped atomic CLI replacement/refusals pass. Unchanged native
  authority/kernel roles reuse prior qualification; no new human MFA/media test
  is claimed. The CLI binary is reused from8615d90; its entire Go tree is unchanged.

## Production operation and recovery

Reviewed scope `exam-dashboard-timezone-v1` updates web plus installed CLI only.
All four native service PIDs and the OLD loaded saved-work binary are unchanged.
The atomic CLI install took private current metadata/config/old-CLI backups. Its
final guard refused one unclassified root script process; the process was gone
on independent read-only inspection, so its identity remains unknown. The pending
installation receipt is retained. The qualified independent after-guard then passed,
as did fresh guards before prepare/apply, every15seconds during cutover, and final
installed/loaded-role acceptance. No guard, record or running service was altered
to make it pass.

Online preparation11.43s reused1,065,421,981bytes; no new media copied. Fresh database
backup130,691,072bytes plus350,448bytes of other metadata/configuration were copied.
Maintenance45.48s; apply49.22s. The instruction timestamp was not captured; the
late04:00:46UTC marker to reopening is55m28.44s and excludes earlier development,
so it is not the total instruction duration. One authorized admin-only signout,
zero student sessions invalidated.119web/186native histories remained protected.

Public TLS/nine asset hashes, signed CLI/help, original snapshot and all41contracts
pass. Website ONLINE; recording worker pause RELEASED. Frozen manifest, helpers,
acceptance and completion: `var/collection-tests/admin-list.20261106/final-ops/`.
Remote state: `/data/ssh-exam-admin-list-20261106-8615d90-a1ac8af4-state`.
The namespace retains the earlier candidate label; image/source pins binda5a0b07.
An older metadata writer could discard timezone, so rollback/reopening to it is
refused. Qualified recovery resumes the matched candidate with CURRENT data and
the original snapshot; never restore historical SQL over newer records. The
existing shared media store remains the recovery source without duplicate copies.
