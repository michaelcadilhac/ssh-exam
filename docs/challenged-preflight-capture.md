# Challenged preflight capture and Begin

October23,2026. Implemented/tested locally; nothing deployed. This is a
bounded pre-start workflow within the critical monitoring work. It does not
enable C16 live execution authority, retained policy pauses, verified all-writer
freeze, or automatic technical recovery. Current policy pauses still kill shells.

## Actual workflow and acceptance

The student shares the required display/camera in preflight, enters fullscreen
and keyboard lock, then confirms Begin. Capture.sample obtains an authenticated
current-page server challenge BEFORE drawing a new JPEG. Setup and five-second
preflight samples use that route; Begin waits for any in-flight sample and takes
fresh samples of all required sources with current conditions. Buffered legacy
images are never given a new challenge. Active legacy capture remains unchanged.

Authenticated HTTP routes issue a challenge, accept a decoded JPEG, and inspect
readiness. Freshness starts at server CLOCK_BOOTTIME challenge issuance, not the
client's timestamps or image arrival. The oldest required source and current
policy observation must be less than fifteen seconds old. Begin checks before
setup and again immediately before dispatch. Failure leaves preparation retryable;
it is not a policy violation and consumes no clock or grant.

Unified native Begin uses the existing pinned outbound HTTPS/signature route,
with distinct grant-begin/v2 request/reply. After exact claim/intent/owner/settings/
window validation, the gateway rechecks current challenged readiness. Its signed
capture_valid_for_ms is at most the remaining original freshness interval. Native
code conservatively charges the WHOLE exchange from local CLOCK_BOOTTIME request
issue, also clips by signed wall-clock expiry, and rechecks the resulting boot
cutoff before final commitStart, after final metadata work. Wall-clock skew cannot
extend the capture bound. Malformed/missing duration, legacy purpose, delayed or
wrong-scope replies refuse before consumption. Old/new roles refuse mixed Begin
contracts; there is no fallback. Exact retries of an already committed original
interval do not require a new observation or start another clock.

Legacy unconverted preparation has the gateway pre-start check, but lacks this
unified native callback. It is not qualified for future retained/live authority.
This increment establishes initial readiness only, not uninterrupted coverage or
permission to continue an active attempt. The existing live-evidence ledger is
not relabelled as a pre-start permit. C3/C16 integration remains necessary.

## State and proof-writer review before broad qualification

No database migration, new pending operation, account reservation, work permission
or saved permit is added. Existing Begin intents and their cancellation/history
semantics remain authoritative. verified_at updates only after freshness passes.
An issued challenge alone has no effect on grant availability or execution.

The bounded process-local cache holds at most512 attempt scopes and32 tickets per
scope, pruning tickets older than30 seconds and abandoned scopes after120 seconds
under admission pressure. Scope includes attempt/current page/generation/exact
saved settings. A replacement scope invalidates all earlier tickets. Each ticket
binds one source, issue ordinal and existing sequence floor; successful acceptance
binds exact JPEG hash/frame ID/sequence/policy. Exact retries preserve original
age, never refresh it. Older source observations cannot overwrite newer ones.
A negative policy observation also requires a challenge issued after that report;
an earlier positive reply cannot conceal a delayed negative. Exact bad retries
cannot repeatedly move this barrier. This is preflight retry state, never a
policy lock, active coverage claim or permission to execute. As with the existing
browser policy model, the loaded client supplies the observation; a nonce is not
physical-camera or tamper-proof browser attestation.

JPEG completion rechecks current canonical scope/tombstones before storage and
before readiness publication. A late invalidated/deleted upload cannot establish
freshness. If synchronous storage completes across expiry, a historical image may
exist while readiness refuses; that is not a fresh observation. Deletion is still
durable and cannot be undone by cache state or late uploads. Cache loss/restart
requires new challenged capture; frame rows never reconstruct permission.

The browser bounds each new API exchange and aborts it on stop. Failed/expired
preflight upload is retried with a NEW challenge/sample, not queued permission.
The existing capture timer remains installed after an initial upload failure.
Begin rereads browser conditions after asynchronous capture work. The native
cutoff remains private to that one in-flight original Begin, never persisted as
authority or restored after restart. Deadline/window/account/grant checks and
protected source/history invariants are unchanged.

## Verification

Qualification passes below. Real authenticated HTTP/JPEG tests cover screen-only
and webcam quorum, exact retry age, expiry, sequence rebinding, malformed images,
page/generation replacement during blocked decode, and deletion. Only the evidence
clock is synthetic. Steady-state/capacity/restart/clock tests exercise cache bounds;
browser Capture tests observe nonce-before-draw, no legacy-buffer relabelling,
failed-upload retry and stopped late completions. Signed SSH/web Begin tests cover
legacy-image refusal before intent creation and expiry at outbound verification,
then retry with the original grant and full allowance. Native signed TLS tests
exercise protocol/duration/transit/final-metadata expiry before clock commit.

Browser acceptance uses actual JS/WASM/SSH and application HTTP with synthetic
media and simulated native policy. The explicit challenge-path failure injection
must leave PREPARING/no intent/no interval/no policy pause; a fresh retry then
starts the saved full allowance. These application fixtures do not prove native
root SSH pinning, retained containment, or class-capacity qualification. Root owner
qualification separately uses a disclosed synthetic capture attestation; it is
not proof of real gateway monitoring coverage.

Focused final readiness/capture/owner checks PASS11/4files1.42s. Versioned actual
SSH/web cohort had58 passes and one mixed-revision clock fixture failure; final
separately frozen small checks supersede that failure, not a claim that mixed
inputs qualified. Initial focused grant/capture25 and affected preparation29
passed before final protocol work. Final native signed TLS/transit/final-commit
focus PASS26.491s, including expired refusal and a still-valid delayed reply which
must not double-charge transit. The previous double-charge model is RED2.781s.
The reply-re-aging Go overlay mutant wrongly starts the synthetic exam and is
RED2.283s; working source was not mutated. Broad runs must qualify current frozen
artifacts, not these earlier/private receipts.

First browser focus failed because failure injection started before the first
sharing upload completed, leaving an actual setup error dialog over Begin. The
fixture now awaits its accepted challenged image and enabled Begin before the
injection, with bounded actions. Corrected actual JS/WASM/SSH/HTTP focus PASS6.3s
(9.8s total): no intent/time/violation on failure, full saved allowance on retry.
No runtime artifact changed for that fixture correction. Final full browser
PASS151/15115.4m, one green run on the frozen candidate.

Frozen candidate broad application PASS543/100files293.68s; full native race/
resource/userns/compiler/default-size PASS core424.920s/CLI39.772s. App/WASM/server
and private native builds/types/vet pass;35 Python safety checks pass after the
cwd-only runner correction. Current-source re-aging overlay is also RED2.281s.
NEW exact root framed-owner PASS10, wrapper0/preservation, evidence
/var/tmp/ssh-exam-overlay-ipa67tsq. NEW exact timed-owner PASS9, wrapper0/
preservation, /var/tmp/ssh-exam-overlay-7h83rvrh. NEW exact collector-isolation
PASS12, wrapper0/preservation, /var/tmp/ssh-exam-overlay-3ayhs3xw;24 healthy renewals
max0.0893566683s and exact40MiB retry/original deadline restorations. All runners
have ended. Built-server readiness/native-clock smoke passes without listeners
or state files. Original dirty screenshot remains exact. Nine other screenshot
changes from the browser run remain untouched/unstaged and have private backups
(path marker /tmp/ssh-exam-challenged-screenshot-backup-path). Automatic approval
review rejected discarding them because their ownership was not established in
its context; no workaround or restoration was performed. No deployment or
production/student mutation.

## Frozen artifacts

The17-file private code-only60.5MB bundle is
var/collection-tests/challenged-begin-artifacts.z4tndbv9 and
/var/tmp/ssh-exam-challenged-upload.dyyBAv/bundle. Agent SHA256
2ec3a74f13f721fb35122864207135026e0062864ab4cbd5b31f115836f56305;
core testc77317666dd2674170730a1d38253e64a32e844024a4f97e308d3f3ca374ec9c.
Native binaries were built from frozen source with BuildInfo85a4227/modified=true;
a later commit changes Git metadata, not those qualified artifact bytes. Do not
infer a rebuilt binary's qualification from this bundle.

All final source/build hashes were verified unchanged after qualification:

- 550-source /tmp/ssh-exam-challenged-source.json:
  945bad019f8499658ceaa887ec878bfc757d850349bd068d8aad9349361a0da2.
- 59-client /tmp/ssh-exam-challenged-client.json:
  5500492063db593613fee3bac0c7b5950c6e0465c14cd5f3aa914c8ff5ac7f54.
- 66-server /tmp/ssh-exam-challenged-server-build.json:
  3841edd0244dcf35c924bc776d896267f9440ad91227ec550d3ede6abec9396b.

Mixed-revision/fixture-only failures above remain part of the evidence; final
frozen full passes supersede them. No inactive observer/helper is counted as
delivering C3/C16 or the full critical liveness workflow.

## Operator and compatibility guidance

Use examctl web grants show GRANT_UUID and examctl info ATTEMPT --read-only to
inspect original claim/native status before retrying an uncertain Begin. Refresh
preflight capture on verification refusal; reload obsolete browser bundles and
qualify matching gateway/native Begin roles before any future drained rollout.
Never reset a grant/clock, remove a source/intent, or relax monitoring to clear a
capture refusal. No new management operation is introduced by this increment.
The supported grant/operator workflow remains in initial-grants-cli.md.
