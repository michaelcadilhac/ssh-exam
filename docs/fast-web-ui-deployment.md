# Fast, guarded UI-only web updates

This UI-only entry point is qualified locally with synthetic data. The first
schema37 production release used a separately qualified private full migration/
recovery controller, not this stock UI-only command. That release was online at
01:26:40UTC November2 (19:26 November1 Chicago); background conversion was released
at01:27:52UTC. It does not establish production timing for this UI-only workflow.
This command is for a separately authorized application-host update
whose schema, backend/protocol/native contracts and installed CLI remain unchanged.
It never restarts a class-server service or changes exam records to pass a guard.

An explicit `fast_ui.mode: "reviewed-web-cli"` additionally supports the separately
reviewed schema37 latest-student-settings change and a help-only CLI transition.
It requires `reviewed_scope: "latest-student-settings-and-cli-help-v1"`, a full
`qualified_source` matching the release/image source, distinct pinned old/new CLI
digests, and explicit `previous_reader_policy_compatible`. Do not set the unchanged
backend attestation for this mode. Install and independently guard the matched CLI
before apply; native services remain unchanged. When previous-reader compatibility
is false, rollback may select that image only behind the admission fence with
CURRENT data; reopening or online-resume of that old policy is refused. Use
compatible forward repair. Omitted mode retains all existing UI-only restrictions;
this narrow reviewed scope is not a general backend-change override.

The second exact scope `bulk-next-attempt-read-v1` covers the read-only current-
attempt list filter, matching `examctl web grants list EXAM --next` flag and bulk-editor
loading/count display. It retains schema37 and the existing management operation,
authorization, native worker and durable authority. Set previous-reader
compatibility true only for the prior latest-settings reader, whose policy and
CURRENT data remain compatible; its guarded rollback may then reopen. A new CLI
against an older server must refuse the unsupported read flag actionably. The
matched CLI must still be installed and independently guarded before apply.
Unknown scope names remain refused; this does not authorize other backend changes.

The third exact scope `unified-exam-student-list-v1` covers the shared exam student
catalog, permanent membership after attempt/permission history, Add/CSV safeguards
and reviewed NEW-permission restoration of missing compatibility metadata. It
retains schema37 and all native binaries, roles and admission/monitoring checks.
The matched CLI and exact qualified source remain mandatory. This transition
requires `previous_reader_policy_compatible: false`: the old writer can remove
historical membership or restore old permission through legacy setup. Rollback
may preserve CURRENT data behind maintenance; reopening or resuming the older
policy is refused. Use compatible forward repair. The37 locally qualified
operator workflows include exact-scope refusal, matched-CLI checks and this held
rollback/reopen boundary. They mock privileged transport; unchanged real nginx
and signed-startup timing evidence remains separate.

The separate exact mode `reviewed-web-native`, scope
`live-exam-execution-policy-v1`, coordinates the matched native transition. It is
not an unchanged-native attestation. Its release pins all four old/new native
executables, the loaded source worker, configuration/history and relay, and a
unique transition nonce. `apply` fences, drains, stops the web service and takes
the current incremental snapshot, then returns **WAITING_NATIVE**. The separately
qualified native controller performs its guarded backup/install/start/verification.
A private nonce-bound transition receipt and independent fresh after-guard are
bridged to the application host; `resume` verifies those pins before starting the
matched image. Startup also requires fresh signed live-policy support from all
three loaded roles. Recovery resumes the same candidate with CURRENT data; old
writer rollback and reopening are refused. The relay and existing consolidated
service layout remain unchanged. This mode needs its own complete release
qualification and an explicit deployment instruction before production use.

Use `scripts/refresh_native_cohort_guard.py --release-dir PRIVATE_LOCAL_PLAN_DIR
before` to obtain the actual native controller's fresh guard over the existing
trusted SSH connection. After web `apply` returns WAITING_NATIVE, its `handoff`
action rechecks the stopped container, current database and admission fence;
`refresh_native_cohort_guard.py ... handoff` bridges that exact proof to the
native private stage. Refresh it before each native write phase if its90-second
validity could expire. After native verification, `... after` bridges the immutable
transition receipt and fresh loaded-role guard. Repeat `after` every15–20seconds
while observing an owned web `resume` operation; stop refreshing once it finishes.
The helper writes private release metadata only. It does not stop services or
install binaries. A stale or foreign proof refuses, preserving the held state.

The entry point is `scripts/deploy-web-ui`. Preparation does expensive work while
the current gateway remains online: verify/load the qualified image, retain the
previous image, render maintenance responses, copy small configuration and warm
immutable monitoring recovery objects. Apply positively drains the web/native
owners, stops only the web service, takes a consistent incremental snapshot and
starts the matched image. Unchanged monitoring files are hard-linked from the
private recovery store, never from live data. There is no full monitoring tar
copy, repeated large-archive scan or Docker image export during cutover.

Measure cold-store preparation before promising a cutover time. In the first full
release, an unmeasured13GB duplicate copy ran at about64 files/second, projecting
roughly40minutes. A separately verified retained baseline instead covered153,627
monitoring paths through exact PAX ctime/mtime and frame-row checks, paired with a
fresh database/configuration snapshot and zero media copied. This was the private
full controller's reviewed preparation path, not automatic baseline adoption by
the stock UI command. Never substitute an old database for the fresh snapshot.

## Go/no-go and elapsed time

Follow the [deployment execution contract](../AGENTS.md#deployment-execution-contract).
There is no overall deployment time cap, and elapsed time alone does not require
an extension or stop an authorized deployment. Keep the workflow efficient and
report delays promptly. Measure total time from the deployment instruction through
required acceptance and closeout, including online preparation; record maintenance
separately. The local synthetic timings below are component evidence, not a
production end-to-end guarantee.
Every command needs an appropriate timeout and must yield control within30seconds.
An online stall ends the attempt through its
known safe cancellation/status path, with only owned resumable work canceled and
cleanup verified. Never kill a migration, exam process or service blindly.
When termination is unsafe, bound observation of the operation, not its lifetime;
report the delay and preserve its state instead of forcing a timeout abort.

Before declaring a release ready, have the exact image/CLI, prepared controller,
qualified migration/recovery path, verified backup coverage and measured timings.
A missing prerequisite or an unqualified cold copy is a preflight blocker.
Report it with the site online and stop the deployment attempt. Qualify migration
and preparation workflows before fencing; do not discover or develop them during
cutover. Keep all existing drain and preservation
checks. Execute normal authorized steps without another approval request.

After an unexpected fenced failure, report the state immediately and perform at
most one 30-second read-only diagnosis. Use a qualified compatible recovery path;
otherwise preserve the safe held state and report the blocker. Do not patch live
deployment tooling or bypass a guard to meet an estimate. Announce reopening as
soon as confirmed, finish required acceptance and the minimal record, and leave
optional follow-up outside the deployment task.
Include qualified bounded retries in elapsed-time reporting; they do not
authorize an open-ended preparation or debugging loop.

## Prepare the release plan

Qualify the exact release image and browser assets first using the existing
release-image checks. Keep the code-only bundle root-private. Its `release.json`
and `image-assets.json` retain the existing image Config/rootfs/source/asset and
native binary/configuration/history/PID pins. `web-image.tar` is the exact qualified
archive. The previous same-schema image must have a verified retained archive and
its original asset manifest. Existing source-engine OCI and exported Config
digests are different identities and remain checked independently.

Add this `fast_ui` object to the reviewed `release.json`, using real absolute
paths and exact archive digests:

```json
{
  "fast_ui": {
    "project": "/home/micha/src/ssh-exam",
    "data": "/home/micha/src/ssh-exam/var/production",
    "environment": "/etc/ssh-exam/ssh-exam.env",
    "nginx_site": "/etc/nginx/servers.d/ssh-exam.conf",
    "nginx_main": "/etc/nginx/nginx.conf",
    "shared_store": "/data/.ssh-exam-media-objects",
    "previous_image_archive": "/private/previous-release/web-image.tar",
    "previous_image_assets": "/private/previous-release/image-assets.json",
    "image_archive_sha256": "EXACT_QUALIFIED_CANDIDATE_ARCHIVE_SHA256",
    "previous_image_archive_sha256": "EXACT_RETAINED_PREVIOUS_ARCHIVE_SHA256",
    "native_guard": [
      "/usr/bin/ssh", "-o", "BatchMode=yes", "csc-sys",
      "sudo", "-n", "python3", "/PRIVATE_STAGE/native-guard.py",
      "/PRIVATE_STAGE", "after-cli"
    ],
    "unchanged_backend_protocol_native": true
  }
}
```

The native command is the existing staged, pinned, root-private read-only class
guard with the release's fresh expected baseline. It must return the full native
history/configuration/cohort/PID proof; an `examctl` availability response is not
a substitute. Reinventory legitimate new history instead of clearing records or
relaxing a busy/uncertain check. The explicit unchanged-contract attestation comes
from release review; this script cannot infer that safety from a commit name.
Use the broader matched-release/migration procedure for any contract, schema,
dependency/runtime or native change.

An optional absolute `site_template` selects another reviewed two-server template.
Otherwise the tracked marco template is used. The renderer preserves other virtual
hosts and produces one standalone normal/fenced site. It neither copies nginx's
main configuration over unrelated services nor installs another include dependency.

## Run on the application host

Only under the separate deployment instruction, from the reviewed checkout:

```sh
sudo scripts/deploy-web-ui prepare \
  --release /private/qualified-release \
  --state /data/ssh-exam-ui-update-UNIQUE
sudo scripts/deploy-web-ui status --state /data/ssh-exam-ui-update-UNIQUE
sudo scripts/deploy-web-ui apply --state /data/ssh-exam-ui-update-UNIQUE
```

Use a new private state directory. Preparation leaves the service and admissions
unchanged. It loads the image before downtime and retains the prior archive by
hard link on the same filesystem or one copy otherwise. Small configuration,
trust/secret files, Compose files/link, service unit/drop-ins, original nginx and
environment are privately copied and fsynced. Release/assets/rendered configs and
helper inputs are hash-bound; editing them afterward refuses the cutover.

Apply obtains the existing complete web idle checks and fresh independent native
guard, installs the admission fence, drains old exam-facing nginx workers and
repeats guards before stopping. Pending preparation, live sessions, unresolved
holds, future deadlines, review/start/clock operations or uncertain state refuse
the cutover. Existing unrelated nginx connections are qualified and preserved.
Capacity is checked before stop. The candidate image identity is checked again.
On schema37, preparation creates a temporary root-private
`DATA/monitoring-video-deploy.pause` marker. This pauses background conversion
between chunks; a current chunk finishes naturally. It changes no exam clock,
student access or queue row. The installer saves its nonce/state/hash before
creation and proves the marker's exact bytes, root owner,0600 mode and single
link. The qualified image/configuration/rendered files are ready and hash-bound
before this pause. Preparation waits up to60seconds for the current chunk, then
warms stable monitoring files while the website and students stay online. Another
installer's marker is never adopted or removed. If that chunk has not finished,
use resume or cancel; never stop the worker. Keep the owned marker through apply,
or cancel a prepared deployment that you will not apply.
Warm and coverage share the same narrow exclusion for generated per-attempt
`.video-work-UUID` copy directories. Symlinks refuse; unknown/nested directories
and ordinary video files remain included. A concurrent cleanup of an unreferenced
flat video can conservatively refuse warm; resume repeats preparation safely.

All four video tables must be present together. Running jobs or any unresolved job
owner always refuse. Pending/retry jobs, eligible unqueued attempts and completed
jobs with unmapped frames may remain only while this exact owned pause is present.
Without that proof they retain the original refusal. The stopped snapshot and
post-start comparison preserve all41 authority tables exactly; the marker prevents
new queue work during that proof. The marker is not part of the recovery snapshot.
After strict verification and confirmed public reopening, only the owned marker
is removed and background work resumes. Older schema36 needs no marker or video
tables. This installer control is separate from per-attempt monitoring pause.

The stopped snapshot invokes the supported backup CLI with `--require-warmed`.
Under the backup store's lock, any new/missing monitoring object refuses instead
of copying large media after stop. Rewarm through the supported backup command
and retry the appropriate phase; never fake a stopped-gateway attestation.

After startup, strict verification compares all durable authority, schema/indexes,
attempt/grant rowids, prior audit and requests with the consistent snapshot. Only
the qualified nonce/fully audited empty-poll exceptions apply. A removed nonce
must expire strictly before a new empty source-next poll's recorded request.created
cutoff, supported by its exact operation fingerprint and matching confirmed audit.
It must also be expired at observation. Being live at startup does not forbid
later legitimate expiry; current wall time alone never authorizes deletion. Prior
audit/requests, every currently live nonce and all41 authority tables remain exact.
Fresh post-start signed native roles, production readiness/notifications, unchanged
native cohort and exact public assets are required. Only `EXAM_IMAGE` changes.
The normal nginx candidate reopens admissions and retains the useful503 response
for future unexpected gateway downtime.

Nginx reload is asynchronous. After installing the exact normal site, public
checks retry only503 with Retry-After60 within a five-second retry budget, retaining
each request's existing timeout. Each retry checks site identity and reruns the
complete asset verification. Persistent503, other statuses/headers, changed site
identity or wrong asset digests still refuse and retain the running candidate
behind the fence; they do not trigger another service stop.

## Failed or interrupted work

Inspect `status` and its `last_error`; keep the private state and admission fence.
A per-host lock refuses concurrent invocations. No recovery command restores an
old database or resets a deadline, permission, account restriction or source pin.

| Reported phase | Supported next action |
| --- | --- |
| `PREPARING` | If status has `preparation_copies_ready`, `resume` retries only the pause/current-chunk wait/media warm; `cancel` releases its owned pause after verifying the original running release. Earlier copy/image failures require a new state and have no owned marker. The web service was not stopped. |
| `PREPARED` | Retry `apply` once its reported guard/coverage/configuration issue is resolved, or `cancel` to release an owned background pause without stopping the running gateway. |
| `FENCING` / `FENCED` | Use `resume` for fresh idle/native/drain checks before any stop, or `cancel` to restore only the owned fence to the exact prior site while the original gateway is positively healthy. |
| `STOPPED` | Use `resume` to retry the stopped snapshot after fresh inactive-container/service, original idle SQL, native/configuration/coverage/capacity checks. |
| `SNAPSHOT_DURABLE` / failed activation / gated candidate | Use `rollback` to select the retained prior image while preserving CURRENT data. |
| `ROLLED_BACK_GATED` | Review the result, then use `reopen` for fresh verification and normal admission reopening. |
| `ONLINE` / `ONLINE_ROLLED_BACK` | If status still reports an owned pause, `resume` verifies online identity/readiness/public assets and releases it without an idle check or stop. No old-state rollback takeover. |
| `CANCELLED` | The original running release/site are retained. Use a fresh state for another deployment; `resume` can finish an interrupted owned-pause release. |

```sh
sudo scripts/deploy-web-ui resume --state /data/ssh-exam-ui-update-UNIQUE
sudo scripts/deploy-web-ui rollback --state /data/ssh-exam-ui-update-UNIQUE
sudo scripts/deploy-web-ui reopen --state /data/ssh-exam-ui-update-UNIQUE
sudo scripts/deploy-web-ui cancel --state /data/ssh-exam-ui-update-UNIQUE
```

`status` reports the saved pause receipt and a fresh `video_pause_observed`
ownership check. Keep the private state while a marker is present. An incomplete,
foreign or unsafe marker is a conservative refusal, not permission to delete it.
Cancel never stops a service and refuses an already-stopped/unknown gateway;
after stop, use the existing rollback workflow. An interruption while restoring
the original site can be completed with `resume`.

If media coverage needs repair, use the media-only preparation command before
retrying the supported phase; it creates no database snapshot:

```sh
sudo scripts/backup --warm-media /home/micha/src/ssh-exam/var/production \
  --shared-store /data/.ssh-exam-media-objects
```

A crash after publishing a complete snapshot but before recording its receipt is
recoverable: the workflow fully verifies and adopts that exact snapshot rather
than overwriting it. This exceptional repair may take longer than normal cutover.
A changed authority row prevents rollback from erasing it. A failed post-open
public probe reinstates the fence without stopping the candidate again; any
newly admitted work must remain protected and may prevent later rollback.

The side-effect/receipt audit covers these interruption boundaries:

| Interrupted boundary | Recovery or conservative stopping boundary |
| --- | --- |
| Preparation/configuration copies/media warming | Prepare a new private state; the service/admissions were unchanged. |
| Preparation copies bound / pause plan saved / complete marker published before its receipt | `resume` retries the preparation tail and creates/adopts only that exact marker; `cancel` verifies the original live release before releasing it. |
| Media warm finished before `PREPARED` receipt | `resume` safely repeats warm using the shared object cache. The original gateway stays running; no database snapshot is claimed. |
| Fence installed before its phase receipt | `resume` repeats the same fresh guards and old-worker drain; it does not assume the old workers are gone. |
| Service stopped before `STOPPED` receipt | `resume` recognizes the inactive container only through fresh stopped SQL/service/native proof. |
| Snapshot published before its receipt | Fully verify/adopt the exact complete snapshot; do not overwrite it. |
| Environment selected/start launched before readiness receipt | `rollback` requires current authority preservation and the original running web process/socket idle guard, or positive stopped-service proof. Unknown preflight/SSH work prevents a stop. |
| Normal configuration installed before open/reopen receipt | `resume` uses the saved opening proof plus fresh image/configuration/readiness/public checks to release only its owned pause. It performs no idle/history comparison or stop: new legitimate work may exist. Unknown identity remains a read-only reinventory boundary. |
| Owned marker removed before its release receipt | Online `resume` observes its absence and completes the private receipt without touching a foreign marker. |

Changed prepared artifacts/helpers refuse rather than guessing their identity.
Restore the exact reviewed inputs or prepare a freshly reviewed release. A running
unhealthy gateway or uncertain service state that cannot produce the positive idle
proof remains a conservative recovery blocker; keep the fence/current work and
reinventory before any stop. No timeout is a student violation or a stop permit.

## Timing and qualification limits

The local public-dispatch regression covers27 cases (8.197seconds), including actual renderer,
warm/snapshot subprocesses, full schema36/37 SQLite data, all37/41 authority-table
preservation, no-stop refusals, interrupted snapshots, owned pause/cancellation
recovery, bounded nginx-reload503 checks and current-data rollback. Ten separate
actual-schema37 preservation tests cover nonce expiry during verification and
refusal of live nonce loss, missing audit/poll evidence and authority/history edits.
Its128-file/8MiB synthetic cutover was about0.1seconds, below the180-second target.
Docker/systemd/native/root-ownership/worker-drain/public-host transport are explicitly mocked in
that orchestration harness. It is not a measured production deployment time.
The separate real-nginx/TLS/Chromium suite verifies maintenance routing and
desktop/mobile rendering; student/instructor browser cases verify actionable503
sign-in errors without creating an exam.

Root's separate69,120-file backup benchmark measures warmed stopped snapshots
at6.609/9.311seconds with zero new objects/media bytes copied. That is local storage
evidence, not a production or compression-ratio claim. Actual readiness, disk,
SSH and connection-drain time remain part of any real cutover. Elapsed time never
weakens a guard or permits interrupting a running exam.

Run the focused checks with:

```sh
python3 tests/deploy-web-ui-test.py -v
python3 tests/deployment-preservation-test.py -v
python3 tests/nginx-maintenance-smoke.py --browser --output /new/test-output
```

Keep exact qualified helper hashes with the release. Full backup verification and
retention/rotation run outside the brief cutover; see the shared backup workflow.
