package core

// Native immutable catalog. It has its own lock/worker namespace and never
// loads or saves attempt state. Readers use only explicitly version-bound
// snapshots; legacy rows are never upgraded implicitly. No version delete API.
import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"syscall"
	"unicode/utf8"

	"golang.org/x/sys/unix"
)

var templateDigest = regexp.MustCompile(`^[a-f0-9]{64}$`)
var templateCursor = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}@[a-f0-9]{64}$`)

type TemplateCommand struct {
	Action   string `json:"action"`
	Name     string `json:"name,omitempty"`
	Hash     string `json:"hash,omitempty"`
	Source   string `json:"source,omitempty"`
	Job      string `json:"job,omitempty"`
	Reason   string `json:"reason,omitempty"`
	After    string `json:"after,omitempty"`
	Limit    int    `json:"limit,omitempty"`
	FileMiB  int64  `json:"file_mib,omitempty"`
	TotalMiB int64  `json:"total_mib,omitempty"`
}

type TemplateVersion struct {
	Schema       int    `json:"schema"`
	Name         string `json:"name"`
	Hash         string `json:"hash"`
	Entries      int    `json:"entries"`
	Files        int    `json:"files"`
	Bytes        int64  `json:"bytes"`
	MaxFileBytes int64  `json:"max_file_bytes"`
	Created      int64  `json:"created"`
}
type TemplateJob struct {
	Schema         int    `json:"schema"`
	ID             string `json:"id"`
	Fingerprint    string `json:"fingerprint"`
	Name           string `json:"name"`
	Hash           string `json:"hash"`
	Reason         string `json:"reason"`
	Created        int64  `json:"created"`
	Updated        int64  `json:"updated"`
	Status         string `json:"status"`
	StagingCleaned int64  `json:"staging_cleaned,omitempty"`
}
type TemplateResult struct {
	Action           string            `json:"action"`
	Job              string            `json:"job,omitempty"`
	Info             *TemplateVersion  `json:"info,omitempty"`
	Versions         []TemplateVersion `json:"versions,omitempty"`
	Jobs             []TemplateJobView `json:"jobs,omitempty"`
	Next             string            `json:"next,omitempty"`
	Verified         bool              `json:"verified"`
	Installed        bool              `json:"installed"`
	GatewayConfirmed bool              `json:"gateway_confirmed"`
	Observed         int64             `json:"observed"`
	Note             string            `json:"note"`
}
type TemplateJobView struct {
	ID             string `json:"id"`
	Name           string `json:"name"`
	Hash           string `json:"hash"`
	Status         string `json:"status"`
	Created        int64  `json:"created"`
	Updated        int64  `json:"updated"`
	StagingCleaned int64  `json:"staging_cleaned,omitempty"`
}

func (b TemplateCommand) validate() error {
	bad := func() error { return errors.New("invalid template workflow/arguments; use examctl templates help") }
	if b.Limit < 0 || b.Limit > 200 {
		return bad()
	}
	read := b.Action == "list" || b.Action == "show" || b.Action == "verify" || b.Action == "jobs"
	if read && (b.Source != "" || b.Reason != "" || b.FileMiB != 0 || b.TotalMiB != 0 || b.Job != "") {
		return bad()
	}
	switch b.Action {
	case "list":
		if b.Hash != "" || (b.Name != "" && !identifier.MatchString(b.Name)) || (b.After != "" && !templateCursor.MatchString(b.After)) || b.Limit < 1 {
			return bad()
		}
	case "jobs":
		if b.Hash != "" || b.Name != "" || (b.After != "" && !attemptID.MatchString(b.After)) || b.Limit < 1 {
			return bad()
		}
	case "show", "verify":
		if !identifier.MatchString(b.Name) || !templateDigest.MatchString(b.Hash) || b.After != "" || b.Limit != 0 {
			return bad()
		}
	case "validate", "install":
		if !filepath.IsAbs(b.Source) || filepath.Clean(b.Source) != b.Source || b.Source == "/" || b.After != "" || b.Limit != 0 || b.Job != "" || b.FileMiB < 1 || b.FileMiB > 4096 || b.TotalMiB < b.FileMiB || b.TotalMiB > 16384 {
			return bad()
		}
		if b.Action == "validate" {
			if b.Name != "" || b.Hash != "" || b.Reason != "" {
				return bad()
			}
		} else if !identifier.MatchString(b.Name) || !templateDigest.MatchString(b.Hash) || !templateReason(b.Reason) {
			return bad()
		}
	case "clean":
		if !attemptID.MatchString(b.Job) || b.Name != "" || b.Hash != "" || b.Source != "" || b.After != "" || b.Limit != 0 || b.FileMiB != 0 || b.TotalMiB != 0 || !templateReason(b.Reason) {
			return bad()
		}
	default:
		return bad()
	}
	return nil
}

func templateReason(s string) bool {
	return utf8.ValidString(s) && len(strings.TrimSpace(s)) >= 8 && len(s) <= 1000
}

type templateCatalog struct {
	file     *os.File
	root     *os.Root
	lock     *os.File
	versions *os.File
	jobs     *os.File
}

func templatePrivateDirectory(path string) (*os.File, error) {
	f, err := os.OpenFile(path, os.O_RDONLY|syscall.O_DIRECTORY|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0)
	if err != nil {
		return nil, err
	}
	info, err := f.Stat()
	if err != nil || !info.IsDir() || info.Sys().(*syscall.Stat_t).Uid != uint32(os.Geteuid()) || info.Mode().Perm() != 0700 {
		f.Close()
		return nil, errors.New("template catalog directories must be owned and private (0700); preserve existing data and inspect configuration")
	}
	return f, nil
}
func templateEnsureDirectory(parent *os.File, name string) (*os.File, error) {
	r, err := templatePinnedRoot(parent)
	if err != nil {
		return nil, err
	}
	defer r.Close()
	if err := r.Mkdir(name, 0700); err != nil && !errors.Is(err, os.ErrExist) {
		return nil, err
	}
	f, err := templatePrivateDirectory(fmt.Sprintf("/proc/self/fd/%d/%s", parent.Fd(), name))
	if err != nil {
		return nil, err
	}
	if err := parent.Sync(); err != nil {
		f.Close()
		return nil, err
	}
	return f, nil
}
func openTemplateCatalog(state string, exclusive bool) (*templateCatalog, error) {
	if !filepath.IsAbs(state) || filepath.Clean(state) != state || state == "/" {
		return nil, errors.New("template catalog requires the configured clean absolute private native state directory")
	}
	parent, err := templatePrivateDirectory(state)
	if err != nil {
		return nil, fmt.Errorf("inspect native state before template management: %w", err)
	}
	defer parent.Close()
	f, err := templateEnsureDirectory(parent, "template-catalog")
	if err != nil {
		return nil, err
	}
	r, err := templatePinnedRoot(f)
	if err != nil {
		f.Close()
		return nil, err
	}
	c := &templateCatalog{file: f, root: r}
	for _, name := range []string{"versions", "jobs"} {
		dir, err := templateEnsureDirectory(f, name)
		if err != nil {
			c.close()
			return nil, err
		}
		if name == "versions" {
			c.versions = dir
		} else {
			c.jobs = dir
		}
	}
	// Atomic metadata readers stay available while a bulk worker owns its slot.
	if !exclusive {
		return c, nil
	}
	lock, err := r.OpenFile("worker.lock", os.O_CREATE|os.O_RDWR|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0600)
	if err != nil {
		c.close()
		return nil, err
	}
	info, err := lock.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm() != 0600 || info.Sys().(*syscall.Stat_t).Uid != uint32(os.Geteuid()) || info.Sys().(*syscall.Stat_t).Nlink != 1 {
		lock.Close()
		c.close()
		return nil, errors.New("unsafe template worker lock; preserve its inode and inspect private ownership/permissions")
	}
	if err := syscall.Flock(int(lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		lock.Close()
		c.close()
		return nil, errors.New("template worker busy; inspect examctl templates jobs and retry after the existing worker exits; collection and exam clocks are independent")
	}
	c.lock = lock
	return c, nil
}
func (c *templateCatalog) close() {
	if c.lock != nil {
		c.lock.Close()
	}
	if c.root != nil {
		c.root.Close()
	}
	if c.versions != nil {
		c.versions.Close()
	}
	if c.jobs != nil {
		c.jobs.Close()
	}
	if c.file != nil {
		c.file.Close()
	}
}
func templateReadJSON(root *os.Root, name string, target any) error {
	f, err := root.OpenFile(name, os.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0)
	if err != nil {
		return err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm() != 0600 || info.Size() < 2 || info.Size() > 8192 || info.Sys().(*syscall.Stat_t).Uid != uint32(os.Geteuid()) || info.Sys().(*syscall.Stat_t).Nlink != 1 {
		return errors.New("unsafe template metadata; preserve the catalog and inspect private storage")
	}
	return decodeWorkerFrame(f, 8192, target)
}
func templateWriteJSON(parent *os.File, name string, value any) error {
	r, err := templatePinnedRoot(parent)
	if err != nil {
		return err
	}
	defer r.Close()
	data, err := json.Marshal(value)
	if err != nil || len(data) > 8192 {
		return errors.New("template metadata exceeds its bound")
	}
	temp := ".metadata-" + Token()
	f, err := r.OpenFile(temp, os.O_CREATE|os.O_EXCL|os.O_WRONLY|syscall.O_NOFOLLOW, 0600)
	if err != nil {
		return err
	}
	defer func() { f.Close(); _ = r.Remove(temp) }()
	if n, err := f.Write(data); err != nil {
		return err
	} else if n != len(data) {
		return io.ErrShortWrite
	}
	if err := f.Sync(); err != nil {
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	if err := r.Rename(temp, name); err != nil {
		return err
	}
	return parent.Sync()
}
func (c *templateCatalog) audit(action, request string, body TemplateCommand) error {
	f, err := c.root.OpenFile("audit.ndjson", os.O_CREATE|os.O_APPEND|os.O_WRONLY|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0600)
	if err != nil {
		return err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm() != 0600 || info.Sys().(*syscall.Stat_t).Uid != uint32(os.Geteuid()) || info.Sys().(*syscall.Stat_t).Nlink != 1 {
		return errors.New("unsafe template audit; preserve catalog and repair private storage before retrying")
	}
	// Metadata workers do not own the bulk flock. Serialize whole audit writes
	// on this persistent inode without waiting behind a stalled bulk operation.
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		return errors.New("template audit busy; retry after the other metadata operation finishes; no receipt or result is assumed")
	}
	// Never persist authored paths, inventories, question text or file bytes.
	data, err := json.Marshal(map[string]any{"at": Millis(), "actor": "root", "action": action, "request": request, "name": body.Name, "hash": body.Hash, "job": body.Job, "reason": body.Reason})
	if err != nil {
		return err
	}
	// A failed/short append may have left a partial tail. Keep it as evidence;
	// start a new line so later complete records never join that damaged tail.
	data = append(append([]byte{'\n'}, data...), '\n')
	if n, err := f.Write(data); err != nil {
		return err
	} else if n != len(data) {
		return io.ErrShortWrite
	}
	if err := f.Sync(); err != nil {
		return err
	}
	return c.file.Sync()
}
func templateSummary(name string, m *templateSourceManifest) TemplateVersion {
	v := TemplateVersion{Schema: 1, Name: name, Hash: m.Hash, Entries: len(m.Entries), Files: m.Files, Bytes: m.TotalBytes, Created: Millis()}
	for _, entry := range m.Entries {
		if entry.Size > v.MaxFileBytes {
			v.MaxFileBytes = entry.Size
		}
	}
	return v
}
func validTemplateVersion(v TemplateVersion, name, hash string) bool {
	return v.Schema == 1 && v.Name == name && v.Hash == hash && identifier.MatchString(name) && templateDigest.MatchString(hash) && v.Entries >= 2 && v.Entries <= 20002 && v.Files >= 0 && v.Files <= v.Entries-2 && v.Files <= 20000 && v.Bytes >= 0 && v.Bytes <= 16384*mib && v.MaxFileBytes >= 0 && v.MaxFileBytes <= 4096*mib && v.MaxFileBytes <= v.Bytes && v.Bytes <= v.MaxFileBytes*int64(v.Files) && v.Created > 0
}
func (c *templateCatalog) version(name, hash string, verify bool) (*TemplateVersion, error) {
	fd, err := c.versionDirectory(name, hash)
	if err != nil {
		return nil, err
	}
	defer fd.Close()
	r, err := templatePinnedRoot(fd)
	if err != nil {
		return nil, err
	}
	defer r.Close()
	var v TemplateVersion
	if err := templateReadJSON(r, "version.json", &v); err != nil {
		return nil, fmt.Errorf("installed version metadata unavailable; preserve it, never overwrite or fall back: %v", err)
	}
	if !validTemplateVersion(v, name, hash) {
		return nil, errors.New("template version metadata scope/bounds mismatch; preserve the installed version")
	}
	if verify {
		limits := collectionBounds{File: max(1, v.MaxFileBytes), Total: max(1, v.Bytes)}
		actual, err := inspectTemplateSource(fmt.Sprintf("/proc/self/fd/%d/content", fd.Fd()), limits, nil)
		if err != nil {
			return nil, fmt.Errorf("installed template integrity unavailable; preserve version and grants: %v", err)
		}
		m := templateSummary(name, actual)
		if m.Hash != v.Hash || m.Files != v.Files || m.Bytes != v.Bytes || m.MaxFileBytes != v.MaxFileBytes || m.Entries != v.Entries {
			return nil, errors.New("installed template integrity mismatch; preserve version and affected grants, never fall back to mutable source")
		}
	}
	return &v, nil
}

func (c *templateCatalog) versionDirectory(name, hash string) (*os.File, error) {
	if !identifier.MatchString(name) || !templateDigest.MatchString(hash) {
		return nil, errors.New("invalid exact template version")
	}
	named, err := templatePrivateDirectory(fmt.Sprintf("/proc/self/fd/%d/%s", c.versions.Fd(), name))
	if err != nil {
		return nil, err
	}
	defer named.Close()
	fd, err := templatePrivateDirectory(fmt.Sprintf("/proc/self/fd/%d/%s", named.Fd(), hash))
	if err != nil {
		return nil, fmt.Errorf("template version unavailable; use examctl templates list, then show/verify NAME HASH: %w", err)
	}
	return fd, nil
}

// Stream directory names in fixed batches; keep only the next bounded page.
// Pages are live metadata, not a consistent all-versions export.
func templateNames(parent *os.File, visit func(string) error) error {
	root, err := templatePinnedRoot(parent)
	if err != nil {
		return err
	}
	defer root.Close()
	f, err := root.OpenFile(".", os.O_RDONLY|syscall.O_DIRECTORY|syscall.O_NOFOLLOW, 0)
	if err != nil {
		return err
	}
	defer f.Close()
	for {
		entries, err := f.ReadDir(64)
		if err != nil && err != io.EOF {
			return err
		}
		for _, e := range entries {
			if !e.IsDir() || e.Type()&os.ModeSymlink != 0 {
				return errors.New("unexpected catalog directory entry; preserve and inspect private metadata")
			}
			if err := visit(e.Name()); err != nil {
				return err
			}
		}
		if err == io.EOF {
			return nil
		}
	}
}
func templateSelect(keys []string, key string, limit int) []string {
	i := sort.SearchStrings(keys, key)
	if i < len(keys) && keys[i] == key {
		return keys
	}
	keys = append(keys, "")
	copy(keys[i+1:], keys[i:])
	keys[i] = key
	if len(keys) > limit {
		keys = keys[:limit]
	}
	return keys
}
func (c *templateCatalog) list(b TemplateCommand) (TemplateResult, error) {
	result := TemplateResult{Action: b.Action, Observed: Millis(), Note: "Live metadata only, not fresh integrity verification, gateway confirmation or complete export. Use verify NAME HASH; never select latest implicitly"}
	keys := []string{}
	if b.Action == "jobs" {
		err := templateNames(c.jobs, func(id string) error {
			if !attemptID.MatchString(id) {
				return errors.New("unknown catalog job entry; preserve it")
			}
			if id > b.After {
				keys = templateSelect(keys, id, b.Limit+1)
			}
			return nil
		})
		if err != nil {
			return result, err
		}
		if len(keys) > b.Limit {
			result.Next = keys[b.Limit-1]
			keys = keys[:b.Limit]
		}
		for _, id := range keys {
			var job TemplateJob
			if err := c.readJob(id, &job); errors.Is(err, os.ErrNotExist) {
				// A worker can die between creating its private directory and
				// publishing its first intent. Do not invent original settings.
				result.Jobs = append(result.Jobs, TemplateJobView{ID: id, Status: "unrecorded"})
				continue
			} else if err != nil {
				return result, err
			}
			if !validTemplateJob(job, id) && !validUnrecordedTemplateJob(job, id) {
				return result, errors.New("malformed catalog job; preserve it")
			}
			result.Jobs = append(result.Jobs, TemplateJobView{ID: job.ID, Name: job.Name, Hash: job.Hash, Status: job.Status, Created: job.Created, Updated: job.Updated, StagingCleaned: job.StagingCleaned})
		}
		return result, nil
	}
	err := templateNames(c.versions, func(name string) error {
		if !identifier.MatchString(name) {
			return errors.New("invalid installed template name")
		}
		if b.Name != "" && b.Name != name {
			return nil
		}
		named, err := templatePrivateDirectory(fmt.Sprintf("/proc/self/fd/%d/%s", c.versions.Fd(), name))
		if err != nil {
			return err
		}
		defer named.Close()
		return templateNames(named, func(hash string) error {
			if !templateDigest.MatchString(hash) {
				return errors.New("invalid installed template version")
			}
			key := name + "@" + hash
			if key > b.After {
				keys = templateSelect(keys, key, b.Limit+1)
			}
			return nil
		})
	})
	if err != nil {
		return result, err
	}
	if len(keys) > b.Limit {
		result.Next = keys[b.Limit-1]
		keys = keys[:b.Limit]
	}
	for _, key := range keys {
		name, hash, _ := strings.Cut(key, "@")
		v, err := c.version(name, hash, false)
		if err != nil {
			return result, err
		}
		result.Versions = append(result.Versions, *v)
	}
	return result, nil
}

func validTemplateJob(j TemplateJob, id string) bool {
	return j.Schema == 1 && j.ID == id && attemptID.MatchString(id) && identifier.MatchString(j.Name) && templateDigest.MatchString(j.Hash) && templateDigest.MatchString(j.Fingerprint) && templateReason(j.Reason) && j.Created > 0 && j.Updated >= j.Created && j.StagingCleaned >= 0 && (j.Status == "pending" || j.Status == "published" || j.Status == "cleaned")
}
func validUnrecordedTemplateJob(j TemplateJob, id string) bool {
	return j.Schema == 1 && j.ID == id && attemptID.MatchString(id) && j.Status == "unrecorded-cleaned" && j.Fingerprint == "" && j.Name == "" && j.Hash == "" && j.Created == 0 && j.Updated > 0 && j.StagingCleaned == j.Updated && templateReason(j.Reason)
}
func (c *templateCatalog) readJob(id string, job *TemplateJob) error {
	if !attemptID.MatchString(id) {
		return errors.New("invalid template job ID")
	}
	f, err := templatePrivateDirectory(fmt.Sprintf("/proc/self/fd/%d/%s", c.jobs.Fd(), id))
	if err != nil {
		return err
	}
	defer f.Close()
	r, err := templatePinnedRoot(f)
	if err != nil {
		return err
	}
	defer r.Close()
	return templateReadJSON(r, "job.json", job)
}
func (c *templateCatalog) install(b TemplateCommand, id string, checkpoint func(string) error) (TemplateResult, error) {
	result := TemplateResult{Action: b.Action, Job: id, Observed: Millis(), Note: "Verified immutable local version only; NOT proof of gateway confirmation. This operation does not select/change any grant or attempt. No legacy source or student state changed"}
	encoded, _ := json.Marshal(struct {
		Name, Hash, Reason string
		File, Total        int64
	}{b.Name, b.Hash, b.Reason, b.FileMiB, b.TotalMiB})
	fingerprint := Hash(encoded)
	jobsRoot, err := templatePinnedRoot(c.jobs)
	if err != nil {
		return result, err
	}
	defer jobsRoot.Close()
	fresh := true
	if err := jobsRoot.Mkdir(id, 0700); errors.Is(err, os.ErrExist) {
		fresh = false
	} else if err != nil {
		return result, err
	}
	jobdir, err := templatePrivateDirectory(fmt.Sprintf("/proc/self/fd/%d/%s", c.jobs.Fd(), id))
	if err != nil {
		return result, err
	}
	defer jobdir.Close()
	if err := c.jobs.Sync(); err != nil {
		return result, err
	}
	if fresh && checkpoint != nil {
		if err := checkpoint("job-created"); err != nil {
			return result, err
		}
	}
	jr, err := templatePinnedRoot(jobdir)
	if err != nil {
		return result, err
	}
	defer jr.Close()
	var job TemplateJob
	err = templateReadJSON(jr, "job.json", &job)
	if errors.Is(err, os.ErrNotExist) && fresh {
		job = TemplateJob{Schema: 1, ID: id, Fingerprint: fingerprint, Name: b.Name, Hash: b.Hash, Reason: b.Reason, Created: Millis(), Status: "pending"}
		job.Updated = job.Created
		if err := templateWriteJSON(jobdir, "job.json", job); err != nil {
			return result, err
		}
	} else if errors.Is(err, os.ErrNotExist) {
		return result, errors.New("unrecorded install directory retained after interruption; inspect templates jobs, explicitly clean JOB --confirm JOB --reason TEXT, and use a NEW --request; never infer its original intent")
	} else if err != nil {
		return result, err
	}
	if !validTemplateJob(job, id) || job.Fingerprint != fingerprint {
		return result, errors.New("template request conflicts with retained job; inspect templates jobs and deliberately use a NEW --request for different arguments")
	}
	if job.Status == "cleaned" {
		return result, errors.New("this install job was explicitly cleaned; inspect the catalog and use a NEW --request for a fresh install")
	}
	if err := c.audit("install-intent", id, b); err != nil {
		return result, err
	}
	// Retrying a published version always verifies it, never recollects or overwrites.
	if v, err := c.version(b.Name, b.Hash, true); err == nil {
		if v.MaxFileBytes > b.FileMiB*mib || v.Bytes > b.TotalMiB*mib {
			return result, errors.New("installed exact version exceeds this request's declared logical limits; preserve it, inspect templates show/verify and deliberately use appropriate limits with a NEW --request")
		}
		job.Status = "published"
		job.Updated = Millis()
		if err := templateWriteJSON(jobdir, "job.json", job); err != nil {
			return result, err
		}
		if err := c.audit("install-verified", id, b); err != nil {
			return result, err
		}
		result.Info = v
		result.Verified = true
		result.Installed = true
		return result, nil
	} else if job.Status == "published" || !errors.Is(err, os.ErrNotExist) {
		return result, err
	}
	if _, err := jr.Lstat("publish"); err == nil {
		return result, errors.New("incomplete private staging exists; inspect templates jobs, then explicitly clean JOB --confirm JOB --reason TEXT and retry with a NEW --request; no version was replaced")
	} else if !errors.Is(err, os.ErrNotExist) {
		return result, err
	}
	// Validate expected identity before copying; the copier also verifies its OWN
	// bytes and reinspects the source before any version can be published.
	limits := collectionBounds{File: b.FileMiB * mib, Total: b.TotalMiB * mib}
	m, err := inspectTemplateSource(b.Source, limits, nil)
	if err != nil {
		return result, err
	}
	if m.Hash != b.Hash {
		return result, errors.New("source changed since review; run templates validate SOURCE again, review its hash and deliberately issue a new install request")
	}
	pub, err := templateEnsureDirectory(jobdir, "publish")
	if err != nil {
		return result, err
	}
	defer pub.Close()
	// The copy helper intentionally refuses a symlink as its final parent.
	// Traverse our pinned JOB descriptor to the real publish directory, not a
	// bare /proc/self/fd/PUBLISH symlink as that parent.
	publishPath := fmt.Sprintf("/proc/self/fd/%d/publish", jobdir.Fd())
	stage := publishPath + "/content"
	m, err = copyTemplateSource(b.Source, stage, limits, nil)
	if err != nil {
		return result, err
	}
	if m.Hash != b.Hash {
		return result, errors.New("copied source differs from expected version; preserve unpublished staging")
	}
	v := templateSummary(b.Name, m)
	if err := templateWriteJSON(pub, "version.json", v); err != nil {
		return result, err
	}
	if err := syncSnapshotDirectories(publishPath); err != nil {
		return result, err
	}
	if checkpoint != nil {
		if err := checkpoint("before-publish"); err != nil {
			return result, err
		}
	}
	named, err := templateEnsureDirectory(c.versions, b.Name)
	if err != nil {
		return result, err
	}
	defer named.Close()
	if err := unix.Renameat2(int(jobdir.Fd()), "publish", int(named.Fd()), b.Hash, unix.RENAME_NOREPLACE); err != nil {
		return result, err
	}
	if err := named.Sync(); err != nil {
		return result, err
	}
	if err := jobdir.Sync(); err != nil {
		return result, err
	}
	if checkpoint != nil {
		if err := checkpoint("published"); err != nil {
			return result, err
		}
	}
	job.Status = "published"
	job.Updated = Millis()
	if err := templateWriteJSON(jobdir, "job.json", job); err != nil {
		return result, err
	}
	if err := c.audit("install-published", id, b); err != nil {
		return result, err
	}
	result.Info = &v
	result.Verified = true
	result.Installed = true
	return result, nil
}

func (c *templateCatalog) clean(b TemplateCommand, id string) (TemplateResult, error) {
	result := TemplateResult{Action: "clean", Job: b.Job, Observed: Millis(), Note: "Only this job's unpublished staging removed; job/audit receipt retained. Installed versions, legacy templates, attempts, workspaces and submissions are unchanged"}
	jobdir, err := templatePrivateDirectory(fmt.Sprintf("/proc/self/fd/%d/%s", c.jobs.Fd(), b.Job))
	if err != nil {
		return result, err
	}
	defer jobdir.Close()
	r, err := templatePinnedRoot(jobdir)
	if err != nil {
		return result, err
	}
	defer r.Close()
	var job TemplateJob
	if err := templateReadJSON(r, "job.json", &job); errors.Is(err, os.ErrNotExist) {
		if err := c.cleanUnrecorded(jobdir, r, b, id); err != nil {
			return result, err
		}
		result.Note = "Unrecorded job had no published intent: only verified empty/private temporary metadata removed, cleanup tombstone retained. Original intent remains unknown. Use a NEW install --request; installed versions and student state unchanged"
		return result, nil
	} else if err != nil {
		return result, err
	}
	if validUnrecordedTemplateJob(job, b.Job) {
		result.Note = "Unrecorded-job cleanup already recorded; original intent remains unknown. Retained tombstone and all published/student data unchanged; use a NEW install --request"
		return result, nil
	}
	if !validTemplateJob(job, b.Job) {
		return result, errors.New("unsafe/unknown staging ownership; preserve it for diagnosis")
	}
	// A crash may publish the exact immutable version before recording success.
	// Verify/adopt that fact before labeling the staging job cleaned or deleting
	// a possible remaining copy; damaged installed versions must retain recovery.
	if _, err := c.version(job.Name, job.Hash, true); err == nil {
		job.Status = "published"
	} else if !errors.Is(err, os.ErrNotExist) {
		return result, err
	}
	if err := c.audit("clean-intent", id, b); err != nil {
		return result, err
	}
	// Whole worker-pool lock is held: no import can concurrently publish this
	// tree. No reader/grant is ever allowed to resolve a jobs/ path.
	stage, err := r.OpenFile("publish", os.O_RDONLY|syscall.O_DIRECTORY|syscall.O_NOFOLLOW, 0)
	if err == nil {
		mount, merr := templateMountID(stage)
		stage.Close()
		if merr != nil {
			return result, merr
		}
		parentMount, err := templateMountID(jobdir)
		if err != nil || parentMount != mount {
			return result, errors.New("staging root crosses a mount boundary; preserve it and inspect this exact job; no mounted tree will be cleaned")
		}
		count := 0
		if err := removeTemplateStage(r, "publish", mount, 0, &count); err != nil {
			return result, err
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return result, err
	}
	if job.Status != "published" {
		job.Status = "cleaned"
	}
	job.StagingCleaned = Millis()
	job.Updated = Millis()
	if err := templateWriteJSON(jobdir, "job.json", job); err != nil {
		return result, err
	}
	if err := c.audit("cleaned", id, b); err != nil {
		return result, err
	}
	return result, nil
}

// No recorded intent means no authorization to delete a work/materials tree.
// Only an empty directory or the bounded atomic metadata writer's private
// regular scratch leaves can be cleaned. Retain a tombstone, not invented
// installation settings. Unknown contents, mounts and links are diagnostic data.
func (c *templateCatalog) cleanUnrecorded(dir *os.File, root *os.Root, b TemplateCommand, id string) error {
	mount, err := templateMountID(dir)
	if err != nil {
		return err
	}
	entries, err := dir.ReadDir(65)
	if err != nil && err != io.EOF {
		return err
	}
	if len(entries) > 64 {
		return errors.New("unrecorded job exceeds private metadata bound; preserve it for diagnosis")
	}
	stamps := make(map[string]templateSourceStamp, len(entries))
	for _, e := range entries {
		if !strings.HasPrefix(e.Name(), ".metadata-") || !templateDigest.MatchString(strings.TrimPrefix(e.Name(), ".metadata-")) {
			return errors.New("unrecorded job contains unknown data; preserve it for diagnosis; cleanup never infers ownership of an unpublished content tree")
		}
		f, err := root.OpenFile(e.Name(), os.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0)
		if err != nil {
			return err
		}
		stamp, info, err := templateStamp(f, mount)
		f.Close()
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() || info.Mode().Perm() != 0600 || info.Size() > 8192 || info.Sys().(*syscall.Stat_t).Uid != uint32(os.Geteuid()) || info.Sys().(*syscall.Stat_t).Nlink != 1 {
			return errors.New("unsafe unrecorded-job metadata; preserve it for diagnosis")
		}
		stamps[e.Name()] = stamp
	}
	if err := c.audit("clean-unrecorded-intent", id, b); err != nil {
		return err
	}
	for name, stamp := range stamps {
		info, err := root.Lstat(name)
		if err != nil || info.Sys().(*syscall.Stat_t).Ino != stamp.Inode || uint64(info.Sys().(*syscall.Stat_t).Dev) != stamp.Device {
			return errors.New("unrecorded metadata identity changed; cleanup stopped")
		}
		if err := root.Remove(name); err != nil {
			return err
		}
	}
	now := Millis()
	job := TemplateJob{Schema: 1, ID: b.Job, Reason: b.Reason, Status: "unrecorded-cleaned", Updated: now, StagingCleaned: now}
	if err := templateWriteJSON(dir, "job.json", job); err != nil {
		return err
	}
	return c.audit("clean-unrecorded-recorded", id, b)
}
func removeTemplateStage(root *os.Root, name string, mount uint64, depth int, count *int) error {
	if depth > 36 || *count > 20010 {
		return errors.New("unexpected staging size/depth; preserve data and inspect the exact job")
	}
	f, err := root.OpenFile(name, os.O_RDONLY|syscall.O_DIRECTORY|syscall.O_NOFOLLOW, 0)
	if err != nil {
		return err
	}
	defer f.Close()
	stamp, info, err := templateStamp(f, mount)
	if err != nil {
		return err
	}
	if !info.IsDir() || info.Sys().(*syscall.Stat_t).Uid != uint32(os.Geteuid()) {
		return errors.New("unsafe staging directory owner")
	}
	r, err := templatePinnedRoot(f)
	if err != nil {
		return err
	}
	defer r.Close()
	for {
		entries, err := f.ReadDir(64)
		if err != nil && err != io.EOF {
			return err
		}
		for _, entry := range entries {
			*count++
			if *count > 20010 {
				return errors.New("unexpected staging entry count; cleanup stopped")
			}
			if entry.IsDir() {
				if err := removeTemplateStage(r, entry.Name(), mount, depth+1, count); err != nil {
					return err
				}
				continue
			}
			info, err := r.Lstat(entry.Name())
			if err != nil {
				return err
			}
			if info.Sys().(*syscall.Stat_t).Uid != uint32(os.Geteuid()) || (!info.Mode().IsRegular() && info.Mode()&os.ModeSymlink == 0) || (info.Mode().IsRegular() && info.Sys().(*syscall.Stat_t).Nlink != 1) {
				return errors.New("unexpected staging file/owner/link; cleanup stopped without following it")
			}
			// Opening regular files also detects same-device FILE bind mounts.
			if info.Mode().IsRegular() {
				leaf, err := r.OpenFile(entry.Name(), os.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0)
				if err != nil {
					return err
				}
				s, _, err := templateStamp(leaf, mount)
				leaf.Close()
				if err != nil {
					return err
				}
				if s.Inode != info.Sys().(*syscall.Stat_t).Ino {
					return errors.New("staging file changed")
				}
			}
			if err := r.Remove(entry.Name()); err != nil {
				return err
			}
		}
		if err == io.EOF {
			break
		}
	}
	current, err := root.Lstat(name)
	if err != nil {
		return err
	}
	if current.Sys().(*syscall.Stat_t).Ino != stamp.Inode || uint64(current.Sys().(*syscall.Stat_t).Dev) != stamp.Device {
		return errors.New("staging directory identity changed")
	}
	if err := f.Sync(); err != nil {
		return err
	}
	if err := root.Remove(name); err != nil {
		return err
	}
	return nil
}
