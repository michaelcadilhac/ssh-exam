package core

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
)

// The browser carries the receipt; only root can assert the SSH account/transport.
func (e *Engine) SSHReceipt(kind, nonce, user, transport string, result any, commandErr error) (SignedFrame, error) {
	key, err := privateKey(e.Config.CallbackKey)
	if err != nil {
		return SignedFrame{}, err
	}
	defer clear(key)
	message := ""
	if commandErr != nil {
		message = commandErr.Error()
	}
	payload, err := json.Marshal(map[string]any{"agent": e.Config.AgentID, "type": kind, "nonce": nonce, "username": user, "transport": transport, "expires": Millis() + 120000, "result": result, "error": message})
	if err != nil {
		return SignedFrame{}, err
	}
	if len(payload) > 4*1024*1024 {
		return SignedFrame{}, errors.New("SSH receipt too large")
	}
	return SignedFrame{Payload: base64.StdEncoding.EncodeToString(payload), Signature: base64.StdEncoding.EncodeToString(ed25519.Sign(key, payload))}, nil
}
