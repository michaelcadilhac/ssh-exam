# One unused attempt per student and exam

November1,2026: intentional policy change explicitly requested by the instructor.
Implemented and tested locally; no push or deployment is authorized.
This supersedes the prior policy permitting several unused grants and
asking the student to choose, including the previous initial-after-extra workflow.

The public outcome is one assigned attempt. Confirming **Allow another attempt**
in the website or `examctl web grants issue-confirm` replaces earlier unused
permission for the same student/exam, including expired and disjoint start windows.
The replaced records remain as revoked history. A review itself changes no
permission, account or clock. Exact predecessor references are fixed in the review;
changed authority requires a new review. Confirmation is one transaction across
the selected students, revocations, issuance, source jobs, audit and request receipt.

Started attempts keep their original deadline, records, source files and account
holds. A noncancelled setup/Start claim or contradictory interval/protected/owner
evidence refuses replacement. The instructor must first obtain verified unstarted
cleanup; this workflow cannot infer no-start from a timeout or clear a claim.
Existing account and fresh native Start verification prevent concurrent execution.

Prof agreed: one short replacement sentence on the existing issuance form; exact
review-derived replacement counts before confirmation and actual receipt counts
afterward. No replacement checkbox or additional dialog. Students see only the
assigned settings/files, with no selector. An expected ID protects setup from
stale settings: a replacement requires **Check again**, never an unnoticed switch.
Pending saved files remain unavailable until durable native confirmation.
If replacement files cannot be verified, the replacement stays unavailable; the
superseded permission is not restored automatically and no clock is consumed.

Schema36 retains all rowids, revisions, claims, receipts, source pins and attempts.
It keeps the newest issuance in a duplicate group only after checking that every
member is definitely unused, audits older revocations and adds a partial unique
index for AVAILABLE/PENDING_NATIVE. Ambiguous duplicate groups abort the whole
migration with cleanup guidance. Source pin release uses the existing verified
reconciliation workflow; supersession does not delete an archive or release a hold.

New confirmation requests carry a policy marker rejected by old gateways before
mutation. New clients also require authoritative replacement snapshots. Historical
confirmed receipts remain inspectable; old unknown intents retain their exact
request/body. Old unconfirmed reviews need a fresh review under the new policy.

Evidence: `var/collection-tests/single-unused-attempt.8vas59nd`. Initial browser
regressions reproduced seven UI defects while the existing stale refresh and exact
unknown-body protections passed. Focused HTTP/schema checks pass28; the affected
HTTP/SSH/retention/Start run passes86. Public signed late-retention confirmation
cannot revive superseded pending permission, release source pins or alter history.

All691 application tests pass with three existing opt-in skips. The actual compiled
CLI→signed local gateway run passes13, including TSV refs/counts, disjoint windows,
preserved records, exact restart retries and the actual zsh workflow. Full examctl
race tests, vet, static build and exact-binary help/discovery checks pass. The binary
receipt is `cli-artifact-receipt.json`.

All81 selected non-skipped browser scenarios are covered by current-artifact
passes; one native-bundle-only case is deliberately skipped. The77-case broad run
had75passes, that skip and one ambiguous source-description locator. The final
22-case unused-editor run fixes its scope and passes; five additional provenance
checks pass. Initial focused12 and actual HTTP/WASM replacement/full-allowance/
protected-finish4 also pass. Failed logs remain retained. Fixture corrections use
observed roles, exact asynchronous boundaries and the actual optional starter
binding; no product enforcement or history oracle was weakened. Prof viewed and
accepted seven desktop/mobile/review/result/pending renders.

Full types, formatting and frontend/production-image builds pass. Local candidate
`ssh-exam-release-test:single-unused-8vas59nd` has engine image ID
`sha256:0b8d384cf972b462c1173af023f37618fba353876042f3b16947414d7c76f015`.
Its isolated read-only/no-network/UID10001 startup upgrades synthetic schemas35
and24 to36, preserving historical attempts/holds/settings and exact browser-tested
assets. Both private fixture containers/images/keys are removed; candidate remains
local. Source/context hashes and final receipts bind qualification to these bytes.

Native execution, watchdog, relay, core and SSH WASM source/bytes are unchanged;
their earlier qualification remains applicable. No new PAM/cgroup/capacity claim
or production test is made. Original dirty documentation images are preserved.

For a later separately authorized deployment:

1. Inventory affected unused permissions and exact loaded versions read-only.
   Fence admissions and obtain the existing full drain; preserve all running
   exams and unresolved ownership. Rehearse the installed DB's migration on a
   private copy and review every intended old→new permission mapping.
2. Take consistent private DB/WAL/media/config/native-state/source-pin backups.
   Ambiguous duplicate groups require supported verified unstarted cleanup before
   retrying; never clear evidence to make the migration pass.
3. Install the matched web image and CLI; apply36 transactionally. Verify only
   intended unused statuses/audits/index changed, with all history, deadlines,
   claims and pins preserved. Unconfirmed old reviews need new reviews; confirmed
   receipts remain historical. Verify source-worker compatibility and exact
   public assets/readiness before controlled synthetic acceptance and reopening.
4. Prefer forward repair. A rollback must preserve36, revoked predecessors and
   all newer claims/consumption/pins/audits, using a single-permission-compatible
   writer. Never drop the index, revive predecessors or restore a pre-start DB.

Legacy native-only recovery permissions retain their already-approved cancel-first
migration workflow; metadata replacement never deletes unknown native authority.
The previously recorded canonical agent-service consolidation is unchanged. This
release introduces no temporary agent and needs no execution-agent restart; any
remaining temporary owner discovered later requires the existing positive-drain
consolidation procedure. None of this plan is executed here.
