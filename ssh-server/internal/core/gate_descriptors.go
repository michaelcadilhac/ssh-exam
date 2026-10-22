package core

import (
	"errors"
	"os"

	"golang.org/x/sys/unix"
)

var errGateDescriptors = errors.New("invalid local descriptor frame; use matching exam-login/agent and reopen the pane")

// recvmsg installs descriptors before any JSON/account/signature validation.
// Immediately own every returned SCM_RIGHTS descriptor, including a truncated
// message's installed prefix. Linux net.UnixConn uses MSG_CMSG_CLOEXEC already.
// No validation/refusal branch may orphan them or guess raw integers to close.
type gateDescriptors struct{ files []*os.File }

func receiveGateDescriptors(control []byte, flags int) (owned *gateDescriptors, resultErr error) {
	return receiveBoundedDescriptors(control, flags, 1)
}

// The public gate still accepts at most one descriptor. The private, verified
// root terminal-supervisor handoff needs five exact fixed-role descriptors.
func receiveBoundedDescriptors(control []byte, flags, limit int) (owned *gateDescriptors, resultErr error) {
	owned = &gateDescriptors{}
	defer func() {
		if resultErr != nil {
			owned.close()
		}
	}()
	invalid := flags&(unix.MSG_CTRUNC|unix.MSG_TRUNC) != 0
	for len(control) != 0 {
		// ParseOne's native-header view assumes a complete header. Never let
		// an incomplete control suffix become an out-of-bounds unsafe view.
		if len(control) < unix.CmsgLen(0) {
			return owned, errGateDescriptors
		}
		header, data, remaining, err := unix.ParseOneSocketControlMessage(control)
		if err != nil {
			return owned, errGateDescriptors
		}
		control = remaining
		if header.Level != unix.SOL_SOCKET || header.Type != unix.SCM_RIGHTS {
			invalid = true
			continue
		}
		fds, err := unix.ParseUnixRights(&unix.SocketControlMessage{Header: header, Data: data})
		if err != nil {
			return owned, errGateDescriptors
		}
		for _, fd := range fds {
			file := os.NewFile(uintptr(fd), "gate-received-descriptor")
			if file == nil {
				invalid = true
				continue
			}
			owned.files = append(owned.files, file)
		}
		if len(data) == 0 || len(data)%4 != 0 {
			invalid = true
		}
	}
	if invalid || limit < 0 || limit > 5 || len(owned.files) > limit {
		return owned, errGateDescriptors
	}
	return owned, nil
}

func (owned *gateDescriptors) close() {
	for i, file := range owned.files {
		if file != nil {
			_ = file.Close()
			owned.files[i] = nil
		}
	}
}

func (owned *gateDescriptors) takeOnly() (*os.File, error) {
	if len(owned.files) != 1 || owned.files[0] == nil {
		return nil, errGateDescriptors
	}
	file := owned.files[0]
	owned.files[0] = nil // Transfer exactly once to the normal pane lifetime defer.
	return file, nil
}
