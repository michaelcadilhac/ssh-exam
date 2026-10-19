# Attempt interruption history

The main instructor table has a per-attempt recorded-interruption count and inline disclosure.
It shows each pause's reasons, start/end, elapsed duration, approvals with actor/date and
whether the student actually continued. No Review dialog or timestamp menu is needed.
Details span the table width, stack on narrow screens, support keyboard Enter/Space, expose
expanded state, retain focus and stay open during polling. The same timeline appears under
Review → Activity without repeating incident reasons alongside it.

A contiguous locked interval remains one interruption even if more causes arrive, approvals
are renewed, or an approval is revoked by another violation. New approval history does not
replace the previous approvals. Pending, consumed, expired, replaced, revoked and automatic
sandbox grants are distinguished. An instructor approval does not stop the pause timer.
Only successful Continue records resumption; an interruption that reaches effective exam end
is labelled Ended with exam. Elapsed values use explicit minute/hour units and server time,
cap at the current cutoff, and never reset deadlines or change access enforcement.

After the awaited native continuation reply, the gateway rechecks current generation,
state, deadline and the persisted grant in the same transaction as activation and history
closure. A newer violation, completion or expired grant cannot be marked resumed by a late
reply. Recording adds no new SSH permission or native control path.

Migration 011 adds the monitoring history table and conservatively copies existing incident
reasons, agent-lock audits and dated instructor/sandbox approval audits. Historical resume
and elapsed times were not recorded and remain unknown. Only the latest matching persisted
grant can be marked consumed; old approvals are not all claimed to have been used. Missing
pause times after interrupted writes remain explicitly unknown. Restart recovery preserves
open pauses and repairs a recorded exam end; it never fabricates a historical resume time.

Manual monitoring deletion and 60-day expiry remove the timeline. Tombstones prevent migration
from resurrecting it. Database deletion triggers also apply when rolling back to an older
webserver. Rows say History deleted rather than claiming an uninterrupted attempt. Operational
audit retention is unchanged. Distinct causes are bounded as in existing incident monitoring,
with visible overflow notice. Protected submissions, account holds and original/current
deadlines are independent and unchanged.

Validation includes server/API/role-boundary tests, repeated causes, revoked/replaced/expired
grants, automatic sandbox approvals, actual resume/end durations, conservative historical
migration, consumed-grant attribution, restart recovery, tombstones/retention and the late-reply
authorization fence. Desktop/mobile screenshots were inspected. Browser tests cover inline
keyboard disclosures, preserved expansion across live updates, all existing roster/clock/
review flows and SSH logout/finish. A two-student real browser-SSH worker-fault workflow checks
that five instructor-authorized recoveries close the matching pause only after Continue,
while the other student's terminal and original deadline remain unchanged.

Rollback must retain the current metadata database and tombstones. Older application code
ignores the additive table; deletion triggers continue enforcing retention. It cannot record
new successful resume times, so gaps during a rollback are unknown on upgrade. Never restore
an old database snapshot over newer deadlines, monitoring deletions or protected receipts.
Native class-server binaries and policy do not change for this feature.

## Deployment verification

Deployed revision `9739339` on October 19, 2026, at 18:54 UTC. No preparing, active,
paused or unresolved attempt was present at either live or offline cutover guard.
No student was interrupted. A network-disabled rehearsal of the exact new image on a private
production database copy passed before cutover; the copy was then deleted.

- Image: `ssh-exam-workspace:interruption-history-9739339`, also normal `:1.0.0` tag.
- Image SHA-256: `e763326a0a3d76ee3081bb804e1f1e273d4408a0535e46adfa275201e7aa0efa`.
- Previous image: `5f8189fc46130f84ca87725fa9f996fe402645499f6440ed62a5b74d97322654`.
- Private backup/receipt: `/var/backups/ssh-exam/20261019T185422Z-interruption-history-hph4ow7t`.
- JavaScript `/assets/index-BNQb97EO.js` SHA-256:
  `d15a5d32419bdac66c1990c0c0c89e3511bbf1cead1c07c92e7ba9a9c774457e`.
- Stylesheet `/assets/index-B4D6BeLg.css` SHA-256:
  `0103b1885b4856b616ff89467fb5fd5cd1d0a343deaf06d8862bf01e2f9338da`.
- Compiled interruption service SHA-256:
  `01d2e44f1b51ffa2230c11a1917094bc0e1e0a793230bbd4e67525fab18f67c9`.

Production serves the exact tested assets/modules. The service/container is active/healthy,
restart count zero; public readiness is production-ready with maintenance false and
notifications true. Schema 11 is installed with both retention triggers. All 15 existing
attempt identities, states, starts/ends, original/current deadlines, protection and checksums
are unchanged. Four historical interruption records were recovered without inventing resumed
timestamps or durations; deleted monitoring was not resurrected. Sandbox, two administrator
accounts and configured SMTP recipients are unchanged. No native csc-sys binaries, account
policy or protected archives were modified.

Typecheck/build passed. The full server suite passed 265 tests across 44 files; final focused
history/API/migration/retention checks passed 10 tests, including an additional rollback-trigger
regression. Twenty-four instructor/SSH browser checks passed. The actual WASM browser-SSH
worker-fault test passed after the continuation fence, verifying five approval/reconnect/
Continue cycles and an uninterrupted sibling attempt. Desktop/mobile disclosure screenshots
were inspected at 1280 and 390 pixels; fixtures contain synthetic student data only.
