package main

import (
	"examworkspace/agent/internal/core"
	"flag"
	"log"
	"os"
)

func main() {
	if core.PaneBootstrapMain(os.Args[1:]) {
		return
	}
	if core.MonitoringPublisherMain(os.Args[1:]) {
		return
	}
	if core.TemplateWorkerMain(os.Args[1:]) {
		return
	}
	if core.CollectionWorkerMain(os.Args[1:]) {
		return
	}
	configPath := flag.String("config", "/etc/exam-agent/agent.json", "configuration")
	watch := flag.Bool("watchdog", false, "independent deadline watchdog")
	once := flag.Bool("reconcile", false, "reconcile once")
	handoff := flag.Bool("handoff", false, "serve a replacement command socket without startup reconciliation; existing PTY bridge stays running")
	flag.Parse()
	c, err := core.LoadConfig(*configPath)
	if err != nil {
		log.Fatal(err)
	}
	e, err := core.New(c)
	if err != nil {
		log.Fatal(err)
	}
	if *once {
		if err = e.RefreshExpiredTiming(); err != nil {
			log.Print(err)
		}
		if err = e.Tick(); err != nil {
			log.Fatal(err)
		}
		if err = e.ReconcilePolicies(); err != nil {
			log.Print(err)
		}
		if err = e.DeliverCallbacks(); err != nil {
			log.Print(err)
		}
		return
	}
	if *watch {
		e.Watch()
		return
	}
	if *handoff {
		if *once {
			log.Fatal("handoff cannot reconcile")
		}
		log.Fatal(e.ServeLocal())
	}
	if err = e.Tick(); err != nil {
		log.Fatal(err)
	}
	if err = e.ReportConfiguration(); err != nil {
		log.Fatal(err)
	}
	// No TCP listener and no command polling. The only command input is the local SSH gate.
	log.Fatal(e.ServeLocal())
}
