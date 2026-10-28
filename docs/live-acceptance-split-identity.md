# Controlled live acceptance with separate SSH identities

October 27, 2026. The instructor cannot supply another MFA-enabled institutional
identity and explicitly authorized creating an ordinary csc-sys account, using
`mcadilha` only to authenticate through sshjump. This replaces the request for
another person's account. No change to `mcadilha` privileges or its practice-only
exception is needed.

## Bounded workflow and current result

1. Qualify a private test-browser adapter against real local SSH servers and
   Chromium/WASM. **PASS.** It uses distinct hop identities, requests the jump
   password/MFA once, never offers that password to the class host, and retains
   four control channels. Wrong key/user/pin and incomplete setup refuse. Existing
   client races and two browser-adapter tests pass.
2. Create and identify a new ordinary class account; verify a real pinned SSH
   login and prepare one labeled synthetic exam/grant. **PASS.** No student
   record, previous account row, SSH/PAM rule or native service was changed.
3. Use the installed gateway/native services for real jump MFA, entire-screen and
   webcam capture, fullscreen/keyboard permission, zero-clock preflight and a
   five-minute Begin. **PASS, October 28.** The instructor explicitly clicked Begin.
   A deliberate fullscreen loss froze both terminal cgroups; reviewed CLI approval
   and explicit Continue preserved the same SSH transport and Nano buffer.
4. Issue a reviewed NEW three-minute saved-work grant with a finite Begin window
   outside the expired exam defaults. **PASS.** Native durable source retention
   preceded availability. Actual Begin granted the full 180 seconds; all eight
   saved files retained their bytes/modes/mtimes. Early Finish protected the new
   archive while ordinary SSH remained denied until the original deadline.
5. Inspect only the two synthetic dashboard rows and remove test credentials and
   browser ownership. **PASS.** Both rows show secured submissions and the correct
   source lineage; instructor signed out and the exact browser/tunnels exited.
   No personal browser or unrelated student row was accessed.

Public admissions remain fenced pending the notification-only correction found
at normal expiration. The initial controlled email was received exactly once;
do not repeat that test. The deliberate interruption produced one appropriate
notice, but a healthy three-second timing handshake also produced a false recovery
email. Its local regression/fix and deployment gate are documented in
[deadline timing notifications](deadline-timing-notifications.md).

## Actual setup

The new local account is `examacpt27`, UID/GID 28027, `/bin/bash`, private home
`/home/examacpt27`, no supplementary groups or sudo rights, locked password and
no lingering. Name/UID/GID and native history collision checks passed. All
pre-existing passwd/group/shadow/gshadow rows were preserved. The unchanged
`exam-account-policy identify` and a real SSH `id -u` both verified UID 28027.

Its sole bootstrap authorization is a separately generated Ed25519 test key,
restricted to loopback and the observed jump peer, with agent/port/X11 forwarding
and user RC disabled. It expires October 28 at 01:49:18 Chicago (06:49:18 UTC).
For the second login, the synthetic key's original source restriction rejected a
second actual jump peer. Root sshd evidence verified it; only this test key's
restriction was updated to the two verified peers and loopback, retaining its
expiry/forwarding restrictions. The instructor retried real MFA successfully.
No password defect, SSH/PAM/configuration bypass or service restart was involved.
The account itself expires October 30. No institutional password was copied,
stored on csc-sys or sent to the class account. Private test-key bytes remain in
the private development run/browser; only its public key was installed on csc-sys.

Supported CLI workflow installed/verified/synchronized the new three-file,
372-byte C++ source as `acceptance-20261027`, exact version
`e033c65acaa251851bdea7d72b7676ba2e16322cb477362cf09e4e04a91298d3`.
The new `live-acceptance-20261027` definition and its only enrollment issue grant
`c109de42-60a7-4062-b25b-c0411fb0b1ab`: 300 seconds, required webcam, two terminals,
128/512 MiB collection limits and an explicit two-hour Begin window. Issued
settings and empty claim history were inspected; no attempt/clock was created.
This is synthetic authorization, not a change to a course exam or student grant.

October 28: that window expired while unused. `grants show` confirmed revision 1,
AVAILABLE and no claims; native state had no synthetic-account attempt. An explicit
`examctl web grants revise --revision 1` changed only its Begin window, retaining
the same grant/source/300s/webcam/two-terminal settings and full revision history.
Revision 2 is available until 01:24:38 Chicago; no clock or allowance was consumed.
The class key remains valid until 01:49:18 Chicago. Inspect current authority before
any further revision; never create another grant as an unstarted retry.

After fresh native/web full-drain guards, only the gateway was restarted on the
same qualified image with maintenance false for controlled acceptance. The exact
external nginx start fence remains in place. Public auth/preflight/Begin probes
still refuse 503; public live/ready health return 200. SSH, relay and native
services were not restarted. The owned browser reaches the same public TLS
origin through an owned loopback SOCKS4 connection on marco.

## Human browser location — October 28 correction

The instructor controls Codex remotely from **euler** and could not see the first
dev-host Chromium window. That owned window/forward and controller56119 were
closed with a cleanup receipt; no SSH sign-in or exam had begun. No personal
browser or production service was stopped. Do not repeat the dev-host GUI setup.

The instructor explicitly authorized SSH to euler. Its installed Chromium154,
display:0 and real camera devices are available. A fresh owned profile on euler
has password saving disabled; its PID/start time/profile lock and newly published
debug endpoint are verified. Chromium flattens `/proc/.../cmdline` into one title;
the startup oracle now verifies the exact profile token and profile-lock PID rather
than assuming NUL-separated arguments. Failed owned startups exited before retry.

The now-closed controller exec53952 connected only to that new empty profile. An owned
SSH pair carries CDP to development and SOCKS4 back to euler through marco; every
browser/proxy listener is verified as loopback-only. No public debugging port,
test URL, new deployment, personal-profile access or extra package is required.
The real TLS form is prefilled on euler with the same private WASM substitution.
MFA answers remain in the browser, capture uses euler's real display/camera, and
the instructor must stop at preflight until the timed checks are ready.

Receipt: `euler-browser-start.json` in the private run; launcher/controller files
are `launch-euler-acceptance.py` and `euler-acceptance-browser.mjs` in the run root.
Keep this browser/tunnels while the human step is pending or an attempt is active;
only close their exact owned identities after the test is safely drained.

## Adapter boundary and verification limits

The shipped client deliberately shares the username/password between hops. No
production source, image, WASM, configuration schema or normal login behavior was
modified to add another account mode. The private generator
`tests/acceptance-split-ssh/prepare.py` copies the browser module into per-test
output, records source hashes and an exact diff, and changes only bootstrap
identity/key selection in that copy. The owned browser substitutes that WASM
response. Its matching Go runtime is byte-identical to the deployed runtime;
the packaged worker and other application assets remain deployed bytes.

`browser-adapter.js` permits one exact, unexpired connection to the configured
relay/hosts/pins and synthetic identity, then drops its test-key reference. It
does not inspect or change authentication answers. The copied Go client uses
the class test key instead of any password fallback and discards its key field
before retaining class-host settings. Normal signed root receipts, Unix peer
identity, temporary account policy, handoff certificate, monitoring, input/writer
barriers, deadlines and collection are unchanged and remain mandatory.

This qualifies real institutional **jump MFA** and actual ordinary-account
enforcement on the installed class server. It does **not** claim a new test of
institutional password authentication on the class hop or byte-identical bootstrap
WASM. The substituted bootstrap is explicit; it grants no exam permission and
cannot impersonate the synthetic UID without its actual SSH authentication.

Focused split-identity races passed in 1.073s, split/shared-wire focus in 1.124s,
and final complete copied-client races in 1.493s. Actual
Chromium/WASM/two-hop SSH and four retained command channels passed. Initial
copied-suite failure lacked its shared wire fixture; the generator now copies
that exact producer fixture. Initial browser-probe failure used the wrong
`ssh2` zero-prompt argument order; the documented order fixed the fixture without
weakening the phone-notice assertion. Failed receipts remain in per-test output.

## Evidence and safe cleanup

Run pointer: `var/collection-tests/production-cutover.td6oq2x6/split-ssh-acceptance.json`.
Private run: `split-ssh-acceptance.iud4irx0`; receipts include source/diff/build,
focused/full races, browser probe, account creation, actual class SSH login,
template/CLI setup, gateway restart and owned browser startup. No real student
data or server-private key was downloaded. Production identity setup/audit stays
root-private under the class rollout directory's `live-acceptance-examacpt27`.

The class host prohibits administrator TCP forwarding; it was preserved. The
synthetic login check used the existing jump route with the distinct class user.
Failed owned forwarding probes exited and their sockets were removed. The live
browser owns a separate short `/tmp/sxaccept.*` control socket; close only that
browser/controller/forward and verify its cleanup receipt after the test drains.

After protected collection and every original/current hold legitimately ends,
remove only the exact synthetic bootstrap authorization/private development key.
Keep the UID/name reserved for historical identity, with password locked and no
remaining login key. Preserve labeled attempts, grants, source pins, audit and
protected submissions; archive the test definition through reviewed CLI retirement
when its dependencies permit it. Never delete account/history or restore old
DB/state to manufacture cleanup. Reopening admissions is a separate final gate.

## Completed human workflows — October 28

Initial attempt `0bcf71b7-d182-4043-968b-b9e114c29ecf` began at
1793164662753 with original/current deadline1793164962753: exactly300 seconds.
Actual C++ compilation/execution and GDB passed. Both terminal scopes reported
kernel frozen=1 during the deliberate hold. Approval request
`a9a183f8-b182-466a-8294-fa7a981ebf77` granted review, not execution; explicit
Continue restored work after fresh browser verification. The SSH transport ID
remained identical; Nano's `UNSAVED-EULER-RETAINED-20261028` marker was saved before
expiration and appears in the protected archive. One synthetic command-typing
mistake also remains honestly in that file. This does not qualify the separate
originally-stopped-job assertion; that remains covered by prior isolated tests.
Protected expiration checksum:
`95cd5ec6a1b05f778defee6aaa2d905d306fd5254a7206e1bca8dd579b18c497`.
Ordinary SSH succeeded after NORMAL/RELEASED at the unchanged deadline.

NEW saved-work grant `1debc2b5-b5d9-40e1-9cca-194e6699f353` was first PENDING_NATIVE,
then RETAINED/AVAILABLE after supported source synchronization. It retained webcam
requirement, two panes and the exact first archive identity. Attempt
`e8e65c21-6123-4825-8bcf-8c6ac5e6c8c2` remained zero-clock in preflight, began at
1793165757132 with original/current deadline1793165937132, exactly180 seconds.
Terminal verification printed `RESTORE_OK_180_SECONDS 28027 0o640`; all eight source
files match bytes/mode/mtime in both protected archives, with only a new synthetic
file added. Confirmed early Finish ended1793165874406, checksum
`38d804db348ab3bcef0a17aba3695b5d5af33c45b08d8d94a6147e59d72738b6`.
Actual ordinary SSH refused with the exam-guard message while HELD, then succeeded
at the original deadline after NORMAL/RELEASED. No refund/reopening/hold override.

The instructor selected the synthetic exam after signing in directly. Each row was
inspected through its exact username/grant control, preserving unrelated records.
Both showed Submission secured, correct allowances/webcam/source. The instructor
session was signed out through UI and /api/session returned401. Exact Euler PID,
start time/profile and owned loopback SSH tunnels were closed with a cleanup
receipt. The synthetic SSH key authorization was removed after both legitimate
hold releases; UID/name remain reserved, password locked, protected history intact.
The matching local private key was unlinked and all three exact owned Euler
profiles removed after no-process proof. Reviewed exam archive request
`fad35204-968a-430b-9162-80f9c3878931` produced revision
`ddd6efbd13f34131bc8b379ed7be3d6e0c27a7e64b73a8d898a5395602d392e6`.
Both protected attempts/grants/source pins remain; UID/name stay reserved. No class-server or SSH service was restarted for this test.
