package core

import (
	"os"
	"path/filepath"
	"testing"
)

func TestPersistAndUIDGuard(t *testing.T) {
	c := Config{State: t.TempDir()}
	e, _ := New(c)
	err := e.WithState(func() error {
		e.state.Attempts["a"] = &Attempt{UID: 1001, State: "COLLECTION_FAILED", Deadline: 10}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	second, _ := New(c)
	second.WithState(func() error {
		if second.Busy(1001) == nil {
			t.Fatal("collection failure released guard")
		}
		if second.state.Attempts["a"].Deadline != 10 {
			t.Fatal("deadline lost")
		}
		return nil
	})
	if _, err := os.Stat(filepath.Join(c.State, "state.json")); err != nil {
		t.Fatal(err)
	}
}
func TestCapabilityStoredHashedAndExpired(t *testing.T) {
	e, _ := New(Config{State: t.TempDir()})
	e.WithState(func() error {
		r := e.issue(Capability{Expires: Millis() - 1}).(map[string]string)
		if _, ok := e.state.Caps[r["token"]]; ok {
			t.Fatal("capability persisted as plaintext")
		}
		e.issue(Capability{Expires: Millis() + 10000})
		if len(e.state.Caps) != 1 {
			t.Fatal("expired capability not removed")
		}
		return nil
	})
}
