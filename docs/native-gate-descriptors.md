# Local gate descriptor ownership (local candidate)

October22,2026. No deployment, production mutation or diagnosis of an individual
incident. This is a confirmed resource leak in rejected local socket requests,
not the complete monitoring/retained-SSH or connection-capacity solution.

## Reproduction and correction

recvmsg installs SCM_RIGHTS descriptors before JSON, account, SSH or admission
validation. The old handler only adopted/closed them on the later accepted-pane
path. Seven real Unix-socket regressions fail: malformed JSON, unapproved peer,
ordinary request, command request, early pane-ancestry refusal each leak one;
two descriptors and an actually truncated eight-descriptor message each leak two.
The test counts only its own still-existing synthetic inode and closes that exact
owned leaked set after recording RED, never arbitrary process descriptors.

The candidate immediately owns returned descriptors before any request decoding.
Every return/error closes them. A complete native control header is required
before the library's unsafe native-header view. Unknown/truncated messages,
incomplete rights data and extra descriptors refuse, closing any installed
prefix before returning an error. Ordinary/control requests require no rights;
a pane requires exactly one. Its later successful adoption transfers ownership
exactly once into the existing original-PTY lifetime defer. Native JSON, account,
SSH, capability, PTY validation and workload checks remain mandatory.

Linux Go net.UnixConn already receives with MSG_CMSG_CLOEXEC; the change does not
invent a fallback or clear flags. Actual PTY transfer verifies close-on-exec,
continued termios access after group cleanup, single ownership and idempotent
cleanup without damaging another file. Actual ancillary truncation verifies the
kernel flag and closed received prefix. Short-header tests never feed invented
raw descriptor numbers into a live close routine. No arbitrary filesystem tree,
student file, account restriction, credential, deadline, archive or record is
deleted/changed as a descriptor cleanup operation.

This prevents a permanent per-request descriptor leak that could exhaust the
shared agent. It does not prove the initiating production fault or provide a
global/UID connection-flood limit, closed admission, bounded system-manager IO,
C3 freeze/input epochs or automatic recovery. Those remain independent work.

## Evidence and remaining checks

Twenty final native descriptor/admission race repeats pass10.099s. Five actual
gate-process/PTY ready/welcome/control-key repeats pass16.345s (PTY, not a fake
string protocol). All426 application checks pass90.80s; static builds/vet and35
Python safety/helper tests pass. Final full uncached native race/resource/
namespace/compiler/default-size passes core180.278s/CLI8.009s. Exact-artifact
guest compatibility also passes, as recorded below.

An initial candidate test wrongly demanded no state initialization even for a
well-formed single-descriptor envelope rejected later for SSH ancestry. That path
uses legacy WithState, unlike a malformed descriptor envelope. The failed native
run is not qualified. The corrected assertion requires no attempt, capability or
registration authority there; malformed/extra descriptor envelopes still must
leave state uninitialized. Zero-leak assertions are unchanged in every case.
The original ordinary request with an unexpected descriptor is now explicitly
refused, not given a shell metadata result. Valid ordinary/control requests carry
no descriptors and retain their supported behavior; valid panes still pass one
PTY. This is input/protocol hardening, not a student monitoring-policy change.

Exact new candidate SHA-256 (not the preceding pane-admission release artifact):

| Artifact | SHA-256 |
| --- | --- |
| exam-agent | 37512c60c03fd70c2269e24860697852719b9550697bd6bda85cd81c5b8f2bc7 |
| examctl | e2a0be441698531a0bc9261d534b7fce3f64dc4f1024aada005c2a9fa3863087 |
| exam-login | c311e8abb22fe7539b9ef4dd7c2e8118d254df75f832439004c6f15a77cabd9f |
| core-qualification.test | 44e4527f6b23be7bbdb310df2d504f0dafe762cf9822cf96ae699e63ae01fb26 |

This exact candidate passes three actual authenticated SSH/Unix-credential/PTY
ACK/late-close repetitions0.39..0.81s, no scope/interval starts and unchanged
host/base evidence: /var/tmp/ssh-exam-overlay-ghhmolc5. Full enforcement and real
collector-death/healthy-peer regression also pass on these new hashes:40 actual
SSH/PAM/Begin/enforcement assertions with host/base preservation at
/var/tmp/ssh-exam-overlay-nv316vp1;11 real worker-death/healthy-peer assertions,
23 peer renewals,max0.0823481s, exact40MiB retry and unchanged original/current
deadlines/holds/owners at /var/tmp/ssh-exam-overlay-vg4srsou. Host/base preservation
passes for every run. These are new exact-artifact results, not prior-binary claims.

No web/WASM source or runtime is changed/rebuilt. All174 hashes match the separate
prior114-browser result; it is not a fresh combined browser/
privileged qualification. No live retained-SSH capability is enabled.

Operator response is ordinary safe diagnosis, not agent restart or state edits:
use `examctl info ATTEMPT --read-only` for observed records, `examctl health` for
readiness and `examctl help` for supported workflows. A captured state/lease is not
live monitoring/freeze proof. A future deployment needs a verified safe drain,
compatible exact-artifact tests/backups and preserved authority; no schema
migration is needed for this correction. Do not roll back by restoring older
student state. Temporary-agent consolidation remains only the separate proposal
in todo-rollout-plan.md and is not executed here.
