# Automatic saved-work setup

October 31, 2026: deployed and verified on marco/csc-sys under the explicit
**Push and deploy** instruction. The worker is active/enabled. Exact artifacts,
root-service qualification, backups and rollback: [release record](prof-ui-deployment.md).
Earlier local-only/pre-enable statements below record the development sequence;
their release gates are now satisfied for the installed configuration.

The instructor approved a separate retain-only service so allowing another
attempt can finish in the website. This
extends the existing verified-source workflow; it does not replace its archive,
UID, checksum, source-pin, consumer or fresh-Begin checks.

An instructor selects students, starting files, settings and a finite start
window, then reviews and creates their attempts. Saved-file choices are fetched
from recorded history. An invalid or ambiguous latest started attempt cannot
silently fall back to older work or starter files. The approved never-started case
uses the exam's exact published starter. Time and webcam settings are preserved
per student unless explicitly changed; time starts only at the actual Begin.

The result says Preparing saved work until the class server durably confirms
protection. Failed setup offers Retry setup in that same screen. Review polling
uses one cohort request, with current permission and setup metadata read together;
there is no per-student polling loop. Source labels are fetched with that review.
An unknown creation response preserves its exact reviewed request across close/
reload. Recent requests can be opened with their own saved student selection.

## State and failure review

Schema034 indexes actor-bound recent reviews. Schema035 adds a metadata-only
`grant_source_setup` queue. New saved-work issuance/revision enqueues its exact
revision in the same SQLite transaction. Existing pending permissions are not
backfilled: their instructor can explicitly retry the current exact revision.

| State | Meaning and recovery |
| --- | --- |
| QUEUED | Waiting for the separate worker; no account reservation or clock. |
| RUNNING | A three-minute lease, with one stable native confirmation request. A lost worker can be replaced after its lease expires. |
| FAILED | No native protection was confirmed. Repair/check the source and explicitly retry the same canonical grant/revision task. |
| READY | Positive durable native confirmation exists for the current revision. The grant's start window, claims and account restrictions still govern admission. |
| CANCELLED | Revision/revocation, retirement or expiry made queued work unnecessary. This never proves that a native pin is absent. |
| NOT_QUEUED | Older pending permission has no setup task; explicit retry can queue it without changing its saved settings. |

The worker's exit status cannot make a permission available. Only the existing
signed `grants.source-confirm` transaction does that. A late failure report after
confirmation reconciles to the confirmed result. A stale lease cannot replace
another worker's result. Revision/revocation is rechecked inside the child using a
fresh signed plan; retain-only work refuses release plans. A late source
confirmation cannot extend or reopen a closed start window.

Source pins survive cancellation, process death and web outages. Retirement of
old pins and archive deletion remain explicit existing operator workflows with
positive consumer evidence. There is no automatic deletion, grace period, refund,
historical reopening, account-hold release or recovery of unsaved editor buffers.

## Class-server service and CLI

`exam-source-setup.service` runs `examctl web grants source-worker` separately from
the exam agent. It uses the existing protected agent identity and authenticated
outbound HTTPS. It accepts only exact saved-work tasks: no inbound listener,
student credentials, arbitrary commands or generic remote control.

The coordinator holds a private nonblocking process lock and runs one child at a
time. `source-retain` does archive verification/pinning; the coordinator and main
exam agent do no archive IO. Children have a 120-second deadline and parent-death
SIGKILL. Diagnostics are bounded. The unit limits the whole worker group to 256MiB,
no swap, 32 tasks and 50% CPU, with group cleanup/OOM handling. A failure leaves the
attempt pending and independently retryable.

Supported root workflows, discoverable through `examctl web grants help`:

```sh
sudo examctl web grants source-status GRANT --revision N
sudo examctl web grants source-retry GRANT --revision N
sudo examctl web grants source-worker --once
sudo examctl web grants source-show GRANT --revision N
sudo examctl web grants source-retain GRANT --revision N
```

`source-retry` requeues the unique task, rather than creating a second grant or a
new native pin. Its native confirmation identity remains fixed across retries.
The existing manual `source-sync` additionally supports reviewed retirement;
`source-retain` never follows that release path. Use `issue-list` to find this
authenticated actor's recent reviews, and `issue-show` to inspect one. Additional
preview accepts `--preserve-duration` and mixed saved/template/empty `--input`
rows in one existing atomic confirmation.

## Local evidence and remaining release gates

Evidence is under `var/collection-tests/prof-ui.hGHi2EWM`:

- Actual signed root-mapped CLI/native archive tests verify durable pin before
  acknowledgement, lost-reply retry identity, revocation and exact coordinator
  SIGKILL/child death with unchanged native state. Full opted-in CLI races pass
  26.287s: `source-worker-cli-race.log`.
- The joined real gateway → compiled CLI → archive child → native confirmation
  test passes10.14s with both grants AVAILABLE, empty claims/consumers, unchanged
  source history and byte-identical native attempt state:
  `source-worker-joined-gateway.log`. All26 affected grant HTTP interfaces also
  pass (`source-grants-interface-regression.log`). Bounded unused-setting batches
  retain independent per-row transactions/request IDs and original named fields;
  the regression preserves900 seconds when only webcam is changed.
- The actual worker/child in one owned user-systemd service verifies live kernel
  memory256MiB, swap0, tasks32, CPU50%, OOMgroup1 and empty cleanup:
  `source-worker-resource-final.log`. This proves resource containment, not the
  exact production root unit's mount/LSM context. That remains a pre-enable gate.
- The clean full application run passes643 checks (3 deliberate skips) in330.59s:
  `prof-final-full-app.log`. Typecheck/build pass. Final private application
  image4d68e4b8… passes synthetic schema11/24→35 startup, native clock ABI, exact
  assets and unchanged attempts/enrollments/no invented grants:
  `prof-release3-schema11.log` and `prof-release3-schema24.log`. All owned fixture
  containers, images, keys and data are removed; the private base image is kept.
- Eleven another/unused UI cases pass39.9s. Selected existing saved-work permissions
  expose setup/retry in their own screen, including another instructor's grants.
  One bounded cohort reader (at most200) supplies explicit snapshots; no per-row
  poller or settings revision is needed to retry. Task READY while the grant is
  PENDING_NATIVE still says Preparing saved work; only positive current grant
  availability can say Ready. Prof viewed and accepted the actual desktop/mobile
  screens. The source/copy ledger has zero pending issues.
- Five terminal-readiness cases pass8.8s after a public red regression reproduced
  early Enter creating an unintended third terminal. Waiting focus now moves to
  the window without enabling/buffering input; the matching opened acknowledgment
  returns focus to the intended pane, and its first fresh key is verified.
  Four actual-WASM SSH fault/browser-close/unacknowledged-open/later-health
  workflows pass4min with all saved-file/deadline/peer/alert checks preserved:
  `prof-real-faults-ready.log`.

The browser server uses a simulated shell and media; these checks do not claim
native containment, institutional MFA or human camera acceptance. Those boundaries
are separate from the actual Go archive/resource evidence above. Segmented checks
against the exact unchanged image assets cover204 declared browser cases:192
unique passes and12 deliberate native-bundle/measurement skips. The reconciled
receipt retains earlier failures and corrected results without duplicate counts:
`browser-qualification-reconciled.json`. No candidate behavior is deployed.
Do not enable the new service before exact root-service qualification and a
separate deployment instruction.

## Proposed rollout and rollback — do not execute

After final qualification and a separate deployment instruction, back up the web
database/configuration and class-server CLI/unit. Install the matched web/CLI
candidate, apply additive034/035 migrations and explicitly authorize only the
needed named operations. Worker: `grants.source-next`, `source-report`,
`source-plan`, `source-confirm`; management: `source-status`, `source-retry`,
`issue-list`. Existing authorization remains default-deny.

Install the new unit without enabling it; check its configured state path and
read/write confinement. First qualify the exact root service in a disposable
environment with synthetic archives and the host's actual hardening. Then run a
synthetic end-to-end web creation → automatic pin → Ready → fresh Begin test before
enabling automatic processing for real permissions. This needs no change to the
exam-agent execution protocol and no exam-agent consolidation/restart.

For rollback, stop only this worker, retain all source pins/receipts and inspect
pending work. Restore compatible application/CLI binaries only after checking new
review/queue dependencies. Never restore an older metadata backup over newer
permissions, attempts or confirmations. Prefer repair forward; existing manual
source synchronization remains available. The already-deployed temporary-agent
consolidation is unchanged by this UI candidate.
