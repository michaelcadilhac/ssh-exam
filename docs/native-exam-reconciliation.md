# Native evidence for legacy definition retirement

Implemented/tested locally October26, not deployed. Entry points:
`examctl web exams native-review EXAM --out NEW-PRIVATE-FILE`, followed by
`examctl web exams reconcile-native EXAM --action delete|archive --revision HASH
--review HASH --evidence FILE --reason TEXT`. The command submits bounded native evidence using
the existing explicitly authorized agent management identity. Both browser and
CLI retirement then use the same shared dependency review.

Acceptance and implementation order:

1. Observe initialized private native state, the entire bounded legacy catalog,
   saved-source retention and workspace/submission inventories without Engine
   initialization, reconciliation, account changes or subprocesses. Unknown files,
   unclosed attempts, unpublished work, unused/uncertain permissions, pending or
   retained source authority and inconsistent history refuse. Recheck state and
   catalog observations before returning evidence. Regression tests cover these
   refusals through the root command, including contradictory filesystem evidence.
2. Authenticate and bind evidence to the exact agent, exam, definition revision
   and reviewed web dependency graph. Require matching terminal native history
   for every web attempt and terminal source disposition for every old source
   expectation. Preserve all original records. Native-only history forbids delete.
   Store acknowledgement, audit and retry result atomically. Any later change to
   the reviewed web graph invalidates evidence and requires another reconciliation.
3. Exercise actual root CLI/TLS and browser retirement: inspect blockers, cancel
   old unused authority separately, reconcile, refresh review, archive history or
   delete genuinely unused definitions. Verify stale reviews, lost replies,
   restart, audit rollback, permission denial and unchanged attempts/holds/files.
   Run affected integration, native race, build/type and browser checks after
   focused completion. Stop this milestone after the integrated workflow passes;
   manual workspace cleanup and configuration activation remain separate.

State and safety review before broad tests:

- Observation grants no authority, creates no account reservation and starts no
  clock. Missing/unsafe initialized authority refuses before creating lock storage.
  Existing initialized state uses only the normal catalog lock metadata. Terminal
  files/rename directories are synced between two matching observations: a visible
  cancellation envelope after a crash alone is not durability proof. No logical
  native record, mode, process or account policy is changed. Failed or interrupted
  observation has nothing to cancel or resume.
- The new evidence file is exclusive/root-owned0600 and bounded1MiB. CLI parses
  strict names/duplicates/shapes and binds the acknowledged hash/counts before
  output. Retain the exact file for retry. Unacknowledged files expire for upload
  after ten minutes and confer no permission or reservation. Files can be removed
  manually when their retry/audit purpose ends; they contain metadata, not secrets
  or submission contents. A failed/partial write is never uploaded implicitly.
- Acknowledgement is metadata, bound to immutable terminal facts and the current
  web graph. It never clears `legacy_unreconciled`, removes source expectations,
  releases retention/account holds or deletes work. Changed graph or definition
  identity invalidates it. Retirement still recomputes dependencies transactionally.
  Browser and CLI previews expose required/verified/stale status and native history
  counts/hash. Deletion's SQL guard also binds lifecycle instance/version and
  preserves a monotonic native-history fence. A subsequent report may not omit or
  change previously acknowledged terminal attempts/permissions, even when the
  gateway has no corresponding attempt rows. Reconcile never invents those rows.
- Unused legacy permissions must first be explicitly cancelled using the delivered
  reviewed cancellation workflow. Supported writers cannot recreate/reopen them;
  consumed permissions remain one-use. Legacy manual filesystem issuance must be
  quiesced and old writers drained, as required by the catalog's existing policy.
  Arbitrary concurrent root edits cannot be fenced by a snapshot protocol.
- Native-only closed history is retained as a deletion blocker. Missing canonical
  rows never establish no-start: bounded inventories reject orphan work/submissions,
  and web attempts require positive matching native terminal records. Unstarted
  cancellations require positive cleanup completion/NORMAL native policy and no
  published work/submissions. Web NULL/UNKNOWN no-start projections normalize only
  for matching this positive native proof; HELD projections still refuse. Neither
  side is rewritten. Source expectations must match terminal native identity and
  checksum; none are deleted. Unpublished/retained/closing source authority refuses.
  A completed collection job ID and `errors` array retain historical diagnostics;
  they are not an active worker/current refusal. Positive COMPLETED/protected/
  released facts govern closure alongside current policy/access errors, pending
  timing and recorded units. The real collector-entry regression preserves its
  original job ID and diagnostics. Its quiescence/release adapters are synthetic;
  this is not a replacement for the existing privileged qualification.
- Reconciliation, audit and request result are one gateway transaction. Failed
  requests leave the fence intact; same-intent retry after a lost reply returns
  the original acknowledgement without applying a fresh snapshot accidentally.
  Existing named management also durably caches authenticated refusals. After a
  confirmed refusal and repair, review again and use a NEW request; retrying the
  old one returns its original refusal. A lost/unverified reply retries SAME first.
- Unarchive does not reopen cancelled/consumed authority or elapsed Begin windows.
  Future grants/admissions remain tracked in the web graph and invalidate any old
  acknowledgement. No new native service, student RPC or execution bypass is added.

Focused HTTP/root CLI/TLS checks passed10.19s before the final no-start/durability/
history-loss review; native refusal races1.029s and typecheck passed. Current
artifacts require the next focused completion and broad qualification below; do
not infer their result from the earlier run. Retain initial failures: missing033
startup registration and missing UID in the web dependency projection were fixed.
Fixture corrections: session(role,username) order, missing-attempt getter throws,
and authenticated failed-outcome caching. None justify relaxing policy. A focused
RED0.003s reproduced creation of lock/state directories before initialized-state
validation; validation now precedes lock acquisition. Filesystem-refusal oracles
assert the exact contradiction, with otherwise eligible cancellation fixtures.

Final focused completion: HTTP plus actual root CLI/TLS2 checks PASS10.46s,
native CLI discovery/parser/inner-proof races PASS1.383s, native observation/
actual collector-entry races PASS1.048s, complete typecheck PASS. Source for broad
qualification freezes after these results. Logs: /tmp/ssh-exam-native-reconciliation-
{focus5,cli-focus,core-final-focus2}.log. The collector fixture's old shared helper
omitted original_deadline and its public result deliberately hides CollectionJob;
the corrected fixture authors the known synthetic original interval BEFORE
collection and inspects the private stored epoch. Product criteria remain strict:
missing/inconsistent original intervals refuse; no deadline is invented or changed.
Earlier fixture failures are retained, not counted as product regressions or proof
that unknown historical intervals are safe.

No new qualification is claimed for the previously uploaded286acd9 bundle.

## Final local qualification

- 622 application/integration checks in110 files PASS318.79s through npm test,
  including actual local SSH/Begin and compiled root CLI/TLS. Full CLI/userns/TLS
  races PASS18.677s; affected native snapshot/catalog/revocation/source/management
  races PASS1.956s. Native CGO-disabled build/vet, complete typecheck and diff pass.
- 11 actual Chromium definition/retirement checks PASS16.4s on exact image assets;
  coalesced capture/input regression with real WASM PASS14.5s/18.2s total. Additional
  new-UI render PASS1.8s/5.1s total: readable scrollable review with native status/
  counts, actual archival action and history-only deletion refusal. Screenshot is
  /tmp/ssh-exam-native-retirement-ui-review/.../native-retirement-review.png,
  not a replacement for original documentation screenshots.
- Local image ssh-exam-release-test:native-retirement-033-a37c150de4,
  sha256:5bdf4d902ea93fa3e6c89c3d51b9a52a74808045f3309ff3607bf3344398e027.
  Private UID10001/read-only/no-network/cap-dropALL startup upgrades24→33,
  preserves exact historical attempt/HELD interval and invents no grant/native
  acknowledgement. Native CLOCK_BOOTTIME ABI and all served asset hashes pass.
  Only labelled fixture/container and synthetic keys/data were removed; base image
  retained. Docker29.9.1 uses the explicit local Unix socket, never production.
- WASM1bea6f8ef01e81532d5fa8a7064047f93fd2fc729391bad6fe109b51193b3e40;
  new index-NAysV-jn.js51cc420a907399b8a7d65b757e8a0c4ea4896e05df6080cf2f183ca053861520.
 692 source files/six packaged assets/native host clock still match MAIN
  var/collection-tests/native-exam-reconciliation.sources.json after qualification.
  Original ten main screenshot hashes unchanged. Native execution/collection/
  retained supervisors are unchanged; prior286 kernel/capacity evidence remains
  scoped to its exact artifact. No redundant resource/csc-sys run is claimed.

Retain the interrupted first broad application's setup failure: direct Vitest
skipped npm's pretest, so this worktree lacked its required clock addon. The exact
owned runner1295751 received SIGINT (exit130); no service/unrelated process was
stopped. Existing npm run build:clock succeeded, clock-dependent HTTP32 checks and
real SSH practice preflight passed. One old retirement assertion then expected
obsolete refusal wording; its reconstructed migration now includes033 and asserts
the required native status/inspection guidance. All15 retirement checks passed
before the full622 rerun. AGENTS now mandates the supported application lifecycle.
No clock fallback or relaxed enforcement was introduced.

Final logs /tmp/ssh-exam-native-reconciliation-{application-final,cli,core,
docker-build,container,browser,student-browser,ui-review}.log. Rollout and rollback
remain proposals in todo-rollout-plan.md; include033 acknowledgements/history
fences in consistent backups. No production migration, cleanup or consolidation
has occurred. Manual workspace cleanup/configuration/help/journey work remains.

Validated code commit be4994ca0232243a29005027f43b6ccdfc320560 is integrated
locally into main. A subsequent actual root CLI/TLS run from the clean committed
worktree passes7.55s (12 unrelated cases intentionally unselected), log
/tmp/ssh-exam-native-reconciliation-clean-commit-cli.log. No source/asset change
from the full qualification manifest. Original main screenshot edits preserved.
