package core

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"syscall"
)

// Existing-only reader: no mkdir, job creation, audit writes, state load/save or
// inference of a latest version. The catalog has no supported version mutation
// or deletion API. Only its root-private immutable publication paths may bind.
func readTemplateCatalog(state string) (*templateCatalog, error) {
	if !filepath.IsAbs(state) || filepath.Clean(state) != state || state == "/" {
		return nil, errors.New("exact template requires clean absolute private native state")
	}
	parent, err := templatePrivateDirectory(state)
	if err != nil {
		return nil, err
	}
	defer parent.Close()
	f, err := templatePrivateDirectory(fmt.Sprintf("/proc/self/fd/%d/template-catalog", parent.Fd()))
	if err != nil {
		return nil, err
	}
	c := &templateCatalog{file: f}
	c.root, err = templatePinnedRoot(f)
	if err == nil {
		c.versions, err = templatePrivateDirectory(fmt.Sprintf("/proc/self/fd/%d/versions", f.Fd()))
	}
	if err != nil {
		c.close()
		return nil, err
	}
	return c, nil
}

func validTemplateBinding(s Settings) bool {
	return identifier.MatchString(s.Template) && (s.TemplateVersion == "" || templateDigest.MatchString(s.TemplateVersion))
}

// verify=false reads only bounded metadata and pinned directory identities for
// PTY/state transactions. verify=true is exclusively for a bounded staging
// worker, never a state transaction or PTY-owning process. Pre-Begin verification
// uses the separate template worker rather than calling this with true in-agent.
func templateContent(c Config, s Settings, verify bool) (string, error) {
	if !validTemplateBinding(s) {
		return "", errors.New("invalid exact template name/version; inspect the grant/settings, never use latest or a mutable fallback")
	}
	if s.TemplateVersion == "" {
		return filepath.Join(c.Templates, s.Template), nil
	}
	cat, err := readTemplateCatalog(c.State)
	if err != nil {
		return "", fmt.Errorf("recorded template catalog unavailable; preserve attempt and use examctl templates list/show/verify: %w", err)
	}
	defer cat.close()
	if _, err := cat.version(s.Template, s.TemplateVersion, verify); err != nil {
		return "", err
	}
	fd, err := cat.versionDirectory(s.Template, s.TemplateVersion)
	if err != nil {
		return "", err
	}
	defer fd.Close()
	content, err := templatePrivateDirectory(fmt.Sprintf("/proc/self/fd/%d/content", fd.Fd()))
	if err != nil {
		return "", fmt.Errorf("recorded template content unavailable; no legacy fallback: %w", err)
	}
	content.Close()
	return filepath.Join(c.State, "template-catalog", "versions", s.Template, s.TemplateVersion, "content"), nil
}

func templateMaterials(c Config, s Settings) (string, error) {
	content, err := templateContent(c, s, false)
	if err != nil {
		return "", err
	}
	path := filepath.Join(content, "materials")
	if s.TemplateVersion != "" {
		// Missing/redirected explicit materials is a release error, not an
		// optional missing welcome. Practice never calls this resolver.
		f, err := os.OpenFile(path, os.O_RDONLY|syscall.O_DIRECTORY|syscall.O_NOFOLLOW|syscall.O_NONBLOCK, 0)
		if err != nil {
			return "", fmt.Errorf("recorded template materials unavailable; use examctl templates verify NAME HASH, never fall back: %w", err)
		}
		info, err := f.Stat()
		f.Close()
		if err != nil || !info.IsDir() || info.Mode().Perm()&0005 != 0005 || info.Sys().(*syscall.Stat_t).Uid != uint32(os.Geteuid()) {
			return "", errors.New("recorded materials directory is unsafe; preserve the version and inspect templates verify")
		}
	}
	return path, nil
}
