package core

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
)

// Entire coordinator+worker run in this fresh mount/user namespace. Mounting
// over a worker's already-pinned directory would not test the intended IO fault.
func TestMonitoringPublisherNamespaceStorageChild(t *testing.T) {
	if len(os.Args) < 4 || os.Args[len(os.Args)-3] != "--publisher-storage-test" {
		return
	}
	mode, state := os.Args[len(os.Args)-2], os.Args[len(os.Args)-1]
	if mode != "disk-full" && mode != "read-only" {
		os.Exit(61)
	}
	if syscall.Mount("tmpfs", state, "tmpfs", 0, "size=64k,nr_inodes=256,mode=0700") != nil {
		os.Exit(62)
	}
	p := newMonitoringPublishFixture(t, state, "")
	protected := filepath.Join(state, "protected-synthetic-source")
	if os.WriteFile(protected, []byte("PRIVATE-PROTECTED-SOURCE"), 0600) != nil {
		os.Exit(63)
	}
	// Precreate the fixed metadata lock inodes before making storage readonly.
	dir, err := openMonitoringControl(state)
	if err != nil {
		os.Exit(64)
	}
	for _, name := range []string{"publish-slot-0.lock", "publish-slot-1.lock", p.f.context.Owner.Attempt + ".publisher.lock"} {
		f, err := monitoringPublishLock(dir, name)
		if err != nil {
			os.Exit(65)
		}
		f.Close()
	}
	dir.Close()
	if mode == "read-only" {
		// Existing writable claim descriptors make their mount RO remount
		// EBUSY. Use a fresh read-only bind VIEW of this disposable tmpfs;
		// inode identity/claims survive, but new metadata opens use that view.
		// Never close/replace the live claim merely to make the fixture pass.
		// https://man7.org/linux/man-pages/man2/mount.2.html
		view := filepath.Join(state, "readonly-view")
		if os.Mkdir(view, 0700) != nil || syscall.Mount(state, view, "", syscall.MS_BIND, "") != nil {
			os.Exit(72)
		}
		if err := syscall.Mount("", view, "", syscall.MS_REMOUNT|syscall.MS_BIND|syscall.MS_RDONLY|syscall.MS_NOSUID|syscall.MS_NODEV|syscall.MS_NOEXEC, ""); err != nil {
			fmt.Fprintln(os.Stderr, "synthetic readonly remount:", err)
			os.Exit(66)
		}
		state = view
	} else {
		fill, err := os.OpenFile(filepath.Join(state, "synthetic-fill"), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if err != nil {
			os.Exit(67)
		}
		for {
			_, err = fill.Write(make([]byte, 4096))
			if err != nil {
				break
			}
		}
		fill.Close()
		if !errors.Is(err, syscall.ENOSPC) {
			os.Exit(68)
		}
	}
	ticket := p.f.prepare(t, p.f.proof(t, 4, 0))
	_, err = publishMonitoringTicket(context.Background(), p.claim, state, ticket, monitoringPublishTestOptions("normal"))
	if err == nil {
		os.Exit(69)
	}
	v := p.f.a.check()
	if !v.ExecutionAuthorized || v.AuthorityUntilMS != 16000 || v.Sequence != 4 || len(v.Causes) != 0 || !v.PublicationFailureObserved {
		os.Exit(70)
	}
	data, err := os.ReadFile(protected)
	if err != nil || string(data) != "PRIVATE-PROTECTED-SOURCE" {
		os.Exit(71)
	}
	p.claim.close()
	fmt.Fprintln(os.Stdout, "synthetic storage fault preserved original authority and protected source")
	os.Exit(0)
}

func TestMonitoringPublisherActualDiskFullAndReadonlyNamespaceFaults(t *testing.T) {
	if os.Getenv("EXAM_COLLECTION_USERNS") != "1" {
		t.Skip("set EXAM_COLLECTION_USERNS=1 for real publisher ENOSPC/readonly in disposable namespaces")
	}
	for _, mode := range []string{"disk-full", "read-only"} {
		t.Run(mode, func(t *testing.T) {
			state := monitoringClaimState(t)
			ctx, cancel := context.WithTimeout(context.Background(), 6*time.Second)
			defer cancel()
			cmd := exec.CommandContext(ctx, "/usr/bin/unshare", "--user", "--map-root-user", "--mount", os.Args[0], "-test.run=^TestMonitoringPublisherNamespaceStorageChild$", "--", "--publisher-storage-test", mode, state)
			cmd.Env = append(os.Environ(), "GORACE=atexit_sleep_ms=0")
			output, err := cmd.CombinedOutput()
			if err != nil || !strings.Contains(string(output), "synthetic storage fault preserved") {
				t.Fatal("isolated actual storage failure qualification", mode, err, string(output))
			}
			entries, err := os.ReadDir(state)
			if err != nil || len(entries) != 0 {
				t.Fatal("child modified underlying host fixture", err)
			}
		})
	}
}
