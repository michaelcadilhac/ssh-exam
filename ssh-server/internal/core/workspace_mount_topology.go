package core

// Internal topology observations used by the root CLI's isolated workspace
// dry-run worker. A relationship list is NEVER no-use proof, eligibility or
// permission to delete. No state/hold/archive transition or removal happens here.
import (
	"bufio"
	"bytes"
	"errors"
	"io"
	"path"
	"strconv"
	"strings"

	"golang.org/x/sys/unix"
)

const workspaceMountTableMax = 8 * 1024 * 1024
const workspaceMountLineMax = 256 * 1024
const workspaceMountCountMax = 32768

var errWorkspaceMountTopology = errors.New("workspace mount topology unavailable, malformed, incomplete or outside bounds; preserve workspace and all protected/history/hold records; no cleanup eligibility is established")

type workspaceMountDevice struct{ major, minor uint32 }
type workspaceMount struct {
	id, parent              uint64
	device                  workspaceMountDevice
	root, point, filesystem string
	deletedRoot             bool // Kernel //deleted marker; never a path/anchor.
}
type workspaceMountAnchor struct {
	device         workspaceMountDevice
	filesystemPath string
}
type workspaceMountRelationship struct {
	mount    workspaceMount
	relation string // exact-source, source-descendant, covering-ancestor; NOT busy/safe.
}

func workspaceMountDecimal(value string, bits int) (uint64, error) {
	if value == "" {
		return 0, errWorkspaceMountTopology
	}
	for _, c := range []byte(value) {
		if c < '0' || c > '9' {
			return 0, errWorkspaceMountTopology
		}
	}
	v, err := strconv.ParseUint(value, 10, bits)
	if err != nil {
		return 0, errWorkspaceMountTopology
	}
	return v, nil
}

func workspaceMountPath(encoded string) (string, error) {
	out := make([]byte, 0, len(encoded))
	for at := 0; at < len(encoded); at++ {
		value := encoded[at]
		if value == '\\' {
			if at+3 >= len(encoded) {
				return "", errWorkspaceMountTopology
			}
			for _, digit := range []byte(encoded[at+1 : at+4]) {
				if digit < '0' || digit > '7' {
					return "", errWorkspaceMountTopology
				}
			}
			decoded, err := strconv.ParseUint(encoded[at+1:at+4], 8, 8)
			if err != nil {
				return "", errWorkspaceMountTopology
			}
			value = byte(decoded)
			at += 3
		}
		if value == 0 {
			return "", errWorkspaceMountTopology
		}
		out = append(out, value)
	}
	value := string(out)
	if !strings.HasPrefix(value, "/") || path.Clean(value) != value || strings.HasSuffix(value, " (deleted)") {
		return "", errWorkspaceMountTopology
	}
	return value, nil
}

func workspaceMountLine(data []byte, atEOF bool) (advance int, token []byte, err error) {
	if end := bytes.IndexByte(data, '\n'); end >= 0 {
		return end + 1, data[:end], nil
	}
	if atEOF && len(data) > 0 {
		return 0, nil, errWorkspaceMountTopology
	}
	return 0, nil, nil
}

func parseWorkspaceMountTopology(in io.Reader) ([]workspaceMount, error) {
	data, err := io.ReadAll(io.LimitReader(in, workspaceMountTableMax+1))
	if err != nil || len(data) == 0 || len(data) > workspaceMountTableMax || bytes.IndexByte(data, 0) >= 0 {
		return nil, errWorkspaceMountTopology
	}
	scanner := bufio.NewScanner(bytes.NewReader(data))
	scanner.Buffer(make([]byte, 4096), workspaceMountLineMax)
	scanner.Split(workspaceMountLine)
	mounts := []workspaceMount{}
	seen := map[uint64]bool{}
	for scanner.Scan() {
		// Kernel separators are ASCII spaces; Fields would misinterpret a literal
		// carriage return/Unicode whitespace that is part of a legal path.
		fields := strings.Split(scanner.Text(), " ")
		if len(fields) < 10 || len(mounts) >= workspaceMountCountMax {
			return nil, errWorkspaceMountTopology
		}
		for _, field := range fields {
			if field == "" {
				return nil, errWorkspaceMountTopology
			}
		}
		separator := -1
		for at := 6; at < len(fields); at++ {
			if fields[at] == "-" {
				separator = at
				break
			}
		}
		if separator < 6 || len(fields) != separator+4 {
			return nil, errWorkspaceMountTopology
		}
		id, err := workspaceMountDecimal(fields[0], 64)
		if err != nil || id == 0 || seen[id] {
			return nil, errWorkspaceMountTopology
		}
		parent, err := workspaceMountDecimal(fields[1], 64)
		if err != nil {
			return nil, errWorkspaceMountTopology
		}
		device := strings.Split(fields[2], ":")
		if len(device) != 2 {
			return nil, errWorkspaceMountTopology
		}
		major, err := workspaceMountDecimal(device[0], 32)
		if err != nil {
			return nil, errWorkspaceMountTopology
		}
		minor, err := workspaceMountDecimal(device[1], 32)
		if err != nil {
			return nil, errWorkspaceMountTopology
		}
		// dentry_path() appends //deleted for unlinked bind sources, including
		// nspawn's synthetic boot-id/kmsg files. Retain the ambiguity explicitly:
		// only a different device can exclude it from workspace relationships.
		deletedRoot := strings.HasSuffix(fields[3], "//deleted")
		rootField := fields[3]
		if deletedRoot {
			rootField = strings.TrimSuffix(rootField, "//deleted")
		}
		root, err := workspaceMountPath(rootField)
		if err != nil {
			return nil, err
		}
		point, err := workspaceMountPath(fields[4])
		if err != nil {
			return nil, err
		}
		// Unknown optional tags and filesystem-specific options are not interpreted
		// as authority. A parent omitted by a chroot view is legitimate, not an
		// excuse to claim this one process exposes the entire namespace.
		seen[id] = true
		mounts = append(mounts, workspaceMount{id, parent, workspaceMountDevice{uint32(major), uint32(minor)}, root, point, fields[separator+1], deletedRoot})
	}
	if scanner.Err() != nil || len(mounts) == 0 {
		return nil, errWorkspaceMountTopology
	}
	return mounts, nil
}

func workspaceMountContains(parent, child string) bool {
	return child == parent || (parent == "/" && strings.HasPrefix(child, "/")) || strings.HasPrefix(child, parent+"/")
}

// Caller must supply a current pinned descriptor's mount ID/st_dev plus the
// corresponding canonical path and mountinfo view. Mount IDs alone are reusable
// and do not identify a process, namespace, inode or current ownership.
func workspaceMountAnchorFor(absolute string, mountID, device uint64, mounts []workspaceMount) (workspaceMountAnchor, error) {
	var anchor workspaceMountAnchor
	if !strings.HasPrefix(absolute, "/") || path.Clean(absolute) != absolute || absolute == "/" || strings.ContainsRune(absolute, 0) || mountID == 0 {
		return anchor, errWorkspaceMountTopology
	}
	expected := workspaceMountDevice{unix.Major(device), unix.Minor(device)}
	for _, mount := range mounts {
		if mount.id != mountID {
			continue
		}
		if mount.device != expected || mount.deletedRoot || !workspaceMountContains(mount.point, absolute) {
			return anchor, errWorkspaceMountTopology
		}
		relative := strings.TrimPrefix(absolute, mount.point)
		location := path.Join(mount.root, strings.TrimPrefix(relative, "/"))
		if !workspaceMountContains(mount.root, location) {
			return anchor, errWorkspaceMountTopology
		}
		return workspaceMountAnchor{expected, location}, nil
	}
	return anchor, errWorkspaceMountTopology
}

// Observes filesystem-root relationships, INCLUDING broad covering ancestors.
// An ordinary filesystem root cover is not automatically active workspace use;
// no match is not proof of absence. Later orchestration must resolve all live/
// detached namespace views, pinned process lifetimes, fd/cwd/root/mmap usage,
// private-path/admission fences, fresh archive/holds and the actual delete phase.
func workspaceMountRelationships(anchor workspaceMountAnchor, mounts []workspaceMount) ([]workspaceMountRelationship, error) {
	if !strings.HasPrefix(anchor.filesystemPath, "/") || path.Clean(anchor.filesystemPath) != anchor.filesystemPath || strings.ContainsRune(anchor.filesystemPath, 0) {
		return nil, errWorkspaceMountTopology
	}
	observed := []workspaceMountRelationship{}
	for _, mount := range mounts {
		if mount.device != anchor.device {
			continue
		}
		if mount.deletedRoot {
			return nil, errWorkspaceMountTopology
		}
		relation := ""
		switch {
		case mount.root == anchor.filesystemPath:
			relation = "exact-source"
		case workspaceMountContains(anchor.filesystemPath, mount.root):
			relation = "source-descendant"
		case workspaceMountContains(mount.root, anchor.filesystemPath):
			relation = "covering-ancestor"
		}
		if relation != "" {
			observed = append(observed, workspaceMountRelationship{mount, relation})
		}
	}
	return observed, nil
}
