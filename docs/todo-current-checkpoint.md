# Current checkpoint — exam defaults and enrollment dates complete locally

October 31, 2026. IMPLEMENTED/TESTED LOCALLY in source/test revision
be59ae0e4acb8bf914291cd878f2656f25129a4e. No push/deployment or production configuration/student-record
change occurred. No policy/design question or implementation blocker remains.

Delivered: Exam defaults / Default start dates / Save defaults; Add students
single/CSV native Opens/Closes copied from exact defaults, explicitly First attempt
start dates. Only newly issued first attempts use overrides. Date edits and known
stale reviews expose cached CSV re-review; uncertain replies retain the same ID.
Saved permissions/history/deadlines/holds and sandbox automatic practice remain
intact. Root examctl has matching paired date/revision flags and refuses an old
gateway before explicit values can be silently ignored.

- Final full application: 663 passed /3 existing opt-in skips.
- Final15 directly affected browser workflows pass; earlier broad101 passes cover
  unchanged interfaces. Its one stale label assertion is corrected and green.
- Focused10 HTTP/legacy/rollback cases, actual signed gateway custom-date workflow,
  four date units, three new CLI cases and full examctl management race suite pass.
- Types, fresh web/server/staticCLI builds and vet pass. Exact existing GoWASM
  unchanged. Prof accepted six healthy desktop/mobile renders and final wording.
- All10 original dirty documentation screenshots remain byte-identical/unstaged;
  owned3100/3101 browser listeners are closed. No privileged native change claimed.

Evidence: var/collection-tests/enrollment-default-dates.i5on14ln/completion.json;
source/test/assets: candidate-inputs.json there. Feature, compatibility, initial
fixture failures and rollback details: docs/enrollment-default-dates.md.

Next: instructor's next instruction. A separate explicit push/deploy is required
for this change and the preceding local clarity follow-up. Release must use matched
web/CLI, drained sessions/reviews and backup; pending version2 CSV reviews must
complete or expire before selecting an older reader. Preserve all history/outcomes.
A new finite sandbox practice interval is a separate management choice.

Prior local clarity source52d00a8/checkpoint02631fe remains complete:
docs/ui-clarity-pass.md. Production was last verified ff9e0f3/schema35, with practice
closed by its saved schedule; no production action occurred in these follow-ups.
Deployment/backups: docs/ui-followup-deployment.md. Original38-item release count
is unchanged.
