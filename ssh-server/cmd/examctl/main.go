package main

import (
	"encoding/json"
	"errors"
	"examworkspace/agent/internal/core"
	"flag"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"strings"
	"text/tabwriter"
	"time"
)

// Accept global flags before or after the subcommand.
func takesValue(arg string) bool {
	name := strings.TrimLeft(strings.SplitN(arg, "=", 2)[0], "-")
	switch name {
	case "saved-sources", "work", "work-template", "work-template-version", "work-attempt", "work-checksum", "definition-revision", "before", "config", "state", "reason", "exam", "username", "output", "request", "limit", "after", "name", "template", "template-version", "duration-seconds", "duration-minutes", "webcam", "terminals", "earliest", "latest", "revision", "file", "mode", "confirm", "collection-file-mib", "collection-total-mib", "status", "view", "q", "minutes", "target", "intent", "generation", "section", "through", "offset", "expected", "file-mib", "total-mib", "action", "review", "lifecycle":
		return strings.HasPrefix(arg, "-")
	}
	return false
}

func ordered(args []string) []string {
	var flags, positionals []string
	for i := 0; i < len(args); i++ {
		arg := args[i]
		if strings.HasPrefix(arg, "-") {
			flags = append(flags, arg)
			if takesValue(arg) && !strings.Contains(arg, "=") && i+1 < len(args) {
				i++
				flags = append(flags, args[i])
			}
		} else {
			positionals = append(positionals, arg)
		}
	}
	return append(flags, positionals...)
}
func serviceCommands(action string) ([][]string, error) {
	if action != "start" && action != "stop" && action != "restart" && action != "status" {
		return nil, errors.New("unsupported service action")
	}
	var commands [][]string
	if action == "start" || action == "restart" {
		commands = append(commands, []string{"start", "exam-deadline-watchdog.service", "exam-reconcile.timer"})
	}
	return append(commands, []string{action, "exam-agent.service"}), nil
}
func main() {
	if core.MonitoringPublisherMain(os.Args[1:]) {
		return
	}
	if core.TemplateWorkerMain(os.Args[1:]) {
		return
	}
	if core.CollectionWorkerMain(os.Args[1:]) {
		return
	}
	if args, ok := webArguments(os.Args[1:]); ok {
		os.Exit(webMain(args))
	}
	if webCategory(os.Args[1:]) == "workspaces" {
		os.Exit(workspacesMain(os.Args[1:]))
	}
	if webCategory(os.Args[1:]) == "panes" {
		os.Exit(panesMain(os.Args[1:]))
	}
	if webCategory(os.Args[1:]) == "templates" {
		os.Exit(templatesMain(os.Args[1:]))
	}
	if webCategory(os.Args[1:]) == "config" {
		os.Exit(configurationMain(os.Args[1:]))
	}
	if webCategory(os.Args[1:]) == "recovery-grants" {
		os.Exit(recoveryGrantsMain(os.Args[1:]))
	}
	topic, help := helpRequest(os.Args[1:])
	if help {
		if !printHelp(os.Stdout, topic) {
			os.Exit(2)
		}
		return
	}
	flags := flag.NewFlagSet("examctl", flag.ExitOnError)
	p := flags.String("config", "/etc/exam-agent/agent.json", "configuration")
	reason := flags.String("reason", "", "audited administrator reason")
	active := flags.Bool("active", false, "list only started unfinished attempts")
	exam := flags.String("exam", "", "filter list by exam ID")
	username := flags.String("username", "", "exact approved account for cancel-absent only")
	asJSON := flags.Bool("json", false, "machine-readable list")
	output := flags.String("output", "", "create a new private export file; never overwrite")
	readOnly := flags.Bool("read-only", false, "observe native metadata without initialization, reconciliation or writes; list/info only")
	statePath := flags.String("state", "", "explicit private state directory for --read-only; bypasses configuration/key loading")
	limit := flags.Int("limit", 50, "read-only list page size, 1..200")
	after := flags.String("after", "", "read-only list exclusive attempt UUID cursor")
	flags.Usage = func() {
		printHelp(os.Stderr, topic)
	}
	flags.Parse(ordered(os.Args[1:]))
	provided := map[string]bool{}
	flags.Visit(func(f *flag.Flag) { provided[f.Name] = true })
	op := "list"
	if flags.NArg() > 0 {
		op = flags.Arg(0)
	}
	g, known := guides[op]
	invalid := ""
	if !known {
		invalid = fmt.Sprintf("unknown command %q; run examctl help", op)
	} else if flags.NArg() > 2 {
		invalid = "unexpected extra targets; select exactly one attempt UUID or use list --exam"
	} else if g.target && flags.Arg(1) == "" && !(op == "info" && *exam != "") {
		invalid = "missing target; use an attempt UUID from examctl list (agent requires an action)"
	} else if !g.target && flags.Arg(1) != "" {
		invalid = "this command takes no target; see command help"
	} else if g.reason && len(strings.TrimSpace(*reason)) < 8 {
		invalid = "provide --reason with a concrete audited administrator reason of at least 8 characters"
	} else if *output != "" && op != "export" {
		invalid = "--output is only supported by export"
	} else if (provided["username"] && op != "cancel-absent") || (op == "cancel-absent" && (*exam == "" || *username == "")) {
		invalid = "cancel-absent requires --exam EXAM and --username USER; --username is unavailable for other commands"
	} else if (*active && op != "list" && op != "info") || (*exam != "" && op != "list" && op != "info" && op != "recovery-grants" && op != "cancel-absent") {
		invalid = "--active filters only list/info; --exam filters list/info/recovery-grants or names the exact orphan exam for cancel-absent"
	} else if op == "info" && *exam != "" && flags.Arg(1) != "" {
		invalid = "choose info ATTEMPT or list --exam EXAM; do not combine an attempt target and exam filter"
	} else if (*readOnly || provided["state"] || provided["limit"] || provided["after"]) && (!*readOnly || (op != "list" && op != "info")) {
		invalid = "--read-only/--state/--limit/--after are supported only by list/info with --read-only; see examctl help info"
	} else if *readOnly && (*reason != "" || (provided["state"] && (*statePath == "" || provided["config"]))) {
		invalid = "read-only observation takes no --reason; choose --state DIR or --config FILE, not both, and never an empty state path; see examctl help info"
	} else if *readOnly && op == "info" && flags.Arg(1) != "" && provided["limit"] {
		invalid = "--limit pages a read-only list, not a named info target; see examctl help info"
	}
	query := core.ReadOnlyQuery{ID: flags.Arg(1), Exam: *exam, Active: *active, Limit: *limit, After: *after}
	if invalid == "" && *readOnly {
		if err := query.Validate(); err != nil {
			invalid = err.Error()
		}
	}
	if invalid != "" {
		fmt.Fprintln(os.Stderr, invalid)
		printHelp(os.Stderr, op)
		os.Exit(2)
	}
	if op == "agent" {
		if _, err := serviceCommands(flags.Arg(1)); err != nil {
			fmt.Fprintln(os.Stderr, "agent requires start, stop, restart or status; see examctl help agent")
			os.Exit(2)
		}
	}
	if os.Geteuid() != 0 {
		fmt.Fprintln(os.Stderr, "Native operations require root. Run sudo examctl with the same arguments; examctl help is available without privilege.")
		os.Exit(1)
	}
	if *readOnly {
		directory := *statePath
		var err error
		if directory == "" {
			directory, err = core.ReadOnlyConfiguredState(*p)
		}
		if err != nil {
			fmt.Fprintln(os.Stderr, "Cannot resolve the configured state directory without writes. Use --state DIR for the known private native directory; see examctl help info. No initialization or reconciliation was attempted.")
			os.Exit(1)
		}
		snapshot, err := core.ObserveNativeReadOnly(directory, query)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		if err := json.NewEncoder(os.Stdout).Encode(snapshot); err != nil {
			fmt.Fprintln(os.Stderr, "Cannot write read-only snapshot output; no native record was changed.")
			os.Exit(1)
		}
		if !snapshot.Complete {
			fmt.Fprintln(os.Stderr, "Partial read-only observation: inspect observation flags and each lease status, preserving its journal; unknown/unavailable/invalid is not proof of expiry or misconduct. Retry the same read-only command, or use examctl help info. No reconciliation was attempted.")
			os.Exit(1)
		}
		return
	}
	if op == "agent" {
		action := flags.Arg(1)
		if action != "start" && action != "stop" && action != "restart" && action != "status" {
			log.Fatal("agent requires start, stop, restart or status")
		}
		commands, err := serviceCommands(action)
		if err != nil {
			log.Fatal(err)
		}
		for _, args := range commands {
			cmd := exec.Command("/usr/bin/systemctl", args...)
			cmd.Stdout = os.Stdout
			cmd.Stderr = os.Stderr
			if err = cmd.Run(); err != nil {
				log.Fatal(err)
			}
		}
		return
	}
	c, err := core.LoadConfig(*p)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Cannot load root configuration %q: %v\nUse --config FILE for an installed configuration; examctl help explains defaults.\n", *p, err)
		os.Exit(1)
	}
	e, err := core.New(c)
	if err != nil {
		log.Fatal(err)
	}
	var result any
	id := flags.Arg(1)
	fail := func(err error) {
		fmt.Fprintf(os.Stderr, "examctl %s: %v\n", op, err)
		printRefusal(os.Stderr, op, id, *p, e)
		os.Exit(1)
	}
	switch op {
	case "list":
		var attempts []*core.Attempt
		attempts, err = e.List(*active, *exam)
		result = attempts
		if err == nil && !*asJSON {
			w := tabwriter.NewWriter(os.Stdout, 0, 4, 2, ' ', 0)
			fmt.Fprintln(w, "ATTEMPT\tEXAM\tSTUDENT\tSTATE\tACCESS\tPOLICY\tDEADLINE")
			for _, a := range attempts {
				deadline := "not started"
				if a.Deadline > 0 {
					deadline = time.UnixMilli(a.Deadline).UTC().Format(time.RFC3339)
				}
				fmt.Fprintf(w, "%s\t%s\t%s\t%s\t%s\t%s\t%s\n", a.ID, a.Exam, a.Username, a.State, a.AccessState, a.PolicyState, deadline)
			}
			w.Flush()
			return
		}
	case "info":
		if *exam != "" {
			result, err = e.List(*active, *exam)
		} else {
			result, err = e.Admin("info", id, "")
		}
	case "health":
		result, err = e.Call("health", core.Request{})
	case "accounts":
		result = c.Accounts
	case "recovery-grants":
		result, err = e.RecoveryGrants(*exam)
	case "reconcile":
		err = e.RefreshExpiredTiming()
		if tickErr := e.Tick(); err == nil {
			err = tickErr
		}
		if policyErr := e.ReconcilePolicies(); err == nil {
			err = policyErr
		}
		result = map[string]bool{"ok": err == nil}
	case "override-access":
		result, err = e.OverrideAccess(id, *reason)
	case "export-status":
		result, err = e.ExportDelivery(id, nil, "")
	case "pause-export", "resume-export":
		paused := op == "pause-export"
		result, err = e.ExportDelivery(id, &paused, *reason)
	case "export":
		var f *os.File
		f, err = e.OpenExport(id)
		if err != nil {
			break
		}
		defer f.Close()
		var destination io.Writer = os.Stdout
		var exportFile *os.File
		if *output != "" {
			file, createErr := os.OpenFile(*output, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
			if createErr != nil {
				fail(fmt.Errorf("create new export %q (existing files are never overwritten): %w", *output, createErr))
			}
			defer file.Close()
			exportFile = file
			destination = file
		}
		_, err = io.Copy(destination, f)
		if err == nil && exportFile != nil {
			err = exportFile.Sync()
		}
		if exportFile != nil {
			closeErr := exportFile.Close()
			if err == nil {
				err = closeErr
			}
		}
		if err != nil {
			fail(fmt.Errorf("export incomplete; inspect any partial destination before retry: %w", err))
		}
		return
	case "cancel-absent":
		result, err = e.CancelAbsentPreparation(id, *exam, *username, *reason)
	default:
		result, err = e.Admin(op, id, *reason)
	}
	if err != nil {
		fail(err)
	}
	json.NewEncoder(os.Stdout).Encode(result)
}
