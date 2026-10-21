# Saved-work restoration metadata

Local implementation, October 20, 2026; **not deployed**.

Protected archives contain regular-file bytes, ordinary permission bits and tar
modification times. Extraction stages files privately as 0600, verifies hashes,
assigns the intended student UID/GID, then applies ordinary 0777 bits and available
mtime explicitly and syncs them. The service's 0077 umask no longer silently
removes executable/group bits. Privileged ownership, setuid/setgid, capabilities
and links are never restored. Protected sources are never rewritten.

Precision follows the existing archive/filesystem, including PAX nanoseconds when
present. A zero/absent tar timestamp (Unix epoch zero) is treated as unavailable
legacy metadata and keeps extraction time; an actual epoch-zero original cannot
be distinguished. Mode zero is preserved. Atime is extraction atime, not an
original. No original directory modes/times, ACLs, xattrs, access/birth/change times
are reconstructed. Current archives lack directory headers; new private
directories deliberately use 0700. Future directory metadata needs separate format
versioning and ordering of directory metadata after children.

Tests use real collection/restoration under restrictive umask, nested files and
executables, PAX precision, absent legacy mtime, privilege-bit filtering and an
actual `make -q` check. Restart tests reconstruct publication before/after the
initialized marker: committed clocks and one-use history survive, and existing
student edits cannot be overwritten. This is not complete process-death/disk-full
qualification of every boundary.

The larger ACTIVATING transaction remains under investigation. Never reset a
consumption marker/interval or retry extraction over student changes. Inspect
`examctl info ATTEMPT` and `examctl manifest SOURCE`; preserve workspace/staging,
root grants/markers, state and verified source for explicit repair. A supported
repair/time-credit workflow remains unimplemented. C1/C2 now approve agent-based
management authority and unified grants with private pre-Begin staging; repair
compensation policy and full initialization failure qualification remain pending.

Deploy in an authorized drained window. No protected-archive migration is needed.
Rollback retains all intervals, grants/markers, restored work and protected copies;
older code may lose metadata on future restorations, so requalify before admission.
