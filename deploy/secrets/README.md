Keep secret files out of Git and images. Create `agent-client.key` and `smtp-password` here,
owned by UID/GID 10001, mode 0400. Parent directories must restrict host access. Compose file
secrets are read-only mounts, not encryption. Mount agent CA and client certificate in
`deploy/trust/`, configuration and the actual signed readiness report in `deploy/config/`.
No student passwords are ever configuration. Rotate mTLS certificates before expiry, using
an operator-approved client CA and `exam-gateway` client certificate Common Name.
