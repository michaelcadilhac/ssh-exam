package main

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/coder/websocket"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestRelayRecordsFirstObservedCloseAndNoPrivateErrors(t *testing.T) {
	for _, mode := range []string{"browser-close", "upstream-close", "ping-timeout", "dial-failure", "shutdown"} {
		t.Run(mode, func(t *testing.T) {
			r, key := fixture(t)
			reports := make(chan relayDiagnostic, 2)
			r.report = func(v relayDiagnostic) { reports <- v }
			r.pingEvery = 10 * time.Millisecond
			r.pingTimeout = 40 * time.Millisecond
			var upstream net.Conn
			r.dial = func(context.Context) (net.Conn, error) {
				if mode == "dial-failure" {
					return nil, errors.New("password=PRIVATE-MFA-ANSWER")
				}
				a, b := net.Pipe()
				upstream = b
				return a, nil
			}
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, q *http.Request) { r.serve(ctx, w, q) }))
			defer s.Close()
			c, readCtx := connect(t, s, r)
			packet := signTicket(r, key, nil)
			if err := c.Write(readCtx, websocket.MessageText, packet); err != nil {
				t.Fatal(err)
			}
			if mode != "dial-failure" {
				kind, b, err := c.Read(readCtx)
				if err != nil || kind != websocket.MessageText || string(b) != `{"ready":true}` {
					t.Fatal(kind, string(b), err)
				}
				defer upstream.Close()
				switch mode {
				case "browser-close":
					c.CloseNow()
				case "upstream-close":
					upstream.Close()
				case "shutdown":
					cancel()
				}
			}
			var report relayDiagnostic
			select {
			case report = <-reports:
			case <-time.After(2 * time.Second):
				t.Fatal("no bounded close report")
			}
			expected := map[string]string{"browser-close": "browser-to-jump", "upstream-close": "jump-to-browser", "ping-timeout": "websocket-ping", "dial-failure": "jump-dial", "shutdown": "relay-shutdown"}[mode]
			if report.Trigger != expected || report.Reference != ticketReference(packet) || len(report.Reference) != 24 {
				t.Fatalf("wrong causal/correlation record: %+v", report)
			}
			if mode == "ping-timeout" && report.Cause != "timeout" {
				t.Fatalf("ping timeout lost: %+v", report)
			}
			raw, _ := json.Marshal(report)
			if strings.Contains(string(raw), "PRIVATE") || strings.Contains(string(raw), string(packet)) {
				t.Fatal("private error/ticket leaked")
			}
			select {
			case extra := <-reports:
				t.Fatalf("duplicate report %+v", extra)
			default:
			}
		})
	}
}

func TestRelayDelayedPingReplyKeepsOpaqueStreamAndShutdownJoins(t *testing.T) {
	r, key := fixture(t)
	r.pingEvery = 10 * time.Millisecond
	r.pingTimeout = 300 * time.Millisecond
	reports := make(chan relayDiagnostic, 2)
	r.report = func(v relayDiagnostic) { reports <- v }
	r.dial = func(context.Context) (net.Conn, error) {
		a, b := net.Pipe()
		go func() { defer b.Close(); io.Copy(b, b) }()
		return a, nil
	}
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, q *http.Request) { r.serve(context.Background(), w, q) }))
	defer s.Close()
	c, ctx := connect(t, s, r)
	c.Write(ctx, websocket.MessageText, signTicket(r, key, nil))
	c.Read(ctx)
	// The client does not read/pong during this real scheduling stall.
	time.Sleep(80 * time.Millisecond)
	select {
	case v := <-reports:
		t.Fatalf("short stall closed SSH: %+v", v)
	default:
	}
	if err := c.Write(ctx, websocket.MessageBinary, []byte("opaque")); err != nil {
		t.Fatal(err)
	}
	kind, data, err := c.Read(ctx)
	if err != nil || kind != websocket.MessageBinary || string(data) != "opaque" {
		t.Fatal(kind, string(data), err)
	}
	c.CloseNow()
	select {
	case <-reports:
	case <-ctx.Done():
		t.Fatal("transport cleanup did not join")
	}
}

func TestRelayReferenceMatchesGatewayPayloadDigest(t *testing.T) {
	packet := []byte(`{"payload":"YWJj","signature":"PRIVATE"}`)
	if got := ticketReference(packet); got != "35d95694d3f160215db293c7" {
		t.Fatal("cross-language correlation changed", got)
	}
}

func TestRelayRealTwentyThreeSecondStallPreservesConnection(t *testing.T) {
	r, key := fixture(t)
	if r.pingTimeout != 60*time.Second {
		t.Fatal("not the production sixty-second ping budget")
	}
	r.pingEvery = 10 * time.Millisecond // Start a ping promptly; retain its REAL60s reply deadline.
	reports := make(chan relayDiagnostic, 2)
	r.report = func(v relayDiagnostic) { reports <- v }
	r.dial = func(context.Context) (net.Conn, error) {
		a, b := net.Pipe()
		go func() { defer b.Close(); io.Copy(b, b) }()
		return a, nil
	}
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, q *http.Request) { r.serve(context.Background(), w, q) }))
	defer s.Close()
	c, ctx := connect(t, s, r)
	c.Write(ctx, websocket.MessageText, signTicket(r, key, nil))
	c.Read(ctx)
	time.Sleep(23 * time.Second)
	select {
	case v := <-reports:
		t.Fatalf("a real short scheduling stall closed SSH: %+v", v)
	default:
	}
	fresh, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	if err := c.Write(fresh, websocket.MessageBinary, []byte("still-opaque")); err != nil {
		t.Fatal(err)
	}
	kind, data, err := c.Read(fresh)
	if err != nil || kind != websocket.MessageBinary || string(data) != "still-opaque" {
		t.Fatal(kind, string(data), err)
	}
	c.CloseNow()
	select {
	case <-reports:
	case <-fresh.Done():
		t.Fatal("cleanup did not finish")
	}
}
