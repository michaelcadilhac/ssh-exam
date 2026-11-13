# csc-sys activation, November12,2026

The website reopened at19:25:21America/Chicago /01:25:21UTC November13, verified
from outside csc-sys. The sole web application/database writer is now csc-sys.
Marco remains admission-fenced, stopped and disabled with its original data and
private recovery copies retained. Import history: [csc-web-import.md](csc-web-import.md).

- Exact unchanged runtime:ed09efc/schema37, image Config1070db5eb056, containerd
  engine manifest ea2102286e25. No rebuild or schema migration. Local controller
  correction a507592 supports both engine image-ID formats without weakening
  Config/layer checks; installed controller/helper/guard bytes are pinned privately.
- App: `/opt/ssh-exam`, enabled `ssh-exam.service`, loopback3001. Host override
  `/etc/ssh-exam/compose.csc-sys.yml`:2CPUs,2GiB RAM, no swap, OOM score500.
  Existing non-root UID10001, read-only root and dropped capabilities remain.
- Native agent/watchdog/source worker and periodic reconciler, plus root CLI,
  bypass the external proxy for the unchanged public HTTPS origin. `/etc/hosts`
  routes that name to127.0.0.1. TLS/signatures remain mandatory. Drop-ins are named
  `csc-web-local.conf`; CLI transport remains in protected `examctl.json`.
- SMTP:smtpprd05b.dpu.depaul.edu:25, verified STARTTLS, no authentication. The
  instructor explicitly approved certificate SHA256
  `087423c701f6b2da1d5ad8f6de8dd9191153cd3e916c496acb1f99c475dbff54`.
  Only the app trusts `deploy/trust/depaul-smtp.pem` through NODE_EXTRA_CA_CERTS;
  hostname verification remains enabled. The old copied socket/mail units stay
  inactive and are unused. Postfix was not configured or started. One durable
  `examctl web alerts test` was SMTP-accepted with zero retries; instructor confirmed
  inbox delivery exactly once. Future relay-certificate replacement needs a
  separately verified trust update, never disabled TLS verification.

All147web attempts and217native histories were preserved. Strict startup proof
checks41tables plus prior audits/management outcomes, allowing only explicitly
proved idle polls and71completed rechecks of prior tombstoned, absent monitoring.
No new deletion authority, attempt timing, grant or account-hold change occurred.
Agent956262, watchdog956261 and source worker956404 were restarted for routing;
relay3380985 and SSH were not restarted. The recording-worker pause was removed
after public acceptance. Once online, no idle guard, snapshot replacement or
service restart was applied.

Verification:53controller regressions and4actual-stream/digest cases pass. Exact
image startup/current-data recovery on csc-sys passes68.4s, including a real62s
publisher interval/expired60s signed nonce, due purge recheck and11negative controls.
Shared-host sizing passes16concurrent GCC/GDB jobs (maximum7.67s),64private PTY
input/output checks and32synthetic VP9 sources under the proposed bounds (8.15s).
These PTYs are a sizing workload; unchanged native16student/64terminal protocol
qualification is reused, not a new institutional MFA/media acceptance. All owned
test containers/processes were removed. Nine external HTTPS asset hashes match;
installed Chromium loads the welcome page without JS errors and focuses its first
field. Original documentation screenshots remain untouched.

Preparation took42m7s from the activation instruction to confirmed reopening,
including mail trust/delivery questions, qualification and corrections to the
agent's wrapper, missing historical-test-object dependency, Compose memory-type
assertion and immediate PID assertion. The initially omitted reconciler retained
the old proxy and held callback delivery; its corrected next activation drained
all90queued events normally. No queue was cleared/skipped and the running candidate
resumed verification using its ORIGINAL snapshot. Maintenance was inherited from
the prior import and remained until reopening; it was not a42-minute UI deployment.

Private evidence and recovery are under
`/var/tmp/ssh-exam-csc-activation-20261112-e7dedea8/` and local
`var/collection-tests/csc-web-activation.20261112/`. Only a cold metadata snapshot
and small configuration/tool backups were added; existing verified source/import
media recovery was reused. Host/setup originals are in `host-control-before/`,
tools in `tool-control-before/`, metadata in `activation-snapshot/`. Do not restore
those snapshots over newer live records. On failure, fence new admissions without
stopping active work, preserve CURRENT data and use the qualified same-image
forward recovery; moving back to Marco requires a guarded current-data transfer.

Future deployment plans must use csc-sys paths/certificate/Compose override and
an external admission-fence observer: local hostname resolution now intentionally
bypasses the external nginx fence. The existing idle source-worker `task:null`
diagnostic remains a separate known issue; it did not prevent signed polling or
fresh readiness and was not patched during this activation. No source push occurred.
