package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net"
	"syscall"

	"github.com/coder/websocket"
)

// A digest of the signed payload's base64 text correlates gateway/relay records
// without logging a reusable ticket, signature, nonce or SSH payload.
func ticketReference(packet []byte) string {
	var f frame
	if json.Unmarshal(packet, &f) != nil {
		return ""
	}
	h := sha256.Sum256([]byte(f.Payload))
	return hex.EncodeToString(h[:])[:24]
}

func transportCause(err error) string {
	var timeout net.Error
	switch {
	case errors.Is(err, context.DeadlineExceeded), errors.As(err, &timeout) && timeout.Timeout():
		return "timeout"
	case errors.Is(err, context.Canceled):
		return "cancelled"
	case websocket.CloseStatus(err) >= 0:
		return "peer-close"
	case err == nil, errors.Is(err, io.EOF):
		return "eof"
	case errors.Is(err, net.ErrClosed):
		return "closed"
	case errors.Is(err, syscall.ECONNRESET):
		return "reset"
	case errors.Is(err, syscall.EPIPE):
		return "broken-pipe"
	default:
		return "transport-error"
	}
}

type relayDiagnostic struct {
	Event     string `json:"event"`
	Reference string `json:"reference"`
	Trigger   string `json:"trigger"`
	Cause     string `json:"cause"`
	ElapsedMS int64  `json:"elapsed_ms"`
	ToJump    int64  `json:"bytes_to_jump"`
	ToBrowser int64  `json:"bytes_to_browser"`
	CloseCode int    `json:"close_code"`
}

func (r *relay) diagnostic(value relayDiagnostic) {
	// One record per accepted connection outcome; raw error text is forbidden.
	if r.report != nil {
		r.report(value)
	}
}
