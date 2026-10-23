# Exact renewal receipt recovery (implemented and tested locally)

October23, after00c6c7f. No deployment or retained-mode enablement. This is a
bounded critical-liveness workflow, not another unused authority component.

Entry: actual browser/WASM or supported server-proxy heartbeat renewal, through
its authenticated SSH command and native per-attempt lease journal. If native
commit succeeded but its reply is lost, recover the original immutable receipt
over a second authenticated command channel, without prompting for credentials,
locking the student, changing time or creating another renewal from that query.

Implement only with explicit signed native feature negotiation and distinct new
renew/query purposes. Legacy one-use renewal replay rules remain unchanged. A
receipt query must positively match the original nonce, current account/transport/
boot/page/generation/clock, ACTIVE unexpired native authority and original cutoff.
Charge the whole query round trip against a native remaining-time observation;
never infer freshness from cross-host wall clocks or the outer signature expiry.
Missing/stale/revoked/contradictory receipts grant nothing. This does not restore
the new C10 live authority from disk; that mode is still unimplemented/disabled.

The short probe threshold is NOT a new failure timeout. Keep the original
command pending if recovery cannot be proved; do not introduce earlier locks.
After positive recovery, cancel only that original command channel, retaining
SSH/PTYs/authentication. Bound/coalesce outstanding commands and release them;
repeated lost replies must not accumulate channels, goroutines or pending RPCs.
Continue checking current gateway page/socket/generation and actual native policy;
a receipt never reverses a lock, deadline, finish, account hold or later approval.

Runtime callers in this milestone: native signed command dispatch/lease journal;
both Connection.command and BrowserConnection.command; the existing WASM command
runner for exact-channel cancellation. No new authority daemon, global Engine in
an owner, unrelated RPC abstraction or future-only helper. Existing CLI info
--read-only remains the supported lease/interval inspection workflow; document
recovery diagnostics and actionable refusal guidance alongside the live feature.

Acceptance and stopping boundary:

1. Reproduce committed renewal/lost reply through actual signed native commands.
   Query preserves first cutoff, interval and journal; legacy replay still refuses.
   Test wrong/missing/replayed/stale nonce and all owner/clock/policy/deadline fences.
2. Actual gateway/browser interfaces recover repeated lost renewal replies while
   captures, same SSH/shell memory/input and deadline stay healthy. Verify exact
   command cancellation and bounded outstanding work, not only helper results.
3. Query loss/stall/refusal must not create an earlier timeout-based policy lock.
   Genuine native negative state, policy loss, transport death and expiry remain
   authoritative. No automatic refunds or historical-attempt reopening.
4. Review new durable receipt capacity/expiry/restart/stale outcomes before broad
   application/native race/build/browser qualification and guarded exact-artifact
   native guest coverage. Preserve failed evidence and all host/base guards.

This addresses the supported fault envelope of a lost reply after a successful
legacy renewal. It cannot prevent expiry when every evidence/delivery path fails;
the full C16 live authority, C3 verified hold/input barrier and C9 recovery remain
required and unchecked. Do not claim the initiating production cause established.

## Implemented candidate and review before broad qualification

The actual signed native entry, both gateway transports, private canonical
parent/worker signing and the running WASM client are connected. Signed register
negotiates native v1; browser recovery additionally requires loaded WASM exact-
command cancellation. Old clients/agents retain their original behavior. Checked
Linux CLOCK_BOOTTIME bounds the full query round trip, including gateway suspend;
clock failure disables optional recovery without substituting another clock or
starting an earlier policy timeout. Probes coalesce through delayed confirmation
and command-channel EOF, which is distinct from actual transport death.

Durable and intermediate state review:

- At most64 original receipts per private lease journal, each with the original
 15-second wall/boot cutoff and exact exam/UID/start/deadlines/context. Expired
 receipts prune on subsequent renewal; command nonce replay protection retains
 its existing expiry independently. Capacity refusal consumes no nonce/permission.
 Later leases cannot refresh an old receipt. Query repeats never write a lease,
 consume a grant, start time, release a restriction or reserve an account.
- The publisher's exclusive lease lock covers file/directory sync and revocation
 recheck. Query takes a nonblocking shared lock, never the global transaction.
 A visible replacement/released failed writer is still insufficient: the SAME
 live agent must have the exact completed publication hash in its ephemeral
 confirmation cache. Restart/different Engine cannot reconstruct it from disk.
 Cache has at most4096 entries, expires on subsequent confirmation and never
 evicts another fresh account. Saturation means recovery unavailable, not failed
 renewal or manufactured confirmation. No new class-capacity claim is made.
- Current ACTIVE state, registration, transport/boot, page/authorization epoch,
 generation/clock, UID and original/current interval must still agree. Native
 remaining time clips original receipt, current authority and both deadline
 clocks. Protected/completed/locked attempts cannot recover. No receipt is a
 new C10 live-authority seal, per-pane epoch, hold or thaw permit.
- Parent signing supplies only a transient canonical scope for negative-state
 attribution; it is stripped from the browser/native envelope. Foreign/stale
 negative probes cannot manufacture a policy lock. Fully matching signed native
 policy/end states remain authoritative. Probe absence/refusal/timeout leaves
 the original operation/error path intact; the30-second probe budget never
 shortens the original120-second command bound or changes native15-second cutoff.
- Fresh positive recovery decides the response before asynchronous cleanup.
 Cleanup retires only the exact original command, not SSH/PTYs/passwords/MFA.
 Browser RPC cleanup has a one-second bound; the WASM client bounds64 tracked
 commands and closes their own SSH sessions on cancellation. Failed/late cleanup
 is not misconduct, root execution permission, absence proof or a freeze receipt.
 Cancellation is never issued on an invalid/expired/unconfirmed recovery probe.
 Real transport death and current page/connection replacement still win.

Focused actual HTTP/WS/isolated-worker/SSH tests pass held and EOF reply loss,
2.5-second delayed publication, repeated recovery with stable pane/auth/interval,
invalid/expired/unavailable/foreign negatives and a genuine native policy pause.
The first delayed-publication regression failed the one-probe implementation;
bounded coalesced probing fixed it. Real encrypted SSH cancellation preserves a
sibling command and terminal IO. Clock-unavailable and synthetic suspend-gap
checks pass without changing a host clock. Rebuilt Chromium/WASM passes the actual
dropped native reply workflow. These focused checks preceded the separate broad
and real-root qualification recorded below.

Existing supported operator inspection remains examctl info ATTEMPT --read-only
and panes supervisor/reports. A captured lease timestamp alone is neither the live
confirmation cache nor current ownership/monitoring permission. No new management
action or hidden root/network control endpoint is introduced. Schema029 stays;
lease fields are additive and older readers ignore them. Future rollback/cutover
still requires verified drain and matching loaded agents/watchdog/gates/owners,
preserving all newer state/nonces and the proposed temporary-service consolidation.
No migration, rollback, deployment or consolidation is executed here.

## Frozen candidate and qualification

Focused native signed-entry cases PASS16.495s, including exact registered-page
scope and an actual original15-second expiry while a later renewal stays active.
A Go-overlay mutation bypassing live confirmation is RED0.018s; a replacement
agent cannot reconstruct confirmation from disk. The working source was not
mutated. Eight integrated held/EOF/delayed/refusal/policy cases PASS51.59s; two
clock-unavailable/synthetic-suspend cases PASS4.68s. Real encrypted SSH exact
cancellation PASS1.049s and full client race PASS1.572s. Actual Chromium/WASM
dropped-reply focus PASS12.0s. Delayed-publication RED11.66s remains recorded;
coalesced probes corrected the original one-probe implementation.

Fixture corrections are not product passes: the first SSH mock used the wrong
Reply return signature, expected an ACK byte consumed internally by exam-login,
and compared encoded terminal output as plain text. It now follows the actual
EXAM-READY channel boundary and decodes output before its sibling-pane oracle.
Negative mock command replies are root-signed, matching the real native protocol;
foreign negative identity remains a refusal, not a manufactured policy lock.
Failed logs are retained under the same temporary feature prefix. No production
guard or cancellation/ownership oracle was relaxed to obtain these results.

Final source has551 files, manifest SHA256
e6d98315111d0a695686202e5b850949925ce2b03762a55cf64a220db268e1b3
at /tmp/ssh-exam-renewal-receipt-qualified-source.sha256. The audited private
17-file bundle is /var/tmp/ssh-exam-renewal-receipt-upload.ihb3080l/bundle:

- exam-agent8ba2588bd917852d38063a1bb3b8c4ba53ac69ce3aead3a01d2c5401b0fc64f7
- core test6408147f18a2ed525fb861d2d95aba46313dd6cae28d4ea0fe830e26cffbfcff
- runner8695cbf4d5467e0dfd62ba6b9946a0320fc640d3fa44e053f0fdd368ab5274b8
- WASM130d55c64767d566c6f47b7dce7b41b35b550b25a78fa99b0c07db4495f644f3

All native/web/WASM builds, vet/types and35 Python safety checks pass. Full
application PASS524 tests/97files284.09s. Full native race/resource/user-namespace/
compiler/default-size IO PASS core431.478s/CLI39.509s. Full browser qualification
PASS150/150 scenarios in15.2m, including the new actual WASM case11.0s. Frozen
source and all six client artifacts still match after completion. This is a
single complete green run, rather than combined coverage from separate runs.
Logs use /tmp/ssh-exam-renewal-receipt-*.log; client hashes are in
/tmp/ssh-exam-renewal-receipt-browser.sha256.

The guarded exact-candidate timed-owner guest PASS9 assertions, wrapper exit0
and host/base preservation at /var/tmp/ssh-exam-overlay-43b6iwk0. It discards an
ACTUAL signed native renewal reply after native completion, then verifies two
fresh signed queries return the same original cutoff, decreasing positive age,
unchanged journal and unchanged authoritative interval. The same profile retains
the legacy policy-pause termination negative control; it does not qualify C3
retained lockout. The same candidate's collector-isolation guest PASS12 assertions,
wrapper exit0 and host/base preservation at /var/tmp/ssh-exam-overlay-faydv6nj.
One real collector SIGKILL preserves the other attempt's same SSH/PTY/owner and
24 signed renewals, max0.087440s, exact40MiB retry and both original intervals.

No host clock/suspend, production install/config/student data or service changed.
All owned runners ended. Generated screenshots were restored except the original
dirty preflight image, whose saved SHA256 remains unchanged. Local source and
client manifests are immutable receipts for this candidate, not future rebuilds.
The native policy in application/browser fixtures is simulated; the guest uses
actual SSH/root/PAM/cgroups/private namespaces. Actual gateway-container packaging
remains unverified because the configured local Docker socket is absent; no
daemon start or remote production context was substituted. Full class/pane
capacity, installed-role hardening, live C16 authority, alternate complete evidence
and verified all-writer retention/recovery remain separate open gates.
