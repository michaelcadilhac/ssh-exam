# Native health/readiness lock isolation (local; final guest regression pending)

October22,2026. Next independent critical-path investigation, not the initiating
production fault or an answer to pending C10/C11. No production changes or
retained-SSH/automatic-recovery capability is enabled.

Confirmed source boundaries: public Call(health), signed student health and
ReportConfiguration call callLocked(health) while holding WithState. That
readiness walk queries the resource slice (2s bound), performs NSS getent calls
without an outer bound for configured static accounts, runs the isolation checker
(30s bound), then reads the guard report. Health itself uses immutable Config and
kernel/filesystem observations, not attempt mutation. The callback additionally
publishes a sequence/event afterward. New prepare-attempt also runs readiness and
home copying under the lock; activation already has a separate outside-lock OS
guard stage. Signed execution renewals already have a separate per-attempt
journal, so do NOT call this proof that health held their lock or caused the
reported incident. It can delay state inspection, admission and state transitions.

The candidate now implements the observation-only split below. Native Call and
configuration reporting retain initial legacy state validation/initialization;
broken/missing authority is not bypassed by returning a healthy snapshot. Signed
health performs and durably commits its existing authentication/registration/
expiry/nonce checks before probing. Configuration appends its observation/event
after the probe in a separate short transaction. Unknown locked-path callers
refuse instead of restoring slow IO. Actual preparation/Begin guards are unchanged.

A no-wait mutex permits one concurrent probe per Engine, NOT a host-wide process
or IO-resource bound. Busy is an actionable unavailable-observation error, not
ready=false/policy violation or a false configuration event. Retry after it
settles; operators may inspect examctl agent status without restarting exams.
Signed busy nonces remain consumed, including after restart; no cached observation
substitutes for Begin. Native CLI help documents these limits. Regular storage,
NSS/checker timeouts/resources, initial state waits and other actors remain open.

Implementation order and acceptance:

1. Reproduce a blocked readiness dependency through public health, the real
   signed-command path and configuration publication. Show an unrelated native
   state transaction delayed; preserve intervals/holds/peers. Use controlled owned
   IO and an explicit test-only function seam, not a production fault environment.
2. Extract the unchanged full health observation from callLocked. Root Call runs
   it outside shared state. Signed health first performs existing account/current
   registration/signature/expiry/one-use nonce validation and DURABLE consumption,
   then probes outside state; replay/unapproved requests must not dispatch slow
   work. Never execute a probe inside an unknown fallback locked path.
3. Configuration reporting probes first outside state, then appends its immutable
   observation/accounts/sequence/event in a short state transaction. Delivery and
   mutation stay separate. No readiness result is permission, a live monitoring
   lease, authority restoration or an atomic view of the machine.
4. Keep actual preparation/Begin admission guards fresh and unchanged; never
   substitute a cached health result or skip NSS/account restrictions. Investigate
   probe concurrency/resource/timeout isolation separately and document remaining
   home-copy/prepare/startup waits rather than claiming all lock isolation done.
5. Add actual compiled root CLI and guarded guest signed-health/interface tests
   with a held real checker/IO dependency, useful diagnostics, privacy/replay and
   exact clock/hold preservation. Full native/app/build/vet and browser/hash
   compatibility follow. Do not fault an installed checker or service on the host.

## Local evidence and remaining gates

All three controlled kernel-pipe readiness/independent signed-inspection paths
are RED on the original locking behavior. Ten focused race repeats now pass
1.370s with overlap/replay/restart/untrusted-request/no-false-publication,
broken-state and locked-fallback checks. A further regression requires the actual
fresh Begin guard even after a synthetic healthy observation. No positive
production-readiness claim is made from an injected test dependency.

Actual compiled static root CLI under private user/mount namespaces now holds
a real external manager query while a second CLI inspects the same state within
750ms. Its unchanged authority and host manager/NSS bytes are checked. The
synthetic namespace never contacts the host manager/accounts and always reports
not production-ready. Companion existing resource-readiness checks pass too
(3.185s). An initial fixture was correctly refused for lacking locally approved
accounts; it is NOT qualification, and the repaired synthetic fixture does not
weaken production validation. The actual guarded guest profile now also includes
signed SSH/SO_PEERCRED health with a held kernel-pipe dependency and independent
signed inspection. Full local qualification passes all426 application tests90.47s,
native race/resource/namespace/compiler/default-size core208.587s/CLI12.946s,
static builds/vet and35 Python tests. No application/WASM source/runtime changed;
fresh9-browser and prior114-browser evidence remain separate unchanged-artifact
results, not a new combined native/browser release claim.

The exact candidate's guest run was REFUSED before creating a guest/test unit:
csc-sys now has live/unresolved exam work according to the raw-state idle guard.
No installed service/configuration or student record was changed. This is an
external safety gate, not a candidate test PASS or a missing executable. Preserve
the candidate and continue independent local work; never reconcile/clear host
records, restart agents or relax that guard to qualify a build. Retry guarded
qualification only after the host is safely idle (or with a separately authorized
equally isolated host). The later boolean-only raw recheck reported idle. The
unchanged guarded retry then passes three actual signed-SSH/SO_PEERCRED held-
health/independent inspection, late-ACK, root-CLI and two-shell repetitions
1.79/0.86/0.79s, with host/base preservation at
/var/tmp/ssh-exam-overlay-vvl49xqt. The same exact artifact then passes all40
SSH/PAM/Begin/enforcement assertions with host/base preservation at
/var/tmp/ssh-exam-overlay-ynys70us. The final worker-isolation run was REFUSED
before guest creation because new live/unresolved host work appeared. Its11
collector-death/healthy-peer assertions remain pending for this artifact; the
initial and later safety refusals are not counted as PASS. Do not substitute a
preceding binary's worker receipt or alter production work to clear this gate.

Exact candidate SHA-256 (the preceding successful narrow guest receipt only):

| Artifact | SHA-256 |
| --- | --- |
| exam-agent | c3950547bfe603038baef6916eb35753d2be5d7c80803ed0a97f8ffae4471bcb |
| examctl | 617bb149be72b4e5cb0de4b6263a2593ad4999000ca22f2e372691d5a5fb787f |
| exam-login | 8b5242e56a3bd1287b01758b36f0d37969f25654bd118e82432ad27cb530cb16 |
| core-qualification.test | cab066622787eefe1887a6b592851869cafb7a198497bb46e47e07e20ac9b417 |

Private candidate upload: /var/tmp/ssh-exam-health-observation-upload.GmalUA.
The wrapper/helper14-file SHA256 manifest is retained there. Do not substitute a
prior pane/receipt binary's privileged checks or a future clean rebuild's hashes.

This observation-only split is a routine safety implementation within approved
scope; no new account/grant/lockout policy choice is inferred. Complete retained
mode/technical holds still require the approved all-writer/input/owner protocol
and answers to pending consequential choices. Investigation is NOT complete
merely because this proposal exists. No rollout/consolidation is authorized.
