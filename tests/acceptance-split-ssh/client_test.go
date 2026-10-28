package client

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/pem"
	"errors"
	"io"
	"net"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"golang.org/x/crypto/ssh"
)

// Real two-hop TCP/SSH fixture: distinct usernames, password+MFA only on jump,
// synthetic key only on class, and actual retained session channels afterward.
func TestAcceptanceSplitIdentity(t *testing.T) {
	for _, scenario := range []string{"success", "wrong-key", "wrong-jump-user", "wrong-pin", "incomplete"} {
		t.Run(scenario, func(t *testing.T) {
			var jumpAuth, classAuth, classPasswords atomic.Int32
			_, private, _ := ed25519.GenerateKey(rand.Reader)
			key, _ := ssh.NewSignerFromKey(private)
			block, _ := ssh.MarshalPrivateKey(private, "synthetic acceptance only")
			encoded := string(pem.EncodeToMemory(block))
			classConfig := &ssh.ServerConfig{
				PublicKeyCallback: func(meta ssh.ConnMetadata, offered ssh.PublicKey) (*ssh.Permissions, error) {
					if meta.User() != "acceptanceq" || !bytes.Equal(offered.Marshal(), key.PublicKey().Marshal()) {
						return nil, errors.New("wrong synthetic identity/key")
					}
					classAuth.Add(1)
					return nil, nil
				},
				PasswordCallback: func(ssh.ConnMetadata, []byte) (*ssh.Permissions, error) {
					classPasswords.Add(1)
					return nil, errors.New("institutional password forbidden here")
				},
			}
			jumpConfig := &ssh.ServerConfig{KeyboardInteractiveCallback: func(meta ssh.ConnMetadata, ask ssh.KeyboardInteractiveChallenge) (*ssh.Permissions, error) {
				if meta.User() != "instructor" {
					return nil, errors.New("wrong jump identity")
				}
				a, err := ask("", "", []string{"Password:"}, []bool{false})
				if err != nil || len(a) != 1 || a[0] != "jump-secret" {
					return nil, errors.New("jump password rejected")
				}
				jumpAuth.Add(1)
				_, err = ask("Phone MFA", "Approve synthetic phone challenge", nil, nil)
				return nil, err
			}}
			var mu sync.Mutex
			var connections []net.Conn
			serve := func(cfg *ssh.ServerConfig, forward *Host) Host {
				_, hostKey, _ := ed25519.GenerateKey(rand.Reader)
				signer, _ := ssh.NewSignerFromKey(hostKey)
				cfg.AddHostKey(signer)
				pin := sha256.Sum256(signer.PublicKey().Marshal())
				listener, err := net.Listen("tcp", "127.0.0.1:0")
				if err != nil {
					t.Fatal(err)
				}
				t.Cleanup(func() { listener.Close() })
				go func() {
					for {
						raw, err := listener.Accept()
						if err != nil {
							return
						}
						mu.Lock()
						connections = append(connections, raw)
						mu.Unlock()
						go func() {
							defer raw.Close()
							raw.SetDeadline(time.Now().Add(8 * time.Second))
							conn, channels, requests, err := ssh.NewServerConn(raw, cfg)
							if err != nil {
								return
							}
							defer conn.Close()
							go ssh.DiscardRequests(requests)
							for channel := range channels {
								if forward != nil && channel.ChannelType() == "direct-tcpip" {
									var destination struct {
										Host       string
										Port       uint32
										Origin     string
										OriginPort uint32
									}
									if ssh.Unmarshal(channel.ExtraData(), &destination) != nil || destination.Host != forward.Host || int(destination.Port) != forward.Port {
										channel.Reject(ssh.Prohibited, "wrong destination")
										continue
									}
									out, err := net.DialTimeout("tcp", net.JoinHostPort(forward.Host, itoa(forward.Port)), time.Second)
									if err != nil {
										channel.Reject(ssh.ConnectionFailed, "unavailable")
										continue
									}
									stream, reqs, err := channel.Accept()
									if err != nil {
										out.Close()
										continue
									}
									go ssh.DiscardRequests(reqs)
									go func() { defer out.Close(); defer stream.Close(); go io.Copy(out, stream); io.Copy(stream, out) }()
								} else if forward == nil && channel.ChannelType() == "session" {
									stream, reqs, err := channel.Accept()
									if err != nil {
										continue
									}
									go func() {
										defer stream.Close()
										for req := range reqs {
											req.Reply(req.Type == "exec", nil)
											if req.Type == "exec" {
												stream.Write([]byte("acceptanceq\n"))
												stream.SendRequest("exit-status", false, ssh.Marshal(struct{ Status uint32 }{0}))
												return
											}
										}
									}()
								} else {
									channel.Reject(ssh.Prohibited, "unsupported")
								}
							}
						}()
					}
				}()
				return Host{Host: "127.0.0.1", Port: listener.Addr().(*net.TCPAddr).Port, Pins: []string{hex.EncodeToString(pin[:])}}
			}
			class := serve(classConfig, nil)
			jump := serve(jumpConfig, &class)
			jump.AcceptanceUsername = "instructor"
			class.AcceptancePrivateKey = encoded
			switch scenario {
			case "wrong-key":
				_, wrong, _ := ed25519.GenerateKey(rand.Reader)
				b, _ := ssh.MarshalPrivateKey(wrong, "wrong synthetic key")
				class.AcceptancePrivateKey = string(pem.EncodeToMemory(b))
			case "wrong-jump-user":
				jump.AcceptanceUsername = "wrong"
			case "wrong-pin":
				jump.Pins = []string{hex.EncodeToString(make([]byte, 32))}
			case "incomplete":
				class.AcceptancePrivateKey = ""
			}
			t.Cleanup(func() {
				mu.Lock()
				defer mu.Unlock()
				for _, conn := range connections {
					conn.Close()
				}
			})
			raw, err := net.DialTimeout("tcp", net.JoinHostPort(jump.Host, itoa(jump.Port)), time.Second)
			if err != nil {
				t.Fatal(err)
			}
			c := New(func(any) {})
			defer c.Close()
			asks, phone := 0, false
			err = c.Connect(raw, "acceptanceq", jump, class, func(_ context.Context, _, text string, prompts []Prompt) ([]string, error) {
				if len(prompts) == 0 {
					phone = phone || text == "Phone MFA\nApprove synthetic phone challenge"
					return []string{}, nil
				}
				if len(prompts) != 1 || prompts[0].Prompt != "Shared SSH password" {
					return nil, errors.New("unexpected prompt")
				}
				asks++
				return []string{"jump-secret"}, nil
			})
			if scenario != "success" {
				if err == nil {
					t.Fatal("negative control authenticated")
				}
				if classPasswords.Load() != 0 {
					t.Fatal("password leaked to class fallback")
				}
				if (scenario == "wrong-pin" || scenario == "incomplete") && asks != 0 {
					t.Fatal("credential requested before verified configuration")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if asks != 1 || !phone || jumpAuth.Load() != 1 || classAuth.Load() == 0 || classPasswords.Load() != 0 {
				t.Fatal("split authentication boundary failed")
			}
			if c.user != "acceptanceq" || c.auth != nil || c.classHost.AcceptancePrivateKey != "" {
				t.Fatal("wrong owner or retained credentials")
			}
			for range 4 {
				session, err := c.session()
				if err != nil {
					t.Fatal(err)
				}
				output, err := session.Output("id -un")
				session.Close()
				if err != nil || string(output) != "acceptanceq\n" {
					t.Fatal("retained ordinary session failed", err)
				}
			}
			if jumpAuth.Load() != 1 {
				t.Fatal("terminal reauthenticated jump")
			}
		})
	}
}
