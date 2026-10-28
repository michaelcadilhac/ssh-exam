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
3. Use the deployed gateway/native services for human jump-host MFA, real capture,
   preflight without a clock, five-minute Begin, retained hold/approval/Continue,
   protected finish and original/current-deadline account restoration. **OPEN:**
   the owned headed Chromium window is waiting for the instructor's SSH sign-in.
4. Issue a reviewed NEW three-minute saved-work grant with an explicit finite
   Begin window; confirm durable native source retention before availability.
   Verify restored bytes/metadata, full allowance only at Begin, protected finish,
   access/credential cleanup, dashboard agreement and no duplicate alerts. **OPEN.**

Stop before Begin until the instructor completes real SSH/MFA and capture setup.
Do not reopen public admissions until all required acceptance and final drain
checks pass. Email delivery is already confirmed exactly once; do not repeat it.

## Actual setup

The new local account is `examacpt27`, UID/GID 28027, `/bin/bash`, private home
`/home/examacpt27`, no supplementary groups or sudo rights, locked password and
no lingering. Name/UID/GID and native history collision checks passed. All
pre-existing passwd/group/shadow/gshadow rows were preserved. The unchanged
`exam-account-policy identify` and a real SSH `id -u` both verified UID 28027.

Its sole bootstrap authorization is a separately generated Ed25519 test key,
restricted to loopback and the observed jump peer, with agent/port/X11 forwarding
and user RC disabled. It expires October 28 at 01:49:18 Chicago (06:49:18 UTC).
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

After fresh native/web full-drain guards, only the gateway was restarted on the
same qualified image with maintenance false for controlled acceptance. The exact
external nginx start fence remains in place. Public auth/preflight/Begin probes
still refuse 503; public live/ready health return 200. SSH, relay and native
services were not restarted. The owned browser reaches the same public TLS
origin through an owned loopback SOCKS4 connection on marco.

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
