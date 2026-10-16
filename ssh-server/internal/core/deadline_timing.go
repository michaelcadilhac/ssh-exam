package core

import (
	"bytes"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"
)

func (e *Engine) timingRequired(a *Attempt) bool {
	// Config files require HTTPS callbacks. Empty URLs exist only in in-process fixtures.
	return e.Config.CallbackURL != "" && !a.Protected && a.State != "COMPLETED" &&
		!(a.TimingVerifiedAt >= a.Deadline && a.TimingVerifiedDeadline == a.Deadline && a.TimingVerifiedRevision == a.ClockRevision)
}

type timingReply struct {
	Type          string   `json:"type"`
	Audience      string   `json:"audience"`
	ID            string   `json:"id"`
	Nonce         string   `json:"nonce"`
	Expires       int64    `json:"expires"`
	Deadline      int64    `json:"deadline"`
	ClockRevision int      `json:"clock_revision"`
	Collect       bool     `json:"collect"`
	Reset         *Request `json:"reset,omitempty"`
}

// One check at an expired locally committed deadline, then bounded retries while
// unavailable. There is no idle command polling and no inbound control service.
func (e *Engine) RefreshExpiredTiming() error {
	if e.Config.CallbackURL == "" {
		return nil
	}
	var due []*Attempt
	if err := e.WithState(func() error {
		for _, a := range e.state.Attempts {
			if a.Start > 0 && a.State != "CANCELLED_BEFORE_START" && expired(a) && e.timingRequired(a) && Millis() >= a.TimingNextCheck {
				// Freeze all due writers before any HTTP, including command-line reconciliation.
				if err := e.quiesce(a); err != nil {
					a.Errors = appendError(a.Errors, err.Error())
				}
				a.TimingNextCheck = Millis() + 30000
				v := *publicAttempt(a)
				due = append(due, &v)
			}
		}
		return nil
	}); err != nil {
		return err
	}
	var failures []error
	var mu sync.Mutex
	var workers sync.WaitGroup
	slots := make(chan struct{}, 4)
	for _, snapshot := range due {
		workers.Go(func() {
			slots <- struct{}{}
			defer func() { <-slots }()
			if err := e.checkTiming(snapshot); err != nil {
				// Do not label a newer confirmed deadline with an old request's failure.
				e.WithState(func() error {
					a, findErr := e.Find(snapshot.ID)
					if findErr == nil && a.Deadline == snapshot.Deadline && a.ClockRevision == snapshot.ClockRevision && e.timingRequired(a) && a.TimingPendingSince == 0 {
						a.TimingPendingSince = Millis()
					}
					return nil
				})
				mu.Lock()
				failures = append(failures, fmt.Errorf("attempt %s: %w", snapshot.ID, err))
				mu.Unlock()
			}
		})
	}
	workers.Wait()
	return errors.Join(failures...)
}

func (e *Engine) checkTiming(a *Attempt) error {
	client, err := e.callbackClient()
	if err != nil {
		return err
	}
	defer client.CloseIdleConnections()
	client.Timeout = 5 * time.Second
	key, err := privateKey(e.Config.CallbackKey)
	if err != nil {
		return err
	}
	defer func() {
		for i := range key {
			key[i] = 0
		}
	}()
	nonce := Token()
	payload, _ := json.Marshal(map[string]any{"agent": e.Config.AgentID, "nonce": nonce, "at": Millis(), "attempt": a})
	request, err := http.NewRequest("POST", strings.TrimSuffix(e.Config.CallbackURL, "/")+"/api/agent/timing", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Type", "application/vnd.ssh-exam-event")
	request.Header.Set("X-Exam-Signature", base64.StdEncoding.EncodeToString(ed25519.Sign(key, payload)))
	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode != 200 {
		return fmt.Errorf("timing check rejected: HTTP %d", response.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, 65537))
	if err != nil || len(body) > 65536 {
		return errors.New("invalid timing reply size")
	}
	var frame SignedFrame
	if err = json.Unmarshal(body, &frame); err != nil {
		return err
	}
	signed, err := base64.StdEncoding.DecodeString(frame.Payload)
	if err != nil {
		return err
	}
	signature, err := base64.StdEncoding.DecodeString(frame.Signature)
	if err != nil {
		return err
	}
	pub, err := publicKey(e.Config.GatewayPublicKey)
	if err != nil {
		return err
	}
	if !ed25519.Verify(pub, signed, signature) {
		return errors.New("timing reply signature rejected")
	}
	var reply timingReply
	if err = json.Unmarshal(signed, &reply); err != nil {
		return err
	}
	if reply.Type != "deadline-timing" || reply.Audience != e.Config.AgentID || reply.ID != a.ID || reply.Nonce != nonce || reply.Expires <= Millis() || reply.Expires > Millis()+31000 || reply.Deadline != a.Deadline || reply.ClockRevision != a.ClockRevision {
		return errors.New("timing reply scope rejected")
	}
	return e.WithState(func() error {
		current, err := e.Find(a.ID)
		if err != nil {
			return err
		}
		if current.Deadline != a.Deadline || current.ClockRevision != a.ClockRevision || current.Protected || current.State == "COMPLETED" {
			return nil
		}
		if reply.Reset != nil {
			if reply.Collect || reply.Reset.ID != a.ID {
				return errors.New("conflicting timing decision")
			}
			wasActive := current.State == "ACTIVE" && current.Lease > Millis() && current.Boot == boot()
			if err := e.resetClock(current, *reply.Reset, true); err != nil {
				return err
			}
			// A healthy connected student need not lose their session because a signed
			// extension raced the old cutoff. Locked attempts never resume automatically.
			if wasActive && !expired(current) {
				return e.freeze(current, false)
			}
			return nil
		}
		if !reply.Collect || Millis() < current.Deadline {
			return errors.New("collection was not authorized")
		}
		current.TimingVerifiedAt = Millis()
		current.TimingVerifiedDeadline = current.Deadline
		current.TimingVerifiedRevision = current.ClockRevision
		current.TimingPendingSince = 0
		e.Audit("deadline-timing-verified", current.ID)
		return nil
	})
}
