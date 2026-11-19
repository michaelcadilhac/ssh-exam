# Bounded capture-decoder qualification — November19

**Implemented/tested locally; not deployed.** This is component and application
qualification, not a new full-class/endurance pass. Validated main commits28f57c8
(diagnostic mock) andbf11e59 (decoders), equivalent to feature199eb70.

Authenticated binary uploads reuse isolated decoder processes within the exact
attempt/page/generation/settings/owner/source. The selected policy retains at
most8workers with a resolution-weighted budget and caps live/retiring processes
at16. Four decode slots,64source operations,5squeue/15sframe and original
CPU/address/output/freshness bounds remain. Overflow reconstructs the verified
prefix; publication failure, expiry, scope replacement and crash cannot extend
monitoring age, change clocks or borrow another source's state. No schema, policy,
management setting or examctl operation changes.

## Verification

- Final application suite:985passed,3unrelated opt-in skips,450.58s.
- Final actual-WASM/browser capture interfaces:10passed,3.1m; actual VP9 chains,
  lost ACK/JPEG recovery, owner reset,128-kbit/s upload and cancelled request recovery.
- Focused coverage includes exact workerSIGKILL with peer-camera/session health,
  actual owning-NodeSIGKILL with no orphan, old-generation publication races,
  failed publication/reconstruction, all12images equal independent fresh decoding,
  multi-image packet refusal, stopped-worker timeout/shutdown,120s expiry,
  maximum square dimensions, weighted retention and overflow.
- Typecheck/build pass. Browser asset hashes are unchanged. All4component
  compiled modules match the successful csc-sys component bytes. Native Go is
  unchanged08ac3f0; its full race/vet/build and actual-kernel evidence applies.
- Actual csc-sys image, UID65532/cap0/no-new-privs/no-network,1CPU/900MiBhigh/
  1GiBmax/no swap:70authored streams,840/840accepted,61.158s total,58.145CPU-seconds,
  p95 948ms/max1515ms,342MiB peak,zero memory-high/max/OOM events. No student
  accounts, MFA or SMTP were used. This is not70authenticated students.
- Exact local/host units and decoder children stopped; authority/configuration
  hashes unchanged. All original documentation images preserved.

## Retained failures and decisions

The96-worker prototype reached memory throttling and bounded refusals under1GiB.
The20-retained variant passed but used781MiB; selected8-retained variant uses
394MiB locally/342MiB in the actual host runtime while sustaining the same input.
One old unit mock called raw browser source as a function; its13focused cases
and corrected full run pass. The first host wrapper failed before capture because
its owned exported sys/fs parent was0700; correction touched only that private
parent, with unchanged host cgroup permissions and authority. All failures remain.

The stopped disposable slice held669MiB of clean unmapped cache/kernel memory
with zero processes. Scoped reclaim reduced it to7.2MiB without changing files,
production controls or the original host guard. Future runs must inventory this
retained test memory rather than charge it to the candidate's active working set.

## Prof assessment and next gate

Prof confirms unchanged rendered wording/layout remains applicable; no optional
UI work identified. The class run must observe transparent fallback without new
permission prompts/modals/Start replay, clear sharing status after recovery,
accurate input-versus-countdown wording, no peer disruption/misconduct attribution,
and visible fallback/input-interruption frequency. Component throughput is not UI
performance evidence.

Next: the existing guarded35-student/140GCC-GDB-pane co-location,600s peak and
protected simultaneous Finish. Preserve authoritative clocks, held accounts,
submissions, credential cleanup and all original host/resource guards. Installed
32slots, csc-specific Compose/nginx/HTTPS/current-data recovery and70capacity
remain separate open gates; prior35/90pass used another topology.

Private evidence:var/qualification35/profile-20261119T044302Z-8d3c93/
native-small-profile/{decoder8-application,decoder8-browser,host-decoder-component-v3}/,
decoder8-artifact-equivalence.json,host-decoder-component-cleanup.json,
owned-empty-slice-reclaim.json anddecoder-prof-review.json.

Deployment remains unauthorized. No migration is needed for this change. A future
matched release must retain current-data recovery coverage, drain/fence admissions,
install the qualified web/native/CLI artifacts, verify fresh authority after
restart and reopen only after acceptance. Keep prior matched artifacts for
compatible rollback without restoring stale student data. Agent consolidation was
completed earlier; do not repeat it.
