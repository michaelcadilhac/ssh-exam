package core

import (
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestFunctionalModeIsSingleAccountExplicitAndNeverProductionReady(t *testing.T) {
	e, _ := New(Config{State: t.TempDir(), FunctionalTestAccount: "admin", FunctionalTestUntil: Millis() + 60000, Accounts: map[string]Account{"admin": {UID: 1001}}})
	if !e.functionalAccount(&Attempt{Username: "admin", UID: 1001}) || e.functionalAccount(&Attempt{Username: "other", UID: 1001}) || e.functionalAccount(&Attempt{Username: "admin", UID: 1002}) {
		t.Fatal("functional exception escaped approved identity")
	}
	ready, missing := e.productionReady()
	if ready || !strings.Contains(strings.Join(missing, " "), "never qualifies") {
		t.Fatal("privileged test qualified production")
	}
	health, err := e.Call("health", Request{})
	if err != nil {
		t.Fatal(err)
	}
	if h := health.(map[string]any); h["functional_test"] != true || h["production_ready"] != false {
		t.Fatalf("unsafe health label %v", h)
	}
	e.Config.FunctionalTestUntil = Millis() - 1
	ready, missing = e.Ready()
	if ready || !strings.Contains(strings.Join(missing, " "), "expired") {
		t.Fatal("expired test admitted")
	}
	e.Config.Accounts["other"] = Account{UID: 1002}
	if e.functionalAccount(&Attempt{Username: "admin", UID: 1001}) {
		t.Fatal("multiple identities got test bypass")
	}
}
func TestFunctionalConfigurationRejectsImplicitOrMultipleAccountExceptions(t *testing.T) {
	c := Config{State: "/state", Work: "/work", Rootfs: "/rootfs", Accounts: map[string]Account{"admin": {UID: 1001, GID: 1001, Shell: "/bin/bash", Home: "/home/admin"}}, FunctionalTestAccount: "admin", FunctionalTestUntil: Millis() + 60000}
	tempEngine, _ := New(Config{State: t.TempDir()})
	key := commandKeys(t, tempEngine)
	c.AgentID = "class"
	c.GatewayPublicKey = tempEngine.Config.GatewayPublicKey
	c.CallbackURL = "https://exam.example.edu"
	c.CallbackKey = filepath.Join(t.TempDir(), "agent.key")
	b, _ := x509.MarshalPKCS8PrivateKey(key)
	os.WriteFile(c.CallbackKey, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: b}), 0600)
	path := filepath.Join(t.TempDir(), "config.json")
	save := func() { b, _ := json.Marshal(c); os.WriteFile(path, b, 0600) }
	save()
	if _, err := LoadConfig(path); err != nil {
		t.Fatal(err)
	}
	c.FunctionalHostAccess = true
	c.FunctionalTestAccount = ""
	save()
	if _, err := LoadConfig(path); err == nil {
		t.Fatal("unrestricted production host access accepted")
	}
	c.FunctionalTestAccount = "admin"
	save()
	if _, err := LoadConfig(path); err != nil {
		t.Fatal(err)
	}
	c.FunctionalTestUntil = 0
	save()
	if _, err := LoadConfig(path); err == nil {
		t.Fatal("unbounded exception accepted")
	}
	c.FunctionalTestUntil = Millis() + 60000
	c.Accounts["other"] = Account{UID: 1002, GID: 1002, Shell: "/bin/bash", Home: "/home/other"}
	save()
	if _, err := LoadConfig(path); err == nil {
		t.Fatal("multiple accounts accepted")
	}
	delete(c.Accounts, "other")
	for _, directory := range []string{"/tmp", "/tmp/project", "/var", "/var/tmp", "/var/tmp/project"} {
		c.ExamDirectory = directory
		save()
		if _, err := LoadConfig(path); err == nil {
			t.Fatalf("work directory overlaps private temporary mount: %s", directory)
		}
	}
	c.ExamDirectory = "/var/exam"
	save()
	if _, err := LoadConfig(path); err != nil {
		t.Fatal("unrelated /var work directory rejected", err)
	}
}
func TestFunctionalCollectorFreezesOnlyRecordedScopesAndPreservesManifestLabel(t *testing.T) {
	e, c, _ := finalFixture(t, "ACTIVE", Millis()+5400000)
	e.Config.FunctionalTestAccount = "student"
	e.Config.FunctionalTestUntil = Millis() + 60000
	e.Config.Accounts = map[string]Account{"student": {UID: 1001}}
	e.WithState(func() error { e.state.Attempts[finalID].FunctionalTest = true; return nil })
	if _, err := e.Call("finalize-attempt", Request{ID: finalID, Reason: "student finish"}); err != nil {
		t.Fatal(err)
	}
	a := inspectFinal(t, e)
	manifest, err := ReadProtected(filepath.Join(c.State, "submissions", finalID), a)
	if err != nil || !manifest.Attempt.FunctionalTest || a.AccessState != "HELD" {
		t.Fatalf("test attribution/deadline lost %v %+v", err, a)
	}
}
