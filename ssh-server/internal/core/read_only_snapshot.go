package core

// Explicit offline observation only. Never instantiate Engine, take/create its
// locks, reconcile, apply a journal, create/chmod state or invoke any subprocess.

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"sort"
	"syscall"

	"golang.org/x/sys/unix"
)

const readOnlyStateMaxBytes = 64 * 1024 * 1024
const readOnlyLeaseMaxBytes = 65536

var errReadOnlySnapshot = errors.New("native snapshot unavailable or unsafe; preserve existing state, verify the configured private directory and use examctl help info; do not initialize/reconcile merely to inspect it")

type ReadOnlyQuery struct {
	ID, Exam, After string
	Active          bool
	Limit           int
}

func (q ReadOnlyQuery) Validate() error {
	if (q.ID != "" && (!monitoringUUID.MatchString(q.ID) || q.Exam != "" || q.Active || q.After != "")) || (q.Exam != "" && !identifier.MatchString(q.Exam)) || (q.After != "" && !monitoringUUID.MatchString(q.After)) || q.Limit < 1 || q.Limit > 200 {
		return errors.New("invalid read-only selection; choose info ATTEMPT or list --exam EXAM [--active] [--limit 1..200] [--after ATTEMPT]; see examctl help info")
	}
	return nil
}

type ReadOnlyLeaseObservation struct {
	Status                    string `json:"status"`
	ObservedAt                int64  `json:"observed_at"`
	RecordedUntil             int64  `json:"recorded_until,omitempty"`
	RecordedGeneration        int    `json:"recorded_generation"`
	MatchesRecordedOwner      bool   `json:"matches_recorded_owner"`
	MatchesRecordedAccount    bool   `json:"matches_recorded_account"`
	MatchesRecordedTransport  bool   `json:"matches_recorded_transport"`
	MatchesRecordedGeneration bool   `json:"matches_recorded_generation"`
	MatchesRecordedBoot       bool   `json:"matches_recorded_boot"`
	MatchesCurrentBoot        bool   `json:"matches_current_boot"`
	UnexpiredAtRead           bool   `json:"unexpired_at_read"`
	WithinLeaseWindowAtRead   bool   `json:"within_lease_window_at_read"`
}

type ReadOnlyAttemptObservation struct {
	PreparationPending          bool                     `json:"preparation_pending"`
	ID                          string                   `json:"id"`
	Exam                        string                   `json:"exam"`
	Username                    string                   `json:"username"`
	UID                         int                      `json:"uid"`
	State                       string                   `json:"state"`
	Generation                  int                      `json:"generation"`
	ClockRevision               int                      `json:"clock_revision"`
	Start                       int64                    `json:"start"`
	Deadline                    int64                    `json:"deadline"`
	OriginalDeadline            int64                    `json:"original_deadline"`
	Ended                       int64                    `json:"ended"`
	RecordedLease               int64                    `json:"recorded_lease"`
	RecordedProtected           bool                     `json:"recorded_protected"`
	AccessState                 string                   `json:"access_state"`
	PolicyState                 string                   `json:"policy_state"`
	AccessError                 string                   `json:"access_error"`
	PolicyError                 string                   `json:"policy_error"`
	Errors                      []string                 `json:"errors"`
	Reason                      string                   `json:"reason"`
	RecordedUnitCount           int                      `json:"recorded_unit_count"`
	RegisteredTransportRecorded bool                     `json:"registered_transport_recorded"`
	Lease                       ReadOnlyLeaseObservation `json:"lease"`
}

type ReadOnlySnapshot struct {
	Version             int                          `json:"version"`
	ReadOnly            bool                         `json:"read_only"`
	Complete            bool                         `json:"complete"`
	ObservedAt          int64                        `json:"observed_at"`
	StateSHA256         string                       `json:"state_sha256"`
	CurrentBootObserved bool                         `json:"current_boot_observed"`
	Attempts            []ReadOnlyAttemptObservation `json:"attempts"`
	Next                string                       `json:"next,omitempty"`
	Note                string                       `json:"note"`
}

// Pin the private directory without repairing permissions or following its final
// symlink. Child names are single components opened with native openat/NOFOLLOW;
// no path walking, magic-link resolution or directory initialization is needed.
func readOnlyRoot(path string) (*os.File, error) {
	if !filepath.IsAbs(path) || filepath.Clean(path) != path || path == "/" {
		return nil, errReadOnlySnapshot
	}
	dir, err := os.OpenFile(path, os.O_RDONLY|syscall.O_DIRECTORY|syscall.O_NOFOLLOW|syscall.O_NONBLOCK|syscall.O_NOATIME, 0)
	if err != nil {
		return nil, errReadOnlySnapshot
	}
	if err := readOnlyPrivateDir(dir); err != nil {
		dir.Close()
		return nil, err
	}
	return dir, nil
}

func readOnlyPrivateDir(dir *os.File) error {
	info, err := dir.Stat()
	if err != nil || !info.IsDir() || info.Mode().Perm() != 0700 || info.Sys().(*syscall.Stat_t).Uid != uint32(os.Geteuid()) {
		return errReadOnlySnapshot
	}
	return nil
}

func readOnlyOpenAt(root *os.File, name string, directory bool) (*os.File, error) {
	if name == "" || name == "." || name == ".." || filepath.Base(name) != name {
		return nil, errReadOnlySnapshot
	}
	raw, err := root.SyscallConn()
	if err != nil {
		return nil, errReadOnlySnapshot
	}
	fd := -1
	var inner error
	flags := unix.O_RDONLY | unix.O_NOFOLLOW | unix.O_NONBLOCK | unix.O_NOATIME | unix.O_CLOEXEC
	if directory {
		flags |= unix.O_DIRECTORY
	}
	err = raw.Control(func(parent uintptr) { fd, inner = unix.Openat(int(parent), name, flags, 0) })
	if err != nil || inner != nil {
		if fd >= 0 {
			unix.Close(fd)
		}
		if inner != nil {
			return nil, inner
		}
		return nil, errReadOnlySnapshot
	}
	f := os.NewFile(uintptr(fd), name)
	if directory {
		if err := readOnlyPrivateDir(f); err != nil {
			f.Close()
			return nil, err
		}
	}
	return f, nil
}

func readOnlyFile(root *os.File, name string, limit int64) ([]byte, error) {
	f, err := readOnlyOpenAt(root, name, false)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	before, err := f.Stat()
	if err != nil || !before.Mode().IsRegular() || before.Mode().Perm() != 0600 || before.Sys().(*syscall.Stat_t).Uid != uint32(os.Geteuid()) || before.Size() > limit {
		return nil, errReadOnlySnapshot
	}
	b, err := io.ReadAll(io.LimitReader(f, limit+1))
	if err != nil || int64(len(b)) > limit {
		return nil, errReadOnlySnapshot
	}
	after, err := f.Stat()
	if err != nil || before.Size() != after.Size() || !before.ModTime().Equal(after.ModTime()) || before.Sys().(*syscall.Stat_t).Ctim != after.Sys().(*syscall.Stat_t).Ctim {
		return nil, errReadOnlySnapshot
	}
	return b, nil
}

// Reject duplicate keys/oversized nesting before decoding. Errors never include
// private JSON bytes or decoder field values. Unknown future fields are ignored
// by the typed observation, never printed as generic JSON.
func validReadOnlyJSON(b []byte) bool {
	d := json.NewDecoder(bytes.NewReader(b))
	d.UseNumber()
	var value func(int) bool
	value = func(depth int) bool {
		if depth > 64 {
			return false
		}
		t, err := d.Token()
		if err != nil {
			return false
		}
		delim, ok := t.(json.Delim)
		if !ok {
			return true
		}
		switch delim {
		case '{':
			seen := map[string]bool{}
			for d.More() {
				k, err := d.Token()
				if err != nil {
					return false
				}
				key, ok := k.(string)
				if !ok || seen[key] {
					return false
				}
				seen[key] = true
				if !value(depth + 1) {
					return false
				}
			}
			end, err := d.Token()
			return err == nil && end == json.Delim('}')
		case '[':
			for d.More() {
				if !value(depth + 1) {
					return false
				}
			}
			end, err := d.Token()
			return err == nil && end == json.Delim(']')
		default:
			return false
		}
	}
	if !value(0) {
		return false
	}
	_, err := d.Token()
	return err == io.EOF
}

// Config resolution does not load/validate keys or create an Engine. It remains
// usable when key/agent initialization failed; --state DIR bypasses config.
func ReadOnlyConfiguredState(config string) (string, error) {
	f, err := os.OpenFile(config, os.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_NONBLOCK|syscall.O_NOATIME, 0)
	if err != nil {
		return "", errReadOnlySnapshot
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Sys().(*syscall.Stat_t).Uid != uint32(os.Geteuid()) || info.Mode().Perm()&0022 != 0 || info.Size() > 65536 {
		return "", errReadOnlySnapshot
	}
	b, err := io.ReadAll(io.LimitReader(f, 65537))
	if err != nil || len(b) > 65536 || !validReadOnlyJSON(b) {
		return "", errReadOnlySnapshot
	}
	var c struct {
		State string `json:"state"`
	}
	if json.Unmarshal(b, &c) != nil || !filepath.IsAbs(c.State) || filepath.Clean(c.State) != c.State || c.State == "/" {
		return "", errReadOnlySnapshot
	}
	return c.State, nil
}

func decodeReadOnlyLease(b []byte, id string) (executionLease, bool) {
	var lease executionLease
	if !validReadOnlyJSON(b) {
		return lease, false
	}
	var fields map[string]json.RawMessage
	if json.Unmarshal(b, &fields) != nil {
		return lease, false
	}
	for _, key := range []string{"id", "username", "transport", "boot", "generation", "until", "nonces"} {
		v, ok := fields[key]
		if !ok || bytes.Equal(bytes.TrimSpace(v), []byte("null")) {
			return lease, false
		}
	}
	if json.Unmarshal(b, &lease) != nil || lease.ID != id || !identifier.MatchString(lease.Username) || lease.Transport == "" || len(lease.Transport) > 512 || lease.Boot == "" || len(lease.Boot) > 64 || lease.Generation < 0 || lease.Until < 0 || lease.Nonces == nil {
		return executionLease{}, false
	}
	return lease, true
}

func readOnlyStateFile(root *os.File) (State, []byte, error) {
	var state State
	b, err := readOnlyFile(root, "state.json", readOnlyStateMaxBytes)
	if err != nil || !validReadOnlyJSON(b) || json.Unmarshal(b, &state) != nil || state.Attempts == nil || state.Caps == nil || state.Registrations == nil {
		return state, nil, errReadOnlySnapshot
	}
	return state, b, nil
}

func ObserveNativeReadOnly(stateDir string, q ReadOnlyQuery) (ReadOnlySnapshot, error) {
	var result ReadOnlySnapshot
	if err := q.Validate(); err != nil {
		return result, err
	}
	root, err := readOnlyRoot(stateDir)
	if err != nil {
		return result, err
	}
	defer root.Close()
	state, b, err := readOnlyStateFile(root)
	if err != nil {
		return result, err
	}
	ids := []string{}
	for id, a := range state.Attempts {
		if a == nil || !monitoringUUID.MatchString(id) || a.ID != id || !identifier.MatchString(a.Exam) || !identifier.MatchString(a.Username) || a.UID < 1000 {
			return result, errReadOnlySnapshot
		}
		if q.ID != "" && id != q.ID || q.Exam != "" && a.Exam != q.Exam || q.Active && (a.Start == 0 || a.State == "COMPLETED" || a.State == "CANCELLED_BEFORE_START") || id <= q.After {
			continue
		}
		ids = append(ids, id)
	}
	if q.ID != "" && len(ids) == 0 {
		return result, errors.New("attempt not present in captured native state; use examctl list --read-only --state DIR --json and preserve records; see examctl help info")
	}
	sort.Strings(ids)
	result = ReadOnlySnapshot{Version: 1, ReadOnly: true, Complete: true, ObservedAt: Millis(), StateSHA256: Hash(b), Attempts: []ReadOnlyAttemptObservation{}, Note: "Captured native metadata only; no reconciliation, permission repair, key loading, audit write, network or subprocess. State and lease journals are independent observations, not one atomic view. Recorded state/protection, registration and unexpired timestamps are NOT proof of live SSH, current monitoring, verified freeze, archive integrity or permission to work. No record is changed and no work is resumed."}
	if len(ids) > q.Limit {
		result.Next = ids[q.Limit-1]
		ids = ids[:q.Limit]
	}
	currentBoot := boot()
	result.CurrentBootObserved = currentBoot != ""
	if !result.CurrentBootObserved {
		result.Complete = false
	}
	leasesRoot, leasesErr := readOnlyOpenAt(root, "leases", true)
	if leasesRoot != nil {
		defer leasesRoot.Close()
	}
	for _, id := range ids {
		a := state.Attempts[id]
		v := ReadOnlyAttemptObservation{ID: a.ID, Exam: a.Exam, Username: a.Username, UID: a.UID, State: a.State, Generation: a.Generation, ClockRevision: a.ClockRevision, Start: a.Start, Deadline: a.Deadline, OriginalDeadline: a.OriginalDeadline, Ended: a.Ended, RecordedLease: a.Lease, RecordedProtected: a.Protected, AccessState: a.AccessState, PolicyState: a.PolicyState, Reason: a.Reason, RecordedUnitCount: len(a.Units), RegisteredTransportRecorded: a.Transport != "" && state.Registrations[a.Transport] == a.Username}
		v.PreparationPending = a.PreparationPending
		v.AccessError, v.PolicyError = a.AccessError, a.PolicyError
		v.Errors = append([]string(nil), a.Errors...)
		v.Lease = ReadOnlyLeaseObservation{Status: "absent", ObservedAt: Millis()}
		// Both the directory and leaf are pinned/no-follow. A missing lease is
		// ordinary; an inaccessible/unsafe directory is not evidence of absence.
		var leaseBytes []byte
		leaseErr := leasesErr
		if leasesRoot != nil {
			leaseBytes, leaseErr = readOnlyFile(leasesRoot, id+".json", readOnlyLeaseMaxBytes)
		}
		if leaseErr != nil && !errors.Is(leaseErr, os.ErrNotExist) {
			v.Lease.Status = "unavailable"
			result.Complete = false
		} else if leaseErr == nil {
			lease, valid := decodeReadOnlyLease(leaseBytes, id)
			if !valid {
				v.Lease.Status = "invalid"
				result.Complete = false
			} else {
				v.Lease.Status = "observed"
				v.Lease.RecordedUntil = lease.Until
				v.Lease.RecordedGeneration = lease.Generation
				v.Lease.MatchesRecordedAccount = lease.Username == a.Username
				v.Lease.MatchesRecordedTransport = lease.Transport == a.Transport && a.Transport != ""
				v.Lease.MatchesRecordedGeneration = lease.Generation == a.Generation
				v.Lease.MatchesRecordedOwner = lease.Username == a.Username && lease.Transport == a.Transport && a.Transport != "" && lease.Generation == a.Generation
				v.Lease.MatchesRecordedBoot = lease.Boot == a.Boot && a.Boot != ""
				v.Lease.MatchesCurrentBoot = currentBoot != "" && lease.Boot == currentBoot
				v.Lease.UnexpiredAtRead = lease.Until > v.Lease.ObservedAt
				v.Lease.WithinLeaseWindowAtRead = v.Lease.UnexpiredAtRead && lease.Until-v.Lease.ObservedAt <= 15000
			}
		}
		result.Attempts = append(result.Attempts, v)
	}
	return result, nil
}
