package main

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"examworkspace/agent/internal/core"
	"fmt"
	"hash"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"syscall"

	"golang.org/x/sys/unix"
)

var exportSections = [...]string{"frames", "terminals", "incidents", "interruptions"}
var exportDigest = regexp.MustCompile(`^[a-f0-9]{64}$`)
var errExportOutput = errors.New("monitoring export nested scope/identity/cursor/length/digest/count rejected; no completed export published; preserve the private incomplete directory and inspect matching gateway/CLI versions")

type exportWatermark struct {
	Through int64 `json:"through"`
	Count   int64 `json:"count"`
}
type exportLedger struct {
	file           *os.File
	hash           hash.Hash
	bytes, entries int64
}
type exportExpected struct{ area, id, digest string }
type exportCurrentFile struct {
	expected                exportExpected
	file                    *os.File
	hash                    hash.Hash
	through, next, verified int64
	verifying               bool
}
type monitoringExportOutput struct {
	id, request, target, base, parentPath, stageName, stagePath string
	parent, stage                                               *os.File
	areas                                                       map[string]*os.File
	ledgers                                                     map[string]*exportLedger
	inventory                                                   map[string]exportWatermark
	counts, cursors                                             map[string]int64
	queue                                                       []exportExpected
	current                                                     *exportCurrentFile
	begin                                                       json.RawMessage
	end                                                         json.RawMessage
	files, bytes                                                int64
	phase                                                       int
	published                                                   bool
	checkpoint                                                  func(string) error // Tests only; never configured from flags/environment.
}

func exportFields(raw json.RawMessage, keys ...string) (map[string]json.RawMessage, error) {
	var fields map[string]json.RawMessage
	if core.DecodeMonitoringExportObject(raw, &fields, keys) != nil {
		return nil, errExportOutput
	}
	return fields, nil
}
func exportString(raw json.RawMessage, limit int) (string, error) {
	var value string
	if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) || json.Unmarshal(raw, &value) != nil || len(value) > limit {
		return "", errExportOutput
	}
	return value, nil
}
func exportNumber(raw json.RawMessage, nullable bool) (int64, error) {
	if bytes.Equal(bytes.TrimSpace(raw), []byte("null")) {
		if nullable {
			return 0, nil
		}
		return 0, errExportOutput
	}
	var value int64
	if json.Unmarshal(raw, &value) != nil || value < 0 || value > core.MonitoringExportSafeInteger {
		return 0, errExportOutput
	}
	return value, nil
}
func decodeExportBytes(encoded string) ([]byte, error) {
	if len(encoded) > base64.StdEncoding.EncodedLen(core.MonitoringExportChunkSize) {
		return nil, errExportOutput
	}
	data, err := base64.StdEncoding.Strict().DecodeString(encoded)
	if err != nil || len(data) > core.MonitoringExportChunkSize || base64.StdEncoding.EncodeToString(data) != encoded {
		return nil, errExportOutput
	}
	return data, nil
}
func parseExportInventory(raw json.RawMessage) (map[string]exportWatermark, error) {
	fields, err := exportFields(raw, exportSections[:]...)
	if err != nil {
		return nil, err
	}
	result := map[string]exportWatermark{}
	for _, section := range exportSections {
		value, err := exportFields(fields[section], "through", "count")
		if err != nil {
			return nil, err
		}
		through, err := exportNumber(value["through"], false)
		if err != nil {
			return nil, err
		}
		count, err := exportNumber(value["count"], false)
		if err != nil || count > through {
			return nil, errExportOutput
		}
		result[section] = exportWatermark{through, count}
	}
	if result["frames"].Count > (core.MonitoringExportSafeInteger-result["terminals"].Count)/2 {
		return nil, errExportOutput
	}
	return result, nil
}

func newMonitoringExportOutput(output, id, request string) (*monitoringExportOutput, error) {
	if output == "" || output == "-" || len(output) > 4096 {
		return nil, errors.New("export requires --output NEW_DIR, never stdout or an existing destination")
	}
	target, err := filepath.Abs(output)
	if err != nil {
		return nil, err
	}
	base, parentPath := filepath.Base(target), filepath.Dir(target)
	if base == "." || base == ".." || base == "/" || len(base) > 255 {
		return nil, errors.New("choose a new named private export directory")
	}
	// Pin the entire destination-parent walk without following ANY symlink.
	fd, err := unix.Open("/", unix.O_RDONLY|unix.O_DIRECTORY|unix.O_CLOEXEC, 0)
	if err != nil {
		return nil, err
	}
	for _, part := range strings.Split(strings.TrimPrefix(parentPath, "/"), "/") {
		if part == "" {
			continue
		}
		next, e := unix.Openat(fd, part, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
		unix.Close(fd)
		if e != nil {
			return nil, fmt.Errorf("export parent unavailable or linked; choose an existing real private directory: %w", e)
		}
		fd = next
	}
	parent := os.NewFile(uintptr(fd), parentPath)
	var named unix.Stat_t
	err = unix.Fstatat(fd, base, &named, unix.AT_SYMLINK_NOFOLLOW)
	if err == nil {
		parent.Close()
		return nil, errors.New("export destination already exists (never overwrite); choose a NEW output directory")
	}
	if !errors.Is(err, unix.ENOENT) {
		parent.Close()
		return nil, err
	}
	return &monitoringExportOutput{id: id, request: request, target: target, base: base, parentPath: parentPath, parent: parent, areas: map[string]*os.File{}, ledgers: map[string]*exportLedger{}, counts: map[string]int64{}, cursors: map[string]int64{}, phase: -1}, nil
}

func exportOpenAt(parent *os.File, name string, flags int, mode uint32) (*os.File, error) {
	fd, err := unix.Openat(int(parent.Fd()), name, flags|unix.O_NOFOLLOW|unix.O_CLOEXEC, mode)
	if err != nil {
		return nil, err
	}
	return os.NewFile(uintptr(fd), name), nil
}
func (o *monitoringExportOutput) fault(phase string) error {
	if o.checkpoint != nil {
		return o.checkpoint(phase)
	}
	return nil
}
func (o *monitoringExportOutput) start() error {
	o.stageName = "ssh-exam-monitoring-" + core.ManagementID() + ".incomplete"
	o.stagePath = filepath.Join(o.parentPath, o.stageName)
	if err := unix.Mkdirat(int(o.parent.Fd()), o.stageName, 0700); err != nil {
		return err
	}
	stage, err := exportOpenAt(o.parent, o.stageName, unix.O_RDONLY|unix.O_DIRECTORY, 0)
	if err != nil {
		return err
	}
	o.stage = stage
	for _, area := range []string{"frames", "thumbnails", "terminals"} {
		if err := unix.Mkdirat(int(stage.Fd()), area, 0700); err != nil {
			return err
		}
		file, err := exportOpenAt(stage, area, unix.O_RDONLY|unix.O_DIRECTORY, 0)
		if err != nil {
			return err
		}
		o.areas[area] = file
	}
	marker, err := exportOpenAt(stage, "INCOMPLETE", unix.O_WRONLY|unix.O_CREAT|unix.O_EXCL, 0600)
	if err != nil {
		return err
	}
	_, writeErr := marker.WriteString("This is an incomplete private monitoring export. Do not treat it as a complete copy. The CLI requires a verified end, clean stream EOF and successful publication.\n")
	if writeErr == nil {
		writeErr = marker.Sync()
	}
	closeErr := marker.Close()
	if writeErr != nil {
		return writeErr
	}
	if closeErr != nil {
		return closeErr
	}
	for _, name := range []string{"frames", "terminals", "incidents", "interruptions", "files"} {
		file, err := exportOpenAt(stage, name+".ndjson", unix.O_WRONLY|unix.O_CREAT|unix.O_EXCL, 0600)
		if err != nil {
			return err
		}
		o.ledgers[name] = &exportLedger{file: file, hash: sha256.New()}
	}
	return nil
}
func (o *monitoringExportOutput) append(name string, raw []byte) error {
	var compact bytes.Buffer
	if json.Compact(&compact, raw) != nil {
		return errExportOutput
	}
	line := append(compact.Bytes(), '\n')
	ledger := o.ledgers[name]
	n, err := ledger.file.Write(line)
	if err != nil {
		return err
	}
	if n != len(line) {
		return errors.New("monitoring metadata output write incomplete")
	}
	ledger.hash.Write(line)
	ledger.bytes += int64(n)
	ledger.entries++
	return nil
}

func (o *monitoringExportOutput) accept(raw json.RawMessage) error {
	if len(o.end) > 0 {
		return errExportOutput
	}
	var tag struct{ Kind string }
	if json.Unmarshal(raw, &tag) != nil {
		return errExportOutput
	}
	if len(o.begin) == 0 {
		if tag.Kind != "begin" {
			return errExportOutput
		}
		fields, err := exportFields(raw, "kind", "inventory", "attempt", "observed", "note")
		if err != nil {
			return err
		}
		inventory, err := parseExportInventory(fields["inventory"])
		if err != nil {
			return err
		}
		attempt, err := exportFields(fields["attempt"], "id", "exam", "username", "state", "start", "deadline", "original_deadline", "ended", "protected", "checksum")
		if err != nil {
			return err
		}
		id, err := exportString(attempt["id"], 64)
		if err != nil || id != o.id {
			return errExportOutput
		}
		for _, name := range []string{"exam", "username", "state"} {
			if _, err := exportString(attempt[name], 1024); err != nil {
				return err
			}
		}
		for _, name := range []string{"start", "deadline", "original_deadline", "ended"} {
			if _, err := exportNumber(attempt[name], true); err != nil {
				return err
			}
		}
		protected, err := exportNumber(attempt["protected"], false)
		if err != nil || protected > 1 {
			return errExportOutput
		}
		if !bytes.Equal(attempt["checksum"], []byte("null")) {
			if _, err := exportString(attempt["checksum"], 1024); err != nil {
				return err
			}
		}
		if _, err := exportNumber(fields["observed"], false); err != nil {
			return err
		}
		if _, err := exportString(fields["note"], 4096); err != nil {
			return err
		}
		o.inventory = inventory
		if err := o.start(); err != nil {
			return err
		}
		o.begin = append([]byte(nil), raw...)
		return nil
	}
	switch tag.Kind {
	case "metadata":
		return o.metadata(raw)
	case "file-begin":
		return o.fileBegin(raw)
	case "file-data":
		return o.fileData(raw)
	case "file-verify":
		return o.fileVerify(raw)
	case "file-end":
		return o.fileEnd(raw)
	case "end":
		fields, err := exportFields(raw, "kind", "inventory", "counts", "files", "bytes", "observed")
		if err != nil || o.current != nil || len(o.queue) != 0 {
			return errExportOutput
		}
		inventory, err := parseExportInventory(fields["inventory"])
		if err != nil {
			return err
		}
		counts, err := exportFields(fields["counts"], exportSections[:]...)
		if err != nil {
			return err
		}
		for _, section := range exportSections {
			count, err := exportNumber(counts[section], false)
			if err != nil || inventory[section] != o.inventory[section] || count != o.counts[section] || count != o.inventory[section].Count {
				return errExportOutput
			}
		}
		files, err := exportNumber(fields["files"], false)
		if err != nil || files != o.files || files != 2*o.inventory["frames"].Count+o.inventory["terminals"].Count {
			return errExportOutput
		}
		amount, err := exportNumber(fields["bytes"], false)
		if err != nil || amount != o.bytes {
			return errExportOutput
		}
		if _, err := exportNumber(fields["observed"], false); err != nil {
			return err
		}
		o.end = append([]byte(nil), raw...)
		return nil // Not publishable until verified EOF.
	default:
		return errExportOutput
	}
}

func (o *monitoringExportOutput) metadata(raw json.RawMessage) error {
	if o.current != nil || len(o.queue) != 0 {
		return errExportOutput
	}
	fields, err := exportFields(raw, "kind", "section", "entry")
	if err != nil {
		return err
	}
	section, err := exportString(fields["section"], 32)
	if err != nil {
		return err
	}
	phase := -1
	for i, name := range exportSections {
		if section == name {
			phase = i
		}
	}
	if phase < o.phase || phase < 0 {
		return errExportOutput
	}
	for i := 0; i < phase; i++ {
		name := exportSections[i]
		if o.counts[name] != o.inventory[name].Count {
			return errExportOutput
		}
	}
	keys := map[string][]string{
		"frames":        {"cursor", "attempt", "id", "source", "seq", "captured", "monotonic", "received", "width", "height", "hash"},
		"terminals":     {"cursor", "attempt", "id", "pane", "created"},
		"incidents":     {"cursor", "attempt", "id", "generation", "opened", "events", "message", "review_at"},
		"interruptions": {"cursor", "attempt", "id", "opened", "generation", "events", "authorizations", "ended", "outcome", "historical"},
	}
	entry, err := exportFields(fields["entry"], keys[section]...)
	if err != nil {
		return err
	}
	attempt, err := exportString(entry["attempt"], 64)
	if err != nil || attempt != o.id {
		return errExportOutput
	}
	id, err := exportString(entry["id"], 36)
	if err != nil || !managementUUID.MatchString(id) {
		return errExportOutput
	}
	cursor, err := exportNumber(entry["cursor"], false)
	if err != nil || cursor <= o.cursors[section] || cursor > o.inventory[section].Through || o.counts[section] >= o.inventory[section].Count {
		return errExportOutput
	}
	switch section {
	case "frames":
		source, err := exportString(entry["source"], 16)
		if err != nil || (source != "screen" && source != "webcam") {
			return errExportOutput
		}
		for _, name := range []string{"seq", "captured", "received", "width", "height"} {
			number, err := exportNumber(entry[name], false)
			if err != nil {
				return err
			}
			if (name == "width" || name == "height") && (number < 1 || number > 2560) {
				return errExportOutput
			}
		}
		var elapsed float64
		if bytes.Equal(entry["monotonic"], []byte("null")) || json.Unmarshal(entry["monotonic"], &elapsed) != nil || math.IsInf(elapsed, 0) || math.IsNaN(elapsed) || elapsed < 0 {
			return errExportOutput
		}
		digest, err := exportString(entry["hash"], 64)
		if err != nil || !exportDigest.MatchString(digest) {
			return errExportOutput
		}
		o.queue = []exportExpected{{"frames", id, digest}, {"thumbnails", id, ""}}
	case "terminals":
		pane, err := exportString(entry["pane"], 36)
		if err != nil || !managementUUID.MatchString(pane) {
			return errExportOutput
		}
		if _, err := exportNumber(entry["created"], false); err != nil {
			return err
		}
		o.queue = []exportExpected{{"terminals", pane, ""}}
	default:
		for _, name := range []string{"generation", "opened"} {
			if _, err := exportNumber(entry[name], name == "opened"); err != nil {
				return err
			}
		}
		for _, name := range []string{"events", "message", "authorizations", "outcome"} {
			if value, ok := entry[name]; ok && !bytes.Equal(value, []byte("null")) {
				if _, err := exportString(value, 1048576); err != nil {
					return err
				}
			} else if (name == "events" || name == "authorizations") && ok {
				return errExportOutput
			}
		}
		for _, name := range []string{"review_at", "ended", "historical"} {
			if value, ok := entry[name]; ok {
				number, err := exportNumber(value, name != "historical")
				if err != nil || name == "historical" && number > 1 {
					return errExportOutput
				}
			}
		}
	}
	if err := o.append(section, fields["entry"]); err != nil {
		return err
	}
	o.counts[section]++
	o.cursors[section] = cursor
	o.phase = phase
	return nil
}

func (o *monitoringExportOutput) fileBegin(raw json.RawMessage) error {
	if o.current != nil || len(o.queue) == 0 {
		return errExportOutput
	}
	expected := o.queue[0]
	keys := []string{"kind", "area", "file", "bytes"}
	if expected.area != "terminals" {
		keys = append(keys, "sha256")
	}
	fields, err := exportFields(raw, keys...)
	if err != nil {
		return err
	}
	area, err := exportString(fields["area"], 16)
	if err != nil {
		return err
	}
	id, err := exportString(fields["file"], 36)
	if err != nil || area != expected.area || id != expected.id {
		return errExportOutput
	}
	through, err := exportNumber(fields["bytes"], false)
	if err != nil {
		return err
	}
	if area != "terminals" {
		limit := int64(1500000)
		if area == "thumbnails" {
			limit = 2 * 1024 * 1024
		}
		if through < 1 || through > limit {
			return errExportOutput
		}
		digest, err := exportString(fields["sha256"], 64)
		if err != nil || !exportDigest.MatchString(digest) || expected.digest != "" && digest != expected.digest {
			return errExportOutput
		}
		expected.digest = digest
	}
	suffix := ".jpg"
	if area == "terminals" {
		suffix = ".ndjson"
	}
	file, err := exportOpenAt(o.areas[area], id+suffix, unix.O_WRONLY|unix.O_CREAT|unix.O_EXCL, 0600)
	if err != nil {
		return err
	}
	o.current = &exportCurrentFile{expected: expected, file: file, hash: sha256.New(), through: through}
	return nil
}
func (o *monitoringExportOutput) fileData(raw json.RawMessage) error {
	file := o.current
	if file == nil || file.verifying {
		return errExportOutput
	}
	fields, err := exportFields(raw, "kind", "area", "file", "offset", "data")
	if err != nil {
		return err
	}
	if !o.currentIdentity(fields) {
		return errExportOutput
	}
	offset, err := exportNumber(fields["offset"], false)
	if err != nil || offset != file.next {
		return errExportOutput
	}
	encoded, err := exportString(fields["data"], (core.MonitoringExportChunkSize+2)/3*4)
	if err != nil {
		return err
	}
	data, err := decodeExportBytes(encoded)
	if err != nil || len(data) == 0 || int64(len(data)) > file.through-file.next {
		return errExportOutput
	}
	n, err := file.file.Write(data)
	if err != nil {
		return err
	}
	if n != len(data) {
		return errors.New("private export payload write incomplete")
	}
	file.hash.Write(data)
	file.next += int64(n)
	return nil
}
func (o *monitoringExportOutput) currentIdentity(fields map[string]json.RawMessage) bool {
	area, e := exportString(fields["area"], 16)
	id, err := exportString(fields["file"], 36)
	return e == nil && err == nil && o.current != nil && area == o.current.expected.area && id == o.current.expected.id
}
func (o *monitoringExportOutput) fileVerify(raw json.RawMessage) error {
	file := o.current
	if file == nil || file.expected.area != "terminals" || file.next != file.through {
		return errExportOutput
	}
	fields, err := exportFields(raw, "kind", "area", "file", "offset", "bytes")
	if err != nil || !o.currentIdentity(fields) {
		return errExportOutput
	}
	offset, err := exportNumber(fields["offset"], false)
	if err != nil || offset <= file.verified || offset > file.through {
		return errExportOutput
	}
	amount, err := exportNumber(fields["bytes"], false)
	if err != nil || amount != file.through {
		return errExportOutput
	}
	file.verified = offset
	file.verifying = true
	return nil
}
func (o *monitoringExportOutput) fileEnd(raw json.RawMessage) error {
	file := o.current
	if file == nil || file.next != file.through {
		return errExportOutput
	}
	fields, err := exportFields(raw, "kind", "area", "file", "bytes", "sha256")
	if err != nil || !o.currentIdentity(fields) {
		return errExportOutput
	}
	amount, err := exportNumber(fields["bytes"], false)
	if err != nil || amount != file.through {
		return errExportOutput
	}
	digest, err := exportString(fields["sha256"], 64)
	if err != nil || !exportDigest.MatchString(digest) || digest != hex.EncodeToString(file.hash.Sum(nil)) || file.expected.digest != "" && digest != file.expected.digest {
		return errExportOutput
	}
	if err := o.fault("payload-sync"); err != nil {
		return err
	}
	if err := file.file.Sync(); err != nil {
		return err
	}
	if err := file.file.Close(); err != nil {
		file.file = nil
		return err
	}
	file.file = nil
	if o.bytes > core.MonitoringExportSafeInteger-amount {
		return errExportOutput
	}
	suffix := ".jpg"
	if file.expected.area == "terminals" {
		suffix = ".ndjson"
	}
	index, _ := json.Marshal(map[string]any{"path": file.expected.area + "/" + file.expected.id + suffix, "bytes": amount, "sha256": digest})
	if err := o.append("files", index); err != nil {
		return err
	}
	o.files++
	o.bytes += amount
	o.current = nil
	o.queue = o.queue[1:]
	return nil
}

func (o *monitoringExportOutput) finish() (string, error) {
	if len(o.end) == 0 || o.current != nil || len(o.queue) != 0 || o.stage == nil {
		return "", errExportOutput
	}
	metadata := map[string]any{}
	for name, ledger := range o.ledgers {
		if err := o.fault("metadata-sync"); err != nil {
			return "", err
		}
		if err := ledger.file.Sync(); err != nil {
			return "", err
		}
		if err := ledger.file.Close(); err != nil {
			ledger.file = nil
			return "", err
		}
		ledger.file = nil
		metadata[name+".ndjson"] = map[string]any{"sha256": hex.EncodeToString(ledger.hash.Sum(nil)), "bytes": ledger.bytes, "entries": ledger.entries}
	}
	manifest, _ := json.Marshal(map[string]any{"version": 1, "complete": true, "attempt": o.id, "request": o.request, "begin": o.begin, "end": o.end, "metadata": metadata, "note": "Complete selected watermark/prefix copy, not a globally atomic snapshot, live authorization/protection proof or recallable private copy. Require successful CLI publication; operator retention is independent"})
	manifest = append(manifest, '\n')
	file, err := exportOpenAt(o.stage, "manifest.json", unix.O_WRONLY|unix.O_CREAT|unix.O_EXCL, 0600)
	if err != nil {
		return "", err
	}
	n, err := file.Write(manifest)
	if err == nil && n != len(manifest) {
		err = errors.New("export manifest write incomplete")
	}
	if err == nil {
		err = o.fault("manifest-sync")
	}
	if err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err == nil {
		err = closeErr
	}
	if err != nil {
		return "", err
	}
	// Verify every named output directory still refers to the pinned directory.
	for name, area := range o.areas {
		var pinned, named unix.Stat_t
		if unix.Fstat(int(area.Fd()), &pinned) != nil || unix.Fstatat(int(o.stage.Fd()), name, &named, unix.AT_SYMLINK_NOFOLLOW) != nil || pinned.Dev != named.Dev || pinned.Ino != named.Ino || named.Mode&unix.S_IFMT != unix.S_IFDIR {
			return "", errExportOutput
		}
		if err := area.Sync(); err != nil {
			return "", err
		}
	}
	var stage, named, parent unix.Stat_t
	if unix.Fstat(int(o.stage.Fd()), &stage) != nil || unix.Fstatat(int(o.parent.Fd()), o.stageName, &named, unix.AT_SYMLINK_NOFOLLOW) != nil || stage.Dev != named.Dev || stage.Ino != named.Ino || named.Mode&unix.S_IFMT != unix.S_IFDIR {
		return "", errExportOutput
	}
	info, err := os.Stat(o.parentPath)
	if err != nil {
		return "", err
	}
	if unix.Fstat(int(o.parent.Fd()), &parent) != nil {
		return "", errExportOutput
	}
	actual := info.Sys().(*syscall.Stat_t)
	if uint64(actual.Dev) != uint64(parent.Dev) || actual.Ino != parent.Ino {
		return "", errors.New("pinned export parent moved; preserve private incomplete output and select a stable NEW destination")
	}
	if err := o.stage.Sync(); err != nil {
		return "", err
	}
	if err := o.fault("before-publish"); err != nil {
		return "", err
	}
	if err := unix.Renameat2(int(o.parent.Fd()), o.stageName, int(o.parent.Fd()), o.base, unix.RENAME_NOREPLACE); err != nil {
		return "", err
	}
	o.published = true
	if err := o.fault("parent-sync"); err != nil {
		return "", err
	}
	if err := o.parent.Sync(); err != nil {
		return "", err
	}
	if err := unix.Unlinkat(int(o.stage.Fd()), "INCOMPLETE", 0); err != nil {
		return "", err
	}
	if err := o.stage.Sync(); err != nil {
		return "", err
	}
	var closes []error
	for name, area := range o.areas {
		closes = append(closes, area.Close())
		delete(o.areas, name)
	}
	closes = append(closes, o.stage.Close(), o.parent.Close())
	o.stage = nil
	o.parent = nil
	if err := errors.Join(closes...); err != nil {
		return "", err
	}
	return core.Hash(manifest), nil
}
func (o *monitoringExportOutput) close() {
	if o.current != nil && o.current.file != nil {
		o.current.file.Close()
	}
	for _, ledger := range o.ledgers {
		if ledger.file != nil {
			ledger.file.Close()
		}
	}
	for _, area := range o.areas {
		area.Close()
	}
	if o.stage != nil {
		o.stage.Close()
	}
	if o.parent != nil {
		o.parent.Close()
	}
}

func executeMonitoringExport(config, request, id, output string) int {
	if os.Getuid() != 0 || os.Geteuid() != 0 {
		fmt.Fprintln(os.Stderr, "Run examctl monitoring export as root on the class server; see web monitoring help")
		return 1
	}
	c, err := core.LoadConfig(config)
	if err != nil {
		fmt.Fprintln(os.Stderr, "Load root agent configuration:", err)
		return 1
	}
	if request == "" {
		request = core.ManagementID()
	}
	fmt.Fprintln(os.Stderr, "Monitoring export request ID:", request)
	writer, err := newMonitoringExportOutput(output, id, request)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	defer writer.close()
	err = core.ManagementExport(c, id, request, writer.accept)
	var digest string
	if err == nil {
		digest, err = writer.finish()
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, "Monitoring export not completed:", err)
		if writer.published {
			fmt.Fprintf(os.Stderr, "Final directory %q may exist but publication/durability is UNCONFIRMED; do not treat this exit as success. Preserve and inspect it.\n", writer.target)
		} else if writer.stage != nil {
			fmt.Fprintf(os.Stderr, "Private INCOMPLETE output retained at %q; do not treat it as complete.\n", writer.stagePath)
		}
		fmt.Fprintln(os.Stderr, "Inspect examctl web monitoring show", id, "and retry using a NEW --output directory with --request", request)
		return 1
	}
	result := map[string]any{"confirmed": true, "operation": "monitoring.export", "request": request, "id": id, "directory": writer.target, "files": writer.files, "bytes": writer.bytes, "manifestSha256": digest}
	if err := json.NewEncoder(os.Stdout).Encode(result); err != nil {
		fmt.Fprintln(os.Stderr, "Private export exists but stdout receipt could not be written:", err)
		return 1
	}
	return 0
}
