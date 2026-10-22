# Native configuration observation and candidate validation

October22,2026. C1h implemented/tested locally, not deployed or
complete configuration management. Before this increment source had no supported
config show/validate workflow; the actual CLI help regression is RED on that
version. Existing native LoadConfig reads keys and legacy diagnosis
can initialize/reconcile; neither is an appropriate non-mutating inspection UI.

## Supported local candidate workflow

```sh
examctl help config
sudo examctl config show
sudo examctl config show --paths
sudo examctl config validate --config /private/staged-agent.json
```

These commands are root-only offline config show/validate, with discoverable help
without root/configuration, explicit current versus separately selected candidate
file via --config. Pin bounded regular owner-matched configuration/key files,
refuse links/FIFOs/oversize/duplicate/unknown/deep JSON, and report safe actionable
component errors without printing credentials/key bytes. Show redacts paths by
default and does not require opening keys; optional explicit paths are metadata,
never secret material. Validate uses the same structural rules as the ordinary
loader plus bounded pinned key checks. All IO stays outside Engine/state locks.
Both real/effective root are required for observations. A staged file must already
exist; selecting it does not configure the running service or create a new stage.
Configuration mutations/creation/apply are not implemented by this increment.

The selected configuration and each configured key/optional CA are at most64KiB,
regular, single-link, owner-matched and not group/other-writable; private signing/
handoff keys must additionally have no group/other permissions. Every parent is
pinned without following symlinks; leaf opens are nonblocking/no-follow/no-atime.
Observed size/mtime/ctime/link/mode changes or unsuccessful descriptor cleanup
refuse. No permission repair, link resolution fallback or file replacement occurs.
The same structural checker is shared with LoadConfig; its legacy runtime still
always requests its existing key/filesystem checks. Observation additionally
requires clean path metadata, rejects unknown/duplicate/deep/invalid-UTF8 JSON
and refuses / as a private state/work/catalog root. rootfs=/ remains explicitly
supported as the separate normal student-filesystem setting. These diagnostic
refusals do not rewrite or silently reinterpret an existing runtime config.

Default JSON redacts all filesystem/preference path values. --paths deliberately
includes configured metadata, never key bytes. Structurally invalid known fields
may contain pasted credentials, so their values are hidden entirely, even with
--paths; safe component/code/action guidance remains. A malformed/unsafe input
file has empty stdout and exit1. Valid-shaped observations with issues return
safe JSON and exit1. Syntax/unsupported apply return exit2 before root/file access.
Show can succeed with missing runtime signing keys: structural_valid is not
validated; key_files_checked=false. Validate checks Ed25519 gateway/public and
callback/private format plus configured TLS CA/SSH handoff private-key format;
validated requires no issues. No browser/gateway secret, password or key material
is printed or cached by this workflow. Path output still belongs in private
operator terminals/files.

Neither command initializes/chmods state, creates locks/audit, probes sockets/
network/services, reconciles deadlines/holds, writes configuration or applies a
candidate. A successful offline validation is not admission/clock/PAM/containment
or readiness qualification. Configuration apply/service actions remain separate,
drained, authorized operations; there is no implicit apply or unsupported SQL/JSON
edit workflow. Preserve existing runtime policy and never repair permissions or
replace a key as part of inspection.

Reads are per-file interval observations, not an atomic configuration/key set or
proof of what a running service loaded. SHA256 labels the selected config bytes,
not native protection or live authority. Future apply must recheck the exact
reviewed candidate/hash, keys and actual enforcement controls in a separately
authorized drained workflow. No configuration apply/restart occurs here.

Acceptance: actual CLI help/syntax/root refusal and namespace-root file/key
workflow; unchanged state/work/config/key contents, modes and available timestamps;
safe malformed/private errors, redaction, missing/unsafe/replaced files, structural
agreement with legacy loader, native repeated race/build/vet and appropriate app/
browser artifact verification. This plan alone closes no TODO. Root administrator
creation remains a separate pending CLI/credential-lifecycle investigation.

Current verification: actual missing-help regression RED on old CLI; actual
compiled namespace-root show/validate, root refusal/help, missing-key/unknown-field
errors and unchanged candidate/key/state/work tests pass. Pinned file/parent links,
hardlinks, actual FIFO, unsafe modes/oversize, duplicate/deep/trailing/invalid JSON,
invalid secret-bearing known values, optional CAs, same-size/restored-mtime
mutation and existing malformed-state preservation pass repeated native races.
The first access-time fixture failed because its own generic /proc/fd content
comparison ran before its atime assertion; checking the reader before that
independent test read passes, without removing the assertion or O_NOATIME.
All414 application checks/79files initially pass88.93s; final repeat passes86.57s.
Final full native repeat
including the extra mutation/broken-state/private-root cases passes
core174.276s/CLI6.514s; static build/vet pass. All140 web source/runtime hashes
remain exactly equal to the prior113-browser/12.8m artifact. No web/UI source,
compiled JS/WASM or browser runtime was edited/rebuilt, so that exact web evidence
is retained, not silently assigned to a different build. These native-only CLI
checks do not claim new privileged SSH/PAM/cgroup qualification. All nine top-level
config regressions pass five repeats, including12 unsafe-file/JSON subcases,
secret-bearing invalid fields and actual compiled CLI workflows. No new web
build is required for this native-only increment. Not deployed or complete
configuration management; mutations/apply and gateway config remain pending.
