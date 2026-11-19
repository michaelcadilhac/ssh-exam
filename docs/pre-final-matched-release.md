# Pre-final matched release — prepared locally, not deployed

November 19, 2026. This procedure covers the matched monitoring proof-exchange,
complete native socket writes, Start-readiness handling and capture-context fixes.
It is a release recommendation, not authorization to install. The short
[35-student qualification](production-qualification-35.md) supplies separate load
and cleanup evidence. The previous 90-minute result belongs to its original bytes;
70 students remain unqualified.

## Frozen candidate and changes

**Not release ready.** Run9 failed on the final student's60-second Start request;
there is no ten-minute co-location/Finish pass. The corrected image below includes
the tested browser recovery, but Start/capture capacity and host-specific cutover
coverage remain open. Unchanged backend/native proofs retain their exact scope.

Current private image: `ssh-exam-qualification:pre-final-start-recovery-fb51849`,
Config `ebb877aa7a9b9956b8a73091335f7508c7c818e606a6d69e03ad3fb5a28baced`;
engine `c213500d69c5c0e64e98ca0f29a11f0111956b7810613030a1d87805c6fe6d14`.
It contains the exact final UI source committed as1ab9203; the build predates that
commit, so rebuilt WASM VCS metadata namesfb51849. Frozen source/context and actual
image bytes are bound in `release-image-final/`. All76backend modules match the
previous candidate. Native binaries and base runtime dependencies are unchanged.

The former Configbb436d26 is superseded: copying private local build output had
preserved root-only modes on CSS/JS/WASM. API startup passed while the normal
application UID could not read those assets. The corrected private recipe runs
`chmod -R a+rX /app/dist` over generated code only; ownership stays root and the
container stays read-only. The normal multi-stage project Dockerfile is unchanged.
Old-image refusal is retained; all25new assets are readable and served with exact
expected bytes asUID10001. The rebuilt WASM passes16real synthetic SSH sign-ins.

Earlier load candidate source `298276a`, schema 37. Superseded private image
`ssh-exam-qualification:colocation-298276a-8d3c93`, Config
`bb436d262fb8e0fbd1d71c401391bf21d245fa37e8dc074a15a4e1cee7029e3a`.
The image reuses the installed immutable runtime dependencies and native clock;
76 shared compiled modules match the disposable co-location application. Native
binaries are the exact retained v18s35 bundle used for the 35-student test, not a
new build inferred from an old pass. Preserve the complete SHA256 manifests in
`var/qualification35/profile-20261119T044302Z-8d3c93/`.

The exact `reviewed-web-native` / `pre-final-monitoring-v2` scope uses the existing
stopped, nonce-bound handoff and forward recovery. It requires the exact source,
all four before/after binary pins, fresh loaded-role policy support and unchanged
configuration/history. Unknown scopes, mismatched source, old-reader compatibility
and native-unchanged attestations refuse. The relay and SSH remain running.
There is no SQL migration: schema 37 remains 37.

Proposed installation setting: top-level `connectionWorkers: 40` in the
application JSON selected by `EXAM_CONFIG`, allowing the target35-student class
plus five spare slots. This is an installation-file change,
not an exam setting or an increase already applied. Keep the current web limit
of 2 GiB/two CPUs only if the final co-location report supports it. Resource limits
and any CPU recommendation must be settled from the report before release freeze.

## Before requesting deployment

1. Freeze image/native/controller manifests, candidate source and actual
   csc-sys Compose configuration. Validate Compose with its real EnvironmentFile.
   Reuse the loaded layer identity only after comparing Config and rootfs diff IDs;
   an engine ID alone is not the image Config identity.
2. Prepare the existing controllers with the actual csc-sys paths:
   `/opt/ssh-exam`, `/etc/ssh-exam/ssh-exam.env`,
   `/etc/ssh-exam/compose.csc-sys.yml` and
   `/etc/nginx/sites-available/ssh-exam.cadilhac.name`.
   Observe HTTPS maintenance and reopening externally; the host's loopback mapping
   is not public DNS/TLS acceptance. Rehearse the real included nginx configuration
   and timed reload without touching the production virtual host.
3. Prove current recovery coverage before copying media. Reuse the verified,
   immutable recording baseline; prepare only uncovered objects. At the stopped
   cutover take a fresh metadata/small-file snapshot and a private native
   state/work snapshot. Preserve all submissions, history, original deadlines,
   account holds, queued callbacks and purge tombstones. Do not duplicate all
   recordings or restore the former Marco database over CURRENT data.
4. Complete the physical native installation and csc-specific proxy/recovery
   prerequisites. The image test's native-systemd and proxy dispatch are explicit
   synthetic seams; controller unit tests do not replace these gates. Do not call
   the release ready until every seam has either exact qualification or a documented
   applicable unchanged-artifact proof.

## Authorized cutover sequence, when separately requested

Use the frozen `scripts/deploy-web-ui` and `scripts/deploy-native-cohort`.
Their `--help` documents public commands; release and state paths below refer to
root-private, pinned bundles created during preparation, not arbitrary defaults.

1. `deploy-web-ui prepare --release RELEASE --state STATE` loads the already
   qualified image and prepares maintenance while the current site stays online.
   Recheck fresh web/native drain before apply. The instructor has allowed an
   admin-only login to be invalidated; student or uncertain activity remains a
   blocker. If the frozen guard still requires zero sessions, report that concrete
   preparation gap rather than bypassing its check.
2. `deploy-web-ui apply --state STATE` fences admissions, verifies stopped state,
   saves the consistent current snapshot and stops at `WAITING_NATIVE`.
   `handoff --state STATE` publishes the fresh nonce-bound stop proof.
3. With that proof, run native `guard-before`, `stop`, `backup`, `install`,
   `start`, `verify`, `guard-after` using the same private native stage.
   It replaces only exam-agent, examctl, exam-login and exam-info. It reloads the
   agent, independent deadline watchdog, saved-work worker and reconciler in the
   qualified order. It never restarts SSH or the relay.
4. `deploy-web-ui resume --state STATE` requires the fresh after-guard and starts
   only the matched image. Verify real signed-poll expiry/recovery, all 41 authority
   contracts, fresh loaded native policy, actual worker setting, exact assets and
   external TLS/maintenance/reopening. Announce reopening immediately when proved.
   Complete the concise preservation/checkpoint receipt, then finish the deployment.

## Recovery and rollback

Before native installation, cancellation/rollback is available only at the
controller's qualified phase and uses CURRENT data. After native installation,
old native/web writers are incompatible: keep the maintenance fence and use the
same matched candidate's forward recovery. Never replace the original snapshot,
clear queues/holds or restore historical metadata to make verification pass.
A candidate already running is inspected and resumed without an extra restart;
its new durable writes remain preserved. On an unexpected fenced failure, report
that held state immediately, perform one bounded read-only diagnosis and use only
qualified recovery. Otherwise leave the fence in place and report the blocker.

The former temporary three-agent consolidation was completed previously. This
release preserves that arrangement. The watchdog, saved-work worker and periodic
reconciler are independent safety roles, not duplicate agents to consolidate.

## Local evidence and remaining gates

Twelve focused new-scope controller cases and all 72 matched-mode cases pass.
The exact image/new scope passes 63.2 seconds of real startup/current-data recovery:
13 signed exchanges, a 62-second publisher delay, expired nonce refusal, 41 table
contracts, due physical-purge rechecks, 12 mutation refusals and zero extra starts
at recovery. Private container/data/key cleanup passes. These results qualify
those scopes, not a production deployment. The exact physical native installer now passes every phase (guard-before, stop,
backup, install, start, verify, guard-after), four distinct replaced binary inodes,
three reloaded roles, hardened saved-work support/refusal/recovery and seven actual
SSH/live-policy/collection/original-deadline checks. Independent native-unit/base
cleanup and host/configuration/authority preservation are FULL. Its web-stop proof
is explicitly synthetic; it does not qualify the public proxy. Evidence:
`var/qualification35/profile-20261119T044302Z-8d3c93/native-install/`.

The corrected final image also passes actual startup/current-data recovery in
63.405seconds:13signedpolls,25served assets verified,41preserved table contracts,
12negative controls and no additional restart or snapshot/purge replacement during
forward recovery. Owned container/synthetic keys/data cleanup passes. Evidence:
`var/qualification35/profile-20261119T044302Z-8d3c93/final-image-startup-recovery/`.
The new `--assets-only` mode checks all public files as the configured application
UID before expensive startup qualification; the full runner also hashes real HTTP
responses. An OCI Config member without a.json suffix required correcting the
read-only export verifier; the actual Config digest/rootfs diff IDs are bound.

Short-load cleanup is complete, but its capacity acceptance FAILED. Start latency,
video/worker refusals, adequate CPU availability and complete peak/Finish coverage
remain open. Csc-specific proxy/config/recovery coverage is a separate gate before
a release-readiness claim. The exact final image is prepared locally, not deployed.
