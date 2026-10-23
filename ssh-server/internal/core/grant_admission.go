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
	"time"
)

type GrantWork struct {
	Kind string `json:"kind"`
	Name string `json:"name,omitempty"`
	Hash string `json:"hash,omitempty"`
}

func validGrantWork(w *GrantWork) bool {
	return w != nil && ((w.Kind == "empty" && w.Name == "" && w.Hash == "") || (w.Kind == "template" && identifier.MatchString(w.Name) && templateDigest.MatchString(w.Hash)))
}

type GrantBinding struct {
	ID       string     `json:"id"`
	Revision int64      `json:"revision"`
	Hash     string     `json:"hash"`
	Kind     string     `json:"kind,omitempty"`
	Order    int64      `json:"issuance_order,omitempty"`
	Initial  string     `json:"initial_grant,omitempty"`
	Work     *GrantWork `json:"work,omitempty"`
}

func validGrant(g *GrantBinding) bool {
	if g == nil || !attemptID.MatchString(g.ID) || g.Revision < 1 || g.Revision > 9007199254740991 || len(g.Hash) != 64 {
		return false
	}
	if (g.Kind != "" && g.Kind != "ADDITIONAL" && g.Kind != "PRACTICE") || g.Order < 0 || g.Order > 9007199254740991 || (g.Kind != "" && g.Order == 0) {
		return false
	}
	if g.Initial != "" && (g.Kind != "ADDITIONAL" || !attemptID.MatchString(g.Initial) || g.Initial == g.ID) {
		return false
	}
	if g.Work != nil && !validGrantWork(g.Work) {
		return false
	}
	for _, c := range g.Hash {
		if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f') {
			return false
		}
	}
	return true
}
func sameGrant(a, b *GrantBinding) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	aa, bb := *a, *b
	aa.Work, bb.Work = nil, nil
	return aa == bb && ((a.Work == nil && b.Work == nil) || (a.Work != nil && b.Work != nil && *a.Work == *b.Work))
}
func grantBeginSettings(a *Attempt, r Request, grant bool) error {
	if grant {
		if a == nil || !validGrant(a.Grant) || !sameGrant(a.Grant, r.Grant) || a.Settings != r.Settings || !attemptID.MatchString(r.GrantBeginIntent) || (a.Start > 0 && a.GrantBeginIntent != r.GrantBeginIntent) {
			return errors.New("grant/revision/settings or original Begin intent mismatch; inspect the existing grant preparation; no new clock requested")
		}
	} else if r.Grant != nil || r.GrantBeginIntent != "" || (a != nil && a.Grant != nil) {
		return errors.New("grant preparation requires the distinct grant-aware Begin purpose and fresh outbound verification; update matching roles")
	}
	return nil
}

type grantBeginReply struct {
	Type      string        `json:"type"`
	Audience  string        `json:"audience"`
	Nonce     string        `json:"nonce"`
	Expires   int64         `json:"expires"`
	Attempt   string        `json:"attempt"`
	Grant     *GrantBinding `json:"grant"`
	Intent    string        `json:"intent"`
	Transport string        `json:"transport"`
	Boot      string        `json:"boot"`
}

// Runtime Begin only. Existing pinned outbound HTTPS + Ed25519 identities;
// never a browser relay/offline permit. No state lock is held through network IO.
func (e *Engine) verifyGrantBegin(a *Attempt, intent string) (int64, error) {
	if !validGrant(a.Grant) || !attemptID.MatchString(intent) || e.Config.CallbackURL == "" {
		return 0, errors.New("fresh authenticated outbound grant verification required; configure the fixed gateway route and retry the SAME Begin intent; no interval committed")
	}
	client, err := e.callbackClient()
	if err != nil {
		return 0, err
	}
	defer client.CloseIdleConnections()
	client.Timeout = 5 * time.Second
	key, err := privateKey(e.Config.CallbackKey)
	if err != nil {
		return 0, err
	}
	defer func() {
		for i := range key {
			key[i] = 0
		}
	}()
	nonce, ownerBoot := Token(), boot()
	payload, err := json.Marshal(map[string]any{"type": "grant-begin/v1", "agent": e.Config.AgentID, "nonce": nonce, "at": Millis(), "attempt": a.ID, "exam": a.Exam, "username": a.Username, "uid": a.UID, "grant": a.Grant, "intent": intent, "transport": a.Transport, "boot": ownerBoot, "settings": a.Settings})
	if err != nil {
		return 0, err
	}
	request, err := http.NewRequest("POST", strings.TrimSuffix(e.Config.CallbackURL, "/")+"/api/agent/grant-begin", bytes.NewReader(payload))
	if err != nil {
		return 0, err
	}
	request.Header.Set("Content-Type", "application/vnd.ssh-exam-event")
	request.Header.Set("X-Exam-Signature", base64.StdEncoding.EncodeToString(ed25519.Sign(key, payload)))
	response, err := client.Do(request)
	if err != nil {
		return 0, fmt.Errorf("fresh grant verification unavailable; inspect original attempt/intent and retry without resetting time: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return 0, fmt.Errorf("fresh grant verification refused (HTTP %d); inspect examctl web grants show %s and examctl info %s --read-only; no interval committed by this request", response.StatusCode, a.Grant.ID, a.ID)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, 65537))
	if err != nil || len(body) > 65536 {
		return 0, errors.New("invalid grant Begin reply size")
	}
	var frame SignedFrame
	if json.Unmarshal(body, &frame) != nil {
		return 0, errors.New("invalid signed grant Begin reply")
	}
	signed, err := base64.StdEncoding.DecodeString(frame.Payload)
	if err != nil {
		return 0, err
	}
	signature, err := base64.StdEncoding.DecodeString(frame.Signature)
	if err != nil {
		return 0, err
	}
	pub, err := publicKey(e.Config.GatewayPublicKey)
	if err != nil {
		return 0, err
	}
	if !ed25519.Verify(pub, signed, signature) || !validReadOnlyJSON(signed) {
		return 0, errors.New("grant Begin reply signature/encoding rejected")
	}
	var reply grantBeginReply
	decoder := json.NewDecoder(bytes.NewReader(signed))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&reply) != nil || decoder.Decode(new(any)) != io.EOF || reply.Type != "grant-begin/v1" || reply.Audience != e.Config.AgentID || reply.Nonce != nonce || reply.Expires <= Millis() || reply.Expires > Millis()+31000 || reply.Attempt != a.ID || !sameGrant(reply.Grant, a.Grant) || reply.Intent != intent || reply.Transport != a.Transport || reply.Boot != ownerBoot {
		return 0, errors.New("fresh grant Begin reply scope/freshness rejected; preserve original intent and inspect status")
	}
	return reply.Expires, nil
}
