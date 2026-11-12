# Complete examctl metadata lists

November12: pushed and DEPLOYED on csc-sys at12:27:14Chicago /18:27:14UTC.
Source47bda3da8c80775482faf7a1baa3c33c53400ae6; web remains ed09efc/schema37.
Frozen CLI SHA256:03e3600ae5825f41274480e00d1d4f151ef0ed6d3f617fe02502f0d9e1132564.
Evidence:var/collection-tests/complete-cli-lists.20261112/.

Ordinary `examctl web … list` returns all matches. It covers exams, students,
attempts, grants, templates, administrators, alerts, monitoring inventories and
purge inventories, plus `web grants issue-list`. No pagination flags are needed.
Existing `--all` scripting commands remain valid. `--lifecycle all` is still an
exam visibility filter (include archived definitions), unrelated to pagination.

An explicit `--limit N` returns at most N matching rows, across selected exams.
This intentionally replaces its old server-page-size meaning, including when
combined with `--all`. Existing numeric ranges remain:1..200, reviews1..20,
purges1..100. Exact username filtering does not consume that allowance for other
students or empty scanned pages. Repeated `--exam` and `--username` work without
format flags. Without an explicit limit, exceeding10000rows/32MiB or10000requests
refuses rather than silently returning an incomplete list. Narrow the selection.

The server still handles bounded authenticated requests. Every page has fresh
request identity, retains its filters and passes existing scope/schema checks.
Monitoring keeps the first signed inventory watermark. Non-advancing/repeated
cursors, duplicate identities and later-page errors refuse before stdout or an
export file is published. Lists are observations over time, not atomic snapshots.
An explicit `--request` affects the first page; omit it for fresh results. Existing
`--after` remains an advanced starting cursor. Legacy `--all` keeps its prior
refusal of explicit request/starting cursor combinations. Mutation retries,
receipts, authorization, archive verification and media replay/export are unchanged.
Legacy JSON collections/envelope fields remain; attempt `scanned` totals are added
across fetched pages. Scripting JSON retains observation provenance and marks
whether the requested scopes completed. Explicitly capped results can retain a
next cursor; ordinary complete results have next:null.

Examples:

```sh
sudo examctl web exams list --lifecycle all
sudo examctl web attempts list --exam midterm --exam midterm-recovery \
  --username afayyaz1 --view COMPLETED --format table \
  --fields completed_at,id,exam
sudo examctl web attempts list midterm --limit 10
```

Qualification uses actual root-mapped CLI processes and signed local TLS for all
ten entry points, complete/explicitly capped results, empty pages, exact filters,
cursor failures and no partial output. Full CLI races, static/build checks and the
exact binary against the real gateway/zsh synthetic management workflow are
pass. Earlier fixture omissions and legacy page-size/JSON-shape expectations
are retained in the local evidence logs and corrected without relaxing authority.
The real gateway specifically verifies the unchanged legacy JSON envelope.
An extra multi-exam regression binds an explicit request ID to the first scope
only; every later scope uses fresh read identities.
No browser/backend/protocol/native-authority code changed; their deployed
qualification remains applicable. This update does not require another web image,
media backup, database migration, service restart or instructor sign-out.

Deployment uses the existing qualified atomic CLI installer and native guards.
It backs up only the current CLI, native state/configuration and worker unit in a
private host directory. Existing loaded processes keep their original inode.
Disposable qualification covers wrong hashes, failed publication, cleanup,
replacement and reverse replacement while the previous inode remains readable.
After installation, compare installed help/digest, complete and capped signed
reads, unchanged role PIDs/configuration/history, and public website availability.

Recovery, if required: use the preserved root-private `examctl-before` as source
for the SAME qualified atomic replacement, with current candidate hash as expected
old digest and the recorded old hash as expected new digest. Do not truncate the
installed file, restore the database/state/configuration or restart any service.
Recheck native guard and authenticated reads. No recovery is executed on success.

Production acceptance passes: seven signed reads, five complete exam definitions,
70midterm students and86midterm attempts, explicit one-row caps, --all JSONL
compatibility and public readiness. All four loaded role PIDs/binaries, native
configuration/worker unit and217native histories are preserved. One optional
post-read idle guard observed a descendant; it had exited before the bounded
read-only inspection, so its identity is unknown. The same unmodified guard then
passed; no process was terminated and no guard was relaxed.

Private stage:/var/tmp/ssh-exam-cli-lists-20261112-e649ac83-cli.
Private recovery:/var/backups/ssh-exam/recording-storage-cli-4s_y12ol.
Atomic installation1.07s; signed/public acceptance4.14s; maintenance0s. These are
activation/acceptance measurements, excluding preceding development/qualification.
The audited upload was15,871,873bytes; no recordings/media were copied. No database,
web image, native service, student authority or grading utility was changed.
The pre-existing loaded saved-work worker intentionally retains its previous
binary inode/hash until a separately authorized restart. Deployment is complete.
