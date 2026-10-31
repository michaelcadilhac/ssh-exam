# Current checkpoint — phone sign-in and plain terminology

October 30, 2026. COMPLETE/TESTED LOCALLY. The commit containing this checkpoint
(parent 976b7d5) is the validated candidate. No push, deployment, production
configuration/student changes or restarts. No open decision or running test.

Prof agreed the fixes before implementation and accepted actual 1280px/430px
phone screenshots. Password waiting, prominent number, Authenticator instructions
and one **I approved on my phone** action remain visible above long raw banners.
No answer is automatic; generic OTP still requires its typed code. Host/prompt/
round fences and credential clearing remain unchanged. Ordinary prose uses Start
exam, setup, attempts, time limit, opening/closing times and instructor approval.
The finished student's IDs/checksum require Technical details. Guides now match
setup expiry and saved-file recovery; this changes no existing policy.

Evidence: var/collection-tests/prof-login-terms.g_qplfoq. Details, failure records
and Prof's decisions are in docs/ui-prof-review.md.

- Full npm test: 644 passed / 3 existing opt-in skips, 330.0s; clock pretest included.
- All 95 selected browser scenarios covered: 94 broad passes and one separate 7.6s
  pass after correcting two stale wording oracles. Product/assets and the 94 other
  scenarios stayed unchanged. Actual WASM/separate gateway mode verified publicly;
  SSH hosts/media are synthetic, not privileged class-server qualification.
- Focused checks: 74 app (including 7 auth unit), 8 additional HTTP, 3 phone browser pass.
  Typecheck and fresh frontend/server builds pass. Three initial phone failures
  reproduced the old UI; final desktop/mobile/genuine-OTP checks pass.
- Source proof: 70 public app literals plus 14 ordinary instructor messages; zero
  other server tokens/interpolation changes. Eligibility, statuses, operations,
  source protection, clocks, holds and stored historical reasons are unchanged.
- Source/test/assets frozen without drift. Qualified SSH WASM/runtime preserved
  after the last Vite build. Cleanup: 76 logged owned PIDs exited; 3100/3101 closed.
  All 10 original dirty documentation screenshots remain unchanged and uncommitted.

Prior UI/automatic saved-work results remain in docs/ui-prof-review.md and
applicable feature documents. No native/SSH/protocol/CLI code changed in this
follow-up. The original 38-item deployed release remains separate from this local
candidate. No original TODO completion count was inflated by this review.

Next action: await the instructor's next task. A future separately authorized
release needs a new matched shipping image and the exact root worker unit's
mount/LSM qualification before installation/enablement. The retain-only worker
remains uninstalled. Use docs/automatic-saved-work-setup.md for guarded rollout,
backup/drain/migration/synthetic acceptance and rollback; never restore an older
database over newer authority. Preserve history, pins, original deadlines and
account holds. Existing deployed single-agent consolidation needs no change.
