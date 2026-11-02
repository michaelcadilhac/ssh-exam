# Fast bulk editing with complete selection accounting

November 2, 2026. Implemented and tested locally at `bc20abd`; no push or deployment
authorized. The exact image/CLI source manifests match all484 committed inputs.

The midterm page contains70 visible students, including4 historical students who
are not enrolled. The final read-only enrollment check confirms66 enrolled and
selected students, each with an editable next permission. The four history-only
students have protected completed history and no next permission. The initial
permission-only audit counted70 visible records without distinguishing enrollment;
its retained aggregate must not be interpreted as70 actual selected students.
No enrollment, permission or history was changed. Private counts/evidence are in
`var/collection-tests/bulk-next-read.44967drm`; real identities stay out of fixtures.

The misleading Select page control actually selected only enrolled students. It
now explicitly says Select enrolled students and shows the eligible page count.
When all enrolled students on a page are selected, the bar explains the unselected
history-only count and the dialog names those accounts. Existing selection and
enrollment policy are unchanged. A separate case—70 enrolled students but66 editable
permissions—is also handled, with explicit no-permission/in-progress omissions.

The old dialog fetched each selected student's complete grant history sequentially
(66 requests in the reported workflow), then
waited for saved-work metadata before selecting the editable targets. It also
mounted every student's settings card and described eligible targets as selected
students. A bulk edit action could additionally display an irrelevant request to
choose an individual student.

Bounded implementation and acceptance:

1. Extend the existing read-only grants list with `next_only`, filtering current
   AVAILABLE/PENDING_NATIVE permissions before pagination. Existing history and
   account scope remain unchanged. `examctl web grants list EXAM --next` exposes
   the same supported query. Expired or claimed current permission remains visible
   for accurate accounting; this filter does not authorize an edit.
2. Fetch exam-wide current pages rather than one history per student. Open the
   shared form immediately, allow drafting during loading, and block Review until
   fresh metadata is complete. Always show the requested count; distinguish editable
   attempts, no next attempt and attempts already in progress, naming omissions.
   Load settings cards only when their disclosure is opened. Keep the existing
   fresh revision/claim check at Review and exact retry bodies at Apply.
3. Exercise70/100-student public Select-page workflows, the200-item HTTP/CLI
   boundary and large unrelated history. Test request count, held responses,
   incomplete/error/retry paths, mixed eligibility, pagination and changed claims.
   Read focused results before the affected editor/bulk suite; typecheck fixtures,
   rebuild served assets and qualify the production build. Preserve all original
   screenshots and make only local commits.

No automatic permission creation, new clock, account reservation, relaxed claim
check, history deletion or admission-policy change is part of this fix.

Verification is complete:

- Public browser regressions pass6 focused cases for70/100 enrolled students,
  the actual70-visible/66-enrolled shape, delayed/error/retry/malformed metadata,
  and new setup claims. Current permission rows deliberately arrive out of order;
  review remains alphabetical. One current-list request replaces per-student reads.
  Drafts are usable before the reply; Review waits for fresh complete metadata.
- All34 affected editor/bulk cases pass. A discovered Refresh disclosure issue was
  fixed with controlled open state and an explicit setup-status refresh; current
  failure/retry state stays visible. Exact unknown requests, source/history/DST,
  no-op and claim protections remain. Seven parent selection callers pass after
  the enrolled-only label/notice clarification; unchanged editor logic reuses its
  earlier passing coverage. Receipt: `var/collection-tests/bulk-next-loading-browser.hgq2s1pl`.
- Backend50 affected tests, focused HTTP scope/auth/strict-bool/closed/pending/claim
  and200/30 pagination checks pass. The actual query plan uses the existing
  `single_unused_grant` partial index with1,000 unrelated historical grants.
  Full actual CLI race/TLS coverage passes; unsupported/ignored filtering never
  falls back to history. Omitted-flag retry fingerprints remain unchanged because
  management hashes the raw body before schema parsing. Evidence:
  `var/collection-tests/next-grant-list._4zot4sp`.
- Full fixture types, fresh frontend build and exact schema37 production-image
  startup/history/video/native-clock smoke pass. The latest qualified candidate is
  `var/collection-tests/bulk-next-attempt-image.qcrhb83s`; earlier image snapshots
  are retained as superseded evidence. Native/WASM/core and schema are unchanged.
- The narrow same-schema deployment scope `bulk-next-attempt-read-v1` passes all34
  operator workflows, including current-data rollback/reopening to the prior
  latest-settings-compatible reader. Native pins and default UI restrictions stay
  strict. Receipt: `var/collection-tests/bulk-next-deploy.cwi2c65b/qualification.json`.

Deployment requires a new explicit instruction. Use the qualified matched web/CLI
mode, source-bound image/binary, fresh idle guards and current warmed-media backup
coverage; take a fresh database/small-file snapshot. No schema migration or native
service restart is needed. Never attest unchanged UI-only/CLI contracts for this
read-query addition. Rollback preserves CURRENT data and original authority.
