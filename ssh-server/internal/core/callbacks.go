package core

import (
	"bytes"
	"crypto/ed25519"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

type CallbackEvent struct {
	Agent    string         `json:"agent"`
	Sequence int64          `json:"sequence"`
	At       int64          `json:"at"`
	Attempt  *Attempt       `json:"attempt,omitempty"`
	Manifest *Manifest      `json:"manifest,omitempty"`
	Health   any            `json:"health,omitempty"`
	Accounts map[string]int `json:"accounts,omitempty"`
}

func publicAttempt(a *Attempt) *Attempt {
	v := *a
	v.Handoff = nil
	v.PolicyTransport = ""
	v.PolicyRestoreAuthorized = false
	v.PolicyOverride = false
	v.Transport = ""
	v.ResumeTransport = ""
	v.Authorization = 0
	v.Lease = 0
	v.Units = nil
	v.DeniedSSHTransports = nil
	v.CollectionJob = ""
	return &v
}

// Persist event bodies alongside authoritative state, before acknowledging commands.
// Lease renewals and pane changes do not create traffic; status transitions do.
func (e *Engine) queueChanges() error {
	if e.Config.CallbackURL == "" {
		return nil
	}
	if e.state.Reported == nil {
		e.state.Reported = map[string]string{}
	}
	for id, a := range e.state.Attempts {
		v := publicAttempt(a)
		b, err := json.Marshal(v)
		if err != nil {
			return err
		}
		digest := Hash(b)
		if e.state.Reported[id] == digest {
			continue
		}
		var manifest *Manifest
		if a.Protected {
			// Only a worker that verified the immutable bytes may install this
			// receipt. Never hash/compress an archive while saving shared state.
			if m, err := e.manifestReceipt(a); err == nil {
				v := *m
				v.Attempt = publicAttempt(m.Attempt)
				manifest = &v
			}
		}
		e.state.Sequence++
		e.state.Events = append(e.state.Events, CallbackEvent{Agent: e.Config.AgentID, Sequence: e.state.Sequence, At: Millis(), Attempt: v, Manifest: manifest})
		e.state.Reported[id] = digest
	}
	return nil
}
func (e *Engine) ReportConfiguration() error {
	if err := e.WithState(func() error { return nil }); err != nil {
		return err
	}
	h, err := e.observeNativeHealth()
	if err != nil {
		return err // Busy/unknown is not a failed-readiness snapshot to publish.
	}
	return e.WithState(func() error {
		accounts := map[string]int{}
		for name, a := range e.Config.Accounts {
			accounts[name] = a.UID
		}
		e.state.Sequence++
		e.state.Events = append(e.state.Events, CallbackEvent{Agent: e.Config.AgentID, Sequence: e.state.Sequence, At: Millis(), Health: h, Accounts: accounts})
		return nil
	})
}
func (e *Engine) callbackClient() (*http.Client, error) {
	tlsConfig := &tls.Config{MinVersion: tls.VersionTLS13}
	if e.Config.CallbackCA != "" {
		b, err := os.ReadFile(e.Config.CallbackCA)
		if err != nil {
			return nil, err
		}
		pool := x509.NewCertPool()
		if !pool.AppendCertsFromPEM(b) {
			return nil, errors.New("invalid callback CA")
		}
		tlsConfig.RootCAs = pool
	}
	return &http.Client{Timeout: 45 * time.Second, Transport: &http.Transport{Proxy: http.ProxyFromEnvironment, TLSClientConfig: tlsConfig}, CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("callback redirects forbidden") }}, nil
}
func (e *Engine) postCallback(client *http.Client, key ed25519.PrivateKey, endpoint string, payload []byte, body io.Reader, contentType string) error {
	req, err := http.NewRequest("POST", strings.TrimSuffix(e.Config.CallbackURL, "/")+endpoint, body)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("X-Exam-Signature", base64.StdEncoding.EncodeToString(ed25519.Sign(key, payload)))
	if contentType == "application/gzip" {
		req.Header.Set("X-Exam-Receipt", base64.StdEncoding.EncodeToString(payload))
	}
	res, err := client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	io.Copy(io.Discard, io.LimitReader(res.Body, 8192))
	if res.StatusCode != 200 {
		return fmt.Errorf("callback rejected: HTTP %d", res.StatusCode)
	}
	return nil
}

// Delivery takes its own flock and never holds the state/collection lock during HTTP.
// It retries only durable pending events or protected copies, never asks for commands.
func (e *Engine) DeliverCallbacks() error {
	if e.Config.CallbackURL == "" {
		return nil
	}
	u, err := url.Parse(e.Config.CallbackURL)
	if err != nil || u.Scheme != "https" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return errors.New("callback requires a fixed HTTPS origin")
	}
	lock, err := os.OpenFile(filepath.Join(e.Config.State, "delivery.lock"), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return err
	}
	defer lock.Close()
	if err = syscall.Flock(int(lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		return nil
	}
	defer syscall.Flock(int(lock.Fd()), syscall.LOCK_UN)
	client, err := e.callbackClient()
	if err != nil {
		return err
	}
	defer client.CloseIdleConnections()
	key, err := privateKey(e.Config.CallbackKey)
	if err != nil {
		return err
	}
	defer func() {
		for i := range key {
			key[i] = 0
		}
	}()
	// Bound each pass so a backlog cannot monopolize recovery.
	for n := 0; n < 20; n++ {
		var event *CallbackEvent
		if err = e.WithState(func() error {
			if len(e.state.Events) > 0 {
				v := e.state.Events[0]
				event = &v
			}
			return nil
		}); err != nil {
			return err
		}
		if event == nil {
			break
		}
		payload, err := json.Marshal(event)
		if err != nil {
			return err
		}
		if err = e.postCallback(client, key, "/api/agent/events", payload, bytes.NewReader(payload), "application/vnd.ssh-exam-event"); err != nil {
			return err
		}
		if err = e.WithState(func() error {
			if len(e.state.Events) > 0 && e.state.Events[0].Sequence == event.Sequence {
				e.state.Events = e.state.Events[1:]
			}
			return nil
		}); err != nil {
			return err
		}
	}
	// Protected archives remain on this server. Only signed status/manifest
	// metadata and monitoring records are sent to the webserver.
	var failures []error
	if err := e.deliverRecordings(client, key); err != nil {
		failures = append(failures, err)
	}
	return errors.Join(failures...)
}
