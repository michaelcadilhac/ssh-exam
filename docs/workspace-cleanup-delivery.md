# Manual workspace cleanup delivery

Local investigation/development only; no deployment or production deletion.
Approved C4 policy remains manual, no grace period, preserve authoritative clocks,
account restrictions, protected archives/history and source grants. Same-UID active
work or uncertain usage can defer cleanup without interrupting any process. Archive
dependencies are not live-folder dependencies. Existing approvals/state review:
workspace-retention.md. No new policy question is pending.

Dependency-ordered public milestones:

1. Correct `examctl workspaces show/list` metadata. Confirmed source discrepancy:
   native preparation records `WorkPath=Engine.directory()` (normally `/work`),
   the destination visible inside the exam. Current retention metadata instead
   compares it to the private host path and incorrectly blocks ordinary records.
   Old tests authored the host path, masking this. Acceptance: real root-mapped CLI
   and producer-based native tests recognize valid recorded sandbox directories,
   retain exact derived host target, preserve holds/history/bytes, still report
   eligible/archive_verified=false and reject malformed recorded paths. Run focused
   RED→GREEN, full workspace/CLI races and build/vet. No cleanup enabled here.
2. Deliver `examctl workspaces dry-run ATTEMPT` through a bounded independent
   worker. Fresh protected archive verification, initialized state/hold/identity,
   no pending repair/staging or same-UID active work, complete pinned process/thread/
   namespace/mount/fd/cwd/root/mapping proof. Refuse unknown/unreadable/oversized/
   changing observations. No signals, account changes or deletion. Integrate the
   existing mount helper into this actual caller; no unused scanner chain. Prove
   real foreign same-device aliases and nonstudent uses through the CLI before
   broad qualification. Point-in-time preview is never a deletion permit.
3. Deliver reviewed `workspaces cleanup`, inspect/retry/cancel where reversible,
   with worker-owned job/account fences, private same-filesystem exact-inode
   quarantine, durable audit/phase receipts and bounded no-follow removal. Recheck
   archive/state/holds/use at deletion; protect the archive while an interrupted
   cleanup still needs it. Review every new phase for inspection/cancellation,
   crash/restart/expiry/stale completion/admission bypass before freezing artifacts.
   Integrate pending cleanup evidence with source deletion/no-start inventories;
   do not silently skip quarantines or let one crash grant execution/account holds.
   Qualify actual CLI/help, all relevant Linux references/fault boundaries, healthy
   peer enforcement and saved-work restore from unchanged archive afterward.

Do not stop after metadata or a helper: continue to the integrated safe cleanup.
Full privileged boundaries require the agreed guarded disposable csc-sys guest;
local namespace fixtures alone do not qualify host-root/PAM/cgroups. Busy/uncertain
host guard means no test. New bundle approval, if tool review requires it, must
refer to a complete audited exact artifact; previous286 approval covers only it.

Detailed cleanup protocol is not final merely because this plan exists. The
worker/usage lifetime barrier and crash-state layout remain under investigation.

Metadata correction: native producer-based default/custom directory regressions
RED0.046s and actual root-mapped CLI RED0.031s reproduced the wrong host-path
comparison. Focused GREEN under race core1.095s/CLI1.633s verifies recorded_directory
separately from the immutable host UUID target, future defaults preserve old paths,
malformed paths still block, and eligibility/archive_verified remain false. First
CLI selector selected no cases; it is explicitly excluded from interface evidence.
No new durable state/worker/reservation/permission is added. Existing hold metadata,
clocks, source records and saved bytes are unchanged. Broad native/CLI checks next;
this correction does not close C4 or enable deletion.

Broad metadata qualification PASS: affected workspace/hold/snapshot races1.672s;
full native CLI/root-user-namespace/TLS races16.472s; CGO-disabled build/vet/diff.
Source change is limited to offline workspace metadata/help/tests. C8's unchanged
web/application/student/kernel surfaces do not need requalification for this
projection fix. No new privileged cleanup proof or executable deployment claimed.
Logs /tmp/ssh-exam-workspace-directory-{red,cli-red,focus,core,cli}.log.
