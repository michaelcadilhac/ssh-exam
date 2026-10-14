package client

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"golang.org/x/crypto/ssh"
	"io"
	"net"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type testHosts struct {
	jump, class           Host
	password              string
	jumpCalls, classCalls atomic.Int32
	mu                    sync.Mutex
	conns                 []net.Conn
	stop                  []func()
}

func hosts(t *testing.T, mixed, reject, repeat bool) *testHosts {
	t.Helper()
	h := &testHosts{password: "test-shared-secret"}
	server := func(jump bool) Host {
		_, priv, _ := ed25519.GenerateKey(rand.Reader)
		key, _ := ssh.NewSignerFromKey(priv)
		sum := sha256.Sum256(key.PublicKey().Marshal())
		cfg := &ssh.ServerConfig{}
		if jump {
			cfg.KeyboardInteractiveCallback = func(_ ssh.ConnMetadata, ask ssh.KeyboardInteractiveChallenge) (*ssh.Permissions, error) {
				a, err := ask("", "", []string{"Entra Id Password:"}, []bool{false})
				if err != nil {
					return nil, err
				}
				h.jumpCalls.Add(1)
				if a[0] != h.password || reject {
					return nil, errors.New("rejected")
				}
				if repeat {
					_, err = ask("", "", []string{"Password:"}, []bool{false})
					return nil, err
				}
				_, err = ask("Phone MFA", "Enter number 42 in your authenticator app", nil, nil)
				return nil, err
			}
		} else if mixed {
			cfg.KeyboardInteractiveCallback = func(_ ssh.ConnMetadata, ask ssh.KeyboardInteractiveChallenge) (*ssh.Permissions, error) {
				a, err := ask("", "", []string{"Password:", "Verification code"}, []bool{false, false})
				if err != nil {
					return nil, err
				}
				h.classCalls.Add(1)
				if a[0] != h.password || a[1] != "123456" {
					return nil, errors.New("rejected")
				}
				return nil, nil
			}
		} else {
			cfg.PasswordCallback = func(_ ssh.ConnMetadata, password []byte) (*ssh.Permissions, error) {
				h.classCalls.Add(1)
				if string(password) != h.password {
					return nil, errors.New("rejected")
				}
				return nil, nil
			}
		}
		cfg.AddHostKey(key)
		listener, err := net.Listen("tcp", "127.0.0.1:0")
		if err != nil {
			t.Fatal(err)
		}
		h.stop = append(h.stop, func() { listener.Close() })
		go func() {
			for {
				raw, err := listener.Accept()
				if err != nil {
					return
				}
				h.mu.Lock()
				h.conns = append(h.conns, raw)
				h.mu.Unlock()
				go func() {
					conn, chs, reqs, err := ssh.NewServerConn(raw, cfg)
					if err != nil {
						return
					}
					defer conn.Close()
					go ssh.DiscardRequests(reqs)
					for ch := range chs {
						if jump && ch.ChannelType() == "direct-tcpip" {
							out, err := net.Dial("tcp", net.JoinHostPort(h.class.Host, itoa(h.class.Port)))
							if err != nil {
								ch.Reject(ssh.ConnectionFailed, "unavailable")
								continue
							}
							stream, r, err := ch.Accept()
							if err != nil {
								out.Close()
								continue
							}
							go ssh.DiscardRequests(r)
							go func() { defer out.Close(); defer stream.Close(); go io.Copy(out, stream); io.Copy(stream, out) }()
						} else if !jump && ch.ChannelType() == "session" {
							s, r, err := ch.Accept()
							if err == nil {
								go func() {
									for q := range r {
										q.Reply(true, nil)
									}
									s.Close()
								}()
							}
						} else {
							ch.Reject(ssh.UnknownChannelType, "unavailable")
						}
					}
				}()
			}
		}()
		return Host{Host: "127.0.0.1", Port: listener.Addr().(*net.TCPAddr).Port, Pins: []string{hex.EncodeToString(sum[:])}}
	}
	h.class = server(false)
	h.jump = server(true)
	t.Cleanup(func() {
		for _, f := range h.stop {
			f()
		}
		h.mu.Lock()
		defer h.mu.Unlock()
		for _, c := range h.conns {
			c.Close()
		}
	})
	return h
}
func raw(t *testing.T, h *testHosts) net.Conn {
	t.Helper()
	r, err := net.Dial("tcp", net.JoinHostPort(h.jump.Host, itoa(h.jump.Port)))
	if err != nil {
		t.Fatal(err)
	}
	return r
}
func TestSharedPasswordMFAAndRetainedChannels(t *testing.T) {
	for _, mixed := range []bool{false, true} {
		t.Run(itoa(map[bool]int{false: 0, true: 1}[mixed]), func(t *testing.T) {
			h := hosts(t, mixed, false, false)
			c := New(func(any) {})
			defer c.Close()
			asks := 0
			phone := false
			err := c.Connect(raw(t, h), "student", h.jump, h.class, func(_ context.Context, host, text string, p []Prompt) ([]string, error) {
				if len(p) == 1 && p[0].Prompt == "Shared SSH password" {
					asks++
					return []string{h.password}, nil
				}
				if len(p) == 1 && p[0].Prompt == "Verification code" {
					return []string{"123456"}, nil
				}
				if len(p) == 0 {
					if text == "Phone MFA\nEnter number 42 in your authenticator app" {
						phone = true
					}
					return []string{}, nil
				}
				return nil, errors.New("unexpected prompt")
			})
			if err != nil {
				t.Fatal(err)
			}
			if asks != 1 || !phone || h.jumpCalls.Load() != 1 || h.classCalls.Load() != 1 {
				t.Fatalf("authentication policy failed: %d %v %d %d", asks, phone, h.jumpCalls.Load(), h.classCalls.Load())
			}
			if c.auth != nil {
				t.Fatal("authentication retained")
			}
			for range 4 {
				s, err := c.session()
				if err != nil {
					t.Fatal(err)
				}
				s.Close()
			}
			if h.classCalls.Load() != 1 {
				t.Fatal("terminal opening reauthenticated")
			}
		})
	}
}
func TestPinBeforeCredentialsAndRejectedPasswordNoRetry(t *testing.T) {
	for _, which := range []string{"jump-pin", "class-pin", "rejected", "repeat"} {
		t.Run(which, func(t *testing.T) {
			h := hosts(t, false, which == "rejected", which == "repeat")
			c := New(func(any) {})
			defer c.Close()
			j, k := h.jump, h.class
			if which == "jump-pin" {
				j.Pins = []string{"wrong"}
			}
			if which == "class-pin" {
				k.Pins = []string{"wrong"}
			}
			asks := 0
			err := c.Connect(raw(t, h), "student", j, k, func(_ context.Context, _, _ string, p []Prompt) ([]string, error) {
				if len(p) > 0 {
					asks++
					return []string{h.password}, nil
				}
				return nil, nil
			})
			if err == nil {
				t.Fatal("bad login accepted")
			}
			if c.auth != nil {
				t.Fatal("credentials retained on failure")
			}
			if asks > 1 {
				t.Fatal("password requested twice")
			}
			if which == "jump-pin" && (asks != 0 || h.jumpCalls.Load() != 0) {
				t.Fatal("password sent before pin")
			}
			if which == "class-pin" && h.classCalls.Load() != 0 {
				t.Fatal("class credentials sent before pin")
			}
			if h.jumpCalls.Load() > 1 {
				t.Fatal("rejected password automatically retried")
			}
		})
	}
}
func TestCancellationWipesMutableSecret(t *testing.T) {
	h := hosts(t, false, false, false)
	c := New(func(any) {})
	ready := make(chan *authState, 1)
	done := make(chan error, 1)
	go func() {
		done <- c.Connect(raw(t, h), "student", h.jump, h.class, func(ctx context.Context, _, _ string, p []Prompt) ([]string, error) {
			if len(p) > 0 {
				return []string{h.password}, nil
			}
			c.mu.Lock()
			a := c.auth
			c.mu.Unlock()
			ready <- a
			<-ctx.Done()
			return nil, ctx.Err()
		})
	}()
	var a *authState
	select {
	case a = <-ready:
	case <-time.After(3 * time.Second):
		t.Fatal("MFA not reached")
	}
	a.mu.Lock()
	original := a.password
	a.mu.Unlock()
	c.Close()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("cancellation did not end authentication")
	}
	for _, b := range original {
		if b != 0 {
			t.Fatal("mutable credential buffer not wiped")
		}
	}
	if a.password != nil || a.dialogue != nil || !a.closed {
		t.Fatal("credential callbacks retained")
	}
}
func TestUnknownHiddenPromptNotPassword(t *testing.T) {
	for _, p := range []Prompt{{"Verification code", false}, {"Authenticator passcode", false}, {"Password", true}, {"arbitrary hidden input", false}} {
		if PasswordPrompt(p, "student", "host") {
			t.Fatal("blind password reuse")
		}
	}
}
