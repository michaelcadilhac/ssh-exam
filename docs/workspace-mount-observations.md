# C4b0 mount-topology prerequisite — not cleanup proof

October22,2026. Investigation/implementation in progress; internal/unwired, not
deployed. Current workspace metadata still says eligible=false and there is no
deletion command. The existing UID writer check does not enumerate foreign
namespace mounts or other supervisors' cwd/root/open/mapped file references.
Do not reuse destructive collection quiesce for retention: it changes work owner/
mode and can terminate workloads. C4 requires non-interrupting fresh proof.

First bounded primitive: parse complete mountinfo with exact integer IDs/device,
escaped canonical source root/mount point, unknown optional tags and explicit
size/line/count limits. Map a pinned local descriptor's current mount ID/st_dev
and corresponding path to its filesystem-root position. Correlate other supplied
views by device AND source-root relationship, not lexical mount point or st_dev
alone; a same-filesystem bind is a real reference. Return exact/descendant/
covering-ancestor observations only, never busy/safe/eligible booleans. A normal
whole-filesystem ancestor cover is not automatically active use, and no match in
one input is not absence proof.

The primary Linux [mountinfo documentation](https://man7.org/linux/man-pages/man5/proc_pid_mountinfo.5.html)
defines bind source roots and process-root-relative mount points; parent rows can
be missing outside a chroot view. Mount IDs can be reused. The descriptor's
[fdinfo mount ID](https://man7.org/linux/man-pages/man5/proc_pid_fdinfo.5.html)
correlates the containing mount, not owner/namespace lifetime. A process's
[root view](https://man7.org/linux/man-pages/man5/proc_pid_root.5.html)
includes its namespace but can be unavailable/restricted. Memory-map paths are
[ambiguous](https://man7.org/linux/man-pages/man5/proc_pid_maps.5.html); later
usage proof needs actual device/inode identities, not path-string matching.

Before exposing workspaces dry-run/cleanup, still required: pinned complete
process/namespace inventory, namespace FDs/bind-held detached namespaces and
chroot-limited views, fd/cwd/root/mmap references (including deleted aliases),
permission/lifetime/race/resource failures, private parent/admission fencing and
fresh protected archive/hold/state checks. Enumerating /proc once is not a global
reference barrier. Retained kernel/asynchronous IO and ownership transitions also
must not be inferred from a stale process/mount table. These remain engineering/
qualification gates, not changed policy or a completed investigation.

Require synthetic parser refusals and actual same-device directory/file binds in
private user/mount namespaces before calling this primitive locally tested. Then
native race/build and interface-level complete-proof workflows remain necessary.
No primitive here authorizes cleanup, drops history/holds, reopens attempts or
changes grants/deadlines. Saved-work grants depend on verified protected archives,
not a reason to retain the old live folder indefinitely. No grace period or
automatic deletion is added.

Initial local qualification now passes ten native race repeats (3.341s), including
actual foreign-namespace same-device directory/file binds with escaped spaces,
backslashes and tabs; the host/parent namespace/alias identities and source bytes
are unchanged. Refusals cover malformed/truncated/duplicate-ID/oversized tables,
integer/path/escape errors and host execution without the private namespace.
A deliberate TEST-ONLY mountpoint-only relationship mutant makes both the
synthetic mapping and actual kernel alias test RED. Source-root matching is
restored immediately; no live caller or mutant remains. Restored ten race repeats
pass3.254s. Bounded two-worker fuzz passes57445 executions/11.020s. Full native
race/resource/namespace/compiler/default-size passes core172.616s/CLI10.615s;
all414 app/79files pass88.29s, static build/vet pass. All140 web source/runtime
hashes remain identical to the113-browser/12.8m artifact; no web edit/rebuild
occurs. This internal prerequisite is implemented/tested locally, not a complete
C4b/C4c investigation, supported cleanup or completed TODO. No privilege/production
qualification is inferred from the private local mount fixtures.
