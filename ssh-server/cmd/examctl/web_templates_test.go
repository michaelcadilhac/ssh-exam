package main

import (
	"encoding/json"
	"examworkspace/agent/internal/core"
	"strings"
	"testing"
)

func catalogTestSource() catalogSource {
	return catalogSource{Schema: 1, Agent: "class", Name: "midterm", Hash: strings.Repeat("a", 64), Entries: 4, Files: 2, Bytes: 30, MaxFileBytes: 20, FirstNativeCreated: 1000, LastNativeCreated: 1000, FirstAcknowledged: 0, LastAttested: 0, LastAcknowledged: 0, LastRequest: core.ManagementID(), Revision: strings.Repeat("b", 64)}
}
func TestCatalogHelpAndInvalidSyntaxBeforeRootOrConfiguration(t *testing.T) {
	for _, args := range [][]string{{"web", "templates", "help"}, {"web", "templates", "show", "--help"}} {
		out, code := cliProcess(t, args...)
		for _, want := range []string{"Usage:", "--request", "NEW request", "SOURCE ATTESTATIONS", "templates sync", "Exit status:"} {
			if code != 0 || !strings.Contains(out, want) {
				t.Fatal(want, code, out)
			}
		}
	}
	for _, args := range [][]string{{"web", "templates"}, {"web", "templates", "list", "--limit", "201"}, {"web", "templates", "show", "midterm", "latest"}, {"web", "templates", "list", "--after", core.ManagementID()}, {"web", "templates", "show", "midterm", strings.Repeat("a", 64), "--name", "other"}, {"templates", "sync", "midterm", strings.Repeat("a", 64)}, {"templates", "sync", "midterm", strings.Repeat("a", 64), "--reason", "Reviewed source", "--file-mib", "128"}} {
		out, code := cliProcess(t, args...)
		if code != 2 || !strings.Contains(out, "help") || strings.Contains(out, "Cannot load") {
			t.Fatal(args, code, out)
		}
	}
}
func TestCatalogScopeValidationRejectsWrongAgentTargetCountersMissingFieldsAndControlText(t *testing.T) {
	s := catalogTestSource()
	body := map[string]any{"name": s.Name, "hash": s.Hash}
	valid := map[string]any{"agent": "class", "source": s, "observed": 0, "note": "Timestamped source only, not a live probe"}
	bytes, _ := json.Marshal(valid)
	if err := validateCatalogRead("templates.show", body, bytes, "class"); err != nil {
		t.Fatal("valid epoch-zero metadata refused", err)
	}
	for _, mode := range []string{"agent", "target", "count", "missing", "null", "unknown", "control"} {
		t.Run(mode, func(t *testing.T) {
			var reply map[string]any
			_ = json.Unmarshal(bytes, &reply)
			source := reply["source"].(map[string]any)
			switch mode {
			case "agent":
				source["agent"] = "other"
			case "target":
				source["hash"] = strings.Repeat("c", 64)
			case "count":
				source["files"] = 100
			case "missing":
				delete(source, "files")
			case "null":
				source["files"] = nil
			case "unknown":
				source["private_question"] = "MUST-NOT-PRINT"
			case "control":
				reply["note"] = "unsafe\x1b[31m"
			}
			encoded, _ := json.Marshal(reply)
			err := validateCatalogRead("templates.show", body, encoded, "class")
			if err == nil || strings.Contains(err.Error(), "MUST-NOT-PRINT") {
				t.Fatal("unsafe reply accepted/echoed", err)
			}
		})
	}
	page := map[string]any{"agent": "class", "sources": []catalogSource{s}, "next": s.Name + "@" + s.Hash, "observed": 0, "note": "As-of metadata"}
	encoded, _ := json.Marshal(page)
	if err := validateCatalogRead("templates.list", map[string]any{"name": "midterm", "limit": 1}, encoded, "class"); err != nil {
		t.Fatal(err)
	}
	if validateCatalogRead("templates.list", map[string]any{"name": "other", "limit": 1}, encoded, "class") == nil {
		t.Fatal("wrong filter accepted")
	}
	page["sources"] = []catalogSource{s, s}
	encoded, _ = json.Marshal(page)
	if validateCatalogRead("templates.list", map[string]any{"limit": 2}, encoded, "class") == nil {
		t.Fatal("duplicate/nonordered rows accepted")
	}
}
func TestCatalogAcknowledgementBindsExactLocalBytesAndRequestBeforeOutput(t *testing.T) {
	s := catalogTestSource()
	id := core.ManagementID()
	local := core.TemplateVersion{Schema: 1, Name: s.Name, Hash: s.Hash, Entries: s.Entries, Files: s.Files, Bytes: s.Bytes, MaxFileBytes: s.MaxFileBytes, Created: 1000}
	r := catalogSyncReply{Agent: "class", Source: s, Acknowledgement: catalogAcknowledgement{Request: id, Attested: 0, Acknowledged: 0, NativeCreated: 1000}, Updated: false, Observed: 0, Note: "Original timestamped acknowledgement"}
	encoded, _ := json.Marshal(r)
	if _, err := validateCatalogSync(encoded, local, "class", id); err != nil {
		t.Fatal(err)
	}
	for _, mode := range []string{"request", "bytes", "created", "agent", "missing-updated"} {
		t.Run(mode, func(t *testing.T) {
			var value map[string]any
			_ = json.Unmarshal(encoded, &value)
			switch mode {
			case "request":
				value["acknowledgement"].(map[string]any)["request"] = core.ManagementID()
			case "bytes":
				value["source"].(map[string]any)["bytes"] = 31
			case "created":
				value["acknowledgement"].(map[string]any)["native_created"] = 1001
			case "agent":
				value["agent"] = "other"
			case "missing-updated":
				delete(value, "updated")
			}
			bad, _ := json.Marshal(value)
			if _, err := validateCatalogSync(bad, local, "class", id); err == nil {
				t.Fatal("mismatched attestation accepted", mode)
			}
		})
	}
}
