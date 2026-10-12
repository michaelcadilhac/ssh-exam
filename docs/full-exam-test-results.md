# Real-server functional test results

2026-10-11, csc-sys.cdm.depaul.edu, Ubuntu 24.04.4, trusted administrator mcadilha.

The root agent, watchdog, reconciliation timer and test SSH service were installed and
checked. Original SSH/PAM/account/sudo settings remain unchanged. The local app uses real
jump/class host pins, phone MFA authentication, and an independently authenticated mTLS
control relay. All private artifacts are excluded from source control.

## Verification

- Native Go race suite: 44 top-level tests passed, including raw PTY input/restoration and
  process-scope termination races. Python native checks: 8 passed.
- Application suite: 80 passed. Browser suite: 10 passed, including terminals, fullscreen,
  no-webcam step numbering, logout, stale preflight and MFA message preservation.
- Focused instructor regression passed after fixing same-exam reselection clearing the roster.
  Actual port-3001 instructor login, mcadilha roster, reselection and logout also passed.
- Real protected terminals: actual UID/GID, all five capability sets zero, NoNewPrivs=1;
  typing, Ctrl-C, terminal closure, saved answers and background writer collection passed.
- Early finish: secured archive/manifest, original deadline unchanged, access state HELD,
  repeated finalization unchanged, finished attempt cannot open another channel. Watchdog
  released the attempt interval only after its original deadline.
- Deadline with no SSH/browser connection and stopped control agent: independent watchdog
  collected at the original deadline. Agent restart recovered status and checksum-verified
  download from the same protected copy.

Early-finish attempt: `6beda8aa-ca80-4f27-8f91-66acbbf1da8b`.
Archive SHA-256: `94e05b0049f8ac06edc8f0398cd4195378b953d11046f13d75e66c72e325375a`.

Deadline/outage attempt: `957ba043-700f-4f84-b88f-f8933950f75e`.
Archive SHA-256: `b4781712d99a78e635b5368059f66e8e4c06397cc5a835f1a42aa3aa4cc6e4f3`.

Reports, downloaded archives and manifests are private under var/full-test. Protected
originals and administrator-controlled deadlines remain on the class server.

## Scope

This privileged-account exception does not qualify production isolation: ordinary SSH and
sudo remain available to mcadilha. Production qualification requires an unprivileged managed
student identity and the deployment's full alternative-access/scheduler checks. Automated real
server checks used the SSH agent; the user's password and phone MFA must be exercised manually
in the browser. Saved files are collected; unsaved editor buffers are not included.

## Requested account-access corrections

The real jump prompt is `Entra Id Password: `; its exact hidden password spelling is now
recognized without treating other hidden prompts as passwords. All 22 focused login tests
passed, including one entry across both hosts, MFA preservation, rejection and cleanup.
The native race suite passed after adding private-umask and host-mode policy checks.

Real host terminal attempt `6c3d1ee8-8cbb-4a73-8f17-e496d1c6a83e` verified name lookup,
real home reads/writes, Emacs, existing sudo privileges, Ctrl-C, background-writer cutoff,
immutable collection and the original interval hold. Archive SHA-256:
`f9f73f4a4530816feb455b644d24379cf555465b15c7e70d3d074623a60d491b`.
A subsequent real practice terminal also started interactive `emacs -nw`, displayed its
buffer, exited with C-x C-c and returned to a usable shell. Reports remain private under
var/full-test. This trusted host-access mode intentionally retains normal account privileges.
