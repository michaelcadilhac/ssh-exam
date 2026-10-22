package core

import (
	"bytes"
	"crypto/ed25519"
	"encoding/json"
	"errors"
	"math"
	"reflect"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type authorityFixture struct {
	a       *monitoringAuthority
	clock   *atomic.Int64
	pub     ed25519.PublicKey
	key     ed25519.PrivateKey
	context monitoringActiveContext
}

// Synthetic model seal only. There is deliberately no production factory that
// turns persisted context/strings into verified live native ownership.
func sealedAuthorityTestContext(c monitoringActiveContext) monitoringActiveContext {
	c.verified = &monitoringActiveSeal{fingerprint: monitoringContextHash(c), current: func() bool { return true }}
	return c
}

func nativeAuthorityFixture(t *testing.T, bootstrap bool, until int64) authorityFixture {
	t.Helper()
	pub, key, c, _ := evidenceFixture(t)
	clock := &atomic.Int64{}
	clock.Store(1000)
	x := monitoringActiveContext{Agent: "class", Owner: c.Owner, CoverageEpoch: c.CoverageEpoch, Sequence: 3, AuthorityUntilMS: until, DeadlineUptimeMS: 90000}
	if bootstrap {
		x.CoverageEpoch = ""
		x.Sequence = 0
	}
	x = sealedAuthorityTestContext(x)
	a, err := newMonitoringAuthority(x, func() (int64, error) { return clock.Load(), nil })
	if err != nil {
		t.Fatal(err)
	}
	return authorityFixture{a, clock, pub, key, x}
}
func (f authorityFixture) proof(t *testing.T, sequence uint64, age int64) monitoringPermitCandidate {
	t.Helper()
	c, err := f.a.challenge()
	if err != nil {
		t.Fatal(err)
	}
	coverage := c.CoverageEpoch
	if coverage == "" {
		coverage = strings.Repeat("e", 64)
	}
	p := monitoringEvidence{Type: "monitoring-execution-evidence-v1", Audience: c.Agent, Nonce: c.Nonce, Owner: c.Owner, CoverageEpoch: coverage, Sequence: sequence, AgeMS: age, Complete: true}
	candidate, err := verifyMonitoringEvidence(signEvidence(t, f.key, p), f.pub, c, f.clock.Load())
	if err != nil {
		t.Fatal(err)
	}
	return candidate
}
func (f authorityFixture) prepare(t *testing.T, p monitoringPermitCandidate) *monitoringCommitTicket {
	t.Helper()
	ticket, original, err := f.a.prepare(p)
	if err != nil || ticket == nil || original != nil {
		t.Fatal(ticket, original, err)
	}
	return ticket
}
func (f authorityFixture) commit(t *testing.T, p monitoringPermitCandidate) monitoringCommitReceipt {
	t.Helper()
	ticket := f.prepare(t, p)
	r, err := f.a.published(ticket, ticket.publicationHash)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func TestMonitoringAuthorityBootstrapCannotAuthorizeWorkOrInheritUnverifiedAllowance(t *testing.T) {
	f := nativeAuthorityFixture(t, true, 5000)
	if v := f.a.check(); v.Phase != "awaiting-evidence" || v.ExecutionAuthorized {
		t.Fatal("bootstrap was treated as work permission", v)
	}
	p := f.proof(t, 1, 12000) // Fixed candidate cutoff4000, shorter than prior bootstrap5000.
	ticket := f.prepare(t, p)
	if f.a.check().ExecutionAuthorized {
		t.Fatal("provisional publication granted work")
	}
	r, err := f.a.published(ticket, ticket.publicationHash)
	if err != nil || r.UntilUptimeMS != p.UntilUptimeMS || !f.a.check().ExecutionAuthorized {
		t.Fatal("bootstrap allowance leaked past verified evidence cutoff", r, p.UntilUptimeMS, err)
	}
}

func TestMonitoringAuthorityRenewalSupersedesOldCutoffAndRetriesKeepOriginalOutcome(t *testing.T) {
	f := nativeAuthorityFixture(t, false, 5000)
	p := f.proof(t, 4, 0)
	ticket := f.prepare(t, p)
	if v := f.a.check(); v.AuthorityUntilMS != 5000 || !v.PublicationPending {
		t.Fatal("prepare extended permission", v)
	}
	r, err := f.a.published(ticket, ticket.publicationHash)
	if err != nil || r.UntilUptimeMS != 16000 {
		t.Fatal(r, err)
	}
	f.clock.Store(3000)
	newer := f.proof(t, 5, 0)
	later := f.commit(t, newer)
	if later.UntilUptimeMS != 18000 {
		t.Fatal(later)
	}
	for range 3 {
		next, old, err := f.a.prepare(p)
		if err != nil || next != nil || old == nil || *old != r {
			t.Fatal("retry freshened original outcome", next, old, err)
		}
		duplicate, err := f.a.published(ticket, ticket.publicationHash)
		if err != nil || duplicate != r {
			t.Fatal("duplicate acknowledgement freshened outcome", duplicate, err)
		}
	}
	f.clock.Store(5000)
	if v := f.a.check(); v.Phase != "active" || v.AuthorityUntilMS != 18000 || !v.ExecutionAuthorized {
		t.Fatal("old cutoff revoked a healthy committed renewal", v)
	}
	old, current, ok := f.a.receipt(p.Nonce)
	if !ok || old != r || current.AuthorityUntilMS != 18000 {
		t.Fatal("history conflated with current authority", old, current, ok)
	}
}

func TestMonitoringAuthorityActiveOutOfOrderCandidateCannotShortenExistingPermission(t *testing.T) {
	f := nativeAuthorityFixture(t, false, 5000)
	p := f.proof(t, 4, 12000)
	if p.UntilUptimeMS != 4000 {
		t.Fatal(p)
	}
	r := f.commit(t, p)
	if r.UntilUptimeMS != 5000 || f.a.check().AuthorityUntilMS != 5000 {
		t.Fatal("older but valid evidence shortened current permission", r)
	}
}

func TestMonitoringAuthorityBlockedPublicationCannotDelayRevocationOrLateSuccessReviveIt(t *testing.T) {
	f := nativeAuthorityFixture(t, false, 5000)
	p := f.proof(t, 4, 0)
	ticket := f.prepare(t, p)
	blocked, release := make(chan struct{}), make(chan struct{})
	finished := make(chan error, 1)
	go func() {
		close(blocked)
		<-release
		_, err := f.a.published(ticket, ticket.publicationHash)
		finished <- err
	}()
	<-blocked
	f.clock.Store(5000)
	checked := make(chan monitoringAuthorityView, 1)
	go func() { checked <- f.a.check() }()
	select {
	case v := <-checked:
		if v.Phase != "revoking" || v.ExecutionAuthorized || v.AuthorityUntilMS != 5000 || !reflect.DeepEqual(v.Causes, []string{"technical-expiry"}) {
			close(release)
			t.Fatal(v)
		}
	case <-time.After(time.Second):
		close(release)
		t.Fatal("cutoff waited on publication IO")
	}
	close(release)
	if err := <-finished; err != errMonitoringAuthority {
		t.Fatal("late publication revived permission", err)
	}
	if _, _, err := f.a.prepare(p); err != errMonitoringAuthority {
		t.Fatal("revocation undone by replay", err)
	}
}

func TestMonitoringAuthorityPublicationFailureOrWrongReplyPreservesOnlyOldAllowance(t *testing.T) {
	for _, wrongReply := range []bool{false, true} {
		f := nativeAuthorityFixture(t, false, 5000)
		p := f.proof(t, 4, 0)
		old := f.prepare(t, p)
		if wrongReply {
			if _, err := f.a.published(old, "PRIVATE-WRONG-REPLY"); err != errMonitoringPublication {
				t.Fatal(err)
			}
		} else if err := f.a.publicationFailed(old); err != nil {
			t.Fatal(err)
		}
		v := f.a.check()
		if v.Phase != "active" || v.AuthorityUntilMS != 5000 || !v.ExecutionAuthorized || !v.PublicationFailureObserved || v.PublicationPending {
			t.Fatal("unconfirmed publication caused early lock or fresh allowance", v)
		}
		f.clock.Store(2000)
		newer := f.proof(t, 4, 0)
		current := f.prepare(t, newer)
		if _, err := f.a.published(old, old.publicationHash); err != errMonitoringPublication {
			t.Fatal("retired worker completion reached replacement", err)
		}
		if _, err := f.a.published(current, current.publicationHash); err != nil {
			t.Fatal(err)
		}
		if f.a.check().AuthorityUntilMS != 17000 {
			t.Fatal("replacement did not preserve its fixed cutoff")
		}
		if err := f.a.publicationFailed(old); err != errMonitoringPublication || f.a.check().PublicationFailureObserved {
			t.Fatal("late retired error reopened a resolved publication fault", err)
		}
	}
}

func TestMonitoringAuthorityOnlyOwnIssuedChallengesAndCurrentCoverageCanCommit(t *testing.T) {
	f := nativeAuthorityFixture(t, false, 16000)
	other := nativeAuthorityFixture(t, false, 16000)
	foreign := other.proof(t, 4, 0)
	if _, _, err := f.a.prepare(foreign); err != errMonitoringScope {
		t.Fatal("foreign challenge accepted", err)
	}
	p := f.proof(t, 4, 0)
	for _, change := range []func(*monitoringPermitCandidate){
		func(p *monitoringPermitCandidate) { p.Owner.UID++ }, func(p *monitoringPermitCandidate) { p.Owner.ClockRevision++ }, func(p *monitoringPermitCandidate) { p.Owner.InputEpoch = strings.Repeat("f", 64) },
		func(p *monitoringPermitCandidate) { p.CoverageEpoch = strings.Repeat("f", 64) }, func(p *monitoringPermitCandidate) { p.Sequence = 3 }, func(p *monitoringPermitCandidate) { p.Sequence = monitoringEvidenceMaxSequence + 1 },
		func(p *monitoringPermitCandidate) { p.UntilUptimeMS = 1000 }, func(p *monitoringPermitCandidate) { p.UntilUptimeMS = 16001 }, func(p *monitoringPermitCandidate) { p.Nonce = strings.Repeat("f", 64) },
	} {
		bad := p
		change(&bad)
		if _, _, err := f.a.prepare(bad); err == nil {
			t.Fatal("unsafe candidate accepted")
		}
	}
	ticket := f.prepare(t, p)
	same, old, err := f.a.prepare(p)
	if err != nil || same != ticket || old != nil {
		t.Fatal("pending retry duplicated publication", err)
	}
	newer := f.proof(t, 5, 0)
	if _, _, err := f.a.prepare(newer); err != errMonitoringBusy {
		t.Fatal("pending publication not bounded", err)
	}
	if _, err := other.a.published(ticket, ticket.publicationHash); err != errMonitoringScope {
		t.Fatal("foreign ticket accepted", err)
	}
	if _, err := f.a.published(ticket, ticket.publicationHash); err != nil {
		t.Fatal(err)
	}
	changed := p
	changed.UntilUptimeMS--
	if _, _, err := f.a.prepare(changed); err != errMonitoringScope {
		t.Fatal("changed original receipt accepted", err)
	}
}

func TestMonitoringAuthorityChallengeCapacityPrunesWithoutNonceReuseOrAllowanceRefresh(t *testing.T) {
	f := nativeAuthorityFixture(t, false, 16000)
	seen := map[string]bool{}
	for range 16 {
		c, err := f.a.challenge()
		if err != nil || seen[c.Nonce] {
			t.Fatal(c, err)
		}
		seen[c.Nonce] = true
	}
	if _, err := f.a.challenge(); err != errMonitoringCapacity {
		t.Fatal("challenge bound not enforced", err)
	}
	f.clock.Store(6000)
	c, err := f.a.challenge()
	if err != nil || seen[c.Nonce] || c.AfterSequence != 3 || c.AuthorityUntilMS != 16000 {
		t.Fatal("prune reused nonce or refreshed prior allowance", c, err)
	}
	if len(f.a.challenges) != 1 {
		t.Fatal("expired challenge metadata accumulated")
	}
}

func TestMonitoringAuthorityReceiptCapacityPrunesOnlyExpiredOutcomesAndKeepsWatermark(t *testing.T) {
	f := nativeAuthorityFixture(t, false, 5000)
	first := ""
	for n := uint64(4); n < 36; n++ {
		if n == 35 {
			f.clock.Store(2000)
		}
		p := f.proof(t, n, 0)
		if first == "" {
			first = p.Nonce
		}
		f.commit(t, p)
	}
	p := f.proof(t, 36, 0)
	if _, _, err := f.a.prepare(p); err != errMonitoringCapacity {
		t.Fatal("unexpired outcomes evicted", err)
	}
	f.clock.Store(16000)
	fresh := f.proof(t, 36, 0)
	f.commit(t, fresh)
	if len(f.a.committed) > 2 || f.a.check().Sequence != 36 {
		t.Fatal("receipt pruning lost bounds/watermark")
	}
	if _, _, ok := f.a.receipt(first); ok {
		t.Fatal("expired outcome not pruned")
	}
}

func TestMonitoringAuthorityPolicyAuthDeadlineAndClockCannotBecomeAutomaticTechnicalRecovery(t *testing.T) {
	for _, cause := range []string{"policy-condition", "authentication-loss", "operator-pause", "recording-failure"} {
		f := nativeAuthorityFixture(t, false, 5000)
		p := f.proof(t, 4, 0)
		ticket := f.prepare(t, p)
		v, err := f.a.revokeForVerifiedCause(cause)
		if err != nil || v.ExecutionAuthorized || v.Phase != "revoking" {
			t.Fatal(v, err)
		}
		revision := v.Revision
		again, _ := f.a.revokeForVerifiedCause(cause)
		if again.Revision != revision {
			t.Fatal("duplicate cause advanced review scope")
		}
		if _, err := f.a.published(ticket, ticket.publicationHash); err != errMonitoringAuthority {
			t.Fatal("late success undid actual verified cause", err)
		}
	}
	f := nativeAuthorityFixture(t, false, 5000)
	if v, err := f.a.revokeForVerifiedCause("missing-reply"); err != errMonitoringScope || !v.ExecutionAuthorized {
		t.Fatal("timeout misclassified as verified violation", v, err)
	}
	f.clock.Store(90000)
	v := f.a.check()
	if v.ExecutionAuthorized || !reflect.DeepEqual(v.Causes, []string{"deadline"}) {
		t.Fatal(v)
	}
	f = nativeAuthorityFixture(t, false, 5000)
	f.clock.Store(999)
	v = f.a.check()
	if v.ExecutionAuthorized || !reflect.DeepEqual(v.Causes, []string{"clock-unknown"}) {
		t.Fatal(v)
	}
	_, _, c, _ := evidenceFixture(t)
	a, err := newMonitoringAuthority(sealedAuthorityTestContext(monitoringActiveContext{Agent: "class", Owner: c.Owner, Sequence: 3, CoverageEpoch: c.CoverageEpoch, AuthorityUntilMS: 5000, DeadlineUptimeMS: 90000}), func() (int64, error) { return 1234, errors.New("PRIVATE-CLOCK") })
	if a != nil || err != errMonitoringAuthority {
		t.Fatal("unknown clock constructed positive authority", err)
	}
}

func TestMonitoringAuthorityEntropyAndInitialContextFailureDoNotInventAnIncarnationOrTime(t *testing.T) {
	f := nativeAuthorityFixture(t, false, 5000)
	for _, entropy := range []*bytes.Reader{bytes.NewReader(nil), bytes.NewReader([]byte("PRIVATE"))} {
		if a, err := newMonitoringAuthorityWithEntropy(f.context, func() (int64, error) { return 1000, nil }, entropy); a != nil || err != errMonitoringAuthority {
			t.Fatal("short entropy accepted/leaked", err)
		}
	}
	for _, change := range []func(*monitoringActiveContext){func(c *monitoringActiveContext) { c.Owner.UID = 999 }, func(c *monitoringActiveContext) { c.AuthorityUntilMS = 1000 }, func(c *monitoringActiveContext) { c.AuthorityUntilMS = 16001 }, func(c *monitoringActiveContext) { c.DeadlineUptimeMS = 4000 }, func(c *monitoringActiveContext) { c.CoverageEpoch = "" }} {
		c := f.context
		change(&c)
		if a, err := newMonitoringAuthority(c, func() (int64, error) { return 1000, nil }); a != nil || err == nil {
			t.Fatal("unsafe initial active context accepted")
		}
	}
}

func TestMonitoringAuthorityPublicationExpiryOrMutableWorkerCopyCannotAddPermission(t *testing.T) {
	f := nativeAuthorityFixture(t, false, 16000)
	p := f.proof(t, 4, 0)
	ticket := f.prepare(t, p)
	before, expected := ticket.publicationBytes()
	copy, again := ticket.publicationBytes()
	copy[0] = 'X'
	after, _ := ticket.publicationBytes()
	if !bytes.Equal(before, after) || again != expected || Hash(before) != expected {
		t.Fatal("worker got mutable arbiter state")
	}
	f.clock.Store(6000) // Request expired; previous committed authority is still valid.
	if _, err := f.a.published(ticket, expected); err != errMonitoringPublication {
		t.Fatal("expired publication applied", err)
	}
	if v := f.a.check(); v.Phase != "active" || !v.ExecutionAuthorized || v.AuthorityUntilMS != 16000 || v.Sequence != 3 {
		t.Fatal("expired request caused early hold or fresh allowance", v)
	}
	p = f.proof(t, 4, 0)
	f.commit(t, p)
	if v := f.a.check(); v.PublicationFailureObserved || v.AuthorityUntilMS != 21000 {
		t.Fatal("fresh confirmed publication did not resolve its fault", v)
	}
}

func TestMonitoringAuthorityClockFailureAndExactDeadlineFencePendingPublication(t *testing.T) {
	f := nativeAuthorityFixture(t, false, 5000)
	failed := &atomic.Bool{}
	a, err := newMonitoringAuthority(sealedAuthorityTestContext(f.context), func() (int64, error) {
		if failed.Load() {
			return f.clock.Load(), errors.New("PRIVATE-CLOCK-DETAIL")
		}
		return f.clock.Load(), nil
	})
	if err != nil {
		t.Fatal(err)
	}
	f.a = a
	p := f.proof(t, 4, 0)
	ticket := f.prepare(t, p)
	failed.Store(true)
	if _, err := a.published(ticket, ticket.publicationHash); err != errMonitoringAuthority {
		t.Fatal("clock error committed permission", err)
	}
	if v := a.check(); v.ExecutionAuthorized || !reflect.DeepEqual(v.Causes, []string{"clock-unknown"}) {
		t.Fatal(v)
	}
	f = nativeAuthorityFixture(t, false, 5000)
	c := f.context
	c.DeadlineUptimeMS = 5000
	c = sealedAuthorityTestContext(c)
	f.a, err = newMonitoringAuthority(c, func() (int64, error) { return f.clock.Load(), nil })
	if err != nil {
		t.Fatal(err)
	}
	p = f.proof(t, 4, 0)
	ticket = f.prepare(t, p)
	f.clock.Store(5000)
	if _, err := f.a.published(ticket, ticket.publicationHash); err != errMonitoringAuthority {
		t.Fatal("exact deadline accepted late publication", err)
	}
	if v := f.a.check(); v.ExecutionAuthorized || !reflect.DeepEqual(v.Causes, []string{"deadline"}) {
		t.Fatal(v)
	}
}

func TestMonitoringAuthorityNativeTimeArithmeticRemainsBoundedNearMaxInt64(t *testing.T) {
	f := nativeAuthorityFixture(t, false, 5000)
	f.clock.Store(math.MaxInt64 - 100)
	c := f.context
	c.AuthorityUntilMS = math.MaxInt64
	c.DeadlineUptimeMS = math.MaxInt64
	c = sealedAuthorityTestContext(c)
	a, err := newMonitoringAuthority(c, func() (int64, error) { return f.clock.Load(), nil })
	if err != nil {
		t.Fatal(err)
	}
	f.a = a
	p := f.proof(t, 4, 14900)
	r := f.commit(t, p)
	if r.UntilUptimeMS != math.MaxInt64 {
		t.Fatal("native cutoff overflow", r)
	}
	f.clock.Store(math.MaxInt64)
	if v := f.a.check(); v.ExecutionAuthorized || v.Phase != "revoking" {
		t.Fatal("overflow reopened deadline", v)
	}
}

func TestMonitoringAuthorityContextCannotBeRestoredReusedOrOutliveCurrentOwnership(t *testing.T) {
	f := nativeAuthorityFixture(t, false, 5000)
	encoded, _ := json.Marshal(f.context)
	var restored monitoringActiveContext
	if json.Unmarshal(encoded, &restored) != nil {
		t.Fatal("invalid synthetic context JSON")
	}
	clock := func() (int64, error) { return f.clock.Load(), nil }
	if a, err := newMonitoringAuthority(restored, clock); a != nil || err == nil {
		t.Fatal("persisted data reconstructed live authority")
	}
	if a, err := newMonitoringAuthority(f.context, clock); a != nil || err == nil {
		t.Fatal("one-use verified context created duplicate arbiters")
	}
	current := &atomic.Bool{}
	current.Store(true)
	c := sealedAuthorityTestContext(f.context)
	c.verified.current = current.Load
	a, err := newMonitoringAuthority(c, clock)
	if err != nil {
		t.Fatal(err)
	}
	f.a = a
	p := f.proof(t, 4, 0)
	ticket := f.prepare(t, p)
	current.Store(false)
	if _, err := a.published(ticket, ticket.publicationHash); err != errMonitoringAuthority {
		t.Fatal("unknown owner extended authority", err)
	}
	current.Store(true)
	if v := a.check(); v.ExecutionAuthorized || v.Phase != "revoking" || !reflect.DeepEqual(v.Causes, []string{"ownership-unknown"}) {
		t.Fatal("later good owner query revived unknown scope", v)
	}
}
