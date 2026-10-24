package core

// Private root qualification adapter only. This file is never linked into an
// installed executable. No production/environment retained-mode switch exists.

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"
)

// Package variables initialize before test init functions install desktop
// substitutes. Preserve the actual production factories for the guarded guest.
var guestNativeTerminalCommand = terminalSupervisorCommand
var guestNativeTerminalGroup = terminalSupervisorGroup
var guestNativeWorkloadGroup = terminalWorkloadGroup
var guestNativeCollectionRunner = collectionRunner

func retainedGuestNativeRoles() {
	terminalSupervisorCommand = guestNativeTerminalCommand
	terminalSupervisorGroup = guestNativeTerminalGroup
	terminalWorkloadGroup = guestNativeWorkloadGroup
	collectionRunner = guestNativeCollectionRunner
	// ONLY this compiled test role, after the full private guest guard. Keep
	// actual root SSH/pidfd, complete UID inventory, cgroup and resource checks.
	terminalAuthorityReadiness = func() error { return nil }
}

func TestMain(m *testing.M) {
	if len(os.Args) > 1 && !strings.HasPrefix(os.Args[1], "-test.") && os.Args[1] != "--" {
		if _, err := monitoringGuestIdentity("retained-policy"); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(2)
		}
		retainedGuestNativeRoles()
		args := os.Args[1:]
		if TerminalSupervisorMain(args) || PaneBootstrapMain(args) || MonitoringPublisherMain(args) || TemplateWorkerMain(args) || CollectionWorkerMain(args) {
			os.Exit(0)
		}
		fmt.Fprintln(os.Stderr, "unsupported private qualification role")
		os.Exit(2)
	}
	os.Exit(m.Run())
}

func TestRetainedPolicyAgentGuest(t *testing.T) {
	requireMonitoringGuest(t, "retained-policy", "EXAM_RETAINED_POLICY_GUEST")
	retainedGuestNativeRoles()
	config, err := LoadConfig("/etc/exam-agent/agent.json")
	if err != nil {
		t.Fatal(err)
	}
	engine, err := New(config)
	if err != nil {
		t.Fatal(err)
	}
	if err := engine.Tick(); err != nil {
		t.Fatal(err)
	}
	if err := engine.ServeLocal(); err != nil {
		t.Fatal(err)
	}
}

func TestRetainedPolicyWatchdogGuest(t *testing.T) {
	requireMonitoringGuest(t, "retained-policy", "EXAM_RETAINED_POLICY_GUEST")
	retainedGuestNativeRoles()
	config, err := LoadConfig("/etc/exam-agent/agent.json")
	if err != nil {
		t.Fatal(err)
	}
	engine, err := New(config)
	if err != nil {
		t.Fatal(err)
	}
	engine.Watch()
}

func TestRetainedGuestRawRoleRefusesUnqualifiedHost(t *testing.T) {
	if _, err := os.Stat("/run/ssh-exam-qualification-input/run.json"); err == nil {
		t.Skip("negative host control is outside the guarded guest")
	}
	if _, err := monitoringGuestIdentity("retained-policy"); err == nil {
		t.Fatal("unqualified host passed root guest guard")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	output, err := exec.CommandContext(ctx, os.Args[0], terminalSupervisorRole, ManagementID(), "unqualified.scope").CombinedOutput()
	if err == nil || ctx.Err() != nil || !(strings.Contains(string(output), "private guest root required") || strings.Contains(string(output), "refuse outside the private systemd guest")) {
		t.Fatal("raw role missed the exact private-host refusal", err, string(output))
	}
}

func TestRetainedGuestFactoriesPreserveProductionBoundaries(t *testing.T) {
	unit := "exam-terminal-" + ManagementID() + "-" + strings.Repeat("a", 32) + ".scope"
	command := guestNativeTerminalCommand(unit, nil)
	args := strings.Join(command.Args, " ")
	if strings.Contains(args, "--user") || !strings.Contains(args, "--slice=examterminal.slice") || !strings.Contains(args, terminalSupervisorRole) {
		t.Fatal("guest captured desktop substitutes instead of actual production factory", args)
	}
	group, err := guestNativeTerminalGroup(unit)
	if err != nil || group != "0::/examterminal.slice/"+unit+"\n" {
		t.Fatal("guest terminal scope differs from production", group, err)
	}
	group, err = guestNativeWorkloadGroup(unit)
	if err != nil || group != "0::/exam.slice/"+unit+"\n" {
		t.Fatal("guest workload scope differs from production", group, err)
	}
	if terminalAuthorityReadiness() == nil {
		t.Fatal("factory inspection enabled the incomplete runtime")
	}
}
