package client

import (
	"bytes"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"os"
	"strings"
	"testing"
	"time"

	"golang.org/x/crypto/ssh"
)

func inputFrameFixture(t *testing.T) (string, string, uint64, []byte, []byte) {
	t.Helper()
	b, err := os.ReadFile("../../tests/fixtures/terminal-input-frame.json")
	if err != nil {
		t.Fatal(err)
	}
	var f struct {
		Epoch    string `json:"epoch"`
		Pane     string `json:"pane"`
		Sequence uint64 `json:"sequence"`
		Data     string `json:"data_base64"`
		Wire     string `json:"wire_hex"`
	}
	if json.Unmarshal(b, &f) != nil {
		t.Fatal("invalid shared input fixture")
	}
	data, err := base64.StdEncoding.DecodeString(f.Data)
	if err != nil {
		t.Fatal(err)
	}
	wire, err := hex.DecodeString(f.Wire)
	if err != nil {
		t.Fatal(err)
	}
	return f.Epoch, f.Pane, f.Sequence, data, wire
}
func TestInputFrameEncoderMatchesNativeSharedFixture(t *testing.T) {
	epoch, pane, seq, data, want := inputFrameFixture(t)
	got, err := encodeInputFrame(epoch, pane, seq, data)
	if err != nil || !bytes.Equal(got, want) {
		t.Fatal("input encoder/decoder fixture drift", err)
	}
	for _, n := range []int{0, 1, inputFrameMaxData} {
		data := make([]byte, n)
		for i := range data {
			data[i] = byte(i)
		}
		got, err := encodeInputFrame(epoch, pane, inputFrameMaxSequence, data)
		if err != nil || len(got) != inputFrameHeaderBytes+n || !bytes.Equal(got[inputFrameHeaderBytes:], data) {
			t.Fatal("input bytes changed", n, err)
		}
	}
	// Existing frontend chunks are 8,000 UTF-16 code units, not 8,000 bytes.
	// A 16 KiB framing cap would falsely reject legitimate CJK pastes.
	unicodePaste := []byte(strings.Repeat("漢", 8000))
	if _, err := encodeInputFrame(epoch, pane, seq, unicodePaste); err != nil {
		t.Fatal("current supported Unicode paste became invalid", err)
	}
}
func TestInputFrameEncoderRejectsInvalidScopeCounterAndSizeWithoutLeakingPayload(t *testing.T) {
	epoch, pane, seq, data, _ := inputFrameFixture(t)
	for _, c := range []struct {
		epoch, pane string
		seq         uint64
		data        []byte
	}{
		{"", pane, seq, data}, {strings.ToUpper(epoch), pane, seq, data}, {epoch, "", seq, data}, {epoch, strings.ToUpper(pane), seq, data}, {epoch, pane, 0, data}, {epoch, pane, inputFrameMaxSequence + 1, data}, {epoch, pane, seq, make([]byte, inputFrameMaxData+1)},
		{"PRIVATE-INPUT-MUST-NOT-PRINT", pane, seq, []byte("PRIVATE-INPUT-MUST-NOT-PRINT")},
	} {
		wire, err := encodeInputFrame(c.epoch, c.pane, c.seq, c.data)
		if err == nil || wire != nil || strings.Contains(err.Error(), "PRIVATE-INPUT-MUST-NOT-PRINT") {
			t.Fatal("invalid input encoded or leaked")
		}
	}
}
func TestCandidateFramedInputCrossesActualEncryptedSSHChannel(t *testing.T) {
	epoch, pane, seq, data, want := inputFrameFixture(t)
	got := make(chan []byte, 1)
	c := cleanupClient(t, func(s ssh.Channel, reqs <-chan *ssh.Request) {
		defer s.Close()
		for q := range reqs {
			q.Reply(true, nil)
			if q.Type != "exec" {
				continue
			}
			b := make([]byte, len(want))
			if _, err := io.ReadFull(s, b); err == nil {
				got <- b
			}
			return
		}
	}, func(any) {})
	s, err := c.session()
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if err = s.RequestPty("xterm-256color", 30, 100, ssh.TerminalModes{ssh.ECHO: 0}); err != nil {
		t.Fatal(err)
	}
	in, err := s.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	if err = s.Start("framed-input-candidate-test"); err != nil {
		t.Fatal(err)
	}
	wire, err := encodeInputFrame(epoch, pane, seq, data)
	if err != nil {
		t.Fatal(err)
	}
	for len(wire) > 0 {
		n := 7
		if len(wire) < n {
			n = len(wire)
		}
		if _, err = in.Write(wire[:n]); err != nil {
			t.Fatal(err)
		}
		wire = wire[n:]
	}
	select {
	case b := <-got:
		if !bytes.Equal(b, want) {
			t.Fatal("SSH input frame changed")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("framed input did not cross SSH channel")
	}
}
