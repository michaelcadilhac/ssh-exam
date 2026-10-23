# Reviewed exam definition retirement

October23 implemented/tested locally for lifecycle-tracked definitions; legacy
retirement remains blocked pending native reconciliation. No deployment,
student-record migration, physical cleanup or service action.

Administration → select an exam → **Exam actions** offers **Delete unused exam**,
**Archive exam**, or **Restore archived exam**. Each action loads a read-only
dependency review; confirmation requires a reason and the exact definition and
dependency revisions shown. Current/archived/all visibility never deletes history.

The same shared service supports root management over the existing authenticated
agent identity. Explicitly authorize exams.retire-preview/delete/archive/unarchive
in gateway managementOperations for the needed capabilities; default deny remains.

```sh
sudo examctl web exams retire-preview old-exam --action archive
sudo examctl web exams archive old-exam --revision DEFINITION-HASH --review REVIEW-HASH --reason 'Archive completed protected exam history' --request REQUEST-UUID
sudo examctl web exams list --lifecycle archived
sudo examctl web exams retire-preview old-exam --action unarchive
sudo examctl web exams unarchive old-exam --revision DEFINITION-HASH --review REVIEW-HASH --reason 'Restore definition visibility' --request NEW-REQUEST-UUID
sudo examctl web exams retire-preview unused-exam --action delete
sudo examctl web exams delete unused-exam --revision DEFINITION-HASH --review REVIEW-HASH --reason 'Remove reviewed unused definition' --request ANOTHER-REQUEST-UUID
```

Replace hashes/UUIDs with the reviewed values and fresh intent IDs. After a lost
reply, preserve the original arguments/request ID: a new read request can inspect
current state, while the original mutation retry returns its original outcome.
Never silently refresh a review and reapply an uncertain mutation. Changed settings
or dependencies require explicit review and a new intent. Browser retries preserve
their original UUID; Refresh review is explicit and failed refresh disables submit.

Retirement is currently supported for definitions created under028 lifecycle
tracking. Migration marks every pre-existing definition as native-unreconciled;
delete/archive refuse until a supported native reconciliation workflow supplies
positive dependency proof. There is no manual flag-clearing workflow. This closes
the operational documentation's gateway-only absence gap without assuming legacy
root JSON grants are absent. Full legacy retirement remains part of C18 migration.

Deletion requires zero known roster, attempt, grant/claim, import/grant review,
recovery-allowance/source or grant-mode dependencies. It never cascades records,
protected bytes, request history or audit. Native catalogs/workspaces/submissions
are separate authorities and are never deleted or declared absent by this web
definition operation. Operators must inspect native inventory before a future
cutover; absence of a gateway definition is not native release or cleanup proof.

Archive refuses unfinished, unprotected or unreleased work, unused grants,
unresolved preparation/Begin claims, legacy unused enrollments, consumption without
a closed attempt, and native saved-work references lacking terminal disposition. Resolve those
through supported attempt/grant/roster workflows; archive neither cancels authority
nor clears restrictions. Sandbox is reserved: configure its finite Begin window
instead. Archived definitions refuse new defaults, roster imports/enrollments,
grant issuance/revision and new preparations. Existing historical reads, callbacks,
monitoring and cleanup remain available. A historical definition with unexpectedly
unfinished work remains visible in the default management catalog for inspection.
Unarchive only changes visibility/writer availability: it does not reopen attempts,
restore consumed grants, alter saved settings, extend windows or reset clocks.

## State review before broad qualification

- Preview has no durable operation, account reservation, admission or timeout.
  Inspection/cancellation is simply reading/closing it. Confirmation recomputes
  the graph inside the mutation transaction; stale completion cannot apply it.
- Migration028 adds a lifecycle sidecar without changing two-column exams or
  historical settings. Existing definitions keep a native-unreconciled fence,
  including through ID recreation; new definitions start tracked. Per-instance identities and monotonic lifecycle/settings
  revisions reject delete/recreate and edit/revert ABA. Deletion retains a tombstone.
  Missing/inconsistent lifecycle or grant revision metadata refuses management.
- Active → archived → active changes only lifecycle metadata. No grant, attempt,
  deadline, access disposition, protected source, credential or monitoring row is
  rewritten. Old INSERT/UPDATE writers are fenced at the relevant SQL boundaries.
  No pending operation becomes indefinite authority; existing finite windows remain.
- Mutation, audit and the successful-request ledger commit atomically. Audit failure
  rolls everything back and leaves the same request safely retryable. Crash/restart
  cannot partially retire; successful lost-reply retry returns the original result,
  including after a new definition is created with the old ID, without touching it.
- Shared browser/root service enforces actor/CSRF or signed explicit authorization.
  CLI validates inner target, action, revision, dependency counts and lifecycle
  before output. Outer signing alone cannot authorize a mismatched nested result.
- Native runtime enforcement, retained-SSH mode and archive/source deletion are
  unchanged. This increment supplies no proof of installed-role compatibility or
  worst-case class capacity, and does not complete the broader management TODO.

## Focused evidence and remaining checks

Actual HTTP/root-mapped CLI/local TLS tests pass24 checks in9.32s, including lost
deletion response, gateway restart, ID recreation, history preservation, active/
unused refusal, edit/revert fencing, audit rollback and inconsistent grant history.
Four focused native CLI discovery/parser/schema tests pass under race1.551s.
Typecheck passes. Initial tests caught missing parser flag registration and a null
deletion-result decoding defect; both were corrected before broad qualification.
Fixture corrections retained: template counters/exact attestation, existing error
status semantics and placing historical data after independent zero-attempt tests.
Subsequent pre-release review reproduced consumption without a closed attempt
as incorrectly allowed (RED1.59s); matching closed-history proof and explicit
native-reference refusal are now covered. The operational document's native-only
legacy authority requirement was caught late:028 now conservatively refuses
retirement of ALL pre-existing definitions. This review should have preceded the
first broad launch. Final focused HTTP/root CLI checks pass27 in9.66s and native
CLI races1.713s. The prior full run was500/507: seven old grant fixtures calculated
the obsolete raw-config revision rather than reading the supported interface.
Those22 real SSH/Begin cases pass after public-revision correction (47 combined
checks136.64s, before the final legacy fence). The initial affected browser run
was44/45; actual rate-limit UI proved repeated fixture instructor logins exhausted
the real five-per-minute limit. Reusing one authenticated session in the new file
preserves enforcement; five retirement/sandbox checks pass30.4s. Final full
application/native CLI/build/affected browser qualification now passes:

- 510 application checks/94 files246.92s, including real SSH/Begin and root CLI/TLS.
- Full CLI race/TLS/namespace17.835s; affected native management races2.119s.
 Native timed/collection runtime is unchanged; b850e8d full native race/resource
 evidence remains applicable. No new privileged installed-role qualification.
- 45 affected Chromium admin/definition/grant/real SSH checks2.9m, plus17 fresh
 liveness/cleanup/clipboard/workspace checks1.2m on the rebuilt WASM artifact.
- Application/WASM build, native CGO-disabled build/vet, typecheck and diff PASS.

Frozen540-file code/test manifest SHA256:
93e599773af57056e56848c13f147024075ca6559561351cb45103f06a212355
(/tmp/ssh-exam-definition-retirement-qualified-source.sha256); no mismatch after
qualification. Loaded client manifest is in /tmp/ssh-exam-definition-retirement-browser.sha256.
The rebuilt WASM hash differs from the earlier baseline, hence the additional17
fresh SSH checks; old browser evidence alone was not reused. These are synthetic
local accounts/data with actual TLS/SSH/Chromium and namespace-root CLI, not proof
of class capacity, installed SSH/PAM hardening or completed retained lockouts.
