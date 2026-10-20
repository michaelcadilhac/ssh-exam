package core

import (
	"crypto/ed25519"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func leaseFixture(t *testing.T) (*Engine, ed25519.PrivateKey, Command) {
	t.Helper()
	e, _, _ := finalFixture(t, "ACTIVE", Millis()+5400000)
	key := commandKeys(t, e)
	if err := e.WithState(func() error {
		a := e.state.Attempts[finalID]
		a.Transport = "ssh-a"
		a.Lease = Millis() + 15000
		e.state.Registrations["ssh-a"] = "student"
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	return e, key, Command{Audience: "class", Nonce: Token(), Expires: Millis() + 20000, Op: "renew-execution-lease", Username: "student", Transport: "ssh-a", Body: Request{ID: finalID}}
}

func TestWatchdogRechecksRenewalAfterAnotherAttemptCleanupWait(t *testing.T) {
	e, key, cmd := leaseFixture(t)
	cleanupID := "98765432-1234-1234-1234-123456789abc"
	e.WithState(func() error {
		active := e.state.Attempts[finalID]
		active.Lease = Millis() + 1000
		v := *active
		v.ID = cleanupID
		v.UID = 1002
		v.Username = "cleanup-student"
		v.Deadline = Millis() - 1
		v.Lease = 0
		e.state.Attempts[cleanupID] = &v
		return nil
	})
	dir := filepath.Join(e.Config.Work, cleanupID, "work")
	os.MkdirAll(dir, 0700)
	os.WriteFile(filepath.Join(dir, "answer.txt"), []byte("saved"), 0600)
	blocked := make(chan struct{})
	release := make(chan struct{})
	done := make(chan error, 1)
	var once sync.Once
	e.quiesce = func(a *Attempt) error {
		if a.ID == cleanupID {
			once.Do(func() { close(blocked) })
			<-release
		}
		return nil
	}
	go func() { done <- e.Tick() }()
	<-blocked
	other, _ := New(e.Config)
	if _, err := other.Command(signedCommand(key, cmd), "student", "ssh-a"); err != nil {
		close(release)
		<-done
		t.Fatal(err)
	}
	time.Sleep(1100 * time.Millisecond) // old in-memory lease expires during cleanup
	close(release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	a := inspectFinal(t, e)
	if a.State != "ACTIVE" || a.Lease <= Millis() {
		t.Fatal("cleanup caused false monitoring expiry despite acknowledged renewal", a.State)
	}
}

func TestBlockedCleanupCannotBlockAnotherAttemptsSignedMonitoringRenewal(t *testing.T) {
	for _, fails := range []bool{false, true} {
		t.Run(map[bool]string{false: "cleanup", true: "failed-cleanup"}[fails], func(t *testing.T) {
			e, key, cmd := leaseFixture(t)
			cleanupID := "98765432-1234-1234-1234-123456789abc"
			if err := e.WithState(func() error {
				v := *e.state.Attempts[finalID]
				v.ID, v.State, v.UID, v.Username = cleanupID, "ACTIVE", 1002, "cleanup-student"
				v.Deadline, v.Lease = Millis()-1, 0
				e.state.Attempts[cleanupID] = &v
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			dir := filepath.Join(e.Config.Work, cleanupID, "work")
			if err := os.MkdirAll(dir, 0700); err != nil {
				t.Fatal(err)
			}
			os.WriteFile(filepath.Join(dir, "answer.txt"), []byte("saved work"), 0600)
			blocked := make(chan struct{})
			release := make(chan struct{})
			finished := make(chan error, 1)
			e.terminate = func(a *Attempt) error {
				if a.ID != cleanupID {
					return nil
				}
				close(blocked)
				<-release
				if fails {
					return errors.New("injected cleanup failure")
				}
				return nil
			}
			// Block the real protected finalization path, after its archive is
			// committed but before termination succeeds/fails, as in the incident.
			go func() {
				_, err := e.Call("finalize-attempt", Request{ID: cleanupID, Reason: "expiration"})
				finished <- err
			}()
			defer func() {
				close(release)
				err := <-finished
				if (err != nil) != fails {
					t.Errorf("unexpected cleanup outcome: %v", err)
				}
			}()
			<-blocked
			other, err := New(e.Config)
			if err != nil {
				t.Fatal(err)
			}
			result := make(chan error, 1)
			go func() { _, err := other.Command(signedCommand(key, cmd), "student", "ssh-a"); result <- err }()
			select {
			case err := <-result:
				if err != nil {
					t.Fatal(err)
				}
			case <-time.After(time.Second):
				t.Fatal("another attempt's collection blocked monitoring")
			}
			// The durable independent lease is consumed by the watchdog after it gets
			// the shared state lock; a restart must not lose a confirmed renewal.
			lease, err := os.ReadFile(filepath.Join(e.Config.State, "leases", finalID+".json"))
			if err != nil || len(lease) == 0 {
				t.Fatal("renewal not durable", err)
			}
			if _, err = other.Command(signedCommand(key, cmd), "student", "ssh-a"); err == nil {
				t.Fatal("renewal replay accepted while collection blocked")
			}
		})
	}
}

func TestSignedLeaseRejectsScopeReplayAndRevocationAcrossRestart(t *testing.T) {
	e, key, cmd := leaseFixture(t)
	if _, err := e.Command(signedCommand(key, cmd), "student", "ssh-a"); err != nil {
		t.Fatal(err)
	}
	restarted, _ := New(e.Config)
	if _, err := restarted.Command(signedCommand(key, cmd), "student", "ssh-a"); err == nil {
		t.Fatal("replay after restart")
	}
	for _, kind := range []string{"transport", "owner", "signature", "nonce-expiry", "generation", "pause", "finish", "deadline", "boot", "registration"} {
		t.Run(kind, func(t *testing.T) {
			x, k, c := leaseFixture(t)
			c.Nonce = Token()
			peer, transport := "student", "ssh-a"
			switch kind {
			case "transport":
				transport = "other"
			case "owner":
				peer = "other"
			case "signature":
				k = append(ed25519.PrivateKey(nil), key...)
			case "nonce-expiry":
				c.Expires = Millis() - 1
			default:
				x.WithState(func() error {
					a := x.state.Attempts[finalID]
					switch kind {
					case "generation":
						a.Generation++
						a.Lease = 0
					case "pause":
						a.State = "LOCKED"
					case "finish":
						a.State = "COMPLETED"
					case "deadline":
						a.Deadline = Millis() - 1
					case "boot":
						a.Boot = "old-boot"
					case "registration":
						delete(x.state.Registrations, "ssh-a")
					}
					return nil
				})
			}
			if _, err := x.Command(signedCommand(k, c), peer, transport); err == nil {
				t.Fatal("revoked or forged renewal accepted")
			}
		})
	}
}

func TestOldLeaseCannotReviveNewPauseOrTransportGeneration(t *testing.T) {
	e, key, cmd := leaseFixture(t)
	if _, err := e.Command(signedCommand(key, cmd), "student", "ssh-a"); err != nil {
		t.Fatal(err)
	}
	for _, kind := range []string{"pause", "generation", "transport"} {
		a := &Attempt{ID: finalID, Username: "student", Transport: "ssh-a", Generation: 0, Boot: boot(), State: "ACTIVE", Lease: 0}
		switch kind {
		case "pause":
			a.State = "LOCKED"
		case "generation":
			a.Generation++
		case "transport":
			a.Transport = "new"
		}
		if err := e.applyExecutionLease(a); err != nil {
			t.Fatal(err)
		}
		if a.Lease != 0 {
			t.Fatal("old renewal revived a revoked attempt", kind)
		}
	}
}

func TestRejectedRenewalCarriesOnlyAuthenticatedAttemptState(t *testing.T) {
	for _, state := range []string{"LOCKED", "FINALIZING", "COMPLETED", "CANCELLED_BEFORE_START"} {
		t.Run(state, func(t *testing.T) {
			e, key, cmd := leaseFixture(t)
			e.WithState(func() error {
				a := e.state.Attempts[finalID]
				a.State = state
				a.Generation++
				a.Reason = "administrator: approved transfer"
				return nil
			})
			result, err := e.Command(signedCommand(key, cmd), "student", "ssh-a")
			if err == nil {
				t.Fatal("transitioned workload was renewed")
			}
			a, ok := result.(*Attempt)
			if !ok || a.State != state || a.Reason != "administrator: approved transfer" || a.Generation != 1 {
				t.Fatalf("missing authenticated rejection state: %#v %v", result, err)
			}
			cmd.Nonce = Token()
			if result, err := e.Command(signedCommand(key, cmd), "other", "ssh-a"); err == nil || result != nil {
				t.Fatal("another account received attempt state")
			}
		})
	}
}

func TestCancellationCannotRetireStartedAttemptDuringRenewal(t *testing.T) {
	e, key, cmd := leaseFixture(t)
	if _, err := e.Admin("cancel", finalID, "Synthetic attempted cancellation"); err == nil {
		t.Fatal("started attempt cancelled")
	}
	if _, err := e.Command(signedCommand(key, cmd), "student", "ssh-a"); err != nil {
		t.Fatal("refused cancellation incorrectly interrupted renewal", err)
	}
}
