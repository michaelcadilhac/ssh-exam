package main

import (
	"bufio"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func fixture(t *testing.T) (*relay, ed25519.PrivateKey) {
	t.Helper()
	pub, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	b, err := x509.MarshalPKIXPublicKey(pub)
	if err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(dir, "public.pem")
	if err := os.WriteFile(file, pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: b}), 0600); err != nil {
		t.Fatal(err)
	}
	state := filepath.Join(dir, "replay")
	if err := os.Mkdir(state, 0700); err != nil {
		t.Fatal(err)
	}
	r, err := load(config{Listen: "127.0.0.1:9082", Origin: "https://exam.example", Audience: "exam-ssh-relay-class", PublicKey: file, DialTarget: "10.192.202.6:22", ReplayDirectory: state})
	if err != nil {
		t.Fatal(err)
	}
	return r, key
}

func signTicket(r *relay, key ed25519.PrivateKey, change func(*ticket)) []byte {
	n := make([]byte, 24)
	rand.Read(n)
	now := time.Now().UnixMilli()
	t := ticket{Audience: r.config.Audience, Op: "relay-connect", Nonce: base64.RawURLEncoding.EncodeToString(n), Issued: now, Expires: now + 30000, Origin: r.config.Origin, Target: destination, Username: "student", Exam: "sandbox"}
	if change != nil {
		change(&t)
	}
	b, _ := json.Marshal(t)
	f, _ := json.Marshal(frame{Payload: base64.StdEncoding.EncodeToString(b), Signature: base64.StdEncoding.EncodeToString(ed25519.Sign(key, b))})
	return f
}

func TestTicketScope(t *testing.T) {
	for name, change := range map[string]func(*ticket){
		"target":        func(t *ticket) { t.Target = "127.0.0.1:22" },
		"origin":        func(t *ticket) { t.Origin = "https://evil.example" },
		"audience":      func(t *ticket) { t.Audience = "class" },
		"op":            func(t *ticket) { t.Op = "register" },
		"expired":       func(t *ticket) { t.Issued -= 60000; t.Expires -= 60000 },
		"long lifetime": func(t *ticket) { t.Expires += 30000 },
		"future":        func(t *ticket) { t.Issued += 10000; t.Expires += 10000 },
		"path nonce":    func(t *ticket) { t.Nonce = "../../some-path-outside-state" },
		"username":      func(t *ticket) { t.Username = "student\nsecret" },
		"exam":          func(t *ticket) { t.Exam = "../../home" },
	} {
		t.Run(name, func(t *testing.T) {
			r, key := fixture(t)
			if _, err := r.consume(signTicket(r, key, change), time.Now().UnixMilli()); err == nil {
				t.Fatal("bad scope accepted")
			}
		})
	}
	r, key := fixture(t)
	_, other, _ := ed25519.GenerateKey(rand.Reader)
	if _, err := r.consume(signTicket(r, other, nil), time.Now().UnixMilli()); err == nil {
		t.Fatal("forged ticket accepted")
	}
	if user, err := r.consume(signTicket(r, key, nil), time.Now().UnixMilli()); err != nil || user != "student" {
		t.Fatal(user, err)
	}
}

func TestReplayConcurrentAndRestart(t *testing.T) {
	r, key := fixture(t)
	packet := signTicket(r, key, nil)
	var wins atomic.Int32
	var wg sync.WaitGroup
	for range 20 {
		wg.Go(func() {
			if _, err := r.consume(packet, time.Now().UnixMilli()); err == nil {
				wins.Add(1)
			}
		})
	}
	wg.Wait()
	if wins.Load() != 1 {
		t.Fatalf("%d successes", wins.Load())
	}
	restarted, err := load(r.config)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := restarted.consume(packet, time.Now().UnixMilli()); err == nil {
		t.Fatal("replay accepted after restart")
	}
}

func TestPerUserLimitAndFailClosedState(t *testing.T) {
	r, key := fixture(t)
	for range 4 {
		if _, err := r.consume(signTicket(r, key, nil), time.Now().UnixMilli()); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := r.consume(signTicket(r, key, nil), time.Now().UnixMilli()); err == nil {
		t.Fatal("connection limit bypassed")
	}
	r, key = fixture(t)
	os.WriteFile(filepath.Join(r.config.ReplayDirectory, "invalid-state-entry"), []byte("not-an-expiry"), 0600)
	if _, err := r.consume(signTicket(r, key, nil), time.Now().UnixMilli()); err == nil {
		t.Fatal("corrupt replay state accepted")
	}
}

func connect(t *testing.T, s *httptest.Server, r *relay) (*websocket.Conn, context.Context) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	t.Cleanup(cancel)
	c, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(s.URL, "http")+route, &websocket.DialOptions{HTTPHeader: http.Header{"Origin": []string{r.config.Origin}}})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { c.CloseNow() })
	return c, ctx
}

func TestOpaqueBinaryRelayAndDisconnect(t *testing.T) {
	r, key := fixture(t)
	closed := make(chan struct{})
	r.dial = func(context.Context) (net.Conn, error) {
		a, b := net.Pipe()
		go func() { defer close(closed); defer b.Close(); io.Copy(b, b) }()
		return a, nil
	}
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, q *http.Request) { r.serve(context.Background(), w, q) }))
	defer s.Close()
	c, ctx := connect(t, s, r)
	if err := c.Write(ctx, websocket.MessageText, signTicket(r, key, nil)); err != nil {
		t.Fatal(err)
	}
	kind, p, err := c.Read(ctx)
	if err != nil || kind != websocket.MessageText || string(p) != `{"ready":true}` {
		t.Fatal(kind, string(p), err)
	}
	bytes := []byte{0, 255, 31, 10, 13, 128, 1, 7}
	if err := c.Write(ctx, websocket.MessageBinary, bytes); err != nil {
		t.Fatal(err)
	}
	kind, p, err = c.Read(ctx)
	if err != nil || kind != websocket.MessageBinary || string(p) != string(bytes) {
		t.Fatal(kind, p, err)
	}
	c.CloseNow()
	select {
	case <-closed:
	case <-ctx.Done():
		t.Fatal("browser disconnection retained upstream")
	}
}

func TestRejectsBeforeDial(t *testing.T) {
	r, key := fixture(t)
	var calls atomic.Int32
	r.dial = func(context.Context) (net.Conn, error) { calls.Add(1); return nil, io.EOF }
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, q *http.Request) { r.serve(context.Background(), w, q) }))
	defer s.Close()
	c, ctx := connect(t, s, r)
	c.Write(ctx, websocket.MessageText, signTicket(r, key, func(t *ticket) { t.Target = "evil.example:22" }))
	_, _, err := c.Read(ctx)
	if websocket.CloseStatus(err) != websocket.StatusPolicyViolation || calls.Load() != 0 {
		t.Fatal("unauthorized connection", err, calls.Load())
	}
	for _, origin := range []string{"", "https://evil.example", "https://exam.example.evil"} {
		q, _ := http.NewRequest("GET", s.URL+route, nil)
		q.Header.Set("Origin", origin)
		res, err := http.DefaultClient.Do(q)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != 403 {
			t.Fatal(res.StatusCode)
		}
	}
	q, _ := http.NewRequest("GET", s.URL+route+"?ticket=secret", nil)
	q.Header.Set("Origin", r.config.Origin)
	res, err := http.DefaultClient.Do(q)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != 404 {
		t.Fatal(res.StatusCode)
	}
}

func TestProxyConnectAndBufferedGreeting(t *testing.T) {
	r, _ := fixture(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, q *http.Request) {
		if q.Method != "CONNECT" || q.Host != r.config.DialTarget {
			t.Errorf("wrong target %s %s", q.Method, q.Host)
			return
		}
		c, rw, err := w.(http.Hijacker).Hijack()
		if err != nil {
			t.Error(err)
			return
		}
		defer c.Close()
		rw.WriteString("HTTP/1.1 200 Connection established\r\n\r\nSSH-2.0-test\r\n")
		rw.Flush()
	}))
	defer server.Close()
	r.config.Proxy = server.URL
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	c, err := r.dialJump(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	line, err := bufio.NewReader(c).ReadString('\n')
	if err != nil || line != "SSH-2.0-test\r\n" {
		t.Fatal(line, err)
	}
}

func TestProxyRefusal(t *testing.T) {
	r, _ := fixture(t)
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, q *http.Request) { http.Error(w, "denied", 403) }))
	defer s.Close()
	r.config.Proxy = s.URL
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if _, err := r.dialJump(ctx); err == nil {
		t.Fatal("proxy refusal accepted")
	}
}

func TestConfigurationRestrictions(t *testing.T) {
	r, _ := fixture(t)
	for name, change := range map[string]func(*config){
		"public listen":      func(c *config) { c.Listen = "0.0.0.0:9082" },
		"untrusted protocol": func(c *config) { c.Origin = "http://exam.example" },
		"origin path":        func(c *config) { c.Origin += "/login" },
		"other port":         func(c *config) { c.DialTarget = "10.192.202.6:443" },
		"other hostname":     func(c *config) { c.DialTarget = "evil.example:22" },
		"proxy credential":   func(c *config) { c.Proxy = "http://user:secret@proxy.example:3128" },
		"missing state":      func(c *config) { c.ReplayDirectory = "/missing-state" },
	} {
		t.Run(name, func(t *testing.T) {
			c := r.config
			change(&c)
			if _, err := load(c); err == nil {
				t.Fatal("unsafe configuration accepted")
			}
		})
	}
}
