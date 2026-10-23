package client

// Runtime codec for explicitly negotiated Client.InputFramed/ResizeFramed and
// WASM RPCs. Legacy Client.Input stays raw. Callers preserve capture-time epochs;
// decoding/framing does not authorize retained holds, continuation or thaw.

import (
	"encoding/binary"
	"encoding/hex"
	"errors"
)

const inputFrameHeaderBytes = 68
const inputFrameMaxData = 32768 // Match the existing WASM worker's UTF-8 byte cap.
const inputFrameMaxSequence uint64 = 9007199254740991

func encodeInputFrame(epoch, pane string, sequence uint64, data []byte) ([]byte, error) {
	bad := errors.New("invalid framed terminal input; no input sent")
	if len(epoch) != 64 || len(pane) != 36 || pane[8] != '-' || pane[13] != '-' || pane[18] != '-' || pane[23] != '-' || sequence == 0 || sequence > inputFrameMaxSequence || len(data) > inputFrameMaxData {
		return nil, bad
	}
	e, err := hex.DecodeString(epoch)
	if err != nil || len(e) != 32 || hex.EncodeToString(e) != epoch {
		return nil, bad
	}
	compact := pane[:8] + pane[9:13] + pane[14:18] + pane[19:23] + pane[24:]
	p, err := hex.DecodeString(compact)
	if err != nil || len(p) != 16 || hex.EncodeToString(p) != compact {
		return nil, bad
	}
	wire := make([]byte, inputFrameHeaderBytes+len(data))
	copy(wire[:4], "EXIN")
	wire[4] = 1
	copy(wire[8:40], e)
	copy(wire[40:56], p)
	binary.BigEndian.PutUint64(wire[56:64], sequence)
	binary.BigEndian.PutUint32(wire[64:68], uint32(len(data)))
	copy(wire[68:], data)
	return wire, nil
}
