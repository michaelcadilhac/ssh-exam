# Exam defaults and first-attempt dates

October31 Chicago / November1 UTC: deployed and online in runtime63903bd/schema35,
with matching installed CLI. Details: [welcome-enrollment-deployment.md](welcome-enrollment-deployment.md).

The instructor edits **Exam defaults → Default start dates**. **Save defaults**
changes settings used for future issuance, never a previously allowed attempt.
New exam creation retains **New exam / Save exam**.

In **Add students**, both **One student** and **CSV file** show **First attempt
start dates → Opens / Closes**, initially copied from the exam defaults. Native local
date controls use the device timezone, preserve seconds/milliseconds, and offer
an explicit choice for a repeated daylight-saving hour. Invalid dates, a missing
endpoint or closing at/before opening refuse before enrollment. Past defaults
are displayed faithfully; the form does not silently replace them with today.
Dates may be outside the default interval. These are start dates, not a deadline
extension for an attempt already running.

Only newly issued first attempts use the selected dates. The selected dates do
not revise existing saved permissions or attempt history, or backfill legacy
enrollments. CSV time-limit/webcam edits to existing enrollment and inheritance
retain their current behavior. An explicitly saved legacy
unused recovery allowance still follows its separate authenticated revision
workflow; dates do not change it. Practice is different: sandbox automatically
issues repeatable practice attempts under its fixed policy and Exam defaults.
Its enrollment dialog explains that relationship and omits ineffective
individual date controls; explicit enrollment-date overrides refuse on the server.

Changing either date (including its daylight-saving occurrence) clears CSV
review and disables confirmation. **Review CSV** checks the already selected file
again. Each new review shows the server-reviewed time limit and webcam defaults.
No date columns or technical timestamps are added to the CSV format.

A confirmed pre-write refusal (expired/missing review, outdated proof, changed
definition, class agent or target enrollment) clears stale confirmation and offers
**Review CSV** using the cached file. Unknown, transport or write failures retain
the same review ID for safe confirmation retry. The server exposes the specific
`ROSTER_REVIEW_REQUIRED` code only at the known pre-write checks; an ordinary
HTTP 400 alone does not prove that changing intent is safe.

## CLI and shared authority

`examctl help students` documents the same supported workflow:

```sh
sudo examctl web students add midterm student01 \
  --earliest '2026-11-01T09:00:00-06:00' \
  --latest '2026-11-08T23:42:00-06:00'
sudo examctl web students import-preview midterm --file roster.csv \
  --earliest '2026-11-01T09:00:00-06:00' \
  --latest '2026-11-08T23:42:00-06:00'
sudo examctl web students import-confirm midterm PREVIEW_UUID
```

Omit both date flags to use current defaults, as before. `students add` also
accepts `--definition-revision HASH` obtained from `web exams show`, refusing if
reviewed defaults changed. Date/revision flags are unavailable on settings,
remove or import-confirm; confirm uses the review's saved values.

Web and CLI use RosterManagement and initial grant issuance in one database
transaction. The optional paired API fields `earliest/latest` are positive safe
integer epoch milliseconds below 8640000000000000. The optional add-only
`definition_revision` is a lowercase SHA256 revision. Single-student enrollment
captures defaults/revision when its dialog opens; a background refresh cannot
silently replace that review.

Before sending explicit date/revision changes, examctl makes a fresh signed
`students.list` read (limit one) and requires capability `enrollment-dates-v1`.
Authorize this existing operation as well as the desired mutation. Older
gateways discarded unknown request fields; the check prevents silent fallback
to defaults. Default-only CLI callers need no new read permission.

CSV preview version 2 stores the selected dates, class-agent identity, definition
revision, reviewed defaults and each target's original enrollment. Confirm
validates these before any enrollment/grant/allowance/audit changes. Changed
defaults, changed target rows, a different class agent, expired review or an old
unconsumed preview without settings proof requires a fresh review. An unrelated
student's roster edit does not invalidate it. Retained consumed previews return
idempotently. Existing housekeeping removes preview rows older than ten minutes,
including consumed ones: afterward the web interface requires a fresh review.
Identical CLI --request retries remain protected by the durable management outcome.
This is a retention clarification, not a new cleanup policy or unlimited web
receipt-retention claim. No review reserves an account, grants execution or starts time.

## Release and rollback

No schema, native execution, credential, service configuration or policy change
is required. Install a matched web/CLI release through the existing guarded
drain/backup procedure only after a separate deployment instruction. Reload old
browser tabs before using the new fields. Re-review any old unconsumed imports.

For rollback, preserve issued grants, attempt/submission history, previews and
request outcomes. Previously issued windows remain authoritative. Before selecting
an older reader, drain pending version-2 imports by completing them on the matched
release or waiting for their ten-minute expiry. Merely abandoning the dialog does
not invalidate its persisted review ID: an older reader could otherwise confirm it
using different defaults. Do not delete review rows to force rollback. Afterward,
review any intended import again under the selected release. A new CLI against an
older web server refuses explicit dates rather than changing their meaning.
Rollback must retain the existing saved-grant reader.

## Verification

Final full application suite: 663 passed, three existing opt-in skips. Focused
checks include ten public HTTP/legacy/rollback cases, the actual signed management
CSV adapter, four date units, three new compiled CLI cases and the full examctl
race suite with management user namespaces enabled. Types, fresh web/server
builds, static CLI build and Go vet pass. No native kernel behavior changed; its
previous qualification and the exact existing browser SSH WASM remain applicable.

The broad browser run passed 101 scenarios; its sole stale roster-label assertion
was corrected to assert both the future default and unchanged first-attempt time.
After the narrowly scoped typed CSV retry correction, all 15 directly affected
final browser workflows pass, including that complete real roster workflow, exact
past dates, DST ambiguity, defaults editing, changed CSV dates, stale-review
replacement, lost-confirmation retry, and real saved grant inspection. Unchanged
monitoring/terminal/timezone workflows retain the broad run's evidence. Prof
accepted all six healthy desktop/mobile renders and the final start-date wording.

Initial failures are retained in the evidence directory. The incomplete legacy
recovery fixture now has its required original definition fields without adding
source attestation or changing its historical allowance assertions. The DST
test uses the observed combobox role, and the catalog fixture is validated against
the actual response schema before healthy render capture. A late SQLite fault
proves complete rollback and safe same-review retry without a false re-review
code. No failed fixture or no-tests receipt is counted as verification.

Evidence: `var/collection-tests/enrollment-default-dates.i5on14ln/completion.json`.
Runtime/test inputs and assets are hashed in `candidate-inputs.json`. All ten
original uncommitted documentation screenshots remain byte-identical and unstaged.
