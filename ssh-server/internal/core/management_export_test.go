package core

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"io"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func exportWireFixture(t *testing.T) (ed25519.PublicKey, ed25519.PrivateKey, exportWireScope) {
	t.Helper()
	public, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return public, key, exportWireScope{agent: "class", request: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", nonce: strings.Repeat("a", 64), id: "a", issued: Millis()}
}
func signedExportTestPacket(key ed25519.PrivateKey, scope exportWireScope, sequence int, event any, change func(map[string]any)) []byte {
	packet := map[string]any{"version": 1, "purpose": MonitoringExportPurpose, "audience": scope.agent, "request": scope.request, "nonce": scope.nonce, "id": scope.id, "sequence": sequence, "at": scope.issued, "event": event}
	if change != nil {
		change(packet)
	}
	payload, _ := json.Marshal(packet)
	envelope, _ := json.Marshal(SignedFrame{Payload: base64.StdEncoding.EncodeToString(payload), Signature: base64.StdEncoding.EncodeToString(ed25519.Sign(key, payload))})
	return append(envelope, '\n')
}

func TestMonitoringExportSignedPacketScopeAndCleanEOF(t *testing.T) {
	public, key, scope := exportWireFixture(t)
	begin := signedExportTestPacket(key, scope, 1, map[string]any{"kind": "begin"}, nil)
	end := signedExportTestPacket(key, scope, 2, map[string]any{"kind": "end"}, nil)
	wire := append(append([]byte(nil), begin...), end...)
	count := 0
	if err := readMonitoringExport(bytes.NewReader(wire), public, scope, func(json.RawMessage) error { count++; return nil }, nil, 0); err != nil || count != 2 {
		t.Fatal("valid signed stream refused", err, count)
	}
	for name, invalid := range map[string][]byte{"missing-end": begin, "missing-newline": wire[:len(wire)-1], "trailing-blank": append(append([]byte(nil), wire...), '\n'), "extra-packet": append(append([]byte(nil), wire...), end...), "oversized-line": append(bytes.Repeat([]byte("a"), MonitoringExportMaxLine+1), '\n')} {
		t.Run(name, func(t *testing.T) {
			if readMonitoringExport(bytes.NewReader(invalid), public, scope, func(json.RawMessage) error { return nil }, nil, 0) == nil {
				t.Fatal("accepted incomplete/extra stream")
			}
		})
	}
}

func TestMonitoringExportRejectsSignedMismatchesBeforePrivateCallback(t *testing.T) {
	public, key, scope := exportWireFixture(t)
	for _, field := range []string{"purpose", "audience", "request", "nonce", "id", "sequence", "at", "version", "extra"} {
		t.Run(field, func(t *testing.T) {
			wire := signedExportTestPacket(key, scope, 1, map[string]any{"kind": "begin"}, func(p map[string]any) {
				switch field {
				case "sequence":
					p[field] = 2
				case "at":
					p[field] = scope.issued - 1001
				case "version":
					p[field] = 2
				default:
					p[field] = "PRIVATE-WRONG-SCOPE"
				}
			})
			called := false
			err := readMonitoringExport(bytes.NewReader(wire), public, scope, func(json.RawMessage) error { called = true; return nil }, nil, 0)
			if err == nil || called || strings.Contains(err.Error(), "PRIVATE") {
				t.Fatal("unsafe scope printed/delivered", called, err)
			}
		})
	}
	for _, code := range []string{"storage-or-protocol", "PRIVATE-UNTRUSTED-CODE"} {
		wire := signedExportTestPacket(key, scope, 1, map[string]any{"kind": "error", "code": code, "message": "PRIVATE-STUDENT-TEXT"}, nil)
		err := readMonitoringExport(bytes.NewReader(wire), public, scope, func(json.RawMessage) error { t.Fatal("error packet delivered private callback"); return nil }, nil, 0)
		if err == nil || strings.Contains(err.Error(), "PRIVATE") {
			t.Fatal("private server error text escaped", err)
		}
	}
}

func TestMonitoringExportDuplicateDeepJSONAndNoncanonicalEnvelopeRefuse(t *testing.T) {
	var decoded map[string]json.RawMessage
	for _, raw := range []string{`{"kind":"begin","kind":"end"}`, `{"kind":{"nested":1,"nested":2}}`, "{\"kind\":\"" + string([]byte{255}) + "\"}"} {
		if DecodeMonitoringExportObject([]byte(raw), &decoded, []string{"kind"}) == nil {
			t.Fatal("accepted duplicate/invalid UTF8 metadata")
		}
	}
	public, key, scope := exportWireFixture(t)
	packet := signedExportTestPacket(key, scope, 1, map[string]any{"kind": "begin"}, nil)
	var envelope SignedFrame
	json.Unmarshal(packet, &envelope)
	envelope.Payload += "\n"
	altered, _ := json.Marshal(envelope)
	if readMonitoringExport(bytes.NewReader(append(altered, '\n')), public, scope, func(json.RawMessage) error { t.Fatal("noncanonical payload accepted"); return nil }, nil, 0) == nil {
		t.Fatal("accepted noncanonical base64")
	}
}

type slowExportReader struct{ data []byte }

func (r *slowExportReader) Read(p []byte) (int, error) {
	if len(r.data) == 0 {
		return 0, io.EOF
	}
	time.Sleep(5 * time.Millisecond)
	n := min(8, len(r.data), len(p))
	copy(p, r.data[:n])
	r.data = r.data[n:]
	return n, nil
}
func TestMonitoringExportProgressIsActualNetworkBytesNotWholePacketOrLocalIO(t *testing.T) {
	public, key, scope := exportWireFixture(t)
	wire := append(signedExportTestPacket(key, scope, 1, map[string]any{"kind": "begin"}, nil), signedExportTestPacket(key, scope, 2, map[string]any{"kind": "end"}, nil)...)
	var canceled atomic.Int32
	budget := &exportReadBudget{cancel: func() { canceled.Add(1) }}
	start := time.Now()
	if err := readMonitoringExport(&slowExportReader{data: wire}, public, scope, func(json.RawMessage) error { time.Sleep(120 * time.Millisecond); return nil }, budget, 100*time.Millisecond); err != nil {
		t.Fatal("continuous bytes/local processing caused false idle expiry", err)
	}
	if time.Since(start) < 100*time.Millisecond || canceled.Load() != 0 || budget.failed() {
		t.Fatal("progress fixture did not exercise a long packet or falsely expired")
	}
	stop := budget.begin(time.Second)
	stop()
	time.Sleep(5 * time.Millisecond)
	if budget.failed() || canceled.Load() != 0 {
		t.Fatal("retired wait canceled a later/local phase")
	}
}
