package main

// Private local operation metadata. A receipt is never execution permission.
import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"examworkspace/agent/internal/core"
	"fmt"
	"golang.org/x/sys/unix"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

const scriptReceiptBytes = 8 * 1024 * 1024

type scriptReceipt struct {
	Version    int                   `json:"version"`
	Agent      string                `json:"agent"`
	Origin     string                `json:"origin"`
	GatewayKey string                `json:"gateway_key_sha256"`
	Operation  string                `json:"operation"`
	Request    string                `json:"request"`
	Body       map[string]any        `json:"body"`
	BodyHash   string                `json:"body_sha256"`
	WireBody   json.RawMessage       `json:"wire_body"`
	WireHash   string                `json:"wire_body_sha256"`
	Outcome    string                `json:"outcome"`
	Created    int64                 `json:"created"`
	Updated    int64                 `json:"updated"`
	Result     core.ManagementResult `json:"result"`
	ResultHash string                `json:"result_sha256,omitempty"`
	Failure    *scriptFailure        `json:"failure,omitempty"`
}
type scriptFailure struct {
	Code    string `json:"code"`
	Outcome string `json:"outcome"`
	Retry   string `json:"retry"`
	Message string `json:"message"`
}

func scriptDigest(data []byte) string { sum := sha256.Sum256(data); return hex.EncodeToString(sum[:]) }
func scriptBodyDigest(body any) (string, error) {
	encoded, err := json.Marshal(body)
	if err != nil {
		return "", err
	}
	var canonical any
	if err := decodeScriptJSON(encoded, &canonical); err != nil {
		return "", err
	}
	encoded, err = json.Marshal(canonical)
	if err != nil {
		return "", err
	}
	return scriptDigest(encoded), nil
}
func scriptContext(c core.Config) (string, error) {
	key, err := os.ReadFile(c.GatewayPublicKey)
	if err != nil || len(key) > 16384 {
		return "", errors.New("cannot bind receipt to configured gateway verification key")
	}
	return scriptDigest(key), nil
}
func (r *scriptReceipt) checkContext(c core.Config) error {
	key, err := scriptContext(c)
	if err != nil {
		return err
	}
	if r.Agent != c.AgentID || r.Origin != strings.TrimSuffix(c.CallbackURL, "/") || r.GatewayKey != key {
		return errors.New("receipt agent/origin/verification-key mismatch; no action sent")
	}
	return nil
}
func scriptPrivateParent(path string) error {
	if path == "" || path == "-" {
		return errors.New("select a private receipt/output file")
	}
	info, err := os.Lstat(filepath.Dir(path))
	if err != nil || !info.IsDir() || info.Mode()&os.ModeSymlink != 0 || info.Mode().Perm()&0077 != 0 {
		return errors.New("receipt/output needs an existing private0700 parent directory")
	}
	st, ok := info.Sys().(*syscall.Stat_t)
	if !ok || st.Uid != uint32(os.Geteuid()) {
		return errors.New("private parent must belong to the invoking root identity")
	}
	return nil
}
func readScriptPrivate(path string, limit int64) ([]byte, error) {
	if err := scriptPrivateParent(path); err != nil {
		return nil, err
	}
	f, err := os.OpenFile(path, os.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm() != 0600 || info.Size() > limit {
		return nil, errors.New("private metadata must be a bounded regular0600 file, never a link/device/FIFO")
	}
	st, ok := info.Sys().(*syscall.Stat_t)
	if !ok || st.Uid != uint32(os.Geteuid()) || st.Nlink != 1 {
		return nil, errors.New("private metadata owner/link count refused")
	}
	b, err := io.ReadAll(io.LimitReader(f, limit+1))
	if err != nil || int64(len(b)) > limit {
		return nil, errors.New("private metadata read exceeded its bound")
	}
	return b, nil
}
func readScriptReceipt(path string) (*scriptReceipt, error) {
	b, err := readScriptPrivate(path, scriptReceiptBytes)
	if err != nil {
		return nil, err
	}
	var r scriptReceipt
	d := json.NewDecoder(bytes.NewReader(b))
	d.DisallowUnknownFields()
	d.UseNumber()
	if d.Decode(&r) != nil || d.Decode(new(any)) != io.EOF || r.Version != 1 || r.Agent == "" || r.Origin == "" || !catalogHash.MatchString(r.GatewayKey) || !managementUUID.MatchString(r.Request) || r.Created <= 0 || r.Updated < r.Created || r.Body == nil {
		return nil, errors.New("invalid/unsupported receipt; preserve original intent")
	}
	digest, err := scriptBodyDigest(r.Body)
	if err != nil || digest != r.BodyHash {
		return nil, errors.New("receipt arguments changed; never substitute arguments in a retry")
	}
	var compact bytes.Buffer
	if json.Compact(&compact, r.WireBody) != nil || scriptDigest(compact.Bytes()) != r.WireHash {
		return nil, errors.New("receipt original wire body changed")
	}
	wireDigest, err := scriptBodyDigest(r.WireBody)
	if err != nil || wireDigest != r.BodyHash {
		return nil, errors.New("receipt wire arguments differ from reviewed metadata")
	}
	switch r.Outcome {
	case "prepared", "unknown", "confirmed", "refused":
	default:
		return nil, errors.New("unknown receipt outcome")
	}
	if !scriptReceiptOperation(r.Operation) {
		return nil, errors.New("receipt operation is outside metadata/review scope")
	}
	if r.Outcome == "confirmed" && (!r.Result.Confirmed || r.Result.Request != r.Request || r.Result.Operation != r.Operation || len(r.Result.Result) == 0) {
		return nil, errors.New("receipt lacks its matching confirmed result")
	}
	if r.Outcome == "refused" && (r.Failure == nil || r.Failure.Outcome != "refused") {
		return nil, errors.New("refusal receipt lacks a confirmed refusal")
	}
	if len(r.Result.Result) > 0 {
		digest, err := scriptBodyDigest(r.Result)
		if err != nil || digest != r.ResultHash {
			return nil, errors.New("receipt result digest changed; preserve original receipt")
		}
		if r.Operation != "grants.source-sync-batch" {
			if err := scriptValidateResult(r.Agent, r.Operation, r.Body, r.Result.Result); err != nil {
				return nil, err
			}
		}
	}
	return &r, nil
}
func scriptReceiptOperation(op string) bool {
	switch op {
	case "exams.show", "grants.show", "grants.additional-preview", "grants.issue-preview", "grants.issue-show", "grants.issue-confirm", "grants.issue-cancel", "grants.source-confirm", "grants.source-sync-batch":
		return true
	}
	return false
}
func scriptLock(path string) (*os.File, error) {
	if err := scriptPrivateParent(path); err != nil {
		return nil, err
	}
	f, err := os.OpenFile(path+".lock", os.O_CREATE|os.O_RDWR|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0600)
	if err != nil {
		return nil, err
	}
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm() != 0600 {
		f.Close()
		return nil, errors.New("unsafe receipt lock")
	}
	st := info.Sys().(*syscall.Stat_t)
	if st.Uid != uint32(os.Geteuid()) || st.Nlink != 1 || syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB) != nil {
		f.Close()
		return nil, errors.New("receipt is busy or lock unsafe; do not remove a running lock")
	}
	return f, nil
}
func writeScriptPrivate(path string, data []byte, replace bool) error {
	if len(data) > scriptExportBytes {
		return errors.New("private output bound exceeded")
	}
	if err := scriptPrivateParent(path); err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(path), ".examctl-*")
	if err != nil {
		return err
	}
	name := f.Name()
	defer os.Remove(name)
	if err = f.Chmod(0600); err == nil {
		var n int
		n, err = f.Write(data)
		if err == nil && n != len(data) {
			err = io.ErrShortWrite
		}
	}
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	if replace {
		if _, err := readScriptPrivate(path, scriptReceiptBytes); err != nil {
			return err
		}
		err = os.Rename(name, path)
	} else {
		// Atomic no-replace publication keeps a single link even if the CLI dies
		// immediately afterward. A link/unlink sequence strands a rejected nlink2
		// receipt after a crash and prevents safe resume.
		err = unix.Renameat2(unix.AT_FDCWD, name, unix.AT_FDCWD, path, unix.RENAME_NOREPLACE)
	}
	if err != nil {
		return err
	}
	dir, err := os.Open(filepath.Dir(path))
	if err != nil {
		return err
	}
	defer dir.Close()
	return dir.Sync()
}
func writeScriptExport(path string, data []byte) error { return writeScriptPrivate(path, data, false) }
func saveScriptReceipt(path string, r *scriptReceipt, replace bool) error {
	r.Updated = time.Now().UnixMilli()
	if r.Updated < r.Created {
		r.Updated = r.Created
	}
	if len(r.Result.Result) > 0 {
		digest, err := scriptBodyDigest(r.Result)
		if err != nil {
			return err
		}
		r.ResultHash = digest
	}
	b, err := json.MarshalIndent(r, "", "  ")
	if err != nil || len(b) > scriptReceiptBytes {
		return errors.New("receipt encoding/bound refused; retain original request")
	}
	return writeScriptPrivate(path, append(b, '\n'), replace)
}
func newScriptReceipt(c core.Config, op, request string, body map[string]any) (*scriptReceipt, error) {
	if !scriptReceiptOperation(op) {
		return nil, errors.New("operation cannot be stored in a scripting receipt")
	}
	key, err := scriptContext(c)
	if err != nil {
		return nil, err
	}
	if request == "" {
		request = core.ManagementID()
	}
	digest, err := scriptBodyDigest(body)
	if err != nil {
		return nil, err
	}
	wire, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	now := time.Now().UnixMilli()
	return &scriptReceipt{Version: 1, Agent: c.AgentID, Origin: strings.TrimSuffix(c.CallbackURL, "/"), GatewayKey: key, Operation: op, Request: request, Body: body, BodyHash: digest, WireBody: wire, WireHash: scriptDigest(wire), Outcome: "prepared", Created: now, Updated: now}, nil
}
func loadScriptIntent(c core.Config, o *scriptOptions, op string, body map[string]any) (*scriptReceipt, *os.File, bool, error) {
	lock, err := scriptLock(o.receipt)
	if err != nil {
		return nil, nil, false, err
	}
	if _, err := os.Lstat(o.receipt); err == nil {
		if !o.resume {
			lock.Close()
			return nil, nil, false, errors.New("receipt exists; use --resume for identical intent or a NEW file/review")
		}
		r, err := readScriptReceipt(o.receipt)
		digest, encodeErr := scriptBodyDigest(body)
		if err == nil {
			err = r.checkContext(c)
		}
		if err != nil || encodeErr != nil || r.Operation != op || r.BodyHash != digest || (o.request != "" && o.request != r.Request) {
			lock.Close()
			return nil, nil, false, errors.New("receipt context/operation/arguments changed; no new intent sent")
		}
		o.request = r.Request
		return r, lock, true, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		lock.Close()
		return nil, nil, false, err
	}
	r, err := newScriptReceipt(c, op, o.request, body)
	if err == nil {
		err = saveScriptReceipt(o.receipt, r, false)
	}
	if err != nil {
		lock.Close()
		return nil, nil, false, err
	}
	o.request = r.Request
	return r, lock, false, nil
}
func scriptError(err error) *scriptFailure {
	var failure *core.ManagementFailure
	if errors.As(err, &failure) {
		return &scriptFailure{Code: failure.Code, Outcome: failure.Outcome, Retry: failure.Retry, Message: failure.Error()}
	}
	return &scriptFailure{Code: "unconfirmed", Outcome: "unknown", Retry: "same_request_or_receipt", Message: err.Error()}
}
func scriptManagementFailure(o scriptOptions, request string, err error) int {
	o.request = request
	failure := scriptError(err)
	return scriptFail(o, failure.Code, failure.Outcome, failure.Retry, err)
}
func scriptOperation(c core.Config, o scriptOptions, op string, body map[string]any) int {
	var receipt *scriptReceipt
	if o.receipt != "" {
		var lock *os.File
		var err error
		receipt, lock, _, err = loadScriptIntent(c, &o, op, body)
		if err != nil {
			return scriptFail(o, "receipt", "not_sent", "inspect_receipt", err)
		}
		defer lock.Close()
		if receipt.Outcome == "confirmed" {
			return scriptOutput(o, receipt.Result, nil)
		}
		if receipt.Outcome == "refused" {
			return scriptFail(o, receipt.Failure.Code, "refused", "new_intent_after_review", errors.New(receipt.Failure.Message))
		}
		receipt.Outcome = "unknown"
		if err := saveScriptReceipt(o.receipt, receipt, true); err != nil {
			return scriptFail(o, "receipt_write", "not_sent", "repair_and_resume", err)
		}
	}
	if o.request == "" {
		o.request = core.ManagementID()
	}
	if o.errorFormat != "json" {
		fmt.Fprintln(os.Stderr, "Management request ID:", o.request)
	}
	var callBody any = body
	if receipt != nil {
		callBody = receipt.WireBody
	}
	r, err := scriptValidatedCall(c, op, callBody, o.request)
	if err != nil {
		if receipt != nil {
			failure := scriptError(err)
			receipt.Outcome, receipt.Failure = failure.Outcome, failure
			if saveErr := saveScriptReceipt(o.receipt, receipt, true); saveErr != nil {
				return scriptFail(o, "receipt_write", "unknown", "repair_and_resume", saveErr)
			}
		}
		return scriptManagementFailure(o, o.request, err)
	}
	if receipt != nil {
		receipt.Outcome, receipt.Result, receipt.Failure = "confirmed", r, nil
		if err := saveScriptReceipt(o.receipt, receipt, true); err != nil {
			return scriptFail(o, "receipt_write", "confirmed", "repair_and_resume", err)
		}
	}
	return scriptOutput(o, r, nil)
}

// CLI-only optional transport configuration; agent.json and services stay intact.
func scriptLoadConfig(path string) (core.Config, error) {
	c, err := core.LoadConfig(path)
	if err != nil {
		return c, err
	}
	cliPath := filepath.Join(filepath.Dir(path), "examctl.json")
	if _, err := os.Lstat(cliPath); errors.Is(err, os.ErrNotExist) {
		return c, nil
	} else if err != nil {
		return c, err
	}
	b, err := readScriptPrivate(cliPath, 16384)
	if err != nil {
		return c, err
	}
	var config struct {
		HTTPSProxy string `json:"https_proxy"`
		NoProxy    string `json:"no_proxy,omitempty"`
	}
	d := json.NewDecoder(bytes.NewReader(b))
	d.DisallowUnknownFields()
	if d.Decode(&config) != nil || d.Decode(new(any)) != io.EOF {
		return c, errors.New("invalid protected examctl.json transport configuration")
	}
	proxy, err := url.Parse(config.HTTPSProxy)
	if err != nil || (proxy.Scheme != "http" && proxy.Scheme != "https") || proxy.Host == "" || proxy.User != nil || proxy.RawQuery != "" || proxy.Fragment != "" || (proxy.Path != "" && proxy.Path != "/") {
		return c, errors.New("examctl.json requires HTTP(S) proxy origin without credentials or paths")
	}
	if os.Getenv("HTTPS_PROXY") == "" && os.Getenv("https_proxy") == "" {
		if err := os.Setenv("HTTPS_PROXY", config.HTTPSProxy); err != nil {
			return c, err
		}
	}
	if config.NoProxy != "" && os.Getenv("NO_PROXY") == "" && os.Getenv("no_proxy") == "" {
		if err := os.Setenv("NO_PROXY", config.NoProxy); err != nil {
			return c, err
		}
	}
	return c, nil
}
