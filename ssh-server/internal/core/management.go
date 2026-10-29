package core

import (
	"bytes"
	"crypto/ed25519"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"syscall"
	"time"
)

const managementPurpose = "ssh-exam-management/v1"

type ManagementResult struct {
	Request   string          `json:"request"`
	Operation string          `json:"operation"`
	Confirmed bool            `json:"confirmed"`
	Result    json.RawMessage `json:"result,omitempty"`
}

// Preserve authenticated refusal versus an unavailable/unverified outcome for
// CLI automation. Existing human-readable error text remains compatible.
type ManagementFailure struct {
	Code, Outcome, Retry, Message string
	Cause                         error
}

func (e *ManagementFailure) Error() string { return e.Message }
func (e *ManagementFailure) Unwrap() error { return e.Cause }

func ManagementID() string {
	s := []byte(Token()[:32])
	s[12], s[16] = '4', '8'
	return string(s[:8]) + "-" + string(s[8:12]) + "-" + string(s[12:16]) + "-" + string(s[16:20]) + "-" + string(s[20:])
}

func managementKey(path string) (ed25519.PrivateKey, error) {
	f, err := os.OpenFile(path, os.O_RDONLY|syscall.O_NOFOLLOW, 0)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Sys().(*syscall.Stat_t).Uid != 0 || info.Mode().Perm()&0077 != 0 || info.Size() > 16384 {
		return nil, errors.New("management requires the existing root-owned private agent key with no group/other access; do not copy or relax its permissions")
	}
	b, err := io.ReadAll(io.LimitReader(f, 16385))
	if err != nil || len(b) > 16384 {
		return nil, errors.New("agent management key could not be read within its limit")
	}
	defer func() {
		for i := range b {
			b[i] = 0
		}
	}()
	block, _ := pem.Decode(b)
	if block == nil {
		return nil, errors.New("invalid agent management key")
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		return nil, errors.New("invalid agent management key")
	}
	key, ok := parsed.(ed25519.PrivateKey)
	if !ok {
		return nil, errors.New("agent management requires the existing Ed25519 key")
	}
	return key, nil
}

// Gateway-owned management only: no native-state edits, student SSH credentials,
// browser cookie, separate token, redirects or arbitrary endpoint/command proxy.
func ManagementCall(c Config, operation string, body any, requestID string) (ManagementResult, error) {
	if requestID == "" {
		requestID = ManagementID()
	}
	result := ManagementResult{Request: requestID, Operation: operation}
	if os.Getuid() != 0 || os.Geteuid() != 0 {
		return result, errors.New("run examctl as root on the class server using its existing agent identity; browser administration keeps its normal login")
	}
	allowed := false
	switch operation {
	case "administrators.list", "administrators.show", "administrators.create":
		allowed = true
	case "templates.list", "templates.show", "templates.sync":
		allowed = true
	case "grants.list", "grants.show", "grants.revise", "grants.revoke":
		allowed = true
	case "grants.source-plan", "grants.source-confirm":
		allowed = true
	case "grants.issue-preview", "grants.issue-show", "grants.issue-confirm", "grants.issue-cancel":
		allowed = true
	case "grants.additional-preview":
		allowed = true
	case "exams.retire-preview", "exams.native-reconcile", "exams.delete", "exams.archive", "exams.unarchive":
		allowed = true
	case "exams.list", "exams.show", "exams.create", "exams.update", "students.list", "students.add", "students.remove", "students.settings", "students.import-preview", "students.import-confirm", "students.export", "students.example", "alerts.list", "alerts.show", "alerts.test", "alerts.remind", "attempts.list", "attempts.show", "clocks.show", "clocks.reset", "clocks.extend", "clocks.batch", "clocks.preview", "interruptions.show", "interruptions.review", "interruptions.authorize", "monitoring.show", "monitoring.list", "monitoring.replay", "monitoring.delete":
		allowed = true
	case "monitoring.purges", "monitoring.purge", "monitoring.image":
		allowed = true
	}
	if !attemptID.MatchString(requestID) || !allowed {
		return result, errors.New("invalid management request ID or unsupported operation; run examctl web help")
	}
	u, err := url.Parse(c.CallbackURL)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return result, errors.New("management requires the configured fixed HTTPS callback origin; no endpoint override is supported")
	}
	key, err := managementKey(c.CallbackKey)
	if err != nil {
		return result, err
	}
	defer func() {
		for i := range key {
			key[i] = 0
		}
	}()
	issued, nonce := Millis(), Token()
	payload, err := json.Marshal(map[string]any{"version": 1, "purpose": managementPurpose, "audience": strings.TrimSuffix(c.CallbackURL, "/"),
		"agent": c.AgentID, "actor": "agent-root", "request": requestID, "nonce": nonce, "issued": issued, "expires": issued + 30000, "operation": operation, "body": body})
	if err != nil || len(payload) > 12*1024*1024 {
		return result, errors.New("management request exceeds its encoding/size limit")
	}
	var bodyReader io.Reader = bytes.NewReader(payload)
	if operation == "administrators.create" {
		owned := &credentialRequestBody{data: payload}
		defer owned.Close()
		bodyReader = owned
	}
	e := &Engine{Config: c}
	client, err := e.callbackClient()
	if err != nil {
		return result, err
	}
	defer client.CloseIdleConnections()
	client.Timeout = 15 * time.Second
	req, err := http.NewRequest("POST", strings.TrimSuffix(c.CallbackURL, "/")+"/api/agent/management", bodyReader)
	if err != nil {
		return result, err
	}
	req.ContentLength = int64(len(payload))
	req.Header.Set("Content-Type", "application/vnd.ssh-exam-management")
	req.Header.Set("X-Exam-Signature", base64.StdEncoding.EncodeToString(ed25519.Sign(key, payload)))
	response, err := client.Do(req)
	if err != nil {
		return result, &ManagementFailure{Code: "transport", Outcome: "unknown", Retry: "same_request_or_receipt", Message: fmt.Sprintf("gateway reply unavailable; outcome not confirmed; retry with --request %s: %v", requestID, err), Cause: err}
	}
	defer response.Body.Close()
	b, err := io.ReadAll(io.LimitReader(response.Body, 16*1024*1024+1))
	if err != nil || len(b) > 16*1024*1024 || response.StatusCode != 200 {
		return result, fmt.Errorf("gateway returned an unavailable/unverified management reply (HTTP %d); inspect HTTPS connectivity, matching callback origin/agent identity, clock synchronization, pinned keys and managementOperations authorization; retry the same --request %s", response.StatusCode, requestID)
	}
	var frame SignedFrame
	if json.Unmarshal(b, &frame) != nil {
		return result, errors.New("malformed gateway management signature envelope; outcome not confirmed")
	}
	signed, payloadErr := base64.StdEncoding.DecodeString(frame.Payload)
	signature, signatureErr := base64.StdEncoding.DecodeString(frame.Signature)
	public, keyErr := publicKey(c.GatewayPublicKey)
	if payloadErr != nil || signatureErr != nil || keyErr != nil || !ed25519.Verify(public, signed, signature) {
		return result, errors.New("gateway management signature rejected; outcome not confirmed; retain the request ID for retry")
	}
	var reply struct {
		Version   int             `json:"version"`
		Purpose   string          `json:"purpose"`
		Audience  string          `json:"audience"`
		Request   string          `json:"request"`
		Nonce     string          `json:"nonce"`
		Operation string          `json:"operation"`
		At        int64           `json:"at"`
		OK        bool            `json:"ok"`
		Status    int             `json:"status"`
		Error     string          `json:"error"`
		Result    json.RawMessage `json:"result"`
	}
	if json.Unmarshal(signed, &reply) != nil || reply.Version != 1 || reply.Purpose != managementPurpose || reply.Audience != c.AgentID || reply.Request != requestID || reply.Nonce != nonce || reply.Operation != operation || reply.At < issued-1000 || reply.At > Millis()+1000 {
		return result, errors.New("gateway management reply scope/freshness rejected; outcome not confirmed")
	}
	if !reply.OK {
		if strings.HasPrefix(operation, "administrators.") {
			return result, fmt.Errorf("gateway refused administrator management (HTTP %d): %s; no change confirmed. Inspect examctl web administrators list/show, the named operation authorization and current intent; retry a creation with the original password and --request %s. Never overwrite/reset an existing account to reconcile a lost reply", reply.Status, administratorPublicRefusal(reply.Error), requestID)
		}
		return result, &ManagementFailure{Code: "gateway_refused", Outcome: "refused", Retry: "new_intent_after_review", Message: fmt.Sprintf("gateway refused management (%d): %s", reply.Status, reply.Error)}
	}
	if reply.Status != 200 || len(reply.Result) == 0 {
		return result, errors.New("incomplete gateway management result; outcome not confirmed")
	}
	result.Confirmed, result.Result = true, reply.Result
	return result, nil
}
