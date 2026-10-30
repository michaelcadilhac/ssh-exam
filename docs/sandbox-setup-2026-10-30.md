# Sandbox setup completed October 30, 2026

The instructor reported a refusal while trying sandbox and explicitly requested
"Fix this then" after the setup requirements were explained. This authorized
the following narrow production configuration repair, not an application release.

The retained legacy definition had earliest=0/latest=8640000000000000 and no
immutable template version. Automatic practice correctly refused its invalid
window. Source validation also found that the existing sample files had not been
installed or acknowledged as an immutable version. No grant bypass was added.

The existing `sample-exam` source contains two files/375 bytes, with exact hash:

```
60ba440c25afc803fdb1452e2d017719c98d594ab288ede5ddca5325497656a1
```

Root `examctl templates install`, `templates sync` and revision-fenced
`web exams update sandbox` published, attested and selected that exact source.
The finite Begin window is October 30 **14:22:56–23:59 America/Chicago (UTC−05:00)**.
The closing time was announced before activation as a bounded window for the
requested immediate test. The instructor can edit it in Exam settings. This is
one saved window, not an automatically renewed or always-open schedule.

The saved definition retains 300 seconds/no webcam/four terminals. Its revision
after activation is `60e8e3a79d1e530aac4ae5aa65519405eca290193778cae0056f25b5bd5015ff`.
The writer also materialized the already-approved future collection defaults of
128 MiB/file and 512 MiB total, as it does for legacy definitions. No attempt snapshot,
deadline, account restriction, credential, protected submission or history changed.
All 174 native attempt objects and CLI/agent/agent-configuration hashes were
identical before and after. There was no binary replacement, push, service restart,
manual grant issuance, production test attempt or instructor MFA interaction.

## Using the configured sandbox

Sign in to exam `sandbox` with the usual eligible SSH identity, then open preflight.
The application automatically enrolls the identity and issues its practice grant
when eligible. Explicit Begin starts its five-minute interval. A new Begin must
fall inside the saved grant window; closing the window does not truncate a
started attempt. Protected completion/access release still gate repeat practice.

To change future defaults, use **Instructor → sandbox → Exam settings**. The
materials template is `sample-exam`; its Immutable template hash is shown above
and under **Administration → Template catalog**. Select finite Earliest start/
Latest start values in the device timezone and choose Save exam. CLI equivalent:

```
sudo examctl web exams show sandbox
sudo examctl web exams update sandbox --revision CURRENT_HASH --earliest RFC3339 --latest RFC3339 --reason 'Explicit practice window'
```

Changing defaults does not revise existing saved grants/preparations. An expired
unused grant requires explicit supported revision; revoked/unresolved authority
must be inspected, not replaced automatically or cleared. See sandbox-grants.md.

## Verification and operational records

Existing focused HTTP/SSH regressions pass 15/15 in 91.64s: sandbox window settings,
automatic practice/cancellation/repeat and template catalog. Existing browser
checks pass 2/2 in 28.6s: finite sandbox settings and real-WASM SSH practice grants,
cancellation, explicit revocation/new review and separate repeat attempts. The
public isolated fixture reported browserSSH=true. These use synthetic identities,
SSH/native fixtures and simulated media; they do not substitute for the instructor's
real production SSH/MFA/capture test.

The installed exact source verifies successfully; signed gateway catalog and
definition readback match the chosen hash/window. Public readiness reports
ready=true/productionReady=true, maintenance=false and functionalTest=false.
Application/native binaries and contracts did not change, so their existing
build/race/capacity qualification remains applicable. All ten original dirty
documentation screenshots remain byte-identical.

Private csc-sys snapshot/operation receipts:
`/var/backups/ssh-exam/sandbox-setup-20261030.x8yq13th`.
Local plan, operation scripts and verification logs:
`var/collection-tests/sandbox-setup.FMFzxSqP`.
Install request `b691c7b2-cc5d-4301-a89e-d1f757b1ce48`, source attestation
`0f45deb8-5b6b-472f-9dcc-1e07d5fedd41`, definition update
`2de0a9fa-a6c8-40ea-9873-8e855903cead`.

For early closure, use the supported revision-fenced default-window workflow and
inspect separately issued unused grants before explicitly revising/revoking any
eligible authority. Preserve preparations/started intervals and protected history.
Do not restore old database/native snapshots, reinstate the unlimited window,
delete catalog versions or clear account holds as a rollback. No service operation
is needed for this configuration change.
