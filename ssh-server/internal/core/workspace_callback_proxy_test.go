package core

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"encoding/pem"
	"errors"
	"io"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// The fresh coordinator avoids net/http's process-wide environment cache.
// Each actual worker starts with an empty environment, as systemd services do.
// TLS, CONNECT, signatures, worker framing and staging/collection are real;
// account admission and writer containment retain the existing synthetic hooks.
func TestWorkspaceWorkerRetainsCallbackRoute(t *testing.T) {
	const marker = "EXAM_TEST_WORKSPACE_PROXY_COORDINATOR"
	if os.Getenv(marker) != "1" {
		cmd := exec.Command(os.Args[0], "-test.run=^TestWorkspaceWorkerRetainsCallbackRoute$", "-test.v")
		cmd.Env = append(os.Environ(), marker+"=1")
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("isolated proxy coordinator: %v\n%s", err, output)
		} else {
			t.Log(string(output))
		}
		return
	}
	for _, key := range []string{"HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy", "NO_PROXY", "no_proxy"} {
		t.Setenv(key, "")
	}
	// The same proxy serves both scenarios because Go caches the chosen env.
	var target atomic.Value
	var available atomic.Bool
	var connects atomic.Int32
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		connects.Add(1)
		if r.Method != "CONNECT" || r.Host != "policy.fixture.invalid:443" {
			t.Error("unexpected proxy destination or method", r.Method, r.Host)
			w.WriteHeader(http.StatusForbidden)
			return
		}
		if !available.Load() {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		upstream, err := net.DialTimeout("tcp", target.Load().(string), time.Second)
		if err != nil {
			t.Error(err)
			w.WriteHeader(http.StatusBadGateway)
			return
		}
		defer upstream.Close()
		client, buffered, err := w.(http.Hijacker).Hijack()
		if err != nil {
			t.Error(err)
			return
		}
		defer client.Close()
		_ = client.SetDeadline(time.Now().Add(10 * time.Second))
		_ = upstream.SetDeadline(time.Now().Add(10 * time.Second))
		_, _ = buffered.WriteString("HTTP/1.1 200 Connection established\r\n\r\n")
		_ = buffered.Flush()
		done := make(chan struct{})
		go func() { _, _ = io.Copy(upstream, buffered); close(done) }()
		_, _ = io.Copy(client, upstream)
		_ = client.Close()
		_ = upstream.Close()
		<-done
	}))
	defer proxy.Close()
	t.Setenv("HTTPS_PROXY", proxy.URL)

	for _, kind := range []string{"starter", "saved"} {
		t.Run(kind, func(t *testing.T) {
			var e *Engine
			id := finalID
			var archive, claim string
			var original []byte
			if kind == "starter" {
				e, _ = workspaceFixture(t)
			} else {
				var a *Attempt
				var recovery RecoveryPreparation
				e, a, recovery = recoveryFixture(t)
				id = a.ID
				if err := e.WithState(func() error {
					a.PreflightStartedAt, a.Transport = Millis(), "ssh-a"
					a.Settings.Earliest, a.Settings.Latest, a.Settings.Terminals = Millis()-1000, Millis()+600000, 4
					e.state.Attempts[a.ID] = a
					e.state.Registrations[a.Transport] = a.Username
					return nil
				}); err != nil {
					t.Fatal(err)
				}
				archive = filepath.Join(e.Config.State, "submissions", recovery.SourceAttempt, "submission.tar.gz")
				claim = filepath.Join(e.Config.State, recoveryName(a)+".consumed")
				var err error
				original, err = os.ReadFile(archive)
				if err != nil {
					t.Fatal(err)
				}
			}
			gateway := commandKeys(t, e)
			e.Config.Accounts["student"] = Account{UID: os.Getuid(), GID: os.Getgid()}
			native, private, err := ed25519.GenerateKey(rand.Reader)
			if err != nil {
				t.Fatal(err)
			}
			key, err := x509.MarshalPKCS8PrivateKey(private)
			if err != nil {
				t.Fatal(err)
			}
			e.Config.CallbackKey = filepath.Join(t.TempDir(), "native.key")
			if err := os.WriteFile(e.Config.CallbackKey, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: key}), 0600); err != nil {
				t.Fatal(err)
			}
			certificate := &x509.Certificate{SerialNumber: big.NewInt(1), DNSNames: []string{"policy.fixture.invalid"}, NotBefore: time.Now().Add(-time.Minute), NotAfter: time.Now().Add(time.Hour), IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign | x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}}
			der, err := x509.CreateCertificate(rand.Reader, certificate, certificate, native, private)
			if err != nil {
				t.Fatal(err)
			}
			policy := executionPolicyFixtureRoute(t, e, native, gateway)
			var verified atomic.Int32
			server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				verified.Add(1)
				if !policy(w, r) {
					w.WriteHeader(http.StatusNotFound)
				}
			}))
			server.TLS = &tls.Config{MinVersion: tls.VersionTLS13, Certificates: []tls.Certificate{{Certificate: [][]byte{der}, PrivateKey: private}}}
			server.StartTLS()
			defer server.Close()
			target.Store(server.Listener.Addr().String())
			e.Config.CallbackURL = "https://policy.fixture.invalid"
			e.Config.CallbackCA = filepath.Join(t.TempDir(), "policy-ca.pem")
			if err := os.WriteFile(e.Config.CallbackCA, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), 0600); err != nil {
				t.Fatal(err)
			}
			managerProxy := ""
			e.workerCommand = func(string) []string {
				if os.Getenv("EXAM_COLLECTION_USER_SYSTEMD") == "1" {
					unit := "ssh-exam-route-test-" + Token()[:12] + ".service"
					t.Cleanup(func() {
						_ = exec.Command("/usr/bin/systemctl", "--user", "stop", unit).Run()
						out, _ := exec.Command("/usr/bin/systemctl", "--user", "show", unit, "--property=ActiveState,MainPID").Output()
						if !strings.Contains(string(out), "ActiveState=inactive") || !strings.Contains(string(out), "MainPID=0") {
							t.Error("owned worker unit did not stop", unit, string(out))
						}
					})
					base := collectionServiceArgs(unit, os.Args[0])
					args := []string{base[0], "--user"}
					if managerProxy != "" {
						args = append(args, "--setenv=HTTPS_PROXY="+managerProxy)
					}
					for _, arg := range base[1:] {
						if arg == "--property=Slice=exam-collection.slice" {
							continue // Owned local user manager, never the production slice.
						}
						if arg == collectionWorkerFlag {
							args = append(args, "-test.run=^TestCollectionChild$", "--", "success")
							continue
						}
						args = append(args, arg)
					}
					return args
				}
				args := []string{"/usr/bin/env", "-i", "PATH=/usr/bin:/bin"}
				if managerProxy != "" {
					args = append(args, "HTTPS_PROXY="+managerProxy)
				}
				return append(args, os.Args[0], "-test.run=^TestCollectionChild$", "--", "success")
			}
			e.workerTimeout = 15 * time.Second
			e.collectionRun = e.runCollectionProcess
			prepare := func() error {
				cmd := Command{Audience: "class", Nonce: Token(), Expires: Millis() + 20000, Op: "prepare-workspace", Username: "student", Transport: "ssh-a", Body: Request{ID: id}}
				_, err := e.Command(signedCommand(gateway, cmd), "student", "ssh-a")
				return err
			}
			available.Store(false)
			if err := prepare(); err == nil || !strings.Contains(err.Error(), errExecutionPolicy.Error()) {
				t.Fatal("unavailable proxy did not refuse preparation", err)
			}
			a := assertUnstartedWorkspace(t, e, id)
			if a.Workspace != nil || verified.Load() != 0 {
				t.Fatal("failed transport created a workspace or reached policy authority")
			}
			available.Store(true)
			// A direct/NO_PROXY decision must not be replaced by an unrelated
			// proxy inherited from the worker's service manager.
			direct := ""
			e.callbackProxyOverride = &direct
			managerProxy = proxy.URL
			beforeDirect := connects.Load()
			if err := prepare(); err == nil || !strings.Contains(err.Error(), errExecutionPolicy.Error()) {
				t.Fatal("worker replaced an explicit direct route", err)
			}
			assertUnstartedWorkspace(t, e, id)
			if connects.Load() != beforeDirect {
				t.Fatal("worker used its manager's proxy despite the coordinator's direct route")
			}
			e.callbackProxyOverride, managerProxy = nil, ""
			if err := prepare(); err != nil {
				t.Fatal("worker lost coordinator proxy on retry", err)
			}
			a = assertUnstartedWorkspace(t, e, id)
			if a.Workspace == nil || verified.Load() < 1 || connects.Load() < 2 {
				t.Fatal("staging did not obtain a freshly signed policy through CONNECT")
			}
			if kind == "saved" {
				if _, err := os.Stat(claim); !os.IsNotExist(err) {
					t.Fatal("preflight consumed the saved-work allowance", err)
				}
				if after, err := os.ReadFile(archive); err != nil || !bytes.Equal(after, original) {
					t.Fatal("preflight changed the protected source", err)
				}
			}
			e.activationPrepare = func(*Attempt) error { return nil }
			before := Millis()
			result, err := e.Call("activate-attempt", Request{ID: id})
			if err != nil {
				t.Fatal("actual Begin after repaired transport", err)
			}
			active := result.(*Attempt)
			if active.Start < before || active.Deadline-active.Start != active.Settings.Duration*1000 || active.OriginalDeadline != active.Deadline {
				t.Fatal("retry consumed allowance before actual Begin")
			}
			result, err = e.Call("finalize-attempt", Request{ID: id, Reason: "Synthetic proxy collection verification"})
			if err != nil || result.(*Attempt).State != "COMPLETED" || !result.(*Attempt).Protected {
				t.Fatal("isolated collection lost the same proxy route", err)
			}
		})
	}
}

func TestCollectionWorkerRejectsInvalidCallbackRouteBeforeInitialization(t *testing.T) {
	for _, route := range []string{"http://user:PRIVATE-PROXY-SECRET@%", "file:///PRIVATE-PROXY-SECRET", "http:///PRIVATE-PROXY-SECRET", "https://proxy.invalid/#PRIVATE-PROXY-SECRET"} {
		request := collectionRequest{Version: 1, Nonce: strings.Repeat("a", 64), Action: "workspace-prepare", ID: finalID, Config: Config{State: "/unused-private-state", Work: "/unused-private-work"}, CallbackProxy: &route}
		frame, err := json.Marshal(request)
		if err != nil {
			t.Fatal(err)
		}
		initialized := false
		var output bytes.Buffer
		err = runCollectionWorkerWith(bytes.NewReader(frame), &output, func(Config) (*Engine, error) {
			initialized = true
			return nil, errors.New("must not initialize")
		})
		if err == nil || initialized || output.Len() != 0 || strings.Contains(err.Error(), "PRIVATE-PROXY-SECRET") {
			t.Fatal("invalid route initialized a worker or disclosed proxy data")
		}
	}
}
