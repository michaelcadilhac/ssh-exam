package core

import (
	"strings"
	"testing"
)

func TestSignedFramedRegistrationPreservesLegacyHostAndAdministratorWorkflows(t *testing.T) {
	for _, mode := range []string{"student", "functional-host", "sandbox-administrator"} {
		t.Run(mode, func(t *testing.T) {
			e, _, _ := finalFixture(t, "ACTIVE", Millis()+5400000)
			key := commandKeys(t, e)
			if err := e.WithState(func() error {
				// A new synthetic registration, with no running/historical attempt.
				delete(e.state.Attempts, finalID)
				if mode == "functional-host" {
					e.Config.FunctionalTestAccount, e.Config.FunctionalHostAccess = "student", true
				}
				if mode == "sandbox-administrator" {
					account := e.Config.Accounts["student"]
					account.SandboxOnly = true
					e.Config.Accounts["student"] = account
				}
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			transport := strings.Repeat("a", 64)
			cmd := Command{Audience: "class", Nonce: Token(), Expires: Millis() + 20000, Op: "register", Username: "student", Body: Request{Exam: "exam", BrowserSSH: true}}
			result, err := e.Command(signedCommand(key, cmd), "student", transport)
			if err != nil {
				t.Fatal("actual signed registration refused before negotiation", err)
			}
			value := result.(map[string]any)
			if value["transport"] != transport || value["execution_renewal_receipts"] != "v1" {
				t.Fatal("existing authenticated registration/receipt capability changed", value)
			}
			if (value["framed_pane_input"] == "v1") != (mode == "student") {
				t.Fatal("registration advertised a framed protocol whose native pane path cannot support this account", mode, value)
			}
			if len(e.state.Attempts) != 0 || len(e.state.Caps) != 0 {
				t.Fatal("capability negotiation started or admitted work")
			}
		})
	}
}

// Signed runtime admission, not a parser-only test. Root SSH ancestry and the
// kernel handoff have separate actual-gate/guest qualification.
func TestSignedFramedAdmissionRequiresCurrentSupervisedOwnerAndFreshPaneEpoch(t *testing.T) {
	for _, mode := range []string{"current", "missing-owner", "wrong-page", "legacy-recorder", "server-proxy-legacy", "practice", "host-exception"} {
		t.Run(mode, func(t *testing.T) {
			e, _, _ := finalFixture(t, "ACTIVE", Millis()+5400000)
			key := commandKeys(t, e)
			transport, page := strings.Repeat("a", 64), strings.Repeat("b", 64)
			var start, deadline int64
			if err := e.WithState(func() error {
				a := e.state.Attempts[finalID]
				a.Transport, a.Settings.Terminals = transport, 4
				a.OriginalDeadline = a.Deadline
				if mode == "host-exception" {
					e.Config.FunctionalTestAccount, e.Config.FunctionalTestUntil, e.Config.FunctionalHostAccess = a.Username, Millis()+600000, true
					a.FunctionalTest = true
				}
				a.BrowserSSH, a.TerminalSupervised = mode != "server-proxy-legacy", mode != "legacy-recorder"
				e.state.Registrations[transport] = a.Username
				if mode != "missing-owner" {
					if err := registerPageOwner(a, page, Token()); err != nil {
						return err
					}
				}
				start, deadline = a.Start, a.Deadline
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			body := Request{ID: finalID, Pane: "99999999-1234-4234-8234-123456789abc", Purpose: "exam", Username: "student", Transport: transport, PageEpoch: page}
			if mode == "wrong-page" {
				body.PageEpoch = Token()
			}
			if mode == "practice" {
				body.Purpose = "practice"
			}
			var previousEpoch, previousToken string
			for range 2 {
				cmd := Command{Audience: "class", Nonce: Token(), Expires: Millis() + 20000, Op: "issue-framed-owner-channel-admission", Username: "student", Transport: transport, Body: body}
				result, err := e.Command(signedCommand(key, cmd), "student", transport)
				if mode != "current" {
					if err == nil || len(e.state.Caps) != 0 {
						t.Fatal("unqualified framed admission created a capability", mode, err)
					}
					stage := "framed input requires"
					if mode == "missing-owner" || mode == "wrong-page" {
						stage = "owner"
					}
					if !strings.Contains(err.Error(), stage) {
						t.Fatal("fixture missed the intended ownership/mode refusal", mode, err)
					}
					break
				}
				if err != nil {
					t.Fatal("signed framed admission unavailable", err)
				}
				v, ok := result.(map[string]string)
				if !ok || v["input_protocol"] != "v1" || !monitoringDigest.MatchString(v["input_epoch"]) || v["input_epoch"] == previousEpoch || v["token"] == "" || v["token"] == previousToken {
					t.Fatal("framed pane issuance lost the fresh explicit binding", result)
				}
				if len(e.state.Caps) != 1 {
					t.Fatal("replacement did not revoke the old unused capability")
				}
				capability := e.state.Caps[Hash([]byte(v["token"]))]
				if capability.Pane != body.Pane || capability.Purpose != framedPanePurpose || capability.RegisteredOwner.InputEpoch == v["input_epoch"] {
					t.Fatal("packet epoch was confused with the attempt authorization epoch")
				}
				previousEpoch, previousToken = v["input_epoch"], v["token"]
			}
			if a := e.state.Attempts[finalID]; a.State != "ACTIVE" || a.Start != start || a.Deadline != deadline || a.OriginalDeadline != deadline {
				t.Fatal("input negotiation changed authority or interval", a)
			}
		})
	}
}
