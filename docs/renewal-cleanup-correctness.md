# Renewal races and preparation cleanup

Local source changes, October 20, 2026. **Not deployed.** Install matching gateway
and native builds only in a separately authorized drained maintenance window.

The gateway checks its current committed deadline before heartbeat health/renewal
handling and again when a renewal fails. Expiry moves the gateway to FINALIZING,
blocks input and awaits native timing verification/protected collection. It does
not create a lease-failure incident, continuation requirement or email. Original
deadlines, pending clock intents, prior interruptions and native cutoff remain
authoritative; the gateway does not declare submission success at that boundary.

Native renewal refusal still returns an error and never extends permission. After
account/transport/signature validation it can also return the public attempt state
and reason. Browser SSH uses the signed receipt, and the authenticated legacy SSH
path carries the same result. Worker IPC preserves this typed state, not arbitrary
browser error text. Thus an administrator pause/finish is reconciled as that action
even before its asynchronous callback arrives. A completion report without its
verified manifest remains FINALIZING; no protected-copy success is invented.

A delayed error cannot change another owner: current attempt identity, exam,
account, generation, page, clock revision, socket and connection must still match
the request. State/timing from a rejection cannot reset a clock or transfer an
attempt. Real failures before expiry still lock and notify. Cancelling a started
attempt remains forbidden; this cannot become a shortcut around collection.
Existing fresh-auth pause policy and focus grace remain unchanged pending the
separate retained-SSH design decision.

Housekeeping considers only PREPARING records with all start/deadline fields unset
and evidence of an opened preparation: a reliable preflight date or actual contact.
NULL last_contact is not an epoch timestamp. Never-contacted legacy reservations
remain inspectable and do not create false cleanup emails. Real abandoned
preflights still expire; native cancellation refuses a committed interval and the
gateway reconciles a lost activation reply into recovery with its original clock.
Native autonomous preflight expiry/callbacks still operate during web outages.

Rollback preserves state, schema, native journals, protected bundles and timing.
Older agents omit refusal metadata; older gateways can ignore the added result.
Such a mixed/rolled-back deployment can restore misleading generic lease alerts,
so verify both installed versions and signed callback/receipt behavior before
reopening admission. No service consolidation is performed by these changes.
