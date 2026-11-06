package core

import (
	"bytes"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
)

type clockDispatchReply struct {
	Type     string    `json:"type"`
	Audience string    `json:"audience"`
	Nonce    string    `json:"nonce"`
	Expires  int64     `json:"expires"`
	After    string    `json:"after"`
	Requests []Request `json:"requests"`
}

// Deliver already-authorized clock intents without waiting for student SSH or
// the old deadline. One bounded outbound exchange per second while an attempt
// is unfinished; no listener, generic remote commands or restored live permits.
// Network waits never hold authoritative state or the independent cutoff lock.
func (e *Engine) RefreshClockChanges() error {
	if e.Config.CallbackURL == "" {
		return nil
	}
	e.clockDispatchMu.Lock()
	defer e.clockDispatchMu.Unlock()
	snapshot, err := readStateSnapshot(e.Config.State)
	if err != nil {
		return err
	}
	unfinished := false
	for _, a := range snapshot.Attempts {
		if a.Start > 0 && !a.Protected && (a.State == "ACTIVE" || a.State == "LOCKED" || a.State == "EXPIRED") {
			unfinished = true
			break
		}
	}
	if !unfinished {
		e.clockDispatchAfter = ""
		return nil
	}
	client, err := e.callbackClient()
	if err != nil {
		return err
	}
	defer client.CloseIdleConnections()
	key, err := privateKey(e.Config.CallbackKey)
	if err != nil {
		return err
	}
	defer clear(key)
	nonce := Token()
	payload, err := json.Marshal(map[string]any{"agent": e.Config.AgentID, "nonce": nonce, "at": Millis(), "after": e.clockDispatchAfter})
	if err != nil {
		return err
	}
	request, err := http.NewRequest("POST", strings.TrimSuffix(e.Config.CallbackURL, "/")+"/api/agent/clock-changes", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/vnd.ssh-exam-event")
	request.Header.Set("X-Exam-Signature", base64.StdEncoding.EncodeToString(ed25519.Sign(key, payload)))
	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("clock delivery rejected: HTTP %d", response.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, 262145))
	if err != nil || len(body) > 262144 {
		return errors.New("clock delivery reply exceeds its bound")
	}
	var frame SignedFrame
	if err := json.Unmarshal(body, &frame); err != nil {
		return err
	}
	signed, decodeErr := base64.StdEncoding.DecodeString(frame.Payload)
	signature, signatureErr := base64.StdEncoding.DecodeString(frame.Signature)
	pub, keyErr := publicKey(e.Config.GatewayPublicKey)
	if decodeErr != nil || signatureErr != nil || keyErr != nil || !ed25519.Verify(pub, signed, signature) {
		return errors.New("clock delivery signature rejected")
	}
	var reply clockDispatchReply
	decoder := json.NewDecoder(bytes.NewReader(signed))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&reply) != nil || decoder.Decode(new(any)) != io.EOF || reply.Type != "clock-changes/v1" || reply.Audience != e.Config.AgentID || reply.Nonce != nonce || reply.Expires <= Millis() || reply.Expires > Millis()+operationTimeoutMS+1000 || len(reply.Requests) > 100 || (reply.After != "" && !attemptID.MatchString(reply.After)) {
		return errors.New("clock delivery freshness or scope rejected")
	}
	// Validate the whole wire batch before any mutation. WithState saves even
	// when its callback returns an error; it is not a rollback transaction.
	seen := map[string]bool{}
	for _, r := range reply.Requests {
		if !attemptID.MatchString(r.ID) || !attemptID.MatchString(r.ResetID) || seen[r.ResetID] || len(strings.TrimSpace(r.Actor)) == 0 || len(r.Actor) > 128 || !validClockAdjustment(r) {
			return errors.New("invalid clock delivery batch; no intent applied")
		}
		seen[r.ResetID] = true
	}
	var failures []error
	for _, r := range reply.Requests {
		if err := e.WithState(func() error {
			a, err := e.Find(r.ID)
			if err != nil {
				return err
			}
			return e.resetClock(a, r, true)
		}); err != nil {
			failures = append(failures, fmt.Errorf("clock intent %s remains pending: %w", r.ResetID, err))
		}
	}
	e.clockDispatchAfter = reply.After
	return errors.Join(failures...)
}
