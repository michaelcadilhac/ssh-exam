# Interruption review and authorization

October 21, 2026. C1f implemented/tested locally; full qualification is recorded in
todo-progress.md. **Not deployed.** Synthetic local keys/accounts/records only.

## Supported workflow

```sh
examctl web interruptions help
sudo examctl web attempts list midterm --view attention
sudo examctl web interruptions show ATTEMPT
sudo examctl web interruptions review ATTEMPT --section history
sudo examctl web interruptions review ATTEMPT --section requests
# Review every relevant page; use returned generation and review revision:
sudo examctl web interruptions authorize ATTEMPT --generation 2 --revision 7 --reason 'Reviewed screen-sharing interruption'
sudo examctl web interruptions show ATTEMPT
sudo examctl info ATTEMPT
```

Existing real/effective-root agent authentication, pinned outbound HTTPS and
purpose/audience/fresh nonce/request replay rules apply. Explicit gateway
managementOperations separately authorize interruptions.show/review/authorize;
default authorization is none. The actor is authenticated agent:ID:root, never
an invented human from SUDO_USER. Web administrators retain role/Origin/CSRF
checks and use the same service. No new class-server listener or control API,
student credentials or unsynchronized offline authorization editor is added.
Offline native info inspects local state, not private gateway review history.

Show returns bounded current gateway metadata, generation, monotonic review
revision and the existing approval's expiry/consumption. It is not fresh native
freeze/readiness verification. Reuse of a show request returns the old snapshot;
use a new request for fresh state. Inspect native info separately when needed.

Review returns private interruption reasons/authorizations or student requests.
Use a private terminal; copying the output creates another sensitive copy under
the operator's responsibility. No file is created automatically. Pages default
to 20 entries, maximum 100, sorted by ID (not chronological), with exclusive next
cursor. Following --after requires the first page's --revision; a changed revision
refuses and requires restarting from the first page, not skipping changed earlier
history. Current revision/generation accompany each page. Malformed/oversized
stored entries refuse without including private fragments in errors. Per-string,
row-count and UTF-8 response bounds apply before transport signing.

## Confirmed correctness fix and deliberate authorization

Previously the web authorize endpoint accepted an empty body and selected the
current generation at submission. A new interruption could therefore receive
authorization even though the instructor reviewed an older one. Additional
reasons/student requests can also change within the same locked generation.

Migration 016 adds an additive continuation_revision counter and successful
continuation_requests ledger. Conditional SQLite triggers advance the counter
for actual relevant attempt state/timing/protection, interruption-history,
incident/request or continuation changes, including writes by compatible older
code. Identical state reports do not invalidate review. Counters neither hash nor
copy private message contents. Existing identities, clocks, holds, protected
submissions and monitoring retention are not rewritten or reinterpreted.

Authorization requires the exact reviewed generation AND review counter, a
stable request UUID and an 8..1000-character audited operator reason. This is not
the clock revision or definition hash. Changed reviews refuse with current state,
generation/revision/deadline and exact inspection commands. Old empty-body
clients must reload. The web confirmation captures selection and request identity
when opened; polling cannot silently adopt a replacement. Cancel returns focus;
failed/lost replies preserve the reason/intent. Editing the reason creates a new
intent without adopting a newer generation/revision. Do not paste private student
messages into a permanent operator reason.

Only started LOCKED, unfinished, unprotected attempts before the current deadline
are eligible. One captured acceptance instant caps expiry at the earlier of five
minutes or that deadline. Exact browser/root child retries recognize the original
result across restart, including after expiry or a later approval; they never
replace a newer grant or extend the old expiry. A deliberately new intent after
fresh review can renew an unused approval under existing rules; history retains
replacement/consumption/revocation. Browser/root validation, grant/history/audit/
intent commit is atomic and has no native/network waits in SQLite.

Approval alone does not execute/thaw work, reset/refund time, change deadlines or
account restrictions, reopen completed attempts or replace submissions. Existing
fresh SSH, page ownership, current monitoring/readiness, generation and native
Continue enforcement remain mandatory. **C3 retained SSH/buffer freeze is not yet
enabled.** Do not describe this increment as implementing retained SSH.

## Private read retries and retention

Ordinary management reads cache metadata outcomes. Private interruptions.review
is deliberately different: persist only its scoped attempt/generation/revision
receipt, never reasons, student messages or authorization history in management
outcomes. After that transaction, each initial read/retry re-reads a bounded
retained snapshot and rechecks revision and tombstones before signing. Each
successful private read is audited with metadata only. Changed history refuses
with a fresh-intent instruction; deleted monitoring returns a refusal even for
an old successful receipt. A cached receipt cannot resurrect deleted text.
Read failure after receipt storage may therefore leave a successful metadata
receipt but a signed refused private response; that is not a mutation or replay
permission. There is no permanent full-payload digest of private student text.

Operational audit retention remains unchanged. Existing student review-request
audit/mail handling is not retroactively erased by this work. This increment adds
no new indefinite copies of those messages. Manual monitoring deletion/60-day
expiry and protected-submission retention remain separate.

For a lost mutation reply, retain the printed --request UUID and identical
arguments. --intent defaults to that parent ID; retaining an old child under a
new parent recognizes the same original approval. A signed/cached authorized
response is a receipt of the original operation, not proof of current permission;
check fresh show for state, generation, expiry and consumption.

## Qualification and future rollout/rollback

Tests exercise actual compiled namespace-root CLI -> local TLS -> real gateway,
explicit authorization/restart/retry, same-generation changes, scoped private
reads and tombstone replay refusal. Unit/HTTP tests cover authority/CSRF, exact
generation/revision, no-op reports, deadline cap, completed/protected/unstarted
refusals, audit rollback, deliberate renewal and original retry, bounded/malformed
privacy-safe reads and pagination. Browser checks cover deliberate confirmation,
desktop/mobile lost reply, polling and stale selection/focus. Native records in
HTTP fixtures are synthetic; no installed host-root/PAM/freeze claim follows.
Full regression results remain in todo-progress.md.

Any future separately authorized rollout needs drain/consistent private backups,
matching gateway/browser/CLI and preserved migration 013/016 request records,
counters/tombstones and original intervals. Reload old clients. Keep triggers on
rollback; an older gateway accepting unreviewed empty-body approval cannot uphold
this fence even though triggers still advance counters. Do not downgrade with
live authorizations/clients unless admission and authorization writes remain
safely quiesced, or repair forward. Never restore an old database over newer
deadlines, approvals or deletion tombstones. Temporary-agent consolidation and
all deployment/migration/rollback execution remain proposals only.
