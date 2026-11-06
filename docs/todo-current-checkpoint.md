# PRODUCTION HELD — nonce lifetime preservation refusal

CURRENT November6 ~09:21UTC: site FENCED / maintenance. Qualified native/relay
cohort installed and VERIFIED (PIDs910600 agent,910596 watchdog,910598 source,
910635 relay). Corrected web Config1942b7f9 is already RUNNING. Controller phase
NATIVE_UPDATED; web resume failed at preservation with Unexpected nonce
identity/lifetime. ZERO unfinished attempts. No new student/exam records changed.
Video pause remains OWNED. DO NOT reopen, restore old data, or retry blindly.

The single bounded read-only diagnosis is COMPLETE. Nonce table has only agent,
nonce,expires (no issued column; first diagnostic query failed on that guessed
field, corrected status capture confirms fence/phase). Existing preservation.py
line90 caps added expires at observed+31000. New approved native management
requests use60s. This was missed because startup fixture's default poll still
used30s. This cutover attempt is STOPPED, safely held. User informed immediately.

NEXT LOCAL MILESTONE: reproduce exact60s producer against preservation, fix bound
without waiving identity/history/nonce/audit checks, qualify a controlled operator
repair and CURRENT-data resume of the already-running candidate WITHOUT snapshot
replacement or restart. Inspect the prior November1 preservation/current-data
repair workflow before inventing a new controller. No more production diagnosis
or mutation until a compatible repair is fully frozen/qualified. Existing task
explicitly authorizes testing/deploying any change; do not ask routine permission.

Production recovery evidence/base paths/qualified artifacts and all prior steps
are retained below. Current logs: web-resume-completion.json (55.06s refusal),
resume-refusal-diagnosis.stderr, native-{stop,backup,install,start,verify} receipts.
Native backup: classstage/backup/native-before-948e8606c1734d7e9f462daca16d7103.tar,
230666240bytes, SHA0a83a75cd5c619858427e9d6886d9ec94b690756c4c758d70990623ea285c456.
Web current snapshot122945536 DBbytes+343358small bytes;1047562391media reused,
zero new media. Original snapshots MUST remain unchanged; never old-writer rollback.

--- Prior preparation/checkpoint (superseded by held status above) ---

# Current milestone — qualified timer release, staged; deploy next

November6,2026. Task started04:54:44UTC. User authorizes testing and deployment,
including with ONLY an admin signed in. No new push authority. Preserve students,
all guards and the ten original dirty docs/screenshots files. No service/config/
student-record changes yet; the qualified release is staged privately on both hosts.
Production is ONLINE / web controller PREPARED. Online preparation11.27s reused
1047562391 recording bytes with ZERO new media. Video conversion pause is OWNED
(nonce24d2a57d-4862-4fbf-b00b-55c8b4829d2c); no service stopped. No missing package
or policy question remains. Admin signout --run found ALREADY_DRAINED:0admin,
0student sessions changed. Current fresh guard-before-apply session75099 pending.

## Frozen runtime and qualification

Runtime5ed57ca2b8a79134207d81d32ca99e498e4b8e5d; qualification2926c6f.
Earlier local commits9537f34 and397342d. All new source committed except this
checkpoint update. Original dirty screenshots must remain uncommitted.

Image tag ssh-exam-release:timer-controls-5ed57ca2b8a7; exported Config
1942b7f9311561fe6b8da50674abe80a3854673b0575a0e9f371f4f8e159df52.
Archive295880704bytes, SHA8e45004bf7e47690c01472d781fd9a511a6b485ab8f2cc17840d86d81a23aa46.
Source engine ID3bab329b differs from exported Config; manifest/rootfs are verified.
All8 shipped assets pinned in image-assets.json. Native five binaries unchanged
from qualified native-release/ bytes. Do not rebuild or edit runtime/operators.

Evidence base: var/collection-tests/timer-controls.20261105a/.
- Final application:822pass/0fail/3existing opt-in skips; full native races pass.
- All28 actual user-systemd/PTYS/supervisor modes pass, including real work beyond
  original1min deadline, monitoring hold while countdown paused, paused fresh-files
  recovery/no-expiry approval and explicit countdown resume. Protected Finish and
  completed/restart refusal pass. Root compiled CLI/TLS/script workflows pass.
- All85 unique selected browser scenarios pass across broad/corrected runs;
  final10 student continuation browsers cover the final rendering change.
- Exact corrected image schema37/history/media/native-clock smoke passes. Startup/
  current-data recovery63.07s/13signed polls:41contracts,11mutation refusals,
  tombstone/due purge, expired nonce/support, no replaced snapshot/extra restart.
- Actual five-binary native+relay installer passes with real nginx validation/
  reload, stopped invalid-config refusal/exact retry, preserved trust/config and
  all7 real SSH/workspace/collection/original-deadline assertions. Independent
  guest shutdown/MainPID0/no owned processes/unchanged host/base confirmed.
- Exact SHIPPED WASM+real root native/PAM/cgroups journey50.2s passes: live pause,
  immediate95min remainder, no-expiry approval, actual SSH loss, fresh files
  continuation preserving pause/original interval/hold, explicit timer resume,
  protected Finish. Actual loaded roles use no test readiness override. Synthetic
  jump/MFA/media remain explicit seams. Independent cleanup JSON/root log saved.
- Actual local nginx master/worker reload and production reopening predicate:
  0.220s, current normal/fenced templates; maintenance/browser paths and cleanup
  pass. Operator tests19native/35web/10bridge; overlay safety27 pass.
- Types/build/focused continuation units pass. No need to rerun unchanged suites.

A real no-expiry Date RangeError was caught in joined qualification and fixed;
first candidate d3233146 is rejected under pre-render-fix/. Final1942b7f9 passed.
Do not format no-expiry sentinel as Date. Root guard pin is the ORIGINAL3a49907d
native-rollout-guard.py producer, not4901c088 read-only bridge; unmocked test now
checks the right source. Image/server/native unchanged by final test-only commit.

## Exact staged deployment

Local release.json, locations.json, stage-audit.json and operator-freeze.json
bind all artifacts/inputs. Generated manifest passes real controller validation.
nonce b891904a-00fd-48a3-8a6a-7ed48d1659d9.
Web stage /var/tmp/ssh-exam-timers-20261106-5ed57ca-b891904a-web
Web code <web-stage>/code
Web state /data/ssh-exam-timers-20261106-5ed57ca-b891904a-state (PREPARED)
Class stage /var/tmp/ssh-exam-timers-20261106-5ed57ca-b891904a-native
Private staging receipts web-stage.json/native-stage.json pass. Upload roots:
marco /var/tmp/ssh-exam-timers-release-upload.ujsAvher
csc-sys /var/tmp/ssh-exam-timers-release-upload.zUOfo9s8
No installed files touched. stage-release.py syntax-checked/digests verified.

NEXT: collect exec session75099 and read guard-before-apply.log; must PASS.
Then python3 <base>/operate.py apply web-apply. This is the first maintenance/
service-stop step and must return WAITING_NATIVE after fresh current snapshot.
No further development/testing/refactoring during cutover. Exact scripts frozen.
If failure after fence, report held state immediately, one30s read-only diagnosis,
only qualified forward recovery. Native operations follow below, each with fresh
handoff; never advance on an unread/nonzero prerequisite.

Before APPLY: atomically audit/expire ONLY admin sessions under user authority,
requiring zero student sessions/unfinished attempts; native guard must be fresh.
Preserve zero-session deployment guard. The previous qualified admin-only signout
receipt is files-only-resume-release.20261104a/authorized-admin-signout.json.
No student records, attempts, grants or clocks may be changed by deployment.

Operators (already syntax checked, frozen inputs; unique labels create receipts):
- python3 <base>/operate.py prepare|apply|status|resume|rollback|reopen|cancel LABEL
- python3 <base>/native-phase.py stop|backup|install|start|verify|status LABEL
Native-phase obtains and checks a FRESH stopped-web handoff before each mutation.
After web APPLY must be WAITING_NATIVE. Then native stop,backup,install,start,
verify sequentially; read EACH completion. Refresh after guard via
python3 scripts/refresh_native_cohort_guard.py --release-dir <base> after.
Then web resume, keeping after guard fresh below90s while startup waits.
No --fixture in production. Same-schema37/forward-only matched scope is
monitoring-timeouts-v2. It installs all5 binaries and only the relay timeout
snippet; existing relay config/key/unit preserved. Reconciler timer included.

Qualified recovery: CURRENT-data forward recovery with SAME matched candidate;
never old database or old native/web writers. Unexpected failure AFTER fencing:
report ONLINE/FENCED immediately; only one30s read-only diagnosis and qualified
compatible recovery. Preserve held state if unresolved. Do not improvise patches,
clear records, kill unknown processes, or waive student/native guards.
Announce confirmed reopening immediately, then required assets/roles/signed CLI/
preservation acceptance and minimal checkpoint. Do not add optional work.

## Production inventory/recovery

marco118terminal histories, no unfinished/student sessions,1admin; schema37,
current web c5f95f7 Config5d9d429e; hostport3001/container3000.
Native185terminal histories; all roles remain current d744e5b; relayPID893011.
HistorySHA625a8141cbb492f1942f4f1e91b410847bab22df0be59a5d4cf730e854d1709d.
Actual identities/config/trust/unit hashes in native-inventory.json/web-inventory.json.
Existing current image archive reused/verified: marco
/var/tmp/ssh-exam-claim-clock-upload.5vu4bqsf/web-image.tar,
Config5d9d429e, SHA92f4fdb54e936ed2e3c26f6342d50078d266541aabb4a4c962ef0cca5a423627.
Shared immutable media /data/.ssh-exam-media-objects. Prior current data recovery
/data/ssh-exam-claim-clock-c5f95f7-20261105; native old backup
/var/tmp/ssh-exam-clock-repair.r_1nli9m-root. Fresh current snapshots are required
by the qualified controllers; do not assume older native coverage includes relay.
