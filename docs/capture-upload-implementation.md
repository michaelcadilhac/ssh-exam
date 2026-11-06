# Lower-bandwidth capture implementation

November6. User authorizes implementation, push and deployment. No production
change yet. Measurements and comparison: upload-bandwidth-evaluation.md.

## Ordered milestones and stopping boundary

1. Student sharing → challenged binary JPEG → unchanged stored/reviewed image.
   Exact digest, challenge age, ownership/deletion, retry, malformed/size/CSRF
   refusal and actual built browser checks. Implemented locally:19focused checks,
   types/build and3real-WASM browser workflows pass. Original JSON clients remain
   supported. Binary negotiation lives on the existing authenticated challenge.
2. Same five-second samples → browser VP9 → isolated bounded decode → ordinary
   verified capture. JPEG fallback obtains a NEW challenge/sample on uncertainty;
   it never changes the encoding of an ambiguously accepted sequence. Preserve
   original challenge age through encode/decode and all existing execution gates.
   Tests: exact retry, stale/foreign chain, missing dependency, crash/restart,
   malformed/over-limit codec output, same-source concurrency, stop/page changes,
   network/ACK loss, slow links, actual native evidence and16-student capacity.
3. Freeze artifacts, affected/full application/browser/race checks, exact image
   migration/preservation/startup/current-data recovery and actual proxy cutover.
   Push/deploy only with qualified procedures and fresh student/unfinished drain;
   existing admin-only signout authorization applies. Verify public assets, signed
   CLI media/export and loaded identities. Preserve original screenshots/history.

The native evidence protocol, clocks, deadlines, cadence and required-source rules
are unchanged. No new exam setting or management operation is introduced. An
encoder/decoder/network failure remains technical verification failure, never new
misconduct evidence. Do not enable an incomplete video path.

## Bounded storage and recovery design

Live review and the existing completed-recording optimizer continue to consume
canonical JPEG captures. A separately resource-bounded decoder receives only a
bounded VP9 prediction group over pipes, without SQL, credentials or file/network
input. Pending decoder state grants no authority. State is scoped to the current
attempt/page/generation/settings and source, capped in count/bytes/lifetime, and
published only after the ordinary capture acceptance completes. Missing state,
worker failure or stale ownership requests immediate keyframe/JPEG recovery.

For VP9, the canonical JPEG is a server-decoded representation, not the original
wire bytes. A reserved bounded JPEG metadata receipt records wire/metadata/group
digests and canonical JPEG digest. Ordinary client JPEGs cannot supply that
server-owned receipt. Preserve receipts inside verified archived WebM metadata
and restore them to derived JPEG exports. Existing canonical JPEG hashes and
video/RGB provenance continue to protect retained representations. No original
VP9 packet is claimed to remain after verified publication; this is an explicit
lossy visual representation consistent with the approved recording policy.
The receipt contains no ticket, page secret, credentials or pixels. It never
participates in readiness or native execution authority.

This avoids introducing a new durable pending state, media table or retention
path solely for transport compression. Old JPEGs and archived WebM remain readable;
review/export still use the existing supported examctl workflows and JPEG files.
Actual CLI compatibility and receipt preservation must pass before release.

Current evidence: var/collection-tests/upload-bandwidth.20261106/. Binary build's
first restricted attempt failed on spawnSync go EPERM; the installed tool exists,
and the appropriate build escalation passed. No package was installed.
