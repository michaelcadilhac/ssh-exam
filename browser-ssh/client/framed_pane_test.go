package client

import (
	"bufio"
	"bytes"
	"encoding/binary"
	"io"
	"strings"
	"testing"
	"time"

	"golang.org/x/crypto/ssh"
)

// Actual Client Open/Input/Resize entry points over encrypted SSH. Native policy
// and the gate reply are simulated here; this is not freeze/authorization proof.
func TestFramedPanePreservesCapturedEpochAndFencesRawInputAndResize(t *testing.T) {
	type received struct {
		token string
		data  []byte
	}
	got := make(chan received, 2)
	c := cleanupClient(t, func(s ssh.Channel, reqs <-chan *ssh.Request) {
		defer s.Close()
		for q := range reqs {
			if err := q.Reply(true, nil); err != nil {
				return
			}
			if q.Type != "exec" {
				continue
			}
			reader := bufio.NewReader(s)
			if _, err := io.WriteString(s, "EXAM-GATE/1\n"); err != nil {
				return
			}
			token, err := reader.ReadString('\n')
			if err != nil {
				return
			}
			if _, err := io.WriteString(s, "EXAM-READY {}\n"); err != nil {
				return
			}
			data, err := io.ReadAll(io.LimitReader(reader, 1024*1024))
			if err == nil {
				got <- received{token, data}
			}
			return
		}
	}, func(any) {})
	epoch, pane, _, _, _ := inputFrameFixture(t)
	if _, err := c.OpenFramed(pane, "framed-token", epoch); err != nil {
		t.Fatal("actual framed pane did not open", err)
	}
	if err := c.Input(pane, "RAW-INPUT-MUST-NOT-ARRIVE"); err == nil {
		t.Fatal("raw input bypassed negotiated framing")
	}
	if err := c.Resize(pane, 40, 120); err == nil {
		t.Fatal("unscoped SSH resize bypassed captured epoch")
	}
	data := "binary:\x00\x03\x1b[31m漢\n"
	if err := c.InputFramed(pane, epoch, 2, data); err != nil {
		t.Fatal(err)
	}
	if err := c.ResizeFramed(pane, epoch, 4, 40, 120); err != nil {
		t.Fatal(err)
	}
	next := strings.Repeat("f", 64)
	if err := c.ChangeInputEpoch(pane, epoch, next); err != nil {
		t.Fatal(err)
	}
	if err := c.InputFramed(pane, epoch, 5, "STALE-CAPTURE-MUST-NOT-ARRIVE"); err == nil {
		t.Fatal("queued input was relabelled with the new epoch")
	}
	if err := c.ResizeFramed(pane, epoch, 6, 41, 121); err == nil {
		t.Fatal("queued old resize survived epoch change")
	}
	if err := c.ChangeInputEpoch(pane, strings.Repeat("0", 64), epoch); err == nil {
		t.Fatal("stale epoch completion rolled ownership back")
	}
	if err := c.InputFramed(pane, next, 1, "fresh-input\n"); err != nil {
		t.Fatal(err)
	}
	if err := c.ChangeInputEpoch(pane, epoch, next); err != nil {
		t.Fatal("exact retry was not idempotent", err)
	}
	if err := c.InputFramed(pane, next, 1, "REPLAY-MUST-NOT-ARRIVE"); err == nil {
		t.Fatal("epoch retry reset the consumed sequence")
	}
	c.ClosePane(pane)
	legacy := "11111111-2222-4333-8444-555555555555"
	if _, err := c.Open(legacy, "legacy-token"); err != nil {
		t.Fatal("sibling transport was lost", err)
	}
	if err := c.Input(legacy, "unchanged-legacy-input\n"); err != nil {
		t.Fatal(err)
	}
	if err := c.InputFramed(legacy, epoch, 1, "MIXED-MODE-MUST-NOT-ARRIVE"); err == nil {
		t.Fatal("legacy pane accepted an unnegotiated frame")
	}
	c.ClosePane(legacy)
	first, _ := encodeInputFrame(epoch, pane, 2, []byte(data))
	resize, _ := encodeInputFrame(epoch, pane, 4, make([]byte, 8))
	resize[5] = 1 // Explicit, epoch/sequence-scoped resize; no SSH window-change.
	binary.BigEndian.PutUint32(resize[inputFrameHeaderBytes:], 40)
	binary.BigEndian.PutUint32(resize[inputFrameHeaderBytes+4:], 120)
	last, _ := encodeInputFrame(next, pane, 1, []byte("fresh-input\n"))
	want := append(append(first, resize...), last...)
	for range 2 {
		select {
		case result := <-got:
			if strings.Contains(result.token, "framed-token") {
				if !bytes.Equal(result.data, want) {
					t.Fatal("actual wire admitted stale/raw input, changed a captured epoch, or lost valid bytes", len(result.data), len(want))
				}
			} else if !strings.Contains(result.token, "legacy-token") || string(result.data) != "unchanged-legacy-input\n" {
				t.Fatal("legacy mode changed")
			}
		case <-time.After(2 * time.Second):
			t.Fatal("exact SSH channel completion was not observed")
		}
	}
}
