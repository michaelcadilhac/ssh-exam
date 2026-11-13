# Reduce the France connection's effect on running exams

Status update, November12: the instructor selected csc-sys. Its certificate,
separate nginx site and full configuration/data import are verified, and the
runtime is now ONLINE with local authenticated callbacks and DePaul SMTP.
See [activation evidence](csc-web-activation.md). Dated
proposal and read-only inventory statements below describe their original scope;
Docker29.1.3/Compose2.40.3 were subsequently installed by the instructor.

November12 investigation/proposal only. No implementation, deployment, production
inspection or student-record change. This is not a diagnosis of any past incident.
The source inspected is the current working tree; the web runtime is unchanged
by the two latest CLI-only milestones. No new network measurements were taken.

## Findings in the implementation

- `apps/web/src/capture.ts`: each required source has one sample in flight. In
  retained ACTIVE/LOCKED mode it requests a challenge before sampling, then waits
  for the encoded upload/acknowledgement. The five-second timer does not produce
  another sample while that source is busy. Workspace wiring at
  `apps/web/src/workspace.tsx:873` treats a failed upload/verification as technical
  uncertainty and gates input; an actual ended track is separate policy evidence.
- `apps/web/src/api.ts`: these capture and readiness requests go to the website's
  origin, currently marco. Both JPEG and VP9 transport use that path.
- `ssh-server/internal/core/terminal_monitoring.go`: the live bridge schedules
  fresh per-attempt challenges on a one-second tick, with one exchange in flight
  per attempt and bounded global workers. Signed evidence is requested from
  CallbackURL `/api/agent/monitoring-evidence`, currently the webserver.
- `apps/server/src/monitoring-evidence-ledger.ts` and
  `packages/protocol/monitoring-evidence.ts`: evidence freshness is anchored to
  the oldest required challenge, not the arrival of a late image. The current
  shared evidence/request window is60seconds. Historical15-second descriptions
  elsewhere do not describe this current constant.
- `ssh-server/internal/core/monitoring_evidence.go`: the native verifier charges
  the full evidence round trip against the remaining freshness budget. A delayed
  reply cannot create a new60seconds of permission. The native supervisor remains
  the execution authority; an open SSH connection alone is not complete evidence.
- `ssh-server/internal/core/terminal_recording.go`: protected local recordings
  are sent in bounded signed batches to `/api/agent/recordings`. Moving this
  transfer alone would not remove the live capture/evidence dependency.
- `ssh-server/internal/core/deadline_timing.go`: expiry freezes writers and checks
  the webserver's signed timing revision before collection. Any regional redesign
  must preserve that agreement, not simply remove the check.

These paths make a long webserver/network/decoder stall capable of interrupting
an otherwise healthy SSH session. That establishes a dependency, not proof that
geographic latency caused a reported interruption. Ordinary RTT, jitter, upload
congestion, backend queueing and disk/decoder stalls need separate measurements.
Timeout alone must remain technical uncertainty, never proof of misconduct.

## Options

| Approach | Effect on a running exam if the France path fails | Scope |
| --- | --- | --- |
| Smaller uploads, priority queues, fewer redundant round trips | Reduces load; live proofs still depend on France | Incremental improvements; binary JPEG/VP9 already exist |
| Regional recording receiver only | Reduces transatlantic bulk traffic; still vulnerable if France verifies captures or signs renewals | Additional authenticated service/storage, incomplete for this goal |
| Move the existing web application and its authoritative data to a US host near csc-sys | France is unnecessary for active exams; it receives asynchronous backups | Recommended: one application/database authority, existing protocol |
| Keep the application in France and build a regional live exam service | Can remove France from active verification if ALL live checks move | Larger architectural change: scoped trust, state ownership, administration acknowledgements, recovery and browser routing |

## Recommended first choice: relocate the existing runtime

Run the current application near csc-sys, preferably on a separate US VM. Keep
the existing public hostname if possible, pointing it directly at that runtime.
Do not send students through a reverse proxy on marco: that preserves the WAN
failure dependency. The app's database, capture staging and recording storage
must be local to the regional runtime, not mounted from France.

Browser captures/control and native signed callbacks then stay on the regional
path. SSH keeps its existing csc-sys relay/jump path. The one existing web
application remains the authoritative management/database writer. All existing
Begin, clock revision, revocation, deadline verification, hold, protected archive
and audit semantics are preserved; no new distributed approval protocol is needed.

Marco can receive verified asynchronous backups and delayed status/recording
copies. Its acknowledgement must not be required for live capture acceptance,
execution renewal or protected finish. Replication needs bounded queues, retry
budgets, private local durability and a visible backlog. A full local disk remains
an operational fault; never discard required evidence or claim a backup succeeded.
A separate VM avoids adding internet-facing decoders/application memory and I/O
pressure to the native exam host. Hosting on csc-sys itself is possible only with
explicit process/resource isolation and capacity qualification. The root agent
must not acquire a media decoder or web listener.

There is a one-time guarded data/configuration/DNS/TLS migration. Qualify it with
one active database authority, current recovery coverage and preserved history;
keep the old runtime fenced against writes. A rollback must preserve all newer
records rather than restore a pre-migration snapshot over them. No migration is
authorized or performed by this proposal.

## Alternative if the instructor interface must stay in France

A separate regional service would receive and VERIFY challenged captures, accept
current page/policy observations, maintain the live monitoring ledger and answer
the native supervisor's signed evidence challenges. It would durably accept
terminal recording batches locally. Media decoding/recording/replication run in
isolated bounded workers; they cannot block the authority loop. Reuse the
supervisor per user/attempt and its existing ownership/freeze rules.

Marco would issue narrow, authenticated admission and management intents, then
receive asynchronous observations/recording copies. It must not remain a required
hop for every renewal, policy confirmation, SSH-control acknowledgement or new
pane. A mere upload proxy/cache cannot supply this independence.

Keep fresh central verification at new Begin initially; starting during a central
outage would be a separate consequential policy decision, not implicit caching
of revocable grants. Already-started attempts would use a durably agreed clock
revision locally. Time changes, pause/resume and restrictions are shown as applied
only after the regional authority acknowledges the exact durable revision. Pending
operations remain inspectable/retryable/cancellable in both examctl and the web.
Finish/expiry verification must use the same authoritative revision rather than
retain an unnoticed France callback. Avoid two independently writable clocks.

This requires purpose-limited credentials, replay/owner/sequence checks, explicit
restart verification, origin-restricted browser routing and key rotation. Preserve
all complete-capture requirements and genuine-policy-loss holds. Never trust a
browser's claim that locally buffered images are sufficient proof. This is a
new protocol and availability contract, not a small nginx configuration change.

## Qualification before either architecture changes production

1. Measure per-hop challenge, capture, encoding, upload, decode, evidence-signing,
   native acceptance and queue time; distinguish healthy video capture from late
   verification. Report tail delays, not just average bandwidth/HTTP latency.
2. In an isolated deployment, deny all traffic to/from marco after an exam starts.
   With regional capture/SSH healthy, work and recording must continue unchanged
   through the original deadline and protected finish, with no false violation,
   unnecessary hold, instructor-approval cycle or clock refund. The backup backlog
   must drain idempotently when France returns.
3. Independently stop actual screen sharing/webcam, lose student connectivity,
   replay stale proofs, change owners and restart services. Preserve bounded
   containment, fresh verification, buffers where currently supported, history,
   deadlines, account restrictions and credential cleanup. Full monitoring failure
   can still require a technical pause; no architecture promises zero interruptions.
4. Stall/kill decoders, archivers and replication, exhaust their queues/disk budget,
   and verify they cannot crash/starve the agent or other students. Reuse the
   agreed16student/64terminal qualification target and representative GCC/GDB work.
5. Exercise instructor/CLI clock edits, pause/resume, new panes, revision conflicts,
   pending management outcomes, finish, restart, migration and CURRENT-data recovery
   through real interfaces; retain existing browser/native race coverage.

## Supporting references

- [Google SRE: handling overload](https://sre.google/sre-book/handling-overload/):
  retry budgets and avoiding amplification across multiple retrying layers.
- [MDN: CORS](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS): a
  France-served page calling a regional HTTP service needs explicit cross-origin
  handling; a relay's existing WebSocket Origin check is not an HTTP login scheme.

Open choice: a nearby US runtime (preferred) versus keeping France administration
and developing the larger regional service. Host capacity/availability must be
reviewed before implementation. No promise of a completion time or deployment
readiness follows from this investigation.

## csc-sys hosting feasibility: read-only inventory, November12

The instructor proposed pointing the existing public hostname at csc-sys and
adding a dedicated nginx virtual host. This is feasible in principle; no migration
or installation has been authorized/executed. Read-only host evidence is in
var/collection-tests/csc-web-feasibility.20261112/.

Ubuntu24.04.4/x86-64 has4CPUs,7.7GiB RAM (5.2GiB available at inspection) and
53.7GiB free on /var. These are snapshots, not load-test acceptance. Nginx1.24
already serves HTTPS sites csc-sys.cdm.depaul.edu and mc.cdm.depaul.edu, and the
existing exam relay remains on loopback9082. Loopback3000/3001 are not listening.
A new hostname-specific HTTPS virtual host can proxy to an isolated app on3001
without replacing the existing sites or relay. It needs a valid certificate for
ssh-exam.cadilhac.name; the university hostname certificate is not sufficient.

The current supported app recipe is a non-root Docker image/Compose service.
Docker Engine, Compose, Podman and host Node are not installed; systemd-nspawn
and certbot are available. Installing Docker/Compose would reuse the present
application packaging/controller. Nspawn could host the application but needs a
different qualified installation/update/recovery procedure. No package was
installed or missing executable invoked. Node/FFmpeg are already in the app image.

The current Compose limits are4GB/4CPUs. Those cannot be adopted blindly on this
shared4CPU/8GiB host: qualify smaller bounded allocations, protect native roles
and representative GCC/GDB work, and upgrade resources if acceptance fails.
Container isolation does not remove shared-kernel, disk or host failure risks.

Native callbacks use the unchanged public HTTPS origin. The running agent and
watchdog have an HTTPS proxy; the agent has no NO_PROXY, and the watchdog/CLI
bypasses cover only loopback names/addresses. Configure and qualify a local HTTPS
route for the public hostname, including proxy bypass, so same-host callbacks do
not depend on external DNS/NAT/proxy traversal. Preserve TLS/signatures/origin,
not an unauthenticated HTTP shortcut. Account for live connection pools and any
required drained native configuration reload during the migration rehearsal.

Before DNS changes: stage and test the isolated app, configure dedicated HTTPS
and local callbacks, arrange SMTP (marco's Unix socket cannot be copied as a live
mail endpoint), prepare verified current data/keys, then perform a drained
single-writer cutover. Update A and any AAAA routing consistently. Keep the old
runtime fenced while DNS caches settle. Preserve all newer records on recovery;
never reopen two independently writable databases. Nothing was started, restarted,
installed or modified on either production host during this feasibility check.
