# SSH sign-in and recovery diagnostics deployment

Code revision `3f5bc01` was deployed on marco on October 20, 2026. The new
container started at `15:57:51Z`; verification completed at `16:00:00Z`.

The exact DePaul phone-number challenge now offers **Continue after phone
approval** instead of an ambiguous Code input. Failed sign-in retains escaped
host instructions separately from cleared credential answers. Repeated
disconnected snapshots no longer erase reconnect errors or repeatedly invalidate
recovery actions. Recovery authorization and input blocking remain enforced.

See [behavior and regression coverage](ssh-sign-in-diagnostics.md) and the
[completed thirty-minute private-desktop test](private-desktop-exam-test.md).
Validation before deployment: 278 unit/integration tests, 18 focused browser tests,
typecheck and production build passed.

## Production verification

- Web and native state had no active exams, preflights or unresolved collections
  before rollout. The stopped-service check found no newly arrived attempts.
- All 32 existing attempts retained state, start/end, original/effective deadline,
  clock revision, protected status, checksum and collection timestamps.
- Public HTTPS readiness confirmed production ready, maintenance off and
  notifications enabled. The container was healthy with zero restarts.
- Deployed JavaScript and CSS matched the tested local build byte for byte:
  `/assets/index-CbJmamYI.js` and `/assets/index-DuvGF4L_.css`.
- No class-agent binaries, account policy, SSH configuration or native services
  were deployed or restarted. Administrator access and sandbox remain intact.

The initial rollout verifier assumed host port 3000 and received HTTP 404 from
that unrelated endpoint. Public HTTPS was already healthy. Verification was
corrected to discover Docker's configured loopback binding, port 3001. The healthy
running image and the service's default image tag were aligned without a second
restart; the saved receipt includes this correction.

## Receipt and rollback

New image: `ssh-exam-workspace:ssh-diagnostics-3f5bc01` (also the service's
`ssh-exam-workspace:1.0.0` tag):

```text
sha256:91469d091f30d0d51fee3ffb60a016391df3f19103cb3f77413cd4742f505b0d
```

Previous image:

```text
sha256:f1d226b04c24a9d460003133a086dab538b18ac65caf9d667948c7fbb815d91a
```

Protected stopped-service backup and receipt on marco:

```text
/var/backups/ssh-exam/20261020T155744Z-ssh-diagnostics-obnmx093
```

Rollback requires a fresh drain check, stopping the web service, retagging the
previous image as the default, starting the service, then checking readiness on
the actual configured binding and public HTTPS. Retain current metadata, audits,
monitoring and protected submissions; never overwrite newer records from backup.
There is no schema change or native rollback.
