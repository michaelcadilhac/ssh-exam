# csc-sys web import, November12,2026

The requested certificate, separate nginx virtual host and full configuration/data
import are complete and verified. **The website remains in maintenance mode.**
The imported application has never been started; this is not a completed runtime
activation or a claim that regional live monitoring has been qualified.

## Installed and preserved

- DNS resolves `ssh-exam.cadilhac.name` to216.220.181.93. Its dedicated Certbot
  certificate expires February10,2027. The existing institutional proxy was used
  for issuance and stored in a root0600 environment for renewal. The existing
  Certbot timer is enabled/active; the renewal hook tests and reloads nginx.
- `/etc/nginx/sites-available/ssh-exam.cadilhac.name` is enabled through the
  existing `sites-enabled` include. The main configuration, default site, relay
  snippet and nginx master PID are unchanged. Validated public and loopback TLS
  requests return503 with `Retry-After: 60` and the maintenance page.
- `/opt/ssh-exam` contains the source project, configuration, signing/trust files,
  private production data and recovery image. All11,911members were verified by
  manifest and individual content hashes before publication. Numeric ownership,
  modes and safe relative symlinks were preserved; the project root is root0700.
  Ten private config/trust/key files passed a second content/mode/owner check.
- All147web attempts are preserved:123completed and24cancelled before start,
  schema37. The unchanged cold SQLite database passes `quick_check`; its SHA256
  is `379c96a9e5ff487715392b516d74d86c54a88d3bbcbcd7b550c6571122e0b926`.
- The existing release image was imported without rebuilding:
  `ssh-exam-release:navigation-ed09efc4bbbd`, Config
  `sha256:1070db5eb0560837102796e2562f8f79988fec915f721a3bc3a56e8e3a57b32e`.
  Docker29's containerd store exposes OCI manifest ID
  `sha256:ea2102286e25e92fb92b2485a8ab2d3dd774b37056db64a44a80647ed2b829c7`.
  A streamed export proves the original raw Config digest and all11rootfs diff
  IDs; inspected Config/architecture/OS also match. These different IDs are not
  evidence of a different application image.
- The app EnvironmentFile and three app/mail units were copied byte-for-byte.
  Compose was checked with those actual environment variables, resolving the
  imported release on127.0.0.1:3001. The app is inactive/disabled; no app container
  exists. `daemon-reload` did not start or restart an app/native service.
- All217native attempts are byte-for-byte equivalent under sorted compact JSON
  serialization (SHA256`ccce90a6ea5a5e37343b8cdd312a96669e0c5c7cda886be236c88c51a4b855bd`).
  Agent3380911, watchdog3380900, relay3380985 and source-worker84398 retain their
  PIDs. Original deadlines, holds, protected submissions and credentials were not
  changed. The source worker is active with zero restarts at final verification.

Marco passed zero-live-session/no-unfinished-attempt guards before fencing and a
second drain before stopping. Its web container stopped cleanly with exit0; its
service is disabled to prevent an accidental second database writer. Original
project/data/configuration remain intact at `/home/micha/src/ssh-exam`. Private
source control/configuration and cold database recovery copies remain under
`/data/ssh-exam-csc-migration-20261112-02838f27/`.

## Transfer and corrected verification errors

The archive was1,869,111,677bytes compressed,2,228,014,058logical bytes. SHA256:
`f22d49d1918f822828a5e4eb447c4e5e8178af6b9fce7d2da81bfd907d11bc02`.
It streamed directly between the two SSH connections; no production plaintext was
stored on the development host. Archive/extraction safety was first qualified in
a disposable user namespace, including refusal of corruption, traversal and
overwrite. Both newly generated transport archives were removed after destination
and source preservation verification. Original data and the retained release
image were not deleted or duplicated again.

The agent corrected its own mistakes rather than treating them as operation
failures requiring instructor intervention:

1. Certbot stores this renewal command under `renew_hook`, not `deploy_hook`.
2. The nginx test main file must retain `/etc/nginx` as its include base. A private
   temporary file there fixed the relative `fastcgi_params` test failure.
3. An immediate HTTPS check briefly reached an old gracefully retiring nginx
   worker. Subsequent bounded read-only TLS readiness checks passed; no second
   reload or certificate replacement was needed.
4. The destination engine's inspected ID is an OCI manifest digest, not the
   source engine's Config digest. Streamed export verified the loaded image.
5. A plain `docker compose config` omitted the service's EnvironmentFile and
   therefore selected the default image. Passing the two installed environment
   variables to the child process reproduced the actual service configuration.

Failed receipts were retained. Completed extraction, image load and directory
publication were inspected and resumed without repeating them or overwriting any
existing target. Every real preservation guard remained in force. Marco's login
shell emitted an unrelated missing user-bus environment diagnostic; all relevant
root operations exited0 and their individual receipts passed.

The archive transfer plus initial verification took159.01seconds; streamed loaded
image proof took5.54seconds. The observed instruction was23:45:20UTC; import
publication completed00:29:39UTC and final preservation/public TLS/transport cleanup
completed00:31:32UTC (November13UTC/November12Chicago). The46m12s elapsed includes
preparation, failures and intervening user interaction. Maintenance is still in
effect, so there is no completed downtime or reopening duration to report.

## Activation boundary and recovery

Before starting/reopening the copied application:

1. Arrange and test local SMTP. A Unix socket is a live endpoint, not a portable
   file. The source `deploy/mail/smtp.sock` was explicitly recorded as not copied;
   the imported mail units/configuration alone do not establish delivery on Ubuntu.
2. Qualify authenticated callbacks to the same public HTTPS origin over a local
   route, including proxy bypass and running native clients' environment/connection
   pools. Preserve TLS, signatures and ownership checks. Imported keys do not
   prove connectivity while nginx is fenced.
3. Qualify explicit bounded web/decoder/recording resources on this shared4CPU/
   8GiB host, preserving native deadlines and representative GCC/GDB capacity.
   The former4CPU/4GB recipe is copied configuration, not accepted new-host sizing.
4. Freeze/rehearse the exact startup, current-data recovery and reopening steps;
   include background writers, current records, signed readiness and public/student
   checks. The existing `scripts/deploy-web-ui` also compares inspected image IDs
   directly with Config digests; qualify its containerd compatibility before using
   it on this host. Keep only one writable database authority throughout.

No activation command was executed. For recovery before any destination writer
starts, original Marco state/configuration and its cold database remain available;
reopening there also requires deliberate DNS/routing correction, original-site
restoration and a guarded start. Do not simply start both services. Once any
destination writer runs, never restore the old source snapshot over newer records:
fence both, preserve current destination data and use a qualified current-data
recovery/move-back procedure.

Private full receipts/manifests are in
`var/collection-tests/csc-web-migration.20261112/` on the dev host and
`/var/tmp/ssh-exam-csc-migration-20261112-02838f27/` on csc-sys. Source confirmation
and cleanup receipts are in its private `/data` stage. These are operational
evidence, not files to commit. Original documentation images are preserved;
all16baseline image hashes still match. No source push was requested or performed.
