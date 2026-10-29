package main

import (
	"encoding/json"
	"errors"
	"examworkspace/agent/internal/core"
	"fmt"
	"os"
	"reflect"
)

type scriptSourceRef struct {
	Username string          `json:"username"`
	ID       string          `json:"grant"`
	Revision int64           `json:"revision"`
	Hash     string          `json:"hash"`
	Source   grantWorkResult `json:"source"`
	Request  string          `json:"request"`
}
type scriptSourceOutcome struct {
	Username string         `json:"username"`
	ID       string         `json:"grant"`
	Revision int64          `json:"revision"`
	Request  string         `json:"request"`
	Outcome  string         `json:"outcome"`
	Status   string         `json:"status"`
	Failure  *scriptFailure `json:"error"`
}

func scriptSyncBatch(o scriptOptions, seen map[string]bool) int {
	for key := range seen {
		switch key {
		case "config", "from-receipt", "receipt", "resume", "format", "fields", "no-header", "error-format", "output":
		default:
			return scriptFail(o, "usage", "not_sent", "correct_arguments", fmt.Errorf("--%s is not valid for receipt-based source-sync", key))
		}
	}
	if o.receipt == "" {
		return scriptFail(o, "usage", "not_sent", "correct_arguments", errors.New("batch source-sync requires --receipt for durable per-grant retry IDs"))
	}
	if os.Getuid() != 0 || os.Geteuid() != 0 {
		return scriptFail(o, "root_required", "not_sent", "run_as_root", errors.New("run source synchronization as root on the class server"))
	}
	c, err := scriptLoadConfig(o.config)
	if err != nil {
		return scriptFail(o, "configuration", "not_sent", "repair_configuration", err)
	}
	issued, err := readScriptReceipt(o.from)
	if err == nil {
		err = issued.checkContext(c)
	}
	if err != nil {
		return scriptFail(o, "receipt_scope", "not_sent", "inspect_receipt", err)
	}
	if issued.Operation != "grants.issue-confirm" || issued.Outcome != "confirmed" {
		return scriptFail(o, "receipt", "not_sent", "inspect_receipt", errors.New("source-sync needs the confirmed issuance receipt, never an unconfirmed preview"))
	}
	if err := validateGrantIssuanceResult(issued.Operation, issued.Body, issued.Result.Result, c.AgentID); err != nil {
		return scriptFail(o, "receipt_scope", "not_sent", "inspect_receipt", err)
	}
	var batch grantIssuanceResult
	if json.Unmarshal(issued.Result.Result, &batch) != nil || batch.Status != "CONFIRMED" || len(batch.Issued) < 1 {
		return scriptFail(o, "receipt", "not_sent", "inspect_receipt", errors.New("issuance has no confirmed grant references"))
	}
	rows := map[string]struct {
		Hash string
		Work grantWorkResult
	}{}
	for _, row := range batch.Rows {
		rows[row.Username] = struct {
			Hash string
			Work grantWorkResult
		}{row.Hash, row.Work}
	}
	refs := []scriptSourceRef{}
	for _, item := range batch.Issued {
		row, ok := rows[item.Username]
		if !ok || row.Work.Kind != "saved" {
			return scriptFail(o, "receipt", "not_sent", "inspect_receipt", errors.New("batch source-sync requires an exact saved source for every issued grant"))
		}
		// Newly issued grants start at revision1 by the existing issuance contract;
		// the fresh plan below MUST confirm this exact revision/hash, never adopt a
		// later revision or turn an intended retain into a release.
		refs = append(refs, scriptSourceRef{Username: item.Username, ID: item.Grant, Revision: 1, Hash: row.Hash, Source: row.Work, Request: core.ManagementID()})
	}
	if _, err := os.Lstat(o.receipt); err == nil && o.resume {
		previous, err := readScriptReceipt(o.receipt)
		if err != nil {
			return scriptFail(o, "receipt", "not_sent", "inspect_receipt", err)
		}
		var saved []scriptSourceRef
		b, _ := json.Marshal(previous.Body["grants"])
		if json.Unmarshal(b, &saved) != nil || len(saved) != len(refs) {
			return scriptFail(o, "receipt", "not_sent", "inspect_receipt", errors.New("batch receipt has different grant references"))
		}
		for i := range refs {
			request := saved[i].Request
			saved[i].Request = refs[i].Request
			if !reflect.DeepEqual(saved[i], refs[i]) || !managementUUID.MatchString(request) {
				return scriptFail(o, "receipt", "not_sent", "inspect_receipt", errors.New("batch references changed; no new request sent"))
			}
			refs[i].Request = request
		}
	}
	body := map[string]any{"review": batch.ID, "review_revision": batch.Revision, "exam": batch.Exam, "grants": refs}
	r, lock, _, err := loadScriptIntent(c, &o, "grants.source-sync-batch", body)
	if err != nil {
		return scriptFail(o, "receipt", "not_sent", "inspect_receipt", err)
	}
	defer lock.Close()
	var previous struct {
		Items []scriptSourceOutcome `json:"items"`
	}
	if len(r.Result.Result) > 0 && json.Unmarshal(r.Result.Result, &previous) != nil {
		return scriptFail(o, "receipt", "not_sent", "inspect_receipt", errors.New("invalid batch outcome history"))
	}
	prior := map[string]scriptSourceOutcome{}
	for _, item := range previous.Items {
		prior[item.ID] = item
	}
	items := make([]scriptSourceOutcome, 0, len(refs))
	allResolved := true
	for _, ref := range refs {
		item := scriptSourceOutcome{Username: ref.Username, ID: ref.ID, Revision: ref.Revision, Request: ref.Request, Outcome: "unknown"}
		if old, ok := prior[ref.ID]; ok && old.Outcome == "refused" {
			item = old
		} else {
			status, err := scriptSyncSource(c, ref)
			if err != nil {
				item.Failure = scriptError(err)
				item.Outcome = item.Failure.Outcome
			} else {
				item.Outcome, item.Status = "confirmed", status
			}
		}
		if item.Outcome != "confirmed" {
			allResolved = false
		}
		items = append(items, item)
		data, _ := json.Marshal(map[string]any{"items": items, "complete": allResolved && len(items) == len(refs)})
		r.Result = core.ManagementResult{Request: r.Request, Operation: r.Operation, Confirmed: allResolved && len(items) == len(refs), Result: data}
		r.Outcome = "unknown"
		if allResolved && len(items) == len(refs) {
			r.Outcome = "confirmed"
		}
		if err := saveScriptReceipt(o.receipt, r, true); err != nil {
			return scriptFail(o, "receipt_write", "unknown", "repair_and_resume", err)
		}
	}
	var display []map[string]any
	for _, item := range items {
		b, _ := json.Marshal(item)
		var row map[string]any
		_ = decodeScriptJSON(b, &row)
		display = append(display, row)
	}
	if code := scriptOutput(o, r.Result, display); code != 0 {
		return code
	}
	if !allResolved {
		return scriptFail(o, "partial_source_sync", "partial", "resume_unknown_or_review_refusals", errors.New("some grants remain unavailable/unconfirmed; inspect per-student outcomes; do not reissue the batch"))
	}
	return 0
}

func scriptSyncSource(c core.Config, ref scriptSourceRef) (string, error) {
	planning, err := core.ManagementCall(c, "grants.source-plan", map[string]any{"id": ref.ID, "revision": ref.Revision}, "")
	if err != nil {
		return "", err
	}
	var plan core.SourceRetentionPlan
	if catalogDecode(planning.Result, &plan, []string{"version", "agent", "grant", "exam", "username", "uid", "settings", "source", "action", "current_revision", "status"}) != nil || core.ValidateSourceRetentionPlan(plan, c.AgentID, ref.ID, ref.Revision) != nil || plan.Username != ref.Username || plan.Grant.Hash != ref.Hash || plan.Source.Attempt != ref.Source.Attempt || plan.Source.Checksum != ref.Source.Checksum || plan.CurrentRevision != ref.Revision {
		return "", &core.ManagementFailure{Code: "source_changed", Outcome: "refused", Retry: "review_fresh_grant", Message: "grant/source/revision differs from confirmed issuance; no pin released or new authority created"}
	}
	engine := &core.Engine{Config: c}
	if plan.Status == "CONSUMED" {
		pin, err := engine.SourceRetention(ref.ID, ref.Revision)
		if err != nil || pin.Plan.Grant.Hash != ref.Hash || pin.Plan.Source.Attempt != ref.Source.Attempt {
			return "", errors.New("consumed grant lacks matching retained source metadata; inspect original attempt")
		}
		return "CONSUMED", nil
	}
	if plan.Action != "retain" || (plan.Status != "PENDING_NATIVE" && plan.Status != "AVAILABLE") {
		return "", &core.ManagementFailure{Code: "source_changed", Outcome: "refused", Retry: "review_fresh_grant", Message: "grant was revoked/changed; batch synchronization never turns retain into release"}
	}
	pin, err := engine.RetainGrantSource(plan)
	if err != nil {
		return "", err
	}
	confirmed, err := core.ManagementCall(c, "grants.source-confirm", map[string]any{"id": ref.ID, "revision": ref.Revision, "grant_hash": plan.Grant.Hash, "state": "RETAINED", "source": map[string]any{"attempt": plan.Source.Attempt, "checksum": plan.Source.Checksum, "uid": plan.UID, "metadata_hash": pin.MetadataHash}, "retention_hash": pin.RetentionHash, "retained_at": pin.RetainedAt}, ref.Request)
	if err != nil {
		return "", err
	}
	var outcome struct {
		ID            string `json:"id"`
		Revision      int64  `json:"revision"`
		State         string `json:"state"`
		RetentionHash string `json:"retention_hash"`
		Status        string `json:"status"`
	}
	if catalogDecode(confirmed.Result, &outcome, []string{"id", "revision", "state", "retention_hash", "status"}) != nil || outcome.ID != ref.ID || outcome.Revision != ref.Revision || outcome.State != "RETAINED" || outcome.RetentionHash != pin.RetentionHash || outcome.Status != "AVAILABLE" {
		return "", errors.New("source acknowledgement scope/status differs; retain the same receipt and inspect")
	}
	return outcome.Status, nil
}
