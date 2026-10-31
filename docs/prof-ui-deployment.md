# Prof UI and automatic saved-work release

Deployed and online October 31, 2026, under the instructor's explicit **Push and
deploy** instruction. Public admissions are open at https://ssh-exam.cadilhac.name.
The separate saved-work worker is active and enabled on csc-sys. No student grant
or exam was created for this rollout.

## Installed release

- Web runtime source `6b7c62b`; schema **35**. This includes Prof's streamlined
  management workflows, useful attempt details, phone-approval guidance and plain
  terminology. Test-only follow-up `efb7c0f` updates two opt-in CLI error oracles;
  runtime code and the qualified image are unchanged by it.
- Image tag `ssh-exam-release:prof-6b7c62b`. The source engine's OCI ID is
  `sha256:a2e5f54238c520127f4661b4b860dec87e806ccda18cf3d8a0fe6f0398193f31`.
  The installed exported Config digest is
  `sha256:1046ca3531130cbd0cad94b7e92a708a8d6b3de421db9df0c27f9df095b7d7b7`.
  Every rootfs diff ID and all six packaged web assets match the frozen release.
- Installed `examctl` SHA256:
  `348d7567c186c5491fa94f35569341a846f3f6b1450e3f85334be142fd4d1178`.
  Worker unit SHA256:
  `a4cfe5e7c17882299661f9b6701e1d69023a3867ec5dd7531c04456671d29f31`.
- `exam-source-setup.service` is active/enabled, initially PID 2256672. Actual
  kernel limits are 256 MiB memory, no swap, 32 tasks, 50% CPU and group OOM cleanup.
  ProtectSystem=strict, ProtectHome, PrivateTmp and NoNewPrivileges are active.
  It uses the existing protected identity and CLI-local proxy configuration.
- Only five management permissions were added: `grants.source-next`,
  `grants.source-report`, `grants.source-status`, `grants.source-retry` and
  `grants.issue-list`. Existing source-plan/source-confirm authorization is reused.
  All other web configuration is unchanged; only EXAM_IMAGE changed in the
  existing environment file. No production checkout pull/build was used.

## Preservation and acceptance

All 110 web histories and 175 original native histories are unchanged. Final
comparisons preserve exams, enrollments, issued settings, claims, start intents,
source retention, clock requests, interruptions, continuations and lifecycle
records. Every prior audit row remains present. No old permission was revised,
backfilled or consumed; the new task queue stayed empty. Original deadlines,
account restrictions, protected work and credential cleanup remain authoritative.

The execution agent PID 4007876, watchdog PID 210730 and relay PID 893011 were not
restarted or replaced. Native configuration and CLI proxy bytes are unchanged.
SSH was not restarted. The existing single-agent consolidation remains in place;
the old temporary execution-agent units remain absent. The saved-work worker is
a separate metadata/archive service, not another exam execution agent.

Qualification and installed checks:

- The existing full 644-test application run (3 opt-in skips), 95 selected browser
  scenarios and typecheck/build evidence apply to the unchanged runtime source.
  The opt-in real CLI → gateway → synthetic archive/worker workflow additionally
  passes in 9.74s after its two stale wording assertions were corrected. No production
  code was changed to accommodate those assertions.
- Exact-image production-maintenance smokes pass schema 11/24→35, native clock ABI,
  ownership/read-only containment, historical allowances/holds and all web assets.
  The actual installed schema 33 database was also rehearsed on a private host copy:
  all prior table rows preserved, integrity/FKs valid, no backfilled tasks.
- The shipped CLI/unit pass a positive durable archive pin and an unavailable
  source through a real root systemd service inside the existing disposable
  volatile guest. Kernel limits, private mounts, original pin/state and teardown
  are verified. Guest base and host files/authority remain unchanged. The host's
  SELinux mode was permissive; this is not an enforcing-mode qualification.
- The actual production worker then passed its executable/kernel/hardening checks
  and repeated successful authenticated idle exchanges. It processed no student
  task during acceptance. This proves access to its real protected credentials
  and server; it does not claim a live student archive test.
- Installed CLI discovery, exam/grant/history exports and recent-review reads pass
  with ambient proxies cleared. Private rows were not printed or transferred.
- Public verified TLS/readiness, normal unauthenticated refusals and all six assets
  pass. Real public student/instructor sign-in pages render without JS errors at
  1280px and 430px, with no credentials entered. New phone/MFA/media behavior was
  qualified synthetically; no new human MFA/camera acceptance is claimed.

## Backups and safety events

Fresh root-private backups remain on their owning hosts:

- marco `/data/ssh-exam-backup-prof-20261030-6xpa_io6`: full data/config/media,
  consistent SQLite copy, previous image and original nginx configuration.
  Archive: 13,573,232,640 bytes / 153,827 members; SHA256
  `18774c5f69bf70eb20cf328a0cdd70090622825d64a6ffd3360a18e97aba6e2e`.
- csc-sys `/var/backups/ssh-exam/prof-cli-20261030-hbjopq9v`: previous CLI,
  native/CLI configuration, original native authority and replaced operator docs.
- Initial gate/partial backup evidence is retained at marco
  `/var/backups/ssh-exam/prof-20261030-7406_s1d`.

The first backup guard refused insufficient root-filesystem capacity after the
idle web gateway was stopped. The unchanged old gateway was restored before
selecting the existing local `/data` disk. The corrected backup checks capacity
before stopping and keeps all older backups/student data intact. No migration
or candidate activation had occurred at that failure. The private-copy verifier's
SQLite URI flag was also corrected, using a new copy; production rows were not
altered to satisfy verification.

Automatic approval review rejected a temporary root test unit on the live host.
It was not executed or retried indirectly: qualification moved into the agreed
disposable guest, followed by normal deployment of the qualified service. One
final native guard briefly refused an extra process; read-only inspection found
it had exited, and the unchanged guard passed on retry. No guard was relaxed or
unrelated process terminated. Surviving old nginx workers were positively scoped
to unrelated 8181 HTTP/1 traffic and preserved. The original nginx site SHA256
`1d9b11f5d88128ef58509bc740f23d1f1d55777410c7f12a82e9636ad50be787`
is restored.

Operational concern: marco's root filesystem still has about 3.1 GiB free. `/data`
has ample space for this backup. Persistent-data relocation or reviewed backup
retention is a separate maintenance action; this rollout deletes neither.

Ignored detailed receipts, failures, manifests and operation sources:
`var/collection-tests/prof-rollout.lta25gu8`.

## Rollback

Fence new admissions and prove a fresh complete drain first. Stop only the new
worker and preserve every pin/confirmation, pending review, task, attempt and
deadline. Review old-reader/configuration compatibility before selecting a prior
image or CLI: the old image does not know the five new configuration permissions
or automatic task workflow. Do not restore a schema 33 database/state snapshot
over newer authority or remove queue/source history to make an old reader start.
Prefer repair forward with admissions closed. Existing manual source synchronization
remains available. The already-completed execution-agent consolidation needs no
change or repetition.
