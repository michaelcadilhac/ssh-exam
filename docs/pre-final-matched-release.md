# Pre-final matched release — prepared locally, not deployed

November 19, 2026. This procedure covers the matched monitoring proof-exchange,
complete native socket writes, Start-readiness handling and capture-context fixes.
It is a release recommendation, not authorization to install. The short
[35-student qualification](production-qualification-35.md) supplies separate load
and cleanup evidence. The previous 90-minute result belongs to its original bytes;
70 students remain unqualified.

## Frozen candidate and changes

Application source `298276a`, schema 37. Private image
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

Proposed installation setting: 40 connection workers, allowing the measured
35-student class plus five spare slots. This is an installation-file change,
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
those scopes, not a production deployment. Final short-load metrics, independent
cleanup, physical native installation and csc-specific proxy/config/recovery
coverage must be recorded before a release-readiness claim.
