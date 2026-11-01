package main

import (
	"encoding/json"
	"examworkspace/agent/internal/core"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

const replacementPreviewID = "33333333-1234-4234-8234-123456789abc"
const replacementOldID = "44444444-1234-4234-8234-123456789abc"
const replacementNewID = "55555555-1234-4234-8234-123456789abc"

func replacementReviewFixture(body map[string]any, refs []any) map[string]any {
	return map[string]any{
		"id": replacementPreviewID, "kind": "NEW_ADDITIONAL_TEMPLATE_GRANTS", "agent": "class", "exam": "midterm", "actor": "agent:class:root", "reason": "Reviewed replacement of unused authority", "definition_revision": body["definition_revision"], "revision": strings.Repeat("c", 64), "created": core.Millis(), "expires": core.Millis() + 900000, "status": "REVIEW", "issued": []any{},
		"rows": []any{map[string]any{"username": "alice", "existing_grants": len(refs), "replaces": refs, "settings": map[string]any{"id": "midterm", "name": "Midterm", "template": "v1", "template_version": body["template_version"], "duration": body["duration"], "webcam": true, "terminals": 4, "earliest": body["earliest"], "latest": body["latest"]}, "work": grantWorkResult{Kind: "template", Name: "v1", Hash: strings.Repeat("b", 64)}, "hash": strings.Repeat("d", 64)}},
	}
}
func replacementPreviewArgs() []string {
	return []string{"grants", "additional-preview", "midterm", "alice", "--definition-revision", strings.Repeat("a", 64), "--template-version", strings.Repeat("b", 64), "--duration-minutes", "90", "--earliest", time.Now().Add(-time.Minute).Format(time.RFC3339), "--latest", time.Now().Add(time.Hour).Format(time.RFC3339), "--reason", "Reviewed replacement of unused authority"}
}
func replacementRefFixture() []any {
	return []any{map[string]any{"id": replacementOldID, "revision": 3, "hash": strings.Repeat("e", 64)}}
}

func TestGrantReplacementActualCLIReviewAndConfirmationFields(t *testing.T) {
	var mu sync.Mutex
	var previewBody map[string]any
	confirmations := 0
	f := newScriptCLIFixture(t, func(request map[string]any) (any, string, bool) {
		mu.Lock()
		defer mu.Unlock()
		body := request["body"].(map[string]any)
		if request["operation"] == "grants.additional-preview" {
			previewBody = body
			return replacementReviewFixture(body, replacementRefFixture()), "", false
		}
		if request["operation"] != "grants.issue-confirm" || body["replacement_policy"] != "single-unused-v1" {
			t.Error("missing scoped replacement confirmation", request)
			return nil, "replacement confirmation refused", false
		}
		confirmations++
		result := replacementReviewFixture(previewBody, replacementRefFixture())
		result["status"] = "CONFIRMED"
		result["issued"] = []any{map[string]any{"username": "alice", "grant": replacementNewID, "replaced": replacementRefFixture()}}
		return result, "", false
	})
	review := filepath.Join(f.dir, "replacement-review.receipt")
	args := append(replacementPreviewArgs(), "--receipt", review, "--format", "tsv", "--fields", "username,replacement_count,replacement_refs", "--no-header")
	if out, stderr, code := f.invoke(args...); code != 0 || out != "alice\t1\t"+replacementOldID+"@3\n" {
		t.Fatal(code, out, stderr)
	}
	args = []string{"grants", "issue-confirm", "--from-receipt", review, "--format", "tsv", "--fields", "username,grant,replaced_count,replaced_refs", "--no-header"}
	if out, stderr, code := f.invoke(args...); code != 0 || out != "alice\t"+replacementNewID+"\t1\t"+replacementOldID+"@3\n" {
		t.Fatal(code, out, stderr)
	}
	mu.Lock()
	defer mu.Unlock()
	if confirmations != 1 {
		t.Fatal("unexpected confirmations", confirmations)
	}
}

func TestGrantReplacementActualCLIRefusesOldGatewayBeforeMutation(t *testing.T) {
	var mu sync.Mutex
	mutations := 0
	f := newScriptCLIFixture(t, func(request map[string]any) (any, string, bool) {
		mu.Lock()
		defer mu.Unlock()
		body := request["body"].(map[string]any)
		if _, present := body["replacement_policy"]; present {
			return nil, "old strict gateway refuses replacement_policy before mutation", false
		}
		mutations++
		return nil, "unsafe old gateway would have issued additional authority", false
	})
	out, stderr, code := f.invoke("grants", "issue-confirm", replacementPreviewID, "--revision", strings.Repeat("c", 64))
	if code != 1 || out != "" || !strings.Contains(stderr, "old strict gateway refuses") {
		t.Fatal(code, out, stderr)
	}
	mu.Lock()
	defer mu.Unlock()
	if mutations != 0 {
		t.Fatal("old gateway was allowed to mutate", mutations)
	}
}

func TestGrantReplacementActualCLIRefusesMalformedReferenceWithoutPrivateOutput(t *testing.T) {
	f := newScriptCLIFixture(t, func(request map[string]any) (any, string, bool) {
		result := replacementReviewFixture(request["body"].(map[string]any), []any{map[string]any{"id": "private-untrusted-reference", "revision": 3, "hash": strings.Repeat("e", 64)}})
		return result, "", false
	})
	args := append(replacementPreviewArgs(), "--format", "tsv", "--fields", "username,replacement_count,replacement_refs")
	out, stderr, code := f.invoke(args...)
	if code != 1 || out != "" || !strings.Contains(stderr, "Unconfirmed issuance reply scope/schema") || strings.Contains(stderr, "private-untrusted-reference") {
		t.Fatal(code, out, stderr)
	}
}

func TestGrantReplacementRejectsMalformedReferencesAndUnmatchedReceipts(t *testing.T) {
	body := map[string]any{"exam": "midterm", "usernames": []string{"alice"}, "definition_revision": strings.Repeat("a", 64), "template_version": strings.Repeat("b", 64), "duration": 5400, "earliest": 100, "latest": 200}
	valid := replacementReviewFixture(body, replacementRefFixture())
	raw, _ := json.Marshal(valid)
	if err := validateGrantIssuanceResult("grants.additional-preview", body, raw, "class"); err != nil {
		t.Fatal(err)
	}
	for _, kind := range []string{"missing", "bad-id", "zero-revision", "bad-hash", "duplicate", "wrong-count", "mismatched-receipt"} {
		t.Run(kind, func(t *testing.T) {
			var value map[string]any
			json.Unmarshal(raw, &value)
			row := value["rows"].([]any)[0].(map[string]any)
			refs := row["replaces"].([]any)
			ref := refs[0].(map[string]any)
			op, scope := "grants.additional-preview", body
			switch kind {
			case "missing":
				delete(row, "replaces")
			case "bad-id":
				ref["id"] = "private-untrusted-reference"
			case "zero-revision":
				ref["revision"] = 0
			case "bad-hash":
				ref["hash"] = "UPPERCASE-PRIVATE-HASH"
			case "duplicate":
				row["replaces"] = []any{ref, ref}
				row["existing_grants"] = 2
			case "wrong-count":
				row["existing_grants"] = 0
			case "mismatched-receipt":
				value["status"] = "CONFIRMED"
				value["issued"] = []any{map[string]any{"username": "alice", "grant": replacementNewID, "replaced": []any{map[string]any{"id": replacementOldID, "revision": 4, "hash": strings.Repeat("e", 64)}}}}
				op = "grants.issue-confirm"
				scope = map[string]any{"id": replacementPreviewID, "revision": strings.Repeat("c", 64)}
			}
			encoded, _ := json.Marshal(value)
			if err := validateGrantIssuanceResult(op, scope, encoded, "class"); err == nil {
				t.Fatal("unconfirmed replacement proof accepted", kind)
			}
		})
	}
}

func TestGrantReplacementLegacyConfirmedReceiptPreservesOriginalBody(t *testing.T) {
	f := newScriptCLIFixture(t, func(map[string]any) (any, string, bool) {
		t.Error("confirmed legacy receipt unexpectedly contacted gateway")
		return nil, "unexpected", false
	})
	data, err := os.ReadFile(f.config)
	if err != nil {
		t.Fatal(err)
	}
	var c core.Config
	if json.Unmarshal(data, &c) != nil {
		t.Fatal("bad fixture config")
	}
	body := map[string]any{"id": replacementPreviewID, "revision": strings.Repeat("c", 64)}
	receipt, err := newScriptReceipt(c, "grants.issue-confirm", "", body)
	if err != nil {
		t.Fatal(err)
	}
	result := replacementReviewFixture(map[string]any{"definition_revision": strings.Repeat("a", 64), "template_version": strings.Repeat("b", 64), "duration": 5400, "earliest": 100, "latest": 200}, nil)
	result["status"] = "CONFIRMED"
	delete(result["rows"].([]any)[0].(map[string]any), "replaces")
	result["issued"] = []any{map[string]any{"username": "alice", "grant": replacementNewID}}
	raw, _ := json.Marshal(result)
	receipt.Outcome = "confirmed"
	receipt.Result = core.ManagementResult{Request: receipt.Request, Operation: receipt.Operation, Confirmed: true, Result: raw}
	path := filepath.Join(f.dir, "legacy-confirmed.receipt")
	if err := saveScriptReceipt(path, receipt, false); err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(path)
	out, stderr, code := f.invoke("grants", "issue-confirm", replacementPreviewID, "--revision", strings.Repeat("c", 64), "--receipt", path, "--resume", "--format", "tsv", "--fields", "username,grant,replaced_count,replaced_refs", "--no-header")
	if code != 0 || out != "alice\t"+replacementNewID+"\t\t\n" {
		t.Fatal(code, out, stderr)
	}
	after, _ := os.ReadFile(path)
	if string(before) != string(after) {
		t.Fatal("legacy confirmed receipt changed")
	}
}

func TestGrantReplacementLegacyUnknownResumeRequiresConfirmedRead(t *testing.T) {
	for _, status := range []string{"REVIEW", "CONFIRMED"} {
		t.Run(status, func(t *testing.T) {
			var mu sync.Mutex
			shows, confirmations := 0, 0
			var originalRequest string
			result := replacementReviewFixture(map[string]any{"definition_revision": strings.Repeat("a", 64), "template_version": strings.Repeat("b", 64), "duration": 5400, "earliest": 100, "latest": 200}, nil)
			delete(result["rows"].([]any)[0].(map[string]any), "replaces")
			result["status"] = status
			if status == "CONFIRMED" {
				result["issued"] = []any{map[string]any{"username": "alice", "grant": replacementNewID}}
			}
			f := newScriptCLIFixture(t, func(request map[string]any) (any, string, bool) {
				mu.Lock()
				defer mu.Unlock()
				body := request["body"].(map[string]any)
				if request["operation"] == "grants.issue-show" {
					shows++
					if body["id"] != replacementPreviewID || request["request"] == originalRequest {
						t.Error("inspection must use the original review and a fresh read request", request)
					}
					return result, "", false
				}
				confirmations++
				if request["operation"] != "grants.issue-confirm" || request["request"] != originalRequest || len(body) != 2 || body["id"] != replacementPreviewID || body["revision"] != strings.Repeat("c", 64) {
					t.Error("legacy retry changed its exact intent", request)
				}
				return result, "", false
			})
			data, err := os.ReadFile(f.config)
			if err != nil {
				t.Fatal(err)
			}
			var c core.Config
			if json.Unmarshal(data, &c) != nil {
				t.Fatal("bad fixture config")
			}
			receipt, err := newScriptReceipt(c, "grants.issue-confirm", "", map[string]any{"id": replacementPreviewID, "revision": strings.Repeat("c", 64)})
			if err != nil {
				t.Fatal(err)
			}
			originalRequest = receipt.Request
			receipt.Outcome = "unknown"
			path := filepath.Join(f.dir, "legacy-unknown.receipt")
			if err := saveScriptReceipt(path, receipt, false); err != nil {
				t.Fatal(err)
			}
			before, _ := os.ReadFile(path)
			out, stderr, code := f.invoke("grants", "issue-confirm", replacementPreviewID, "--revision", strings.Repeat("c", 64), "--receipt", path, "--resume", "--format", "tsv", "--fields", "username,grant", "--no-header")
			mu.Lock()
			defer mu.Unlock()
			if shows != 1 {
				t.Fatal("legacy unknown retry skipped authenticated inspection", shows)
			}
			if status == "REVIEW" {
				if code != 1 || out != "" || !strings.Contains(stderr, "no confirmation sent") || confirmations != 0 {
					t.Fatal(code, out, stderr, confirmations)
				}
				after, _ := os.ReadFile(path)
				if string(before) != string(after) {
					t.Fatal("uncommitted legacy receipt changed")
				}
			} else if code != 0 || out != "alice\t"+replacementNewID+"\n" || confirmations != 1 {
				t.Fatal(code, out, stderr, confirmations)
			}
		})
	}
}

func TestGrantReplacementLegacyPreviewReceiptRemainsInspectable(t *testing.T) {
	f := newScriptCLIFixture(t, func(map[string]any) (any, string, bool) {
		t.Error("saved preview inspection unexpectedly contacted gateway")
		return nil, "unexpected", false
	})
	data, err := os.ReadFile(f.config)
	if err != nil {
		t.Fatal(err)
	}
	var c core.Config
	if json.Unmarshal(data, &c) != nil {
		t.Fatal("bad fixture config")
	}
	body := map[string]any{"exam": "midterm", "usernames": []string{"alice"}, "definition_revision": strings.Repeat("a", 64), "template_version": strings.Repeat("b", 64), "duration": 5400, "earliest": 100, "latest": 200}
	receipt, err := newScriptReceipt(c, "grants.additional-preview", "", body)
	if err != nil {
		t.Fatal(err)
	}
	result := replacementReviewFixture(body, nil)
	delete(result["rows"].([]any)[0].(map[string]any), "replaces")
	raw, _ := json.Marshal(result)
	receipt.Outcome = "confirmed"
	receipt.Result = core.ManagementResult{Request: receipt.Request, Operation: receipt.Operation, Confirmed: true, Result: raw}
	path := filepath.Join(f.dir, "legacy-preview.receipt")
	if err := saveScriptReceipt(path, receipt, false); err != nil {
		t.Fatal(err)
	}
	out, stderr, code := f.invoke("grants", "additional-preview", "--from-receipt", path, "--resume", "--format", "tsv", "--fields", "username,replacement_count,replacement_refs", "--no-header")
	if code != 0 || out != "alice\t\t\n" {
		t.Fatal(code, out, stderr)
	}
}
