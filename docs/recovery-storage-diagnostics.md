# Saved-work staging storage failures

October22,2026. Local correction following recovery-consumption atomicity commit
2c2b9c3. Not deployed; this does not complete C7/unified-grant recovery or
privileged containment qualification.

The expanded real storage matrix exposes a separate confirmed error-reporting
bug: ENOSPC while streaming a saved file into private staging was collapsed into
`recovery file verification failed`. A valid protected source was thus presented
as a verification problem, and the supported caller lost `errors.Is(ENOSPC)`.
The isolated regression is RED0.476s before correction, with no committed start,
no marker, intact protected source and a successful retry after restoring only
the owned test filesystem. This is synthetic evidence, not a production incident
diagnosis.

The extractor now distinguishes copy, fsync and close errors with wrapped causes
from an actual completed-copy hash mismatch. It still closes the file and removes
only its exact unpublished private staging directory. It never changes a source,
grant, marker, original interval, account hold or verification rule. The existing
shared staging refusal explains that the clock is unchanged and names
`examctl info ATTEMPT` and `examctl workspace-prepare ATTEMPT` after repair.
Do not replace valid source archives, remove consumption records or issue extra
time merely to work around a storage error.

## Qualification

The storage matrix expands from five to eight scenarios: before-copy disk-full,
before-copy readonly and receipt-publication readonly, alongside consumption
readonly/full and live-work/initialized publication readonly. Each uses a
single-UID private user/mount namespace, checks namespace separation before
making mounts private and targets only new synthetic scratch directories.
An8KiB private tmpfs reaches real ENOSPC; no host filesystem is filled/remounted.
Full extraction uses current-UID mapping with namespace-only capabilities, not
the metadata-only root CLI fixture's root mapping. The initial fixtures failed
on an unmapped chown UID before reaching the intended IO; only the fixture was
corrected, without changing ownership/verification guards.

Three final native race repeats pass5.349s, including24 real fault workflows,
independent signed healthy renewals, actual metadata-only root CLI repair for
committed failures, unchanged source/archive/manifest/clock/hold checks and
verified usable repaired private stages in the parent mount view. Pre-Begin
failures consume no allowance and expose no live work. OS/account/writer guards
remain fake; a root-mapped test must never run a real UID-killing collector.

Static builds and vet pass. Full native race/resource/namespace/compiler/default-
size passes core279.751s/CLI23.357s; all426 application tests in80 files pass
96.01s, and35 Python checks pass0.023s. The initial application run
passed424 tests with two opt-in compiled-root-CLI tests skipped; the full rerun
explicitly enables EXAM_MANAGEMENT_USERNS. Do not report the first run as426 PASS.
All174 browser source/runtime hashes still match the nine-check real browser/
WASM SSH run. New exact-artifact privileged qualification
remains gated on csc-sys idle eligibility; the latest raw boolean guard is BUSY.
The earlier uploaded atomic-consumption artifact does not include this later
diagnostic correction and cannot certify it.
