# Proposed automatic SSH account admission

Status: awaiting explicit operator approval after automatic approval review rejected
implementation of persistent per-account shell/group changes. No such changes have
been applied. This proposal does not authorize them itself.

The web roster remains the exam authorization source. A new, enrolled student signs
in to both verified SSH hosts with the existing one-password and MFA flow. Only a
valid, short-lived, gateway-signed registration on that student's actual SSH transport
may ask the root agent to prepare the account. The agent derives identity from the
kernel peer UID and NSS; client flags, supplied UID, localhost and environment variables
cannot authorize setup. Replayed/expired/wrong-account requests cannot grant admission.

Preparation checks that the existing account is unprivileged, has a unique supported
NSS identity and home/shell, has no sudo authorization or privileged group membership,
and can satisfy the existing SSH/PAM/process/scheduler/service isolation policy. It
never creates a Unix account, password, home, or user files. Administrator/recovery
accounts, including mcadilha's sandbox exception, must not be modified.

The root-owned helper backs up and durably records the original NSS identity before
changing policy. For a local account it installs the existing exam-login shell. For
an SSSD-backed account such as ppanagop it installs a per-user SSSD shell override;
it does not edit the institution's directory or replace the global default shell.
An existing unrelated override requires administrator review rather than replacement.
It adds the account to exam-managed and disables lingering. It inspects actual effective
SSH/PAM/scheduler/service policy and refuses exam preparation if enforcement is missing.
No arbitrary scripts, destinations or credentials are accepted by this helper.

First initialization of SSSD's local-override view may require one brief SSSD restart
at installation while timed attempts are drained. Existing administrator identity and
its SSH/PAM policy remain unchanged. Subsequent setup must use per-user cache refresh;
it must not restart SSSD for every student's login.

The first bootstrap SSH connection predates the shell/group policy, so it cannot be
used to start an exam. After setup, the UI must explain that the account is prepared
and request a fresh sign-in. Passwords have already been discarded after both hosts
authenticate; they must not be retained or silently reused for this reconnect. No exam
clock starts during this setup. ppanagop can be prepared during deployment so his next
login uses the gate from its first session/channel.

The agent, watchdog and examctl must reload administrator-controlled account records
safely, without blocking deadline cutoff on long-running setup. Stored identities are
operational setup records, not a second instructor-maintained exam roster. Every later
SSH login/channel still enforces gateway signatures, current transport and attempt state.
Exam start still neutralizes existing UID processes and connections before material is
released. Early finish never restores ordinary access before the original deadline and
verified protected collection. Account setup is idempotent and partial failures stay
recoverable; automatic rollback must never release a live or held attempt.

Required tests include peer/name spoofing, invalid signatures, wrong exams/accounts,
expired/replayed registration, privileged and duplicate UID rejection, local versus NSS
setup, existing override refusal, interrupted setup/retry, fresh-SSH requirement,
watchdog/config reload, startup-file/channel and background-writer isolation, early
completion holds, restart recovery, and unchanged mcadilha recovery access.

Rollback requires drained/unheld attempts and verified protected submissions. Restore
only the affected accounts' recorded shell/override and group membership; never restore
an old attempt database or deadline. Preserve audit and all protected submissions.
