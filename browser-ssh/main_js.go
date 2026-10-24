//go:build js && wasm

package main

import (
	"context"
	"encoding/json"
	"errors"
	"examworkspace/browser-ssh/client"
	"github.com/coder/websocket"
	"sync"
	"syscall/js"
	"time"
)

var sshClient *client.Client
var mu sync.Mutex
var pending = map[string]chan []string{}

func emit(v any) {
	b, _ := json.Marshal(v)
	js.Global().Call("postMessage", js.Global().Get("JSON").Call("parse", string(b)))
}
func dialogue(ctx context.Context, host, text string, p []client.Prompt) ([]string, error) {
	if len(p) == 0 {
		emit(map[string]any{"type": "notice", "host": host, "instruction": text, "prompts": []client.Prompt{}})
		return []string{}, nil
	}
	id := time.Now().Format("150405.000000000")
	ch := make(chan []string, 1)
	mu.Lock()
	pending[id] = ch
	mu.Unlock()
	defer func() { mu.Lock(); delete(pending, id); mu.Unlock() }()
	emit(map[string]any{"type": "challenge", "round": id, "host": host, "instruction": text, "prompts": p})
	select {
	case a := <-ch:
		return a, nil
	case <-ctx.Done():
		return nil, errors.New("authentication cancelled or timed out")
	}
}

type request struct {
	ID   string          `json:"id"`
	Op   string          `json:"op"`
	Args json.RawMessage `json:"args"`
}

func handle(r request) (any, error) {
	switch r.Op {
	case "connect":
		var a struct {
			URL         string          `json:"url"`
			Ticket      json.RawMessage `json:"ticket"`
			Username    string          `json:"username"`
			Jump, Class client.Host
		}
		if json.Unmarshal(r.Args, &a) != nil {
			return nil, errors.New("invalid SSH configuration")
		}
		if sshClient != nil {
			sshClient.Close()
		}
		sshClient = client.New(emit)
		ctx, end := context.WithTimeout(context.Background(), 15*time.Second)
		defer end()
		ws, _, err := websocket.Dial(ctx, a.URL, nil)
		if err != nil {
			return nil, errors.New("SSH relay unavailable")
		}
		ws.SetReadLimit(256 * 1024)
		if err = ws.Write(ctx, websocket.MessageText, a.Ticket); err != nil {
			ws.CloseNow()
			return nil, err
		}
		clear(a.Ticket)
		a.Ticket = nil
		kind, data, err := ws.Read(ctx)
		if err != nil || kind != websocket.MessageText || string(data) != `{"ready":true}` {
			ws.CloseNow()
			return nil, errors.New("SSH relay ticket rejected")
		}
		raw := websocket.NetConn(context.Background(), ws, websocket.MessageBinary)
		if err = sshClient.Connect(raw, a.Username, a.Jump, a.Class, dialogue); err != nil {
			raw.Close()
			return nil, err
		}
		return map[string]bool{"connected": true, "command_cancel": true, "framed_input": true, "pane_epoch_change": true}, nil
	case "answers":
		var a struct {
			Round   string   `json:"round"`
			Answers []string `json:"answers"`
		}
		json.Unmarshal(r.Args, &a)
		mu.Lock()
		ch := pending[a.Round]
		delete(pending, a.Round)
		mu.Unlock()
		if ch == nil {
			clear(a.Answers)
			return nil, errors.New("challenge ended")
		}
		ch <- a.Answers
		return nil, nil
	case "handoff-key":
		public, err := sshClient.HandoffPublicKey()
		return map[string]string{"public_key": public}, err
	case "handoff":
		var a struct {
			Certificate string `json:"certificate"`
		}
		if json.Unmarshal(r.Args, &a) != nil {
			return nil, errors.New("invalid SSH handoff")
		}
		return nil, sshClient.HandoffClass(a.Certificate)
	case "discard-handoff":
		sshClient.DiscardHandoffKey()
		return nil, nil
	case "command":
		return sshClient.Command(r.Args)
	case "cancel-command":
		var a struct{ Nonce string }
		if json.Unmarshal(r.Args, &a) != nil || len(a.Nonce) < 16 || len(a.Nonce) > 64 {
			return nil, errors.New("invalid command cancellation")
		}
		return map[string]bool{"cancelled": sshClient.CancelCommand(a.Nonce)}, nil
	case "open":
		var a struct {
			Pane, Token string
			InputEpoch  string `json:"input_epoch,omitempty"`
		}
		if json.Unmarshal(r.Args, &a) != nil {
			return nil, errors.New("invalid pane request")
		}
		if a.InputEpoch != "" {
			return sshClient.OpenFramed(a.Pane, a.Token, a.InputEpoch)
		}
		return sshClient.Open(a.Pane, a.Token)
	case "input-framed":
		var a struct {
			Pane, Epoch, Data string
			Sequence          uint64
		}
		if json.Unmarshal(r.Args, &a) != nil || len(a.Data) > 32768 {
			return nil, errors.New("invalid framed input")
		}
		return nil, sshClient.InputFramed(a.Pane, a.Epoch, a.Sequence, a.Data)
	case "resize-framed":
		var a struct {
			Pane, Epoch string
			Sequence    uint64
			Rows, Cols  int
		}
		if json.Unmarshal(r.Args, &a) != nil {
			return nil, errors.New("invalid framed resize")
		}
		return nil, sshClient.ResizeFramed(a.Pane, a.Epoch, a.Sequence, a.Rows, a.Cols)
	case "change-input-epoch":
		var a struct{ Pane, Previous, Next string }
		if json.Unmarshal(r.Args, &a) != nil {
			return nil, errors.New("invalid pane epoch change")
		}
		return nil, sshClient.ChangeInputEpoch(a.Pane, a.Previous, a.Next)
	case "input":
		var a struct{ Pane, Data string }
		json.Unmarshal(r.Args, &a)
		if len(a.Data) > 32768 {
			return nil, errors.New("input too large")
		}
		return nil, sshClient.Input(a.Pane, a.Data)
	case "resize":
		var a struct {
			Pane       string
			Rows, Cols int
		}
		json.Unmarshal(r.Args, &a)
		if a.Rows < 2 || a.Cols < 2 || a.Rows > 500 || a.Cols > 500 {
			return nil, errors.New("invalid terminal size")
		}
		return nil, sshClient.Resize(a.Pane, a.Rows, a.Cols)
	case "close-pane":
		var a struct{ Pane string }
		json.Unmarshal(r.Args, &a)
		sshClient.ClosePane(a.Pane)
		return nil, nil
	case "close":
		if sshClient != nil {
			sshClient.Close()
		}
		return nil, nil
	}
	return nil, errors.New("unknown browser SSH operation")
}
func main() {
	fn := js.FuncOf(func(_ js.Value, args []js.Value) any {
		var r request
		json.Unmarshal([]byte(args[0].String()), &r)
		go func() {
			defer clear(r.Args)
			result, err := handle(r)
			if err != nil {
				emit(map[string]any{"type": "rpc-result", "id": r.ID, "error": err.Error()})
			} else {
				emit(map[string]any{"type": "rpc-result", "id": r.ID, "result": result})
			}
		}()
		return nil
	})
	js.Global().Set("examSSHrequest", fn)
	emit(map[string]any{"type": "ready"})
	select {}
}
