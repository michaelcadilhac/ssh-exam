package core

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"
)

const templateWorkerFlag = "--template-worker"
const templateReplyLimit = 128 * 1024

type templateWorkerRequest struct {
	Schema  int             `json:"schema"`
	Nonce   string          `json:"nonce"`
	ID      string          `json:"id"`
	State   string          `json:"state"`
	Command TemplateCommand `json:"command"`
}
type templateWorkerReply struct {
	Schema int             `json:"schema"`
	Nonce  string          `json:"nonce"`
	ID     string          `json:"id"`
	Action string          `json:"action"`
	Error  string          `json:"error,omitempty"`
	Result *TemplateResult `json:"result,omitempty"`
}

// False is meaningful (especially gateway_confirmed). A truncated worker reply
// must not silently turn omitted/null policy fields into reassuring false values.
func (r *TemplateResult) UnmarshalJSON(data []byte) error {
	type plain TemplateResult
	var p plain
	wire := struct {
		*plain
		Verified         *bool `json:"verified"`
		Installed        *bool `json:"installed"`
		GatewayConfirmed *bool `json:"gateway_confirmed"`
	}{plain: &p}
	if err := decodeWorkerFrame(bytes.NewReader(data), templateReplyLimit, &wire); err != nil {
		return err
	}
	if wire.Verified == nil || wire.Installed == nil || wire.GatewayConfirmed == nil {
		return errors.New("missing required template result policy fields")
	}
	p.Verified, p.Installed, p.GatewayConfirmed = *wire.Verified, *wire.Installed, *wire.GatewayConfirmed
	*r = TemplateResult(p)
	return nil
}

// Ordinary root examctl/exam-agent only; never package init, the student command socket or
// setuid exam-login. No request contains keys, credentials or complete Config.
func TemplateWorkerMain(args []string) bool {
	if len(args) != 1 || args[0] != templateWorkerFlag {
		return false
	}
	if os.Getuid() != 0 || os.Geteuid() != 0 {
		fmt.Fprintln(os.Stderr, "template worker requires a root coordinator")
		os.Exit(1)
	}
	runtime.GOMAXPROCS(2)
	if err := runTemplateWorker(os.Stdin, os.Stdout, nil); err != nil {
		fmt.Fprintln(os.Stderr, "template worker protocol failed")
		os.Exit(1)
	}
	return true
}
func runTemplateWorker(in io.Reader, out io.Writer, checkpoint func(string) error) error {
	var r templateWorkerRequest
	if err := decodeWorkerFrame(in, 16384, &r); err != nil {
		return err
	}
	if r.Schema != 1 || !templateDigest.MatchString(r.Nonce) || !attemptID.MatchString(r.ID) || !filepath.IsAbs(r.State) || filepath.Clean(r.State) != r.State || r.State == "/" {
		return errors.New("invalid private template worker scope")
	}
	if err := r.Command.validate(); err != nil {
		return err
	}
	// Metadata inventory must not wait on a bulk worker's flock. It is still a
	// separately bounded CLI worker, not agent/PTY work or a global state lock.
	exclusive := r.Command.Action != "list" && r.Command.Action != "show" && r.Command.Action != "jobs"
	c, err := openTemplateCatalog(r.State, exclusive)
	var result TemplateResult
	if err == nil {
		defer c.close()
		b := r.Command
		switch b.Action {
		case "list", "jobs":
			result, err = c.list(b)
		case "show", "verify":
			var v *TemplateVersion
			if b.Action == "verify" && checkpoint != nil {
				err = checkpoint("verify-started")
			}
			if err == nil {
				v, err = c.version(b.Name, b.Hash, b.Action == "verify")
			}
			result = TemplateResult{Action: b.Action, Info: v, Installed: err == nil, Verified: err == nil && b.Action == "verify", Observed: Millis(), Note: "Immutable local catalog only; NOT proof of gateway confirmation. This operation does not select/change any grant. show is metadata, verify streams actual installed bytes"}
		case "validate":
			var manifest *templateSourceManifest
			manifest, err = inspectTemplateSource(b.Source, collectionBounds{File: b.FileMiB * mib, Total: b.TotalMiB * mib}, checkpoint)
			if err == nil {
				v := templateSummary("", manifest)
				result = TemplateResult{Action: b.Action, Info: &v, Verified: true, Observed: Millis(), Note: "Quiescent source inspected locally; NOT installed or gateway-confirmed. Review this exact hash before templates install NAME SOURCE --expected HASH --reason TEXT"}
			}
		case "install":
			result, err = c.install(b, r.ID, checkpoint)
		case "clean":
			result, err = c.clean(b, r.ID)
		}
		if err == nil {
			err = c.audit(b.Action+"-result", r.ID, b)
		}
	}
	reply := templateWorkerReply{Schema: 1, Nonce: r.Nonce, ID: r.ID, Action: r.Command.Action}
	if err != nil {
		// Authored filenames may be hostile display text. No unbounded exception,
		// path dump, worker stdout/stderr or source contents enter durable receipts.
		message := err.Error()
		if len(message) > 1800 {
			message = message[:1800]
		}
		reply.Error = "Template operation refused: " + strconv.QuoteToASCII(message) + ". Preserve catalog/jobs; use examctl templates help for inspection/retry"
	} else {
		reply.Result = &result
	}
	encoded, err := json.Marshal(reply)
	if err != nil || len(encoded) > templateReplyLimit {
		return errors.New("template reply exceeds its bounded metadata budget; retry with a smaller --limit")
	}
	_, err = out.Write(encoded)
	return err
}

func templateServiceArgs(unit, executable string) []string {
	return []string{"/usr/bin/systemd-run", "--quiet", "--pipe", "--wait", "--collect", "--service-type=exec", "--unit=" + unit,
		"--property=Slice=exam-template.slice", "--property=MemoryMax=256M", "--property=MemorySwapMax=0", "--property=TasksMax=32",
		"--property=RuntimeMaxSec=120", "--property=TimeoutStopSec=5s", "--property=OOMPolicy=kill", "--property=KillMode=control-group",
		"--property=CPUQuota=100%", "--property=Nice=10", "--property=UMask=0077", "--", executable, templateWorkerFlag}
}
func validateTemplateSlice(out string) error {
	properties := map[string]string{}
	for _, line := range strings.Split(out, "\n") {
		if key, value, ok := strings.Cut(line, "="); ok {
			properties[key] = value
		}
	}
	memory, me := strconv.ParseUint(properties["MemoryMax"], 10, 64)
	tasks, te := strconv.ParseUint(properties["TasksMax"], 10, 64)
	if properties["LoadState"] != "loaded" || me != nil || memory < 1 || memory > uint64(256*mib) || te != nil || tasks < 2 || tasks > 32 || properties["MemorySwapMax"] != "0" {
		return errors.New("bounded template pool unavailable; install the supplied exam-template.slice and reload systemd in an authorized drained maintenance workflow, then retry. Do not use collection slots or raise limits; student exams are unchanged")
	}
	return nil
}

type templateOutput struct {
	bytes.Buffer
	overflow bool
}

func (b *templateOutput) Write(p []byte) (int, error) {
	n := len(p)
	left := templateReplyLimit - b.Len()
	if n > left {
		b.overflow = true
		p = p[:left]
	}
	_, _ = b.Buffer.Write(p)
	return n, nil
}

type templateProcessOptions struct {
	command func(string) []string // Test-only, never config/environment.
	timeout time.Duration
}

func TemplateCall(c Config, body TemplateCommand, id string) (TemplateResult, error) {
	if os.Getuid() != 0 || os.Geteuid() != 0 {
		return TemplateResult{}, errors.New("templates require real/effective root on the class server; help needs no privilege/configuration")
	}
	if body.Action == "install" {
		// Refuse known memory-backed durable output before starting an import.
		// Existing metadata remains inspectable; never move/delete data to repair
		// storage automatically. The worker's cgroup is not a live disk quota.
		f, err := templatePrivateDirectory(c.State)
		if err != nil {
			return TemplateResult{}, err
		}
		var fs syscall.Statfs_t
		err = syscall.Fstatfs(int(f.Fd()), &fs)
		f.Close()
		if err != nil {
			return TemplateResult{}, fmt.Errorf("inspect template catalog storage before importing: %w", err)
		}
		if memoryBackedFilesystem(fs.Type) {
			return TemplateResult{}, errors.New("template installation requires persistent disk-backed native state, not tmpfs/ramfs; preserve current jobs/versions and use a drained, separately authorized storage migration; metadata inspection remains available")
		}
	}
	return runTemplateProcess(templateWorkerRequest{Schema: 1, Nonce: Token(), ID: id, State: c.State, Command: body}, templateProcessOptions{})
}
func runTemplateProcess(r templateWorkerRequest, opts templateProcessOptions) (TemplateResult, error) {
	var result TemplateResult
	if err := r.Command.validate(); err != nil {
		return result, err
	}
	if !attemptID.MatchString(r.ID) || !templateDigest.MatchString(r.Nonce) {
		return result, errors.New("invalid template request identity")
	}
	input, err := json.Marshal(r)
	if err != nil || len(input) > 16384 {
		return result, errors.New("template request exceeds the private IPC bound")
	}
	unit := "exam-template-" + r.ID + "-" + r.Nonce[:12] + ".service"
	var command []string
	if opts.command != nil {
		command = opts.command(unit)
	} else {
		executable, err := os.Executable()
		if err != nil {
			return result, err
		}
		info, err := os.Stat(executable)
		if err != nil || os.Getuid() != 0 || os.Geteuid() != 0 || !info.Mode().IsRegular() || info.Sys().(*syscall.Stat_t).Uid != 0 || info.Mode().Perm()&0022 != 0 {
			return result, errors.New("template coordinator must be an ordinary protected root-owned executable run as real/effective root")
		}
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		bounds, err := exec.CommandContext(ctx, "/usr/bin/systemctl", "show", "exam-template.slice", "--property=LoadState", "--property=MemoryMax", "--property=MemorySwapMax", "--property=TasksMax").Output()
		cancel()
		if err != nil {
			return result, fmt.Errorf("inspect separate template pool before retrying: %w", err)
		}
		if err := validateTemplateSlice(string(bounds)); err != nil {
			return result, err
		}
		command = templateServiceArgs(unit, executable)
	}
	if len(command) == 0 {
		return result, errors.New("template worker unavailable")
	}
	timeout := 130 * time.Second
	if opts.timeout > 0 {
		timeout = opts.timeout
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, command[0], command[1:]...)
	cmd.Env = []string{"PATH=/usr/bin:/bin", "LANG=C.UTF-8", "GOMAXPROCS=2", "GOMEMLIMIT=192MiB"}
	cmd.Stdin = bytes.NewReader(input)
	var out templateOutput
	cmd.Stdout = &out
	cmd.Stderr = io.Discard
	cmd.WaitDelay = 5 * time.Second
	if err := cmd.Run(); err != nil {
		if opts.command == nil {
			stop, done := context.WithTimeout(context.Background(), 7*time.Second)
			_ = exec.CommandContext(stop, "/usr/bin/systemctl", "stop", unit).Run()
			done()
		}
		return result, fmt.Errorf("template worker exited or exceeded its resource/time bound (%v); no student interval changed. Inspect templates jobs and list, verify any published exact version, then retry the SAME install --request or explicitly clean its incomplete staging", err)
	}
	var reply templateWorkerReply
	if out.overflow || decodeWorkerFrame(bytes.NewReader(out.Bytes()), templateReplyLimit, &reply) != nil || reply.Schema != 1 || reply.Nonce != r.Nonce || reply.ID != r.ID || reply.Action != r.Command.Action || (reply.Error != "" && reply.Result != nil) || (reply.Error == "" && reply.Result == nil) {
		return result, errors.New("invalid/mismatched template worker reply; preserve jobs/catalog and inspect before retrying")
	}
	if reply.Error != "" {
		if !templateSafeMessage(reply.Error, 12000) {
			return result, errors.New("unsafe template worker error; preserve jobs/catalog and inspect before retrying")
		}
		return result, errors.New(reply.Error)
	}
	if err := validateTemplateResult(r.Command, *reply.Result, r.ID); err != nil {
		return result, err
	}
	return *reply.Result, nil
}
func templateSafeMessage(s string, bound int) bool {
	if len(s) == 0 || len(s) > bound {
		return false
	}
	for _, c := range []byte(s) {
		if c < 32 || c > 126 {
			return false
		}
	}
	return true
}
func validateTemplateResult(b TemplateCommand, result TemplateResult, id string) error {
	bad := errors.New("template result scope/bounds mismatch; no output published by coordinator; inspect catalog/jobs before retrying")
	if result.Action != b.Action || result.GatewayConfirmed || result.Observed <= 0 || !templateSafeMessage(result.Note, 2000) {
		return bad
	}
	if b.Action == "list" || b.Action == "jobs" {
		if result.Info != nil || result.Job != "" || result.Verified || result.Installed {
			return bad
		}
		last := b.After
		if b.Action == "list" {
			if len(result.Jobs) != 0 || len(result.Versions) > b.Limit {
				return bad
			}
			for _, v := range result.Versions {
				key := v.Name + "@" + v.Hash
				if !validTemplateVersion(v, v.Name, v.Hash) || key <= last || (b.Name != "" && b.Name != v.Name) {
					return bad
				}
				last = key
			}
			if result.Next != "" && (len(result.Versions) != b.Limit || result.Next != last) {
				return bad
			}
		} else {
			if len(result.Versions) != 0 || len(result.Jobs) > b.Limit {
				return bad
			}
			for _, j := range result.Jobs {
				unrecorded := j.Status == "unrecorded" && j.Name == "" && j.Hash == "" && j.Created == 0 && j.Updated == 0 && j.StagingCleaned == 0
				cleanedUnknown := j.Status == "unrecorded-cleaned" && j.Name == "" && j.Hash == "" && j.Created == 0 && j.Updated > 0 && j.StagingCleaned == j.Updated
				known := identifier.MatchString(j.Name) && templateDigest.MatchString(j.Hash) && j.Created > 0 && j.Updated >= j.Created && j.StagingCleaned >= 0 && (j.Status == "pending" || j.Status == "published" || j.Status == "cleaned")
				if !attemptID.MatchString(j.ID) || j.ID <= last || !(known || unrecorded || cleanedUnknown) {
					return bad
				}
				last = j.ID
			}
			if result.Next != "" && (len(result.Jobs) != b.Limit || result.Next != last) {
				return bad
			}
		}
		return nil
	}
	if len(result.Versions) != 0 || len(result.Jobs) != 0 || result.Next != "" {
		return bad
	}
	if b.Action == "clean" {
		if result.Job != b.Job || result.Info != nil || result.Installed || result.Verified {
			return bad
		}
		return nil
	}
	if result.Info == nil {
		return bad
	}
	v := *result.Info
	if b.Action == "validate" {
		copy := v
		copy.Name = "validated"
		if v.Name != "" || !validTemplateVersion(copy, "validated", v.Hash) || !result.Verified || result.Installed || result.Job != "" || v.MaxFileBytes > b.FileMiB*mib || v.Bytes > b.TotalMiB*mib {
			return bad
		}
		return nil
	}
	if !validTemplateVersion(v, b.Name, b.Hash) || !result.Installed || result.Verified != (b.Action != "show") {
		return bad
	}
	if b.Action == "install" {
		if result.Job != id || v.MaxFileBytes > b.FileMiB*mib || v.Bytes > b.TotalMiB*mib {
			return bad
		}
	} else if result.Job != "" {
		return bad
	}
	return nil
}
