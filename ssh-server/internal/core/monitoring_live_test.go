package core

import (
	"context"
	"os"
	"sync"
	"testing"
	"time"
)

// C10: a complete scoped verified proof must be effective in the live authority
// before an optional storage worker can stall. This arbiter is still unwired.
func TestMonitoringLiveRenewalDoesNotWaitForPublication(t *testing.T) {
	f := nativeAuthorityFixture(t, false, 5000)
	p := f.proof(t, 4, 0)
	_, err := f.a.accept(p)
	if err != nil {
		t.Fatal(err)
	}
	if v := f.a.check(); !v.ExecutionAuthorized || v.AuthorityUntilMS != p.UntilUptimeMS || v.Sequence != p.Sequence {
		t.Fatal("verified renewal still waits for storage publication", v)
	}
	f.clock.Store(5000)
	if v := f.a.check(); !v.ExecutionAuthorized || len(v.Causes) != 0 {
		t.Fatal("old storage cutoff falsely revoked a verified live renewal", v)
	}
}

func TestMonitoringLiveConcurrentIdenticalEvidenceHasOneImmutableOutcome(t *testing.T) {
	f := nativeAuthorityFixture(t, false, 5000)
	p := f.proof(t, 4, 0)
	type result struct {
		receipt monitoringCommitReceipt
		err     error
	}
	out := make(chan result, 32)
	var tasks sync.WaitGroup
	for range 32 {
		tasks.Go(func() {
			r, err := f.a.accept(p)
			out <- result{r, err}
		})
	}
	tasks.Wait()
	close(out)
	var original monitoringCommitReceipt
	for r := range out {
		if r.err != nil {
			t.Fatal("identical verified retry rejected", r.err)
		}
		if original.Nonce == "" {
			original = r.receipt
		}
		if r.receipt != original || r.receipt.AcceptedRevision != 2 || r.receipt.UntilUptimeMS != 16000 {
			t.Fatal("concurrent retry created a fresh/different outcome", r.receipt)
		}
	}
	if v := f.a.check(); v.Revision != 2 || v.Sequence != 4 || v.PublicationPending || !v.ExecutionAuthorized {
		t.Fatal("memory acceptance required publication or duplicated transition", v)
	}
}

func TestMonitoringLiveSignedRenewalsContinueWhileActualPublisherIsBlocked(t *testing.T) {
	p := newMonitoringPublishFixture(t, "", "")
	proof := p.f.proof(t, 4, 0)
	ticket := p.f.prepare(t, proof)
	original, _, ok := p.f.a.receipt(proof.Nonce)
	if !ok {
		t.Fatal("live outcome missing before publication")
	}
	done := make(chan error, 1)
	go func() {
		_, err := publishMonitoringTicket(context.Background(), p.claim, p.state, ticket, monitoringPublishTestOptions("wait"))
		done <- err
	}()
	drained := false
	t.Cleanup(func() {
		_ = os.WriteFile(monitoringPublisherTestMarker(p.state, "release"), nil, 0600)
		if !drained {
			select {
			case <-done:
			case <-time.After(3 * time.Second):
				t.Error("owned publisher did not drain")
			}
		}
	})
	waitMonitoringPublisherMarker(t, p.state, "wait")
	var latest monitoringCommitReceipt
	for sequence := uint64(5); sequence <= 10; sequence++ {
		p.f.clock.Store(int64(sequence-3) * 1000)
		fresh := p.f.proof(t, sequence, 0) // Real Ed25519 verification; model owner/clock.
		at := time.Now()
		var err error
		latest, err = p.f.a.accept(fresh)
		if err != nil || time.Since(at) > time.Second {
			t.Fatal("accepted evidence waited for actual blocked publisher", err)
		}
		if _, err := p.f.a.preparePublication(fresh.Nonce); err != errMonitoringBusy {
			t.Fatal("bounded metadata slot did not remain separate from live acceptance", err)
		}
		if v := p.f.a.check(); !v.ExecutionAuthorized || v.Sequence != sequence || v.AuthorityUntilMS != latest.UntilUptimeMS || !v.PublicationPending || len(v.Causes) != 0 {
			t.Fatal("old cutoff or storage status changed verified authority", v)
		}
	}
	if err := os.WriteFile(monitoringPublisherTestMarker(p.state, "release"), nil, 0600); err != nil {
		t.Fatal(err)
	}
	if err := <-done; err != nil {
		t.Fatal("delayed metadata did not acknowledge original accepted bytes", err)
	}
	drained = true
	if retry, err := p.f.a.accept(proof); err != nil || retry != original {
		t.Fatal("retry refreshed the original outcome", retry, err)
	}
	if v := p.f.a.check(); !v.ExecutionAuthorized || v.Sequence != 10 || v.AuthorityUntilMS != latest.UntilUptimeMS || v.PublicationPending {
		t.Fatal("old publication overwrote newer live permission", v)
	}
	newest, err := p.f.a.preparePublication(latest.Nonce)
	if err != nil {
		t.Fatal(err)
	}
	if r, err := publishMonitoringTicket(context.Background(), p.claim, p.state, newest, monitoringPublishTestOptions("normal")); err != nil || r != latest {
		t.Fatal("coalesced newest metadata changed the live outcome", r, err)
	}
	// A stored receipt remains insufficient to manufacture a new live owner.
	if restored, err := newMonitoringAuthority(p.f.context, func() (int64, error) { return p.f.clock.Load(), nil }); restored != nil || err == nil {
		t.Fatal("published data/reused context recreated live authority", err)
	}
}

func TestMonitoringLiveRetiredPublicationCannotLaunchAgainstNewPendingTicket(t *testing.T) {
	p := newMonitoringPublishFixture(t, "", "")
	old := p.f.prepare(t, p.f.proof(t, 4, 0))
	if err := p.f.a.publicationFailed(old); err != nil {
		t.Fatal(err)
	}
	p.f.clock.Store(2000)
	current := p.f.prepare(t, p.f.proof(t, 5, 0))
	opts := monitoringPublishTestOptions("normal")
	command := opts.command
	launches := 0
	opts.command = func(unit string) []string { launches++; return command(unit) }
	if _, err := publishMonitoringTicket(context.Background(), p.claim, p.state, old, opts); err == nil || launches != 0 {
		t.Fatal("retired metadata ticket launched against a newer pending operation", err, launches)
	}
	if v := p.f.a.check(); !v.ExecutionAuthorized || v.Sequence != 5 || v.AuthorityUntilMS != 17000 || !v.PublicationPending {
		t.Fatal("old ticket changed current live/publication state", v)
	}
	if _, err := publishMonitoringTicket(context.Background(), p.claim, p.state, current, monitoringPublishTestOptions("normal")); err != nil {
		t.Fatal("retired ticket interfered with current publication", err)
	}
}
