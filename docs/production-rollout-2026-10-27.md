# Production rollout preparation, October 27

Requested outcome: complete the two remaining TODOs—safely consolidate the three
agent owners, then record controlled post-rollout acceptance. Both remain OPEN.
No production command, transfer, configuration change, restart or record mutation
has run in this preparation. Local source baseline is815a895.

## Current concrete result

The matched code-only candidate is staged locally at MAIN
`var/releases/ssh-exam-815a895-20261027.d3w4bye4`:

- 21 files,144,610,717 bytes; manifest SHA256
  `ab446d7d4174567c449f17113938327303f70ab29ab7e68998085b158de4bb54`.
- Four exact qualified Linux/amd64 native executables;291 native input hashes still
  match. No rebuild of the qualified native code was needed.
- Four support scripts/eight service/resource units unchanged since the qualified
  286acd9 support cohort, plus Compose/web-unit references for comparison only.
- Qualified web image, locally tagged `ssh-exam-release:815a895`, exported without
  a registry push. OCI manifest digest
  `sha256:4d969bbeebc956f56b38f71e76b8096fbd3137d86de6e3f61fab410742559dae`;
  config digest
  `sha256:46244c89f91cd635d6b7836d7693ca40f4293e605c0ba76b2af59c9fc547bcb3`.
- Package membership/hashes, thirteen OCI content blobs, eleven layer/diff-ID
  bindings and staged public CLI management/workspace help all PASS. The adjacent
  `.verification.json` records the checks. An initial verifier incorrectly equated
  the OCI manifest ID with the separate config ID; the failure is retained in
  `.verification-first-failure.json`. Image bytes were not rebuilt or changed.

No credentials, runtime configuration, student data, test-only core binary,
synthetic probes/guest drivers or unused publisher slice are included. Installed
configuration/secrets/overrides must be preserved and compared after inventory;
the reference files are not permission to overwrite them.

## Access boundary and exact next action

Automatic approval review rejected the attempted sudo READ-ONLY production
inventory on csc-sys: it interpreted existing access authorization as disposable
qualification only. No SSH command ran. A dialog now requests explicit read-only
production inventory permission for csc-sys and the exam web server. Await its
answer; do not retry through a different command or use yesterday's idle counts
as a current drain proof. Deployment/restart authorization remains separate from
this read-only request.

Once approved, inspect installed revisions/configuration metadata and actual
service/process/socket/cgroup ownership. Inventory all three agents, independent
timed/practice/recording owners, active/preparing web/native attempts, pending
Begin/clock/recovery operations and unresolved collection/account policy. Use
aggregate/private metadata; do not print keys, credentials or student content.
Verify the actual web host/installation and schema from the installed service.
Neither one idle socket nor a terminal canonical state alone proves a full drain.

## Cutover and acceptance gates

The host-specific executable cutover must be reviewed AFTER this inventory:

1. Establish a verified new-admission boundary and a positive full drain without
   cancelling preflights, resetting clocks, releasing holds or stopping needed
   PTY owners. Busy/uncertain means wait, not cleanup or override.
2. With explicit production authorization, take one consistent private backup of
   web/native authority, work, archives, monitoring/deletion metadata, config,
   keys, unit overrides and the current executable/image versions. Keep secrets
   on the owning hosts; record hashes/metadata, not key contents.
3. Apply the matched qualified cohort and required reviewed migrations. Stop the
   two temporary owners only after positive drain, restore the canonical owner,
   remove only their exact units/preservation drop-in, and verify boot state,
   socket ownership, watchdog/reconciler, loaded-role agreement and callbacks.
   Never restart SSH/relay services or kill by process name.
4. Under controlled synthetic identity/data, verify actual Begin/full chosen
   allowance, monitoring/terminal/Continue behavior, protected saved restore,
   original/current-deadline access and credential cleanup, dashboard/callback
   agreement, one delivered alert and duplicate suppression. SMTP acceptance alone
   is not proof of inbox delivery. Identify any human SSH/MFA/media participation
   required; do not substitute a fixture for live acceptance.
5. Compare protected baseline records/queues and reopen only after acceptance.
   Record the deployed hashes/results before closing either TODO. Rollback needs
   another verified drain and compatible readers; preserve all newer history,
   deadlines, holds, grants/consumption, source/cleanup pins and deletion receipts.
   Prefer admission closed/forward repair over reviving pre-start authority.

Do NOT use the historical automatic upgrade helpers for this cutover:
`upgrade-prebuilt` reconciles/cancels PREPARING records and can kill old practice
units; its drain does not cover all three owners. `install-host-filesystem --apply`
and the fresh-install script likewise do not establish the complete current
owner/drain/matched-activation proof. Their existence is not a qualified upgrade
path. No new installer abstraction is being developed before the installed
inventory establishes what actually needs changing.

The detailed policy/rollback references remain todo-rollout-plan.md,
native-cleanup-isolation-incident.md and release-readiness.md. Local integrity
checks are preparation evidence, not deployment or production acceptance.
