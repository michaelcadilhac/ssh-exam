# Current checkpoint — student summary follow-up in progress

October 31, 2026. LOCAL IN PROGRESS after e57c3ec. Prof agreed to remove the
student’s routine Start window disclosure and attempt-option date ranges; retain
time limit, webcam, files, selection, blocked-start explanations and all scheduling
enforcement. Tests: timezone/initial/additional real-WASM workflows plus fresh
frontend build/typecheck. Evidence: var/collection-tests/student-summary.japy2oc9.
Next: reproduce, make the view/copy edit, qualify and commit locally. No deployment.

Previous completed local milestone:

October 31, 2026. COMPLETE/TESTED LOCALLY. Student SSH sign-in labels the
app-authored field **Password** and hides submitted fields until a fresh challenge.
Status and Cancel remain visible; notices cannot restore completed inputs. Raw host
messages, OTP/phone responses, password reuse and secret cleanup remain intact.
Prof agreed the fix and accepted actual desktop/mobile waiting screens.

- Three red browser checks reproduced the lingering field. All 16 affected browser
  workflows pass on rebuilt assets: waiting/OTP/notices, failures/retry, restoration,
  actual-WASM SSH terminal cleanup/logout/finish and sixteen simultaneous signed-in
  clients without starting clocks. Four focused checks passed before broad testing.
- All 29 focused Node/auth/security/receipt/unit checks, Go SSH-client races and
  private synthetic split-identity races pass. Typecheck and fresh native-clock,
  WASM, frontend and server build pass. No new durable state or policy change.
- Evidence: var/collection-tests/password-wait.aop_n05o. Details and regression-oracle
  correction: docs/ui-prof-review.md. Original ten dirty screenshots preserved.
- This follow-up is not pushed/deployed. No open design decision or local blocker.
  Next action: a new explicit instruction is required before push/deployment.

Production remains the previously deployed 6b7c62b runtime/schema35, documented by
14c850e and docs/prof-ui-deployment.md: marco online/admissions open, csc-sys separate
source worker active/enabled. All 110 web/175 native histories preserved; native
agent/watchdog/relay/SSH unchanged. No production contact or changes in this fix.
Rollback/backup evidence remains in var/collection-tests/prof-rollout.lta25gu8 and
the deployment document. Existing operational follow-up: marco root has about
3.1 GiB free; retain all student data/backups pending a separate maintenance task.
