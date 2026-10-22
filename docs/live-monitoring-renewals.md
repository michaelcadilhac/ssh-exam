# C10: live renewal acceptance, separate storage observation

October22,2026. **Private, unused native candidate; not deployed.** This changes
the monitoring arbiter/publisher groundwork, not current execution leases,
watchdogs, SSH/input bridges, UI, configuration or capabilities. The critical
monitoring TODO and C3/C9 integration remain open.

The instructor approved verified live renewal without waiting for disk sync;
restart requires fresh verification. Grants, original/current starts/deadlines,
ownership/epoch transitions and audit remain durable. The old private arbiter
could let its earlier cutoff expire while a verified proof waited for publication.
The new regression is RED0.018s on that model. This is a confirmed model failure,
not a diagnosis of the production incident.

## Acceptance and publication

`accept` checks current clock/ownership, exact internally issued challenge,
complete verified signed candidate scope/age/coverage, sequence and deadline, then
commits a bounded in-memory outcome. It executes no filesystem, network, worker
setup or publisher-admission operation. An identical retry returns the original
nonce/sequence/cutoff/AcceptedRevision; it cannot refresh permission. Bootstrap
authority permits only the proof exchange until the first complete verified
proof; the first proof cannot inherit a longer unverified bootstrap interval.
An older valid proof cannot shorten independently valid live authority.

`preparePublication` separately selects an already accepted outcome. Only one
metadata operation per arbiter is pending; a busy or failed writer cannot refuse
the next valid live proof. A supervisor can coalesce to the newest accepted nonce
after the earlier operation exits. The existing actual process/slot/claim bounds
still apply, including surviving uninterruptible children; no new worker is
created by acceptance itself. Full fair scheduling/class capacity remains open.

`published` confirms only the original observation's bytes. It never changes
authority, sequence, coverage or receipt revision. A late older completion cannot
overwrite a newer live decision; a wrong reply/failure is a storage observation,
not misconduct or grounds to discard still-valid verified permission. Genuine
policy/authentication/clock/ownership/deadline revocation remains sticky; late
publication and retries cannot thaw it. An absent fresh proof still expires at
its actual current cutoff, without an added grace period.

The process launcher now checks the exact pending ticket before setup and again
before launch, not merely whether some publication is pending. A new actual-child
regression was RED0.095s: a retired ticket could launch one old metadata writer
against its replacement (its eventual reply was rejected). The correction refuses
before launching and cannot retire the new operation. No authoritative state was
replaced by that prototype defect; provisional records never confer permission.

## Restart, audit and integration boundary

No disk record, old signed reply or JSON-restored context can construct positive
live authority. The current constructor still requires a one-use nonserializable
verified context seal; there is no production seal factory yet. Its eventual
factory must positively establish exclusive root/current SSH registration and
fresh complete monitoring, not only a live PID or matching owner strings. After
restart, remain unknown/contained until that verification and the complete
freeze/input/epoch/recovery protocol pass. Do not use this API as a shortcut to
bootstrap a held/completed attempt.

Per-renewal live outcomes are explicitly not durable receipts. Last publication
may be pending/unknown after a crash; never invent a missing audit/renewal history
or claim it was durably committed. Durable significant transitions, original
history and account restrictions are unchanged. The current deployed protocol
still uses its legacy renewal path; this candidate is not a fix for all stalled
renewal paths and does not preserve editor buffers on its own.

Before enablement: supply actual native current-registration/epoch ownership and
authenticated IPC, independent coordinated watchdog/cutoff, fair bounded evidence
delivery, complete CLI/web diagnostics, all-writer stop-assisted freeze and input
revocation/drain/discard, C9 recovery and mixed-version refusal. An old watchdog
reading a stale disk cutoff must not bypass a newer live root decision. Require
combined actual browser/WASM/SSH/native/storage/restart qualification; never
enable half the protocol or weaken the15s evidence bound.

## Current local evidence

Ten focused authority/process/publisher/storage/native-root/user-scope race
repeats pass44.607s, retaining actual SIGKILL/panic/exit, OOM/runtime, ENOSPC/
readonly, strict reply/privacy/inherited claims and genuine expiry/revocation.
Four additional C10 cases pass twenty race repeats3.428s:32 concurrent identical
proofs have one original outcome; real blocked publisher children do not stop six
fresh Ed25519-verified renewals across the old cutoff; delayed metadata leaves
newer authority unchanged and coalesces to its newest accepted observation;
retired tickets launch nothing. Clocks/ownership seals are synthetic in these
tests, not actual root actor/SSH/freeze proof. The initial compatibility run
exposed stale old-policy expectations in five publisher controls; those assertions
now require the accepted live cutoff, while all worker/errno/claim bounds remain.

Full native race/resource/namespace/compiler/default-size qualification passes
core284.346s/CLI22.157s; all426 application tests in80 files pass95.78s, static
build/vet and35 Python checks pass. All174 browser source/runtime hashes match
the nine-check real browser/WASM SSH run. No new test artifact
was uploaded, installed or privileged-qualified; csc-sys remains idle-guard gated.
