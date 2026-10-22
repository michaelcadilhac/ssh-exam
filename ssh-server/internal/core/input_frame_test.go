package core

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"io"
	"os"
	"strings"
	"testing"
	"time"
)

func framedInputFixture(t testing.TB) (framedInput, []byte) {
	t.Helper()
	b, err := os.ReadFile("../../../tests/fixtures/terminal-input-frame.json")
	if err != nil {
		t.Fatal(err)
	}
	var v struct {
		Epoch    string `json:"epoch"`
		Pane     string `json:"pane"`
		Sequence uint64 `json:"sequence"`
		Data     string `json:"data_base64"`
		Wire     string `json:"wire_hex"`
	}
	if json.Unmarshal(b, &v) != nil {
		t.Fatal("invalid shared input frame fixture")
	}
	data, err := base64.StdEncoding.DecodeString(v.Data)
	if err != nil {
		t.Fatal(err)
	}
	wire, err := hex.DecodeString(v.Wire)
	if err != nil {
		t.Fatal(err)
	}
	return framedInput{Epoch: v.Epoch, Pane: v.Pane, Sequence: v.Sequence, Data: data}, wire
}

type fragmentedInputReader struct {
	r    *bytes.Reader
	n    int
	read int
}

func (r *fragmentedInputReader) Read(b []byte) (int, error) {
	if len(b) > r.n {
		b = b[:r.n]
	}
	n, err := r.r.Read(b)
	r.read += n
	return n, err
}
func TestFramedInputDecoderPreservesSharedFixtureAcrossFragmentedAndConsecutiveFrames(t *testing.T) {
	want, wire := framedInputFixture(t)
	for _, fragment := range []int{1, 3, 68, 16384} {
		r := &fragmentedInputReader{r: bytes.NewReader(append(append([]byte{}, wire...), wire...)), n: fragment}
		for range 2 {
			got, err := readFramedInput(r)
			if err != nil || got.Epoch != want.Epoch || got.Pane != want.Pane || got.Sequence != want.Sequence || !bytes.Equal(got.Data, want.Data) {
				t.Fatal("fragmented frame changed", fragment, err)
			}
		}
		if _, err := readFramedInput(r); err != io.EOF {
			t.Fatal("clean stream end not distinguished", err)
		}
	}
	// Repeated sequence decoding here is intentional: replay/epoch admission is
	// the future controller's job, not evidence that a codec can authorize input.
}
func TestFramedInputDecoderBoundsPayloadAndRejectsUnsafeHeadersBeforeReadingBodies(t *testing.T) {
	_, wire := framedInputFixture(t)
	for _, mutate := range []func([]byte){
		func(b []byte) { b[0] = '?' }, func(b []byte) { b[4] = 0 }, func(b []byte) { b[4] = 2 }, func(b []byte) { b[5] = 1 }, func(b []byte) { b[6] = 1 }, func(b []byte) { b[7] = 1 },
		func(b []byte) { binary.BigEndian.PutUint64(b[56:64], 0) }, func(b []byte) { binary.BigEndian.PutUint64(b[56:64], framedInputMaxSequence+1) }, func(b []byte) { binary.BigEndian.PutUint32(b[64:68], framedInputMaxData+1) },
	} {
		bad := append([]byte{}, wire...)
		mutate(bad)
		r := &fragmentedInputReader{r: bytes.NewReader(bad), n: 100000}
		v, err := readFramedInput(r)
		if err == nil || v.Data != nil || v.Epoch != "" || r.read != framedInputHeaderBytes {
			t.Fatal("unsafe header consumed body or produced input", r.read, err)
		}
	}
	for _, size := range []int{0, 1, framedInputMaxData} {
		b := append([]byte{}, wire[:framedInputHeaderBytes]...)
		binary.BigEndian.PutUint32(b[64:68], uint32(size))
		data := make([]byte, size)
		for i := range data {
			data[i] = byte(i)
		}
		b = append(b, data...)
		v, err := readFramedInput(bytes.NewReader(b))
		if err != nil || !bytes.Equal(v.Data, data) {
			t.Fatal("bounded payload changed", size, err)
		}
	}
}
func TestFramedInputDecoderRejectsTruncationWithoutReturningOrLoggingPrivateBytes(t *testing.T) {
	_, wire := framedInputFixture(t)
	for length := 1; length < len(wire); length++ {
		v, err := readFramedInput(bytes.NewReader(wire[:length]))
		if err == nil || v.Data != nil || v.Epoch != "" {
			t.Fatal("partial input escaped validation", length)
		}
	}
	bad := append([]byte{}, wire[:framedInputHeaderBytes]...)
	binary.BigEndian.PutUint32(bad[64:68], 100)
	bad = append(bad, []byte("PRIVATE-INPUT-MUST-NOT-PRINT")...)
	_, err := readFramedInput(bytes.NewReader(bad))
	if err == nil || strings.Contains(err.Error(), "PRIVATE-INPUT-MUST-NOT-PRINT") {
		t.Fatal("partial payload leaked")
	}
}
func TestFramedInputDecoderReadsBinaryControlAndUTF8BytesFromActualRawPTY(t *testing.T) {
	want, wire := framedInputFixture(t)
	master, slave, err := openPTY()
	if err != nil {
		t.Fatal(err)
	}
	defer master.Close()
	defer slave.Close()
	restore, err := rawTerminal(slave.Fd())
	if err != nil {
		t.Fatal(err)
	}
	defer restore()
	type outcome struct {
		v   framedInput
		err error
	}
	result := make(chan outcome, 1)
	written := make(chan error, 1)
	go func() { v, err := readFramedInput(slave); result <- outcome{v, err} }()
	go func() {
		for len(wire) > 0 {
			n := 3
			if len(wire) < n {
				n = len(wire)
			}
			if _, err := master.Write(wire[:n]); err != nil {
				written <- err
				return
			}
			wire = wire[n:]
		}
		written <- nil
	}()
	select {
	case r := <-result:
		if r.err != nil || r.v.Epoch != want.Epoch || r.v.Pane != want.Pane || !bytes.Equal(r.v.Data, want.Data) {
			t.Fatal("PTY transformed framed input", r.err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("PTY frame blocked")
	}
	select {
	case err := <-written:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(time.Second):
		t.Fatal("PTY frame writer remained blocked")
	}
}
func FuzzFramedInputDecoder(f *testing.F) {
	_, wire := framedInputFixture(f)
	f.Add(wire)
	f.Add([]byte("raw terminal text is not a frame"))
	f.Add([]byte{})
	f.Fuzz(func(t *testing.T, b []byte) {
		if len(b) > framedInputHeaderBytes+framedInputMaxData+1 {
			return
		}
		v, err := readFramedInput(bytes.NewReader(b))
		if err == nil && (len(v.Epoch) != 64 || len(v.Pane) != 36 || v.Sequence == 0 || v.Sequence > framedInputMaxSequence || len(v.Data) > framedInputMaxData) {
			t.Fatal("invalid decoded frame")
		}
	})
}
