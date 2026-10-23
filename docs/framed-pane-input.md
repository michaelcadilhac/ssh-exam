# Framed pane input — implemented/tested locally

October 23, 2026. Nothing deployed. This connects actual captured keys/resize and
pane events end to end; it is a necessary boundary of the retained-workload plan.
**No C3/C16 retained hold, live monitoring authority, all-writer freeze/input
discard or automatic technical recovery is enabled. Current pauses kill shells.**

## Delivered workflow and boundaries

Registered scoped student terminal → running JS producer → IPC/WASM →
authenticated SSH → signed native admission → attempt supervisor → inner PTY.
The same UI UUID can be closed/reopened without old queued keys, resize, output
or EOF affecting its replacement. Framing is never interpreted as raw input.

Running JS offers loaded_pane_input:v1 separately from the running WASM codec and
signed native framed_pane_input:v1. Native offers framing only for supported
student accounts; trusted host/admin service workflows keep their legacy protocol.
Direct framed requests on those exceptions refuse. Unregistered legacy/practice
panes and the Node proxy retain existing raw behavior. Future retained Begin must
refuse unsupported loaded roles; this codec negotiation does not establish C3.

Distinct issue-framed-owner-channel-admission requires the current supervised
BrowserSSH owner/page/account/transport/boot/generation/clock and ACTIVE interval.
Fresh per-pane packet epochs differ from the attempt authorization epoch. One-use
capabilities and supervisor requests use purpose exam-framed-v1: older native
readers/owners refuse it instead of dropping an unknown epoch and forwarding raw
bytes. The loaded entry offers v1 and becomes raw BEFORE publishing READY.

EXINv1 keeps the existing data fixture. Header byte5 selects data0 or resize1;
resize has eight network-order dimension bytes, each 2..500. Other reserved bytes
remain zero. No deployed framed client used the earlier unused codec. The actual
supervisor checks pane/epoch/sequence before delivery; resize record-before-apply
runs in an independent one-entry/coalescing worker and rechecks cancellation after
recording. This is not the future revocation/drain/discard barrier.

Browser input and resize share one ordered per-pane queue. In-flight plus queued
framed work is bounded to 64 frames/65,536 UTF-8 payload bytes. Overflow retains no
extra promise/bytes, never replays/reset sequences, and produces a coalesced,
nonmodal unsent-input notice. It does not declare SSH/authentication loss or
misconduct. Explicit worker IPC instances and native event epochs fence late
close/output/commands across replacement; matching current events still work.

Read-only `examctl panes show ATTEMPT PANE` exposes captured input_epochs;
`examctl help panes` explains these are metadata, not input/monitoring permission,
a writer drain or freeze proof. Existing reviewed close/cancel/inspection applies.
No new management mutation, account/grant reservation or clock is introduced.

## State and shared-writer review

Existing fifteen-second capability/startup expiry, one-use revocation, exact
account/peer/current owner and final post-save closed release remain mandatory.
Missing/mismatched proof or loaded role refuses. No disk record reconstructs live
permission after restart, continues an attempt, releases a hold or refunds time.

All PaneInstances assignments were reviewed: closed startup copies the epoch
through readiness; cancellation/reaper and recording acknowledgement writers copy
the existing proof. The legacy service constructor cannot produce framed work:
admission refuses host-service exceptions and registration omits their codec
rather than making their existing admin workflow unusable. Pending review hashes
include the epoch; no legacy backfill. Decoder sequence lives with its pane.

Queues/IPC instances/events are ephemeral and cleared/fenced on close/logout.
Stale/overflow/replayed packets never acquire a later epoch. Optional local WASM
ChangeInputEpoch is only a client stale-completion fence; no verified native C3
continuation producer is wired, and it cannot rotate native permission by itself.
Recording/collection bounds, original deadlines, history/holds and credential
cleanup remain intact. No recording/storage wait is added to the native decoder.

Private root qualification uses actual immutable-catalog CLI install, NEW initial
grant staging, authenticated outbound C15 Begin, protected account handoff,
signed owner/pane admissions and real SSH/PTY/cgroups. Its callback accepts only
one explicitly selected synthetic grant/settings/intent/page/transport from a
root-owned mode 0600 registry, not a wildcard. The registry itself admits no work/clock and
disappears with the guest. Continuous host busy/uncertain guards and preservation
checks remain mandatory. No production configuration/student records changed.

## Current qualification

| Surface | Evidence |
| --- | --- |
| Application/integration/compiled CLI | 533 tests / 97 files PASS 292.96s |
| Final native signed-entry/actual gate/CLI/READY/input focus | PASS 5.568s |
| Full final native race/resource/userns/compiler/default-size | core PASS 412.027s; CLI valid cached unchanged binary (earlier 35.950s) |
| Real encrypted SSH client/full race | PASS 1.572s |
| Built real Chromium/WASM stale-key/same-pane replacement | final focus PASS 8s; also passed in broad run |
| Browser broad + corrected fixture | 150 PASS / 1 FAIL, 15.6m, then corrected additional-grant case PASS 9.2s / 12.7s total; all 151 covered, NOT one all-green full run |
| Build/static/safety | app/WASM/native builds, types/native/client vet and 35 Python checks pass |
| NEW exact root framed-owner | 10 assertions PASS, wrapper 0; /var/tmp/ssh-exam-overlay-i8zj8ijj |
| NEW exact root legacy timed-owner | 9 assertions PASS, wrapper 0; /var/tmp/ssh-exam-overlay-0kijbqh_ |
| NEW exact root collector isolation | 12 assertions PASS, wrapper 0; /var/tmp/ssh-exam-overlay-t_ot0ga5 |

All root runs pass host binaries/config/authority and guest-base preservation.
Framed root checks observe actual resized inner PTYs and subsequent positive
shell-memory responses after rejected exit frames, fresh same-UUID epochs,
protected collection and original-deadline SSH/SFTP/account restoration. Current
policy pause terminates shells as an explicit negative retention control.
Collector SIGKILL affects only its target; 24 healthy renewals (maximum 0.0842s),
independent owner/panes, exact 40 MiB retry and original intervals are preserved.

Final native agent:
cbf0f9e04828fc3a20590c3d556e8d1a1013aa729e2dcdcaac7bb0254b7225d9.
Core test:
c2f46bf576e4f13175cd3bad1b5d48d18b4995d896fdc3cf2fac361092462e42.
Audited 17-file code-only bundle:
/var/tmp/ssh-exam-framed-input-upload.I9Wjwk/bundle-supported;
local path /tmp/ssh-exam-framed-supported-artifacts-path.

Frozen manifests (all match at completion):

- 581 source files: /tmp/ssh-exam-framed-qualified-source.sha256;
 hash 360de2a804cee8e09b9c3d28b633f374dc9a8849decc627e901bad9e55ec6e0c.
- 58 client files: /tmp/ssh-exam-framed-client.sha256;
 hash 1ae447872f86ad990ab6bcf3436ab362fb495df72fdabcc70d1dcd098bce9a9e.
- 65 server files: /tmp/ssh-exam-framed-server-build.sha256;
 hash 30205b9c38fbee4b59db2b9f822dc67524878c7d50e91b02a79388f42a05285b.

Logs: /tmp/ssh-exam-retained-framed-*.log. Earlier9bedbda5 native and receipt
milestone artifacts are superseded, not qualification of this current binary.
Nine newly generated screenshots were restored; the original dirty preflight
screenshot remains 31754 bytes / SHA256 144029a4ed00609c40b57f14c90ebe8888fede0d0f1cd11acda4cf1ca4b68eeb.

## Defects, controls and retained failures

Actual READY-before-raw regression RED 0.021s. Removing only the native epoch check
with a Go overlay makes stale finish input kill the real synthetic shell and
fails its later positive memory response (RED 0.775s). Working source was not
mutated. Owned local fixtures mock root SSH ancestry/scope paths; their kernel
PTY/process/systemd behavior is real. The separate current root runs above cover
the privileged boundary. Signed admission tests also exercise refusal stages,
raw-bypass/no-fallback, fresh epochs and unchanged intervals.

The browser workflow exposed/fixed three actual pipeline defects: unscoped early
resize opened a false modal; resize after local close hit the old framed pane and
was reported as SSH loss; old EOF/output crossed IPC/WebSocket replacement
boundaries. Queue regression showed 1000 actual sends instead of 64/2 before the
bound. Final real WASM test holds an original keystroke before delivery, reopens
the same UI UUID, releases the old packet and proves fresh UTF-8 input works with
unchanged authentication/ACTIVE interval. No private typed contents are logged.

Late signed-entry RED 0.021s proved host/admin registrations advertised unsupported
framing. The supported-offer correction triggered NEW full native/root builds and
all three NEW root profiles. Existing app/JS/WASM/client artifacts were positively
unchanged, so their evidence applies; no older native receipt was substituted.

The broad browser failure occurred before its authenticated destination response:
the final snapshot contains the expected selector/two grants and an unchanged
focus passes 9.9s. The fixture now independently bounds/observes HTTP summary200,
asserts both exact grants, then checks the UI. Corrected focus passes 9.2s. No
product timer/enforcement changes; 150 unchanged scenarios retain their evidence.
The failed broad log remains, not labelled green or a policy refusal.

Three root-fixture failures are retained, all with host/base preservation:
legacy private material permissions (o6ofu363), reused initial-exam history
(9u4mmidb), and a guessed transport key after actual C15 Begin (pj495pxr). The
fixture now authors NEW public synthetic source/exam, preserves history and uses
the actual transport_hash serializer. No guard/base permission was relaxed. Only
fixture changes reused unchanged native artifacts; the later real native offer
change was fully requalified. Earlier canonical-PTY/held-slave-FD and child ioctl/
flag-separator fixture failures were corrected without weakening refusal oracles.
Initial missing-client-API compile RED is not counted as behavioral reproduction.

## Next integrated result and rollout limits

Continue actual policy-pause → verified retained hold → instructor-approved
Continue with the SAME SSH, shells/editor buffers and authoritative interval.
Wire C16 inside the existing ONE supervisor per attempt, isolated from recording
IO, with pinned root SSH ownership, independently enforced live expiry, all-writer
stop-assisted freeze and revoked/drained/discarded input. Explicit continuation
must rebind current cohort/recording-fault authority without weakening stale-report
fences. No standalone controller test closes that workflow or the critical TODO.

Future separately authorized rollout/rollback must qualify matching loaded roles,
drain all independent owners plus canonical/temporary agent services, preserve new
proof fields/history/grants/nonces/receipts/holds and never stop needed PTYs to
force a downgrade. Keep admission closed and repair forward when compatibility
cannot be proven. Temporary-service consolidation remains proposed/unexecuted.
See todo-rollout-plan.md. No deployment/restart/consolidation is authorized.
