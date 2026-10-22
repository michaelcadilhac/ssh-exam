package core

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"
)

func TestNativeManagementAuditBusyRefusesBeforePaneRevocation(t *testing.T) {
	e, _, _, token, _ := paneAdmissionFixture(t)
	view := observeTestPane(t, e, finalID)
	path := filepath.Join(e.Config.State, "audit.ndjson")
	f, err := os.OpenFile(path, os.O_RDWR|os.O_CREATE, 0600)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		t.Fatal(err)
	}
	before, _ := os.ReadFile(path)
	started := time.Now()
	_, err = e.closeNativePaneReviewed(finalID, finalID, view.Revision, "Do not bypass busy native audit")
	if err == nil || time.Since(started) > time.Second {
		t.Fatal("busy audit permitted close or waited unboundedly", err)
	}
	state, err := readStateSnapshot(e.Config.State)
	if err != nil {
		t.Fatal(err)
	}
	if _, retained := state.Caps[Hash([]byte(token))]; !retained {
		t.Fatal("busy audit allowed pane revocation")
	}
	after, _ := os.ReadFile(path)
	if !bytes.Equal(before, after) {
		t.Fatal("busy audit was modified")
	}
}

func TestNativeManagementAuditConcurrentCompleteRecordsPreservePartialTail(t *testing.T) {
	e := &Engine{Config: Config{State: nativeFixtureDir(t)}}
	path := filepath.Join(e.Config.State, "audit.ndjson")
	partial := []byte(`{"interrupted":`)
	if err := os.WriteFile(path, partial, 0600); err != nil {
		t.Fatal(err)
	}
	const writers = 24
	var wg sync.WaitGroup
	errors := make(chan error, writers)
	start := make(chan struct{})
	for i := 0; i < writers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			deadline := time.Now().Add(5 * time.Second)
			for {
				err := e.appendNativeManagementAudit(map[string]any{"action": "synthetic-audit", "writer": i, "reason": strings.Repeat("x", 1000)})
				if err == nil {
					return
				}
				if !strings.Contains(err.Error(), "audit busy") || time.Now().After(deadline) {
					errors <- fmt.Errorf("writer %d: %w", i, err)
					return
				}
				time.Sleep(time.Millisecond)
			}
		}(i)
	}
	close(start)
	wg.Wait()
	close(errors)
	for err := range errors {
		t.Error(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	lines := bytes.Split(data, []byte{'\n'})
	if len(lines) != writers+2 || !bytes.Equal(lines[0], partial) || len(lines[len(lines)-1]) != 0 {
		t.Fatal("partial history lost or complete records joined", len(lines))
	}
	seen := map[int]bool{}
	for _, line := range lines[1 : len(lines)-1] {
		var event struct {
			Writer int    `json:"writer"`
			Reason string `json:"reason"`
		}
		if err := json.Unmarshal(line, &event); err != nil || len(event.Reason) != 1000 || seen[event.Writer] || event.Writer < 0 || event.Writer >= writers {
			t.Fatal("interleaved/duplicate/malformed audit record", err)
		}
		seen[event.Writer] = true
	}
}
