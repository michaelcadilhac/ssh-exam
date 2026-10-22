# Gateway administrator management

October22,2026. Implemented/tested locally, **not deployed**. This fills
the existing browser administrator-creation CLI gap; full management/unified
grants/configuration mutation remain separate unfinished TODOs. No real
administrator, student account, installed configuration or exam is changed by
these synthetic tests.

## Supported workflow

Start with `examctl web administrators help` or `examctl help administrators`.

```sh
sudo examctl web administrators list --limit 50
sudo examctl web administrators show helper_admin
sudo examctl web administrators create helper_admin
# Lost/unverified reply: keep the SAME intent and enter the ORIGINAL password.
sudo examctl web administrators create helper_admin --request REQUEST-UUID
```

Creation grants **full gateway administrator powers over all exams, including
creating other administrators**. It does not create a Unix/course account,
change SSH credentials, modify an attempt/clock/enrollment, release access or
reset another administrator's password. Duplicate/concurrent usernames never
overwrite. Signing in/out of the browser keeps its ordinary browser-session
workflow; root CLI requests are stateless authenticated machine operations, not
browser login/logout or a retained browser cookie.

Use the existing protected class-agent configuration, Ed25519 identity, pinned
gateway signing key, fixed HTTPS origin and optional CA. The gateway independently
requires the exact named `administrators.list`, `administrators.show` and
`administrators.create` entries in `agent.managementOperations`; default is none.
Read authorization does not grant creation. Arrange any missing gateway
configuration through a separately authorized maintenance/configuration workflow;
do not copy credentials, relax key permissions or invent an endpoint override.
No production configuration change or service action is performed here.

List defaults to100 and accepts1..200; `--after USERNAME` is the exclusive cursor
from `result.next`. Show takes a username, not an exam/attempt ID, and returns only
username/role. Use NEW request IDs (the default) for refreshed reads; original
read IDs return their captured snapshot. Creation replies name the request,
operation, confirmed status and username only. Exit0 means verified metadata/
creation,1 refusal/unconfirmed outcome and2 syntax. It does not mean the new
account was logged in, native work ran, or the whole installation is ready.

## Password input and cleanup

Default creation reads and confirms through the operator's actual foreground,
canonical controlling terminal with echo disabled. It preserves/restores the
exact original terminal settings, handles normal interrupt/termination/hangup/
quit cancellation, and discards queued prompt input before restoring echo. It
opens its own terminal description rather than changing shared stdin flags.
It refuses an unverified/noncanonical/background terminal instead of reading
echoed credentials. SIGKILL cannot run cleanup; use a trusted terminal and restore
it before retrying if restoration is reported unverified.

Automation may explicitly use `--password-stdin` with a finite pipe or existing
root-private input file. It reads exact UTF-8 bytes to EOF, at most4096 bytes and
12..1024 UTF-16 code units, matching browser/server character limits. **No
trimming:** a trailing newline becomes part of the password; choose a single-line
password for ordinary browser entry. A terminal is refused with this flag.
The command creates no credential file. Never put a password in command-line
arguments, environment variables or shell history. Help/syntax/root/configuration
refusals happen before secret input; invalid flag values are never echoed.

The native credential command disables only its own core dumps. Owned stdin,
confirmation, marshalled request and server raw-request byte buffers are wiped;
HTTP-body read/close uses synchronized ownership, including a transport still
reading when a reply fails. Immutable Go/JS strings, browser internals, privileged
debugging and external crash tooling cannot promise guaranteed memory erasure.
Neither password nor verifier is printed in results, audit or application logs.
Malformed signed JSON/schema errors never reflect private fragments. The existing
ordinary browser JSON parser already has a safe generic malformed-body error;
its new regression passes without a parser policy change.

## Creation intent, concurrency and privacy

Both interfaces use one creation service. Password hashing/retry verification
uses the existing Argon2id64MiB/time3/parallelism1 policy,16-byte random salt and
32-byte hash. Two no-wait credential-work slots bound concurrent work across
browser/root requests; a busy refusal executes no creation and can be retried
using the original intent/password. Hash work never holds SQLite. Before the
short publication transaction, root requests recheck freshness/authorization and
nonce; browser requests recheck current authenticated administrator access.
Creation/audit/receipt publication is atomic in the supported caller transactions.

The durable credential fingerprint binds purpose and username to the SAME salted
Argon2id verifier computed for authentication. It is **not SHA(password)** or a
generic fast hash of a password-bearing request body. Exact retries verify that
slow verifier outside SQLite, with strict parameter/size checks before expensive
work. Different credentials/usernames conflict. A receipt that appeared/changed/
disappeared during preparation is unverified: retry the same intent, never guess
or create again. Cached creation outcomes must be strict same-account metadata;
corrupt/private/foreign results refuse, including after restart. Invalid inputs
and misplaced top-level password fields do not enter generic fast fingerprints.

Migration021 adds scoped `administrator_creation_requests` for browser intents;
root intents reuse the existing agent request table. These **fingerprints are
sensitive credential-verifier material**, protected like the existing admins
table and private database/backups. Do not export them as public diagnostics or
telemetry. Successful outcomes contain only usernames, not hashes/passwords.
The verifier is duplicated at its original strength, not weakened. Preserve
request/nonce/audit records on restore; deleting them is not a supported retry or
password-repair workflow. Any future password-reset/credential-retention feature
must review original-intent verification separately; it is not implemented here.

Browser creation retains only a nonsecret username/intent UUID while the form is
open. Password and confirmation fields clear immediately and are not saved in
React state/storage for retry. Re-enter the ORIGINAL password after a lost reply.
Closing/reloading abandons the form reference, not an already committed account;
inspect current administrators/sign in normally before starting a different
intent. Ordinary duplicate creation still refuses and cannot overwrite.

Root refusal output reflects only exact whitelisted public protocol causes with
actionable next steps; unknown signed errors are suppressed so private server
diagnostics cannot leak. Actual CLI tests fence duplicate/credential-conflict
guidance and arbitrary private-error suppression. Success validates exact nested
account/page scope, required/unknown fields, duplicate JSON keys, cursor/order and
bounds BEFORE printing any result. A valid outer signature is not enough.

## Current qualification and remaining gates

The old CLI is RED on missing administrator discovery. Shared service, actual
browser HTTP/create/login/CSRF, root signed requests and actual compiled
namespace-root CLI/private TLS cover original-password retry/restart, changed
credentials, duplicate/concurrent creation, bounded asynchronous work, revoked
authority, malformed/invalid inputs, exact Unicode/newline limits, private
diagnostic suppression, signed wrong scope and replies lost AFTER commit.
The candidate's unchecked cached-result regression is also RED before strict
receipt validation, then passes; no installed vulnerability/cause is inferred.

Ten native race repetitions pass the input/help/metadata and actual owned-PTY
confirmation/mismatch/SIGINT/TERM/HUP/QUIT restoration cases. The first PTY fixture
opened its slave read-only and failed all six cases; corrected explicit read/
write TIOCGPTPEER flags repair only the fixture, not assertions or live policy.
Synchronized request-body read/close/wiping passes20 race repeats. Full426 app/
80files passes91.36s; the first full native repeat passes core170.866s/CLI8.989s,
static build/vet/typecheck and complete app/WASM build pass. A sandbox nested-Go
EPERM build refusal is not a missing executable; the authorized local repeat
passes. The two real administrator browser cases pass11.6s, including actual
commit-then-abort and same-ID re-entered-password success. These preliminary
results are followed by the final refusal-help/static-CLI/browser repeats below.

All174 frozen server/web/protocol source and served-runtime hashes match around
the focused browser run. No web source/runtime rebuild occurs during combined
qualification. The new WASM hash is NOT assigned the earlier113-check result.
Final qualification passes all426 application checks/80files with the actual
TLS CLI built explicitly CGO_ENABLED=0 (88.57s); the preceding repeat passes
92.37s. Full final native race/resource/namespace/compiler/default-size passes
core173.285s/CLI10.458s; static build/vet/typecheck pass. Final ten focused
native/real-PTY/public-refusal repetitions pass CLI7.603s/core1.663s. Bounded
two-worker metadata fuzz passes150369 executions/11.011s. All114 combined browser
checks pass12.6m, including actual WASM SSH/monitoring/recovery and the new
administrator commit-then-lost-response workflow. All174 frozen source/runtime
hashes match before/after; no web source/runtime rebuild occurred during the run.
The nine generated documentation screenshots are restored to their verified
pre-run baseline. The inspected administrator screenshot shows cleared password
fields, actionable duplicate/retry text and accessible buttons. No deployment,
production account/configuration change or completed-full-management claim follows.

Exact selected artifacts from the174-file frozen receipt:

```text
697cfd33d8e19ea3f18f5b5486c26f3665f141adcb3ac1a821ea6beca7a32a9a  dist/web/ssh/client.wasm
0c949f4996f9a89698e4b5c586de32249c3b69b7baadb64d220073cc04acba14  dist/web/ssh/wasm_exec.js
5cd6995d024f734b3a06531226abe4721682619a09d0c76de207ccbb5ac2d02f  dist/web/assets/index-CCYvtSHw.js
362353c83ca36742290481a19b5165f770a97d2d9386383857fe7e9069df42f6  dist/web/assets/index-CSQ9Rpbv.css
78b94231f09842ed9845b4c323fdcf35f0e67096ee92241424ac3347f434587b  dist/web/assets/ssh-worker-FM5arK7Q.js
d8ed178e95c4020e81b636005992b5d7d9b49b89e7598c87c65e1e5765b2914b  dist/web/index.html
f5fdffc871512222590fb7f7ad23de55cd831a95c10d111c925a39e2eea3c1a0  dist/apps/server/native/monitoring_clock.node
e2865241ed6a45e7cef39a6076d86fdcd9c63c282d81f3b79fd2b1ee03e831ff  dist/apps/server/src/app.js
475f04917c3ced316212346e579b79df0011a440e526765d17b4474958baffdc  dist/apps/server/src/agent-management.js
4dc0203096b371d054cc70fbde6ad4e55e9895aac989299e7137fb7be7381f46  dist/apps/server/src/administrator-management.js
```

The prior writer's real privileged guest receipts remain scoped to their recorded
native artifact; these administrator checks do not relabel them a new combined
privileged/browser release. Future clean release builds must qualify their own
exact artifacts, including changed Go/WASM VCS metadata.
Container image qualification still needs a local Docker engine; no daemon or
production service is started to hide that independent prerequisite. Nothing
here enables C3 retention/automatic thaw, changes deadlines/monitoring policy,
completes all management, deploys or consolidates the temporary agent services.

Future rollback also needs compatible configuration: an older gateway's strict
operation enum cannot load a configuration retaining the new administrators.*
allowlist entries. Restore a reviewed compatible configuration in the separately
authorized drained workflow before starting it, while retaining all021/strong
intent/audit data. Never drop receipts or reset credentials to make rollback boot.
