# Publish readiness from the canonical agent context

October27 production cutover found a stale-observation defect: main published
configuration before ServeLocal bound the agent's role socket and never refreshed
it. The signed startup snapshot accurately said the observer was unavailable,
while later direct health was complete. New admissions remained fenced throughout.

The first correction80eb76e queued reports through CLI/timer reconciliation. Public
synthetic-entry regressions and CLI races passed, but actual production verification
caught its missing positive case: reconcile.service deliberately uses ProtectHome=yes.
Its view hides /home/student, so it published readiness false even though role
agreement and the canonical agent's readiness were true. That is a retained failed
acceptance receipt, never production qualification. The timer was paused while the
canonical agent and independent deadline watchdog stayed running. No student clock,
grant or access policy was changed and no protection was relaxed.

The corrected publisher runs inside the existing canonical ServeLocal process,
after binding/chmodding its role socket and then each minute. Its one bounded
background loop probes using that actual mount/capability context, outside the
shared state lock, and durably queues the ordinary signed configuration event.
Existing callback workers deliver it. The loop stops when the server exits; probe
errors are logged observations and never terminate healthy PTY owners. No new
process, service, protocol, configuration flag or execution permission is added.

The one-shot returns to reconciliation/delivery only; its harder filesystem view
must not replace canonical service readiness. Existing root `examctl reconcile`
retains an explicit host-view fresh-report queue workflow without requiring callback
delivery. Help describes that boundary. Independent native Begin, monitoring,
deadlines, account holds, protected sources/history and credential cleanup remain
authoritative; cached readiness is never execution permission or student misconduct.

`tests/native-configuration-report.py` exercises actual binaries with only synthetic
private state/keys, a root-mapped user namespace and a local TLS1.3 receiver. Original
binaries lack refresh (retained RED);80eb76e produces a second report from the wrong
one-shot context (retained RED). Corrected normal serving agent PASS: startup plus a
real one-minute refresh, increasing sequence/new observation time, exactly one
signature-verified delivery per serving-agent snapshot, and no readiness generation
by the one-shot. CLI PASS: one durable offline report. Unavailable facts stay
incomplete/not production ready; zero attempts/capabilities are created. Tests verify
the exact owned daemon's SIGTERM exit and remove all receivers/keys/temp state.
The first fixture's missing mandatory account refusal is separately retained and
corrected; no OS account or enforcement exception is created to fit the fixture.

The service-context positive acceptance remains the real canonical role/signed
web snapshot and historical-protection comparison on csc-sys/marco. Do not infer
that positive case from an unavailable-only synthetic fixture. All hardening stays
intact. Full affected native core/CLI races and vet are required after the ServeLocal
wiring change; do not attribute older native-artifact qualification to new bytes.
Web/image/protocol/support inputs remain unchanged and their existing qualification
plus actual public hashes/history evidence remains applicable.

Current receipts/binaries: MAIN var/collection-tests/production-cutover.td6oq2x6,
configuration-service-bin and configuration-service-{green,cli-green,races}.log.
Focused public regressions PASS; full native core races207.681s, full affected CLI
races6.353s and vet PASS. The canonical-context correction is NOT YET DEPLOYED. Web schema33 and native
80eb76e remain in authorized maintenance; reconcile.timer paused, deadline watchdog
running. Email was accepted and instructor confirmed exactly one inbox delivery.
Full human exam/recovery acceptance and account eligibility choice remain open.
