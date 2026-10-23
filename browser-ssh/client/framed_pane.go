package client

// Runtime caller: explicit WASM framed-pane RPCs. They carry capture-time
// contexts unchanged. Native admission/authority remains separately mandatory;
// these client checks cannot authorize a hold, input, recovery or thaw.
import (
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
)

var errFramedPane = errors.New("framed pane context is unavailable, stale or replayed; no input sent; obtain the current verified native pane context without relabelling queued input")

// Only a positively negotiated native pane may select this explicit mode. There
// is no byte sniffing or fallback from rejected framing to raw terminal input.
func (c *Client) OpenFramed(pane, token, epoch string) (json.RawMessage, error) {
	if _, err := encodeInputFrame(epoch, pane, 1, nil); err != nil {
		return nil, errFramedPane
	}
	return c.open(pane, token, epoch)
}

func (c *Client) InputFramed(pane, epoch string, sequence uint64, data string) error {
	wire, err := encodeInputFrame(epoch, pane, sequence, []byte(data))
	if err != nil {
		return errFramedPane
	}
	return c.sendInputFrame(pane, epoch, sequence, wire)
}

func (c *Client) ResizeFramed(pane, epoch string, sequence uint64, rows, cols int) error {
	if rows < 2 || rows > 500 || cols < 2 || cols > 500 {
		return errFramedPane
	}
	payload := make([]byte, 8)
	binary.BigEndian.PutUint32(payload, uint32(rows))
	binary.BigEndian.PutUint32(payload[4:], uint32(cols))
	wire, err := encodeInputFrame(epoch, pane, sequence, payload)
	if err != nil {
		return errFramedPane
	}
	wire[5] = 1 // Scoped resize, never an unframed SSH window-change request.
	return c.sendInputFrame(pane, epoch, sequence, wire)
}

func (c *Client) sendInputFrame(pane, epoch string, sequence uint64, wire []byte) error {
	c.mu.Lock()
	p := c.panes[pane]
	c.mu.Unlock()
	if p == nil {
		return errFramedPane
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.inputEpoch == "" || p.inputEpoch != epoch || sequence <= p.inputSequence {
		return errFramedPane
	}
	// Consume before writing, including a partially delivered frame. Retrying a
	// failed/short write must never replay its prefix or reset its sequence.
	p.inputSequence = sequence
	n, err := p.in.Write(wire)
	if err == nil && n != len(wire) {
		return io.ErrShortWrite
	}
	return err
}

// The caller must have a fresh verified native continuation result. This is a
// local stale-completion fence, not a native authorization/hold receipt.
func (c *Client) ChangeInputEpoch(pane, previous, next string) error {
	if _, err := encodeInputFrame(next, pane, 1, nil); err != nil || previous == next {
		return errFramedPane
	}
	c.mu.Lock()
	p := c.panes[pane]
	c.mu.Unlock()
	if p == nil {
		return errFramedPane
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.inputEpoch == next {
		return nil // Exact retry never resets the consumed sequence.
	}
	if p.inputEpoch == "" || p.inputEpoch != previous {
		return errFramedPane
	}
	p.inputEpoch, p.inputSequence = next, 0
	p.eventEpoch.Store(&next)
	return nil
}
