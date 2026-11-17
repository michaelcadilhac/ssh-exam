package client

import (
	"context"
	"errors"
	"github.com/coder/websocket"
	"golang.org/x/crypto/ssh"
	"io"
	"net"
	"syscall"
	"time"
)

const OperationTimeout = 60 * time.Second

// Only the native gate's explicit refusal BEFORE EXAM-READY produces this.
// Missing replies and invalid receipts remain unconfirmed operations.
var errPaneAdmissionRefused = errors.New("session admission rejected")

// Fixed categories only: SSH/MFA/server error strings may contain private data.
func FailureCause(err error) string {
	var timeout net.Error
	var exit interface{ ExitStatus() int }
	var channel *ssh.OpenChannelError
	switch {
	case errors.Is(err, context.DeadlineExceeded), errors.As(err, &timeout) && timeout.Timeout():
		return "timeout"
	case errors.Is(err, context.Canceled):
		return "cancelled"
	case websocket.CloseStatus(err) >= 0:
		return "peer-close"
	case errors.Is(err, io.EOF), err == nil:
		return "eof"
	case errors.Is(err, net.ErrClosed):
		return "closed"
	case errors.Is(err, syscall.ECONNRESET):
		return "reset"
	case errors.Is(err, syscall.EPIPE):
		return "broken-pipe"
	case errors.As(err, &channel) && channel.Reason == ssh.ResourceShortage:
		return "channel-capacity"
	case errors.Is(err, errPaneAdmissionRefused):
		return "admission-refused"
	case errors.As(err, &exit):
		return "remote-exit"
	default:
		return "operation-rejected"
	}
}
