package core

// UNWIRED C3/H4 decoder. Neither existing PTY bridge calls this code. Decoding
// is NOT permission to forward: the future controller must atomically enforce
// native epoch/pane/sequence, authorization, deadline and revocation/write gates.

import (
	"encoding/binary"
	"encoding/hex"
	"errors"
	"io"
)

const framedInputHeaderBytes = 68
const framedInputMaxData = 32768
const framedInputMaxSequence uint64 = 9007199254740991

type framedInput struct {
	Epoch    string
	Pane     string
	Sequence uint64
	Data     []byte
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
	if string(h[:4]) != "EXIN" || h[4] != 1 || h[5] != 0 || h[6] != 0 || h[7] != 0 {
		return framedInput{}, errFramedInput
	}
	sequence := binary.BigEndian.Uint64(h[56:64])
	size := binary.BigEndian.Uint32(h[64:68])
	if sequence == 0 || sequence > framedInputMaxSequence || size > framedInputMaxData {
		return framedInput{}, errFramedInput
	}
	pane := hex.EncodeToString(h[40:56])
	pane = pane[:8] + "-" + pane[8:12] + "-" + pane[12:16] + "-" + pane[16:20] + "-" + pane[20:]
	data := make([]byte, int(size))
	if _, err := io.ReadFull(r, data); err != nil {
		clear(data)
		return framedInput{}, errFramedInput
	}
	return framedInput{Epoch: hex.EncodeToString(h[8:40]), Pane: pane, Sequence: sequence, Data: data}, nil
}
