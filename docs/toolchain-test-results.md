# Normal student filesystem qualification

The earlier minimal toolchain lacked G++, GDB, Python, Java and editors. The final
implementation uses the normal server filesystem read-only with explicit security
exclusions. It replaces the temporary per-toolchain mounts. See the
[installation and recovery procedure](../ssh-server/README.md#normal-server-filesystem-deployed-student-environment)
and the updated filesystem specification in [design.md](../design.md).

On csc-sys (Ubuntu 24.04), the real systemd/bubblewrap/setpriv launcher with unused
UID/GID 29999 passed the installed environment test on 2026-10-18:

- All 2,152 public installed commands are executable in the student namespace.
- GCC/G++ compile and run programs. GDB starts the C program, breaks at main and
  produces a backtrace. Both Python commands import ctypes, SSL and SQLite.
- Java compiles/runs; Emacs and Vim start through their disposable-state wrappers.
- Normal home files and startup preferences are readable; home/software writes fail.
- Work, private temporary directories and disposable application state are writable.
- Host control sockets and agent configuration/submission metadata are hidden.
- All capability sets are zero and NoNewPrivs is one.

Core tests cover uncovered socket rejection, prefix/alias handling, unsafe exclusions,
actual home bind arguments and redirected home rejection. Installer tests cover
active/preparing attempts, early-completed access holds, unresolved account policy
and service socket inventory. Native regressions, race detection and vet pass.
The administrator sandbox is unchanged.

The two earlier toolchain backups are historical rollback steps, superseded by the
normal-filesystem deployment backup:

- `/var/backups/ssh-exam/20261018T051121Z-toolchain-urjg6rdo`
- `/var/backups/ssh-exam/20261018T050921Z-toolchain-9jtpq1nr`
