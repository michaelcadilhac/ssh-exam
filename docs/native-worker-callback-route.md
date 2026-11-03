# Isolated worker callback routing

November 2, 2026. Investigation and local development; **not deployed**.

Entry point: student SSH sign-in → preflight → signed `prepare-workspace`.
The attempt aa847641-5723-42c1-b161-8e32fb17a080 was refused before staging
because its fresh signed exam-policy request timed out. Native read-only and
web read-only observations both show PREPARING with no start or deadline;
the native execution lease is absent. No production record, configuration,
process or service was changed during diagnosis.

The main agent has HTTPS_PROXY=http://proxy.is.depaul.edu:3128. Its resource-
bounded transient collection/preparation services receive no proxy settings from
the systemd manager. The launch code does not transfer the coordinator's route.
An unauthenticated HTTPS GET from the class server times out directly after four
seconds, while the configured proxy returns headers in 0.295 seconds. The GET's
404 is expected for that POST-only route and does not verify signed policy
handling. The code's policy timeout is five seconds.

## Bounded implementation milestone

Carry only the coordinator's selected callback proxy/direct route through the
existing private worker request. Do not copy the entire environment or place
proxy credentials in process arguments or logs. Keep configuration identity,
signed request/response verification, freshness/revision fences, OS isolation,
resource bounds and original deadlines unchanged.

Acceptance:

- Signed preparation in a worker with an empty environment reaches a private
  HTTPS authority through the coordinator's CONNECT proxy.
- Proxy refusal leaves no staged/public work, start, deadline or consumed saved-
  work allowance. Retrying preserves the source and receives fresh verification.
- The full allowance starts only at actual Begin; protected collection uses the
  same route from its isolated worker.
- Explicit direct routing stays direct even if a worker inherits another proxy;
  malformed private route metadata refuses before worker initialization.

Required checks: focused process/interface regression on starter and saved-work
sources, route-validation/refusal cases, affected native race suites, native
build/vet and actual local user-systemd environment-boundary qualification.
Privilege/account and containment hooks in ordinary process tests are synthetic;
they do not establish real PAM/student isolation. Production guest tests cannot
run while the reported preparation makes the host guard busy. Deployment and
production retry require a separate instruction; no timeout increase or stale-
policy fallback is part of this fix.

## Implementation and verification

The private worker frame has an optional callback_proxy field. Current
coordinators always send their resolved route, including an empty string for a
direct connection. Workers validate it before engine initialization and apply it
only to their callback client. Older internal fixtures without the field retain
their own environment lookup. There is no persistent/configuration schema change.
The normal coordinator continues to use Go's proxy environment selection.

The original implementation fails the signed-entry regression because an empty-
environment worker attempts direct DNS rather than CONNECT. The corrected starter
and saved-work cases pass refusal, explicit direct routing despite a conflicting
worker proxy, retry, fresh authenticated TLS policy, actual Start with the full
allowance, and protected collection. Saved source archive bytes stay unchanged
and its legacy consumption marker remains absent before Start. Malformed private
route metadata is rejected before initialization without reflecting credentials.
The same workflows pass through actual disposable local user-systemd services;
every owned unit is inactive with MainPID=0 after cleanup. Account admission and
writer containment hooks remain synthetic. No csc-sys guest test was run.

Native build and vet pass. The full native module race suite passes (core219.602s,
CLI6.978s). Frozen inputs and original dirty screenshots are checked before the
local commit. No browser/API, WASM, CLI syntax, native configuration or persistent
schema changed; unchanged application/browser evidence is reused. This is local
functional qualification, not a production installation/recovery rehearsal.
Exact observations and receipts:
var/collection-tests/workspace-callback-route.20261102a/.

## Operator inspection and proposed rollout

The installed CLI was checked to support this non-mutating inspection:

```sh
sudo examctl info ATTEMPT --read-only
```

Do not use unflagged info, workspace-prepare or collection retry merely to diagnose
the connection. An explicitly root-run management command also needs its intended
outbound proxy environment; sudo does not inherit the agent service's environment.
After the installed transport is repaired and the preparation is still valid,
the existing workspace-prepare workflow remains supported. An expired/cancelled
setup needs ordinary student setup again; never clear state or fabricate a clock.

Proposed deployment: freeze/checksum the matched native artifacts, reuse unchanged
kernel/resource-boundary evidence, qualify the guarded installation/recovery path,
then obtain a new deployment instruction. The instructor must leave preflight so
the existing drain guard can pass before any matched-role replacement/restart.
Install the matching native cohort, preserve current authority/storage and verify
callback readiness before reopening. No web image, database migration, clock reset,
grant reissue or source rewrite is required by this correction. Rollback must keep
current state and matched roles; the previous native release still has this route
bug, so restoring it does not restore working preparation on this network.
