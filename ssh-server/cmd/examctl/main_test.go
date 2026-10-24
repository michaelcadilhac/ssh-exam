package main

import (
	"reflect"
	"testing"
)

func TestFlagsAfterSubcommand(t *testing.T) {
	got := ordered([]string{"list", "--active", "--exam", "sandbox", "--json"})
	want := []string{"--active", "--exam", "sandbox", "--json", "list"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %v", got)
	}
	got = ordered([]string{"stop", "attempt", "--reason", "Audited reason"})
	if !reflect.DeepEqual(got, []string{"--reason", "Audited reason", "stop", "attempt"}) {
		t.Fatalf("got %v", got)
	}
	got = ordered([]string{"additional-preview", "exam", "student", "--work", "saved", "--work-attempt", "source-uuid", "--work-checksum", "source-hash"})
	if !reflect.DeepEqual(got, []string{"--work", "saved", "--work-attempt", "source-uuid", "--work-checksum", "source-hash", "additional-preview", "exam", "student"}) {
		t.Fatalf("saved-source values became positional students: %v", got)
	}
}
func TestServiceStopPreservesWatchdogAndStartRestoresIt(t *testing.T) {
	stop, err := serviceCommands("stop")
	if err != nil || !reflect.DeepEqual(stop, [][]string{{"stop", "exam-agent.service"}}) {
		t.Fatalf("unsafe stop %v", stop)
	}
	for _, action := range []string{"start", "restart"} {
		commands, err := serviceCommands(action)
		if err != nil || !reflect.DeepEqual(commands[0], []string{"start", "exam-deadline-watchdog.service", "exam-reconcile.timer"}) {
			t.Fatalf("watchdog not restored %v", commands)
		}
	}
	if _, err = serviceCommands("disable"); err == nil {
		t.Fatal("arbitrary service action allowed")
	}
}
