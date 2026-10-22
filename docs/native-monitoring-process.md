# Native process lifetime: private coordination increment

October22, local and unused by runtime flows. This is **not** an authenticated
ACTIVE-context factory, a held recovery decision, verified freeze or SSH-retention
mode. No command, capability, input bridge or watchdog uses it.

The process guard pins an exact Linux pidfd between matching bounded proc
snapshots: native boot, PID/start ticks, all four real/effective/saved/filesystem
UIDs and executable device/inode. A final nonblocking kernel check rejects exit
during the bracket, including a reused numeric PID. There is no PID-only fallback
when the kernel handle is unavailable. The descriptor is close-on-exec.

Every current check polls that exact handle with timeout0; it does not rely on
a potentially delayed cached goroutine flag. Only bounded nonblocking kernel
checks run under its small mutex, never proc/filesystem/network reads. Close is
serialized with those checks. Kernel exit, operational unknown and explicit
retirement are separate states, not student policy findings. A stopped/stalled
process or another short-lived command exiting is not the pinned process's exit.
JSON metadata cannot reconstruct the live descriptor.

The separate SSH pin helper requires real/effective root, a native local-peer PID
and course UID, the existing matching transport identity, actual installed
trusted entry/SSH executable inodes, an all-root privileged monitor UID tuple
and repeated ancestry checks around pinning. It is not enough for a process to
be named sshd or be root. No test here claims a positive actual OpenSSH/PAM peer:
local positive tests use generic owned synthetic processes; root-mapped tests
only prove untrusted executable refusal.

Before any ACTIVE seal factory, still verify current native registration, account,
ACTIVE/unexpired state, generation/clock/deadline, root-owned page/input epochs,
exclusive actor claim and actual authenticated peer/channel roles. A live pidfd
alone does not prove network viability, current role/IPC state or authorization.
Periodic actor/input/watchdog checks and full cross-process handover remain
mandatory. Do not treat kernel-observation errors as positive authentication loss
or reconstruct authority after actor restart.

Six substantive tests (plus the private child helper) pass twenty native race
repeats (2.63s): actual owned-child SIGSTOP/CONT and SIGKILL/reap, independent
command lifetime, changed identities, JSON/fabricated-label refusal, closed vs
unknown handles, concurrent checks/close, namespace-root fake-peer refusal and
late synthetic authority acknowledgement after process death. These signals
target only owned Go test children, never an SSH daemon or exam. Full frozen
native race/resource/namespace/compiler/default-size qualification passes
(core172.99s/CLI7.29s), static build/vet pass. Actual privileged positive SSH/PAM,
all-writer freeze/input discard and retained-mode qualification remain open.
