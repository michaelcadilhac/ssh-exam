package main

import (
	"encoding/json"
	"examworkspace/agent/internal/core"
	"flag"
	"log"
	"os"
)

func main() {
	p := flag.String("config", "/etc/exam-agent/agent.json", "config")
	reason := flag.String("reason", "", "audited emergency override reason")
	flag.Parse()
	if os.Geteuid() != 0 {
		log.Fatal("root-only administrative CLI")
	}
	c, err := core.LoadConfig(*p)
	if err != nil {
		log.Fatal(err)
	}
	e, err := core.New(c)
	if err != nil {
		log.Fatal(err)
	}
	op := "health"
	if flag.NArg() > 0 {
		op = flag.Arg(0)
	}
	var r core.Request
	if flag.NArg() > 1 {
		r.ID = flag.Arg(1)
	}
	var result any
	if op == "override-access" {
		result, err = e.OverrideAccess(r.ID, *reason)
	} else {
		result, err = e.Call(op, r)
	}
	if err != nil {
		log.Fatal(err)
	}
	json.NewEncoder(os.Stdout).Encode(result)
}
