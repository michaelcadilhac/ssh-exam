package main

import (
	"encoding/json"
	"examworkspace/agent/internal/core"
	"flag"
	"fmt"
	"io"
	"os"
	"regexp"
	"strings"
)

func webArguments(args []string) ([]string, bool) {
	for i := 0; i < len(args); i++ {
		if args[i] == "--config" || args[i] == "-config" {
			i++
			continue
		}
		if strings.HasPrefix(args[i], "--config=") || strings.HasPrefix(args[i], "-config=") {
			continue
		}
		if args[i] != "web" {
			return nil, false
		}
		return append(append([]string{}, args[:i]...), args[i+1:]...), true
	}
	return nil, false
}

func webHelp(out io.Writer) {
	fmt.Fprintln(out, `Usage: sudo examctl [--config FILE] web exams list [--limit N] [--after EXAM]
       sudo examctl web exams show EXAM [--request UUID]
       examctl web help

Read gateway-owned exam definitions using the existing root agent identity over
verified outbound HTTPS. No browser login, separate token or inbound agent API.
The gateway must explicitly authorize exams.list/exams.show in the agent's
managementOperations allowlist; the default is no management authorization.

--config FILE  root agent configuration (default /etc/exam-agent/agent.json)
--limit N      list page size, default 100, range 1..200
--after EXAM   exclusive exam-ID cursor from a previous page's next field
--request UUID durable intent ID; new by default. Retry a lost reply with the same
               ID/arguments; use a NEW ID for a fresh read, not a cached snapshot.
--help         help without root or configuration

JSON output names request, operation, confirmed and result. Confirmed means the
authenticated gateway read completed, not that any native action was performed.
List includes per-definition revision hashes and a next cursor; show takes an
exam ID, not an attempt UUID. Student credentials are never used or retained.
Offline web requests fail honestly; native list/info remain available locally.
Only read workflows are implemented here so far; full management remains pending.

Examples:
  sudo examctl web exams list --limit 50
  sudo examctl web exams list --after midterm
  sudo examctl web exams show midterm
  sudo examctl web exams show midterm --request UUID-FROM-PREVIOUS-REQUEST

Exit status: 0 authenticated result, 1 refusal/operational failure, 2 syntax error.
Unknown/unverified replies never imply success; retain the request ID for retry.`)
}

func webMain(args []string) int {
	if _, requested := helpRequest(args); requested {
		webHelp(os.Stdout)
		return 0
	}
	flags := flag.NewFlagSet("examctl web", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	config := flags.String("config", "/etc/exam-agent/agent.json", "root configuration")
	request := flags.String("request", "", "durable management request UUID")
	limit := flags.Int("limit", 100, "page size")
	after := flags.String("after", "", "exclusive exam-ID cursor")
	if err := flags.Parse(ordered(args)); err != nil {
		fmt.Fprintln(os.Stderr, "Run examctl web help")
		return 2
	}
	words := flags.Args()
	usage := func(message string) int { fmt.Fprintln(os.Stderr, message+"; run examctl web help"); return 2 }
	if len(words) < 2 || words[0] != "exams" {
		return usage("choose web exams list or web exams show EXAM")
	}
	id := regexp.MustCompile(`^[a-zA-Z0-9_-]{1,64}$`)
	uuid := regexp.MustCompile(`^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$`)
	if *request != "" && !uuid.MatchString(*request) {
		return usage("--request must be a UUID from the earlier operation")
	}
	var operation string
	var body any
	switch words[1] {
	case "list":
		if len(words) != 2 || *limit < 1 || *limit > 200 || (*after != "" && !id.MatchString(*after)) {
			return usage("list takes no target; use --limit 1..200 and an optional --after exam ID")
		}
		operation = "exams.list"
		b := map[string]any{"limit": *limit}
		if *after != "" {
			b["after"] = *after
		}
		body = b
	case "show":
		if len(words) != 3 || !id.MatchString(words[2]) {
			return usage("show requires exactly one exam ID from web exams list")
		}
		invalid := false
		flags.Visit(func(f *flag.Flag) {
			if f.Name == "limit" || f.Name == "after" {
				invalid = true
			}
		})
		if invalid {
			return usage("--limit/--after apply only to list")
		}
		operation, body = "exams.show", map[string]any{"id": words[2]}
	default:
		return usage("unsupported exam workflow")
	}
	if os.Getuid() != 0 || os.Geteuid() != 0 {
		fmt.Fprintln(os.Stderr, "Run examctl as root on the class server with its existing agent identity; see examctl web help")
		return 1
	}
	c, err := core.LoadConfig(*config)
	if err != nil {
		fmt.Fprintln(os.Stderr, "Load root agent configuration:", err)
		return 1
	}
	if *request == "" {
		*request = core.ManagementID()
	}
	fmt.Fprintln(os.Stderr, "Management request ID:", *request)
	result, err := core.ManagementCall(c, operation, body, *request)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		fmt.Fprintln(os.Stderr, "For the same intent, repeat the same command/arguments with --request", *request)
		return 1
	}
	if err := json.NewEncoder(os.Stdout).Encode(result); err != nil {
		fmt.Fprintln(os.Stderr, "Write confirmed management result:", err)
		return 1
	}
	return 0
}
