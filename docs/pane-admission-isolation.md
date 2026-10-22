# Pane acknowledgement isolation (implemented/tested locally)

## October22 follow-up: actual pane filesystem setup

The current local candidate also moves the non-executing filesystem phase of
Engine.local outside WithState, under the existing nonblocking per-UID workflow
fence and a nonblocking single-setup-per-Engine guard, preserving the former
one-copy-at-a-time process budget rather than introducing unbounded parallel
copies. Another opening gets explicit retry/not-a-violation guidance; controls
never wait for that setup guard. This is not a host-wide capacity claim across
old handoff processes. A real Unix/SCM_RIGHTS/PTY regression reproduces blocked independent signed
inspection/admission/close/cancel (RED1.102s). The actual runtime entry now captures
authority under state, does private practice/application/home validation and PTY
setup without shared state, releases the UID fence before ready/ACK, then uses the
unchanged final one-use/current-peer/admission/serialized launch transaction.

Cancellation may remove private files while IO unwinds: setup either refuses or
its final revoked/current-state fence refuses; it cannot revive a cancelled
attempt or execute code. The existing watchdog retries cancelled disposable
cleanup. No new pending record, permission, timer, refund or retention policy is
introduced. The UID fence is released on setup failure and before client waits;
it never lasts for a terminal lifetime. A stuck filesystem can still require
storage repair for that account; it is not a violation or permission to bypass
holds. Inspection/targeted close remain supported by existing `examctl panes
list/show/close` and `info --read-only`, with actionable setup-busy guidance.

Safety review: no clock/lease/source/owner mutation in setup; final admission
rechecks all those authorities, exact token/peer/registration/expiry and capacity.
Cancellation/restart cannot reconstruct a positive admission; an unused capability
keeps its original15s expiry. Partial private data is not a ready-work receipt.
Missing/unconfirmed cleanup never enables work. Actual OS launch/system-manager
readiness and state fsync remain serialized; moving them needs R2's closed-launch
protocol. This does NOT implement C3/C10/C11/C12 or the completed heartbeat fix.

Focused entry/descriptor/ACK/application/practice races pass three repeats6.057s.
Four cases cover close/cancel during pipe-controlled slow setup, real invalid
terminal refusal, injected setup failure, no OS launch, exact received-FD cleanup,
released UID/copy fences, bounded refusal of a second actual entry and cancelled
cleanup not deleting a new preparation. The resource guard was added during final
review after the first broad run started; that earlier-artifact run is not final
qualification and a fresh final native run is required.

End-to-end review found a separate false-positive in this same workflow: the
student UI inferred ownership loss from any error containing `Page` or `owns`.
Ordinary filesystem/native diagnostics could therefore trigger a local incident
and pause. Three real browser RED cases reproduce both false positives and the
missing typed positive response. Gateway session handlers now attach the explicit
`page-ownership` code ONLY at their three verified ownership checks; the UI uses
that code, never diagnostic words. Other technical errors remove only their failed
optimistic pane and display retry information. Genuine ownership handling, all
server/native permission guards, required monitoring and existing deadlines stay
unchanged. Error codes do not grant permission or recover a held attempt.

Actual synthetic SSH/HTTP/WS tests distinguish a wrong-page bind's coded response
from a native pane failure whose text contains both words, preserving ACTIVE and
the original interval. The first follow-up fixture used a non-RFC UUID and failed
before reaching native admission; it was corrected to randomUUID, without
weakening validation. Both final cases pass13.52s. AGENTS.md now explicitly requires
reading focused completion results before launching broad qualification, rather
than batching those steps with an unknown focused result. This app/UI contract
change requires fresh broad app/build/browser qualification; earlier unchanged-
artifact evidence alone no longer suffices. The first full application run also
loaded that invalid fixture (427 pass/two fail); it is not a qualification pass.
No schema or permission migration.

Final native qualification including the resource guard passes core281.826s/
CLI20.327s, with all namespace/user-systemd/compiler/default-size opt-ins. Final
focused entry/application/practice/ACK races pass three repeats6.133s. Fresh17
Chromium monitoring/contact/error/ownership/workspace/session checks pass49.5s;
app/WASM build/typecheck/format and static native build/vet pass. Fresh corrected
full application qualification passes429 tests/81 files94.50s, including actual
compiled root-mapped CLI/TLS and synthetic SSH/HTTP/WS workflows. Logs: /tmp/ssh-exam-pane-setup-{native-final,browser-final,
app-final-corrected,build-final}.log and /tmp/ssh-exam-pane-error-ws-final.log.
The latest pinned csc-sys guard is BUSY; no guest/upload/deployment is attempted.
SSH ancestry and OS exec are private test-only seams (never configurable); the
Unix peer credentials/descriptor/PTY/private filesystem entry are actual. No
privileged real-SSH receipt is claimed for this later artifact. Full boundary
qualification is pending; the earlier historical receipts below are not reused
as new native qualification. Application/browser code/contracts remain unchanged
from b90ba4d, whose429 app/four browser checks still apply to those artifacts.

## Original ACK milestone and historical evidence

October22,2026. No deployment or retained-SSH policy change. Source inspection
confirmed the prior gate.local sent its ready response and waited for the client
ACK inside WithState, up to the100s socket deadline. Signed renewals already use
their independent journal; do not misreport this as a global renewal-lock bug or
the proven initiating production fault. Other state transactions/reconciliation
can still queue behind that network wait. Close-pane also leaves unused pane
capabilities valid, allowing a late admission after a successful close. Both are
corrected in the local candidate; they are not deployed or the proven initiating
production fault.

## Implementation milestone and acceptance

Keep preparation and actual launch serialized under the existing state lock,
but move only response/ACK IO outside it. A provisional ready response grants no
execution. Leave its15s transport-bound capability unconsumed until the final
launch transaction. Close revokes every unused capability for the exact attempt/
pane even if recorded-scope termination fails. A newly issued same-pane token
supersedes older unused tokens; a recorded pane cannot be admitted twice.

Before launch, recheck the exact current capability, actual SSH ancestry, account,
attempt authority snapshot, registration, current policy/deadline/lease, terminal
limit and absent same-pane unit. Ignore only explicitly non-authoritative changing
observations (fresh lease, other panes, diagnostic/timing-receipt metadata) in the
snapshot fence. A clock/reset/owner/generation/workspace/policy change refuses the
stale launch with retry guidance. Consume the one-use token and durably track the
unit before starting code, as before. Bound ACK IO by the original capability's
expiry, require the actual protocol ACK byte and perform no client IO under the
state lock. No new grant, deadline extension, live stop protocol or root retained
mode is introduced. Scope startup/readiness and filesystem preparation still need
further isolation; this milestone must not claim those waits solved.

Required tests: RED close/reissue/duplicate and lock-wait regressions; actual signed
native commands and restart/replay/foreign-owner fences; delayed/error/malformed/
expired ACK, close/pause/reset/cancel/collection/registration/account/workspace
races, no start on failed persistence, fresh independent renewal and management
while ACK blocked; ordinary/practice flows and exact existing input/receipt
protocol. Full native race/resource/default-size/build/vet, application regressions
and guarded actual SSH/PAM/Begin/enforcement/worker-isolation checks. Qualify test
artifacts exactly and retain unchanged host/base evidence. If runtime web sources
or built browser artifacts change, rerun the corresponding browser qualification;
otherwise verify hashes against the prior114-check run.

## Verification and operational boundary

The old close/reissue/duplicate behavior fails the new signed-command regressions.
The candidate passes ten final focused native race repeats6.456s, including a real
Unix socket with withheld ACK, independent signed renewal/inspection/close,
late authority/replay fences and persistence/launch failures. Fresh independent
renewals and other panes/diagnostic receipts do not falsely invalidate a pending
pane. No code starts before durable token consumption/unit tracking. A failed
unstarted launch does not strand a terminal slot; a started unconfirmed workload
remains tracked. Existing generic clock uncertainty is not repaired here.

The new guarded `pane-ack` profile exercises the actual Engine.local through real
authenticated OpenSSH, SO_PEERCRED, PTY descriptor transfer and signed command
channels. A separate root-controlled guest-only sshd/private pinned host key and
the synthetic examq identity are used, not an installed host service. Only the
test binary exposes the delayed-ACK client; production login has no test hook.
An unstarted practice pane withholds its ACK while signed inspection and close
must complete. The late ACK must refuse without a scope, Start or deadline. This
is actual admission-path qualification, not an ACTIVE retained-SSH/freeze test.

Three repetitions pass0.50..0.80s with host/base preservation:
/var/tmp/ssh-exam-overlay-aq3lkw1o. A separate test-only binary deliberately puts
ACK IO back under WithState; all three repetitions fail at actual signed
inspection (15.27..15.66s), with host/base preservation:
/var/tmp/ssh-exam-overlay-wo359vix. Its SHA-256 is
93b07ab804023b5c5d55dcc99b48dfe7fedb19f3121b5285985547b9380b518f.
The mutant is not committed; corrected gate.go is restored byte-identical:
db7a30a45a04c97789497c999193bdc99b62bfa5a37d8e5e5bdae17064bbe1d4.
Final positive confirmation on the same exact correct artifact passes all three
again0.40..0.81s, with host/base preservation:
/var/tmp/ssh-exam-overlay-bc9zk6ws. No old-locking code remains in local source.

The initial real-SSH fixture correctly fails all three authentications because
StrictModes rejects a key path under world-writable /var/tmp. Evidence remains
/var/tmp/ssh-exam-overlay-jqsuc5aq. Moving its exact newly owned test directory
under root-controlled /var/lib and adding its socket directory to the private
fixture's normal-root exclusions fixes the fixture; StrictModes, key pinning and
production filesystem validation are not relaxed. A test-helper compile typo was
also corrected before guest qualification. An earlier quota-failed build/upload
is unused and unqualified, not a test pass.

The same runtime candidate passes40 actual SSH/PAM/Begin/protection/restart/
deadline/restore assertions (/var/tmp/ssh-exam-overlay-ru79kv87), and11 actual
collector-death/healthy-peer assertions (/var/tmp/ssh-exam-overlay-jcont0ha):
23 peer renewals, maximum0.0800769s, fresh pane admission, unchanged ownership/
generation/deadlines and exact40MiB retry. Every host/base preservation check
passes. Exact runtime hashes:

| Artifact | SHA-256 |
| --- | --- |
| exam-agent | a258baab3c95c2b43c18d49095fe4b199590bd6d4e24a71064e293c3f63763f5 |
| examctl | e593ac5d233b1f6c3626f1ca0a01ffc40739c041af213492e53e0f9901a4e952 |
| exam-login | 292fe75a646e911786cedba09253fef782cf396878cccd72f81585b9cb9a464a |
| pane-ack core-qualification.test | 3492f51bf2dee44a7ace0d619b9adf0f60fdf141e8798e6cbe5c86b44f68a57f |

Enforcement/worker-isolation use the same product hashes and earlier manifested
core-testfbafbec70574945d376f001f6e822b193ce58852455f4978389286696aa8380e;
those profiles do not execute that test binary. Do not assign the later actual
ACK qualification to an untested test/release artifact.

Final full uncached native race/resource/namespace/compiler/default-size tests
pass core177.149s/CLI8.957s, static build/vet and35 Python checks pass. All426 app
checks pass91.11s. All174 browser source/runtime hashes match the prior114-browser
run; no web/WASM source or runtime was changed/rebuilt in this milestone. That is
separate exact-artifact browser evidence, not a newly run browser/privileged combo.

The first full native run fails the128MiB template-copy test with EDQUOT on
shared /tmp. It is not a qualification pass. That fixture did not honor the
already selected private disk scratch; its parent now uses nativeFixtureDir,
retaining128MiB bytes, streaming/memory assertions and exact-child cleanup. No
cache/user-data deletion, quota change or reduced acceptance is used. A following
full run also fails actual CLI linking/GCC assembly on the same /tmp quota. Only
the agent-created temporary artifacts and4.7GiB Go build cache are moved into an
owned private disk-scratch child, retaining the evidence. The final full passing
run above uses that disk cache and the original complete test matrix. The initial
sandbox socket EPERM is not a missing command; the authorized owned-socket run
passes without weakening its real Unix interface assertion.

Operator diagnosis remains `examctl info ATTEMPT --read-only` and `examctl help
info`; captured unit counts are not live SSH, monitoring or freeze evidence.
Use the normal client to reopen a refused new pane only when its current attempt
policy permits. Never reset a clock, clear a hold or restart an installed agent to
work around a pane refusal. Per-pane root management/discovery remains a CLI gap
in the broader C1 inventory, not an excuse to require ad hoc state edits.

Future rollout is drained and compatibility-checked, not executed: new ready replies
remain provisional on the existing wire format, but old agents do not revoke
closed tokens or fence the outside-lock ACK transition. No schema migration is
needed for this milestone. Preserve state/capabilities/archives/holds and do not
roll back by restoring old records over newer work. Qualify exact clean release
artifacts again, retaining independent watchdogs. Temporary-agent consolidation
is still only the separate drained proposal in todo-rollout-plan.md.
The complete C3 admission/freeze/recovery protocol and C10/C11 decisions remain
open. No historical attempt, protected submission, deadline, hold or installed
configuration is changed by this development work.
