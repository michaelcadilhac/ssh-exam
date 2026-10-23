package main

import (
	"errors"
	"flag"
	"regexp"
)

// Real callers: additional-preview and explicit unused-grant revision.
type grantWorkFlags struct{ kind, name, hash *string }

func registerGrantWork(f *flag.FlagSet) grantWorkFlags {
	return grantWorkFlags{f.String("work", "", "explicit workspace: empty or template"), f.String("work-template", "", "independent starter template name"), f.String("work-template-version", "", "exact attested starter hash")}
}
func (f grantWorkFlags) selection(seen map[string]bool) (map[string]any, error) {
	if !seen["work"] && !seen["work-template"] && !seen["work-template-version"] {
		return nil, nil
	}
	if *f.kind == "empty" && !seen["work-template"] && !seen["work-template-version"] {
		return map[string]any{"kind": "empty"}, nil
	}
	if *f.kind == "template" && regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`).MatchString(*f.name) && regexp.MustCompile(`^[a-f0-9]{64}$`).MatchString(*f.hash) {
		return map[string]any{"kind": "template", "name": *f.name, "hash": *f.hash}, nil
	}
	return nil, errors.New("choose --work empty alone, or --work template --work-template NAME --work-template-version HASH; no mutable/latest fallback")
}
func validGrantWorkResult(w grantWorkResult) bool {
	return (w.Kind == "empty" && w.Name == "" && w.Hash == "") || (w.Kind == "template" && regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`).MatchString(w.Name) && regexp.MustCompile(`^[a-f0-9]{64}$`).MatchString(w.Hash))
}
