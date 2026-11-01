# Current checkpoint — personal attempt editor tested locally

Completed local follow-up after 3d54fca. Entry points: a student's Allowed attempts
and Allow another attempt → source exams. Prof agreed and accepted per-row Edit
settings/Cancel attempt without personal target checkboxes, inline named editing,
optional file replacement, honest empty/single/multiple sources and Name · exam-code.
Bulk selection stays explicit. Draft switches, historical focus, repeated refresh,
unsafe/tied latest, stale/empty source choices and unknown exact retries are covered.
Malformed native input is rejected before dispatch without losing the draft.

Verification: all42 affected browser cases pass (37 workflows including real HTTP /
WASM SSH choice/start, enrollment and practice; five provenance/timing/source checks).
Full fixture/application typecheck, fresh frontend build, formatting/diff checks pass.
Prof viewed four desktop/mobile/source renders. Ten original dirty screenshots remain
byte-identical and unstaged; owned fixture ports3100/3101 closed. Backend/protocol/
native/CLI source and WASM bytes are unchanged; prior app663/3existing skips and
native/CLI evidence applies to those exact inputs. No new release image is qualified.

Evidence and exact source/assets/log hashes:
var/collection-tests/attempt-editor-clarity.yep1wcu5/completion.json.
Feature, failure corrections, limitations and future rollout/rollback:
docs/unused-attempt-editor.md. No open design decision or implementation blocker.
Student multiple-choice behavior was reviewed but not changed; same-duration extras
can still be difficult to distinguish by creation date. Prof's recommendation is
recorded separately, without new source-retrieval architecture.

NOT PUSHED OR DEPLOYED. No new push/deploy authorization for this follow-up. Only
production read was the two named exam display labels; no student records/work,
configuration or services changed. Production remains runtime63903bd/schema35,
source pushed through3d54fca, admissions open. Prior backup/preservation/rollback:
docs/welcome-enrollment-deployment.md. Canonical agent consolidation and original
38-item release count are unchanged. Sandbox retains its saved practice window.

Next: instructor's next instruction. A later authorized release needs a matched web
image and existing guarded web-only cutover; no DB migration or native restart.
