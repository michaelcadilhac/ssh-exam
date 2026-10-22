# New-preflight isolation — local candidate

October 22, 2026. This is an integrated native/signed-SSH prepare-attempt change,
not the complete monitoring redesign, retained SSH or a deployed fix.

## Defect and runtime change

New-attempt readiness and home-configuration copying ran inside the global state
transaction. A synthetic blocked dependency reproduced unavailable independent
signed inspection/admission on both Engine.Call and authenticated Command entry
points. Four original-path cases failed in 2.085s. The separate signed-renewal
journal already bypasses that lock; this does not establish it was blocked or
diagnose the production incident. The initial home fixture also used a UID that
did not own its files; the fixture was corrected to the actual unprivileged owner,
retaining the production changed-file/ownership guard.

Both real entry points now run readiness and home copying outside shared state,
under the existing nonblocking per-UID workflow fence. Signed authorization and
one-use nonce persistence precede dispatch. Root state retains a PREPARING record
with preparation_pending=true before IO so logout/cancellation can take effect
without waiting. It is NOT admission: practice panes, workspace staging, Begin
and account-policy setup refuse while checks are pending. Before ready publication,
recheck the original preparation/settings, account/registration/reservations,
command expiry, preflight expiry and bounded saved-source authority. Lost or
changed ownership/state cannot be revived by late completion.

Readiness still precedes the existing 15-minute native preflight timer. Once home
preparation begins, retries/restarts preserve that original timer. A restarted
pending preparation requires fresh checks; no disk flag supplies positive
permission. A separate durable pending-since timestamp bounds abandoned/crashed
readiness reservations to 15 minutes without starting the exam or resetting the
later home/practice preflight timer; the native watchdog cancels them normally.
A ready preflight retry follows its existing policy. Technical check
failure retains cancelled-before-start history and the underlying IO error, not
a student violation or new allowance. No exam interval, protected work, grant
consumption or original account hold is reset. Private snapshot files are retained
for normal unstarted-preflight cleanup/diagnosis; no workspace cleanup is added.

Legacy replacement-transport termination, actual pane OS startup and durable
state writes retain their existing locking. They are not claimed isolated by this
increment. There is no new live-renewal authority or retained-mode capability.
The optional legacy saved-source selection is unchanged; this is not unified
expected-source/grant issuance or migration.

## Operator and student workflows

- The student uses normal preflight; a pending result is not permission to Begin.
  After technical failure, sign out and retry after the underlying guard/storage
  issue is repaired. No time or saved-work allowance has been consumed.
- Inspect with `examctl info ATTEMPT --read-only` or
  `examctl list --read-only --exam EXAM`; JSON includes preparation_pending.
  Observation does not reconcile or prove readiness/permission.
- Deliberately cancel an abandoned unstarted preparation with
  `examctl cancel ATTEMPT --reason 'Concrete cancellation reason'`. Late checks
  cannot undo cancellation; started attempts remain uncancellable. Existing
  signed student logout/cancellation uses the same native state transition.
- Use `examctl health` for current guard diagnostics, not to manufacture a cached
  Begin permit. Never restart services, remove state/markers or release an account
  merely to bypass pending IO. See `examctl help info` and `examctl help cancel`.

## Verification and remaining gates

Focused real native/signed interfaces and actual copied home files pass, including
independent signed inspection/admission/renewal, cancellation in both IO phases,
pending admission/Begin/account-policy refusal, nonce replay across restart,
expiry, ownership/registration/settings/reservation changes, failed home IO and
fresh restart/idempotent-ready retry. Readiness/slow IO are controlled test seams
with an actual owned pipe barrier, not qualification of production NSS/storage.
SSH peer identities are supplied by the fixture; these Go API tests are not an
actual root OpenSSH qualification. The original full native pass succeeded
core273.585s/CLI21.405s; review then found the need to bound abandoned pending
readiness after a crash. The added watchdog/restart regression and preparation/
preflight cases pass three race repeats2.360s. Final native race/resource/
namespace/compiler/default-size qualification passes core278.848s/CLI27.072s
with that correction, not borrowing the earlier receipt. Logs use the
/tmp/ssh-exam-preparation-isolation- prefix; the final native log is
/tmp/ssh-exam-preparation-isolation-native-final.log.
Three combined focused race repeats pass core2.599s/CLI4.077s, including actual
compiled namespace-root read-only CLI inspection without state mutation.

All426 application tests in80 files pass93.27s; the subsequently added signed
pending/cancelled callback regression passes with all eight callback cases1.10s.
Six targeted real browser/WASM SSH preflight/logout workflows pass45.5s. Static
native build/vet and typecheck pass. Initial native/browser sandbox attempts
failed at denied listeners; a blocked sandbox application runner was stopped
using its verified exact PID/owned descendants before authorized local reruns.
Those failures are not product-test passes. Browser
fixtures do not exercise native root containment. Exact-artifact privileged
qualification remains subject to the guarded disposable-host gate; older bundle
receipts cannot certify this candidate. No upload, install or deployment occurred.

Future rollout must drain and update all native gate/watchdog/CLI roles together;
an older loaded role does not understand preparation_pending. Do not roll back
to one while pending records remain: first cancel/settle unstarted checks with
the matching version and preserve history, protected work and holds. This is only
a future migration/rollback prerequisite, not authorization to execute it.
