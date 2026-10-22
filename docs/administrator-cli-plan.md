# Administrator CLI parity — implementation plan and qualification

October22,2026. Original investigation/implementation plan, now implemented and
tested locally as recorded below; not deployed or a request to change production
administrators. The existing browser
creation hashes with Argon2id64MiB/time3/parallelism1 outside SQLite, inserts
without overwriting a username and audits the authenticated administrator. Root
examctl could not perform that operation before this milestone. Reuse approved C1 root-agent outbound
authentication with separately named default-deny operations; no root SSH, token,
student credential, arbitrary route proxy or direct database edit.

Continuation: the plan's shared service, named root operations, native input/
metadata CLI and browser same-form retry are now implemented/tested locally.
Final426 application/80files, full native race/resource/static/
vet/typecheck/build, actual CLI/TLS/TTY and114 combined browser checks now pass
with174 exact source/runtime hashes unchanged. Operator/evidence details are in
administrator-management.md and todo-progress.md. This closes this creation/
metadata workflow locally, not full management or deployment.

## Manageable increments and acceptance

1. Shared credential creation service/schema. Preserve username/password limits,
   Argon2id policy, duplicate/concurrent no-overwrite behavior and browser
   authentication/CSRF. Bound creation/retry hash work outside SQLite; refuse
   overload rather than queue unbounded expensive jobs. Add scoped successful
   browser intents and shared validation. Tests: actual create/login, unauthorized
   browser/agent, invalid/Unicode boundaries, overload/expiry/concurrency and
   unchanged attempts/history/settings.
2. Explicit named agent operations and secret-safe durable retries. Never put a
   plaintext password, ordinary SHA password fingerprint, hash or request body in
   audit/log/reply. A credential-intent fingerprint can bind the username to the
   same salted Argon2id verifier computed for account creation; exact retries
   verify that slow hash outside SQLite, not SHA(password). This duplicates no
   weaker password verifier. Validate stored hash parameters before expensive
   verification. Recheck freshness/authorization/current receipt in the short
   transaction; a competing newly committed receipt requires another scoped retry,
   not a guess inside SQLite. Test lost reply/restart, wrong secret/username,
   changed/revoked authorization, corrupt receipt and audit/log/raw-storage scans.
   Return metadata only; creation never replaces/reset/deletes another account.
3. Discoverable `examctl web administrators` workflow, actual compiled CLI over
   private TLS. Passwords must not be arguments, environment variables, temporary
   files created by the command, audit or stdout. Support finite exact UTF-8 stdin
   input with explicit flag and useful size/EOF guidance, plus hidden confirmation
   on an actual controlling terminal if implemented/qualified. Use bounded buffers
   and race-safe request-body ownership/wiping; do not wipe a buffer while HTTP
   can still read it. Test real PTY confirmation/cancel/terminal restoration,
   Unicode, stdin EOF/oversize, root/help/syntax, unverified replies, and no state
   initialization/native attempt changes. Do not weaken all management retry
   semantics simply to reuse a fast secret fingerprint.
4. Browser retry parity/help/operator documentation, final full application,
   native race/build/vet/typecheck/build and real browser checks against frozen
   artifacts, with screenshots restored. Commit coherent validated increments
   locally without asking for approval. Nothing is deployed or pushed.

The critical C3/C10/C11 and legacy migration choices remain separate. This is
independent CLI parity under already approved C1, not permission to select those
consequential policies or count the complete management TODO done. No account is
created during investigation; all implementation tests must use synthetic data.

## Investigation notes for continuation

Use one shared service per app, with a two-slot no-wait Argon2 work bound shared
by browser creation and agent creation/retry. Prepare outside SQLite, commit only
after repeated scoped authority/freshness/current-receipt checks. Suggested
credential fingerprint: a versioned purpose/username plus the SAME salted
Argon2id hash already computed for creation, not another fast password-derived
digest. Retry verifies that hash asynchronously after checking its exact permitted
parameters/size. A preparation that saw no receipt must not guess a receipt
committed meanwhile; return an actionable same-ID retry. A preparation that saw
a receipt must not recreate an account if that receipt vanished. Do not persist
invalid-secret/body validation failures using a generic fast body fingerprint.

Successful browser intents can use a new additive scoped table, analogous to
exam_definition_requests but with credential-safe fingerprints. Retain an intent
ID on the same username after a lost response; clear password/confirmation inputs
immediately, ask for the original password on retry, and never retain it in React
state/session storage. Duplicate or concurrently created usernames never overwrite.
Include metadata-only root list/show for confirming outcomes; named permissions
remain separate. Creation grants full administrator powers; say so in CLI help.

Audit/log/response sanitization must include malformed signed JSON/schema errors,
not only normal service errors. Wipe raw signed buffers after verification/parse
and clear credential references in finally blocks; JS/Go strings cannot promise
guaranteed memory erasure. Native credential requests need an owned synchronized
ReadCloser so cleanup cannot race an HTTP transport still reading the payload.
Refuse unexpected result fields/scopes before printing metadata; do not forward
arbitrary credential-operation server errors containing secrets. Never echo a
bad boolean/flag value from the password workflow's parser.

If adding a hidden prompt, open the actual controlling terminal separately,
preserve/restore its termios, use bounded cancellable reads and handle normal
interrupt/termination/hangup cancellation without echoing input. Do not change a
duplicated shared stdin open-file-description's nonblocking flags. Qualify actual
PTY confirmation, Unicode/backspace and cancellation/terminal restoration before
claiming interactive support. Explicit stdin is exact finite UTF-8/EOF, with no
trimming or argument/environment/file side channel. All tests use synthetic keys,
accounts, private TLS and namespaces; production is out of scope.
