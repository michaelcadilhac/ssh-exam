package main

import (
	"encoding/json"
	"os"
	"strings"
	"sync"
	"testing"
)

func optimizationFixture(status string) map[string]any {
	return map[string]any{"status": status, "eligible": true, "frames": 12, "converted_frames": 6, "remaining_frames": 6, "segments": 1, "source_bytes": 500000, "video_bytes": 20000, "verified_at": nil, "error": nil}
}

func optimizationAccepted(output string) bool {
	var result struct {
		Result struct {
			Accepted bool `json:"accepted"`
		} `json:"result"`
	}
	return json.Unmarshal([]byte(output), &result) == nil && result.Result.Accepted
}

func TestMonitoringOptimizationHelpSyntaxAndProjection(t *testing.T) {
	output, code := cliProcess(t, "web", "monitoring", "help")
	for _, required := range []string{"optimize ATTEMPT", "optimize-retry ATTEMPT", "optimize-cancel ATTEMPT", "monitoring.optimize", "--intent", "converted subset", "paused", "capture_sha256", "derived JPEG"} {
		if code != 0 || !strings.Contains(output, required) {
			t.Fatalf("missing %q: %d %s", required, code, output)
		}
	}
	for _, args := range [][]string{
		{"web", "monitoring", "optimize"},
		{"web", "monitoring", "optimize", "a", "--output", "private"},
		{"web", "monitoring", "optimize-retry", "a", "--reason", "not this workflow"},
		{"web", "monitoring", "optimize-cancel", "a", "--intent", "not-a-uuid"},
		{"web", "monitoring", "optimize", "a", "--limit", "1"},
	} {
		output, code := cliProcess(t, args...)
		if code != 2 || !strings.Contains(output, "monitoring help") || strings.Contains(output, "Load root") {
			t.Fatal(code, output)
		}
	}
	if os.Getuid() != 0 {
		output, code := cliProcess(t, "web", "monitoring", "optimize", "a", "--config", "/missing")
		if code != 1 || !strings.Contains(output, "root on the class server") {
			t.Fatal(code, output)
		}
	}
	good := map[string]any{"id": "a", "current": map[string]any{"id": "a"}, "capabilities": []string{"monitoring-optimization-v1"}, "optimization": optimizationFixture("pending")}
	raw, _ := json.Marshal(good)
	if err := validateMonitoringResult("monitoring.show", map[string]any{"id": "a"}, raw); err != nil {
		t.Fatal(err)
	}
	for name, mutate := range map[string]func(map[string]any){
		"status":      func(value map[string]any) { value["status"] = "unknown" },
		"missing":     func(value map[string]any) { delete(value, "video_bytes") },
		"negative":    func(value map[string]any) { value["source_bytes"] = -1 },
		"counts":      func(value map[string]any) { value["remaining_frames"] = 7 },
		"unsafe-size": func(value map[string]any) { value["video_bytes"] = 9007199254740992 },
		"error":       func(value map[string]any) { value["error"] = strings.Repeat("x", 81) },
		"private":     func(value map[string]any) { value["path"] = "/private" },
	} {
		value := optimizationFixture("pending")
		mutate(value)
		good["optimization"] = value
		raw, _ := json.Marshal(good)
		if validateMonitoringResult("monitoring.show", map[string]any{"id": "a"}, raw) == nil {
			t.Fatal("accepted invalid projection", name)
		}
	}
	for _, action := range []string{"request", "retry", "cancel"} {
		body := map[string]any{"id": "a", "action": action, "requestID": "11111111-1111-4111-8111-111111111111"}
		value := map[string]any{"id": "a", "action": action, "accepted": true}
		raw, _ := json.Marshal(value)
		if err := validateMonitoringResult("monitoring.optimize", body, raw); err != nil {
			t.Fatal(err)
		}
		value["action"] = "wrong"
		raw, _ = json.Marshal(value)
		if validateMonitoringResult("monitoring.optimize", body, raw) == nil {
			t.Fatal("accepted another action")
		}
	}
}

func TestMonitoringOptimizationActualSignedCLIIntentRetryCancelAndLegacyRefusal(t *testing.T) {
	var mu sync.Mutex
	mode := "current"
	status := "paused"
	accepted := map[string]string{}
	mutations, attempts := 0, 0
	drop := true
	f := newScriptCLIFixture(t, func(request map[string]any) (any, string, bool) {
		mu.Lock()
		defer mu.Unlock()
		body := request["body"].(map[string]any)
		if body["id"] != "a" {
			t.Error("wrong target", body)
		}
		if request["operation"] == "monitoring.show" {
			value := map[string]any{"id": "a", "current": map[string]any{"id": "a"}}
			if mode != "legacy" {
				value["capabilities"] = []string{"monitoring-optimization-v1"}
				value["optimization"] = optimizationFixture(status)
			}
			if mode == "wrong-show" {
				value["id"] = "another-attempt"
			}
			return value, "", false
		}
		if request["operation"] != "monitoring.optimize" {
			t.Error("unsupported operation", request["operation"])
			return nil, "unsupported", false
		}
		attempts++
		intent, action := body["requestID"].(string), body["action"].(string)
		if prior, exists := accepted[intent]; exists {
			if prior != action {
				return nil, "child intent conflicts", false
			}
		} else {
			accepted[intent] = action
			mutations++
			if action == "cancel" {
				status = "paused"
			} else {
				status = "pending"
			}
		}
		if drop {
			drop = false
			return nil, "", true
		}
		return map[string]any{"id": "a", "action": action, "accepted": true}, "", false
	})
	parent, intent := "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"
	_, stderr, code := f.invoke("monitoring", "optimize", "a", "--request", parent, "--intent", intent)
	if code != 1 || !strings.Contains(stderr, parent) || !strings.Contains(stderr, intent) {
		t.Fatal("lost response was not retryable", code, stderr)
	}
	for range 2 {
		output, stderr, code := f.invoke("monitoring", "optimize", "a", "--request", parent, "--intent", intent)
		if code != 0 || !optimizationAccepted(output) {
			t.Fatal(code, output, stderr)
		}
	}
	mu.Lock()
	if mutations != 1 || attempts != 3 {
		t.Fatal("lost response requeued conversion", mutations, attempts)
	}
	mode = "legacy"
	before := attempts
	mu.Unlock()
	output, stderr, code := f.invoke("monitoring", "optimize-retry", "a")
	if code != 1 || output != "" || !strings.Contains(stderr, "optimization support") {
		t.Fatal("old gateway accepted mutation", code, output, stderr)
	}
	mu.Lock()
	if attempts != before {
		t.Fatal("mutated without capability")
	}
	mode = "wrong-show"
	mu.Unlock()
	output, stderr, code = f.invoke("monitoring", "optimize-cancel", "a")
	if code != 1 || output != "" {
		t.Fatal("accepted wrong-target fresh precheck", code, output, stderr)
	}
	mu.Lock()
	if attempts != before {
		t.Fatal("mutated after wrong-scope precheck")
	}
	mode = "current"
	mu.Unlock()
	for _, action := range []string{"optimize-retry", "optimize-cancel"} {
		output, stderr, code := f.invoke("monitoring", action, "a")
		if code != 0 || !optimizationAccepted(output) {
			t.Fatal(code, output, stderr)
		}
	}
	mu.Lock()
	defer mu.Unlock()
	if status != "paused" || mutations != 3 {
		t.Fatal("retry/cancel workflow lost", status, mutations)
	}
}
