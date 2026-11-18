package core

import (
	"encoding/binary"
	"testing"

	"golang.org/x/sys/unix"
)

func TestHostUnixSocketDiagnosticRejectsMalformedIdentities(t *testing.T) {
	attribute := func(kind uint16, value []byte) []byte {
		result := make([]byte, (4+len(value)+3)&^3)
		binary.NativeEndian.PutUint16(result[:2], uint16(4+len(value)))
		binary.NativeEndian.PutUint16(result[2:4], kind)
		copy(result[4:], value)
		return result
	}
	header := make([]byte, 16)
	header[0], header[1], header[2] = unix.AF_UNIX, unix.SOCK_SEQPACKET, 10
	binary.NativeEndian.PutUint32(header[4:8], 123)
	name := attribute(0, []byte("/proc/self/fd/128/control.sock\x00"))
	vfs := make([]byte, 8)
	binary.NativeEndian.PutUint32(vfs[:4], 456)
	binary.NativeEndian.PutUint32(vfs[4:8], 8<<20|2)
	identity := attribute(1, vfs)
	valid := append(append(append([]byte{}, header...), name...), identity...)
	inode, observed, err := parseHostUnixSocket(valid)
	if err != nil || inode != 123 || !observed.hasVFS || observed.inode != 456 || observed.device != 8<<20|2 || observed.name != "/proc/self/fd/128/control.sock" {
		t.Fatal("Linux UAPI inode/device order not preserved", inode, observed, err)
	}
	wrongFamily := append([]byte{}, valid...)
	wrongFamily[0] = unix.AF_INET
	for label, payload := range map[string][]byte{
		"short-header":     header[:15],
		"wrong-family":     wrongFamily,
		"short-attribute":  append(append([]byte{}, header...), 1, 0, 0),
		"zero-length":      append(append([]byte{}, header...), 0, 0, 0, 0),
		"oversized-length": append(append([]byte{}, header...), 255, 255, 0, 0),
		"duplicate-name":   append(append([]byte{}, valid...), name...),
		"duplicate-vfs":    append(append([]byte{}, valid...), identity...),
		"short-vfs":        append(append([]byte{}, header...), attribute(1, vfs[:4])...),
		"trailing-byte":    append(append([]byte{}, valid...), 0),
	} {
		t.Run(label, func(t *testing.T) {
			if _, _, err := parseHostUnixSocket(payload); err == nil {
				t.Fatal("malformed kernel identity accepted")
			}
		})
	}
}
