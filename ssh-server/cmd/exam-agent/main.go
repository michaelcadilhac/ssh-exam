package main

import (
	"examworkspace/agent/internal/core"
	"flag"
	"log"
)

func main() {
	configPath := flag.String("config", "/etc/exam-agent/agent.json", "configuration")
	watch := flag.Bool("watchdog", false, "independent deadline watchdog")
	once := flag.Bool("reconcile", false, "reconcile once")
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
		if err = e.DeliverCallbacks(); err != nil {
			log.Print(err)
		}
		return
	}
	if *watch {
		e.Watch()
		return
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
