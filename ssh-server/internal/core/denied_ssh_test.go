package core

import (
	"bytes"
	"log"
	"os"
	"strings"
	"testing"
)

func TestDeniedSSHProofNeverExemptsAnArbitraryWriter(t *testing.T) {
	e, _, _ := finalFixture(t, "ACTIVE", Millis()+60000)
	a := inspectFinal(t, e)
	a.State = "COMPLETED"
	a.Protected = true
	a.UID = os.Getuid()
	a.DeniedSSHTransports = []DeniedSSHTransport{{Identity: "forged", Monitor: os.Getppid()}}
	t.Setenv("EXAM_ID", "exam")
	t.Setenv("EXAM_ATTEMPT_ID", finalID)
	if e.idleDeniedSSH(a, os.Getpid()) {
		t.Fatal("ordinary writer/forged variables accepted as SSH bridge")
	}
	if trustedSSHExecutable(os.Getpid()) {
		t.Fatal("test executable treated as trusted SSH")
	}
	if e.verifyReleaseWriters(a) == nil {
		t.Fatal("actual uncontained UID writer allowed at restoration")
	}
	a.State = "ACTIVE"
	if e.idleDeniedSSH(a, os.Getpid()) {
		t.Fatal("active exam used restoration exemption")
	}
}
func TestWritableDescriptorInspectionIncludesOpenDeletedFiles(t *testing.T) {
	file, err := os.CreateTemp(t.TempDir(), "writer-")
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	os.Remove(file.Name())
	writable, err := writableRegularDescriptor(os.Getpid())
	if err != nil || !writable {
		t.Fatalf("deleted open writer not recognized: %v %v", writable, err)
	}
}
func TestLocalDenialCannotInventSSHTransportProof(t *testing.T) {
	e, _, _ := finalFixture(t, "ACTIVE", Millis()+60000)
	if _, err := e.Call("finalize-attempt", Request{ID: finalID, Reason: "student finish"}); err != nil {
		t.Fatal(err)
	}
	if err := e.WithState(func() error {
		a := e.state.Attempts[finalID]
		e.recordDeniedSSH(a, os.Getpid())
		if len(a.DeniedSSHTransports) != 0 {
			t.Fatal("local non-SSH process created denial proof")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}
func TestCancellationLogsNativeFailureWithoutRequestContents(t *testing.T) {
	e, _, _ := finalFixture(t, "PREPARING", Millis()+60000)
	e.WithState(func() error {
		a := e.state.Attempts[finalID]
		a.Start = 0
		a.Deadline = 0
		a.OriginalDeadline = 0
		a.Units = []string{"invalid"}
		return nil
	})
	var logs bytes.Buffer
	old := log.Writer()
	log.SetOutput(&logs)
	defer log.SetOutput(old)
	_, err := e.Call("cancel-attempt", Request{ID: finalID, Reason: "synthetic-private-password"})
	if err == nil || !strings.Contains(logs.String(), "invalid recorded workload unit") {
		t.Fatalf("real failure not logged: %v %s", err, logs.String())
	}
	if !strings.Contains(logs.String(), finalID) || strings.Contains(logs.String(), "synthetic-private") {
		t.Fatal("bad cancellation diagnostic")
	}
}

func TestDeniedSSHProofIsPrivateCallbackBookkeeping(t *testing.T) {
	a := &Attempt{ID: finalID, DeniedSSHTransports: []DeniedSSHTransport{{Identity: "private-monitor-proof", Monitor: 123}}}
	if len(publicAttempt(a).DeniedSSHTransports) != 0 || len(a.DeniedSSHTransports) != 1 {
		t.Fatal("public callback leaked or destroyed private denied-SSH proof")
	}
}
