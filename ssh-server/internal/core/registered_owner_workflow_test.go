package core

import (
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"os"
	"strings"
	"testing"
)

// Exercise the signed native command interface. Kernel SSH ancestry is supplied
// by the caller here; the actual gate/PTY and browser suites qualify that seam
// separately. Unknown JSON fields let this regression reproduce the old writer
// without requiring implementation-only fields to exist first.
func TestSignedPaneAdmissionRequiresRegisteredPageOwner(t *testing.T) {
	for _, mode := range []string{"missing", "wrong", "current", "legacy"} {
		t.Run(mode, func(t *testing.T) {
			e, _, _ := finalFixture(t, "ACTIVE", Millis()+5400000)
			key := commandKeys(t, e)
			transport, page := strings.Repeat("a", 64), strings.Repeat("b", 64)
			var owner monitoringOwner
			if err := e.WithState(func() error {
				a := e.state.Attempts[finalID]
				a.Transport, a.Settings.Terminals, a.BrowserSSH = transport, 4, true
				e.state.Registrations[transport] = a.Username
				owner = monitoringOwner{Attempt: a.ID, Exam: a.Exam, Username: a.Username, UID: a.UID, TransportHash: transport, Boot: boot(), PageEpoch: page, InputEpoch: strings.Repeat("c", 64), Generation: a.Generation, ClockRevision: a.ClockRevision}
				if mode != "legacy" {
					b, _ := json.Marshal(a)
					var record map[string]any
					if err := json.Unmarshal(b, &record); err != nil {
						return err
					}
					record["registered_owner"] = owner
					b, _ = json.Marshal(record)
					return json.Unmarshal(b, a)
				}
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			body := map[string]any{"id": finalID, "pane": "99999999-1234-4234-8234-123456789abc", "purpose": "exam", "username": "student", "transport": transport}
			if mode != "missing" {
				body["page_epoch"] = page
			}
			if mode == "wrong" {
				body["page_epoch"] = strings.Repeat("d", 64)
			}
			payload, _ := json.Marshal(map[string]any{"audience": "class", "nonce": Token(), "expires": Millis() + 20000, "op": "issue-channel-admission", "username": "student", "transport": transport, "body": body})
			frame := SignedFrame{Payload: base64.StdEncoding.EncodeToString(payload), Signature: base64.StdEncoding.EncodeToString(ed25519.Sign(key, payload))}
			result, err := e.Command(frame, "student", transport)
			if mode == "missing" || mode == "wrong" {
				if err == nil {
					t.Fatal("pane admission issued for a missing or different registered page owner")
				}
				if !strings.Contains(err.Error(), "owner") {
					t.Fatal("fixture did not reach owner refusal", err)
				}
				if len(e.state.Caps) != 0 {
					t.Fatal("refused ownership issued a capability")
				}
				return
			}
			if err != nil {
				t.Fatal("current/legacy signed admission refused", err)
			}
			if len(e.state.Caps) != 1 {
				t.Fatal("positive control did not issue exactly one capability", result)
			}
			if mode == "current" {
				for _, cap := range e.state.Caps {
					b, _ := json.Marshal(cap)
					var record map[string]json.RawMessage
					_ = json.Unmarshal(b, &record)
					var actual monitoringOwner
					if json.Unmarshal(record["registered_owner"], &actual) != nil || actual != owner {
						t.Fatal("capability did not preserve exact registered owner")
					}
				}
			}
		})
	}
}

func TestRegisteredOwnerFreshTLSBeginRefusalAndOriginalInterval(t *testing.T) {
	if os.Getuid() < 1000 {
		t.Skip("owner contract models student UIDs; real root/student boundary is separately qualified")
	}
	for _, mode := range []string{"current", "missing-reply-page", "wrong-reply-page", "wrong-bootstrap-owner", "missing-bootstrap", "old-reply-version", "wrong-bootstrap-sequence", "wrong-bootstrap-coverage"} {
		t.Run(mode, func(t *testing.T) {
			e, key, r := initialGrantUnpreparedFixture(t)
			read := func() *Attempt {
				value, err := e.Call("inspect-attempt", Request{ID: r.ID})
				if err != nil {
					t.Fatal(err)
				}
				return value.(*Attempt)
			}
			r.Transport, r.BrowserSSH = strings.Repeat("a", 64), true
			if err := e.WithState(func() error { e.state.Registrations[r.Transport] = r.Username; return nil }); err != nil {
				t.Fatal(err)
			}
			cmd := preparationCommand(r)
			cmd.Op = "prepare-grant-attempt"
			if _, err := e.Command(signedCommand(key, cmd), r.Username, r.Transport); err != nil {
				t.Fatal(err)
			}
			cmd.Op, cmd.Nonce = "prepare-workspace", Token()
			if _, err := e.Command(signedCommand(key, cmd), r.Username, r.Transport); err != nil {
				t.Fatal(err)
			}
			page := strings.Repeat("b", 64)
			declared := make(chan monitoringOwner, 1)
			initialGrantServer(t, e, key, func(reply grantBeginReply) (grantBeginReply, int) {
				if reply.Type != "grant-begin/v3" || reply.PageEpoch != page || reply.Bootstrap == nil {
					t.Error("fresh outbound request omitted reviewed page/provisional ownership")
					return reply, 400
				}
				declared <- reply.Bootstrap.Owner
				if mode == "missing-reply-page" {
					reply.PageEpoch = ""
				}
				if mode == "wrong-reply-page" {
					reply.PageEpoch = strings.Repeat("c", 64)
				}
				switch mode {
				case "wrong-bootstrap-owner":
					reply.Bootstrap.Owner.InputEpoch = strings.Repeat("d", 64)
				case "missing-bootstrap":
					reply.Bootstrap = nil
				case "old-reply-version":
					reply.Type = "grant-begin/v2"
				case "wrong-bootstrap-sequence":
					reply.Bootstrap.Sequence = 2
				case "wrong-bootstrap-coverage":
					reply.Bootstrap.CoverageEpoch = ""
				}
				return reply, 200
			})
			cmd.Op, cmd.Nonce = "activate-grant-attempt", Token()
			cmd.Body.GrantBeginIntent, cmd.Body.PageEpoch = "44444444-1234-4234-8234-123456789abc", page
			_, err := e.Command(signedCommand(key, cmd), r.Username, r.Transport)
			if mode != "current" {
				expected := "scope/freshness"
				if strings.Contains(mode, "bootstrap") {
					expected = "monitoring evidence"
				}
				if err == nil || !strings.Contains(err.Error(), expected) {
					t.Fatal("wrong page reply never reached the intended refusal", err)
				}
				assertUnstartedWorkspace(t, e, r.ID)
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			a := read()
			if a.RegisteredOwner == nil || a.RegisteredOwner.PageEpoch != page || !currentRegisteredOwner(a) || *a.RegisteredOwner != <-declared {
				t.Fatal("actual Begin did not persist exact registered identity")
			}
			originalStart, originalDeadline, owner := a.Start, a.OriginalDeadline, *a.RegisteredOwner
			// Lose the Begin reply and all in-memory Engine state. Inspection and
			// the exact signed retry must retain the committed owner and interval.
			e, err = New(e.Config)
			if err != nil {
				t.Fatal(err)
			}
			cmd.Nonce = Token()
			if _, err = e.Command(signedCommand(key, cmd), r.Username, r.Transport); err != nil {
				t.Fatal("exact Begin retry failed", err)
			}
			a = read()
			if a.Start != originalStart || a.OriginalDeadline != originalDeadline || *a.RegisteredOwner != owner {
				t.Fatal("retry replaced owner or authoritative interval")
			}
			cmd.Nonce, cmd.Body.PageEpoch = Token(), strings.Repeat("d", 64)
			if _, err = e.Command(signedCommand(key, cmd), r.Username, r.Transport); err == nil {
				t.Fatal("different page claimed completed Begin")
			}
			a = read()
			if a.Start != originalStart || a.OriginalDeadline != originalDeadline || *a.RegisteredOwner != owner {
				t.Fatal("refusal changed interval/owner")
			}
		})
	}
}

func TestRegisteredOwnerLeaseContinuationAndClockTransitions(t *testing.T) {
	e, _, _ := finalFixture(t, "ACTIVE", Millis()+5400000)
	key := commandKeys(t, e)
	transport, page := strings.Repeat("a", 64), strings.Repeat("b", 64)
	if err := e.WithState(func() error {
		a := e.state.Attempts[finalID]
		a.Transport = transport
		a.BrowserSSH = true
		a.Settings.Terminals = 4
		a.OriginalDeadline, a.OriginalUptimeDeadline = a.Deadline, a.UptimeDeadline
		e.state.Registrations[transport] = a.Username
		return registerPageOwner(a, page, Token())
	}); err != nil {
		t.Fatal(err)
	}
	read := func() *Attempt {
		v, err := e.Call("inspect-attempt", Request{ID: finalID})
		if err != nil {
			t.Fatal(err)
		}
		return v.(*Attempt)
	}
	original := *read()
	oldOwner := original.RegisteredOwner
	cmd := Command{Audience: "class", Nonce: Token(), Expires: Millis() + 20000, Op: "renew-owner-execution-lease", Username: "student", Transport: transport, Body: Request{ID: finalID, PageEpoch: strings.Repeat("c", 64)}}
	if _, err := e.Command(signedCommand(key, cmd), "student", transport); err == nil {
		t.Fatal("wrong page renewed execution")
	}
	cmd.Nonce, cmd.Body.PageEpoch = Token(), page
	if _, err := e.Command(signedCommand(key, cmd), "student", transport); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(e.Config.State + "/leases/" + finalID + ".json")
	if err != nil {
		t.Fatal(err)
	}
	var lease executionLease
	if json.Unmarshal(data, &lease) != nil || lease.RegisteredOwner != *oldOwner {
		t.Fatal("renewal lost exact owner scope")
	}
	if _, err = e.Call("lock-attempt", Request{ID: finalID, Reason: "Synthetic explicit policy hold"}); err != nil {
		t.Fatal(err)
	}
	locked := read()
	newTransport, newPage := strings.Repeat("d", 64), strings.Repeat("e", 64)
	register := Command{Audience: "class", Nonce: Token(), Expires: Millis() + 20000, Op: "register", Username: "student", Body: Request{Exam: "exam", Continuation: &Request{ID: finalID, Generation: locked.Generation, Expires: Millis() + 10000}}}
	if _, err = e.Command(signedCommand(key, register), "student", newTransport); err != nil {
		t.Fatal("approved fresh registration", err)
	}
	attach := Command{Audience: "class", Nonce: Token(), Expires: Millis() + 20000, Op: "attach-transport", Username: "student", Transport: newTransport, Body: Request{ID: finalID, Username: "student", Transport: newTransport, Generation: locked.Generation}}
	if _, err = e.Command(signedCommand(key, attach), "student", newTransport); err != nil {
		t.Fatal(err)
	}
	resume := Command{Audience: "class", Nonce: Token(), Expires: Millis() + 20000, Op: "consume-owner-continuation", Username: "student", Transport: newTransport, Body: Request{ID: finalID, Generation: locked.Generation}}
	if _, err = e.Command(signedCommand(key, resume), "student", newTransport); err == nil {
		t.Fatal("continuation without current page thawed")
	}
	resume.Nonce, resume.Body.PageEpoch = Token(), newPage
	if _, err = e.Command(signedCommand(key, resume), "student", newTransport); err != nil {
		t.Fatal(err)
	}
	continued := read()
	if !currentRegisteredOwner(continued) || continued.RegisteredOwner.InputEpoch == oldOwner.InputEpoch || continued.RegisteredOwner.PageEpoch != newPage || continued.Start != original.Start || continued.OriginalDeadline != original.Deadline {
		t.Fatal("continuation lost original interval or fresh owner")
	}
	beforeClock := continued.RegisteredOwner
	if _, err = e.Call("reset-clock", Request{ID: finalID, ResetID: ManagementID(), Actor: "synthetic-instructor", RequestedAt: Millis(), ExtendSeconds: 60, Deadline: continued.Deadline, ClockRevision: continued.ClockRevision}); err != nil {
		t.Fatal(err)
	}
	updated := read()
	if updated.RegisteredOwner == beforeClock || updated.RegisteredOwner.ClockRevision != updated.ClockRevision || beforeClock.ClockRevision != continued.ClockRevision || updated.OriginalDeadline != original.Deadline {
		t.Fatal("clock mutated a captured owner pointer or original deadline")
	}
	// Old recorded renewal cannot manufacture authority for a later owner.
	updated.Lease = Millis() + 1000
	if err = e.applyExecutionLease(updated); err != nil {
		t.Fatal(err)
	}
	if updated.Lease > Millis()+1100 {
		t.Fatal("old owner renewal applied after continuation/clock transition")
	}
}

func TestRegisteredOwnerClosedReleaseRejectsLateIdentityChange(t *testing.T) {
	for _, mode := range []string{"same", "page", "epoch", "missing", "contradictory-cap"} {
		t.Run(mode, func(t *testing.T) {
			e, key, cmd, _, _ := paneAdmissionFixture(t)
			transport, page := strings.Repeat("a", 64), strings.Repeat("b", 64)
			if err := e.WithState(func() error {
				a := e.state.Attempts[finalID]
				a.Transport = transport
				e.state.Registrations[transport] = a.Username
				return registerPageOwner(a, page, Token())
			}); err != nil {
				t.Fatal(err)
			}
			cmd.Op, cmd.Nonce, cmd.Transport = "issue-owner-channel-admission", Token(), transport
			cmd.Body.Transport, cmd.Body.PageEpoch = transport, page
			value, err := e.Command(signedCommand(key, cmd), "student", transport)
			if err != nil {
				t.Fatal(err)
			}
			token := value.(map[string]string)["token"]
			var pending *paneLaunchAdmission
			if err := e.WithState(func() error {
				account, _ := e.account("student")
				cap, a, err := e.paneAdmission(token, "student", transport, account)
				if err != nil {
					return err
				}
				pending = &paneLaunchAdmission{capability: cap, account: account, authority: paneLaunchAuthority(a)}
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			if err := e.WithState(func() error {
				a := e.state.Attempts[finalID]
				o := *a.RegisteredOwner
				switch mode {
				case "page":
					o.PageEpoch = strings.Repeat("c", 64)
					a.RegisteredOwner = &o
				case "epoch":
					o.InputEpoch = Token()
					a.RegisteredOwner = &o
				case "missing":
					a.RegisteredOwner = nil
				case "contradictory-cap":
					cap := e.state.Caps[Hash([]byte(token))]
					cap.RegisteredOwner = monitoringOwner{}
					e.state.Caps[Hash([]byte(token))] = cap
				}
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			started := false
			err = e.launchAcknowledgedPane(pending, token, "student", "exam-"+finalID+"-"+finalID+"-"+ManagementID()+".scope", func(Account) (string, error) { return transport, nil }, func(*Attempt, Capability) (bool, error) { started = true; return true, nil })
			if mode == "same" {
				if err != nil || !started {
					t.Fatal("unchanged current owner did not release", err)
				}
			} else if err == nil || started {
				t.Fatal("late owner change released code", mode, err)
			}
		})
	}
}

func TestRegisteredOwnerRefusesPrematureIdentityBeforeClock(t *testing.T) {
	if os.Getuid() < 1000 {
		t.Skip("student owner contract requires UID >=1000")
	}
	e, key, r := initialGrantUnpreparedFixture(t)
	r.Transport, r.BrowserSSH = strings.Repeat("a", 64), true
	if err := e.WithState(func() error { e.state.Registrations[r.Transport] = r.Username; return nil }); err != nil {
		t.Fatal(err)
	}
	cmd := preparationCommand(r)
	cmd.Op = "prepare-grant-attempt"
	if _, err := e.Command(signedCommand(key, cmd), r.Username, r.Transport); err != nil {
		t.Fatal(err)
	}
	page := strings.Repeat("b", 64)
	cmd.Op, cmd.Nonce = "prepare-workspace", Token()
	if _, err := e.Command(signedCommand(key, cmd), r.Username, r.Transport); err != nil {
		t.Fatal(err)
	}
	if err := e.WithState(func() error { return registerPageOwner(e.state.Attempts[r.ID], page, Token()) }); err != nil {
		t.Fatal(err)
	}
	cmd.Op, cmd.Nonce, cmd.Body.PageEpoch, cmd.Body.GrantBeginIntent = "activate-grant-attempt", Token(), page, "44444444-1234-4234-8234-123456789abc"
	if _, err := e.Command(signedCommand(key, cmd), r.Username, r.Transport); err != errRegisteredOwner {
		t.Fatal("contradictory preparation reached clock/publication", err)
	}
	a := e.state.Attempts[r.ID]
	if a.Start != 0 || a.Deadline != 0 || a.OriginalDeadline != 0 || a.State != "PREPARING" {
		t.Fatal("refused registration consumed an interval", a)
	}
}

func TestRegisteredOwnerRenewalPreservesIntentionalLockedState(t *testing.T) {
	e, _, _ := finalFixture(t, "ACTIVE", Millis()+5400000)
	key := commandKeys(t, e)
	transport, page := strings.Repeat("a", 64), strings.Repeat("b", 64)
	if err := e.WithState(func() error {
		a := e.state.Attempts[finalID]
		a.Transport = transport
		e.state.Registrations[transport] = a.Username
		return registerPageOwner(a, page, Token())
	}); err != nil {
		t.Fatal(err)
	}
	reason := "administrator: synthetic intentional review"
	if _, err := e.Call("lock-attempt", Request{ID: finalID, Reason: reason}); err != nil {
		t.Fatal(err)
	}
	generation := e.state.Attempts[finalID].Generation
	cmd := Command{Audience: "class", Nonce: Token(), Expires: Millis() + 20000, Op: "renew-owner-execution-lease", Username: "student", Transport: transport, Body: Request{ID: finalID, PageEpoch: page}}
	result, err := e.Command(signedCommand(key, cmd), "student", transport)
	a, ok := result.(*Attempt)
	if err == nil || !ok || a.State != "LOCKED" || a.Reason != reason || a.Generation != generation {
		t.Fatal("renewal obscured authenticated intentional state as an ownership failure", result, err)
	}
}
