# Retained workload hierarchy observations — R1c local candidate

October22,2026. Private unused kernel reader after R1a/R1b. No runtime mode,
writer signal, delegation policy, admission, freeze/thaw or cleanup permit is
enabled. This is not complete C3/C11 qualification or a deployed change.

The reader walks retained real cgroup2 directory handles, records device/inode
identity and direct thread IDs at each node, and brackets each node's membership
and child identities. Open only single leaves with no-follow/directory flags;
never reconstruct a caller path or accept ordinary files as kernel hierarchy.
Reject observed replacements, duplicate/migrating TIDs, changed children, missing
views, unsafe roots or budget exhaustion without returning partial coverage.

Hard internal observation ceilings are128 scopes, depth32,4096 aggregate threads
and4096 directory entries per node. These do not alter submission entry/depth or
logical collection limits. The private test seam may only lower those ceilings,
not enlarge them through configuration/RPC. Every retained child/enumeration
descriptor closes; the caller retains ownership of the supplied root descriptor.

The kernel documents possible repeated TIDs during migration/reuse and permits
hierarchy changes and migration while frozen. Treat these as unstable observations,
not deduplicated or magically sealed coverage. See the primary
[cgroup v2 interface documentation](https://docs.kernel.org/admin-guide/cgroup-v2.html#core-interface-files).
This walk is not globally atomic and cannot prove a writer was not moving between
earlier/later observations. Full closed admission/delegation, exact task/group/
UID/lifetime checks, all-writer stop/freeze and input barriers remain necessary.
An empty root alone never proves its descendants or future launches are empty.

## Current local qualification

An actual owned user-manager scope contains a self-expiring unprivileged helper;
only this new synthetic scope is delegated to create two nested test cgroups.
The parent test remains outside. Move only that verified child group into the
deepest descendant, then require the reader to find it below the empty root.
Actual kernel controls stay64MiB/swap0/16tasks with15s runtime. Production
Delegate=no and all installed units/configuration are unchanged.

The test freezes only that owned scope and verifies kernel frozen1, then creates
a new child during observation while frozen1 remains true. The reader refuses
the changed hierarchy without partial coverage. Lower-budget node/depth/thread
failures also refuse, as do ordinary/closed/absent roots and enlarged budgets.
Skipping recursion makes the actual descendant test RED0.052s; that mutant is
restored in finally. Initial three repeats pass1.159s; twenty hierarchy repeats
pass2.245s and twenty final combined R1 races pass4.219s, including the actual
resource checks, dead-leader stop/identity and individual-exit fixtures.

All426 application tests pass98.97s, static build/vet pass; full native race/
resource/namespace/compiler/default-size passes core280.307s/CLI24.891s. No browser
source/runtime change; the final174-file comparison matches the last nine-check
browser/WASM SSH run. Normal-root
hardened/privileged and combined all-writer/input/closed-launch qualification are
still separate gates. No new candidate was uploaded, installed or deployed.
