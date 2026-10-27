# Refresh signed native configuration after startup

October27 production cutover found a real stale-observation defect. The normal
agent publishes configuration before ServeLocal binds its command/role socket.
The signed startup snapshot therefore accurately reports the agent observation
endpoint unavailable. Once both services were running, direct `examctl health`
reported complete retained support, but the gateway still held that initial
incomplete snapshot: configuration was never reported again. This is an unavailable
observation, never a student violation or execution permission. Admissions stayed
closed while correcting it.

The bounded correction uses existing workflows and processes:

- `examctl reconcile` still reconciles timing/collection and eligible restoration,
  then durably queues a fresh configuration/health observation. It does not require
  gateway callback delivery to succeed. Help documents the queue/delivery boundary.
- `exam-agent -reconcile`, already run by exam-reconcile.timer each minute, performs
  the same fresh report after reconciliation and before normal callback delivery.
  After the live role endpoints are available, the next signed snapshot replaces
  the initial unavailable observation. No new timer, service, broker or protocol.
- Failed reporting is logged by the existing one-shot agent; previously queued
  lifecycle callbacks are still attempted. Native deadline/monitoring enforcement,
  access holds, settings, grants and their fresh Begin guards are unchanged.
  Configuration facts never substitute for live monitoring or retained execution
  permission. The existing bounded health probe stays outside the state lock.

`tests/native-configuration-report.py` exercises the actual compiled agent and CLI
entry points with only synthetic private state/keys, an unprivileged user namespace
mapped to root and a local TLS1.3 receiver. The original binaries exit successfully
without either delivered or queued configuration (retained RED receipts). Corrected
binaries PASS: exactly one signature-verified delivered agent report; exactly one
durable CLI report without network delivery; zero attempts/capabilities created;
unavailable role facts remain incomplete/not production ready. Every owned process,
receiver, synthetic key and temporary directory is removed. The first fixture
omitted the mandatory configured account and correctly refused; that setup failure
was retained/corrected without weakening validation or creating an OS account.

Runtime changes are limited to command wiring/help; all native core enforcement,
web/image/protocol/support inputs remain unchanged. Both actual-entry regressions,
full affected CLI race suite6.007s and vet pass. Earlier full core/privileged retained/
collection/browser evidence still applies to those unchanged inputs; this does not
attribute old artifact qualification to the two corrected command binaries.

Local correction outputs/receipts: MAIN
var/collection-tests/production-cutover.td6oq2x6/configuration-refresh-bin and
configuration-{agent,cli}-{red,green}.log. Corrected binary deployment and the real
signed callback/unchanged-history proof must be recorded before closing the
production consolidation item. At this writing the web/native815a895 cohort is
running in maintenance behind the tested new-start gate; correction deployment
and full live acceptance remain pending. No admission reopening is implied.
