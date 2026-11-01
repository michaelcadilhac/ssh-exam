# Current checkpoint — single unused attempt implemented and tested locally

November1 policy delivered: one unused permission per student/exam regardless of
start dates. Web/examctl confirmation atomically replaces exact reviewed unused
predecessors; students receive one assigned attempt and never choose. Stale review/
setup requests refuse, claims and original started history/deadlines/holds stay
protected, and failed saved-file setup never restores old permission or consumes time.

Schema36 safely keeps latest definitely-unused issuance, audits older revocations
and enforces the unique live permission. Ambiguous duplicate groups abort intact.
New confirmation policy marker blocks old gateways before mutation; historical
receipts/unknown requests remain safe. CLI help and table/TSV refs/counts are covered.

Validation:691application checks pass/3existing opt-in skips;86affected integration
checks and13actual compiledCLI→signed gateway cases pass; fullCLI races/vet/static
build/help pass.81unique browser cases covered by passing current-artifact receipts,
with1native-bundle-only skip; broad75pass + corrected unused22pass + provenance5pass.
Prof accepted7desktop/mobile review/result/pending renders. Exact image upgrades
35/24→36 preserve history/holds and all browser-qualified assets. Native execution/
watchdog/relay/core and pinned SSH WASM are unchanged; no new kernel/capacity claim.

Exact source, failures/corrections, CLI/image/assets and cleanup receipts:
var/collection-tests/single-unused-attempt.8vas59nd/completion.json.
Feature/operator/migration/unexecuted rollout+rollback:docs/single-unused-attempt.md.
Local image ssh-exam-release-test:single-unused-8vas59nd (engine0b8d384c…); CLIb9d061eb….
Ten original dirty screenshots preserved/unstaged; owned local listeners and private
smoke containers/images/keys removed. Candidate image and code-only context stay local.

NOT PUSHED OR DEPLOYED. No remote/production actions in this milestone; no open
implementation decision or blocker. Prior local58a0736 personal UI remains included.
Production last recorded63903bd/schema35, pushedthrough3d54fca, admissions open;
prior private backups/rollback:docs/welcome-enrollment-deployment.md. Canonical
consolidation and original38-item release count unchanged. Next: instructor's next
instruction. Any future push/deploy needs a new explicit instruction and the
recorded guarded migration plan; never revive old permission or drop newer history.
