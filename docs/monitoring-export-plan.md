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
in monitoring-image-qualification.md. Complete export remains C1gc2, not yet
implemented. Existing60-day monitoring and independent
protected-submission retention, clocks, account holds and credential rules remain.
