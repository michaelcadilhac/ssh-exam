package main

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"examworkspace/agent/internal/core"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
)

const exportFrame = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const exportPane = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const exportRecording = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
const exportRequestID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"

func exportOutputEvents() []json.RawMessage {
	image, thumb, terminal := []byte("original-image"), []byte("derived-thumb"), []byte{123, 255, 0, 10}
	inventory := map[string]any{}
	counts := map[string]any{}
	for _, section := range exportSections {
		inventory[section] = map[string]any{"through": 1, "count": 1}
		counts[section] = 1
	}
	values := []map[string]any{
		{"kind": "begin", "inventory": inventory, "attempt": map[string]any{"id": "a", "exam": "e", "username": "synthetic", "state": "COMPLETED", "start": 1, "deadline": 2, "original_deadline": 2, "ended": 2, "protected": 1, "checksum": "protected"}, "observed": 3, "note": "observation, not authority"},
		{"kind": "metadata", "section": "frames", "entry": map[string]any{"cursor": 1, "attempt": "a", "id": exportFrame, "source": "screen", "seq": 1, "captured": 1, "monotonic": 1.5, "received": 2, "width": 40, "height": 30, "hash": core.Hash(image)}},
	}
	for _, entry := range []struct {
		area, id string
		data     []byte
	}{{"frames", exportFrame, image}, {"thumbnails", exportFrame, thumb}} {
		values = append(values, map[string]any{"kind": "file-begin", "area": entry.area, "file": entry.id, "bytes": len(entry.data), "sha256": core.Hash(entry.data)}, map[string]any{"kind": "file-data", "area": entry.area, "file": entry.id, "offset": 0, "data": base64.StdEncoding.EncodeToString(entry.data)}, map[string]any{"kind": "file-end", "area": entry.area, "file": entry.id, "bytes": len(entry.data), "sha256": core.Hash(entry.data)})
	}
	values = append(values,
		map[string]any{"kind": "metadata", "section": "terminals", "entry": map[string]any{"cursor": 1, "attempt": "a", "id": exportRecording, "pane": exportPane, "created": 1}},
		map[string]any{"kind": "file-begin", "area": "terminals", "file": exportPane, "bytes": len(terminal)},
		map[string]any{"kind": "file-data", "area": "terminals", "file": exportPane, "offset": 0, "data": base64.StdEncoding.EncodeToString(terminal)},
		map[string]any{"kind": "file-verify", "area": "terminals", "file": exportPane, "offset": len(terminal), "bytes": len(terminal)},
		map[string]any{"kind": "file-end", "area": "terminals", "file": exportPane, "bytes": len(terminal), "sha256": core.Hash(terminal)},
		map[string]any{"kind": "metadata", "section": "incidents", "entry": map[string]any{"cursor": 1, "attempt": "a", "id": "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", "generation": 0, "opened": 1, "events": "[]", "message": nil, "review_at": nil}},
		map[string]any{"kind": "metadata", "section": "interruptions", "entry": map[string]any{"cursor": 1, "attempt": "a", "id": "ffffffff-ffff-4fff-8fff-ffffffffffff", "generation": 0, "opened": 1, "events": "[]", "authorizations": "[]", "ended": 2, "outcome": "resumed", "historical": 0}},
		map[string]any{"kind": "end", "inventory": inventory, "counts": counts, "files": 3, "bytes": len(image) + len(thumb) + len(terminal), "observed": 4})
	var events []json.RawMessage
	for _, value := range values {
		raw, _ := json.Marshal(value)
		events = append(events, raw)
	}
	return events
}

func TestMonitoringExportPrivatePublicationAndExactPartialBytes(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(dir, "new-copy")
	output, err := newMonitoringExportOutput(target, "a", exportRequestID)
	if err != nil {
		t.Fatal(err)
	}
	defer output.close()
	for _, event := range exportOutputEvents() {
		if err := output.accept(event); err != nil {
			t.Fatal("valid event refused", err, string(event))
		}
	}
	if _, err := os.Stat(target); !os.IsNotExist(err) {
		t.Fatal("published before clean stream completion")
	}
	if _, err := os.Stat(filepath.Join(output.stagePath, "INCOMPLETE")); err != nil {
		t.Fatal("partial copy unlabeled", err)
	}
	digest, err := output.finish()
	if err != nil {
		t.Fatal(err)
	}
	manifest, err := os.ReadFile(filepath.Join(target, "manifest.json"))
	if err != nil || core.Hash(manifest) != digest {
		t.Fatal("manifest digest", err)
	}
	var result map[string]any
	if json.Unmarshal(manifest, &result) != nil || result["complete"] != true {
		t.Fatal("incomplete manifest")
	}
	data, err := os.ReadFile(filepath.Join(target, "terminals", exportPane+".ndjson"))
	if err != nil || string(data) != string([]byte{123, 255, 0, 10}) {
		t.Fatal("partial binary tail lost", err)
	}
	if _, err := os.Stat(filepath.Join(target, "INCOMPLETE")); !os.IsNotExist(err) {
		t.Fatal("successful copy still labeled incomplete")
	}
	if err := filepath.Walk(target, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		mode := os.FileMode(0600)
		if info.IsDir() {
			mode = 0700
		}
		if info.Mode().Perm() != mode {
			return errors.New("private mode mismatch")
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
}

func TestMonitoringExportRejectsBadNestedEventsWithoutFinalOutput(t *testing.T) {
	mutants := map[string]struct {
		index  int
		change func(map[string]any)
	}{
		"other-attempt":         {1, func(v map[string]any) { v["entry"].(map[string]any)["attempt"] = "other" }},
		"unknown-private-field": {1, func(v map[string]any) { v["entry"].(map[string]any)["password"] = "PRIVATE" }},
		"traversal-id":          {1, func(v map[string]any) { v["entry"].(map[string]any)["id"] = "../outside" }},
		"cursor":                {1, func(v map[string]any) { v["entry"].(map[string]any)["cursor"] = 0 }},
		"wrong-file":            {2, func(v map[string]any) { v["file"] = exportPane }},
		"wrong-area":            {2, func(v map[string]any) { v["area"] = "terminals" }},
		"wrong-original-hash":   {2, func(v map[string]any) { v["sha256"] = strings.Repeat("a", 64) }},
		"wrong-offset":          {3, func(v map[string]any) { v["offset"] = 1 }},
		"noncanonical-base64":   {3, func(v map[string]any) { v["data"] = v["data"].(string) + "\n" }},
		"oversized-data": {3, func(v map[string]any) {
			v["data"] = base64.StdEncoding.EncodeToString(make([]byte, core.MonitoringExportChunkSize+1))
		}},
		"wrong-digest":  {4, func(v map[string]any) { v["sha256"] = strings.Repeat("a", 64) }},
		"wrong-length":  {4, func(v map[string]any) { v["bytes"] = 999 }},
		"wrong-summary": {15, func(v map[string]any) { v["files"] = 2 }},
	}
	for name, mutant := range mutants {
		t.Run(name, func(t *testing.T) {
			target := filepath.Join(t.TempDir(), "copy")
			out, err := newMonitoringExportOutput(target, "a", exportRequestID)
			if err != nil {
				t.Fatal(err)
			}
			defer out.close()
			events := exportOutputEvents()
			index := mutant.index
			if name == "wrong-summary" {
				index = len(events) - 1
			}
			for _, event := range events[:index] {
				if err := out.accept(event); err != nil {
					t.Fatal(err)
				}
			}
			var value map[string]any
			json.Unmarshal(events[index], &value)
			mutant.change(value)
			raw, _ := json.Marshal(value)
			if out.accept(raw) == nil {
				t.Fatal("accepted malformed private event", name)
			}
			if _, err := os.Stat(target); !os.IsNotExist(err) {
				t.Fatal("invalid event published output")
			}
		})
	}
}

func TestMonitoringExportOutputNoOverwriteParentLinksAndPublicationRace(t *testing.T) {
	dir := t.TempDir()
	existing := filepath.Join(dir, "existing")
	if err := os.Mkdir(existing, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(existing, "kept"), []byte("protected"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := newMonitoringExportOutput(existing, "a", exportRequestID); err == nil {
		t.Fatal("accepted existing destination")
	}
	link := filepath.Join(dir, "link")
	if err := os.Symlink(existing, link); err != nil {
		t.Fatal(err)
	}
	if _, err := newMonitoringExportOutput(filepath.Join(link, "new"), "a", exportRequestID); err == nil {
		t.Fatal("followed output parent link")
	}
	target := filepath.Join(dir, "race")
	out, err := newMonitoringExportOutput(target, "a", exportRequestID)
	if err != nil {
		t.Fatal(err)
	}
	defer out.close()
	for _, event := range exportOutputEvents() {
		if err := out.accept(event); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Mkdir(target, 0700); err != nil {
		t.Fatal(err)
	}
	if _, err := out.finish(); err == nil || out.published {
		t.Fatal("replaced a racing target", err)
	}
	data, _ := os.ReadFile(filepath.Join(existing, "kept"))
	if string(data) != "protected" {
		t.Fatal("existing data changed")
	}
}

func TestMonitoringExportIOFailureIsNeverACompletedReceipt(t *testing.T) {
	for _, phase := range []string{"payload-sync", "metadata-sync", "manifest-sync", "before-publish", "parent-sync"} {
		t.Run(phase, func(t *testing.T) {
			target := filepath.Join(t.TempDir(), "copy")
			out, err := newMonitoringExportOutput(target, "a", exportRequestID)
			if err != nil {
				t.Fatal(err)
			}
			defer out.close()
			out.checkpoint = func(current string) error {
				if current == phase {
					return syscall.EROFS
				}
				return nil
			}
			failed := false
			for _, event := range exportOutputEvents() {
				if err := out.accept(event); err != nil {
					failed = true
					break
				}
			}
			if !failed {
				_, err = out.finish()
				failed = err != nil
			}
			if !failed {
				t.Fatal("ignored IO failure")
			}
			if phase == "parent-sync" {
				if !out.published {
					t.Fatal("test did not reach uncertain publication")
				}
				if _, err := os.Stat(filepath.Join(target, "INCOMPLETE")); err != nil {
					t.Fatal("uncertain publication lost incomplete marker")
				}
			}
			if phase != "parent-sync" {
				if _, err := os.Stat(target); !os.IsNotExist(err) {
					t.Fatal("failed transaction published final copy")
				}
			}
		})
	}
}

func TestMonitoringExportDetectsPinnedOutputDirectoryReplacement(t *testing.T) {
	target := filepath.Join(t.TempDir(), "copy")
	out, err := newMonitoringExportOutput(target, "a", exportRequestID)
	if err != nil {
		t.Fatal(err)
	}
	defer out.close()
	for _, event := range exportOutputEvents() {
		if err := out.accept(event); err != nil {
			t.Fatal(err)
		}
	}
	frames := filepath.Join(out.stagePath, "frames")
	if err := os.Rename(frames, frames+"-kept"); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(t.TempDir(), frames); err != nil {
		t.Fatal(err)
	}
	if _, err := out.finish(); err == nil {
		t.Fatal("published a replaced directory")
	}
	if _, err := os.Stat(target); !os.IsNotExist(err) {
		t.Fatal("published redirected output")
	}
}
