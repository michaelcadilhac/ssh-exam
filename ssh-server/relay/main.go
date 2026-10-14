// The relay transports opaque SSH bytes. It never authenticates SSH users,
// decrypts terminal traffic, or accepts a client-selected destination.
package main

import (
	"bufio"
	"context"
	"crypto/ed25519"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"flag"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/coder/websocket"
)

const route = "/ssh-exam/relay"
const destination = "sshjump.depaul.edu:22"

type config struct {
	Listen    string `json:"listen"`
	Origin    string `json:"origin"`
	Audience  string `json:"audience"`
	PublicKey string `json:"public_key"`
	// DialTarget may be the jump host's administrator-configured internal IP.
	// It does not change the SSH identity that the browser must pin.
	DialTarget      string `json:"dial_target"`
	Proxy           string `json:"proxy"`
	ReplayDirectory string `json:"replay_directory"`
}

type frame struct {
	Payload   string `json:"payload"`
	Signature string `json:"signature"`
}

type ticket struct {
	Audience string `json:"audience"`
	Op       string `json:"op"`
	Nonce    string `json:"nonce"`
	Issued   int64  `json:"issued"`
	Expires  int64  `json:"expires"`
	Origin   string `json:"origin"`
	Target   string `json:"target"`
	Username string `json:"username"`
	Exam     string `json:"exam"`
}

var usernamePattern = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$`)
var examPattern = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`)
var noncePattern = regexp.MustCompile(`^[a-zA-Z0-9_-]{16,64}$`)

type relay struct {
	config config
	key    ed25519.PublicKey
	mu     sync.Mutex
	used   map[string]int64
	users  map[string]int
	slots  chan struct{}
	dial   func(context.Context) (net.Conn, error)
}

func load(c config) (*relay, error) {
	address, err := net.ResolveTCPAddr("tcp", c.Listen)
	if err != nil || address.IP == nil || !address.IP.IsLoopback() || address.Port == 0 {
		return nil, errors.New("relay must listen on an explicit loopback address")
	}
	origin, err := url.Parse(c.Origin)
	if err != nil || origin.Scheme != "https" || origin.Host == "" || origin.String() != origin.Scheme+"://"+origin.Host {
		return nil, errors.New("exact HTTPS origin required")
	}
	if !examPattern.MatchString(c.Audience) {
		return nil, errors.New("invalid relay audience")
	}
	host, port, err := net.SplitHostPort(c.DialTarget)
	if err != nil || port != "22" || (net.ParseIP(host) == nil && host != "sshjump.depaul.edu") {
		return nil, errors.New("fixed jump-host IP or hostname on port 22 required")
	}
	if c.Proxy != "" {
		proxy, err := url.Parse(c.Proxy)
		if err != nil || proxy.Scheme != "http" || proxy.Host == "" || proxy.User != nil || proxy.RawQuery != "" || proxy.Fragment != "" || (proxy.Path != "" && proxy.Path != "/") {
			return nil, errors.New("invalid credential-free HTTP CONNECT proxy")
		}
	}
	data, err := os.ReadFile(c.PublicKey)
	if err != nil {
		return nil, err
	}
	block, _ := pem.Decode(data)
	if block == nil {
		return nil, errors.New("missing relay verification public key")
	}
	parsed, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		return nil, err
	}
	key, ok := parsed.(ed25519.PublicKey)
	if !ok {
		return nil, errors.New("Ed25519 verification key required")
	}
	if !filepath.IsAbs(c.ReplayDirectory) {
		return nil, errors.New("private replay directory required")
	}
	info, err := os.Stat(c.ReplayDirectory)
	if err != nil || !info.IsDir() || info.Mode().Perm()&0077 != 0 {
		return nil, errors.New("private replay directory unavailable")
	}
	r := &relay{config: c, key: key, used: map[string]int64{}, users: map[string]int{}, slots: make(chan struct{}, 200)}
	r.dial = r.dialJump
	return r, nil
}

func decode(data []byte, v any) error {
	d := json.NewDecoder(strings.NewReader(string(data)))
	d.DisallowUnknownFields()
	if err := d.Decode(v); err != nil {
		return err
	}
	if err := d.Decode(new(any)); err != io.EOF {
		return errors.New("trailing JSON")
	}
	return nil
}

func (r *relay) consume(data []byte, now int64) (string, error) {
	var f frame
	if len(data) > 8192 || decode(data, &f) != nil {
		return "", errors.New("invalid ticket")
	}
	bytes, err := base64.StdEncoding.DecodeString(f.Payload)
	if err != nil || len(bytes) > 4096 {
		return "", errors.New("invalid ticket")
	}
	sig, err := base64.StdEncoding.DecodeString(f.Signature)
	if err != nil || !ed25519.Verify(r.key, bytes, sig) {
		return "", errors.New("invalid ticket")
	}
	var t ticket
	if decode(bytes, &t) != nil || t.Audience != r.config.Audience || t.Op != "relay-connect" || t.Origin != r.config.Origin || t.Target != destination || !usernamePattern.MatchString(t.Username) || !examPattern.MatchString(t.Exam) || !noncePattern.MatchString(t.Nonce) {
		return "", errors.New("invalid ticket scope")
	}
	if t.Issued > now+5000 || t.Expires <= now || t.Expires <= t.Issued || t.Expires-t.Issued > 30000 || t.Expires > now+35000 {
		return "", errors.New("expired ticket")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	for n, expires := range r.used {
		if expires <= now {
			delete(r.used, n)
		}
	}
	if _, used := r.used[t.Nonce]; used {
		return "", errors.New("replayed ticket")
	}
	if len(r.used) >= 5000 || r.users[t.Username] >= 4 {
		return "", errors.New("relay limit")
	}
	// Consume durably BEFORE connecting. Service restart cannot make tickets reusable.
	if err := r.remember(t.Nonce, t.Expires, now); err != nil {
		return "", errors.New("ticket persistence rejected")
	}
	r.used[t.Nonce] = t.Expires
	r.users[t.Username]++
	return t.Username, nil
}

func (r *relay) remember(nonce string, expires, now int64) error {
	files, err := os.ReadDir(r.config.ReplayDirectory)
	if err != nil {
		return err
	}
	count := 0
	for _, f := range files {
		if !noncePattern.MatchString(f.Name()) || !f.Type().IsRegular() {
			return errors.New("invalid replay state")
		}
		file := filepath.Join(r.config.ReplayDirectory, f.Name())
		b, err := os.ReadFile(file)
		if err != nil {
			return err
		}
		until, err := strconv.ParseInt(string(b), 10, 64)
		if err != nil {
			return err
		}
		if until <= now {
			if err := os.Remove(file); err != nil {
				return err
			}
		} else {
			count++
		}
	}
	if count >= 5000 {
		return errors.New("replay state full")
	}
	f, err := os.OpenFile(filepath.Join(r.config.ReplayDirectory, nonce), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	_, err = f.WriteString(strconv.FormatInt(expires, 10))
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	dir, err := os.Open(r.config.ReplayDirectory)
	if err != nil {
		return err
	}
	defer dir.Close()
	return dir.Sync()
}

type bufferedConn struct {
	net.Conn
	reader *bufio.Reader
}

func (c *bufferedConn) Read(p []byte) (int, error) { return c.reader.Read(p) }

func (r *relay) dialJump(ctx context.Context) (net.Conn, error) {
	d := net.Dialer{Timeout: 8 * time.Second, KeepAlive: 15 * time.Second}
	if r.config.Proxy == "" {
		return d.DialContext(ctx, "tcp", r.config.DialTarget)
	}
	proxy, _ := url.Parse(r.config.Proxy)
	address := proxy.Host
	if proxy.Port() == "" {
		address = net.JoinHostPort(proxy.Hostname(), "80")
	}
	c, err := d.DialContext(ctx, "tcp", address)
	if err != nil {
		return nil, err
	}
	ok := false
	defer func() {
		if !ok {
			c.Close()
		}
	}()
	deadline := time.Now().Add(8 * time.Second)
	if until, found := ctx.Deadline(); found && until.Before(deadline) {
		deadline = until
	}
	c.SetDeadline(deadline)
	// The target is static administrator configuration, never ticket/client input.
	if _, err = io.WriteString(c, "CONNECT "+r.config.DialTarget+" HTTP/1.1\r\nHost: "+r.config.DialTarget+"\r\n\r\n"); err != nil {
		return nil, err
	}
	reader := bufio.NewReader(c)
	response, err := http.ReadResponse(reader, &http.Request{Method: "CONNECT"})
	if err != nil {
		return nil, err
	}
	if response.StatusCode != 200 {
		response.Body.Close()
		return nil, errors.New("proxy refused jump connection")
	}
	c.SetDeadline(time.Time{})
	ok = true
	return &bufferedConn{Conn: c, reader: reader}, nil
}

func (r *relay) serve(ctx context.Context, w http.ResponseWriter, req *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if req.URL.Path == "/health/live" && req.Method == "GET" && req.URL.RawQuery == "" {
		w.Write([]byte("ok\n"))
		return
	}
	if req.URL.Path != route || req.Method != "GET" || req.URL.RawQuery != "" {
		http.NotFound(w, req)
		return
	}
	if req.Header.Get("Origin") != r.config.Origin {
		http.Error(w, "Forbidden", 403)
		return
	}
	select {
	case r.slots <- struct{}{}:
		defer func() { <-r.slots }()
	default:
		http.Error(w, "Relay busy", 503)
		return
	}
	c, err := websocket.Accept(w, req, &websocket.AcceptOptions{InsecureSkipVerify: true, CompressionMode: websocket.CompressionDisabled})
	// Origin was matched exactly above; the library's host-pattern matching is not used.
	if err != nil {
		return
	}
	defer c.CloseNow()
	c.SetReadLimit(8192)
	loginCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	kind, packet, err := c.Read(loginCtx)
	cancel()
	if err != nil || kind != websocket.MessageText {
		c.Close(websocket.StatusPolicyViolation, "Ticket required")
		return
	}
	user, err := r.consume(packet, time.Now().UnixMilli())
	clear(packet)
	if err != nil {
		c.Close(websocket.StatusPolicyViolation, "Ticket rejected")
		return
	}
	defer func() {
		r.mu.Lock()
		r.users[user]--
		if r.users[user] == 0 {
			delete(r.users, user)
		}
		r.mu.Unlock()
	}()
	dialCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
	upstream, err := r.dial(dialCtx)
	cancel()
	if err != nil {
		c.Close(websocket.StatusTryAgainLater, "Jump host unavailable")
		return
	}
	defer upstream.Close()
	// Readiness is a text frame. All subsequent frames carry binary SSH packets.
	if c.Write(ctx, websocket.MessageText, []byte(`{"ready":true}`)) != nil {
		return
	}
	c.SetReadLimit(256 * 1024)
	streamCtx, cancel := context.WithTimeout(ctx, 8*time.Hour)
	defer cancel()
	stream := websocket.NetConn(streamCtx, c, websocket.MessageBinary)
	defer stream.Close()
	done := make(chan struct{}, 2)
	go func() { io.Copy(upstream, stream); done <- struct{}{} }()
	go func() { io.Copy(stream, upstream); done <- struct{}{} }()
	go func() {
		ticker := time.NewTicker(25 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-streamCtx.Done():
				return
			case <-ticker.C:
				pingCtx, end := context.WithTimeout(streamCtx, 5*time.Second)
				err := c.Ping(pingCtx)
				end()
				if err != nil {
					cancel()
					return
				}
			}
		}
	}()
	left := 2
	select {
	case <-done:
		left--
	case <-streamCtx.Done():
	}
	cancel()
	upstream.Close()
	c.CloseNow()
	// Join both copiers, including the one that may already have signaled done.
	// Closing the transport unblocks any pending read/write.
	for ; left > 0; left-- {
		<-done
	}
}

func main() {
	file := flag.String("config", "/etc/exam-relay/config.json", "administrator-owned relay configuration")
	check := flag.Bool("check", false, "validate configuration without starting")
	probe := flag.Bool("probe", false, "check jump-host reachability without credentials")
	flag.Parse()
	data, err := os.ReadFile(*file)
	if err != nil {
		log.Fatal("relay configuration unavailable")
	}
	var c config
	if decode(data, &c) != nil {
		log.Fatal("relay configuration invalid")
	}
	r, err := load(c)
	if err != nil {
		log.Fatal("relay configuration rejected: ", err)
	}
	if *probe {
		ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		defer cancel()
		conn, err := r.dialJump(ctx)
		if err != nil {
			log.Fatal("jump-host connection unavailable")
		}
		defer conn.Close()
		conn.SetReadDeadline(time.Now().Add(3 * time.Second))
		banner, err := bufio.NewReader(conn).ReadString('\n')
		if err != nil || !strings.HasPrefix(banner, "SSH-2.0-") {
			log.Fatal("jump-host SSH greeting unavailable")
		}
		log.Print("jump-host SSH greeting verified; no credentials supplied")
		return
	}
	if *check {
		log.Print("relay configuration verified")
		return
	}
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()
	server := &http.Server{Addr: c.Listen, Handler: http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) { r.serve(ctx, w, req) }), ReadHeaderTimeout: 5 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 8192}
	go func() {
		<-ctx.Done()
		stop, end := context.WithTimeout(context.Background(), 5*time.Second)
		defer end()
		server.Shutdown(stop)
	}()
	log.Print("exam SSH relay started")
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal("relay listener failed")
	}
}
