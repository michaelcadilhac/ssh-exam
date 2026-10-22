package core

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestReadinessAccountsPreserveCurrentUIDAndLoginPolicyChecks(t *testing.T) {
	account := Account{UID: 20001, GID: 20001, Home: "/home/synthetic", Shell: "/bin/bash"}
	for _, tc := range []struct {
		name, row          string
		sandbox, wantIssue bool
	}{
		{"valid-managed", "synthetic:x:20001:20001::/home/synthetic:/usr/local/libexec/exam-login", false, false},
		{"wrong-uid", "synthetic:x:20002:20001::/home/synthetic:/usr/local/libexec/exam-login", false, true},
		{"wrong-managed-shell", "synthetic:x:20001:20001::/home/synthetic:/bin/bash", false, true},
		{"valid-sandbox", "synthetic:x:20001:20001::/home/synthetic:/bin/bash", true, false},
		{"wrong-sandbox-home", "synthetic:x:20001:20001::/other:/bin/bash", true, true},
		{"wrong-sandbox-shell", "synthetic:x:20001:20001::/home/synthetic:/bin/zsh", true, true},
		{"malformed", "provider-not-a-passwd-row", false, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			a := account
			a.SandboxOnly = tc.sandbox
			issues := checkReadinessAccounts(context.Background(), map[string]Account{"synthetic": a}, func(context.Context, string) ([]byte, error) { return []byte(tc.row), nil })
			if (len(issues) > 0) != tc.wantIssue {
				t.Fatal("changed account admission policy", issues)
			}
		})
	}
}

func TestReadinessAccountsShareOneDeadlineAndNeverCacheOrExposeProviderErrors(t *testing.T) {
	accounts := map[string]Account{"first": {UID: 20001}, "second": {UID: 20002}, "third": {UID: 20003}}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	var calls []string
	issues := checkReadinessAccounts(ctx, accounts, func(ctx context.Context, name string) ([]byte, error) {
		calls = append(calls, name)
		cancel()
		return []byte("PRIVATE-PROVIDER-OUTPUT"), errors.New("PRIVATE-PROVIDER-ERROR")
	})
	if !reflect.DeepEqual(calls, []string{"first"}) || len(issues) != 3 {
		t.Fatal("account walk continued past its shared deadline or omitted unknown accounts", calls, issues)
	}
	for _, issue := range issues {
		if !strings.Contains(issue, "account lookup unavailable") || !strings.Contains(issue, "examctl health") || strings.Contains(issue, "PRIVATE") || strings.Contains(issue, "policy differs") {
			t.Fatal("unavailable provider was leaked or misclassified", issue)
		}
	}
	for _, row := range []string{"synthetic:x:20001:20001::/home/synthetic:/usr/local/libexec/exam-login", "synthetic:x:20001:20001::/home/synthetic:/bin/bash"} {
		issues = checkReadinessAccounts(context.Background(), map[string]Account{"synthetic": {UID: 20001}}, func(context.Context, string) ([]byte, error) { return []byte(row), nil })
		if (len(issues) == 0) != strings.HasSuffix(row, "/exam-login") {
			t.Fatal("account change hidden by previous result", issues)
		}
	}
}

func TestReadinessAccountQueryActualChildBoundsOutputAndWait(t *testing.T) {
	for _, mode := range []string{"valid", "oversized", "hung", "failed"} {
		t.Run(mode, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			command := exec.CommandContext(ctx, os.Args[0], "-test.run=^TestReadinessAccountQueryChild$", "--", mode)
			// Do not time the race runtime's synthetic one-second exit sleep as
			// NSS latency. This override exists only in this test child.
			command.Env = append(os.Environ(), "EXAM_READINESS_ACCOUNT_TEST_CHILD=1", "GORACE=atexit_sleep_ms=0")
			started := time.Now()
			out, err := runReadinessAccountQuery(command)
			if mode == "valid" {
				if err != nil || string(out) != "synthetic:x:20001:20001::/home/synthetic:/usr/local/libexec/exam-login\n" {
					t.Fatal("valid query refused", err, string(out))
				}
			} else if err == nil || len(out) != 0 || time.Since(started) > 2*time.Second {
				t.Fatal("unsafe provider was unbounded or accepted", err, len(out), time.Since(started))
			}
			if mode == "oversized" && !errors.Is(err, errReadinessAccountOutputLimit) {
				t.Fatal("large output did not reach the bounded decoder", err)
			}
			if mode == "hung" && ctx.Err() == nil {
				t.Fatal("hung fixture did not reach context cancellation", err)
			}
		})
	}
}

func TestReadinessAccountsRejectSuccessfulOutputAfterSharedCutoff(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	issues := checkReadinessAccounts(ctx, map[string]Account{"synthetic": {UID: 20001}}, func(context.Context, string) ([]byte, error) {
		cancel()
		return []byte("synthetic:x:20001:20001::/home/synthetic:/usr/local/libexec/exam-login"), nil
	})
	if len(issues) != 1 || !strings.Contains(issues[0], "account lookup unavailable") {
		t.Fatal("late successful provider output erased the cutoff", issues)
	}
}

func TestReadinessAccountBufferCannotBypassCapThroughReaderFrom(t *testing.T) {
	var output readinessAccountBuffer
	if _, ok := any(&output).(io.ReaderFrom); ok {
		t.Fatal("unexpected bulk-copy bypass")
	}
	for _, data := range []string{strings.Repeat("x", readinessAccountOutputLimit+1), "more"} {
		n, err := output.Write([]byte(data))
		if err != nil || n != len(data) || output.data.Len() != readinessAccountOutputLimit || !output.overflow {
			t.Fatal("private output cap not enforced", err, n, output.data.Len())
		}
	}
}

func TestReadinessAccountQueryChild(t *testing.T) {
	if os.Getenv("EXAM_READINESS_ACCOUNT_TEST_CHILD") != "1" {
		t.Skip("private test child only")
	}
	switch os.Args[len(os.Args)-1] {
	case "valid":
		fmt.Println("synthetic:x:20001:20001::/home/synthetic:/usr/local/libexec/exam-login")
	case "oversized":
		fmt.Print(strings.Repeat("PRIVATE-PROVIDER-OUTPUT", 100000))
	case "hung":
		time.Sleep(5 * time.Second)
	case "failed":
		fmt.Fprintln(os.Stderr, "PRIVATE-PROVIDER-ERROR")
		os.Exit(7)
	default:
		os.Exit(8)
	}
	os.Exit(0)
}
