# Recovery consumption publication — locally tested, privileged gate pending

October22,2026. Confirmed correctness fix implemented in the local working tree;
full local qualification passes; exact-artifact privileged qualification remains
pending. Not deployed or a completed
recovery/unified-grant investigation. This follows local crash qualification
6cfd9d4. Preserve all grants, markers, intervals and protected work.

The original publishWorkspace and legacy initializeRecovery wrote the authoritative
`.json.consumed` name with durableFile, creating its final name before writing/
fsync. An actual8KiB private-tmpfs ENOSPC regression now confirms an empty final
marker remains, loses its storage-error category and makes supported root CLI
repair refuse as already used. A separate actual read-only catalog masks EROFS
as a conflict too. Both regressions are RED on the original writer (0.853s); two
real read-only work-rename/initialized controls already pass. This is synthetic
storage evidence, NOT the reported production incident's cause.
Existing strict readers correctly refuse ambiguous markers; do not weaken them
or overwrite a retained marker to make repair work. The committed-start fence
must still prevent a second attempt when a marker is absent.

Synthetic qualification now exercises real disk-full catalog and read-only catalog/
work-rename/initialized views in guarded private user+mount namespaces, healthy
independent signed renewals, supported root CLI repair after restoring only the
owned test fault, exact original clocks/holds/source bytes and explicit collection.
Never fill a shared host filesystem, remount the host, or run a real UID-killing
collector from a root-mapped test. Root CLI repair is metadata publication only;
OS/account/writer admission remains explicitly fake. Retain the failed evidence.

Both writers now share complete no-replace marker publication: create an unnamed
inode in the pinned private catalog, verify ownership/type/zero links, set0600 on
only that new inode, write/fsync, publish atomically from zero to one link and
fsync the pinned parent. Errors retain errno/category and actionable original-
interval/grant inspection and workspace-repair guidance. A matching retained
marker still requires bounded private fresh validation and directory sync; no
foreign/incomplete/unsafe marker is changed. A crash before publication closes/
reclaims the unnamed inode without a catalog orphan. Marker format remains the
same36-byte attempt UUID; no existing record/clock/schema is rewritten.

Saved-source staging probes anonymous creation/write/fsync before even adopting
an existing private ready receipt. Known unsupported/read-only/full consumption
storage refuses before Begin without time or marker consumption. It runs inside
the bounded staging worker, not the global state transaction. This is not a disk
reservation, live permission or guarantee against a later failure. Fresh actual
Begin/one-use/source/receipt/account/clock guards remain mandatory.

Linux documents O_TMPFILE plus linkat publication and the own-/proc/self/fd
AT_SYMLINK_FOLLOW form without requiring CAP_DAC_READ_SEARCH. Filesystem support
must be qualified; do not add capabilities, silently fall back to partial final
writes, or claim compatibility before testing the actual hardened target.
Primary references: [open(2)](https://man7.org/linux/man-pages/man2/open.2.html),
[linkat(2)](https://man7.org/linux/man-pages/man2/linkat.2.html).
Only the kernel's own retained file descriptor is followed, never an arbitrary
student/caller link. Tests verify single-link private metadata and no-replace
behavior; no service capability/configuration is changed. Filesystem/procfs/
hardened-service compatibility remains an exact-target qualification gate.

## Local verification and remaining gates

Two initial real storage/old six-boundary process-death repeats pass6.925s after
the correction. The expanded matrix adds actual readonly preflight refusal and
SIGKILL after unnamed writes/flushes but before link, proving no named orphan and
continued original-start/one-use protection. Three final focused native race
repeats pass12.678s:48 actual child-death cases, actual root CLI repair/refusal,
five real storage scenarios per repeat, healthy signed peers and exact protected
source/answer/clock/hold checks. OS/writer admission is fake; this is not normal-
root institutional SSH/PAM/cgroup qualification.

Five initial marker-only race repeats pass1.312s, covering sixteen competing
publishers, exactly one complete winner, no replacement/orphan, pre-link failure,
restrictive-umask600 privacy and untouched matching/foreign/empty/FIFO/link/public
markers. Their first unit fixture used a nonprivate testing directory and was
correctly rejected; the fixture was fixed to0700, not the guard. Final focused
tests also include refusing a public directory without chmod/repair. Native CLI
help regression is RED before adding filesystem/storage/retry guidance; actual
process help passes three repeats1.087s. Two broader recovery/marker race repeats
pass42.895s. The first full native run failed because two raw archive-decoder
fixtures called the consuming initializer without a committed start; they now
exercise the nonconsuming extractor and assert no marker. The durable-start
guard is unchanged. The final full native race/resource/namespace/compiler/
default-size run passes core273.777s/CLI23.267s; all426 application tests in80
files pass97.88s, static builds/vet and35 Python checks pass. All174 browser
source/runtime hashes still match the nine-check real browser/WASM SSH run.

A separate signed-Begin regression also reproduces an accepted consumed marker
whose matching target has no known original interval (RED0.033s). Admission and
catalog inspection now share the chronological committed-interval predicate:
start at/after grant issuance and both deadlines after start. Missing/uncertain
intervals refuse before OS admission or new time consumption, even if the marker
UUID matches. Expired but known intervals remain known; no historical clocks
are invented, reopened or refunded. This is not a complete inconsistent-backup
recovery protocol or unified expected-source migration.

The instructor explicitly approved uploading the exact code-only synthetic test
bundle to /var/tmp/ssh-exam-atomic-consumption-upload.QBtItC on csc-sys. The
private0700 directory contains exactly the16 expected files; all14 manifest
artifact hashes and the wrapper hash match. No installation/deployment occurred.
The next boolean-only raw authority guard reports BUSY, so no candidate guest
was started and no privileged PASS is claimed. Use only the continuously guarded
disposable guest when eligible, never clear live/unresolved work to run a test.

No new code reconstructs an OLD malformed/partial marker. Retain/refuse it for
explicit reviewed diagnosis/migration; never remove it, infer unused authority or
reset time to force recovery. The correction prevents new partial publication,
not a supported editor for ambiguous historical authority. Full every-boundary
disk faults, new exact-artifact guarded guest qualification, global storage-
failure liveness/C10 and unified issuance/expected-source migration remain open.
No production mutation or temporary-agent consolidation is authorized/executed.
