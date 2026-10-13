# SSH Exam Workspace

A self-hosted programming-exam workspace: React/xterm/WinBox frontend, Fastify/SQLite SSH
gateway, and separate native Linux class-server gate, SSH command agent and deadline watchdog.
The original acceptance specification is preserved in [SPEC.md](SPEC.md).

**Production starts are gated and unverified.** Automated fixture checks pass, but actual
DePaul authentication, privileged Linux guards, real capture/keyboard behavior, SMTP delivery,
Docker startup and production capacity need operator validation. The disposable 100-student load target passed.
See [test report](docs/test-report.md) and [compatibility](docs/compatibility.md).

## Local disposable demonstration

Prerequisites: Node **26.x** (verified 26.11.1), npm, OpenSSL, GNU tar and desktop Chromium. Go **1.27.2** builds
the native components. Dependencies are pinned in package.json and package-lock.json.
Installation automatically applies a checked ssh2 zero-prompt compatibility patch.

After changing Node major versions, run `npm ci` before building or starting the app.
The SQLite native module must be installed for the active Node runtime; do not reuse
`node_modules` built under Node 24. No temporary Node installation is needed with Node 26.

    npm ci
    npm run build
    npm run fixtures

Keep fixtures running. In another shell:

    EXAM_CONFIG=var/demo/config.json npm run dev

Open http://localhost:3000, exam sample, account student01. The disposable shared SSH password is
shared-password; enter it once for both hosts. The fixture shows number 42 in
a zero-prompt round. Production ships no default administrator or student password.

The demo creates disposable command/callback signature keys, host-key pins and configuration in
ignored var/demo and seeds one disposable enrollment. Terminal commands are simulated:
help, pwd, save TEXT, cat, exit. They do **not** execute a host shell or provide real editors
or containment. Install native components on a disposable server to test that behavior.
Fixture servers are excluded from the production build and cannot be selected by a production
mode flag. Remove var only to deliberately reset disposable demo data.

Create an instructor with your own password interactively:

    EXAM_CONFIG=var/demo/config.json npm run bootstrap-admin

Visit /admin to configure exams, validate/preview/confirm CSV, review incidents, authorize
continuation, view recordings and download submissions. CSV never creates Unix accounts.
The demo course-account registry includes student01, student02 and student03. Only student01
is initially enrolled; add the others with the instructor Add student control. All three use
the same disposable shared SSH password above.

## Verification

    npm run typecheck
    npm test
    npm run build
    npm run test:browser
    cd ssh-server
    GOCACHE=/tmp/exam-go-cache go test -race ./...
    mkdir -p bin
    for name in exam-agent exam-login examctl exam-info; do CGO_ENABLED=0 go build -trimpath -o bin/$name ./cmd/$name; done

Browser tests use /usr/bin/chromium; CHROMIUM overrides its path. They use simulated video
and keyboard capabilities where stated, and do not certify real permissions/OS shortcuts.
Screenshots are in [docs/screenshots](docs/screenshots). SSH tests use only disposable
loopback hosts, never institutional hosts.

## Production

Follow [deployment](docs/deployment.md) and the independent
[class-server guide](ssh-server/README.md). Copy examples/exam-config.example.json to
deploy/config/config.json, configure trust/secrets and actual readiness reports. Host-key
placeholders are deliberately invalid. Keep maintenance true until admission checks pass.
Production startup requires HTTPS, pinned host keys, command/callback signatures, SMTP and completed signoffs;
missing requirements fail startup. /health/ready checks agent guards; /health/live checks
only the gateway process.

The gateway runs as one non-root Docker instance with private local storage. Host nginx
terminates TLS and host systemd manages Compose. The native agent is installed separately.
See [security](SECURITY.md), [privacy](PRIVACY.md), [architecture](docs/architecture.md),
[student instructions](docs/student-instructions.md), [instructor operations](docs/instructor-operations.md)
and [recovery](docs/recovery-runbook.md). Backups restore saved work, never live SSH objects.

### Real SSH login testing

The local `var/login/config.json` profile uses the DePaul jump and class hosts on
port 22, with SHA256 host-key pins imported from the operator's existing SSH
known-hosts entries. Run `EXAM_CONFIG=var/login/config.json npm start` after building.
Open http://localhost:3000 and enter your actual SSH username; no fixture enrollment
is needed in this development-only mode. Enter your shared SSH password once at the first password prompt, then complete
the jump-host phone MFA. The backend temporarily reuses it for the pinned class host. Success means both SSH transports
authenticated; they are then closed. The profile uses separate local data storage.

`loginOnly: true` disables preflight, exam actions, terminals and exam-agent registration.
It is rejected in production. This tests institutional SSH authentication without
requiring exam-agent installation or running commands on the class host. To return to
the full disposable exam demo, restart with `EXAM_CONFIG=var/demo/config.json`.

### Automatic submissions

Students work and save normally in the configured exam directory (default `/work`). Saved
files are collected automatically at the authoritative deadline, normally 90 minutes after
Begin or the student's configured duration. The optional **Finish exam** button confirms an
irreversible early end. There is no submission command, file upload or archive task; unsaved
editor buffers are not included.

The privileged class-server watchdog collects even with no browser or gateway. It verifies
all workload writers are frozen, blocks uncontained writers, revokes new directory access,
and publishes a verified private archive/manifest/checksum bundle. Restart recovery adopts
that bundle; transfers retry it without recollecting live files. Authorized instructors
download only verified exports. Archives use separate retention from 60-day monitoring.
Actual privileged systemd/cgroup deployment remains subject to the required operator checks
in [compatibility.md](docs/compatibility.md).

Account restrictions are separate from submission completion. Finishing early protects the
submission immediately but ordinary SSH, commands and file transfer remain blocked until the
original deadline and verified collection/termination. Finished attempts never resume. See
[server isolation and emergency recovery](ssh-server/README.md#original-interval-account-isolation).
Production upgrades require the new isolation checker, native agent capability and four server
signoffs plus gateway intervalAccessHold signoff; existing fixture flags are insufficient.


Commands to the class agent now travel only through authenticated student SSH, with
root-verified gateway signatures. Deadlines and collection stay local. The agent posts
signed status updates and verified archives to the webserver; no inbound control API or
command polling exists. Instructors authorize recovery but cannot stop exams from the
web dashboard. Local administrators use `examctl`; see [native administration](ssh-server/README.md#local-examctl-administration).
