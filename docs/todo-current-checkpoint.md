# Current checkpoint — single unused attempt deployed and online

November 1, 2026: the instructor's **Push & deploy** instruction is fulfilled.
Runtime f0c7e10/schema 36 on marco and matching examctl on csc-sys are installed.
Original nginx configuration is restored; admissions are open. The personal
attempt editor from 58a0736 is included. Students receive one assigned attempt;
reviewed new permission replaces the prior definitely-unused permission atomically.
Started history, original deadlines, setup claims, account holds and pins remain
protected. Pending saved-file setup starts no clock and cannot revive old permission.

Local qualification: 691 application tests pass / 3 existing opt-in skips;
86 affected integration checks and 13 compiled CLI→signed gateway cases pass;
full CLI races/vet/static build/help pass. All 81 selected non-skipped browser
scenarios are covered by current-artifact passes; one native-bundle-only case is
skipped. Prof accepted seven desktop/mobile review/result/pending renders. Exact
image upgrades 35/24→36 pass. Unchanged native/WASM evidence remains applicable.

Production acceptance: zero-session/exam drain, private migration rehearsal,
verified/fsynced full backup, exact image Config/rootfs/assets, schema 36 integrity,
fresh signed readiness, desktop/mobile focus/reload/navigation, one authenticated
CLI read and strict post-read preservation all pass. Migration found zero duplicate
unused permissions; existing permissions are unchanged. All 110 web attempts,
175 native histories, prior audit/requests, settings, deadlines and pins remain.
Agent, watchdog, relay and source-worker PIDs/configurations are unchanged; loaded
worker binary remains separately pinned. No new production exam/clock or MFA test.
Canonical consolidation and the original 38-item release count are unchanged.

Implementation/operator policy: docs/single-unused-attempt.md.
Deployment, private backup paths and compatible rollback:
docs/single-unused-attempt-deployment.md.
Local qualification: var/collection-tests/single-unused-attempt.8vas59nd/completion.json.
Rollout receipts: var/collection-tests/single-unused-rollout.mschv_oo/completion.json.
Ten preexisting dirty screenshots remain byte-identical and unstaged.

No open implementation decision or blocker. Next: instructor's next instruction.
Any further production mutation needs its own authorization. After schema 36,
repair forward or use a single-permission-compatible writer; never drop the index,
revive revoked permission or restore a pre-start database over newer history.
