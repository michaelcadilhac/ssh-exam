# Monitoring export: ordered local increments

October22. Investigating/implementing locally, not deployed. Existing bounded
metadata/replay and reviewed deletion/purge workflows remain unchanged. Critical
retained-mode integration is awaiting the renewal-durability and application-
visible stop-protocol choices; this independent management gap can proceed.

1. C1gc1: expose the existing bounded original/thumbnail image reader through
   root-agent authenticated management and discoverable `web monitoring image`.
   Require separate default-deny authorization, exact attempt/frame/variant scope,
   shared web/CLI reader capacity and tombstone fences after asynchronous reads
   and immediately before signed publication. Never store image bytes in durable
   request receipts/audits. Validate scoped length/base64/digest before stdout or
   an exclusive0600 output file. Test actual compiled CLI/TLS, restart/retry,
   cross-attempt refusal, corrupt replies, deletion races, link/FIFO/size errors,
   private output refusals and unchanged protected authority. This alone is NOT
   a whole export.
2. C1gc2: a single discoverable `web monitoring export ATTEMPT --output NEW_DIR`
   orchestrates bounded inventory/media/recording reads into a new private
   directory, with a manifest, scope, capture watermarks, per-file hashes and
   explicit observation boundaries. Include original screen/webcam captures,
   terminal bytes and metadata; do not silently drop incomplete trailing bytes.
   No server-side unbounded archive, payload cache, ad hoc operator script or
   database edit. Bound request/page/transfer sizes and memory; never follow a
   source/output link or overwrite existing output. Failures leave explicitly
   incomplete private work, never a successful export. Recheck retained status
   before final completion; deletion cannot authorize a new read. Define and test
   active append, pagination, incomplete tails, unavailable/corrupt media, restart,
   disk/permission failure and late deletion before implementation is complete.
3. Run focused unit/HTTP/actual CLI regressions, full application/native race,
   static build/vet/typecheck/build and relevant browser review/deletion checks.
   Freeze/hash any rebuilt browser artifacts. Update design/operator/TODO status
   and make coherent local commits after validation. No production install,
   permission/schema/record edits, deployment or agent consolidation.

Current status: C1gc1 is implemented/tested locally; exact final verification is
in monitoring-image-qualification.md. C1gc2 is also implemented/tested locally;
qualification is complete, with exact evidence in monitoring-export-qualification.md.
Existing60-day monitoring and independent
protected-submission retention, clocks, account holds and credential rules remain.

## C1gc2 implementation proposal and acceptance detail

Use one purpose-bound signed NDJSON stream on the existing authenticated outbound
management route, not per-image HTTP request bursts (which compete with existing
rate budgets), a new inbound native API or an unbounded server archive. Add
separate explicit monitoring.export authorization. Reuse the shared pinned media
reader/capacity. At most one export owns the gateway's export slot; canceled IO
retains that slot until actual cleanup, without blocking captures or other admin
reads. Load a signing-key snapshot asynchronously once per export, not a new
synchronous filesystem read for every chunk. Neither choice alters student
credentials, monitoring evidence, permissions or exam clocks.

Persist only inventory watermarks/counts in retry receipts. The stream scopes
every signed packet to request nonce, attempt, agent, sequence and export purpose.
Bound chunks to256KiB, serialized event payloads to4MiB and signed lines to8MiB;
honor stream backpressure and yield between packets. Use a finite30-minute export
budget and15-second client progress timeout, unrelated to student authorization.
Metadata must be paginated/whitelisted and never include authentication/page tokens,
private storage paths or protected archive contents. Include screen/webcam originals,
derived thumbnails, exact recording bytes and bounded incident/interruption history.

An active export is not a globally atomic filesystem snapshot: capture metadata
uses the original append watermark; each recording pins one descriptor and its
initial byte length. Appends beyond that prefix are excluded. Include incomplete
trailing bytes, not only complete replay events. Independently reread/hash the
selected recording prefix before declaring its copy complete; emit bounded
verification progress so slow healthy verification is not mistaken for silence.
Reject truncation, unsafe storage, observed prefix changes or tombstones. Repeat
retention checks after await boundaries and immediately before signing each
private packet/final completion. Already downloaded private copies cannot be
recalled by later gateway deletion and retain separate operator obligations.

The CLI validates every packet and derived UUID-only output name before writing
into a new0700 staging directory under a pinned destination parent. Never overwrite
an existing destination. Keep file/index metadata and rolling hashes on disk,
not an in-memory exam archive. Flush payloads/metadata before a verified final
manifest and no-replace final publication; failure leaves an explicitly incomplete
private directory with actionable retry guidance. Full stream truncation, forged/
wrong/replayed packets, duplicate file IDs, offset/digest/count mismatches, active
append/partial tail, deletion at every publication boundary, actual client death,
IO failure and unaffected concurrent capture/SSH/health require regression tests.

The local candidate now wires the signed stream and actual root CLI, including
no-replace private publication. Focused HTTP/TLS/compiled-CLI checks pass for
multi-chunk raw tails, append exclusion, observed overwrites, oversized history,
late deletion, signed scope/file/hash faults, truncation, trailing data and
destination races. Real socket cancellation retains ownership until cleanup;
uncertain close poisons the bounded slot rather than ignoring the failure.
Held export IO also preserves a real authenticated SSH pane, signed renewals,
new pane admission, uploads and health in the synthetic fixture. An initial
full application run passes413 tests; the final suite including that last SSH
regression, full native race/build and fresh browser qualification remain pending.
That checkpoint has now received final qualification:414 app checks/79files,
full native race/resource/namespace/compiler/default-size tests, static build/vet/
typecheck/build and all113 combined browser checks (12.8m) pass. All140 source/
runtime hashes match before/after; nine generated screenshots are restored to
their verified pre-run baseline. C1gc2 and the local monitoring workflow/purge TODO
are implemented/tested locally, not deployed. Broader management, C3 containment,
capacity/Docker packaging and production rollout remain separate open gates.
Stream/backpressure constraints are checked against the primary
[Fastify reply](https://fastify.dev/docs/latest/Reference/Reply/) and
[Node stream](https://nodejs.org/api/stream.html) contracts and will be tested
through actual HTTP/TLS/CLI, not inferred from a generator alone.
