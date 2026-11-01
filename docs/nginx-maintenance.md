# Maintenance responses and web-only updates

Implemented and tested locally. These nginx changes are not installed in
production. Generating a configuration does not authorize a deployment or prove
that an exam server is idle.

`scripts/render-rollout-nginx` produces a self-contained nginx site from either
tracked template. It bundles the reusable maintenance maps/response; the installed
file needs no additional include paths or static-file service. Use a new output
path each time:

```sh
python3 scripts/render-rollout-nginx \
  --site deploy/nginx/ssh-exam.cadilhac.name.conf \
  --output /private/staging/exam-normal.conf
python3 scripts/render-rollout-nginx \
  --site deploy/nginx/ssh-exam.cadilhac.name.conf \
  --output /private/staging/exam-fenced.conf --fence
```

For another installation, supply `deploy/nginx/exam-workspace.conf.example` after
selecting its hostname, certificate and upstream. The renderer accepts the two
explicit HTTP/HTTPS server blocks and refuses already-rendered inputs or an
existing output. Validate the complete nginx configuration before any separately
authorized installation/reload. Keep exact original bytes and ownership for
recovery; never replace unrelated virtual hosts or nginx's main configuration.

The normal candidate returns a concise maintenance page when the gateway cannot
be reached or returns502/504. The response is503 with `Retry-After: 60` and
`Cache-Control: no-store`, not502 or a successful response. Website navigation
shows **Exam website is temporarily unavailable** and **Try again**. API requests
receive JSON with an actionable `error` and `code: SERVICE_UNAVAILABLE`. Student
and instructor sign-in already display that message; no new dialog is needed.
The page retrieves no external assets. Its retry link reloads the same URL.

The fenced candidate additionally refuses external root/instructor page
navigation, instructor sign-in and the existing new student sign-in/setup/start
routes. It uses normalized URI matching, so query strings or percent encoding do
not bypass admission closure. Forwarded-address headers cannot impersonate the
loopback acceptance exception. Local acceptance remains possible; it grants no
permission by itself.

Healthy agent/status/finish paths remain proxied during a fence. An unavailable
gateway produces a retryable503 there too: it never acknowledges a finish,
fabricates a signed reply, consumes a permission or changes authoritative time.
Normal upstream responses, including401 refusals and application503 JSON/retry
headers, are preserved. An explicit admission fence renders its own503 without
intercepting upstream503 responses. Unrelated
virtual hosts are outside the exam server's response/fence directives.

This fence is not a live-exam upgrade mechanism. Positively verify the existing
web/native drain, sessions, preparation, unresolved holds and pending transitions
before stopping/replacing the web container. A timeout or maintenance page is not
proof that a student violated a rule. Native deadline, account and collection
enforcement remains unchanged.

## Fast web-only cutover boundary

A simple UI update can prepare its matched image, exact assets, generated nginx
candidates and shared media recovery set while the current service is online.
The brief stopped phase should require only a consistent SQLite snapshot,
small configuration/receipt copies and an existing verified prior image, followed
by atomic image selection, fresh readiness and strict preservation checks. It
must not copy the entire monitoring directory again or scan a large tar archive
just to recover a few configuration files.

This path is eligible only when backend/protocol/native contracts and schema are
unchanged, the image is qualified before the fence, every required idle guard
passes, and the backup workflow proves that the media recovery set and the
snapshot form a recoverable pair. New schema/native/policy changes need their
appropriate broader qualification and migration plan. A busy server refuses the
cutover; a short time target never relaxes a guard or interrupts an exam.

After activation, compare CURRENT database/schema/history/settings against the
stopped snapshot, check fresh signed native roles and the unchanged native
cohort, verify exact public assets and read-only page behavior, then install the
qualified normal candidate and reload nginx. This retains a maintenance response
for later unplanned gateway outages. Rollback selects the prior compatible image
while preserving current authority; do not restore an older database to erase
post-cutover records.

The incremental backup and integrated cutover are now implemented and tested
locally through `scripts/deploy-web-ui`; see
[the fast UI-only runbook](fast-web-ui-deployment.md). No production cutover with
these new tools has been performed or timed.

## Local verification

```sh
python3 tests/nginx-maintenance-smoke.py --browser --output /new/test-output
npm run test:browser -- tests/browser/maintenance.spec.ts
```

The first command uses actual isolated nginx, disposable loopback TLS, synthetic
upstreams and real Chromium. It checks normal/fenced operation for both templates,
gateway connection refusal, website/API503 responses, healthy agent/status/finish,
normal refusal preservation, unrelated hosts, keyboard retry and mobile layout.
Owned nginx/upstream processes, temporary keys and files are cleaned. Browser
screenshots stay under the supplied per-test output. The second command checks
the actual student/instructor sign-in error UI with synthetic503 responses; it
submits no real credentials, permission or exam start.
