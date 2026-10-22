package core

// Provisional metadata storage only. Nothing in this file reads/writes Engine
// state, grants, leases, deadlines, policies, submissions or signing credentials.
// A record is NOT execution permission, including after any process restart.

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"

	"golang.org/x/sys/unix"
)

const monitoringPublisherFlag = "--monitoring-publication-worker"
const monitoringPublishLimit = 8192

var errMonitoringPublishIO = errors.New("native monitoring publication unconfirmed; prior authority only; preserve coordination records and inspect publisher status")

type monitoringPublishRequest struct {
	Version     int                   `json:"version"`
	Purpose     string                `json:"purpose"`
	State       string                `json:"state"`
	Slot        int                   `json:"slot"`
	Publication monitoringPublication `json:"publication"`
}

type monitoringPublishReply struct {
	Version     int    `json:"version"`
	Purpose     string `json:"purpose"`
	Attempt     string `json:"attempt"`
	Incarnation string `json:"incarnation"`
	Nonce       string `json:"nonce"`
	Hash        string `json:"hash"`
	Durable     bool   `json:"durable"`
}

// Root binaries only, never setuid exam-login, a student socket or package init.
// No live caller launches this worker yet. The caller must supply inherited
// attempt/slot/publisher claims on fds3/4/5 inside a separately bounded scope.
func MonitoringPublisherMain(args []string) bool {
	if len(args) != 1 || args[0] != monitoringPublisherFlag {
		return false
	}
	if os.Getuid() != 0 || os.Geteuid() != 0 {
		fmt.Fprintln(os.Stderr, "monitoring publisher requires a protected real/effective root coordinator")
		os.Exit(1)
	}
	runtime.GOMAXPROCS(2)
	if err := runMonitoringPublisher(os.Stdin, os.Stdout, nil); err != nil {
		fmt.Fprintln(os.Stderr, "monitoring publication unconfirmed; no execution permission established")
		os.Exit(1)
	}
	return true
}

func validMonitoringPublication(p monitoringPublication) bool {
	return p.Version == 1 && monitoringDigest.MatchString(p.Incarnation) && validMonitoringOwner(p.Owner) && monitoringDigest.MatchString(p.Nonce) && p.Sequence > 0 && p.Sequence <= monitoringEvidenceMaxSequence && monitoringDigest.MatchString(p.CoverageEpoch) && p.PreparedRevision > 0 && p.PreparedRevision <= monitoringEvidenceMaxSequence && p.CandidateUntilMS > 0 && p.EffectiveUntilMS >= p.CandidateUntilMS && p.EffectiveUntilMS-p.CandidateUntilMS < monitoringEvidenceWindowMS
}

func decodeMonitoringPublishRequest(input []byte) (monitoringPublishRequest, error) {
	var r monitoringPublishRequest
	if len(input) > monitoringPublishLimit || !validReadOnlyJSON(input) {
		return r, errMonitoringPublishIO
	}
	fields, err := decodeMonitoringObject(input, &r, []string{"version", "purpose", "state", "slot", "publication"})
	if err != nil || r.Version != 1 || r.Purpose != "monitoring-provisional-publication-v1" || !filepath.IsAbs(r.State) || filepath.Clean(r.State) != r.State || r.State == "/" || r.Slot < 0 || r.Slot > 1 || !validMonitoringPublication(r.Publication) {
		return r, errMonitoringPublishIO
	}
	p, err := decodeMonitoringObject(fields["publication"], &r.Publication, []string{"version", "incarnation", "owner", "nonce", "sequence", "coverage_epoch", "candidate_until_ms", "effective_until_ms", "prepared_revision"})
	if err != nil {
		return r, errMonitoringPublishIO
	}
	if _, err = decodeMonitoringObject(p["owner"], &r.Publication.Owner, []string{"attempt", "exam", "username", "uid", "transport_hash", "boot", "page_epoch", "input_epoch", "generation", "clock_revision"}); err != nil {
		return r, errMonitoringPublishIO
	}
	return r, nil
}

func openMonitoringControl(state string) (*os.File, error) {
	root, err := readOnlyRoot(state)
	if err != nil {
		return nil, errMonitoringPublishIO
	}
	defer root.Close()
	dir, err := readOnlyOpenAt(root, "monitoring-control", true)
	if err != nil {
		return nil, errMonitoringPublishIO
	}
	return dir, nil
}

func monitoringFileStat(f *os.File, limit int64) (unix.Stat_t, bool) {
	var st unix.Stat_t
	raw, err := f.SyscallConn()
	if err != nil {
		return st, false
	}
	var inner error
	err = raw.Control(func(fd uintptr) { inner = unix.Fstat(int(fd), &st) })
	return st, err == nil && inner == nil && st.Mode&unix.S_IFMT == unix.S_IFREG && st.Mode&07777 == 0600 && st.Uid == uint32(os.Geteuid()) && st.Nlink == 1 && st.Size >= 0 && st.Size <= limit
}

func monitoringNamedStat(dir *os.File, name string) (unix.Stat_t, error) {
	var st unix.Stat_t
	raw, err := dir.SyscallConn()
	if err != nil {
		return st, errMonitoringPublishIO
	}
	var inner error
	err = raw.Control(func(fd uintptr) { inner = unix.Fstatat(int(fd), name, &st, unix.AT_SYMLINK_NOFOLLOW) })
	if err != nil {
		return st, errMonitoringPublishIO
	}
	return st, inner
}

func monitoringOpenAt(dir *os.File, name string, flags int) (*os.File, error) {
	if name == "" || name == "." || name == ".." || filepath.Base(name) != name {
		return nil, errMonitoringPublishIO
	}
	raw, err := dir.SyscallConn()
	if err != nil {
		return nil, errMonitoringPublishIO
	}
	fd := -1
	var inner error
	err = raw.Control(func(parent uintptr) {
		fd, inner = unix.Openat(int(parent), name, flags|unix.O_NOFOLLOW|unix.O_NONBLOCK|unix.O_CLOEXEC, 0600)
	})
	if err != nil || inner != nil {
		if fd >= 0 {
			unix.Close(fd)
		}
		if inner != nil {
			return nil, inner
		}
		return nil, errMonitoringPublishIO
	}
	return os.NewFile(uintptr(fd), name), nil
}

// Persistent empty metadata lock, never explicit LOCK_UN or inode replacement.
// Called only outside the authority mutex; LOCK_NB does not bound filesystem IO.
func monitoringPublishLock(dir *os.File, name string) (*os.File, error) {
	f, err := monitoringOpenAt(dir, name, unix.O_RDWR|unix.O_CREAT)
	if err != nil {
		return nil, errMonitoringPublishIO
	}
	st, good := monitoringFileStat(f, 0)
	if !good {
		f.Close()
		return nil, errMonitoringPublishIO
	}
	if err := unix.Flock(int(f.Fd()), unix.LOCK_EX|unix.LOCK_NB); err != nil {
		f.Close()
		if errors.Is(err, unix.EAGAIN) || errors.Is(err, unix.EWOULDBLOCK) {
			return nil, errMonitoringBusy
		}
		return nil, errMonitoringPublishIO
	}
	named, err := monitoringNamedStat(dir, name)
	if err != nil || named.Dev != st.Dev || named.Ino != st.Ino || named.Nlink != 1 {
		f.Close()
		return nil, errMonitoringPublishIO
	}
	return f, nil
}

func verifyMonitoringInheritedClaim(dir, file *os.File, name string) error {
	st, good := monitoringFileStat(file, 0)
	named, err := monitoringNamedStat(dir, name)
	if !good || err != nil || named.Dev != st.Dev || named.Ino != st.Ino || named.Nlink != 1 || named.Mode != st.Mode || named.Uid != st.Uid || named.Size != 0 || unix.Flock(int(file.Fd()), unix.LOCK_EX|unix.LOCK_NB) != nil {
		return errMonitoringPublishIO
	}
	return nil
}

func monitoringUnlinkAt(dir *os.File, name string) error {
	raw, err := dir.SyscallConn()
	if err != nil {
		return errMonitoringPublishIO
	}
	var inner error
	err = raw.Control(func(fd uintptr) { inner = unix.Unlinkat(int(fd), name, 0) })
	if err != nil || inner != nil {
		return errMonitoringPublishIO
	}
	return nil
}

func storeMonitoringPublication(dir *os.File, p monitoringPublication, checkpoint func(string) error) error {
	if !validMonitoringPublication(p) {
		return errMonitoringPublishIO
	}
	name, temporary := p.Owner.Attempt+".provisional.json", p.Owner.Attempt+".publication.tmp"
	// With the inherited per-attempt publisher lock, no earlier writer can still
	// be using this fixed staging name. Discard ONLY a bounded private regular
	// provisional staging file after crash; never follow links or touch history.
	if _, err := monitoringNamedStat(dir, temporary); err == nil {
		old, err := monitoringOpenAt(dir, temporary, unix.O_RDONLY)
		if err != nil {
			return errMonitoringPublishIO
		}
		_, good := monitoringFileStat(old, monitoringPublishLimit)
		old.Close()
		if !good || monitoringUnlinkAt(dir, temporary) != nil {
			return errMonitoringPublishIO
		}
	} else if !errors.Is(err, unix.ENOENT) {
		return errMonitoringPublishIO
	}
	if _, err := monitoringNamedStat(dir, name); err == nil {
		old, err := monitoringOpenAt(dir, name, unix.O_RDONLY)
		if err != nil {
			return errMonitoringPublishIO
		}
		_, good := monitoringFileStat(old, monitoringPublishLimit)
		old.Close()
		if !good {
			return errMonitoringPublishIO
		}
	} else if !errors.Is(err, unix.ENOENT) {
		return errMonitoringPublishIO
	}
	f, err := monitoringOpenAt(dir, temporary, unix.O_WRONLY|unix.O_CREAT|unix.O_EXCL)
	if err != nil {
		return errMonitoringPublishIO
	}
	defer f.Close()
	data, _ := json.Marshal(p)
	n, err := f.Write(data)
	if err != nil || n != len(data) {
		return errMonitoringPublishIO
	}
	if checkpoint != nil {
		if checkpoint("written") != nil {
			return errMonitoringPublishIO
		}
	}
	if f.Sync() != nil || f.Close() != nil {
		return errMonitoringPublishIO
	}
	raw, err := dir.SyscallConn()
	if err != nil {
		return errMonitoringPublishIO
	}
	var inner error
	err = raw.Control(func(fd uintptr) { inner = unix.Renameat(int(fd), temporary, int(fd), name) })
	if err != nil || inner != nil {
		return errMonitoringPublishIO
	}
	if checkpoint != nil {
		if checkpoint("renamed") != nil {
			return errMonitoringPublishIO
		}
	}
	if dir.Sync() != nil {
		return errMonitoringPublishIO
	}
	return nil
}

func runMonitoringPublisher(in io.Reader, out io.Writer, checkpoint func(string) error) error {
	input, err := io.ReadAll(io.LimitReader(in, monitoringPublishLimit+1))
	if err != nil {
		return errMonitoringPublishIO
	}
	r, err := decodeMonitoringPublishRequest(input)
	if err != nil {
		return err
	}
	dir, err := openMonitoringControl(r.State)
	if err != nil {
		return err
	}
	defer dir.Close()
	names := []string{r.Publication.Owner.Attempt + ".lock", fmt.Sprintf("publish-slot-%d.lock", r.Slot), r.Publication.Owner.Attempt + ".publisher.lock"}
	for i, name := range names {
		f := os.NewFile(uintptr(3+i), "inherited-private-monitoring-claim")
		if f == nil {
			return errMonitoringPublishIO
		}
		defer f.Close()
		if verifyMonitoringInheritedClaim(dir, f, name) != nil {
			return errMonitoringPublishIO
		}
		unix.CloseOnExec(3 + i)
	}
	if storeMonitoringPublication(dir, r.Publication, checkpoint) != nil {
		return errMonitoringPublishIO
	}
	data, _ := json.Marshal(r.Publication)
	reply := monitoringPublishReply{1, "monitoring-provisional-publication-v1", r.Publication.Owner.Attempt, r.Publication.Incarnation, r.Publication.Nonce, Hash(data), true}
	encoded, err := json.Marshal(reply)
	if err != nil || len(encoded) > monitoringPublishLimit {
		return errMonitoringPublishIO
	}
	_, err = io.Copy(out, bytes.NewReader(encoded))
	return err
}
