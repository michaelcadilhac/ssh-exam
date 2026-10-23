package core

// Runtime decoder for the explicitly admitted exam-framed-v1 supervisor input
// path. It enforces immutable pane incarnation and sequence there; decoding is
// not a C3 live-authority, revocation/drain, freeze or thaw proof.

import (
	"encoding/binary"
	"encoding/hex"
	"errors"
	"io"
)

const framedInputHeaderBytes = 68
const framedPanePurpose = "exam-framed-v1" // Older gates/supervisors refuse, never read framed bytes as raw input.
const framedInputMaxData = 32768
const framedInputMaxSequence uint64 = 9007199254740991

type framedInput struct {
	Epoch    string
	Pane     string
	Sequence uint64
	Data     []byte
	Kind     byte // 0: terminal bytes; 1: scoped resize (two network-order uint32s).
}

var errFramedInput = errors.New("invalid framed terminal input; no bytes forwarded")

// Bounded memory, not a read timeout: the future controller must independently
// cancel/close a blocked reader without delaying revocation or native cutoffs.
func readFramedInput(r io.Reader) (framedInput, error) {
	var h [framedInputHeaderBytes]byte
	if _, err := io.ReadFull(r, h[:]); err != nil {
		if err == io.EOF {
			return framedInput{}, io.EOF
		}
		return framedInput{}, errFramedInput
	}
	if string(h[:4]) != "EXIN" || h[4] != 1 || h[5] > 1 || h[6] != 0 || h[7] != 0 {
		return framedInput{}, errFramedInput
	}
	sequence := binary.BigEndian.Uint64(h[56:64])
	size := binary.BigEndian.Uint32(h[64:68])
	if sequence == 0 || sequence > framedInputMaxSequence || size > framedInputMaxData || (h[5] == 1 && size != 8) {
		return framedInput{}, errFramedInput
	}
	pane := hex.EncodeToString(h[40:56])
	pane = pane[:8] + "-" + pane[8:12] + "-" + pane[12:16] + "-" + pane[16:20] + "-" + pane[20:]
	data := make([]byte, int(size))
	if _, err := io.ReadFull(r, data); err != nil {
		clear(data)
		return framedInput{}, errFramedInput
	}
	if h[5] == 1 {
		rows, cols := binary.BigEndian.Uint32(data), binary.BigEndian.Uint32(data[4:])
		if rows < 2 || rows > 500 || cols < 2 || cols > 500 {
			return framedInput{}, errFramedInput
		}
	}
	return framedInput{Epoch: hex.EncodeToString(h[8:40]), Pane: pane, Sequence: sequence, Data: data, Kind: h[5]}, nil
}
