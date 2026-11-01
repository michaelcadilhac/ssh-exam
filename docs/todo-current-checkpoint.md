# Current deployment — welcome focus and latest UI follow-ups

October31: instructor explicitly requests first-field focus verification, push and
deploy. Existing autofocus passes four focused browser cases, including native
loads/reloads/student-instructor navigation and three delayed-configuration cases.
No product focus change was necessary. Both initial production idle guards PASS:
marco110 histories/sessions0; csc-sys175 histories and unchanged native processes.
Deployment is PREPARING; nothing new installed/restarted/fenced yet. Build and
qualify a clean committed image plus matching CLI; then push and use fresh guards,
private backups and the existing guarded cutover. Preserve native processes,
configuration, authority/history, previous backups and all ten dirty screenshots.
Evidence: var/collection-tests/welcome-enrollment-rollout.9s70lhkv;
focus: var/collection-tests/welcome-focus-native.ztxp24p1/completion.json.

Previous local completion record follows; its no-deploy status is superseded ONLY
by this new explicit instruction and the actual deployment evidence to follow.

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
