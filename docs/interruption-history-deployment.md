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
