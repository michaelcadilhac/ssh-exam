# Single unused attempt release — deployed and online

November1,2026. The instructor explicitly authorized **Push and deploy**.
Source `f0c7e106a67dac9510629b10be0d519a75632fc8` is pushed. The matched web/CLI
release and schema36 are installed. Original nginx bytes are restored and admissions
are open, verified November1 at06:55:42UTC. No live exam was interrupted.

## Release and intended behavior

The release includes the personal attempt editor and the instructor's new policy:
one unused permission per student/exam. Confirming another attempt replaces earlier
unused permission, including disjoint start windows. Students receive the assigned
attempt without choosing. Started attempts, original deadlines, saved submissions,
account holds and source pins remain authoritative. Pending saved files cannot
start an exam or restore superseded permission automatically.

Full implementation, policy and qualification evidence:
[single-unused-attempt.md](single-unused-attempt.md) and
[unused-attempt-editor.md](unused-attempt-editor.md).

Matched artifacts:

- Web tag: `ssh-exam-release:single-unused-f0c7e10`.
- Exported image Config:
  `sha256:1caf63de6f9f8519f92956abfdb8ebfa04bbfa0bcf09f46506d32ff076a87bd6`.
  Source-engine OCI ID is `0b8d384c…`; Config and every rootfs diff ID are
  checked independently when loading the exported image.
- Installed `examctl` SHA256:
  `b9d061eb68b677545dacc67d5a6ea74b13d06f36bc3b3e7cf0e99025d7e9e472`.
- Schema35→36 migration SHA256:
  `d6aeab7492155b32271458ac834fe69c0952008e662f3477b56f0cb8cead08a4`.

The prior online web image is `ui-63903bd`, Config `77b12b9f…`, schema35.
Prior installed CLI is `9d6f8dd5…`; the source worker intentionally retains its
loaded `348d7567…` binary. Those two identities are guarded independently.
Its unchanged source-management protocol and child executable resolution remain
compatible with the installed CLI. No worker/native service was restarted.

## Completed cutover and preservation

Code-only bundles are verified in private directories:

- marco: `/var/tmp/ssh-exam-single-unused-web-20261101-tow9lchr`.
- csc-sys: `/var/tmp/ssh-exam-single-unused-cli-20261101-c39t1vtb`.

Fresh guards found110 web attempts and175 native histories, with no live exams,
unresolved account restrictions, future deadlines, active sessions or pending
reviews. The first live-session refusal was preserved; no session was cleared to
pass the guard. Agent4007876, watchdog210730, relay893011 and source-worker2256672
retain their pinned PIDs, configurations and loaded binaries in the final native
guard after CLI replacement. All175 native histories remain unchanged.

The installed database was rehearsed on root-private copies on marco. Schema36
passed integrity/FK and exact preservation checks. It found **zero duplicate unused
permission groups**: the expected permission-status and migration-audit delta is
empty. The running release's strict verification confirms that only the schema-
version row and partial unique index were added. All110 web attempts, permission
rows, saved settings, deadlines, claims, source pins and prior history remain
unchanged. Private copies/mappings remain on their host; exported receipts contain
counts and hashes only.

| Stage | Current evidence |
| --- | --- |
| Source push, code-only staging and private migration rehearsal | Complete |
| Admission fence and full drain | Complete; original nginx bytes preserved |
| Consistent full web/data/config/old-image backup | Verified and fsynced |
| Web activation and schema36 preservation/readiness | Verified behind the fence at06:53:53UTC |
| Atomic CLI installation and native preservation | Verified at06:54:16UTC; final native guard passes |
| Exact signed CLI read | Confirmed at06:54:30UTC; sanitized receipt transferred |
| Final read-preservation verification | Verified at06:54:58UTC |
| Public TLS/assets/readiness and desktop/mobile focus | Pass behind the fence |
| Original nginx restoration and admissions reopening | Complete; public open checks pass at06:55:42UTC |

## Verification and acceptance

The full backup completed before activation. Capacity was checked on `/data`
before stopping the idle gateway; older backups and student data remain intact.
Only `EXAM_IMAGE` changed in the application environment. Schema36, exact image
identity, fresh signed native readiness and35 unchanged durable authority tables
passed strict verification, with permission rows checked separately against the
empty rehearsed replacement mapping. Six nonces expired before activation were
pruned;14 fully audited empty source-worker polls account for new operational
history in the initial activation receipt.

The CLI was replaced atomically after a private binary/state/configuration backup.
Installed CLI and loaded worker identities passed independent guards; native
services, histories, configuration and unit bytes are unchanged. Local help ran
before the one authenticated acceptance call.

That signed `students.list sandbox --limit 1` read used request
`8686c759-402e-4adc-90e6-a684cf2e2822`. Only its sanitized request ID, operation/body
and outcome hash were transferred to marco; no student records left their host.
Final verification matches that exact read and audit against durable history.
It proves the schema36/index-only change, six expired-before-start nonces and26
fully audited empty worker polls; prior audit/requests, all110 web attempts and
the remaining authority/history are preserved. No permission was revoked or issued
by the migration or acceptance.

After final native/public guards passed, nginx was restored to exact SHA256
`1d9b11f5d88128ef58509bc740f23d1f1d55777410c7f12a82e9636ad50be787`
using reload only. Existing unrelated sites/connections were preserved. Public
TLS/readiness and all six exact assets pass with admissions open. GET requests to
POST-only admission routes return404 and unauthenticated student GET returns401;
no authentication request or student workflow was submitted by these probes.

Behind the fence, public TLS/readiness and all six packaged assets match. Student
and instructor initial focus, immediate typing, stable later focus, reload and
navigation pass at1280/430px without page errors, feature stubs, credentials,
authentication submissions or media capture. These are UI/readiness checks;
production acceptance created no new student exam, permission, clock or alert.

The temporary fence also blocks instructor sign-in so a new session cannot race
the drain. Its exact external login/query/encoded-URI behavior was reproduced and
fixed locally. Actual nginx/synthetic-TLS checks pass198 routes across fenced and
unfenced candidates; finish/status/agent paths remain available. All owned test
processes and keys were cleaned. The schema/preservation/one-read verifier passes
28 real SQLite checks;11 operation/test scripts pass syntax checks. Frozen hashes,
retained failures and logs are in `ops-review-receipt.json` below.

The completed canonical agent consolidation remains unchanged; this release adds
no temporary execution agent.

## Backup, rollback and final completion

Verified root-private backups remain on their owning hosts:

- marco: `/data/ssh-exam-backup-single-unused-20261101-mq3ld4es`.
  The complete data/configuration archive is13,582,284,800 bytes /153,827 members;
  SHA256 `3bde15791242d259db21182aae4ea20639bc44cf36b68099063823175358c84e`.
  Consistent SQLite, archive, prior image, receipts and original nginx files are
  fsynced. Backup verification completed06:51:24UTC.
- csc-sys: `/var/backups/ssh-exam/single-unused-cli-i652i4cx`.
  Previous CLI, native state, configuration and source-worker unit are preserved.

Prefer forward repair with admissions fenced. Any rollback needs a fresh full
drain and consistent backup, a writer compatible with the single-unused policy,
and preservation of CURRENT schema36/index, revoked predecessors, newer claims,
consumption, source pins and audit. Do not restore a pre-upgrade database/native
snapshot, drop the index, revive old permission or clear evidence to make an older
reader start.

Final authenticated-read preservation, original nginx restoration and post-reopen
public acceptance all pass. Production acceptance was read-only; no human MFA,
screen/camera capture or new production attempt was exercised in this release.

Detailed local artifacts and sanitized host receipts:
`var/collection-tests/single-unused-rollout.mschv_oo`.
Original dirty documentation screenshots remain workspace data and are excluded
from the code-only release context.
