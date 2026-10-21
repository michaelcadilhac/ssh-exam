package core

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
)

func workspaceRetentionFixture(t *testing.T) (*Engine, string) {
	t.Helper()
	e, err := New(Config{State: t.TempDir(), Work: t.TempDir(), Templates: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	id := "11111111-1111-4111-8111-111111111111"
	base := filepath.Join(e.Config.Work, id)
	if err := os.MkdirAll(filepath.Join(base, "work"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(base, "work", "answer.txt"), []byte("synthetic saved answer"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := e.WithState(func() error {
		e.state.Attempts[id] = &Attempt{ID: id, Exam: "midterm", Username: "synthetic", UID: 29999, State: "COMPLETED", Start: 1,
			Ended: Millis() - 1, Deadline: Millis() + 3600000, OriginalDeadline: Millis() + 7200000, AccessState: "HELD",
			Protected: true, Checksum: strings.Repeat("a", 64), WorkPath: filepath.Join(base, "work")}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	return e, id
}

func TestWorkspaceRetentionMetadataNeverClaimsFreshEligibilityOrReleasesHold(t *testing.T) {
	e, id := workspaceRetentionFixture(t)
	var before []byte
	if err := e.WithState(func() error { before, _ = json.Marshal(e.state.Attempts[id]); return nil }); err != nil {
		t.Fatal(err)
	}
	v, err := e.WorkspaceRetention(id)
	if err != nil || !v.Candidate || v.Eligible || v.ArchiveVerified || !v.Base.Exists || !v.Work.Directory || v.Hold.Revision != 0 {
		t.Fatal("metadata confused with proof", v, err)
	}
	if _, err := os.Lstat(e.workspaceRetentionDirectory()); !os.IsNotExist(err) {
		t.Fatal("inspection created hold metadata", err)
	}
	var after []byte
	if err := e.WithState(func() error { after, _ = json.Marshal(e.state.Attempts[id]); return nil }); err != nil {
		t.Fatal(err)
	}
	if string(before) != string(after) {
		t.Fatal("inspection changed attempt authority")
	}
	if got, err := os.ReadFile(filepath.Join(v.Path, "work", "answer.txt")); err != nil || string(got) != "synthetic saved answer" {
		t.Fatal("inspection changed saved work", err)
	}
	if err := e.WithState(func() error { a := e.state.Attempts[id]; a.State = "COLLECTION_FAILED"; return nil }); err != nil {
		t.Fatal(err)
	}
	failed, err := e.WorkspaceRetention(id)
	if err != nil || failed.Candidate || len(failed.Blockers) == 0 || !failed.RecordedProtected {
		t.Fatal("protected failed work became eligible", failed, err)
	}
}

func TestWorkspaceHoldsSurviveRestartOldStateWritersAndStaleRelease(t *testing.T) {
	e, id := workspaceRetentionFixture(t)
	h, err := e.SetWorkspaceHold(id, true, 0, "Preserve for explicit operator review")
	if err != nil || !h.Held || h.Revision != 1 {
		t.Fatal(h, err)
	}
	fresh, err := New(e.Config)
	if err != nil {
		t.Fatal(err)
	}
	// A state.json writer which knows nothing about retention files cannot drop it.
	if err := fresh.WithState(func() error { return nil }); err != nil {
		t.Fatal(err)
	}
	status, err := fresh.WorkspaceRetention(id)
	if err != nil || !status.Hold.Held || status.Candidate || status.Hold.Revision != 1 {
		t.Fatal(status, err)
	}
	for _, held := range []bool{true, false} {
		if _, err := fresh.SetWorkspaceHold(id, held, 0, "Stale retry must preserve a later hold"); err == nil {
			t.Fatal("stale control accepted")
		}
	}
	same, err := fresh.WorkspaceRetention(id)
	if err != nil || same.Hold != h {
		t.Fatal("stale control changed hold", same, err)
	}
	released, err := fresh.SetWorkspaceHold(id, false, 1, "Explicit review confirms hold can be released")
	if err != nil || released.Held || released.Revision != 2 {
		t.Fatal(released, err)
	}
	v, err := fresh.WorkspaceRetention(id)
	if err != nil || !v.Candidate || v.Eligible || v.ArchiveVerified || v.AccessState != "HELD" || v.Deadline <= 0 || v.OriginalDeadline <= v.Deadline {
		t.Fatal("hold release changed independent authority", v, err)
	}
	audit, err := os.ReadFile(filepath.Join(e.Config.State, "audit.ndjson"))
	if err != nil || !strings.Contains(string(audit), "workspace-hold-intent") || !strings.Contains(string(audit), "workspace-release-hold-intent") {
		t.Fatal("missing durable control intent", err)
	}
}

func TestWorkspaceHoldAuditFailureAndUnsafeMetadataCannotClearRetention(t *testing.T) {
	e, id := workspaceRetentionFixture(t)
	audit := filepath.Join(e.Config.State, "audit.ndjson")
	if err := os.Mkdir(audit, 0700); err != nil {
		t.Fatal(err)
	}
	if _, err := e.SetWorkspaceHold(id, true, 0, "Audit must persist before hold publication"); err == nil {
		t.Fatal("unrecorded hold acknowledged")
	}
	path := filepath.Join(e.workspaceRetentionDirectory(), id+".json")
	if _, err := os.Lstat(path); !os.IsNotExist(err) {
		t.Fatal("failed audit published a hold", err)
	}
	entries, err := os.ReadDir(e.workspaceRetentionDirectory())
	if err != nil || len(entries) != 0 {
		t.Fatal("unpublished temporary record retained", entries, err)
	}
	if err := os.Remove(audit); err != nil {
		t.Fatal(err)
	}
	if _, err := e.SetWorkspaceHold(id, true, 0, "Protected operator hold for malformed-record test"); err != nil {
		t.Fatal(err)
	}
	valid, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(t.TempDir(), "outside.json")
	if err := os.WriteFile(outside, []byte("outside sentinel"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, path); err != nil {
		t.Fatal(err)
	}
	if _, err := e.SetWorkspaceHold(id, false, 1, "Must refuse a symbolic link record"); err == nil {
		t.Fatal("followed symlink")
	}
	if b, err := os.ReadFile(outside); err != nil || string(b) != "outside sentinel" {
		t.Fatal("outside record changed", err)
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, valid, 0600); err != nil {
		t.Fatal(err)
	}
	link := path + "-linked"
	if err := os.Link(path, link); err != nil {
		t.Fatal(err)
	}
	if _, err := e.SetWorkspaceHold(id, false, 1, "Must refuse a multiply-linked hold record"); err == nil {
		t.Fatal("accepted hard-linked hold")
	}
	if err := os.Remove(link); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("malformed private retention data"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := e.SetWorkspaceHold(id, false, 1, "Must preserve malformed hold metadata"); err == nil || !strings.Contains(err.Error(), "malformed") {
		t.Fatal(err)
	}
	if got, err := os.ReadFile(path); err != nil || string(got) != "malformed private retention data" {
		t.Fatal("malformed record overwritten", err)
	}
}

func TestWorkspaceInventoryBoundsAndUnsafeParentsStayPreserved(t *testing.T) {
	e, id := workspaceRetentionFixture(t)
	second := "22222222-2222-4222-8222-222222222222"
	if err := e.WithState(func() error {
		e.state.Attempts[second] = &Attempt{ID: second, Exam: "other", Username: "other", UID: 29998, State: "PREPARING"}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	page, err := e.WorkspaceRetentions("", "", 1)
	if err != nil || len(page.Workspaces) != 1 || page.Next != id {
		t.Fatal(page, err)
	}
	next, err := e.WorkspaceRetentions("", page.Next, 1)
	if err != nil || len(next.Workspaces) != 1 || next.Workspaces[0].Attempt != second || next.Next != "" || next.Workspaces[0].Candidate {
		t.Fatal(next, err)
	}
	for _, limit := range []int{0, 201} {
		if _, err := e.WorkspaceRetentions("", "", limit); err == nil {
			t.Fatal("unbounded page accepted")
		}
	}
	base := filepath.Join(e.Config.Work, id)
	if err := os.Rename(base, base+"-preserved"); err != nil {
		t.Fatal(err)
	}
	outside := t.TempDir()
	if err := os.Symlink(outside, base); err != nil {
		t.Fatal(err)
	}
	unsafe, err := e.WorkspaceRetention(id)
	if err != nil || unsafe.Candidate || !unsafe.Base.Symlink || unsafe.Work.Exists {
		t.Fatal("unsafe parent traversed", unsafe, err)
	}
	if err := e.WithState(func() error { e.state.Attempts[id].ID = second; return nil }); err != nil {
		t.Fatal(err)
	}
	if _, err := e.SetWorkspaceHold(id, true, 0, "Corrupt attempt identity cannot create a hold"); err == nil {
		t.Fatal("mismatched attempt key accepted")
	}
	if _, err := e.WorkspaceRetentions("", "", 10); err == nil {
		t.Fatal("mismatched inventory identity accepted")
	}
}

func TestWorkspaceHoldMetadataLossNeverMeansReleased(t *testing.T) {
	e, id := workspaceRetentionFixture(t)
	if _, err := e.SetWorkspaceHold(id, true, 0, "Must survive metadata publication and storage loss"); err != nil {
		t.Fatal(err)
	}
	parent := e.workspaceRetentionDirectory()
	path := filepath.Join(parent, id+".json")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if _, err := e.WorkspaceRetention(id); err == nil || !strings.Contains(err.Error(), "missing") {
		t.Fatal("missing hold became unheld", err)
	}
	if _, err := e.SetWorkspaceHold(id, false, 0, "Missing metadata is not permission to release"); err == nil {
		t.Fatal("missing metadata overwritten")
	}
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(parent, parent+"-preserved"); err != nil {
		t.Fatal(err)
	}
	if _, err := e.WorkspaceRetention(id); err == nil || !strings.Contains(err.Error(), "disappeared") {
		t.Fatal("lost hold directory became unheld", err)
	}
	if err := os.Rename(parent+"-preserved", parent); err != nil {
		t.Fatal(err)
	}
	known := filepath.Join(e.Config.State, "workspace-retention-"+id+".known")
	if err := os.Remove(known); err != nil {
		t.Fatal(err)
	}
	v, err := e.WorkspaceRetention(id)
	if err != nil || !v.Hold.Held || v.Candidate || !strings.Contains(strings.Join(v.Blockers, " "), "incomplete") {
		t.Fatal("interrupted loss-marker publication bypassed hold", v, err)
	}
	if _, err := e.SetWorkspaceHold(id, true, 1, "Reaffirm intact hold after incomplete marker publication"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(known); err != nil {
		t.Fatal("loss marker not repaired", err)
	}
}

func TestWorkspaceSpecialMetadataNeverBlocksAnUnrelatedControlPath(t *testing.T) {
	e, id := workspaceRetentionFixture(t)
	if _, err := e.SetWorkspaceHold(id, true, 0, "Preserve before synthetic special-file corruption"); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(e.workspaceRetentionDirectory(), id+".json")
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if err := syscall.Mkfifo(path, 0600); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { _, err := e.WorkspaceRetention(id); done <- err }()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("accepted FIFO metadata")
		}
	case <-time.After(time.Second):
		t.Fatal("metadata FIFO blocked inspection")
	}
	// The target job/state lock must have been released, not strand healthy work.
	if err := e.WithState(func() error { return nil }); err != nil {
		t.Fatal(err)
	}
}

func TestWorkspaceHoldBusyRefusalIsNotAnAcknowledgedOrQueuedChange(t *testing.T) {
	e, id := workspaceRetentionFixture(t)
	lock, err := e.attemptCollectionLock(id)
	if err != nil {
		t.Fatal(err)
	}
	defer lock.Close()
	start := time.Now()
	_, err = e.SetWorkspaceHold(id, true, 0, "A busy worker must not silently queue a hold")
	if err == nil || !strings.Contains(err.Error(), "NOT accepted or queued") || time.Since(start) > time.Second {
		t.Fatal("misleading/blocking busy control", err)
	}
	if _, err := os.Stat(e.workspaceRetentionDirectory()); !os.IsNotExist(err) {
		t.Fatal("busy hold changed retention records", err)
	}
	if err := e.WithState(func() error { return nil }); err != nil {
		t.Fatal("busy attempt blocked shared state", err)
	}
	lock.Close()
	if _, err := e.SetWorkspaceHold(id, true, 0, "Reviewed retry after prior job completed"); err != nil {
		t.Fatal(err)
	}
}
