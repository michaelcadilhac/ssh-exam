package main

import (
	"errors"
	"flag"
	"regexp"
)

// Real callers: additional-preview and explicit unused-grant revision.
type grantWorkFlags struct{ kind, name, hash, attempt, checksum *string }

func registerGrantWork(f *flag.FlagSet) grantWorkFlags {
	return grantWorkFlags{f.String("work", "", "explicit workspace: empty, template or saved"), f.String("work-template", "", "independent starter template name"), f.String("work-template-version", "", "exact attested starter hash"), f.String("work-attempt", "", "same student's protected saved attempt UUID"), f.String("work-checksum", "", "exact protected source archive SHA256")}
}
func (f grantWorkFlags) selection(seen map[string]bool) (map[string]any, error) {
	if !seen["work"] && !seen["work-template"] && !seen["work-template-version"] && !seen["work-attempt"] && !seen["work-checksum"] {
		return nil, nil
	}
	if *f.kind == "empty" && !seen["work-template"] && !seen["work-template-version"] && !seen["work-attempt"] && !seen["work-checksum"] {
		return map[string]any{"kind": "empty"}, nil
	}
	if *f.kind == "template" && !seen["work-attempt"] && !seen["work-checksum"] && regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`).MatchString(*f.name) && regexp.MustCompile(`^[a-f0-9]{64}$`).MatchString(*f.hash) {
		return map[string]any{"kind": "template", "name": *f.name, "hash": *f.hash}, nil
	}
	if *f.kind == "saved" && !seen["work-template"] && !seen["work-template-version"] && managementUUID.MatchString(*f.attempt) && catalogHash.MatchString(*f.checksum) {
		return map[string]any{"kind": "saved", "attempt": *f.attempt, "checksum": *f.checksum}, nil
	}
	return nil, errors.New("choose --work empty alone, --work template --work-template NAME --work-template-version HASH, or --work saved --work-attempt UUID --work-checksum SHA256; saved grants remain PENDING_NATIVE until durable class-server retention confirmation; no mutable/latest fallback")
}
func validGrantWorkResult(w grantWorkResult) bool {
	return (w.Kind == "empty" && w.Name == "" && w.Hash == "" && w.Attempt == "" && w.Checksum == "") || (w.Kind == "template" && w.Attempt == "" && w.Checksum == "" && regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`).MatchString(w.Name) && regexp.MustCompile(`^[a-f0-9]{64}$`).MatchString(w.Hash)) || (w.Kind == "saved" && w.Name == "" && w.Hash == "" && managementUUID.MatchString(w.Attempt) && catalogHash.MatchString(w.Checksum))
}
