package core

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"

	"golang.org/x/sys/unix"
)

func TestWorkspaceMountTopologyDecodesRootsAndNeverEquatesCoverWithPermission(t *testing.T) {
	table := "1 0 8:1 / / rw future:tag - ext4 /dev/root rw\n2 1 8:1 /real\\040base /store rw - ext4 /dev/root rw\n3 1 8:1 /real\\040base/a/work /alias rw - ext4 /dev/root rw\n4 1 8:1 /real\\040base/a/work/sub /nested rw - ext4 /dev/root rw\n5 1 8:2 /real\\040base/a/work /other-device rw - ext4 /dev/other rw\n6 1 8:1 /real\\040base/a/work-other /prefix-not-child rw - ext4 /dev/root rw\n"
	rows, err := parseWorkspaceMountTopology(strings.NewReader(table))
	if err != nil || len(rows) != 6 {
		t.Fatal(rows, err)
	}
	anchor, err := workspaceMountAnchorFor("/store/a/work", 2, unix.Mkdev(8, 1), rows)
	if err != nil || anchor.filesystemPath != "/real base/a/work" {
		t.Fatal(anchor, err)
	}
	relationships, err := workspaceMountRelationships(anchor, rows)
	if err != nil {
		t.Fatal(err)
	}
	got := map[uint64]string{}
	for _, item := range relationships {
		got[item.mount.id] = item.relation
	}
	if len(got) != 4 || got[1] != "covering-ancestor" || got[2] != "covering-ancestor" || got[3] != "exact-source" || got[4] != "source-descendant" {
		t.Fatal("filesystem relationships wrong", got)
	}
	for encoded, want := range map[string]string{`/a\040b`: "/a b", `/a\011b`: "/a\tb", `/a\012b`: "/a\nb", `/a\134b`: "/a\\b", "/a\rb": "/a\rb", "/a\u2003b": "/a\u2003b"} {
		actual, err := workspaceMountPath(encoded)
		if err != nil || actual != want {
			t.Fatal("path bytes not preserved", encoded, actual, err)
		}
	}
	weird := "/literal\rUnicode\u2003space"
	parsed, err := parseWorkspaceMountTopology(strings.NewReader("9 1 8:1 " + weird + " " + weird + " rw - ext4 /dev/root rw\n"))
	if err != nil || len(parsed) != 1 || parsed[0].root != weird || parsed[0].point != weird {
		t.Fatal("whitespace inside path was treated as a field separator", err)
	}
	// Missing parent rows can reflect a chroot-limited view, not malformed data
	// and certainly not a complete namespace proof.
	if _, err := parseWorkspaceMountTopology(strings.NewReader("8 999 8:1 /source / rw - ext4 /dev/root rw\n")); err != nil {
		t.Fatal(err)
	}
	if _, err := workspaceMountRelationships(workspaceMountAnchor{}, rows); err == nil {
		t.Fatal("empty anchor looked like a valid empty observation")
	}
	for _, item := range []struct {
		path       string
		id, device uint64
	}{{"/store-other/a", 2, unix.Mkdev(8, 1)}, {"/store/a", 99, unix.Mkdev(8, 1)}, {"/store/a", 2, unix.Mkdev(8, 2)}, {"/", 1, unix.Mkdev(8, 1)}, {"/store/a/../b", 2, unix.Mkdev(8, 1)}} {
		if _, err := workspaceMountAnchorFor(item.path, item.id, item.device, rows); err == nil {
			t.Fatal("invalid/mismatched anchor accepted", item)
		}
	}
}

func TestWorkspaceMountTopologyRefusesTruncationMalformedAndOversizeWithoutPrivateErrors(t *testing.T) {
	good := "1 0 8:1 / / rw - ext4 /dev/root rw\n"
	for _, input := range []string{"", strings.TrimSuffix(good, "\n"), good + strings.TrimSuffix(good, "\n"), good + good, "PRIVATE-TOPOLOGY-CONTENT\n", "+1 0 8:1 / / rw - ext4 /dev/root rw\n", "1 0 4294967296:1 / / rw - ext4 /dev/root rw\n", "1 0 8:1 /../source / rw - ext4 /dev/root rw\n", `1 0 8:1 /a\000b / rw - ext4 /dev/root rw` + "\n", `1 0 8:1 /a\999b / rw - ext4 /dev/root rw` + "\n", `1 0 8:1 /a\12 / rw - ext4 /dev/root rw` + "\n", `1 0 8:1 /a\040(deleted) / rw - ext4 /dev/root rw` + "\n", good + "\n", strings.Repeat("x", workspaceMountTableMax+1)} {
		if _, err := parseWorkspaceMountTopology(strings.NewReader(input)); err == nil || strings.Contains(err.Error(), "PRIVATE-TOPOLOGY-CONTENT") {
			t.Fatal("malformed/truncated/private input not safely refused", len(input), err)
		}
	}
	if _, err := parseWorkspaceMountTopology(io.MultiReader(strings.NewReader(good), strings.NewReader("1 0 8:1 / / rw - ext4 /dev/root "+strings.Repeat("x", workspaceMountLineMax)+"\n"))); err == nil {
		t.Fatal("oversized line accepted")
	}
	var table strings.Builder
	for at := 1; at <= workspaceMountCountMax+1; at++ {
		fmt.Fprintf(&table, "%d 0 8:1 / / rw - ext4 /dev/root rw\n", at)
	}
	if _, err := parseWorkspaceMountTopology(strings.NewReader(table.String())); err == nil {
		t.Fatal("unbounded row inventory accepted")
	}
}

func TestWorkspaceMountTopologyChild(t *testing.T) {
	if os.Getenv("EXAM_WORKSPACE_MOUNT_CHILD") != "1" {
		return
	}
	if os.Getuid() != 0 || os.Geteuid() != 0 {
		t.Fatal("private mapped root required")
	}
	at := -1
	for i, arg := range os.Args {
		if arg == "--" {
			at = i
			break
		}
	}
	if at < 0 || len(os.Args) != at+7 {
		t.Fatal("private namespace fixture arguments required")
	}
	source, alias, parentUser, parentMount, mode, anchorRaw := os.Args[at+1], os.Args[at+2], os.Args[at+3], os.Args[at+4], os.Args[at+5], os.Args[at+6]
	mapping, err := os.ReadFile("/proc/self/uid_map")
	fields := strings.Fields(string(mapping))
	if err != nil || len(fields) != 3 || fields[0] != "0" || fields[2] != "1" {
		t.Fatal("refuse outside mapped test user namespace")
	}
	for ns, parent := range map[string]string{"user": parentUser, "mnt": parentMount} {
		info, err := os.Stat("/proc/self/ns/" + ns)
		if err != nil || strconv.FormatUint(info.Sys().(*syscall.Stat_t).Ino, 10) == parent {
			t.Fatal("refuse parent namespace")
		}
	}
	if !filepath.IsAbs(source) || !filepath.IsAbs(alias) || source == "/" || alias == "/" {
		t.Fatal("unsafe private fixture paths")
	}
	if err := syscall.Mount("", "/", "", syscall.MS_REC|syscall.MS_PRIVATE, ""); err != nil {
		t.Fatal(err)
	}
	if mode == "file" {
		source = filepath.Join(source, "answer")
	}
	if mode != "file" && mode != "directory" {
		t.Fatal("unknown fixture")
	}
	if err := syscall.Mount(source, alias, "", syscall.MS_BIND, ""); err != nil {
		t.Fatal("private bind", err)
	}
	defer syscall.Unmount(alias, syscall.MNT_DETACH)
	info, err := os.Stat(alias)
	if err != nil {
		t.Fatal(err)
	}
	var wire struct {
		Major, Minor uint32
		Root         string
	}
	if json.Unmarshal([]byte(anchorRaw), &wire) != nil {
		t.Fatal("bad test anchor")
	}
	if uint64(info.Sys().(*syscall.Stat_t).Dev) != unix.Mkdev(wire.Major, wire.Minor) {
		t.Fatal("fixture did not preserve same device")
	}
	table, err := os.Open("/proc/self/mountinfo")
	if err != nil {
		t.Fatal(err)
	}
	defer table.Close()
	rows, err := parseWorkspaceMountTopology(table)
	if err != nil {
		t.Fatal(err)
	}
	observed, err := workspaceMountRelationships(workspaceMountAnchor{workspaceMountDevice{wire.Major, wire.Minor}, wire.Root}, rows)
	if err != nil {
		t.Fatal(err)
	}
	expected := "exact-source"
	if mode == "file" {
		expected = "source-descendant"
	}
	found := false
	for _, item := range observed {
		if item.mount.point == alias && item.relation == expected {
			found = true
		}
	}
	if !found {
		t.Fatal("real same-device foreign-namespace bind reference missed", mode)
	}
}

func TestWorkspaceMountTopologyRecognizesActualForeignNamespaceFileAndDirectoryBinds(t *testing.T) {
	if os.Getenv("EXAM_COLLECTION_USERNS") != "1" {
		t.Skip("requires isolated user/mount namespace opt-in")
	}
	source := filepath.Join(t.TempDir(), "work with space\\slash\ttab")
	if err := os.Mkdir(source, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "answer"), []byte("SYNTHETIC-PRESERVED"), 0600); err != nil {
		t.Fatal(err)
	}
	pinned, err := os.Open(source)
	if err != nil {
		t.Fatal(err)
	}
	defer pinned.Close()
	info, err := pinned.Stat()
	if err != nil {
		t.Fatal(err)
	}
	id, err := templateMountID(pinned)
	if err != nil {
		t.Fatal(err)
	}
	mountFile, err := os.Open("/proc/self/mountinfo")
	if err != nil {
		t.Fatal(err)
	}
	rows, err := parseWorkspaceMountTopology(mountFile)
	_ = mountFile.Close()
	if err != nil {
		t.Fatal(err)
	}
	anchor, err := workspaceMountAnchorFor(source, id, uint64(info.Sys().(*syscall.Stat_t).Dev), rows)
	if err != nil {
		t.Fatal(err)
	}
	wire, _ := json.Marshal(struct {
		Major, Minor uint32
		Root         string
	}{anchor.device.major, anchor.device.minor, anchor.filesystemPath})
	inode := func(ns string) string {
		info, err := os.Stat("/proc/self/ns/" + ns)
		if err != nil {
			t.Fatal(err)
		}
		return strconv.FormatUint(info.Sys().(*syscall.Stat_t).Ino, 10)
	}
	parentUser, parentMount := inode("user"), inode("mnt")
	for _, mode := range []string{"directory", "file"} {
		alias := filepath.Join(t.TempDir(), "alias with space\\slash\ttab")
		if mode == "directory" {
			err = os.Mkdir(alias, 0700)
		} else {
			err = os.WriteFile(alias, nil, 0600)
		}
		if err != nil {
			t.Fatal(err)
		}
		originalAlias, err := os.Stat(alias)
		if err != nil {
			t.Fatal(err)
		}
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		command := exec.CommandContext(ctx, "/usr/bin/unshare", "--user", "--map-root-user", "--mount", os.Args[0], "-test.run=^TestWorkspaceMountTopologyChild$", "--", source, alias, parentUser, parentMount, mode, string(wire))
		command.Env = append(os.Environ(), "EXAM_WORKSPACE_MOUNT_CHILD=1", "GORACE=atexit_sleep_ms=0")
		out, err := command.CombinedOutput()
		cancel()
		if err != nil {
			t.Fatal("actual isolated kernel topology fixture", mode, err, string(out))
		}
		restored, err := os.Stat(alias)
		if err != nil || restored.Sys().(*syscall.Stat_t).Ino != originalAlias.Sys().(*syscall.Stat_t).Ino || restored.Sys().(*syscall.Stat_t).Dev != originalAlias.Sys().(*syscall.Stat_t).Dev || restored.Mode() != originalAlias.Mode() || restored.Size() != originalAlias.Size() {
			t.Fatal("child mount leaked into parent", err)
		}
	}
	saved, err := os.ReadFile(filepath.Join(source, "answer"))
	if err != nil || !bytes.Equal(saved, []byte("SYNTHETIC-PRESERVED")) {
		t.Fatal("source bytes changed", err)
	}
	if inode("user") != parentUser || inode("mnt") != parentMount {
		t.Fatal("parent namespace changed")
	}
}

func TestWorkspaceMountTopologyChildRefusesUnqualifiedHost(t *testing.T) {
	if os.Getenv("EXAM_WORKSPACE_MOUNT_CHILD") == "1" {
		t.Skip("not a nested host probe")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, "/usr/bin/env", "EXAM_WORKSPACE_MOUNT_CHILD=1", "GORACE=atexit_sleep_ms=0", os.Args[0], "-test.run=^TestWorkspaceMountTopologyChild$", "--", "/", "/", "1", "1", "directory", "{}")
	output, err := command.CombinedOutput()
	if err == nil || !(bytes.Contains(output, []byte("private mapped root required")) || bytes.Contains(output, []byte("refuse outside mapped test user namespace"))) {
		t.Fatal("child flag did not refuse unqualified host", err, string(output))
	}
}

func FuzzWorkspaceMountTopology(f *testing.F) {
	for _, seed := range []string{"1 0 8:1 / / rw - ext4 /dev/root rw\n", "2 1 0:42 /real\\040work /store rw unknown:tag - overlay overlay rw\n", "", "1 0 8:1 / / rw - ext4 /dev/root rw"} {
		f.Add([]byte(seed))
	}
	f.Fuzz(func(t *testing.T, data []byte) {
		if len(data) > 4096 {
			return
		}
		rows, err := parseWorkspaceMountTopology(bytes.NewReader(data))
		if err != nil {
			return
		}
		if len(rows) == 0 {
			t.Fatal("accepted empty topology")
		}
		first := rows[0]
		anchor, err := workspaceMountAnchorFor(first.point, first.id, unix.Mkdev(first.device.major, first.device.minor), rows)
		if err != nil {
			return
		} // A literal system-root target deliberately refuses.
		observed, err := workspaceMountRelationships(anchor, rows)
		if err != nil {
			t.Fatal("parsed anchor rejected", err)
		}
		found := false
		for _, item := range observed {
			if item.mount.id == first.id && item.relation == "exact-source" {
				found = true
			}
		}
		if !found {
			t.Fatal("own exact source missing after successful parse/anchor")
		}
	})
}
