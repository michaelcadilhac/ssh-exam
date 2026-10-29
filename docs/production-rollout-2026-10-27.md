# Production rollout preparation, October 27

October29 superseding release: web07b6fa5 and CLI46bcfa2 are committed, pushed and
deployed; public admissions/readiness/TLS/assets and installed scripting workflows
pass. Native872fe80 and all prior authority remain unchanged. Current versions,
fresh backups and rollback are in
[the scripting rollout](examctl-scripting-deployment.md). The October27–28 record
below describes the base rollout and its original no-push status.

October28 CURRENT: **38/38 TODO items covered; release online.** The authorized
rollout and agent consolidation are deployed, and real human ordinary/NEW saved-work
acceptance and synthetic instructor review PASS. A normal-expiry false timing
email was found and corrected in web7d0b894, fully qualified and installed under a
fresh full drain/private backup. Public admissions reopened06:13 UTC (01:13 Chicago),
production health/readiness200 and unauthenticated preflight/Begin401, fresh root
CLI management PASS. No further human step/design answer or implementation blocker.
No student record was edited, no push/SSH/relay restart/reboot occurred. Existing
unused enrollments still require reviewed NEW grants/settings/finite Begin windows;
no bulk conversion or invented historical enrollment snapshot occurred.

## Final web correction and completed acceptance

- Current web source **7d0b894**; target image config
  `sha256:d2ae5b01745a7bc8bd5ae2bd482122ecfde4e085f333ce49ba6f855bbc685464`,
  source-engine OCI manifest
  `sha256:3cf5c9a55f6b90cae225821ba4b22ae9251a44388d2d8235f364435fc1b6fbc4`.
  Code-only export117,050,368bytes, SHA256
  `1c85d55a7de1d647c2b2fad10ba7bc9b2a9e7f94569ea3763d10a9fa1735b680`.
  Every blob/eleven rootfs diff IDs, actual compiled correction and six unchanged
  qualified assets verified. No production checkout build/pull was used.
- Correction: durable non-sliding two-minute notice wait for transient deadline
  timing verification, cancel on signed recovery/protection. Enforcement stays
  immediate; delay does not imply a student violation. Full626 application tests,
  two opt-in real root CLI/TLS cases, five affected alert UI browsers, typecheck,
  build and private image schema11/24→33 smokes PASS. Native artifacts unchanged;
  prior exact-artifact native races/kernel16students/64panes qualification applies.
  SMTP/browser fixture limits and retained failures: deadline-timing-notifications.md.
- Both actual human tests PASS with real jump MFA/display/camera/fullscreen/keyboard,
  normal UID guards, zero-clock preflight, explicit300s Begin, two verified frozen
  scopes, reviewed Continue preserving SSH/Nano, protected expiration, reviewed
  NEW180s saved-work grant with durable native source retention, exact restored
  bytes/modes/mtimes, early protected finish and actual ordinary SSH denied/released
  at the unchanged original deadline. Both synthetic dashboard rows secured with
  correct lineage. Instructor confirmed one controlled email. Exact timing,
  checksums and explicit private class-key bootstrap seam: live-acceptance-split-identity.md.
- Fresh native backup on csc-sys:
  `/var/backups/ssh-exam/web-correction-20261028-ti3g6cx8`,203,694,080bytes/4,029members,
  SHA256`7f8d070f9315efe487be28b2725cc9315264acb0a89e518c3afd0b7bcab1415a`.
  State lock held during copy; all174 authoritative histories unchanged afterward.
  Canonical/watchdog PIDs210732/210730 remained running; one socket owner,
  reconciler active/enabled, both temporary services absent. No native restart.
- Fresh full web backup on marco:
  `/var/backups/ssh-exam/web-correction-20261028-obhnu9rq`,13,570,232,320bytes/
  153,801members, SHA256`ee0a81527b421ccc1786c2c01e4c3b410a6b31a6b2b9598c8291a07dc59b1266`.
  Data/config/secrets/media/env/unit/site/current image kept root-private on marco;
  SQLite integrity/FKs pass. Socket-ignored notice is only the live SMTP socket.
  All110 attempts (108 original+2 synthetic),2grants/claims and1source retention
  preserved. Only EXAM_IMAGE env line changed; schema33 unchanged. All38 durable
  tables equal before/after in both directions, previous audit preserved. Fresh
  post-start signed canonical callback, native readiness and actual root CLI pass.
- Exact qualified standard site hash
  `1d9b11f5d88128ef58509bc740f23d1f1d55777410c7f12a82e9636ad50be787`;
  full target nginx syntax then reload only, other sites/TLS/security preserved.
  Public health200/productionReady true, maintenance/loginOnly/functionalTest false,
  browserSSH true; six public assets unchanged, normal auth initialization200,
  unauthenticated preflight/Begin/session401. Final receipt06:15:24 UTC:
  outbox108sent/20cancelled and33incidents unchanged, no unfinished attempts or
  authenticated sessions. One false historical timing mail is retained/resolved,
  not erased or described as a new student incident.
- Test credential authorization/local key and exact owned browser/profiles/tunnels
  removed after legitimate hold release; instructor signed out. UID28027/name
  reserved/password locked. Reviewed CLI archive requestfad35204… keeps the two
  protected submissions, grants, source pins and audit. No account/history deletion.

The earlier snapshots/procedure below retain the executed initial rollout evidence;
they are historical where superseded by this final result. Aggregate receipts and
owned operation scripts are in MAIN var/collection-tests/production-cutover.td6oq2x6
(`timing-fix-*`); production secrets/data were not downloaded. Original dirty
screenshots/stashes remain byte-identical. Compatible image-only rollback retains
schema33/current DB/native state; never restore older backups over newer authority.

## Actual deployed result and evidence

- Initial web activation: qualified815a895 image, OCI manifest4d969bbe…/config46244c89…, actual marco
  image ID `sha256:46244c89f91cd635d6b7836d7693ca40f4293e605c0ba76b2af59c9fc547bcb3`.
  Actual DB11→33. Before live migration, actual private production-copy startup
  preserved all18 old data tables exactly with no network/production credentials.
  Live108 historical attempts retain original settings/clocks/generation/protection/
  checksums/access;0 invented grants. All6 public HTML/JS/CSS/worker/WASM hashes match.
  Existing Compose/project/mounts/no-build unit and secrets/pins/mail/readiness kept.
- Native final command source872fe80854e640af483aad1af6df4ed8febebe43:
  agent `d44283ef81d36d3b4108af735c1d7a3a4b162b397c18399ec2114c1b7c9fee87`,
  examctl `0c95fe05dba7036c6f39e3398c4e85c591ec11db485c1595391aff6cc43fb54a`.
  Qualified unchanged-wire clients retained: loginb1d4d3ae…/infoa52ce6c4…;
  support scripts unchanged. Both old temporary units/preservation drop-in removed
  only after fresh full drain/private backup. One canonical socket owner, enabled
  active canonical/watchdog/reconcile timer, required resource slices. Canonical
  proxy matches the existing working watchdog route; hardening/SSH/relay preserved.
- Actual172 native historical attempts retain settings/original/current intervals,
  protection/checksums/access/grants;408 protected/source/account-policy files are
  byte-identical to the original backup. Intentional metadata normalization:
  14 cancelled, zero-clock, never-applied policies explicitly acknowledge NORMAL
  through the existing source-defined rule. No OS account/hold/clock changed.
- Readiness defect: initial report preceded the role socket. First correction80eb76e
  failed actual positive acceptance because reconcile.service's ProtectHome=yes
  hides /home/student. Failure retained; protections stayed intact. Final872fe80
  reports inside the canonical context after listener bind and each minute;
  one-shot is delivery-only. Public actual-binary startup/minute/TLS/CLI regressions,
  native core races207.681s/CLI6.353s/vet PASS. Actual healthy signed observations
  1328→1330 advanced120,076ms; production_ready/roles/retained true, no missing guards.
  Reconciler resumed and does not overwrite that view. See native-configuration-refresh.md.
- Root signed examctl→gateway management PASS under the explicit56-name allowlist;
  current help/queue boundaries are supported. One authorized notification test,
  same durable request/outbox on retry, SMTP accepted; instructor confirmed inbox
  receipt exactly once. Only that notice added (sent106/cancelled20); all32 existing
  incidents unchanged, no new student incident. Human acceptance was completed later as recorded above.

Private rollback backups, with keys/student data remaining on their owning hosts:
marco `/var/backups/ssh-exam/cutover-20261027-vymmm77z` (data/config13,543,137,280 bytes,
153,304 members; SQLite integrity/FKs and old image retained), csc-sys
`/var/backups/ssh-exam/cutover-20261027-ngzrkhmr` (201,594,880 bytes/3,947 members,
plus each pre-correction current state/command copy). Aggregate checksums/receipts
and operational scripts: MAIN var/collection-tests/production-cutover.td6oq2x6;
`{csc-sys,marco}-final-aggregate-receipts.json`. No raw production authority or keys
were downloaded. Original dirty screenshots/stashes remain preserved.

## Completed acceptance gate

The October27 evening guards established the drained initial108 web/172 native
history, signed readiness and20 public refusals. The authorized ordinary synthetic
account and explicit test-browser split bootstrap subsequently supplied the real
human workflows. Both are now complete, teardown is complete and the normal-expiry
email correction has passed the final gate. Public admissions are open as recorded
above. Existing unused enrollments require deliberate reviewed NEW issuance; no
student permissions/settings were bulk modified. See the two feature documents
for precise bootstrap, monitoring and credential-cleanup limits.

## Matched candidate and local acceptance

The code-only release is MAIN
`var/releases/ssh-exam-815a895-20261027.d3w4bye4`:21 files/144,610,717 bytes,
manifest SHA256 `ab446d7d4174567c449f17113938327303f70ab29ab7e68998085b158de4bb54`.
It contains four exact qualified Linux/amd64 executables, four unchanged support
scripts, eight service/resource units, reference Compose/web unit and the qualified
web image. No credentials, installation configuration, student data, test-only core
binary, probes/guest drivers or unused publisher slice are included.

The local image tag is `ssh-exam-release:815a895`. OCI manifest digest:
`sha256:4d969bbeebc956f56b38f71e76b8096fbd3137d86de6e3f61fab410742559dae`;
config digest:
`sha256:46244c89f91cd635d6b7836d7693ca40f4293e605c0ba76b2af59c9fc547bcb3`.
Package membership/hashes, thirteen OCI blobs, eleven layer/diff-ID bindings and
staged public CLI help PASS. Adjacent `.verification.json` retains the receipt.
The first verifier confused OCI manifest and config IDs; its failure is retained,
with no change to image bytes. On the target engine, verify the actual config and
RootFS diff IDs as well as the loaded tag; image-ID presentation can differ by
Docker image store. Never rebuild from marco's old checkout to activate this image.

Actual inventory revealed schema11, earlier than the previous schema24 smoke.
`tests/container-release-smoke.py` now exercises both starting schemas with the
same frozen release image and independent browser-qualified asset receipt.
Both schema11→33 and24→33 PASS locally, including real production-maintenance
startup, native boot clock, UID10001/read-only/no-network/cap-drop restrictions,
served JS/CSS/WASM hashes, clean foreign keys and exact pre-existing columns,
exam JSON and enrollment settings. The schema11 fixture covers HELD, RELEASED,
OVERRIDDEN and cancelled/unstarted history; no grants, retained owners or native
reconciliation evidence are invented. Both exact private containers/images and
synthetic keys/data were removed. These are synthetic migration rehearsals, not
production-data migration or live acceptance.

Durable aggregate inventory and smoke receipts: MAIN
`var/collection-tests/production-rollout-readonly.e3c_z4rz`. It contains no student
identities, submissions, configuration values or key bytes. Prior native races,
root/TLS/cleanup/retained/NEW saved-work and625-test/browser qualification still
applies: no application/native/image input changed for this test-only extension.
See release-readiness.md and examctl-coverage-audit.md for the exact scopes.

The exact local cutover candidates are adjacent to the release at
`var/releases/ssh-exam-815a895-20261027.d3w4bye4.cutover-candidates`:
fenced legacy nginx, fenced matched-image nginx, unfenced standard nginx,
canonical proxy override and the explicit56-name management allowlist.
Candidate manifest SHA256:
`47b38817ed946f418f74a52e53e30879974f048c6f94d2ec4a3de381b7b6f4e0`.
No secret/student content is included; installed comments were omitted.

`tests/nginx-rollout-smoke.py` passes actual installed LOCAL nginx syntax and
51 HTTP/TLS/WebSocket checks for EACH of the three exact candidate configs.
It verifies external refusal, encoded/query paths, ignored spoofed forwarding
headers, loopback-only test access, continued monitor/finish/callback routing and
normal behavior after fence removal. Its upstream is synthetic: this proves the
nginx gate/routing, not application authentication or a production drain. Only
ports/logs/certificates are adapted for isolated local use. All owned nginx and
upstream processes/synthetic TLS keys were removed. The first rootless fixture
used nginx's default fastcgi temp path; the retained failure was corrected by
confining every temp path to the private directory, without product changes.
Target nginx -t and external refusal checks remain mandatory before activation.

## Installed facts: read-only snapshots, not a future drain guarantee

| Surface | Observed result | Cutover consequence |
| --- | --- | --- |
| csc-sys native history |172 attempts:96 protected COMPLETED,76 cancelled before start;0 unfinished/workload units/future original deadlines.91 RELEASED,5 OVERRIDDEN;50 readable account journals all NORMAL | Preserve all records, protected archives, old grants and consumed markers; do not repair legacy missing fields by hand |
| Native owners | Canonical/live-upgrade/deferred-recovery and independent watchdog run the same old executable. Each service has only its main PID, no PTY FDs/descendants. exam.slice has0 processes; three old command-socket listener entries remain | Fresh all-owner proof is still required immediately before stopping; a single socket or canonical state is insufficient |
| Native code | Installed agent SHA256 `2ae1dca01f903ca085a851aca665e049d8befe964450e50f83d14c44501cfc6d`; new collection/template/terminal slice files absent | Install all four matched executables and required resource slices; preserve SSH/relay/PAM gates |
| Native HTTPS | Direct canonical route fails a public health GET; existing watchdog proxy route succeeds200. Canonical service has no proxy environment | Reuse `HTTPS_PROXY=http://proxy.is.depaul.edu:3128` for canonical service; preserve watchdog/reconciler callback-proxy overrides. New Begin freshly verifies outbound HTTPS |
| marco runtime | ssh-exam.service, checkout `/opt/ssh-exam`→`/home/micha/src/ssh-exam`, project ssh-exam; port127.0.0.1:3001. Old checkout b7af387; image91469d0…; only init/node, no connection-worker children or owned TCP connections (including in-process SSH) | Existing unit already uses `up --detach --no-build --wait --wait-timeout 120`; its stop uses `stop --timeout 45`, not volume deletion |
| Web authority | Schema11;108 attempts:82 protected COMPLETED,26 cancelled.0 unfinished, pending clock changes, queued alerts, unexpired sessions, usable continuations or previews; no current policy/access errors | Preserve DB/WAL and all current media/audit/history; repeat under the admission fence |
| New admissions | Maintenance false; two exam windows currently open | Inventory alone cannot authorize a restart. Editing maintenance:true does not affect the running process |
| Web management | Installed agent.managementOperations empty | Activate only the explicit implemented names from packages/protocol/management.ts after production authorization; no wildcard or remote shell. Requests remain signed and audited |
| nginx | Three temporary frontend-overlay location blocks differ from the tracked standard proxy; TLS/security/port routes otherwise match | Retire only those overlays so the matched packaged assets are served. Keep old overlay files for rollback |
| Backup capacity | marco data13,272,579,473 bytes/153,199 files; free46,413,864,960. Native state154,840,843 bytes, work3,783,154; free65/92GB on their filesystems | Space was sufficient at inventory; recheck before copying, never delete history to make room |

The installed Compose file matches the candidate reference exactly (SHA256
97ee4d8204768eab172d02b766d9710a637a322275a810f9626c204cc6af2f07).
Keep its mounts, port, project and resource limits. Preserve the root-private
`/etc/ssh-exam/ssh-exam.env`, config/trust/mail/secrets and readiness report.
Native host_filesystem and temporary_account_policy are already true; state and
templates live under /var/lib/exam-agent, work under /srv/exam-workspace/work,
guard report under /etc/exam-agent. Rootfs is `/`: do not run a rootfs installer
or archive the entire host as though it were an exam workspace.

Automatic review rejected printing credential-related configuration fields before
execution. The reduced non-secret storage-path inventory succeeded. No credential
values were exposed; future private backups must resolve/include key files on their
owning host without printing or transferring keys to the development machine.

## Authorized cutover sequence — executed, acceptance recorded above

### 1. Close new admission, then positively drain

Back up the exact site config first. Add a temporary nginx gate for these installed
and candidate routes: `/api/auth/start`, `/api/auth/complete`, `/api/auth/dialogue`,
`/api/browser/ssh`, `/api/student/preflight`, and
`^/api/student/attempts/[^/]+/(begin|practice)$`. Use normalized `$uri`, a named
map and a server-level `if` containing only `return 503`; do not proxy these paths
to a maintenance page or rely on an invented `/ws` endpoint. Match each actual
path before applying. A loopback-only exception supports controlled acceptance
through an owned SSH tunnel; never trust a caller-supplied forwarding header as
that exception. Syntax-test with nginx -t and reload only nginx configuration,
not the service or unrelated sites. Verify external refusal for every route and
continued health/callback/monitoring/finish routing. Existing WebSockets are not
revoked by that reload.

Repeat the full native/web/process/socket/cgroup/FD inventory after the gate.
Include practice, preflight/auth workers and previews, pending Begin/timing,
independent lease/recording owners and unresolved collection/access restoration.
Account for any already accepted/in-flight request and old nginx connections;
refusal probes alone are insufficient. Do not cancel, override, expire sessions,
kill helpers or relax a guard to manufacture a drain. If anything is busy or
uncertain, leave needed services running and wait. Public monitoring and finish
remain available during this wait.

Acceptance: external new admission refused and all independent ownership/admission
and restoration evidence positively drained, with unchanged historical protection.
Only then stop the gateway and the exact three agent units, watchdog and reconciler
roles needed for a consistent backup. Do not restart sshd or exam-ssh-relay.

### 2. Private consistent backup and immutable activation

Keep secrets and data on their original hosts, in new root-only backup directories.
With writers drained/stopped, retain:

- marco: entire var/production (DB/WAL/SHM, media, deletion/audit metadata), a verified
  SQLite backup/integrity check, deploy/config/trust/mail/secrets, env/unit/nginx
  configuration and the exact previous image/tag. Preserve ownership/modes/ACLs.
- csc-sys: complete state/work (including all grant/consumption/source/cleanup and
  lease journals, protected submissions, templates and history), /etc/exam-agent
  and configured key files, installed executables/helpers, exact service files and
  overrides, SSH/account-policy configuration. No recursive host-root copy.

Verify archive membership/checksums and enough space. A private production-copy
schema11→33 check can run on marco with callback egress disabled and private
synthetic keys; never run two live agents against the same authority. No production
DB/key/student-data download to the development machine is needed. Stop on any
unexpected migration/integrity/history difference.

Transfer only the audited code-only release. Verify its manifest and every file
on each owning host. On marco, load the exported image and select it with
EXAM_IMAGE=ssh-exam-release:815a895 in the preserved env file. Set maintenance true
in config for startup; retain origin, SSH pins/relay, mail, trust and secret paths.
Do not git pull/build, overwrite Compose or replace secrets/readiness signoffs.
Explicitly enumerate the56 implemented CLI operation names from the candidate
protocol allowlist; validation rejects unknown names. Keep authorization/audit on.

On csc-sys, atomically replace the four executables (never truncate a running
inode). Install the matching agent/watchdog/reconciler/timer and exam.slice,
exam-collection.slice, exam-template.slice, examterminal.slice unit cohort.
Support scripts already match; verify them before replacing anything. Preserve
setup-capabilities.conf and existing callback-proxy overrides, add the same proxy
environment to canonical service. For root web commands use an explicit
`sudo env HTTPS_PROXY=http://proxy.is.depaul.edu:3128 examctl web ...`; do not add a
global shell proxy or new remote management service.

Stop/remove only the two exact temporary units and live-preserve.conf after their
fresh drain proof, daemon-reload, and start/enable the single matched canonical
agent plus watchdog/reconcile timer. Runtime-directory cleanup is safe only after
all three old listeners are gone. Preserve account/SSH gates throughout.

Acceptance: canonical executable/config loaded-role agreement; exactly one command
socket owner and no temporary unit/listener; boot enablement; required slices;
watchdog/reconcile health; signed callbacks and fresh outbound Begin verification.
Start the matched web image in maintenance and confirm schema33, native clock,
correct public assets, protected baseline history/queues and local/public health.
Do not falsify readiness or enable functional-test mode to pass admission.

### 3. Controlled live acceptance, then reopen

Use only the explicitly chosen non-student account and new test exam/grants/files.
No existing student record is edited, enrolled, revoked or bulk migrated. The
instructor must perform real SSH/MFA/capture and confirm inbox delivery; fixture
or SMTP acceptance is insufficient. Keep external new-admission refusal while
allowing only the loopback test path. Starting with maintenance false for this
controlled phase requires another drained gateway start; it is not a hot switch.

Record actual CLI and web behavior: help/read-only management; new grant settings
and finite Begin window; no clock/consumption before Begin; full chosen allowance
at actual start; shell/editor preservation during verified hold/approval/Continue;
protected finish and checksum; normal deadline access/credential restoration.
Then issue a reviewed NEW saved-work grant from that protected source, verify
restored bytes/metadata and its full separately chosen allowance only at Begin.
Verify dashboard/native callback agreement, one deliberate delivered test alert,
unchanged-failure duplicate suppression and no new incident on ordinary deadline.
Keep these synthetic attempts as labeled history; do not delete audit/protected
records as test cleanup. No bulk replacement of legacy permissions is part of this
cutover: existing unused enrollments need separately reviewed NEW grants/windows.
Sandbox's new finite window likewise requires explicit configuration before use.

Reopen external admissions only after the test has fully drained, protected
historical records still agree, all original/current access restrictions and
credential cleanup hold, and loaded-role/readiness/callback checks pass. Record
actual deployed hashes and live evidence before checking either TODO box.

## Rollback boundary

Before new execution, a verified drained rollback may restore the backed-up
matched files/config/image and exact nginx overlay while preserving current data.
Schema33/history still requires compatible readers: the previous schema11 gateway
and old native binaries are NOT automatically a compatible rollback cohort.
After any new grant/attempt, never restore old DB/state over it, discard newer
history, revive consumed authority, reset clocks/holds or remove source/cleanup
pins/deletion receipts. Keep admission closed and repair forward when compatible
rollback is unproven. Backup existence is not permission for destructive restore.

Never run the historical upgrade-prebuilt/install-host-filesystem/fresh-install
scripts unchanged: they reconcile/cancel preflights or assume incomplete ownership
gates. No new installer/control subsystem is required for this bounded cutover.
Detailed older receipts in todo-rollout-plan.md and
native-cleanup-isolation-incident.md remain history, not current execution proof.
