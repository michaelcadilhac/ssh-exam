package client

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/ssh"
)

type Host struct {
	Host string   `json:"host"`
	Port int      `json:"port"`
	Pins []string `json:"pins"`
}
type Prompt struct {
	Prompt string `json:"prompt"`
	Echo   bool   `json:"echo"`
}
type Dialogue func(context.Context, string, string, []Prompt) ([]string, error)
type authState struct {
	mu       sync.Mutex
	password []byte
	closed   bool
	dialogue Dialogue
}

func (a *authState) clear() {
	a.mu.Lock()
	defer a.mu.Unlock()
	clear(a.password)
	a.password = nil
	a.dialogue = nil
	a.closed = true
}
func (a *authState) ask(ctx context.Context, host, text string, p []Prompt) ([]string, error) {
	a.mu.Lock()
	fn := a.dialogue
	closed := a.closed
	a.mu.Unlock()
	if closed || fn == nil {
		return nil, errors.New("authentication ended")
	}
	answers, err := fn(ctx, host, text, p)
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.closed {
		clear(answers)
		return nil, errors.New("authentication ended")
	}
	return answers, err
}
func (a *authState) shared(ctx context.Context, host, text string) (string, error) {
	a.mu.Lock()
	have := len(a.password) > 0
	a.mu.Unlock()
	if !have {
		answers, err := a.ask(ctx, host, text, []Prompt{{Prompt: "Shared SSH password", Echo: false}})
		defer clear(answers)
		if err != nil {
			return "", err
		}
		if len(answers) != 1 || len(answers[0]) == 0 || len(answers[0]) > 4096 {
			return "", errors.New("invalid shared password")
		}
		a.mu.Lock()
		if a.closed {
			a.mu.Unlock()
			return "", errors.New("authentication ended")
		}
		a.password = []byte(answers[0])
		a.mu.Unlock()
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.closed {
		return "", errors.New("authentication ended")
	}
	return string(a.password), nil
}
func PasswordPrompt(p Prompt, user, host string) bool {
	if p.Echo {
		return false
	}
	v := strings.ToLower(strings.TrimSpace(strings.TrimSuffix(strings.TrimSpace(p.Prompt), ":")))
	for _, s := range []string{"password", "ssh password", "account password", "login password", "unix password", "jump password", "entra id password", "class password", user + "'s password", user + "@" + host + "'s password"} {
		if v == strings.ToLower(s) {
			return true
		}
	}
	return false
}

type Pane struct {
	session *ssh.Session
	in      io.WriteCloser
	out     *bufio.Reader
	mu      sync.Mutex
}
type Client struct {
	mu          sync.Mutex
	ctx         context.Context
	cancel      context.CancelFunc
	raw         net.Conn
	jump, class *ssh.Client
	auth        *authState
	panes       map[string]*Pane
	Emit        func(any)
}

func New(emit func(any)) *Client {
	ctx, cancel := context.WithCancel(context.Background())
	return &Client{ctx: ctx, cancel: cancel, panes: map[string]*Pane{}, Emit: emit}
}
func (c *Client) Close() {
	c.cancel()
	c.mu.Lock()
	a := c.auth
	c.auth = nil
	j, k, raw := c.jump, c.class, c.raw
	c.jump = nil
	c.class = nil
	c.raw = nil
	ps := c.panes
	c.panes = map[string]*Pane{}
	c.mu.Unlock()
	if a != nil {
		a.clear()
	}
	if raw != nil {
		raw.Close()
	}
	if k != nil {
		k.Close()
	}
	if j != nil {
		j.Close()
	}
	for _, p := range ps {
		p.session.Close()
	}
}
func (c *Client) Connect(raw net.Conn, user string, jump, class Host, dialogue Dialogue) error {
	a := &authState{dialogue: dialogue}
	c.mu.Lock()
	c.auth = a
	c.raw = raw
	c.mu.Unlock()
	ctx, end := context.WithTimeout(c.ctx, 120*time.Second)
	defer end()
	timer := time.AfterFunc(120*time.Second, c.Close)
	defer timer.Stop()
	defer a.clear()
	hop := func(conn net.Conn, h Host) (*ssh.Client, error) {
		verified := false
		sent := false
		ask := func(text string, p []Prompt) ([]string, error) {
			if !verified {
				return nil, errors.New("unverified SSH host")
			}
			return a.ask(ctx, h.Host, text, p)
		}
		config := &ssh.ClientConfig{User: user, Timeout: 120 * time.Second}
		config.HostKeyCallback = func(_ string, _ net.Addr, key ssh.PublicKey) error {
			sum := sha256.Sum256(key.Marshal())
			pin := hex.EncodeToString(sum[:])
			for _, s := range h.Pins {
				if pin == s {
					verified = true
					return nil
				}
			}
			c.Emit(map[string]any{"type":"host-key-mismatch","host":h.Host,"fingerprint":pin})
			return errors.New("SSH host-key verification failed")
		}
		config.BannerCallback = func(text string) error { _, err := ask(text, nil); return err }
		config.Auth = []ssh.AuthMethod{
			ssh.KeyboardInteractive(func(name, instruction string, questions []string, echo []bool) ([]string, error) {
				if !verified || len(questions) > 16 || len(questions) != len(echo) {
					return nil, errors.New("invalid SSH challenge")
				}
				text := strings.TrimSpace(name + "\n" + instruction)
				slots := -1
				manual := []Prompt{}
				for i, q := range questions {
					p := Prompt{q, echo[i]}
					if PasswordPrompt(p, user, h.Host) {
						if slots >= 0 || sent {
							return nil, errors.New("repeated password request rejected")
						}
						slots = i
					} else {
						manual = append(manual, p)
					}
				}
				pw := ""
				var err error
				if slots >= 0 {
					sent = true
					pw, err = a.shared(ctx, h.Host, text)
					if err != nil {
						return nil, err
					}
				}
				answers, err := ask(text, manual)
				defer clear(answers)
				if err != nil {
					return nil, err
				}
				if len(answers) != len(manual) {
					return nil, errors.New("invalid challenge answers")
				}
				result := make([]string, len(questions))
				n := 0
				for i := range result {
					if i == slots {
						result[i] = pw
					} else {
						result[i] = answers[n]
						n++
					}
				}
				pw = ""
				return result, nil
			}),
			ssh.PasswordCallback(func() (string, error) {
				if !verified || sent {
					return "", errors.New("password retry rejected")
				}
				sent = true
				return a.shared(ctx, h.Host, "Enter the shared SSH password for both hosts.")
			}),
		}
		sc, channels, requests, err := ssh.NewClientConn(conn, net.JoinHostPort(h.Host, itoa(h.Port)), config)
		// Auth callbacks refer only to a clearable holder. Do not retain methods/config.
		config.Auth = nil
		config.BannerCallback = nil
		config.HostKeyCallback = nil
		if err != nil {
			return nil, errors.New("SSH authentication or host verification failed")
		}
		return ssh.NewClient(sc, channels, requests), nil
	}
	j, err := hop(raw, jump)
	if err != nil {
		c.Close()
		return err
	}
	c.mu.Lock()
	c.jump = j
	c.mu.Unlock()
	conn, err := j.Dial("tcp", net.JoinHostPort(class.Host, itoa(class.Port)))
	if err != nil {
		c.Close()
		return errors.New("class host forwarding failed")
	}
	k, err := hop(conn, class)
	if err != nil {
		c.Close()
		return err
	}
	a.clear()
	c.mu.Lock()
	c.auth = nil
	c.class = k
	c.mu.Unlock()
	go func() { k.Wait(); c.Close(); c.Emit(map[string]any{"type": "loss"}) }()
	go func() {
		t := time.NewTicker(5 * time.Second)
		defer t.Stop()
		for {
			select {
			case <-c.ctx.Done():
				return
			case <-t.C:
				if _, _, err := k.SendRequest("keepalive@openssh.com", true, nil); err != nil {
					c.Close()
					return
				}
			}
		}
	}()
	return nil
}
func itoa(n int) string { return fmtInt(n) }
func (c *Client) session() (*ssh.Session, error) {
	c.mu.Lock()
	k := c.class
	c.mu.Unlock()
	if k == nil {
		return nil, errors.New("SSH disconnected")
	}
	return k.NewSession()
}
func (c *Client) Command(frame json.RawMessage) (json.RawMessage, error) {
	s, err := c.session()
	if err != nil {
		return nil, err
	}
	defer s.Close()
	in, err := s.StdinPipe()
	if err != nil {
		return nil, err
	}
	out, err := s.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err = s.Start("exam-control"); err != nil {
		return nil, err
	}
	if _, err = in.Write(append(frame, '\n')); err != nil {
		return nil, err
	}
	reader := bufio.NewReader(io.LimitReader(out, 6*1024*1024+1))
	line, err := reader.ReadBytes('\n')
	if err != nil || len(line) > 6*1024*1024 {
		return nil, errors.New("invalid agent acknowledgment")
	}
	return json.RawMessage(line), nil
}
func (c *Client) Open(pane, token string) (json.RawMessage, error) {
	c.mu.Lock()
	_, exists := c.panes[pane]
	c.mu.Unlock()
	if exists {
		return nil, errors.New("pane exists")
	}
	s, err := c.session()
	if err != nil {
		return nil, err
	}
	ok := false
	defer func() {
		if !ok {
			s.Close()
		}
	}()
	if err = s.RequestPty("xterm-256color", 30, 100, ssh.TerminalModes{ssh.ECHO: 0}); err != nil {
		return nil, err
	}
	in, err := s.StdinPipe()
	if err != nil {
		return nil, err
	}
	out, err := s.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err = s.Start("exam-gateway"); err != nil {
		return nil, err
	}
	reader := bufio.NewReader(out)
	var result json.RawMessage
	sent := false
	for n := 0; n < 32; n++ {
		line, err := reader.ReadString('\n')
		if err != nil || len(line) > 8192 {
			return nil, errors.New("invalid session gate")
		}
		line = strings.TrimSpace(line)
		if line == "EXAM-GATE/1" && !sent {
			b, _ := json.Marshal(map[string]string{"token": token})
			in.Write(append(b, '\n'))
			sent = true
		}
		if strings.HasPrefix(line, "EXAM-READY ") {
			result = json.RawMessage(strings.TrimPrefix(line, "EXAM-READY "))
			break
		}
		if strings.HasPrefix(line, "EXAM-ERROR") {
			return nil, errors.New("session admission rejected")
		}
	}
	if result == nil {
		return nil, errors.New("session gate missing acknowledgment")
	}
	p := &Pane{session: s, in: in, out: reader}
	c.mu.Lock()
	c.panes[pane] = p
	c.mu.Unlock()
	ok = true
	go func() {
		b := make([]byte, 32768)
		for {
			n, err := reader.Read(b)
			if n > 0 {
				c.Emit(map[string]any{"type": "output", "pane": pane, "data": base64.StdEncoding.EncodeToString(b[:n])})
			}
			if err != nil {
				break
			}
		}
		s.Wait()
		c.mu.Lock()
		delete(c.panes, pane)
		c.mu.Unlock()
		c.Emit(map[string]any{"type": "closed", "pane": pane})
	}()
	return result, nil
}
func (c *Client) Input(pane, data string) error {
	c.mu.Lock()
	p := c.panes[pane]
	c.mu.Unlock()
	if p == nil {
		return errors.New("unknown pane")
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	_, err := io.WriteString(p.in, data)
	return err
}
func (c *Client) Resize(pane string, rows, cols int) error {
	c.mu.Lock()
	p := c.panes[pane]
	c.mu.Unlock()
	if p == nil {
		return nil
	}
	return p.session.WindowChange(rows, cols)
}
func (c *Client) ClosePane(pane string) {
	c.mu.Lock()
	p := c.panes[pane]
	delete(c.panes, pane)
	c.mu.Unlock()
	if p != nil {
		p.session.Close()
	}
}
