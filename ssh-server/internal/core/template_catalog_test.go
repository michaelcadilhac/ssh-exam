package core

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"syscall"
	"testing"
)

type templateFixture struct {
	state, source, hash string
	sentinel            []byte
}

func TestTemplateCatalogUnrecordedJobsAreVisibleAndOnlyMetadataCanBeCleaned(t *testing.T) {
	for _, contents := range []string{"empty", "metadata", "unknown", "symlink", "hardlink", "fifo"} {
		t.Run(contents, func(t *testing.T) {
			f := templateCatalogFixture(t)
			c, err := openTemplateCatalog(f.state, true)
			if err != nil {
				t.Fatal(err)
			}
			id := ManagementID()
			dir, err := templateEnsureDirectory(c.jobs, id)
			if err != nil {
				t.Fatal(err)
			}
			dir.Close()
			c.close()
			path := filepath.Join(f.state, "template-catalog", "jobs", id)
			leaf := filepath.Join(path, ".metadata-"+Token())
			switch contents {
			case "metadata":
				err = os.WriteFile(leaf, []byte(`{"incomplete":`), 0600)
			case "unknown":
				err = os.Mkdir(filepath.Join(path, "publish"), 0700)
			case "symlink":
				err = os.Symlink(filepath.Join(f.state, "submissions", "protected"), leaf)
			case "hardlink":
				err = os.Link(filepath.Join(f.state, "submissions", "protected"), leaf)
			case "fifo":
				err = syscall.Mkfifo(leaf, 0600)
			}
			if err != nil {
				t.Fatal(err)
			}
			page, err := templateRun(t, f, TemplateCommand{Action: "jobs", Limit: 10}, "")
			if err != nil || len(page.Jobs) != 1 || page.Jobs[0].Status != "unrecorded" || page.Jobs[0].Created != 0 {
				t.Fatal("lost unknown intent", page, err)
			}
			if _, err := templateRun(t, f, templateInstallCommand(f), id); err == nil || !strings.Contains(err.Error(), "unrecorded") {
				t.Fatal("invented interrupted intent", err)
			}
			b := TemplateCommand{Action: "clean", Job: id, Reason: "Reviewed synthetic orphan metadata"}
			_, err = templateRun(t, f, b, "")
			if contents != "empty" && contents != "metadata" {
				if err == nil {
					t.Fatal("unknown data accepted for removal")
				}
				entries, _ := os.ReadDir(path)
				if len(entries) != 1 {
					t.Fatal("unknown job changed")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if _, err := templateRun(t, f, b, ""); err != nil {
				t.Fatal("cleanup retry failed", err)
			}
			page, err = templateRun(t, f, TemplateCommand{Action: "jobs", Limit: 10}, "")
			if err != nil || len(page.Jobs) != 1 || page.Jobs[0].Status != "unrecorded-cleaned" || page.Jobs[0].Name != "" || page.Jobs[0].Hash != "" || page.Jobs[0].Created != 0 || page.Jobs[0].StagingCleaned <= 0 {
				t.Fatal("cleanup invented original intent", page, err)
			}
			if _, err := templateRun(t, f, templateInstallCommand(f), id); err == nil {
				t.Fatal("cleaned orphan request reused")
			}
			if _, err := templateRun(t, f, templateInstallCommand(f), ""); err != nil {
				t.Fatal("fresh deliberate install failed", err)
			}
		})
	}
}

func TestTemplateAuditPreservesPartialTailAndRefusesConcurrentUnsafeAppend(t *testing.T) {
	f := templateCatalogFixture(t)
	c, err := openTemplateCatalog(f.state, false)
	if err != nil {
		t.Fatal(err)
	}
	defer c.close()
	path := filepath.Join(f.state, "template-catalog", "audit.ndjson")
	if err := os.WriteFile(path, []byte(`{"partial-evidence":`), 0600); err != nil {
		t.Fatal(err)
	}
	if err := c.audit("synthetic", ManagementID(), TemplateCommand{Reason: "Reviewed synthetic intent"}); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	lines := bytes.Split(data, []byte{'\n'})
	if string(lines[0]) != `{"partial-evidence":` || len(lines) != 3 || !json.Valid(lines[1]) {
		t.Fatal("partial receipt overwritten or joined", string(data))
	}
	fh, err := os.OpenFile(path, os.O_RDWR, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer fh.Close()
	if err := syscall.Flock(int(fh.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		t.Fatal(err)
	}
	if err := c.audit("must-not-append", ManagementID(), TemplateCommand{}); err == nil || !strings.Contains(err.Error(), "audit busy") {
		t.Fatal("audit append was not serialized", err)
	}
	after, _ := os.ReadFile(path)
	if !bytes.Equal(data, after) {
		t.Fatal("busy audit changed")
	}
}

func templateCatalogFixture(t *testing.T) templateFixture {
	t.Helper()
	state := templateCopyParent(t)
	if scratch := os.Getenv("EXAM_COLLECTION_TEST_ROOT"); scratch != "" {
		var err error
		state, err = os.MkdirTemp(scratch, "template-catalog-test-")
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			if err := os.RemoveAll(state); err != nil {
				t.Error(err)
			}
		})
	}
	sentinel := []byte(`{"attempts":{"preserved":{"start":123,"deadline":456,"access_state":"HELD","protected":true}}}`)
	if err := os.WriteFile(filepath.Join(state, "state.json"), sentinel, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(state, "submissions"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(state, "submissions", "protected"), []byte("PROTECTED-DO-NOT-ALTER"), 0600); err != nil {
		t.Fatal(err)
	}
	source := templateSourceFixture(t)
	m, err := inspectTemplateSource(source, sourceTestBounds(), nil)
	if err != nil {
		t.Fatal(err)
	}
	f := templateFixture{state, source, m.Hash, sentinel}
	t.Cleanup(func() {
		data, err := os.ReadFile(filepath.Join(state, "state.json"))
		if err != nil || !bytes.Equal(data, sentinel) {
			t.Error("template operation changed attempt authority", err)
		}
		data, err = os.ReadFile(filepath.Join(state, "submissions", "protected"))
		if err != nil || string(data) != "PROTECTED-DO-NOT-ALTER" {
			t.Error("template operation changed protected bytes", err)
		}
	})
	return f
}
func templateInstallCommand(f templateFixture) TemplateCommand {
	return TemplateCommand{Action: "install", Name: "midterm", Hash: f.hash, Source: f.source, Reason: "Reviewed synthetic source only", FileMiB: 1, TotalMiB: 2}
}
func templateRun(t *testing.T, f templateFixture, b TemplateCommand, id string) (TemplateResult, error) {
	t.Helper()
	if id == "" {
		id = ManagementID()
	}
	input, _ := json.Marshal(templateWorkerRequest{Schema: 1, Nonce: Token(), ID: id, State: f.state, Command: b})
	var output bytes.Buffer
	if err := runTemplateWorker(bytes.NewReader(input), &output, nil); err != nil {
		return TemplateResult{}, err
	}
	var reply templateWorkerReply
	if err := json.Unmarshal(output.Bytes(), &reply); err != nil {
		t.Fatal(err)
	}
	if reply.Error != "" {
		return TemplateResult{}, errors.New(reply.Error)
	}
	if reply.Result == nil {
		t.Fatal("missing template result")
	}
	if err := validateTemplateResult(b, *reply.Result, id); err != nil {
		t.Fatal("worker produced invalid scope", err, string(output.Bytes()))
	}
	return *reply.Result, nil
}

func TestTemplateCatalogInstallInspectVerifyAndExactRetryPreserveAllAuthority(t *testing.T) {
	f := templateCatalogFixture(t)
	b := templateInstallCommand(f)
	id := ManagementID()
	validation, err := templateRun(t, f, TemplateCommand{Action: "validate", Source: f.source, FileMiB: 1, TotalMiB: 2}, "")
	if err != nil {
		t.Fatal(err)
	}
	if validation.Info.Hash != f.hash || validation.Installed || validation.GatewayConfirmed {
		t.Fatal("source fingerprint was called installed/confirmed")
	}
	installed, err := templateRun(t, f, b, id)
	if err != nil {
		t.Fatal(err)
	}
	if !installed.Verified || !installed.Installed || installed.GatewayConfirmed || installed.Job != id {
		t.Fatal("incorrect installation result", installed)
	}
	copyPath := filepath.Join(f.state, "template-catalog", "versions", b.Name, b.Hash, "content", "work", "main.c")
	if data, err := os.ReadFile(copyPath); err != nil || string(data) != "starter bytes\n" {
		t.Fatal("wrong installed bytes", err)
	}
	if err := os.WriteFile(filepath.Join(f.source, "work", "main.c"), []byte("author changed after install"), 0644); err != nil {
		t.Fatal(err)
	}
	b.Source = filepath.Join(t.TempDir(), "source-no-longer-needed")
	retried, err := templateRun(t, f, b, id)
	if err != nil {
		t.Fatal("exact retry recollected mutable source", err)
	}
	if !reflect.DeepEqual(installed.Info, retried.Info) {
		t.Fatal("retry changed installed metadata", installed.Info, retried.Info)
	}
	for _, op := range []string{"show", "verify"} {
		v, err := templateRun(t, f, TemplateCommand{Action: op, Name: b.Name, Hash: b.Hash}, "")
		if err != nil {
			t.Fatal(err)
		}
		if v.Verified != (op == "verify") {
			t.Fatal("show falsely claimed hashing")
		}
	}
	list, err := templateRun(t, f, TemplateCommand{Action: "list", Limit: 1}, "")
	if err != nil || len(list.Versions) != 1 || list.Next != "" {
		t.Fatal("catalog list mismatch", list, err)
	}
	jobs, err := templateRun(t, f, TemplateCommand{Action: "jobs", Limit: 5}, "")
	if err != nil || len(jobs.Jobs) != 1 || jobs.Jobs[0].Status != "published" {
		t.Fatal("missing durable job", err)
	}
	raw, _ := json.Marshal(jobs)
	if strings.Contains(string(raw), b.Reason) || strings.Contains(string(raw), f.source) {
		t.Fatal("inventory retained authored path/reason payload")
	}
	b.Reason = "Different deliberate intent"
	if _, err := templateRun(t, f, b, id); err == nil || !strings.Contains(err.Error(), "conflicts") {
		t.Fatal("same request changed arguments", err)
	}
}

func TestTemplateCatalogChangedSourceCreatesDistinctVersionAndPagesByExactKey(t *testing.T) {
	f := templateCatalogFixture(t)
	b := templateInstallCommand(f)
	if _, err := templateRun(t, f, b, ""); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(f.source, "work", "main.c"), []byte("new source bytes"), 0644); err != nil {
		t.Fatal(err)
	}
	// Already published exact versions are verified, never recopied from the
	// authoring tree. A still-uninstalled target must reject the changed source.
	if _, err := templateRun(t, f, b, ""); err != nil {
		t.Fatal("existing immutable version depended on mutable source", err)
	}
	uninstalled := b
	uninstalled.Name = "not-installed"
	if _, err := templateRun(t, f, uninstalled, ""); err == nil || !strings.Contains(err.Error(), "source changed") {
		t.Fatal("changed source accepted for an unpublished version", err)
	}
	m, err := inspectTemplateSource(f.source, sourceTestBounds(), nil)
	if err != nil {
		t.Fatal(err)
	}
	b.Hash = m.Hash
	if _, err := templateRun(t, f, b, ""); err != nil {
		t.Fatal(err)
	}
	page, err := templateRun(t, f, TemplateCommand{Action: "list", Name: b.Name, Limit: 1}, "")
	if err != nil || len(page.Versions) != 1 || page.Next == "" {
		t.Fatal("first version page", page, err)
	}
	next, err := templateRun(t, f, TemplateCommand{Action: "list", Name: b.Name, Limit: 1, After: page.Next}, "")
	if err != nil || len(next.Versions) != 1 || next.Next != "" || next.Versions[0].Hash == page.Versions[0].Hash {
		t.Fatal("second version page", next, err)
	}
	for _, hash := range []string{f.hash, m.Hash} {
		if _, err := templateRun(t, f, TemplateCommand{Action: "verify", Name: b.Name, Hash: hash}, ""); err != nil {
			t.Fatal("older version not preserved", err)
		}
	}
}

func TestTemplateCatalogPublishedExactVersionCannotBypassRequestedLogicalLimits(t *testing.T) {
	f := templateCatalogFixture(t)
	if err := os.WriteFile(filepath.Join(f.source, "work", "larger"), make([]byte, mib+1), 0644); err != nil {
		t.Fatal(err)
	}
	m, err := inspectTemplateSource(f.source, collectionBounds{File: 2 * mib, Total: 3 * mib}, nil)
	if err != nil {
		t.Fatal(err)
	}
	b := templateInstallCommand(f)
	b.Hash = m.Hash
	b.FileMiB = 2
	b.TotalMiB = 3
	if _, err := templateRun(t, f, b, ""); err != nil {
		t.Fatal(err)
	}
	b.FileMiB = 1
	if _, err := templateRun(t, f, b, ""); err == nil || !strings.Contains(err.Error(), "declared logical limits") {
		t.Fatal("existing version bypassed requested limits", err)
	}
	if _, err := templateRun(t, f, TemplateCommand{Action: "verify", Name: b.Name, Hash: b.Hash}, ""); err != nil {
		t.Fatal("budget refusal changed installed version", err)
	}
}

func TestTemplateCatalogDoesNotReplaceCorruptVersionOrFollowMetadataParents(t *testing.T) {
	f := templateCatalogFixture(t)
	b := templateInstallCommand(f)
	id := ManagementID()
	if _, err := templateRun(t, f, b, id); err != nil {
		t.Fatal(err)
	}
	base := filepath.Join(f.state, "template-catalog", "versions", b.Name, b.Hash)
	if err := os.WriteFile(filepath.Join(base, "content", "work", "main.c"), []byte("corrupt installed bytes"), 0644); err != nil {
		t.Fatal(err)
	}
	if _, err := templateRun(t, f, b, id); err == nil {
		t.Fatal("replaced/adopted corrupted version")
	}
	if data, _ := os.ReadFile(filepath.Join(base, "content", "work", "main.c")); string(data) != "corrupt installed bytes" {
		t.Fatal("silently repaired published bytes")
	}
	meta := filepath.Join(base, "version.json")
	if err := os.Remove(meta); err != nil {
		t.Fatal(err)
	}
	if _, err := templateRun(t, f, b, ""); err == nil {
		t.Fatal("recreated missing installed metadata")
	}
	name := filepath.Dir(base)
	if err := os.Rename(name, name+"-preserved"); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(name+"-preserved", name); err != nil {
		t.Fatal(err)
	}
	if _, err := templateRun(t, f, TemplateCommand{Action: "show", Name: b.Name, Hash: b.Hash}, ""); err == nil {
		t.Fatal("followed catalog parent symlink")
	}
}

func TestTemplateCatalogCrashBoundariesRequireVerifiedAdoptionOrExplicitStagingCleanup(t *testing.T) {
	for _, phase := range []string{"before-publish", "published"} {
		t.Run(phase, func(t *testing.T) {
			f := templateCatalogFixture(t)
			b := templateInstallCommand(f)
			id := ManagementID()
			c, err := openTemplateCatalog(f.state, true)
			if err != nil {
				t.Fatal(err)
			}
			hit := false
			_, err = c.install(b, id, func(at string) error {
				if at == phase {
					hit = true
					return errors.New("synthetic coordinator interruption")
				}
				return nil
			})
			c.close()
			if err == nil || !hit {
				t.Fatal("publication barrier not injected")
			}
			if phase == "published" {
				if err := os.WriteFile(filepath.Join(f.source, "work", "main.c"), []byte("changed after publication"), 0644); err != nil {
					t.Fatal(err)
				}
				if _, err := templateRun(t, f, b, id); err != nil {
					t.Fatal("published retry recopied", err)
				}
			} else {
				if _, err := templateRun(t, f, b, id); err == nil || !strings.Contains(err.Error(), "incomplete private staging") {
					t.Fatal("partial staging adopted", err)
				}
			}
			if _, err := templateRun(t, f, TemplateCommand{Action: "clean", Job: id, Reason: "Remove exact synthetic staging"}, ""); err != nil {
				t.Fatal(err)
			}
			if _, err := templateRun(t, f, TemplateCommand{Action: "clean", Job: id, Reason: "Repeat exact synthetic cleanup"}, ""); err != nil {
				t.Fatal("cleanup not retry safe", err)
			}
			if _, err := os.Stat(filepath.Join(f.state, "template-catalog", "jobs", id, "job.json")); err != nil {
				t.Fatal("cleanup removed job receipt")
			}
			if phase == "published" {
				if _, err := templateRun(t, f, b, id); err != nil {
					t.Fatal("cleanup destroyed published receipt", err)
				}
			} else {
				if _, err := templateRun(t, f, b, id); err == nil {
					t.Fatal("cleaned incomplete job reused")
				}
				if _, err := templateRun(t, f, b, ""); err != nil {
					t.Fatal("new deliberate import failed", err)
				}
			}
		})
	}
}

func TestTemplateCatalogMetadataReadsStayAvailableWhileBulkSlotIsOwned(t *testing.T) {
	f := templateCatalogFixture(t)
	c, err := openTemplateCatalog(f.state, true)
	if err != nil {
		t.Fatal(err)
	}
	defer c.close()
	if _, err := openTemplateCatalog(f.state, true); err == nil {
		t.Fatal("overlapping bulk worker acquired slot")
	}
	result, err := templateRun(t, f, TemplateCommand{Action: "jobs", Limit: 50}, "")
	if err != nil || len(result.Jobs) != 0 {
		t.Fatal("bulk slot blocked metadata read", err)
	}
}
