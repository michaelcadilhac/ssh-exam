package core

import (
	"bytes"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"sort"
	"strings"
	"sync"
	"testing"
)

// Runtime callers are the existing signed Begin/timing/cleanup/crash fixtures.
// It authors one exam-wide policy from their saved synthetic settings, without
// changing those settings or writing diagnostic state during the HTTP exchange.
func executionPolicyFixtureRoute(t *testing.T, e *Engine, native ed25519.PublicKey, gateway ed25519.PrivateKey) func(http.ResponseWriter, *http.Request) bool {
	t.Helper()
	agent, stateDir := e.Config.AgentID, e.Config.State
	var mu sync.Mutex
	policies := map[string]ExamExecutionPolicy{}
	return func(w http.ResponseWriter, r *http.Request) bool {
		if r.URL.Path != "/api/agent/exam-execution-policy" {
			return false
		}
		if r.Method != "POST" {
			t.Error("policy fixture received a non-POST request")
			w.WriteHeader(http.StatusMethodNotAllowed)
			return true
		}
		payload, err := io.ReadAll(io.LimitReader(r.Body, 65537))
		sig, sigErr := base64.StdEncoding.DecodeString(r.Header.Get("X-Exam-Signature"))
		if err != nil || len(payload) > 65536 || sigErr != nil || !ed25519.Verify(native, payload, sig) {
			t.Error("policy fixture request is not bounded and authenticated")
			w.WriteHeader(http.StatusForbidden)
			return true
		}
		var request struct {
			Agent string `json:"agent"`
			Exam  string `json:"exam"`
			Nonce string `json:"nonce"`
			At    int64  `json:"at"`
		}
		decoder := json.NewDecoder(bytes.NewReader(payload))
		decoder.DisallowUnknownFields()
		if decoder.Decode(&request) != nil || decoder.Decode(new(any)) != io.EOF || request.Agent != agent || !identifier.MatchString(request.Exam) || !monitoringDigest.MatchString(request.Nonce) || request.At < Millis()-30000 || request.At > Millis()+30000 {
			t.Error("policy fixture request has wrong scope or freshness")
			w.WriteHeader(http.StatusBadRequest)
			return true
		}
		state, err := readStateSnapshot(stateDir)
		if err != nil {
			t.Error("policy fixture cannot inspect authored state", err)
			w.WriteHeader(http.StatusServiceUnavailable)
			return true
		}
		ids := make([]string, 0, len(state.Attempts))
		for id := range state.Attempts {
			ids = append(ids, id)
		}
		sort.Strings(ids)
		var selected *Attempt
		for _, id := range ids {
			a := state.Attempts[id]
			if a.Exam == request.Exam && (selected == nil || (selected.State == "COMPLETED" && a.State != "COMPLETED")) {
				selected = a
			}
		}
		if selected == nil {
			t.Error("policy fixture has no authored exam", request.Exam)
			w.WriteHeader(http.StatusNotFound)
			return true
		}
		bounds, err := limitsForSettings(selected.Settings)
		if err != nil {
			t.Error("policy fixture has invalid authored bounds", err)
			w.WriteHeader(http.StatusInternalServerError)
			return true
		}
		terminals := selected.Settings.Terminals
		if terminals == 0 {
			terminals = 4 // The definition default absent from legacy snapshots.
		}
		policy := ExamExecutionPolicy{Schema: 1, Agent: agent, Exam: request.Exam, Instance: strings.Repeat("a", 32), Revision: 1, Terminals: terminals, CollectionFileMiB: bounds.File / mib, CollectionTotalMiB: bounds.Total / mib}
		mu.Lock()
		if previous, ok := policies[request.Exam]; ok {
			policy.Revision = previous.Revision
			if policy != previous {
				policy.Revision++
			}
		}
		policies[request.Exam] = policy
		mu.Unlock()
		if !validExecutionPolicy(policy, agent, request.Exam) {
			t.Error("policy fixture produced an invalid policy")
			w.WriteHeader(http.StatusInternalServerError)
			return true
		}
		signed, err := json.Marshal(map[string]any{"type": "exam-execution-policy", "audience": agent, "nonce": request.Nonce, "expires": Millis() + 30000, "policy": policy})
		if err != nil {
			t.Error(err)
			w.WriteHeader(http.StatusInternalServerError)
			return true
		}
		_ = json.NewEncoder(w).Encode(SignedFrame{Payload: base64.StdEncoding.EncodeToString(signed), Signature: base64.StdEncoding.EncodeToString(ed25519.Sign(gateway, signed))})
		return true
	}
}
