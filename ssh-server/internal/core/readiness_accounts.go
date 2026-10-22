package core

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os/exec"
	"sort"
	"strconv"
	"strings"
	"time"
)

const readinessAccountsBudget = 5 * time.Second
const readinessAccountOutputLimit = 4096

var errReadinessAccountOutputLimit = errors.New("account lookup output exceeds the private verification bound")

// This is an admission/diagnostic bound, not cached identity or permission.
// Bound the entire configured-account walk, not five seconds per account.
func configuredAccountReadiness(accounts map[string]Account) []string {
	ctx, cancel := context.WithTimeout(context.Background(), readinessAccountsBudget)
	defer cancel()
	return checkReadinessAccounts(ctx, accounts, readinessAccountOutput)
}

func checkReadinessAccounts(ctx context.Context, accounts map[string]Account, lookup func(context.Context, string) ([]byte, error)) []string {
	names := make([]string, 0, len(accounts))
	for name := range accounts {
		names = append(names, name)
	}
	sort.Strings(names)
	var missing []string
	for _, name := range names {
		var output []byte
		err := ctx.Err()
		if err == nil {
			output, err = lookup(ctx, name)
			if err == nil {
				err = ctx.Err() // Late output cannot erase the shared cutoff.
			}
		}
		if err != nil {
			// Do not echo provider stdout/stderr: identity failure is unavailable
			// verification, not evidence of a changed account or student violation.
			missing = append(missing, "account lookup unavailable: "+name+"; verify the NSS service and retry examctl health; inspect examctl agent status without restarting exams")
			continue
		}
		account := accounts[name]
		fields := strings.Split(strings.TrimSpace(string(output)), ":")
		valid := len(fields) == 7
		if valid {
			uid, parseErr := strconv.Atoi(fields[2])
			valid = parseErr == nil && uid == account.UID
		}
		if valid && account.SandboxOnly {
			valid = fields[5] == account.Home && fields[6] == account.Shell
		} else if valid {
			valid = fields[6] == "/usr/local/libexec/exam-login"
		}
		if !valid {
			missing = append(missing, "account UID/login policy differs from root registry: "+name)
		}
	}
	return missing
}

// Discard excess bytes while the command remains time-bounded. Returning a
// short write here could leave the child blocked on its pipe until cancellation.
type readinessAccountBuffer struct {
	data     bytes.Buffer // Do not promote ReaderFrom and bypass the Write cap.
	overflow bool
}

func (b *readinessAccountBuffer) Write(p []byte) (int, error) {
	n := len(p)
	remaining := readinessAccountOutputLimit - b.data.Len()
	if n > remaining {
		b.overflow = true
		p = p[:remaining]
	}
	_, _ = b.data.Write(p)
	return n, nil
}

func readinessAccountOutput(ctx context.Context, name string) ([]byte, error) {
	return runReadinessAccountQuery(exec.CommandContext(ctx, "/usr/bin/getent", "passwd", name))
}

func runReadinessAccountQuery(command *exec.Cmd) ([]byte, error) {
	var output readinessAccountBuffer
	command.Stdout, command.Stderr = &output, io.Discard
	// A provider descendant retaining stdout cannot keep Wait's pipe copier
	// alive indefinitely. This is not cgroup/process-tree containment.
	command.WaitDelay = 250 * time.Millisecond
	if err := command.Run(); err != nil {
		return nil, err
	}
	if output.overflow {
		return nil, errReadinessAccountOutputLimit
	}
	return output.data.Bytes(), nil
}
