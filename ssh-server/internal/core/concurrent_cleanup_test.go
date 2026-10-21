package core

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

// Exercise real signed renewal, protected collection, durable callbacks and
// independent cutoff together. Only privileged writer operations are simulated;
// this is not a qualification of real systemd/cgroup containment or capacity.
func TestConcurrentDeadlinesSlowCleanupAndCallbackBacklog(t *testing.T) {
	const healthy, due = 12, 4
	e, key, _ := leaseFixture(t)
	pub, callbackKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	b, err := x509.MarshalPKCS8PrivateKey(callbackKey)
	if err != nil {
		t.Fatal(err)
	}
	e.Config.CallbackKey = filepath.Join(t.TempDir(), "callback.key")
	if err = os.WriteFile(e.Config.CallbackKey, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: b}), 0600); err != nil {
		t.Fatal(err)
	}
	httpBlocked, httpRelease := make(chan struct{}), make(chan struct{})
	var releaseHTTP, firstHTTP sync.Once
	var eventsMu sync.Mutex
	var sequences []int64
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		payload, readErr := io.ReadAll(r.Body)
		sig, _ := base64.StdEncoding.DecodeString(r.Header.Get("X-Exam-Signature"))
		var event CallbackEvent
		if readErr != nil || !ed25519.Verify(pub, payload, sig) || json.Unmarshal(payload, &event) != nil || r.URL.Path != "/api/agent/events" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		firstHTTP.Do(func() { close(httpBlocked); <-httpRelease })
		eventsMu.Lock()
		sequences = append(sequences, event.Sequence)
		eventsMu.Unlock()
	}))
	defer server.Close()
	// Release a delayed request before server.Close even on a failed assertion.
	defer releaseHTTP.Do(func() { close(httpRelease) })
	e.Config.CallbackURL = server.URL
	e.Config.CallbackCA = filepath.Join(t.TempDir(), "ca.crt")
	if err = os.WriteFile(e.Config.CallbackCA, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: server.Certificate().Raw}), 0600); err != nil {
		t.Fatal(err)
	}
	ids := make([]string, healthy+due)
	if err = e.WithState(func() error {
		base := *e.state.Attempts[finalID]
		delete(e.state.Attempts, finalID)
		for i := range ids {
			id := fmt.Sprintf("%08x-1234-4234-8234-123456789abc", i+1)
			ids[i] = id
			a := base
			a.ID, a.Username, a.UID, a.Transport = id, fmt.Sprintf("synthetic%d", i), 10000+i, fmt.Sprintf("ssh-%d", i)
			a.Lease = Millis() + 15000
			if i >= healthy {
				a.Deadline, a.Lease = Millis()-1, 0
				// Fixture stands in for an already verified signed timing result.
				a.TimingVerifiedAt = Millis()
				a.TimingVerifiedDeadline = a.Deadline
			}
			e.state.Attempts[id] = &a
			e.state.Registrations[a.Transport] = a.Username
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	// Incompressible saved files exercise real archive IO, not empty placeholders.
	data := make([]byte, 4<<20)
	if _, err = rand.Read(data); err != nil {
		t.Fatal(err)
	}
	for _, id := range ids[healthy:] {
		dir := filepath.Join(e.Config.Work, id, "work")
		if err = os.MkdirAll(dir, 0700); err == nil {
			err = os.WriteFile(filepath.Join(dir, "debug-output"), data, 0600)
		}
		if err != nil {
			t.Fatal(err)
		}
	}
	delivery, err := New(e.Config)
	if err != nil {
		t.Fatal(err)
	}
	deliveryDone := make(chan error, 1)
	go func() { deliveryDone <- delivery.DeliverCallbacks() }()
	select {
	case <-httpBlocked:
	case <-time.After(5 * time.Second):
		t.Fatal("callback did not reach isolated TLS receiver")
	}
	blocked, release := make(chan struct{}), make(chan struct{})
	var firstTermination, releaseCleanup sync.Once
	defer releaseCleanup.Do(func() { close(release) })
	e.terminate = func(a *Attempt) error {
		firstTermination.Do(func() { close(blocked); <-release })
		if a.ID == ids[healthy] {
			return errors.New("synthetic termination refusal after protected collection")
		}
		return nil
	}
	tickDone := make(chan error, 1)
	started := time.Now()
	go func() { tickDone <- e.Tick() }()
	select {
	case <-blocked:
	case <-time.After(10 * time.Second):
		t.Fatal("collection did not reach termination")
	}
	other, err := New(e.Config)
	if err != nil {
		t.Fatal(err)
	}
	inspectDone := make(chan time.Duration, 1)
	go func() {
		at := time.Now()
		_, callErr := other.Call("inspect-attempt", Request{ID: ids[0]})
		if callErr != nil {
			t.Error(callErr)
		}
		inspectDone <- time.Since(at)
	}()
	type renewal struct {
		elapsed time.Duration
		err     error
	}
	renewals := make(chan renewal, healthy)
	for i, id := range ids[:healthy] {
		go func(i int, id string) {
			at := time.Now()
			c := Command{Audience: "class", Nonce: Token(), Expires: Millis() + 20000, Op: "renew-execution-lease", Username: fmt.Sprintf("synthetic%d", i), Transport: fmt.Sprintf("ssh-%d", i), Body: Request{ID: id}}
			_, callErr := other.Command(signedCommand(key, c), c.Username, c.Transport)
			renewals <- renewal{time.Since(at), callErr}
		}(i, id)
	}
	maxRenew := time.Duration(0)
	for range healthy {
		select {
		case r := <-renewals:
			if r.err != nil {
				t.Fatal(r.err)
			}
			if r.elapsed > maxRenew {
				maxRenew = r.elapsed
			}
		case <-time.After(5 * time.Second):
			t.Fatal("blocked cleanup delayed independent monitoring renewals")
		}
	}
	cutoffs := map[string]bool{}
	other.cutoff = func(a *Attempt) error { cutoffs[a.ID] = true; return nil }
	at := time.Now()
	if err = other.Cutoff(); err != nil {
		t.Fatal(err)
	}
	cutoffElapsed := time.Since(at)
	if len(cutoffs) != due {
		t.Fatalf("cut off %d attempts, want %d", len(cutoffs), due)
	}
	for _, id := range ids[:healthy] {
		if cutoffs[id] {
			t.Fatal("healthy attempt cut off")
		}
	}
	// Ordinary state inspection still waits for finalization's shared lock. Record
	// this known bottleneck explicitly; do not confuse isolated leases with a
	// guarantee that all management/admission operations are nonblocking.
	select {
	case <-inspectDone:
		t.Fatal("fixture did not hold the shared collection lock")
	case <-time.After(100 * time.Millisecond):
	}
	releaseCleanup.Do(func() { close(release) })
	if err = <-tickDone; err != nil {
		t.Fatal(err)
	}
	stateWait := <-inspectDone
	state, err := readStateSnapshot(e.Config.State)
	if err != nil {
		t.Fatal(err)
	}
	var maxLeaseAge time.Duration
	for i, id := range ids {
		a := state.Attempts[id]
		if i < healthy {
			if a.State != "ACTIVE" {
				t.Fatalf("healthy attempt %s: %s", id, a.State)
			}
			if err = other.applyExecutionLease(a); err != nil || a.Lease <= Millis() {
				t.Fatalf("lost acknowledged lease: %v", err)
			}
			age := time.Duration(Millis()-(a.Lease-15000)) * time.Millisecond
			if age > maxLeaseAge {
				maxLeaseAge = age
			}
		} else {
			m, readErr := ReadProtected(filepath.Join(e.Config.State, "submissions", id), a)
			if readErr != nil || !a.Protected || m.Checksum != a.Checksum {
				t.Fatalf("protected copy missing: %v", readErr)
			}
			want := "COMPLETED"
			if i == healthy {
				want = "COLLECTION_FAILED"
			}
			if a.State != want {
				t.Fatalf("cleanup status %s, want %s", a.State, want)
			}
		}
	}
	backlog := len(state.Events)
	if backlog <= healthy+due {
		t.Fatal("delayed callback did not retain transition backlog")
	}
	releaseHTTP.Do(func() { close(httpRelease) })
	if err = <-deliveryDone; err != nil {
		t.Fatal(err)
	}
	restarted, err := New(e.Config)
	if err != nil {
		t.Fatal(err)
	}
	for pass := 0; pass < 4; pass++ {
		if err = restarted.DeliverCallbacks(); err != nil {
			t.Fatal(err)
		}
	}
	state, err = readStateSnapshot(e.Config.State)
	if err != nil || len(state.Events) != 0 {
		t.Fatalf("callback backlog not drained: %v", err)
	}
	eventsMu.Lock()
	defer eventsMu.Unlock()
	for i, seq := range sequences {
		if seq != int64(i+1) {
			t.Fatal("callback sequence lost/duplicated/out of order", sequences)
		}
	}
	t.Logf("synthetic attempts=%d due=%d saved_bytes=%d renewal_max=%s lease_age_max=%s cutoff_pass=%s shared_inspection_wait=%s callback_backlog=%d total=%s", healthy+due, due, due*len(data), maxRenew, maxLeaseAge, cutoffElapsed, stateWait, backlog, time.Since(started))
}
