package core

import (
	"io"
	"sync"
)

// Only exact public protocol messages may be reflected. Never echo arbitrary
// signed server errors from a credential workflow: they could contain a secret.
// Actual compiled-CLI interoperability tests fence helpful cause/message parity.
func administratorPublicRefusal(message string) string {
	switch message {
	case "An administrator with that username already exists; inspect administrators before choosing another username. Creation never replaces credentials.",
		"Administrator creation intent conflicts with different arguments or damaged receipt; inspect current administrators and use the original username/password for a retry, or a new intent for a different account.",
		"Administrator credential work is busy; no intent was executed. Retry the same creation request and original password after other credential work finishes.",
		"Administrator creation receipt changed during credential preparation; inspect current administrators and retry the SAME intent with the original password. Do not assume creation or overwrite an account.",
		"Administrator creation receipt result is invalid or changed; preserve it, inspect current administrators and retry only after operator diagnosis. No creation confirmed.",
		"Administrator credential preparation unavailable; no creation confirmed. Retry the same request and original password after operator diagnosis.",
		"Administrator credential verifier unavailable; no creation confirmed.",
		"Administrator operation unavailable or invalid; inspect current administrators and examctl web administrators help. No creation confirmed.",
		"Administrator not found; use examctl web administrators list. No credentials were changed.",
		"Management operation is not authorized for this agent; configure the explicit gateway managementOperations allowlist",
		"Management request expired during preparation; retry the same request ID with a fresh nonce",
		"Exam management is unavailable during login-only testing":
		return message
	}
	return "Unrecognized administrator refusal; private server diagnostics were not printed. Inspect the current account, request and authorization before retrying"
}

// Own the marshalled credential request until the transport closes it. Cleanup
// must not race an HTTP writer reading a bytes.Reader after Do returned early.
type credentialRequestBody struct {
	mu     sync.Mutex
	data   []byte
	offset int
	closed bool
}

func (b *credentialRequestBody) Read(out []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.closed || b.offset == len(b.data) {
		return 0, io.EOF
	}
	n := copy(out, b.data[b.offset:])
	b.offset += n
	return n, nil
}
func (b *credentialRequestBody) Close() error {
	b.mu.Lock()
	defer b.mu.Unlock()
	for i := range b.data {
		b.data[i] = 0
	}
	b.closed = true
	return nil
}
