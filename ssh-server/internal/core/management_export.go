package core

// Purpose-bound read transport only. No Engine, native lease/state, student SSH
// credential, access transition or generic endpoint proxy is created here.

import (
	"bufio"
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

const (
	MonitoringExportPurpose           = "ssh-exam-monitoring-export/v1"
	MonitoringExportContentType       = "application/vnd.ssh-exam-monitoring-export+ndjson"
	MonitoringExportChunkSize         = 256 * 1024
	MonitoringExportMaxPayload        = 4 * 1024 * 1024
	MonitoringExportMaxLine           = 8 * 1024 * 1024
	MonitoringExportSafeInteger int64 = 9007199254740991
)

var errMonitoringExport = errors.New("monitoring export signature/scope/sequence/format or completion rejected; private output remains incomplete; inspect fresh monitoring metadata and matching gateway/CLI versions")

// Also rejects duplicate keys, invalid UTF-8 and excessive nesting. Nullable
// metadata is permitted; the event-specific reader checks its semantic fields.
func DecodeMonitoringExportObject(raw []byte, out any, keys []string) error {
	return decodeExportObject(raw, out, keys, MonitoringExportMaxPayload)
}
func decodeExportObject(raw []byte, out any, keys []string, limit int) error {
	if len(raw) > limit || !utf8.Valid(raw) || !validReadOnlyJSON(raw) {
		return errMonitoringExport
	}
	var fields map[string]json.RawMessage
	if json.Unmarshal(raw, &fields) != nil || fields == nil || len(fields) != len(keys) {
		return errMonitoringExport
	}
	for _, key := range keys {
		if fields[key] == nil {
			return errMonitoringExport
		}
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if decoder.Decode(out) != nil || decoder.Decode(new(any)) != io.EOF {
		return errMonitoringExport
	}
	return nil
}

type exportWireScope struct {
	agent, request, nonce, id string
	issued                    int64
}
type exportWirePacket struct {
	Version  int             `json:"version"`
	Purpose  string          `json:"purpose"`
	Audience string          `json:"audience"`
	Request  string          `json:"request"`
	Nonce    string          `json:"nonce"`
	ID       string          `json:"id"`
	Sequence uint64          `json:"sequence"`
	At       int64           `json:"at"`
	Event    json.RawMessage `json:"event"`
}

// Timeout ownership is fenced before and after EACH blocking network read. A
// late timer from a previous wait cannot cancel a healthy later read or local
// file write/sync. This timeout is not a student authorization/heartbeat budget.
type exportReadBudget struct {
	mu      sync.Mutex
	serial  uint64
	cancel  context.CancelFunc
	expired bool
}

func (b *exportReadBudget) begin(duration time.Duration) func() {
	b.mu.Lock()
	if b.expired {
		b.mu.Unlock()
		return func() {}
	}
	b.serial++
	serial := b.serial
	until := time.Now().Add(duration)
	b.mu.Unlock()
	timer := time.AfterFunc(duration, func() {
		b.mu.Lock()
		expired := b.serial == serial && !time.Now().Before(until)
		if expired {
			b.serial++
			b.expired = true
		}
		b.mu.Unlock()
		if expired {
			b.cancel()
		}
	})
	return func() {
		b.mu.Lock()
		if b.serial == serial {
			b.serial++
		}
		b.mu.Unlock()
		timer.Stop()
	}
}

func (b *exportReadBudget) failed() bool { b.mu.Lock(); defer b.mu.Unlock(); return b.expired }

func knownMonitoringExportCode(code string) bool {
	switch code {
	case "attempt-not-found", "inventory-unavailable", "receipt-scope-rejected", "receipt-watermark-rejected", "previous-cleanup-unconfirmed", "busy", "canceled", "metadata-record-too-large", "inventory-changed", "invalid-metadata-identity", "invalid-pane-identity", "source-changed", "size-bound", "deleted", "storage-or-protocol", "cleanup",
		"media-capacity", "media-unsafe-path", "media-unsafe-directory", "media-not-regular", "media-linked", "media-size", "media-changed", "media-digest", "media-cleanup", "media-storage":
		return true
	}
	return false
}

func scanExportLine(data []byte, atEOF bool) (advance int, token []byte, err error) {
	if end := bytes.IndexByte(data, '\n'); end >= 0 {
		return end + 1, data[:end], nil
	}
	if atEOF && len(data) > 0 {
		return 0, nil, errMonitoringExport
	}
	return 0, nil, nil
}

type exportProgressReader struct {
	reader io.Reader
	budget *exportReadBudget
	idle   time.Duration
}

func (r *exportProgressReader) Read(buffer []byte) (int, error) {
	stop := r.budget.begin(r.idle)
	n, err := r.reader.Read(buffer)
	stop()
	if r.budget.failed() {
		return 0, errMonitoringExport
	}
	return n, err
}

func readMonitoringExport(reader io.Reader, public ed25519.PublicKey, scope exportWireScope, consume func(json.RawMessage) error, budget *exportReadBudget, idle time.Duration) error {
	if budget != nil {
		reader = &exportProgressReader{reader: reader, budget: budget, idle: idle}
	}
	scanner := bufio.NewScanner(reader)
	scanner.Buffer(make([]byte, 64*1024), MonitoringExportMaxLine+1)
	scanner.Split(scanExportLine)
	var sequence uint64
	begun, ended := false, false
	for {
		more := scanner.Scan()
		if budget != nil && budget.failed() {
			return errMonitoringExport
		}
		if !more {
			break
		}
		if ended {
			return errMonitoringExport
		}
		var envelope SignedFrame
		if decodeExportObject(scanner.Bytes(), &envelope, []string{"payload", "signature"}, MonitoringExportMaxLine) != nil || len(envelope.Payload) > base64.StdEncoding.EncodedLen(MonitoringExportMaxPayload) || len(envelope.Signature) != base64.StdEncoding.EncodedLen(ed25519.SignatureSize) {
			return errMonitoringExport
		}
		payload, err := base64.StdEncoding.Strict().DecodeString(envelope.Payload)
		signature, sigErr := base64.StdEncoding.Strict().DecodeString(envelope.Signature)
		if err != nil || sigErr != nil || base64.StdEncoding.EncodeToString(payload) != envelope.Payload || base64.StdEncoding.EncodeToString(signature) != envelope.Signature || !ed25519.Verify(public, payload, signature) {
			return errMonitoringExport
		}
		var packet exportWirePacket
		if DecodeMonitoringExportObject(payload, &packet, []string{"version", "purpose", "audience", "request", "nonce", "id", "sequence", "at", "event"}) != nil || packet.Version != 1 || packet.Purpose != MonitoringExportPurpose || packet.Audience != scope.agent || packet.Request != scope.request || packet.Nonce != scope.nonce || packet.ID != scope.id || packet.Sequence != sequence+1 || packet.Sequence > uint64(MonitoringExportSafeInteger) || packet.At < scope.issued-1000 || packet.At > Millis()+1000 {
			return errMonitoringExport
		}
		sequence = packet.Sequence
		var event struct {
			Kind string `json:"kind"`
		}
		if json.Unmarshal(packet.Event, &event) != nil {
			return errMonitoringExport
		}
		if event.Kind == "error" {
			var failure struct{ Kind, Code, Message string }
			if DecodeMonitoringExportObject(packet.Event, &failure, []string{"kind", "code", "message"}) != nil || !knownMonitoringExportCode(failure.Code) {
				return errMonitoringExport
			}
			// Never print arbitrary signed server text/private JSON on failure.
			return fmt.Errorf("monitoring export stopped (%s); private output is incomplete; inspect examctl web monitoring show %s and private gateway diagnostics; preserve deletion records and retry with a NEW output directory", failure.Code, scope.id)
		}
		if !begun {
			if event.Kind != "begin" {
				return errMonitoringExport
			}
			begun = true
		} else if event.Kind == "begin" {
			return errMonitoringExport
		}
		switch event.Kind {
		case "begin", "metadata", "file-begin", "file-data", "file-verify", "file-end", "end":
		default:
			return errMonitoringExport
		}
		if err := consume(packet.Event); err != nil {
			return err
		}
		if event.Kind == "end" {
			ended = true
		}
	}
	if scanner.Err() != nil || !begun || !ended {
		return errMonitoringExport
	}
	return nil // Caller may publish ONLY after this clean EOF, never on end alone.
}

// ManagementExport uses the same fixed outbound origin, agent Ed25519 identity,
// pinned gateway key and named management authorization as ManagementCall. Its
// verified events are handed to a bounded private-output consumer, not stdout.
func ManagementExport(c Config, id, request string, consume func(json.RawMessage) error) error {
	if os.Getuid() != 0 || os.Geteuid() != 0 {
		return errors.New("run examctl monitoring export as root on the class server using the existing agent identity")
	}
	if !identifier.MatchString(id) || !monitoringUUID.MatchString(request) || consume == nil {
		return errMonitoringExport
	}
	u, err := url.Parse(c.CallbackURL)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return errors.New("export requires the configured fixed HTTPS callback origin; no endpoint override")
	}
	key, err := managementKey(c.CallbackKey)
	if err != nil {
		return err
	}
	defer func() {
		for i := range key {
			key[i] = 0
		}
	}()
	public, err := publicKey(c.GatewayPublicKey)
	if err != nil {
		return errors.New("export gateway signing key unavailable; inspect matching configured pinned keys")
	}
	issued, nonce := Millis(), Token()
	payload, _ := json.Marshal(map[string]any{"version": 1, "purpose": managementPurpose, "audience": strings.TrimSuffix(c.CallbackURL, "/"), "agent": c.AgentID, "actor": "agent-root", "request": request, "nonce": nonce, "issued": issued, "expires": issued + 30000, "operation": "monitoring.export", "body": map[string]any{"id": id}})
	client, err := (&Engine{Config: c}).callbackClient()
	if err != nil {
		return err
	}
	defer client.CloseIdleConnections()
	client.Timeout = 0
	if transport, ok := client.Transport.(*http.Transport); ok {
		transport.ResponseHeaderTimeout = 15 * time.Second
		transport.TLSHandshakeTimeout = 15 * time.Second
		transport.DialContext = (&net.Dialer{Timeout: 15 * time.Second, KeepAlive: 30 * time.Second}).DialContext
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()
	requestBody, err := http.NewRequestWithContext(ctx, "POST", strings.TrimSuffix(c.CallbackURL, "/")+"/api/agent/management", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	requestBody.Header.Set("Content-Type", "application/vnd.ssh-exam-management")
	requestBody.Header.Set("X-Exam-Signature", base64.StdEncoding.EncodeToString(ed25519.Sign(key, payload)))
	budget := &exportReadBudget{cancel: cancel}
	stop := budget.begin(15 * time.Second)
	response, err := client.Do(requestBody)
	stop()
	if err != nil || budget.failed() {
		if response != nil {
			response.Body.Close()
		}
		return fmt.Errorf("export gateway connection unavailable/unconfirmed; inspect HTTPS/keys and retry --request %s with a NEW output directory", request)
	}
	defer response.Body.Close()
	kind, _, typeErr := mime.ParseMediaType(response.Header.Get("Content-Type"))
	if response.StatusCode != 200 || typeErr != nil || kind != MonitoringExportContentType {
		stop = budget.begin(15 * time.Second)
		raw, readErr := io.ReadAll(io.LimitReader(response.Body, 65537))
		stop()
		var envelope SignedFrame
		if readErr != nil || len(raw) > 65536 || json.Unmarshal(raw, &envelope) != nil {
			return errors.New("export gateway returned an unsupported/unverified reply; inspect matching versions, HTTPS connectivity and explicit monitoring.export authorization")
		}
		body, decodeErr := base64.StdEncoding.DecodeString(envelope.Payload)
		signature, sigErr := base64.StdEncoding.DecodeString(envelope.Signature)
		var refusal struct {
			Version                                      int
			Purpose, Audience, Request, Nonce, Operation string
			At                                           int64
			OK                                           bool
			Status                                       int
			Error                                        string
		}
		if decodeErr != nil || sigErr != nil || !ed25519.Verify(public, body, signature) || !validReadOnlyJSON(body) || json.Unmarshal(body, &refusal) != nil || refusal.Version != 1 || refusal.Purpose != managementPurpose || refusal.Audience != c.AgentID || refusal.Request != request || refusal.Nonce != nonce || refusal.Operation != "monitoring.export" || refusal.At < issued-1000 || refusal.At > Millis()+1000 || refusal.OK {
			return errMonitoringExport
		}
		return fmt.Errorf("gateway refused monitoring export (status %d); inspect monitoring show %s, explicit monitoring.export authorization, matching CLI/gateway versions and private gateway storage; retry the same --request %s with a NEW output directory", refusal.Status, id, request)
	}
	err = readMonitoringExport(response.Body, public, exportWireScope{agent: c.AgentID, request: request, nonce: nonce, id: id, issued: issued}, consume, budget, 15*time.Second)
	if err == nil && ctx.Err() != nil {
		return errMonitoringExport
	}
	return err
}
