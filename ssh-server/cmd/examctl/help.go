package main

import (
	"examworkspace/agent/internal/core"
	"fmt"
	"io"
	"strings"
	"time"
)

type guide struct {
	usage, summary, restrictions, examples string
	target, reason                         bool
}

var guides = map[string]guide{
	"recovery-grants":   {"recovery-grants [--exam EXAM]", "Inspect native-only legacy saved-work authorizations and their one-use history as JSON.", "Read-only bounded catalog inspection, offline from the gateway; not unified grant issuance/revision/revoke and not an archive integrity check. Disposition unused means no recorded start/marker; consumed identifies a matching committed interval; uncertain requires preserving markers/history for diagnosis. source_recorded_protected is metadata, not fresh hash verification: use manifest SOURCE for that. Unused/uncertain grants and unfinished dependent attempts block source submission deletion. Completed consumed history never reopens. Malformed/unknown files fail closed; never remove markers to force deletion. Root must serialize all legacy catalog edits with the supported workflows; old ad hoc writers are not safe concurrent management.", "examctl recovery-grants\nexamctl recovery-grants --exam midterm\nexamctl info SOURCE-ATTEMPT\nexamctl manifest SOURCE-ATTEMPT", false, false},
	"workspace-prepare": {"workspace-prepare ATTEMPT", "Verify and stage a private workspace for an unstarted preparation without consuming time or saved-work allowance.", "Normally run automatically in student preflight. Uses the bounded collection worker pool and freezes this preparation's starter/saved files privately. Practice cannot see the staged tree; only an explicit, monitored Begin publishes it. Refuses changed/cancelled/expired preparations, damaged sources and unexpected live work. Saved-work staging probes writable consumption storage using an unpublished O_TMPFILE inode; unsupported/read-only/full storage refuses before Begin without a final marker. This probe is not a reservation or guarantee against a later disk failure. Actual publication requires the qualified filesystem and the root process's own /proc/self/fd linkat support, without new capabilities or a partial-write fallback. Retrying adopts the same verified private receipt after a crash; it does not overwrite work. This does not issue a new attempt grant or reset its 15-minute preflight timer.", "examctl info ATTEMPT --read-only\nexamctl workspace-prepare ATTEMPT\nexamctl info ATTEMPT --read-only", true, false},
	"workspace-repair":  {"workspace-repair ATTEMPT --reason REASON", "Finish interrupted publication of an already committed workspace so it can be protected by collection.", "Only ACTIVATING/COLLECTION_FAILED with an exact staged receipt and original interval. Never restarts time, recopies changed source, overwrites edits or reopens the attempt. Saved-work consumption uses atomic complete single-link no-replace publication. Matching existing markers are bounded/private-verified; incomplete/foreign/unsafe existing markers refuse, never overwrite or remove them. Storage IO errors retain their category: inspect --read-only, restore supported writable storage, then retry this exact original publication. Result remains COLLECTION_FAILED with no execution lease; inspect, then explicitly retry collection. Unstarted preparation failures use workspace-prepare instead. Preserve all private staging directories until diagnosis; no automatic cleanup.", "examctl info ATTEMPT --read-only\nexamctl recovery-grants --exam EXAM\nexamctl workspace-repair ATTEMPT --reason 'Corrected filesystem issue after interrupted publication'\nexamctl retry ATTEMPT --reason 'Publication repaired; secure the original interval'\nexamctl manifest ATTEMPT", true, true},
	"list":              {"list [--active] [--exam EXAM] [--json]", "List native attempt records; --active means started and unfinished, not merely connected.", "Default: all native attempts. Exam IDs are definitions, attempt IDs are UUIDs. Text deadlines use RFC3339 UTC; --json includes authoritative fields. Works offline from the gateway.", "examctl list --active\nexamctl list --exam midterm --json", false, false},
	"info":              {"info ATTEMPT", "Inspect an attempt, its protected submission, timing and account policy.", "JSON includes original/current deadlines in Unix milliseconds, clock revisions, protection, access/policy errors and native workload records. preparation_pending=true identifies uncompleted preflight checks, not admission or a started clock. Use --read-only to observe while checks run. Cancel only an unstarted preparation with examctl cancel ATTEMPT --reason REASON; late check results cannot revive it. No password or private admission proof is printed. Legacy info --exam EXAM lists attempts.", "examctl info ATTEMPT --read-only\nexamctl list --exam midterm --json", true, false},
	"start":             {"start ATTEMPT --reason REASON", "Commit a prepared native attempt's interval and initialize its workspace.", "Only a provably unstarted preparation with native guards and protected transport ready. This releases exam material and consumes time; it is not a clock reset. Ordinary monitored starts use student Begin. Never use local start to bypass monitoring. Retrying a committed start cannot grant another interval.", "examctl info ATTEMPT\nexamctl start ATTEMPT --reason 'Approved monitored start recovery'", true, true},
	"pause":             {"pause ATTEMPT --reason REASON", "Lock one unfinished attempt; its clock and account restriction continue.", "Current policy freezes/terminates workloads and requires fresh SSH plus generation-bound instructor authorization before continuation. Saved files survive; unsaved buffers do not. This does not pause time or release ordinary access.", "examctl info ATTEMPT\nexamctl pause ATTEMPT --reason 'Instructor reviewed monitoring failure'", true, true},
	"stop":              {"stop ATTEMPT --reason REASON", "Irreversibly finish and collect one started attempt.", "Uses protected finalization; failure retains recovery and account restrictions. Success cannot reopen the exam or release access before both deadlines. Does not stop shared services. finish is an alias.", "examctl info ATTEMPT\nexamctl stop ATTEMPT --reason 'Instructor authorized early termination'\nexamctl manifest ATTEMPT", true, true},
	"cancel":            {"cancel ATTEMPT --reason REASON", "Cancel only a provably unstarted preparation and restore its temporary account policy.", "Start/current/original deadlines must all be unset. A lost activation reply is uncertain and must be inspected, not reset. Cancelling a started attempt is refused. This does not delete an exam definition or protected submission.", "examctl info ATTEMPT\nexamctl cancel ATTEMPT --reason 'Abandoned unstarted preparation'\nexamctl reconcile\nexamctl info ATTEMPT", true, true},
	"cancel-absent":     {"cancel-absent ATTEMPT --exam EXAM --username USER --reason REASON", "Fence a gateway preparation that never existed in native authority.", "Root only. Obtain the exact orphan UUID/exam/username from gateway diagnostics. Requires initialized valid native state and a locally approved account. Refuses every existing native UUID, including started/history records: use normal cancel only for a confirmed unstarted preparation. Writes a durable cancellation tombstone so a delayed prepare cannot revive the UUID; touches no account policy, processes, saved source, grant or clock. Student logout uses the same fencing automatically over authenticated signed SSH. Reconnect/retry preflight so the gateway can verify cancellation; native cancellation alone does not delete web metadata. Never infer no-start from a timeout or remove state/consumption records.", "examctl info ATTEMPT --read-only\nexamctl cancel-absent ATTEMPT --exam recovery --username student01 --reason 'Confirmed refused gateway preparation'\nexamctl info ATTEMPT --read-only", true, true},
	"retry":             {"retry ATTEMPT --reason REASON", "Retry protected finalization after diagnosing and correcting collection recovery.", "Inspect errors and fix storage/writer/timing failures first. Never replace/delete a published protected bundle or remove a hold to make retry succeed. WARNING: on an active attempt this requests irreversible early finalization, like stop.", "examctl info ATTEMPT\nexamctl retry ATTEMPT --reason 'Corrected storage capacity; retry collection'\nexamctl manifest ATTEMPT", true, true},
	"manifest":          {"manifest ATTEMPT", "Verify and print the protected submission manifest as JSON.", "Requires a verified local protected bundle. Reading does not recollect live work. Includes saved-file hashes, omissions and timing in documented storage units. Archives/receipts have separate retention from monitoring.", "examctl manifest ATTEMPT\nexamctl info ATTEMPT", true, false},
	"export":            {"export ATTEMPT [--output FILE]", "Verify and export the protected archive locally.", "Default: binary tar.gz to stdout, diagnostics to stderr. --output creates a new file and refuses overwrite. Restrict destination access; an I/O failure may leave a partial file and returns failure. This does not send archive bytes to the gateway. No student filenames are executed.", "examctl manifest ATTEMPT\nexamctl export ATTEMPT --output ./submission.tar.gz", true, false},
	"delete":            {"delete ATTEMPT --reason REASON", "Delete a protected submission from native storage, not the exam definition or attempt history.", "Destructive: requires COMPLETED and released/overridden ordinary access, including restored policy. It does not cancel preparation, finish work or release access. Verify retention/administrator requirements first; export separately if required. No automatic emergency override.", "examctl info ATTEMPT\nexamctl manifest ATTEMPT\nexamctl delete ATTEMPT --reason 'Approved protected submission retention expiry'", true, true},
	"override-access":   {"override-access ATTEMPT --reason REASON", "Perform a separate root-only emergency release of a secured, fully terminated account.", "Requires verified protected work, no remaining writers and a durable audited 8–1000 character reason. Native restoration must succeed. Never invokes itself to fix another refusal. Consequences: releases original interval restrictions early; does not reopen work, change timing or replace submissions. Normal release uses reconcile after both deadlines.", "examctl info ATTEMPT\nexamctl manifest ATTEMPT\nexamctl reconcile\n# Only after independent emergency approval and verification:\nexamctl override-access ATTEMPT --reason 'Concrete approved emergency disposition'", true, true},
	"health":            {"health", "Inspect native readiness, capabilities and concrete missing guards.", "Readiness does not certify institutional authentication or privileged target-host qualification. Works without gateway connectivity; signed callback delivery is separate. Local candidate: probe IO runs outside the shared state transaction; legacy initial state validation/initialization remains. One concurrent probe per agent Engine, not a host-wide limit. Configured-account NSS verification has a five-second shared lookup budget, 4096-byte output bound per account and 250ms pipe-drain bound. A timed-out/failed/oversized lookup is unavailable verification, not evidence of changed account policy or student misconduct. Verify NSS and retry health; no identity result is cached. These bounds do not cover every filesystem/checker/state operation. Busy is unavailable observation: retry after it settles or inspect examctl agent status, never restart active exams to bypass it. A completed ready/production_ready snapshot is not live monitoring, execution permission or an atomic machine view; actual Begin guards remain fresh and independent. No probe result is cached for admission.", "examctl health\nexamctl agent status\nexamctl info ATTEMPT --read-only", false, false},
	"accounts":          {"accounts", "Print root-approved native course-account mappings as JSON.", "Does not enroll web students, create Unix accounts or change account restrictions. A cached account mapping does not replace live signed identity verification at student login.", "examctl accounts\nexamctl health", false, false},
	"reconcile":         {"reconcile", "Reconcile all native attempts, due timing/collection and eligible account restoration.", "Can change due state and perform collection/cleanup; independent watchdog remains authoritative. May contact the fixed gateway for signed deadline timing. Failure leaves holds/frozen work in place. No deadline reset, marker deletion or implicit early release.", "examctl list --active\nexamctl reconcile\nexamctl info ATTEMPT", false, false},
	"agent":             {"agent start|stop|restart|status", "Manage the shared command-gate service only.", "status inspects systemd. stop/restart can interrupt students/PTYS: drain attempts, real preflights, pending timing and recovery first. stop leaves watchdog/reconciliation running; start/restart also ensure them running. Never use service stop to finish an exam. Temporary PTY-owning handoffs require the separate consolidation runbook.", "examctl agent status\nexamctl list --active\n# Only in an authorized drained maintenance window:\nexamctl agent restart", true, false},
	"export-status":     {"export-status ATTEMPT", "Inspect local/historical archive transfer metadata.", "Protected submissions remain on the SSH server. A historical transfer flag is not current gateway storage or successful synchronization.", "examctl export-status ATTEMPT\nexamctl export ATTEMPT --output ./submission.tar.gz", true, false},
	"pause-export":      {"pause-export ATTEMPT --reason REASON", "Record an audited historical archive-delivery hold.", "Compatibility workflow only: automatic web archive transfer is disabled. This does not change native protection, collection or account access.", "examctl export-status ATTEMPT\nexamctl pause-export ATTEMPT --reason 'Retain historical archive delivery hold'", true, true},
	"resume-export":     {"resume-export ATTEMPT --reason REASON", "Explain the retired automatic archive-transfer operation.", "Always refused: archives stay on the SSH server. Use verified local export; no command re-enables automatic archive uploads.", "examctl export-status ATTEMPT\nexamctl export ATTEMPT --output ./submission.tar.gz", true, true},
}

func init() {
	for _, topic := range []string{"list", "info"} {
		g := guides[topic]
		g.restrictions += " WARNING: without --read-only these legacy inspections initialize native state and may reconcile eligible access. For non-mutating incident diagnosis, use --read-only: always a bounded JSON observation, no Engine initialization, chmod, lock creation, audit write, reconciliation, network or subprocess. State and independent lease files are not an atomic view; recorded protection/registration/unexpired timestamps never prove current SSH, monitoring, freeze, archive integrity or execution permission. This does not enable retained SSH or automatic recovery. Default page 50, maximum 200; --after is an exclusive attempt UUID cursor. --active means started unfinished, including LOCKED, not live-connected. A named info target cannot combine filters/cursor. --state DIR bypasses configuration/key loading and cannot combine an explicit --config; otherwise only the protected config's state path is read, not keys. Requires an existing private owner-matched 0700 directory and 0600 regular files. Refuses unsafe/symlink/FIFO/changed files, duplicate/deep JSON and state above 64 MiB; never repairs permissions/missing records. Missing lease is absent, unavailable/invalid is a partial observation, not proof of expiry/misconduct. Exit 0 means observation complete, NOT healthy/authorized; exit 1 with JSON means partial lease observations, while unsafe/missing state has empty stdout; exit 2 means invalid selection. Preserve records and retry the same read-only command; do not run reconcile merely to inspect."
		g.examples = "examctl list --read-only --active --json\nexamctl list --read-only --exam midterm --limit 50\nexamctl list --read-only --exam midterm --after ATTEMPT --limit 50\nexamctl info ATTEMPT --read-only\nexamctl info ATTEMPT --read-only --state /var/lib/exam-agent\n# Deliberate legacy reconciliation-capable inspection:\n" + g.examples
		if topic == "info" {
			g.usage = "info ATTEMPT [--read-only] [--state DIR]"
		} else {
			g.usage = "list [--active] [--exam EXAM] [--json] [--read-only [--state DIR] [--limit 1..200] [--after ATTEMPT]]"
		}
		guides[topic] = g
	}
	g := guides["stop"]
	g.restrictions += " Collection runs in a bounded worker outside the shared state lock. A busy worker returns FINALIZING (pending), not completed; inspect info and retry/reconcile as appropriate. See examctl help collection."
	guides["stop"] = g
	g.usage = "finish ATTEMPT --reason REASON"
	g.summary = "Alias of stop: irreversibly finish and collect one started attempt."
	guides["finish"] = g
	deletion := guides["delete"]
	deletion.restrictions += " Unused/uncertain legacy saved-work authorizations and unfinished dependent attempts also block deletion. Verification runs in a bounded worker while source/catalog locks fence native consumption. Inspect examctl recovery-grants first; do not remove grants/markers or invent history to bypass a refusal."
	guides["delete"] = deletion
	recovery := guides["recovery-grants"]
	recovery.restrictions += " Explicit per-student duration edits via web admin or examctl web students settings authorize duration-only revision at next authenticated preflight; exam-default edits do not. allowance_revision records provenance; pending_allowance_revision is unpublished crash residue, never execution permission. Retry latest explicit settings through student preflight to complete/supersede it; do not hand-edit/delete files. Prepared/consumed grants refuse revisions, and source/checksum remain fixed. See examctl web students help."
	recovery.examples += "\nexamctl web students settings retake student01 --duration-minutes 75"
	guides["recovery-grants"] = recovery
}

func helpRequest(args []string) (string, bool) {
	var words []string
	requested := false
	for i := 0; i < len(args); i++ {
		if takesValue(args[i]) {
			if !strings.Contains(args[i], "=") {
				i++
			}
			continue
		}
		switch args[i] {
		case "--help", "-help", "-h":
			requested = true
		default:
			if !strings.HasPrefix(args[i], "-") {
				words = append(words, args[i])
			}
		}
	}
	if len(words) > 0 && words[0] == "help" {
		requested = true
		words = words[1:]
	}
	if len(words) > 0 {
		return words[0], requested
	}
	return "", requested
}

func printHelp(w io.Writer, topic string) bool {
	if topic == "grants" {
		webGrantsHelp(w)
		return true
	}
	if topic == "panes" {
		panesHelp(w)
		return true
	}
	if topic == "administrators" {
		webAdministratorsHelp(w)
		return true
	}
	if topic == "config" {
		configurationHelp(w)
		return true
	}
	if topic == "templates" {
		templatesHelp(w)
		return true
	}
	if topic == "monitoring" {
		webMonitoringHelp(w)
		return true
	}
	if topic == "workspaces" {
		workspacesHelp(w)
		return true
	}
	if topic == "interruptions" {
		webInterruptionsHelp(w)
		return true
	}
	if topic == "attempts" {
		webAttemptsHelp(w)
		return true
	}
	if topic == "clocks" {
		webClocksHelp(w)
		return true
	}
	if topic == "alerts" {
		webAlertsHelp(w)
		return true
	}
	if topic == "students" {
		webStudentsHelp(w)
		return true
	}
	if topic == "web" {
		webHelp(w)
		return true
	}
	if topic == "collection" {
		fmt.Fprintln(w, "Collection diagnosis (root native operations; works offline from the gateway):\n  examctl info ATTEMPT\n  examctl manifest ATTEMPT\n  examctl retry ATTEMPT --reason 'Concrete storage/writer repair performed'\n  examctl reconcile\n\nCollection/verification/cleanup run in supervised per-attempt processes, separate from SSH/PTY owners. Two cross-process heavy-work slots; each worker has 256 MiB memory, no swap, 32 tasks and a 120-second runtime. The exam-collection.slice aggregate must be loaded and bounded to at most 512 MiB/96 tasks. Missing/unbounded configuration refuses new production admission/collection; install the supplied slice and reload systemd in the authorized maintenance workflow.\n\nFINALIZING means pending, not secured/completed. COLLECTION_FAILED preserves saved work, the original/current deadlines and account restrictions. A protected checksum with COLLECTION_FAILED means cleanup still needs repair; never delete or replace the bundle to force retry. Fix the stated storage, permission, timing, resource or uncontained-writer cause first. Unflagged info/list may reconcile eligible access. Use info ATTEMPT --read-only or list --read-only for observation without reconciliation or writes; never run reconcile merely to inspect. A snapshot is not archive verification or work permission. Manifest/export verification also requires the worker resource boundary.\n\nExamples use an attempt UUID from examctl list; do not substitute an exam ID. Retry on an active attempt irreversibly finishes it. No automatic workspace deletion, refund or account override. Exit status: 0 success or honest pending state, 1 refusal/failure, 2 invalid syntax. See examctl help retry and examctl help override-access.")
		return true
	}
	if topic == "management" {
		fmt.Fprintln(w, `examctl must cover every web/native management workflow. Current native commands
do not yet satisfy full coverage. Help and syntax need no root/configuration.

Gateway workflows use the existing root agent identity over verified outbound
HTTPS, with explicit named operation authorization; no browser login is required:
  examctl web help                     definitions and future settings
  examctl web students help            roster, settings and reviewed CSV import
  examctl web grants help              attempt grants and workspace sources
  examctl web templates help           authenticated exact source metadata
  examctl web attempts help            attempt and pending-operation inspection
  examctl web clocks help              reviewed individual/bulk clock changes
  examctl web interruptions help       review and continuation authorization
  examctl web alerts help              delivery/status and explicit reminders
  examctl web monitoring help          reads, private export, deletion/purge status
  examctl web administrators help      metadata and secret-safe creation

Grant workflows save initial settings at enrollment, support reviewed NEW legacy
initial/additional allowances, exact materials with empty or separate-template
work, and finite repeatable sandbox practice. Inspect/revise/revoke unused grants;
only fresh native Begin starts time. Changing defaults never revises issued grants.
Saved-work grant migration remains pending; inspect legacy recovery-grants and
preserve protected sources. Never replace unknown consumption as a retry.

Local root workflows: templates help installs/verifies/syncs immutable sources;
workspaces help covers retention metadata/holds (no deletion enabled); panes help
covers targeted inspection/closure. Native manifest/export/delete concern protected
submissions, not exam definitions. Configuration show/validate is offline only;
use config help. Agent stop/restart requires a separately authorized full drain.

Gateway clock acceptance is not native application: inspect each intent and native
info ATTEMPT --read-only. Interruption approval is not execution permission.
Monitoring logical deletion is not completed physical purge. Monitoring export
requires a NEW private directory and signed completion; it is not a protected
submission. Administrator creation never resets/overwrites existing credentials.

Definition retirement, saved-work grant migration, complete workspace cleanup,
configuration mutation and remaining full management are pending. No supported
offline SQL/JSON editing or separate agent control API exists. See each command's
help and docs/todo-design-decisions.md for current coverage and safety gates.
Exit status: 0 help/success, 1 operational refusal, 2 usage error.`)
		return true
	}
	if topic != "" {
		g, ok := guides[topic]
		if !ok {
			fmt.Fprintf(w, "Unknown command %q. Run examctl help for supported workflows.\n", topic)
			return false
		}
		fmt.Fprintf(w, "Usage: sudo examctl %s\n\n%s\n\n%s\n\nExamples (replace ATTEMPT with a UUID from list):\n%s\n\n", g.usage, g.summary, g.restrictions, g.examples)
	} else {
		fmt.Fprint(w, "Usage: examctl help [COMMAND] | sudo examctl [FLAGS] COMMAND [TARGET]\n\nInspect:       list, info, health, accounts\nAttempts:      start, pause, stop (finish), cancel, cancel-absent, retry\nWorkspace:     workspace-prepare, workspace-repair\nSubmissions:   manifest, export, delete\nAccess:        reconcile, override-access\nAgent:         agent start|stop|restart|status\nCompatibility: export-status, pause-export, resume-export (disabled)\n\nIncident observation: list --read-only -> info ATTEMPT --read-only -> review reported causes\nOnly after deliberate recovery authorization: reconcile -> info ATTEMPT --read-only\nSubmission deletion is separate from exam-definition deletion and account release.\nRead examctl help COMMAND before mutations; examctl help management describes remaining coverage gaps.\nUse examctl help collection for worker/resource/pending-state recovery.\n\n")
	}
	if topic == "" {
		fmt.Fprintln(w, "Offline native configuration/candidate checks: config show/validate; use examctl config help. No configuration apply or service action.")
		fmt.Fprintln(w, "Immutable local templates: templates validate/install/list/show/verify/jobs/clean; templates sync records a signed gateway source attestation, not a grant. Use examctl templates help and web templates help.")
		fmt.Fprintln(w, "Legacy saved work: recovery-grants [--exam EXAM] (offline inspection, not unified grant issuance).")
		fmt.Fprintln(w, "Workspace retention metadata/holds: workspaces list/show/hold/release-hold; use examctl help workspaces (no deletion enabled).")
		fmt.Fprintln(w, "Native targeted panes: panes list/show/close and panes supervisor; offline snapshots, bounded root-owner Unix observations and durably audited revision-fenced closure. Use examctl help panes; clocks/holds/other panes are preserved.")
		fmt.Fprintln(w, "Gateway definitions: web exams list/show/create/update; use examctl web help (root agent identity, explicit gateway authorization).")
		fmt.Fprintln(w, "Gateway attempt grants and sources: web grants; use examctl web grants help (initial/additional, independent work and finite sandbox practice).")
		fmt.Fprintln(w, "Gateway roster/CSV: web students; use examctl web students help.")
		fmt.Fprintln(w, "Gateway administrators: web administrators list/show/create; use examctl web administrators help (secret-safe input, no credential reset/overwrite).")
		fmt.Fprintln(w, "Gateway email delivery/manual reminders: web alerts; use examctl web alerts help.")
		fmt.Fprintln(w, "Gateway attempts/clocks/interruption review: web attempts/clocks/interruptions; use each topic's help.")
		fmt.Fprintln(w, "Gateway private monitoring metadata/images/replay/complete export/deletion/purge status: web monitoring; use examctl web monitoring help.")
	}
	fmt.Fprint(w, "Global flags (before or after command):\n  --config FILE  root configuration; default /etc/exam-agent/agent.json\n  --read-only    list/info observation only: no initialization, locks or writes; JSON, not permission\n  --state DIR    explicit existing private directory for --read-only; bypass config/keys\n  --limit N      read-only list page size; default 50, maximum 200\n  --after UUID   read-only list exclusive attempt cursor\n  --reason TEXT  concrete audited administrator reason (at least 8 characters)\n  --exam EXAM    exam-ID filter for list (also legacy info --exam)\n  --active       only started unfinished attempts in list\n  --json         list as JSON; other inspection/mutation results already use JSON\n  --output FILE  export to a new private file instead of binary stdout\n  --help         command help, available without root/configuration\n\nAll actual native operations require root. --read-only bypasses initialization/reconciliation and takes no state locks; other native workflows use watchdog state/locks.\nExit status: 0 success, 1 refusal/operational failure, 2 invalid syntax.\nMachine timestamps are UTC Unix milliseconds; native durations are seconds.\nOffline native state is authoritative locally; it does not prove gateway synchronization.\n")
	return true
}

func printRefusal(w io.Writer, op, id, config string, e *core.Engine) {
	prefix := "sudo examctl"
	if config != "/etc/exam-agent/agent.json" {
		prefix += " --config '" + strings.ReplaceAll(config, "'", "'\\''") + "'"
	}
	if op == "delete" {
		fmt.Fprintln(w, "Target operation: delete a protected submission, not an exam definition or attempt history.")
		fmt.Fprintf(w, "Inspect saved-work dependencies: %s recovery-grants\nUnused/uncertain authorizations and unfinished dependent attempts must retain their source. Never remove grant/consumed markers or rewrite history to force deletion.\n", prefix)
	}
	if e != nil && id != "" {
		snapshot, err := core.ObserveNativeReadOnly(e.Config.State, core.ReadOnlyQuery{ID: id, Limit: 1})
		if err == nil {
			for _, a := range snapshot.Attempts {
				if a.ID == id {
					date := func(ms int64) string {
						if ms == 0 {
							return "not recorded"
						}
						return time.UnixMilli(ms).UTC().Format(time.RFC3339Nano)
					}
					fmt.Fprintf(w, "Captured native metadata only; refusal reporting performs no reconciliation, locking or writes. Lease observation: %s; not proof of current SSH, monitoring or work permission.\nAttempt %s; student %q; exam %q; state %s; access %s; policy %s; recorded protected=%t\nOriginal deadline: %s\nCurrent deadline: %s\nAccess/policy recovery: %.1000q / %.1000q\n", a.Lease.Status, a.ID, a.Username, a.Exam, a.State, a.AccessState, a.PolicyState, a.RecordedProtected, date(max(a.OriginalDeadline, 0)), date(a.Deadline), a.AccessError, a.PolicyError)
					fmt.Fprintf(w, "Recorded collection/writer errors (%d total; at most 20 displayed):\n", len(a.Errors))
					for i, diagnostic := range a.Errors {
						if i == 20 {
							fmt.Fprintln(w, "  Further errors omitted; inspect the read-only JSON snapshot for full recorded diagnostics.")
							break
						}
						fmt.Fprintf(w, "  %.1000q\n", diagnostic)
					}
					if a.Start == 0 {
						fmt.Fprintln(w, "Only an unstarted preparation can be cancelled. Cancellation is distinct from submission deletion; inspect its status first.")
					} else {
						fmt.Fprintln(w, "Normal release requires both original/current deadlines, the same-boot elapsed boundary, verified protected work, no remaining writers and confirmed account restoration.")
					}
					if op == "cancel" && a.Start > 0 {
						fmt.Fprintln(w, "This recorded attempt already started and cannot be cancelled, reopened or refunded. A completed record remains historical; inspect it without writes. For an unfinished attempt, review help pause/stop before any separately intended lock or irreversible finish.")
					}
					fmt.Fprintf(w, "Inspect without writes: %s info %s --read-only\nOnly for deliberate eligible-state recovery: %s reconcile\nObserve again without writes: %s info %s --read-only\n", prefix, id, prefix, prefix, id)
					if a.State == "COLLECTION_FAILED" {
						fmt.Fprintln(w, "Collection worker/resource/storage/writer diagnosis: examctl help collection. Protected work and account restrictions remain in place.")
						fmt.Fprintf(w, "After fixing the reported cause: %s retry %s --reason 'Concrete collection repair performed'\n", prefix, id)
					}
					if a.RecordedProtected {
						fmt.Fprintf(w, "Verify protected source: %s manifest %s\n", prefix, id)
					}
					if op == "delete" || op == "override-access" {
						fmt.Fprintln(w, "Emergency release needs separate approval, root, verified protection/termination and a durable reason. Review examctl help override-access; it is never automatic.")
					}
				}
			}
		} else {
			fmt.Fprintf(w, "Current native snapshot unavailable; no fallback reconciliation or repair was attempted. Preserve records and inspect: %s info %s --read-only\n", prefix, id)
		}
	}
	fmt.Fprintf(w, "Help: examctl help %s\n", op)
}
