package core

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"syscall"
	"time"
)

type Account struct {
	UID   int    `json:"uid"`
	GID   int    `json:"gid"`
	Shell string `json:"shell"`
	Home  string `json:"home"`
}
type Config struct {
	FunctionalHostAccess  bool               `json:"functional_host_access,omitempty"`
	FunctionalTestAccount string             `json:"functional_test_account,omitempty"`
	FunctionalTestUntil   int64              `json:"functional_test_until,omitempty"`
	ExamDirectory         string             `json:"exam_directory"`
	State                 string             `json:"state"`
	Work                  string             `json:"work"`
	Rootfs                string             `json:"rootfs"`
	Templates             string             `json:"templates"`
	Accounts              map[string]Account `json:"accounts"`
	Listen                string             `json:"listen"`
	Cert                  string             `json:"cert"`
	Key                   string             `json:"key"`
	CA                    string             `json:"ca"`
	ClientName            string             `json:"client_name"`
	Socket                string             `json:"socket"`
	GuardReport           string             `json:"guard_report"`
}
type Settings struct {
	Name      string `json:"name"`
	ID        string `json:"id"`
	Duration  int64  `json:"duration"`
	Webcam    bool   `json:"webcam"`
	Template  string `json:"template"`
	Terminals int    `json:"terminals"`
	Earliest  int64  `json:"earliest"`
	Latest    int64  `json:"latest"`
}
type Attempt struct {
	FunctionalTest   bool     `json:"functional_test,omitempty"`
	ID               string   `json:"id"`
	Exam             string   `json:"exam"`
	Username         string   `json:"username"`
	UID              int      `json:"uid"`
	Settings         Settings `json:"settings"`
	State            string   `json:"state"`
	Start            int64    `json:"start"`
	Deadline         int64    `json:"deadline"`
	Ended            int64    `json:"ended"`
	CompletedAt      int64    `json:"completed_at"`
	CollectedAt      int64    `json:"collected_at"`
	SecuredAt        int64    `json:"secured_at"`
	Lease            int64    `json:"lease"`
	WorkPath         string   `json:"work_path"`
	Transport        string   `json:"transport"`
	ResumeTransport  string   `json:"resume_transport,omitempty"`
	Generation       int      `json:"generation"`
	Authorization    int64    `json:"authorization"`
	Reason           string   `json:"reason"`
	Checksum         string   `json:"checksum"`
	Units            []string `json:"units"`
	Errors           []string `json:"errors"`
	Boot             string   `json:"boot"`
	UptimeDeadline   float64  `json:"uptime_deadline"`
	Protected        bool     `json:"protected"`
	AccessState      string   `json:"access_state"`
	AccessHeldAt     int64    `json:"access_held_at"`
	AccessReleasedAt int64    `json:"access_released_at"`
	AccessOverride   string   `json:"access_override,omitempty"`
	AccessError      string   `json:"access_error,omitempty"`
}
type Capability struct {
	Username  string `json:"username"`
	ID        string `json:"id"`
	Pane      string `json:"pane"`
	Purpose   string `json:"purpose"`
	Transport string `json:"transport"`
	Expires   int64  `json:"expires"`
}
type State struct {
	Attempts      map[string]*Attempt   `json:"attempts"`
	Caps          map[string]Capability `json:"capabilities"`
	Registrations map[string]string     `json:"registrations"`
}
type Engine struct {
	Config    Config
	mu        sync.Mutex
	state     State
	quiesce   func(*Attempt) error
	terminate func(*Attempt) error
	cutoff    func(*Attempt) error
}

var identifier = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`)
var attemptID = regexp.MustCompile(`^[a-f0-9-]{36}$`)

func Millis() int64        { return time.Now().UnixMilli() }
func Hash(b []byte) string { d := sha256.Sum256(b); return hex.EncodeToString(d[:]) }
func Token() string {
	b := make([]byte, 32)
	if _, e := rand.Read(b); e != nil {
		panic(e)
	}
	return hex.EncodeToString(b)
}
func LoadConfig(p string) (Config, error) {
	var c Config
	b, e := os.ReadFile(p)
	if e != nil {
		return c, e
	}
	e = json.Unmarshal(b, &c)
	if e != nil {
		return c, e
	}
	if len(c.Accounts) == 0 || !filepath.IsAbs(c.State) || !filepath.IsAbs(c.Work) || !filepath.IsAbs(c.Rootfs) {
		return c, errors.New("absolute paths and locally approved accounts required")
	}
	if c.FunctionalTestAccount != "" {
		if len(c.Accounts) != 1 || c.FunctionalTestUntil <= 0 {
			return c, errors.New("functional test requires one explicit account and expiration")
		}
		if _, ok := c.Accounts[c.FunctionalTestAccount]; !ok {
			return c, errors.New("functional test account not approved")
		}
	}
	if c.FunctionalHostAccess && c.FunctionalTestAccount == "" {
		return c, errors.New("host access requires the explicit single-account functional test")
	}
	if c.ExamDirectory != "" {
		p := c.ExamDirectory
		if !filepath.IsAbs(p) || filepath.Clean(p) != p || p == "/" {
			return c, errors.New("exam_directory must be a clean absolute directory")
		}
		for _, reserved := range []string{"/proc", "/dev", "/sys", "/tmp", "/home", "/etc", "/usr", "/bin", "/sbin", "/lib", "/lib64"} {
			if p == reserved || strings.HasPrefix(p, reserved+"/") {
				return c, errors.New("exam_directory overlaps a reserved sandbox path")
			}
		}
	}
	seenUIDs := map[int]bool{}
	for n, a := range c.Accounts {
		if seenUIDs[a.UID] {
			return c, errors.New("duplicate approved UID; isolation must be per account")
		}
		seenUIDs[a.UID] = true
		if !identifier.MatchString(n) || a.UID < 1000 || a.GID < 1000 || !filepath.IsAbs(a.Home) || !(a.Shell == "/bin/bash" || a.Shell == "/bin/zsh" || a.Shell == "/bin/sh") {
			return c, fmt.Errorf("unsupported account %s", n)
		}
	}
	return c, nil
}
func (e *Engine) directory() string {
	if e.Config.ExamDirectory == "" {
		return "/work"
	}
	return e.Config.ExamDirectory
}
func New(c Config) (*Engine, error) {
	if e := os.MkdirAll(c.State, 0700); e != nil {
		return nil, e
	}
	if err := os.Chmod(c.State, 0700); err != nil {
		return nil, err
	}
	e := &Engine{Config: c}
	e.quiesce = e.quiesceWriters
	e.terminate = e.terminateWriters
	e.cutoff = func(a *Attempt) error { return e.freeze(a, true) }
	return e, nil
}
func (e *Engine) WithState(fn func() error) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	lock, err := os.OpenFile(filepath.Join(e.Config.State, "lock"), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return err
	}
	defer lock.Close()
	if err = syscall.Flock(int(lock.Fd()), syscall.LOCK_EX); err != nil {
		return err
	}
	defer syscall.Flock(int(lock.Fd()), syscall.LOCK_UN)
	e.state = State{map[string]*Attempt{}, map[string]Capability{}, map[string]string{}}
	b, err := os.ReadFile(filepath.Join(e.Config.State, "state.json"))
	if err == nil {
		if err = json.Unmarshal(b, &e.state); err != nil {
			return err
		}
	} else if !os.IsNotExist(err) {
		return err
	} else if _, markerErr := os.Stat(filepath.Join(e.Config.State, "initialized")); !os.IsNotExist(markerErr) {
		return errors.New("administrator state missing; account access denied pending recovery")
	}
	if e.state.Attempts == nil || e.state.Caps == nil || e.state.Registrations == nil {
		return errors.New("invalid administrator state; access denied")
	}
	// Upgrade old records conservatively. Completion never implies access release.
	for _, a := range e.state.Attempts {
		if a.AccessState == "" && a.Start > 0 {
			a.AccessState = "HELD"
			a.AccessHeldAt = a.Start
		}
		e.reconcileAccess(a)
	}
	err = fn()
	if saveErr := e.save(); err == nil {
		err = saveErr
	}
	return err
}
func (e *Engine) save() error {
	marker, err := os.OpenFile(filepath.Join(e.Config.State, "initialized"), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err == nil {
		_, err = marker.WriteString("Do not remove state: original access intervals survive restarts.\n")
		if err == nil {
			err = marker.Sync()
		}
		marker.Close()
		if err != nil {
			return err
		}
	} else if !os.IsExist(err) {
		return err
	}
	b, err := json.MarshalIndent(e.state, "", "  ")
	if err != nil {
		return err
	}
	p := filepath.Join(e.Config.State, "state.json")
	f, err := os.OpenFile(p+".tmp", os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	if _, err = f.Write(b); err != nil {
		f.Close()
		return err
	}
	err = f.Sync()
	f.Close()
	if err != nil {
		return err
	}
	if err = os.Rename(p+".tmp", p); err != nil {
		return err
	}
	d, err := os.Open(e.Config.State)
	if err == nil {
		err = d.Sync()
		d.Close()
	}
	return err
}
func (e *Engine) Audit(action, id string) {
	f, err := os.OpenFile(filepath.Join(e.Config.State, "audit.ndjson"), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0600)
	if err == nil {
		defer f.Close()
		b, _ := json.Marshal(map[string]any{"at": Millis(), "action": action, "attempt": id})
		f.Write(append(b, '\n'))
		f.Sync()
	}
}
func (e *Engine) Find(id string) (*Attempt, error) {
	a := e.state.Attempts[id]
	if a == nil {
		return nil, errors.New("unknown attempt")
	}
	return a, nil
}
func (e *Engine) Busy(uid int) *Attempt {
	for _, a := range e.state.Attempts {
		if a.UID == uid && accessHeld(a) {
			return a
		}
	}
	return nil
}
