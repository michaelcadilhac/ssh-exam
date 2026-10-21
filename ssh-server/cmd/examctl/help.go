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
	"workspace-prepare": {"workspace-prepare ATTEMPT", "Verify and stage a private workspace for an unstarted preparation without consuming time or saved-work allowance.", "Normally run automatically in student preflight. Uses the bounded collection worker pool and freezes this preparation's starter/saved files privately. Practice cannot see the staged tree; only an explicit, monitored Begin publishes it. Refuses changed/cancelled/expired preparations, damaged sources and unexpected live work. Retrying adopts the same verified private receipt after a crash; it does not overwrite work. This does not issue a new attempt grant or reset its 15-minute preflight timer.", "examctl info ATTEMPT\nexamctl workspace-prepare ATTEMPT\nexamctl info ATTEMPT", true, false},
	"workspace-repair":  {"workspace-repair ATTEMPT --reason REASON", "Finish interrupted publication of an already committed workspace so it can be protected by collection.", "Only ACTIVATING/COLLECTION_FAILED with an exact staged receipt and original interval. Never restarts time, recopies changed source, overwrites edits or reopens the attempt. Result remains COLLECTION_FAILED with no execution lease; inspect, then explicitly retry collection. Unstarted preparation failures use workspace-prepare instead. Preserve all private staging directories until diagnosis; no automatic cleanup.", "examctl info ATTEMPT\nexamctl workspace-repair ATTEMPT --reason 'Corrected filesystem issue after interrupted publication'\nexamctl retry ATTEMPT --reason 'Publication repaired; secure the original interval'\nexamctl manifest ATTEMPT", true, true},
	"list":              {"list [--active] [--exam EXAM] [--json]", "List native attempt records; --active means started and unfinished, not merely connected.", "Default: all native attempts. Exam IDs are definitions, attempt IDs are UUIDs. Text deadlines use RFC3339 UTC; --json includes authoritative fields. Works offline from the gateway.", "examctl list --active\nexamctl list --exam midterm --json", false, false},
	"info":              {"info ATTEMPT", "Inspect an attempt, its protected submission, timing and account policy.", "JSON includes original/current deadlines in Unix milliseconds, clock revisions, protection, access/policy errors and native workload records. No password or private admission proof is printed. Legacy info --exam EXAM lists attempts.", "examctl info ATTEMPT\nexamctl list --exam midterm --json", true, false},
	"start":             {"start ATTEMPT --reason REASON", "Commit a prepared native attempt's interval and initialize its workspace.", "Only a provably unstarted preparation with native guards and protected transport ready. This releases exam material and consumes time; it is not a clock reset. Ordinary monitored starts use student Begin. Never use local start to bypass monitoring. Retrying a committed start cannot grant another interval.", "examctl info ATTEMPT\nexamctl start ATTEMPT --reason 'Approved monitored start recovery'", true, true},
	"pause":             {"pause ATTEMPT --reason REASON", "Lock one unfinished attempt; its clock and account restriction continue.", "Current policy freezes/terminates workloads and requires fresh SSH plus generation-bound instructor authorization before continuation. Saved files survive; unsaved buffers do not. This does not pause time or release ordinary access.", "examctl info ATTEMPT\nexamctl pause ATTEMPT --reason 'Instructor reviewed monitoring failure'", true, true},
	"stop":              {"stop ATTEMPT --reason REASON", "Irreversibly finish and collect one started attempt.", "Uses protected finalization; failure retains recovery and account restrictions. Success cannot reopen the exam or release access before both deadlines. Does not stop shared services. finish is an alias.", "examctl info ATTEMPT\nexamctl stop ATTEMPT --reason 'Instructor authorized early termination'\nexamctl manifest ATTEMPT", true, true},
	"cancel":            {"cancel ATTEMPT --reason REASON", "Cancel only a provably unstarted preparation and restore its temporary account policy.", "Start/current/original deadlines must all be unset. A lost activation reply is uncertain and must be inspected, not reset. Cancelling a started attempt is refused. This does not delete an exam definition or protected submission.", "examctl info ATTEMPT\nexamctl cancel ATTEMPT --reason 'Abandoned unstarted preparation'\nexamctl reconcile\nexamctl info ATTEMPT", true, true},
	"retry":             {"retry ATTEMPT --reason REASON", "Retry protected finalization after diagnosing and correcting collection recovery.", "Inspect errors and fix storage/writer/timing failures first. Never replace/delete a published protected bundle or remove a hold to make retry succeed. WARNING: on an active attempt this requests irreversible early finalization, like stop.", "examctl info ATTEMPT\nexamctl retry ATTEMPT --reason 'Corrected storage capacity; retry collection'\nexamctl manifest ATTEMPT", true, true},
	"manifest":          {"manifest ATTEMPT", "Verify and print the protected submission manifest as JSON.", "Requires a verified local protected bundle. Reading does not recollect live work. Includes saved-file hashes, omissions and timing in documented storage units. Archives/receipts have separate retention from monitoring.", "examctl manifest ATTEMPT\nexamctl info ATTEMPT", true, false},
	"export":            {"export ATTEMPT [--output FILE]", "Verify and export the protected archive locally.", "Default: binary tar.gz to stdout, diagnostics to stderr. --output creates a new file and refuses overwrite. Restrict destination access; an I/O failure may leave a partial file and returns failure. This does not send archive bytes to the gateway. No student filenames are executed.", "examctl manifest ATTEMPT\nexamctl export ATTEMPT --output ./submission.tar.gz", true, false},
	"delete":            {"delete ATTEMPT --reason REASON", "Delete a protected submission from native storage, not the exam definition or attempt history.", "Destructive: requires COMPLETED and released/overridden ordinary access, including restored policy. It does not cancel preparation, finish work or release access. Verify retention/administrator requirements first; export separately if required. No automatic emergency override.", "examctl info ATTEMPT\nexamctl manifest ATTEMPT\nexamctl delete ATTEMPT --reason 'Approved protected submission retention expiry'", true, true},
	"override-access":   {"override-access ATTEMPT --reason REASON", "Perform a separate root-only emergency release of a secured, fully terminated account.", "Requires verified protected work, no remaining writers and a durable audited 8–1000 character reason. Native restoration must succeed. Never invokes itself to fix another refusal. Consequences: releases original interval restrictions early; does not reopen work, change timing or replace submissions. Normal release uses reconcile after both deadlines.", "examctl info ATTEMPT\nexamctl manifest ATTEMPT\nexamctl reconcile\n# Only after independent emergency approval and verification:\nexamctl override-access ATTEMPT --reason 'Concrete approved emergency disposition'", true, true},
	"health":            {"health", "Inspect native readiness, capabilities and concrete missing guards.", "Readiness does not certify institutional authentication or privileged target-host qualification. Works without gateway connectivity; signed callback delivery is separate.", "examctl health\nexamctl agent status", false, false},
	"accounts":          {"accounts", "Print root-approved native course-account mappings as JSON.", "Does not enroll web students, create Unix accounts or change account restrictions. A cached account mapping does not replace live signed identity verification at student login.", "examctl accounts\nexamctl health", false, false},
	"reconcile":         {"reconcile", "Reconcile all native attempts, due timing/collection and eligible account restoration.", "Can change due state and perform collection/cleanup; independent watchdog remains authoritative. May contact the fixed gateway for signed deadline timing. Failure leaves holds/frozen work in place. No deadline reset, marker deletion or implicit early release.", "examctl list --active\nexamctl reconcile\nexamctl info ATTEMPT", false, false},
	"agent":             {"agent start|stop|restart|status", "Manage the shared command-gate service only.", "status inspects systemd. stop/restart can interrupt students/PTYS: drain attempts, real preflights, pending timing and recovery first. stop leaves watchdog/reconciliation running; start/restart also ensure them running. Never use service stop to finish an exam. Temporary PTY-owning handoffs require the separate consolidation runbook.", "examctl agent status\nexamctl list --active\n# Only in an authorized drained maintenance window:\nexamctl agent restart", true, false},
	"export-status":     {"export-status ATTEMPT", "Inspect local/historical archive transfer metadata.", "Protected submissions remain on the SSH server. A historical transfer flag is not current gateway storage or successful synchronization.", "examctl export-status ATTEMPT\nexamctl export ATTEMPT --output ./submission.tar.gz", true, false},
	"pause-export":      {"pause-export ATTEMPT --reason REASON", "Record an audited historical archive-delivery hold.", "Compatibility workflow only: automatic web archive transfer is disabled. This does not change native protection, collection or account access.", "examctl export-status ATTEMPT\nexamctl pause-export ATTEMPT --reason 'Retain historical archive delivery hold'", true, true},
	"resume-export":     {"resume-export ATTEMPT --reason REASON", "Explain the retired automatic archive-transfer operation.", "Always refused: archives stay on the SSH server. Use verified local export; no command re-enables automatic archive uploads.", "examctl export-status ATTEMPT\nexamctl export ATTEMPT --output ./submission.tar.gz", true, true},
}

func init() {
	g := guides["stop"]
	g.restrictions += " Collection runs in a bounded worker outside the shared state lock. A busy worker returns FINALIZING (pending), not completed; inspect info and retry/reconcile as appropriate. See examctl help collection."
	guides["stop"] = g
	g.usage = "finish ATTEMPT --reason REASON"
	g.summary = "Alias of stop: irreversibly finish and collect one started attempt."
	guides["finish"] = g
	deletion := guides["delete"]
	deletion.restrictions += " Unused/uncertain legacy saved-work authorizations and unfinished dependent attempts also block deletion. Verification runs in a bounded worker while source/catalog locks fence native consumption. Inspect examctl recovery-grants first; do not remove grants/markers or invent history to bypass a refusal."
	guides["delete"] = deletion
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
		fmt.Fprintln(w, "Collection diagnosis (root native operations; works offline from the gateway):\n  examctl info ATTEMPT\n  examctl manifest ATTEMPT\n  examctl retry ATTEMPT --reason 'Concrete storage/writer repair performed'\n  examctl reconcile\n\nCollection/verification/cleanup run in supervised per-attempt processes, separate from SSH/PTY owners. Two cross-process heavy-work slots; each worker has 256 MiB memory, no swap, 32 tasks and a 120-second runtime. The exam-collection.slice aggregate must be loaded and bounded to at most 512 MiB/96 tasks. Missing/unbounded configuration refuses new production admission/collection; install the supplied slice and reload systemd in the authorized maintenance workflow.\n\nFINALIZING means pending, not secured/completed. COLLECTION_FAILED preserves saved work, the original/current deadlines and account restrictions. A protected checksum with COLLECTION_FAILED means cleanup still needs repair; never delete or replace the bundle to force retry. Fix the stated storage, permission, timing, resource or uncontained-writer cause first. Read-only inspection may reconcile eligible access but never overrides a hold. Manifest/export verification also requires the worker resource boundary.\n\nExamples use an attempt UUID from examctl list; do not substitute an exam ID. Retry on an active attempt irreversibly finishes it. No automatic workspace deletion, refund or account override. Exit status: 0 success or honest pending state, 1 refusal/failure, 2 invalid syntax. See examctl help retry and examctl help override-access.")
		return true
	}
	if topic == "management" {
		fmt.Fprintln(w, "examctl must cover every web/native management workflow. Current native commands do not yet satisfy full coverage.\nSigned root-agent workflows cover definitions, roster/CSV, alert inspection/test/manual reminders, bounded attempts/current individual/bulk clocks and interruption review/authorization: use examctl web help and web students/alerts/attempts/clocks/interruptions help. Explicit gateway operation authorization is required. Clock acceptance is not native confirmation; inspect each intent and native info. Interruption approval alone is not execution permission. Definition retirement, monitoring export/deletion, unified grants, templates/config and administrator management remain pending. No supported offline SQL/JSON editing or separate agent control API exists. Continue using the authenticated administrator dashboard for remaining web workflows.\nUse examctl help for supported local commands. See docs/todo-design-decisions.md for the coverage investigation.")
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
		fmt.Fprint(w, "Usage: examctl help [COMMAND] | sudo examctl [FLAGS] COMMAND [TARGET]\n\nInspect:       list, info, health, accounts\nAttempts:      start, pause, stop (finish), cancel, retry\nWorkspace:     workspace-prepare, workspace-repair\nSubmissions:   manifest, export, delete\nAccess:        reconcile, override-access\nAgent:         agent start|stop|restart|status\nCompatibility: export-status, pause-export, resume-export (disabled)\n\nCommon workflow: list -> info ATTEMPT -> diagnose -> reconcile -> info\nSubmission deletion is separate from exam-definition deletion and account release.\nRead examctl help COMMAND before mutations; examctl help management describes remaining coverage gaps.\nUse examctl help collection for worker/resource/pending-state recovery.\n\n")
	}
	if topic == "" {
		fmt.Fprintln(w, "Legacy saved work: recovery-grants [--exam EXAM] (offline inspection, not unified grant issuance).")
		fmt.Fprintln(w, "Gateway definitions: web exams list/show/create/update; use examctl web help (root agent identity, explicit gateway authorization).")
		fmt.Fprintln(w, "Gateway roster/CSV: web students; use examctl web students help.")
		fmt.Fprintln(w, "Gateway email delivery/manual reminders: web alerts; use examctl web alerts help.")
		fmt.Fprintln(w, "Gateway attempts/clocks/interruption review: web attempts/clocks/interruptions; use each topic's help.")
	}
	fmt.Fprint(w, "Global flags (before or after command):\n  --config FILE  root configuration; default /etc/exam-agent/agent.json\n  --reason TEXT  concrete audited administrator reason (at least 8 characters)\n  --exam EXAM    exam-ID filter for list (also legacy info --exam)\n  --active       only started unfinished attempts in list\n  --json         list as JSON; other inspection/mutation results already use JSON\n  --output FILE  export to a new private file instead of binary stdout\n  --help         command help, available without root/configuration\n\nAll actual native operations require root and use the same state/locks as the watchdog.\nExit status: 0 success, 1 refusal/operational failure, 2 invalid syntax.\nMachine timestamps are UTC Unix milliseconds; native durations are seconds.\nOffline native state is authoritative locally; it does not prove gateway synchronization.\n")
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
		rows, err := e.List(false, "")
		if err == nil {
			for _, a := range rows {
				if a.ID == id {
					date := func(ms int64) string {
						if ms == 0 {
							return "not recorded"
						}
						return time.UnixMilli(ms).UTC().Format(time.RFC3339Nano)
					}
					fmt.Fprintf(w, "Attempt %s; student %q; exam %q; state %s; access %s; policy %s; protected=%t\nOriginal deadline: %s\nCurrent deadline: %s\nAccess/policy recovery: %q / %q\nRecorded collection/writer errors: %q\n", a.ID, a.Username, a.Exam, a.State, a.AccessState, a.PolicyState, a.Protected, date(max(a.OriginalDeadline, 0)), date(a.Deadline), a.AccessError, a.PolicyError, a.Errors)
					if a.Start == 0 {
						fmt.Fprintln(w, "Only an unstarted preparation can be cancelled. Cancellation is distinct from submission deletion; inspect its status first.")
					} else {
						fmt.Fprintln(w, "Normal release requires both original/current deadlines, the same-boot elapsed boundary, verified protected work, no remaining writers and confirmed account restoration.")
					}
					fmt.Fprintf(w, "Inspect: %s info %s\nReconcile eligible state: %s reconcile\nVerify again: %s info %s\n", prefix, id, prefix, prefix, id)
					if a.State == "COLLECTION_FAILED" {
						fmt.Fprintln(w, "Collection worker/resource/storage/writer diagnosis: examctl help collection. Protected work and account restrictions remain in place.")
						fmt.Fprintf(w, "After fixing the reported cause: %s retry %s --reason 'Concrete collection repair performed'\n", prefix, id)
					}
					if a.Protected {
						fmt.Fprintf(w, "Verify protected source: %s manifest %s\n", prefix, id)
					}
					if op == "delete" || op == "override-access" {
						fmt.Fprintln(w, "Emergency release needs separate approval, root, verified protection/termination and a durable reason. Review examctl help override-access; it is never automatic.")
					}
				}
			}
		}
	}
	fmt.Fprintf(w, "Help: examctl help %s\n", op)
}
