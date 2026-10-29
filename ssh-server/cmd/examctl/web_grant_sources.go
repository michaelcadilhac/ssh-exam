package main

import (
	"encoding/json"
	"examworkspace/agent/internal/core"
	"flag"
	"fmt"
	"os"
)

// Supported root entry: finite exact revision synchronization. No private agent
// listener or browser native-receipt assertion; the existing signed HTTPS path
// supplies only a fixed-purpose plan and records its durable local outcome.
func webGrantSourcesMain(args []string) int {
	f := flag.NewFlagSet("examctl web grants source", flag.ContinueOnError)
	f.SetOutput(os.Stderr)
	path := f.String("config", "/etc/exam-agent/agent.json", "protected root agent configuration")
	revision := f.Int64("revision", 0, "exact saved-source grant revision")
	request := f.String("request", "", "confirmation retry UUID; plan reads always refresh")
	usage := func(message string) int {
		fmt.Fprintln(os.Stderr, message+"; use examctl web grants help for source-show/source-sync and exact saved-source workflows")
		return 2
	}
	if err := f.Parse(ordered(args)); err != nil {
		return usage("invalid source flags")
	}
	w := f.Args()
	if len(w) != 3 || w[0] != "grants" || (w[1] != "source-show" && w[1] != "source-sync") || !managementUUID.MatchString(w[2]) || *revision < 1 || *revision > catalogSafeInteger || (*request != "" && !managementUUID.MatchString(*request)) {
		return usage("select source-show/source-sync GRANT --revision N")
	}
	if os.Getuid() != 0 || os.Geteuid() != 0 {
		fmt.Fprintln(os.Stderr, "run source synchronization as root on the class server; instructor web issuance needs no student SSH connection")
		return 1
	}
	config, err := scriptLoadConfig(*path)
	if err != nil {
		fmt.Fprintln(os.Stderr, "cannot load protected root configuration:", err)
		return 1
	}
	engine := &core.Engine{Config: config} // Metadata/archive workflow, no initialization or account reconciliation.
	if w[1] == "source-show" {
		row, err := engine.SourceRetention(w[2], *revision)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			return 1
		}
		if err := json.NewEncoder(os.Stdout).Encode(row); err != nil {
			fmt.Fprintln(os.Stderr, "Write source metadata:", err)
			return 1
		}
		return 0
	}
	planning, err := core.ManagementCall(config, "grants.source-plan", map[string]any{"id": w[2], "revision": *revision}, "")
	if err != nil {
		fmt.Fprintln(os.Stderr, "source plan unavailable; no account/clock changed:", err)
		return 1
	}
	var plan core.SourceRetentionPlan
	if catalogDecode(planning.Result, &plan, []string{"version", "agent", "grant", "exam", "username", "uid", "settings", "source", "action", "current_revision", "status"}) != nil || core.ValidateSourceRetentionPlan(plan, config.AgentID, w[2], *revision) != nil {
		fmt.Fprintln(os.Stderr, "invalid or wrong-scope source plan; preserve the original grant/source and retry a fresh source-sync read")
		return 1
	}
	var row *core.GrantSourceRetention
	if plan.Action == "retain" {
		row, err = engine.RetainGrantSource(plan)
	} else {
		row, err = engine.ReleaseGrantSource(plan)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "source synchronization unconfirmed; inspect source-show and retry the SAME grant/revision after repair:", err)
		return 1
	}
	state := "RETAINED"
	if row.Phase == "released" {
		state = "RELEASED"
	}
	if *request == "" {
		*request = core.ManagementID()
	}
	confirmed, err := core.ManagementCall(config, "grants.source-confirm", map[string]any{"id": w[2], "revision": *revision, "grant_hash": plan.Grant.Hash, "state": state, "source": map[string]any{"attempt": plan.Source.Attempt, "checksum": plan.Source.Checksum, "uid": plan.UID, "metadata_hash": row.MetadataHash}, "retention_hash": row.RetentionHash, "retained_at": row.RetainedAt}, *request)
	if err != nil {
		fmt.Fprintf(os.Stderr, "native source is %s; gateway acknowledgement unconfirmed. Inspect source-show and retry SAME grant/revision --request %s: %v\n", row.Phase, *request, err)
		return 1
	}
	var receipt struct {
		ID            string `json:"id"`
		Revision      int64  `json:"revision"`
		State         string `json:"state"`
		RetentionHash string `json:"retention_hash"`
		Status        string `json:"status"`
	}
	if catalogDecode(confirmed.Result, &receipt, []string{"id", "revision", "state", "retention_hash", "status"}) != nil || receipt.ID != w[2] || receipt.Revision != *revision || receipt.State != state || receipt.RetentionHash != row.RetentionHash || (state == "RETAINED" && receipt.Status != "AVAILABLE") {
		fmt.Fprintln(os.Stderr, "wrong-scope/stale source acknowledgement; inspect native source-show and current web grant before retry; no success inferred")
		return 1
	}
	if err := json.NewEncoder(os.Stdout).Encode(confirmed); err != nil {
		fmt.Fprintln(os.Stderr, "Write confirmed source result; inspect original grant before retry:", err)
		return 1
	}
	return 0
}
