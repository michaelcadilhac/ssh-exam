# Monitoring and retention

The application records JPEG images of the selected entire display approximately every five
seconds, optional required webcam images, terminal output/resize/lifecycle, incidents and
timestamps. There is no microphone request or raw keystroke log. Echoed commands appear in
output. Client capture timestamps are claims; receipt times and hashes are separate.
Evidence cannot prove all monitors are shared or that a physical camera is used.

Authentication happens before capture. Your shared SSH password is held temporarily in
browser-worker memory for one login and reused only for the two configured hosts after checking
each host key. It is discarded after authentication, failure, cancellation, disconnection
or timeout, and never persisted. JavaScript memory cleanup is best-effort, not guaranteed
erasure. An authorized authentication gap stops capture before
passwords. Accepted preflight frames may be retained as initial attempt evidence; abandoned
preparation deletes them. Passwords, challenge instructions and admission secrets are excluded
from logs and recordings. Application clipboard text stays in memory and clears at end.

Only authenticated instructors can access monitoring; access is audited. Originals, thumbnails,
recordings and detailed incident payloads delete 60 days after attempt end. Hourly idempotent
cleanup catches up after downtime. Earlier manual deletion needs confirmation. Durable tombstones
survive restoration. Submission archives and minimal attempt/grade metadata have separate
retention; no automatic submission deletion is configured. Submission archives stay on the
SSH server. The webserver retains signed collection receipts/checksums and monitoring,
and provides no submission download.

Operators must retain the latest deletion ledger independently of old backups, expire monitoring
backups within their retention date and merge tombstones before serving restored media.
This does not promise physical secure erasure from SSDs or external backups. Encrypt off-host
backups and restrict permissions. SMTP alerts include identity/reason/time and an authenticated
dashboard link, never images or credentials. Desktop alerts need an open dashboard.
