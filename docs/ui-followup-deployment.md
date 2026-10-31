# Student sign-in and summary follow-up

Deployed and online October31,2026 under the instructor's explicit instruction to
push and deploy all three verified fixes. Admissions reopened; the original nginx
configuration is restored. No live exam was interrupted.

## Behavior and release

- The field is **Password** and disappears after submission until a fresh challenge.
  Waiting progress/Cancel remain; raw host messages, phone/OTP responses and
  credential cleanup retain their behavior.
- The student summary omits routine Start window details and attempt-choice date
  ranges. Time limit/webcam/files, attempt choice, instructor scheduling and actual
  blocked-start explanations remain. Start eligibility and deadlines are unchanged.
- Initial focus: student Exam ID, login-test Username, instructor Username. Mount
  autofocus accepts immediate typing and does not steal focus on later updates.

Runtime source `ff9e0f36d87625e410de81c184edca3c2b16a455` includes the earlier e57c3ec fix; schema **35**.
Image `ssh-exam-release:ui-ff9e0f3`. Installed exported Config:
`sha256:59a026af34789506b0b19d34cf298e034bd16f74aff917cf922d2215e85a6f75`.
Source-engine OCI ID: `sha256:54b936a01ca70bd92c68812450da424fde1d5481908dac4cb2fc8834edc47135`.
Pinned Go1.27.2 WASM: `49946ceb668225b40238e53208f81e14dbf7d1c7d3e95a56ad3106e490284dfb`.
The clean git-archive build excludes uncommitted workspace data. All ten original
dirty screenshots remain byte-identical and uncommitted.

## Verification and preservation

Four new red regressions reproduced the summary/focus defects; four focused checks
pass. Final **36** selected browser workflows pass against the exact image assets,
including seven timezone start/clock/finish journeys, instructor local date entry,
initial saved settings, multiple-attempt selection, restored sessions, password/
OTP/notices/retry, and sixteen signed-in real-WASM clients without starting time.
Typecheck/build and isolated production-maintenance schema24→35/history/enrollment/
native-clock/asset smoke pass. The earlier29 unchanged auth checks and Go client/
private split-identity races apply; no unrelated full-suite rerun is claimed.

Fresh independent web/native guards proved a complete drain. One web session
initially refused the guard; the instructor signed out. No session was invalidated.
Capacity was checked on /data before stopping the idle web service. The exact
qualified image was loaded and only EXAM_IMAGE changed; no new permissions,
configuration values, schema upgrade, CLI/worker/native binary installation or
native service restart occurred.

All **37** durable authority tables match the consistent backup exactly,
including all110 web attempts, grants/settings, source records, clocks and account
holds. Every prior audit and management-request row remains. Signed operational
reports refresh normally. All175 native histories and the native configuration/
CLI proxy are unchanged. Agent4007876, watchdog210730, relay893011 and source-worker
2256672 retain their PIDs. The completed execution-agent consolidation is unchanged.

A copied preservation check initially refused normal expired-nonce pruning and
new management-request history. The fence stayed closed. Read-only comparison
proved that the six removed nonces had expired BEFORE the candidate started and
new entries were fully audited existing-worker **empty-queue polls**. A separate
read-only verifier proves those exact allowed changes, preserves every prior
history row, and requires every student-authority row unchanged. Nine regressions
include refusal of live-nonce loss, student changes/additions, prior request loss,
unaudited/nonempty polling, a different operation and invalid nonce lifetimes.
No application enforcement or production data was changed to satisfy the check.
The original failed receipt is retained; detailed proof records these operational
exceptions rather than claiming nonce/audit tables are static.

Before reopening, real public TLS, all six exact assets, readiness and four fresh
Chromium student/instructor desktop/mobile focus/typing checks pass without page
errors. Browser keyboard-feature detection is stubbed for this UI-only check;
no credentials, sign-in submission, media or human MFA acceptance was performed.
After reopening, public admission routes return ordinary unauthenticated refusals,
finish/evidence remain authenticated, and readiness/assets pass. Static assets
revalidate (`max-age=0`). No student grant or attempt was issued by acceptance.

## Backup and rollback

Root-private full data/config/consistent SQLite/old-image backup remains on marco:
`/data/ssh-exam-backup-ui-followup-20261031-i_9ckmy3`.
Data archive: 13,573,713,920 bytes / 153,827 members;
SHA256 `9324d8bed96b39a56deb0f73c27604f941b77d1c677cdb70c5bf722922a624ef`. No student data left its host.
All earlier backups are preserved. Existing root-filesystem headroom remains a
separate maintenance concern; do not delete student data/backups to recover space.

Rollback is image-only to the previous schema35 image Config1046ca35… /
`ssh-exam-release:prof-6b7c62b`, with CURRENT database/media/authority retained.
First fence new admissions and prove a fresh complete web/native drain, then take
a fresh consistent backup and change only EXAM_IMAGE. Do not restore an old DB or
native state, remove history/nonces/pins/tasks, or restart native services. Verify
current history/config preservation, signed readiness/assets and restore original
nginx bytes before reopening. Prefer repair forward if a guard is uncertain.

Frozen scripts, exact manifests, failures and receipts:
`var/collection-tests/ui-followup-rollout.dgw3btoc`.
Source regressions: `var/collection-tests/student-summary.japy2oc9` and
`var/collection-tests/password-wait.aop_n05o`.
