# Welcome focus and enrollment-default deployment

DEPLOYED AND ONLINE October31 Chicago / November1,2026 UTC under the instructor's
explicit push/deploy instruction. Admissions are reopened and original nginx bytes
restored. No live exam was interrupted. Source through10d4438 is pushed; runtime
image/CLI source is63903bd (10d4438 changes only a browser test).

## Delivered behavior and verification

First-field focus already existed. Native Chromium verifies immediate typing on
student Exam ID and instructor Username at1280/430px, after direct load, reload
and sign-in navigation. Later-field focus remains stable. Four local native/
delayed-config cases and four live public checks before/after cutover pass with
no feature stubs, real credentials, authentication submissions or media capture.
No product focus hack was necessary.

The release includes the previously local clarity pass and Exam defaults /
Default start dates / Add students start-date controls, with matching examctl
flags. Existing allowed attempts retain saved settings. All663 application checks
(three existing opt-in skips), CLI races/types/builds and the prior directly
qualified browser checks apply to byte-identical runtime inputs. Exact-image
production-maintenance startup/schema24→35/history/clock smoke passes. All19
packaged scenarios are covered:18 initial passes and the complete real CSV workflow
passes after correcting its test-only native .520→.52 date serialization. The
selected timestamp remains exact; no product code or image asset changed.

Runtime image: `ssh-exam-release:ui-63903bd`, exported Config
`sha256:77b12b9f02937a6a8338bb88ab279b2c906f407595e7d46706b177bf4b327094`.
Source-engine OCI ID:c2a0ec2a…; all rootfs diff IDs and six public assets verified.
Installed CLI SHA256:`9d6f8dd5f1842368bbbb625bb5f1570c3e7411774d3272b9d9cab7012f7a1ddf`.
Schema35 and exact existing Go1.27.2 WASM49946ceb… remain unchanged.

## Cutover and preservation

Fresh web/native guards proved no sessions, live exams, pending reviews, holds or
unresolved operations. New admissions were fenced. A transient old-nginx socket
snapshot refused the drain; read-only diagnosis and an unchanged verifier retry
proved only shutting-down HTTP/1 requests to unrelated8181 remained. Those
connections were preserved; no guard was relaxed and the first failure is retained.

The idle web service was stopped for a verified full private host-only backup,
then the qualified image was started behind the fence. Only EXAM_IMAGE changed;
application configuration, authorizations and native units/configuration did not.
Strict verification preserves all37 durable authority tables, all110 web attempts,
prior audit/request history, protected settings and deadlines. Normal expired-
before-start nonce pruning and fully audited empty worker polls are proved
explicitly rather than misreported as static tables.

The CLI was replaced atomically after a private native/config/old-binary backup.
Agent4007876, watchdog210730, relay893011 and source-worker2256672 retain their
PIDs and loaded binaries. The worker intentionally retains oldCLI348d7567…;
newly executed CLI is9d6f8dd5…. Its implementation/dependencies are unchanged,
and future children resolve the installed path. Both expected hashes are checked
separately. All175 native histories and normal access state remain unchanged.

One real authenticated `students.list sandbox --limit 1` confirms the installed
CLI's enrollment-dates capability. No student rows leave their host; only its exact
request ID/outcome hash is transferred for final audit verification. Seven local
SQLite checks qualify this narrow exception; all37 authority/prior-history checks
still pass afterward. No grant, exam start, alert test or student credential action
was performed. Public TLS, readiness, all six assets, normal admission refusals
and native public focus pass after restoring original nginx and reopening.

## Backup and rollback

New root-private full web backup remains on marco:
`/data/ssh-exam-backup-ui-followup-20261031-11jog9as`.
Data archive13,580,994,560 bytes /153,827 members; SHA256
`a7a783477785d86abd121605091b6734af1d57592a16326d58516b26ff109823`.
Native CLI/state/config/unit backup remains on csc-sys:
`/var/backups/ssh-exam/welcome-enrollment-cli-cgqa1bt9`.
All earlier backups remain untouched. No student data or credentials left its host.

Rollback requires a fresh complete drain, admission fence and backup, keeping
CURRENT database/media/authority/history. Previous web image isui-ff9e0f3,
Config59a026af…; previous CLI348d7567… is in the private native backup. Pending
version2 CSV reviews must complete or expire before selecting an older reader.
Do not restore old DB/native state, clear review/nonce/pin/consumption records or
restart native execution services to simplify rollback. Verify current source
worker identity explicitly; prefer repair forward if any guard is uncertain.

Exact scripts, manifests, retained failures and completion proof:
`var/collection-tests/welcome-enrollment-rollout.9s70lhkv/completion.json`.
All ten original dirty documentation screenshots remain byte-identical/unstaged.
