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
	"path/filepath"
	"strings"
	"text/tabwriter"
	"time"
)

// Accept global flags before or after the subcommand.
func ordered(args []string) []string {
	var flags, positionals []string
	for i := 0; i < len(args); i++ {
		arg := args[i]
		if strings.HasPrefix(arg, "-") {
			flags = append(flags, arg)
			if (arg == "--config" || arg == "-config" || arg == "--reason" || arg == "-reason" || arg == "--exam" || arg == "-exam") && i+1 < len(args) {
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
	flags := flag.NewFlagSet("examctl", flag.ExitOnError)
	p := flags.String("config", "/etc/exam-agent/agent.json", "configuration")
	reason := flags.String("reason", "", "audited administrator reason")
	active := flags.Bool("active", false, "list only started unfinished attempts")
	exam := flags.String("exam", "", "filter list by exam ID")
	asJSON := flags.Bool("json", false, "machine-readable list")
	flags.Usage = func() {
		fmt.Fprintln(os.Stderr, "Usage: sudo examctl [flags] list|info|start|pause|stop|finish|cancel|retry|manifest|export|export-status|pause-export|resume-export|delete|override-access|health|accounts|reconcile|agent [ATTEMPT or ACTION]\nagent ACTION: start, stop, restart, status (deadline watchdog stays running)")
		flags.PrintDefaults()
	}
	flags.Parse(ordered(os.Args[1:]))
	if os.Geteuid() != 0 {
		log.Fatal("root-only administrative CLI")
	}
	op := "list"
	if flags.NArg() > 0 {
		op = flags.Arg(0)
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
		log.Fatal(err)
	}
	e, err := core.New(c)
	if err != nil {
		log.Fatal(err)
	}
	var result any
	id := flags.Arg(1)
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
		var value any
		value, err = e.Call("submission-status", core.Request{ID: id})
		if err != nil {
			break
		}
		a := value.(*core.Attempt)
		if !a.Protected {
			log.Fatal("protected submission unavailable")
		}
		if _, err = core.ReadProtected(filepath.Join(c.State, "submissions", id), a); err != nil {
			break
		}
		var f *os.File
		f, err = os.Open(filepath.Join(c.State, "submissions", id, "submission.tar.gz"))
		if err != nil {
			break
		}
		defer f.Close()
		_, err = io.Copy(os.Stdout, f)
		if err != nil {
			log.Fatal(err)
		}
		return
	default:
		result, err = e.Admin(op, id, *reason)
	}
	if err != nil {
		log.Fatal(err)
	}
	json.NewEncoder(os.Stdout).Encode(result)
}
