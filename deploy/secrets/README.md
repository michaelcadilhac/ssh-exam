Keep secrets out of Git and images. Create `gateway-signing.key` and `smtp-password` here,
owned by UID/GID 10001, mode 0400, with protected parent directories. Compose mounts the
command signing key as `gateway_signing_key`. Mount the class agent callback public key in
`deploy/trust/agent-callback.pub`, configuration/readiness in `deploy/config/`. The matching
gateway public key goes on the class server; its callback private key stays there. Generate
separate Ed25519 identities. No student passwords or root SSH credentials are configuration.
