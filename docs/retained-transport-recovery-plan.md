# Retained mode after genuine SSH loss

October25,2026. Investigation under the already-approved C7 policy, NOT a delivered
replacement workflow. Baseline ad828f5; local work only, no deployment. Installed
retained admission stays OFF.

## Confirmed correctness defect and bounded fix

Public entry: signed native `attach-transport`, called by the existing student
`/api/student/attempts/:id/claim` after fresh SSH and instructor authorization.
It changed a v1 attempt's Transport/ResumeTransport while RegisteredOwner still
identified its old transport. RED95802 reaches the actual signed command with a
valid original owner and current authorization: returned success, canonical
transport changed and currentRegisteredOwner became false. Log
/tmp/ssh-exam-retained-replacement-legacy-red.log. Synthetic canonical state is
used; this is not a real SSH/PAM or working reconnect qualification.

The candidate rejects the legacy purpose for v1 BEFORE any ownership/approval/
clock mutation. Existing legacy behavior is unchanged. Focus83773 PASS1.101s;
registered-owner/legacy continuation and clock focus34524 PASS9.673s under race.
Native CLI28068 PASS17.404s with namespace coverage enabled; vet8406 PASS.
Logs retained-replacement-{legacy,owner}-focus.log. This is a refusal safety fix,
not implementation of fresh-transport recovery. Native source has changed: do
not attribute ad828f5's frozen binary/root receipts to a rebuilt candidate.

## Approved recovery and remaining workflow

The existing gateway Continue selects consume-monitored-continuation for v1.
Native resumeMonitored requires the original registered page and supervisor's
existing held ownership. The legacy claim changes the page and transport without
a monitored ownership transition. Merely reusing that path would either refuse
or leave inconsistent identity; it must never downgrade to an unmonitored thaw.

The repeated policy dialog was unnecessary. C7 already authorizes securing the
original work and issuing a reviewed NEW saved-work grant with an allowance and
finite Begin window chosen by the instructor. In the clarification the instructor
correctly observed that this can also choose the old remaining allowance. New
time begins only at actual Begin; the old interval/restriction/history remains.
No automatic refund, reopening or account-hold release. Use existing CLI/web
issuance, durable source retention and protected-copy semantics; do not add a
second original-attempt ownership-transfer protocol as an unrequested prerequisite.

Approval is never inferred from elapsed time. Preserve viable SSH through mere
control outages. A whole-gateway restart while the actual
SSH transport is still alive is a separate same-session recovery case: fresh
signed scope verification is required; no cached disk metadata is permission.

## Integrated acceptance still required

The narrow inconsistent-identity refusal is implemented; preserve its regression
and legacy behavior. Join actual genuine SSH-loss containment, original work
protection and existing reviewed saved-work issuance/Begin through supported
web AND CLI guidance. Do not offer an original-attempt reconnect that native v1
deliberately refuses. A saved archive may be required before a new source grant
becomes usable; failed collection remains inspectable/retryable, never starter
fallback. This is integration of approved policy, not a pending design decision.
It does not itself close ownership/cleanup or the broader liveness investigation.

For the eventual combined qualification, join existing real WASM/HTTP/SSH/native
interfaces for ONE synthetic student before scaling to16/64. Preserve the current
private network, exact owned resource bounds, host/base preservation and busy
refusal. A real joined flow is the acceptance result; unused transport helpers or
separate component passes do not establish it. Whole-gateway restart and genuine
loss recovery must reach their supported final state, not stop after guidance.

## Next bounded C7 qualification (after committed C9)

C9 is committed locally as3242422 with full application/native/browser/root and
16/64 qualification; admission remains OFF. Inspection confirms existing public
`examctl stop ATTEMPT --reason ...` finishes/protects work while preserving its
original interval hold. `manifest` verifies the protected archive. Separately
authorized `override-access` requires protection, no writers, successful native
restoration and a durable reason; it records early release without rewriting the
old clock/history. No new recovery or ownership-transfer mechanism is needed.

Actual next entry: one real WASM/SSH student saves work, then its browser context
closes uncooperatively. Require positive native ssh_exited_owner for the original
registered owner. Through the guarded guest run the existing root stop/manifest,
review a NEW same-exam saved-work grant for20minutes with a finite Begin window,
confirm native retention through root `web grants source-sync --revision 1`, and
explicitly review the old access override. Fresh student SSH selects that exact
grant, stages the same saved source with zero start/deadline, then actual Begin
receives the full1200seconds. Finish must protect original saved bytes plus new
work, retaining the old checksum/interval/override audit and the new interval hold.

Acceptance uses those real interfaces and kernel/SSH observations, not fabricated
native rows or a guessed latest/live source. Pending source confirmation cannot
start work or reserve the account; preflight consumes no new clock/grant. The
synthetic operator's explicit override is not an automatic student recovery policy
or permission to release a production hold. Private fixture actions target only
the single exact synthetic account/exam/record and preserve all existing host/base
guards. Keep the20-minute final-state check separate from the existing90-minute
fixture guard; do not relax ordinary/native acceptance to accommodate the case.
This remains an investigation/qualification plan until the actual joined flow
passes. No production action is authorized or executed.

Focused private guard/transport49 tests PASS5.503s and typed fixtures pass. Exact
native C9 binaries are reused (agent59577de/coreeb67983,273 unchanged native source
hashes); only the guarded Python driver/local fixture changed. New bundle
ssh-loss-recovery-artifacts.wl143x5h / remoteupload.5y7fxtwr. Initial actual4346
FAILS21.1s AFTER positive owner-bound SSH exit and root protected collection, at
the exact protected proof-byte assertion. Its exported synthetic proof file is
EMPTY, not the expected line. Cause remains unproven: the setup only awaited a
second printf marker, not an actual read-back of the first write before disconnect.
No new grant/clock was issued. Guestml0niyq2/unita10c65a92f36440fadaa6f93b6ad8d1e
independently result1/files+authority preserved/inactive; localfZv34b TLS key absent.
Exact log/output/tmp/ssh-exam-c7-native-recovery. Preserve the failed archive.

The next local test adds an ACTUAL shell read-back before closing SSH and captures
bounded synthetic terminal/notices on failure. It keeps the expected protected
bytes unchanged, distinguishing an incomplete write/setup from containment or
collection loss. Final types79441 PASS; no native/remote artifact bytes changed.
Actual retry2846 is running at/tmp/ssh-exam-c7-native-readback. Read completion
before editing its inputs or drawing a causal conclusion.

October26 current follow-up:2846 passed saved-file read-back and protected export,
then FAILS25s at source-sync. The private adapter omitted the public CLI's verified
`result` envelope; KeyError closed the socket without a diagnostic. Focused envelope
regression RED→PASS and safe actual-Unix KeyError reply coverage pass51 Python
checks5.973s. Guestqyp7xtjb/unitf52f736f28274a8c9d9fdc31c9e36452 independently result1/
files+authority preserved/inactive; localV0xw72 TLS key absent. New private driver
hnalc6c5/upload.laiq2ysn retains EXACT C9 native agent59577de/coreeb67983.

Actual59016 then FAILS37.1s BEFORE simulated loss: the first `p` was missing from
printf, Bash received `rintf`, and the later printf still printed FIRST-SAVED.
This demonstrates why that marker alone could wrongly label an empty file saved;
the new read-back correctly rejects it. No missing printf dependency or archive-
loss conclusion is established. Exact log/output/tmp/ssh-exam-c7-native-envelope.
Guest6h1w0ia5/unit05541fdb463b4a2f9a8be5b26302db61 independently result1/files+
authority preserved/inactive; local5SETV1 TLS key absent (verified on resumption).

The user's clarified missing-tool rule is committed as e2188d7 in both main and
worktree. Current bounded correction: a new terminal is rendered/focusable before
its actual `opened` acknowledgement; BrowserSSH intentionally discards unscoped
early input. Add a controlled legacy/framed open-reply regression, then keep the
pane visibly opening/non-editable until that acknowledgement. No replay/relabel
of early keys, execution-permission relaxation or clock change. Rebuild the UI,
run the focused actual browser check, then return to the WHOLE C7 recovery case.

Delayed-open regression22890 is RED for both legacy/framed pending textareas.
The candidate now disables/inerts input and shows Opening until actual valid
opened; BrowserSSH's safe early-input discard is unchanged. Rebuilt assets
index-Ct7C0Uku; focused74310 PASS4/7.5s, including malformed version/epoch refusal
and no replay into a later valid context. Final fixture/application types pass.
Actual19233 passes saved write/read-back, positive SSH exit and protected export,
then fails the private adapter: CLI uses ManagementResult.confirmed, not the
signed HTTPS response's ok. The earlier mock had repeated the wrong assumption.
Corrected actual-shape focus is RED at ok, then all51 private Python checks pass
5.942s with required local Unix sockets permitted. Restricted EPERM run is kept
as an environmental failure. Guestlb72sw1n/unit5e9451638eec43ec859f9fd9765e3fe8
independently result1/files+authority preserved/inactive; localx0ljuK TLS key absent.
New code-only bundle sc8u2oyc/upload.33favmez reuses exact qualified native bytes;
273 native source hashes unchanged. Actual96254 then reaches new-grant fresh
preflight and fails only its typed inspector: Go omits original_deadline when
zero (types.go). Match that one field with a zero default; retain strict present
start/deadline and started-interval assertions. Guestr1o6rbfz/unit8100c2957abd4cdd
b69bc7e4d53012e4 independently result1/preserved/inactive; localzLowdA key absent.

Actual5797 now PASS1/50.5s (57.6s including setup),
`/tmp/ssh-exam-c7-native-preflight-schema-fixed`. Full genuine loss → audited
protection/verified bytes → reviewed source grant/durable retention → separately
authorized early disposition → fresh preflight/zero clock → full1200-second Begin
→ protected old+new bytes is qualified through the actual entry points. Changing
the stopped old live file does not change restored archive bytes. The old original
grant/interval/checksum/override audit and new HELD interval remain intact. Root
log15y8wN includes BROWSER_NATIVE_PROTECTED_FINISH_OK/OVERLAY_QUALIFICATION_OK;
guest2y5klm91/unit66248940711f4298b37a8c7e91ee066e independently result0/files+
authority preserved/inactive, TLS key absent. This uses the private qualified
readiness adapter; public installed admission is still OFF. It closes the joined
C7 qualification gap, not the whole release gate. Remaining public guidance/entry
checks: retained pages still advertise legacy original-attempt reauthentication;
refuse that path before closing authentication/altering ownership, explain the
reviewed NEW-attempt workflow, and preserve same-page Continue/legacy behavior.
