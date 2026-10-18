// Test fixture only: adds real certificate authentication in front of the Node
// command fixture, whose SSH library does not implement user certificates.
package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"golang.org/x/crypto/ssh"
	"io"
	"net"
	"os"
)

type configuration struct{ HostKey, CA, Password, Backend string }

func main() {
	b, err := os.ReadFile(os.Args[1])
	if err != nil {
		panic("fixture configuration unavailable")
	}
	var c configuration
	if json.Unmarshal(b, &c) != nil {
		panic("invalid fixture configuration")
	}
	host, err := ssh.ParsePrivateKey([]byte(c.HostKey))
	if err != nil {
		panic("fixture host key invalid")
	}
	ca, _, _, _, err := ssh.ParseAuthorizedKey([]byte(c.CA))
	if err != nil {
		panic("fixture CA invalid")
	}
	config := &ssh.ServerConfig{PasswordCallback: func(_ ssh.ConnMetadata, p []byte) (*ssh.Permissions, error) {
		if string(p) != c.Password {
			return nil, errors.New("rejected")
		}
		return nil, nil
	}, PublicKeyCallback: func(_ ssh.ConnMetadata, k ssh.PublicKey) (*ssh.Permissions, error) {
		cert, ok := k.(*ssh.Certificate)
		if !ok || !bytes.Equal(cert.SignatureKey.Marshal(), ca.Marshal()) {
			return nil, errors.New("certificate rejected")
		}
		checker := ssh.CertChecker{SupportedCriticalOptions: []string{"force-command"}}
		if err := checker.CheckCert("exam:fixture", cert); err != nil {
			return nil, err
		}
		return &cert.Permissions, nil
	}}
	config.AddHostKey(host)
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		panic("fixture listener failed")
	}
	fmt.Printf("{\"port\":%d}\n", listener.Addr().(*net.TCPAddr).Port)
	for {
		raw, err := listener.Accept()
		if err != nil {
			return
		}
		go func() {
			defer raw.Close()
			front, channels, requests, err := ssh.NewServerConn(raw, config)
			if err != nil {
				return
			}
			defer front.Close()
			go ssh.DiscardRequests(requests)
			backend, err := ssh.Dial("tcp", c.Backend, &ssh.ClientConfig{User: front.User(), Auth: []ssh.AuthMethod{ssh.Password(c.Password)}, HostKeyCallback: func(_ string, _ net.Addr, k ssh.PublicKey) error {
				if bytes.Equal(k.Marshal(), host.PublicKey().Marshal()) {
					return nil
				}
				return errors.New("fixture backend host key rejected")
			}})
			if err != nil {
				return
			}
			defer backend.Close()
			for ch := range channels {
				go func(ch ssh.NewChannel) {
					if ch.ChannelType() != "session" {
						ch.Reject(ssh.Prohibited, "fixture session only")
						return
					}
					out, outRequests, err := backend.OpenChannel("session", ch.ExtraData())
					if err != nil {
						ch.Reject(ssh.ConnectionFailed, "backend unavailable")
						return
					}
					defer out.Close()
					stream, inRequests, err := ch.Accept()
					if err != nil {
						return
					}
					defer stream.Close()
					go func() {
						for q := range inRequests {
							ok, err := out.SendRequest(q.Type, q.WantReply, q.Payload)
							if q.WantReply {
								q.Reply(err == nil && ok, nil)
							}
						}
					}()
					go func() {
						for q := range outRequests {
							ok, err := stream.SendRequest(q.Type, q.WantReply, q.Payload)
							if q.WantReply {
								q.Reply(err == nil && ok, nil)
							}
						}
					}()
					go func() { io.Copy(out, stream); out.CloseWrite() }()
					io.Copy(stream, out)
				}(ch)
			}
		}()
	}
}
