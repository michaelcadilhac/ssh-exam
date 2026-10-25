package core

// Live authority inside the existing attempt supervisor. Begin and approved
// Continue establish verified contexts; a clock-only handover preserves facts.
// Persistence stays outside this lock. Provisional records alone never restore
// execution permission after a crash; writer hold/thaw is a separate barrier.

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"sort"
	"strconv"
	"sync"
	"sync/atomic"
)

var (
	errMonitoringAuthority   = errors.New("native monitoring authority is revoked or unknown; no permission established")
	errMonitoringScope       = errors.New("native monitoring scope, sequence or challenge rejected; current authority unchanged")
	errMonitoringBusy        = errors.New("native monitoring publication already pending; no new allowance or queued commit")
	errMonitoringPublication = errors.New("native monitoring publication unconfirmed or superseded; verified live authority unchanged")
	errMonitoringCapacity    = errors.New("native monitoring receipt/challenge capacity reached; no current owner evicted")
)

type monitoringActiveContext struct {
	Agent                              string
	Owner                              monitoringOwner
	CoverageEpoch                      string
	PolicyReports                      string // Verified by fresh signed Begin/Continue, not disk restoration.
	Sequence                           uint64
	AuthorityUntilMS, DeadlineUptimeMS int64
	verified                           *monitoringActiveSeal   // Not JSON-restorable.
	cutoff                             *monitoringSharedCutoff // Same live word for authority and independent watchdog.
}

// The trusted Begin/Continue verifier must establish exclusive current owner/peer
// and ACTIVE authority before constructing this one-use context. Its predicate
// must be nonblocking and return false on uncertainty, not assume cached strings
// prove liveness. This is a programming fence, NOT a substitute for that verifier.
type monitoringActiveSeal struct {
	fingerprint string
	current     func() bool
	consumed    atomic.Bool
}

func monitoringContextHash(c monitoringActiveContext) string { b, _ := json.Marshal(c); return Hash(b) }

// Private provisional publication data, not a signed execution receipt. The
// bounded publisher observes live acceptance; disk bytes cannot restore authority.
type monitoringPublication struct {
	Version          int             `json:"version"`
	Incarnation      string          `json:"incarnation"`
	Owner            monitoringOwner `json:"owner"`
	Nonce            string          `json:"nonce"`
	Sequence         uint64          `json:"sequence"`
	CoverageEpoch    string          `json:"coverage_epoch"`
	CandidateUntilMS int64           `json:"candidate_until_ms"`
	EffectiveUntilMS int64           `json:"effective_until_ms"`
	PreparedRevision uint64          `json:"prepared_revision"`
}

type monitoringCommitTicket struct {
	workerStarted   atomic.Bool // One process launch per ticket, including concurrent retries.
	authority       *monitoringAuthority
	proof           monitoringPermitCandidate
	proofHash       string
	publication     monitoringPublication
	publicationHash string
	confirmed       bool // Protected by authority.mu; storage observation only.
}

// The publisher receives a fresh byte slice, never mutable ticket state.
// Its acknowledgement must hash the bytes actually durably published.
func (t *monitoringCommitTicket) publicationBytes() ([]byte, string) {
	b, _ := json.Marshal(t.publication)
	return b, t.publicationHash
}

type monitoringCommitReceipt struct {
	Nonce            string
	Sequence         uint64
	UntilUptimeMS    int64
	AcceptedRevision uint64 // Live memory acceptance, NOT a durable receipt.
}
type monitoringCommitted struct {
	ticket  *monitoringCommitTicket
	receipt monitoringCommitReceipt
}

type monitoringAuthorityView struct {
	Phase                              string
	Revision, Sequence                 uint64
	AuthorityUntilMS, DeadlineUptimeMS int64
	CoverageEpoch                      string
	PublicationPending                 bool
	PublicationFailureObserved         bool
	ExecutionAuthorized                bool
	Causes                             []string
}

type monitoringAuthority struct {
	mu                         sync.Mutex
	context                    monitoringActiveContext
	incarnation                string
	clock                      func() (int64, error) // Trusted nonblocking boot-monotonic read only.
	lastNow                    int64
	phase                      string
	revision, challengeCounter uint64
	causes                     map[string]bool
	challenges                 map[string]monitoringChallenge
	committed                  map[string]monitoringCommitted
	pending                    *monitoringCommitTicket
	publicationFailureObserved bool
}

func newMonitoringAuthority(c monitoringActiveContext, clock func() (int64, error)) (*monitoringAuthority, error) {
	return newMonitoringAuthorityWithEntropy(c, clock, rand.Reader)
}

// Testable entropy dependency only; never configured from an RPC/environment.
// An incarnation is generated here, not accepted/restored from a caller/disk.
func newMonitoringAuthorityWithEntropy(c monitoringActiveContext, clock func() (int64, error), entropy io.Reader) (*monitoringAuthority, error) {
	if (c.PolicyReports != "" && c.PolicyReports != "v1") || !identifier.MatchString(c.Agent) || !validMonitoringOwner(c.Owner) || clock == nil || entropy == nil || c.verified == nil || c.verified.current == nil || c.verified.fingerprint != monitoringContextHash(c) || c.Sequence > monitoringEvidenceMaxSequence ||
		(c.CoverageEpoch != "" && !monitoringDigest.MatchString(c.CoverageEpoch)) || (c.CoverageEpoch == "" && c.Sequence != 0) {
		return nil, errMonitoringScope
	}
	var incarnation [32]byte
	if c.cutoff != nil && (c.cutoff.owner != c.Owner || c.cutoff.deadline != c.DeadlineUptimeMS || c.cutoff.until() != c.AuthorityUntilMS) {
		return nil, errMonitoringScope
	}
	if _, err := io.ReadFull(entropy, incarnation[:]); err != nil {
		return nil, errMonitoringAuthority
	}
	// Read current time after entropy; a delayed constructor cannot start a new
	// allowance or accept an initial permission which expired while waiting.
	now, err := clock()
	if err != nil || now < 0 || c.AuthorityUntilMS <= now || c.DeadlineUptimeMS < c.AuthorityUntilMS || c.AuthorityUntilMS-now > monitoringEvidenceWindowMS {
		return nil, errMonitoringAuthority
	}
	if !c.verified.current() || !c.verified.consumed.CompareAndSwap(false, true) {
		return nil, errMonitoringAuthority
	}
	phase := "active"
	if c.Sequence == 0 {
		phase = "awaiting-evidence"
	} // Initial prior authority is NOT permission for new-mode work.
	return &monitoringAuthority{context: c, incarnation: hex.EncodeToString(incarnation[:]), clock: clock, lastNow: now, phase: phase, revision: 1, causes: map[string]bool{}, challenges: map[string]monitoringChallenge{}, committed: map[string]monitoringCommitted{}}, nil
}

func (a *monitoringAuthority) revokeLocked(cause string) {
	if a.context.cutoff != nil {
		a.context.cutoff.revoke()
	}
	if !a.causes[cause] {
		a.causes[cause] = true
		if a.revision < monitoringEvidenceMaxSequence {
			a.revision++
		} else {
			a.causes["counter-exhausted"] = true
		}
	}
	a.phase = "revoking" // Deliberately NOT "frozen" or "held-verified".
	a.pending = nil
}

func (a *monitoringAuthority) tickLocked() (int64, bool) {
	now, err := a.clock()
	if err != nil || now < 0 || now < a.lastNow {
		a.revokeLocked("clock-unknown")
		return 0, false
	}
	a.lastNow = now
	if !a.context.verified.current() {
		a.revokeLocked("ownership-unknown")
		return now, false
	}
	if a.phase == "active" && a.context.cutoff != nil && a.context.cutoff.until() != a.context.AuthorityUntilMS {
		a.revokeLocked("technical-expiry")
	}
	if now >= a.context.DeadlineUptimeMS {
		a.revokeLocked("deadline")
	} else if (a.phase == "active" || a.phase == "awaiting-evidence") && now >= a.context.AuthorityUntilMS {
		a.revokeLocked("technical-expiry")
	}
	return now, true
}

func (a *monitoringAuthority) viewLocked() monitoringAuthorityView {
	causes := []string{}
	for c := range a.causes {
		causes = append(causes, c)
	}
	sort.Strings(causes)
	return monitoringAuthorityView{Phase: a.phase, Revision: a.revision, Sequence: a.context.Sequence, AuthorityUntilMS: a.context.AuthorityUntilMS, DeadlineUptimeMS: a.context.DeadlineUptimeMS, CoverageEpoch: a.context.CoverageEpoch, PublicationPending: a.pending != nil, PublicationFailureObserved: a.publicationFailureObserved, ExecutionAuthorized: a.phase == "active", Causes: causes}
}

func (a *monitoringAuthority) check() monitoringAuthorityView {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.tickLocked()
	return a.viewLocked()
}

// Positive policy/auth/operator/recording facts only. A missing reply or failed
// publication is not such a fact; those retain existing authority until cutoff.
func (a *monitoringAuthority) revokeForVerifiedCause(cause string) (monitoringAuthorityView, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.tickLocked()
	switch cause {
	case "policy-condition", "authentication-loss", "operator-pause", "recording-failure":
	default:
		return a.viewLocked(), errMonitoringScope
	}
	a.revokeLocked(cause)
	return a.viewLocked(), nil
}

func (a *monitoringAuthority) revokeForTechnicalCause(cause string) (monitoringAuthorityView, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.tickLocked()
	if cause != "resume-unverified" && cause != "native-expiry" {
		return a.viewLocked(), errMonitoringScope
	}
	if cause == "native-expiry" {
		if a.phase == "active" {
			return a.viewLocked(), errMonitoringAuthority
		}
		return a.viewLocked(), nil // Preserve existing technical/policy causes; a stale timer creates none.
	}
	a.revokeLocked(cause)
	return a.viewLocked(), nil
}

// A fresh incarnation plus a strictly increasing internal counter prevents reuse
// after pruning expired challenges. There is no caller-supplied nonce or clock
// which could re-anchor an old signed proof with a new freshness allowance.
func (a *monitoringAuthority) challenge() (monitoringChallenge, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	now, ok := a.tickLocked()
	if !ok || (a.phase != "active" && a.phase != "awaiting-evidence") {
		return monitoringChallenge{}, errMonitoringAuthority
	}
	for n, c := range a.challenges {
		if now >= c.ExpiresUptimeMS && (a.pending == nil || a.pending.proof.Nonce != n) {
			delete(a.challenges, n)
		}
	}
	if len(a.challenges) >= 16 {
		return monitoringChallenge{}, errMonitoringCapacity
	}
	if a.challengeCounter == monitoringEvidenceMaxSequence {
		a.revokeLocked("counter-exhausted")
		return monitoringChallenge{}, errMonitoringAuthority
	}
	a.challengeCounter++
	nonce := Hash([]byte(a.incarnation + "\x00monitoring-challenge-v1\x00" + strconv.FormatUint(a.challengeCounter, 10)))
	window := min(monitoringChallengeWindowMS, a.context.AuthorityUntilMS-now, a.context.DeadlineUptimeMS-now)
	c := monitoringChallenge{Agent: a.context.Agent, PolicyReports: a.context.PolicyReports, Nonce: nonce, Owner: a.context.Owner, IssuedUptimeMS: now, ExpiresUptimeMS: now + window, AuthorityUntilMS: a.context.AuthorityUntilMS, DeadlineUptimeMS: a.context.DeadlineUptimeMS, AfterSequence: a.context.Sequence, CoverageEpoch: a.context.CoverageEpoch}
	a.challenges[nonce] = c
	return c, nil
}

func monitoringCandidateHash(p monitoringPermitCandidate) string {
	b, _ := json.Marshal(p)
	return Hash(b)
}

// Accept only a candidate from verifyMonitoringEvidence for an exact challenge.
// C10: this bounded memory commit is live authority, without storage or worker
// admission. The original immutable receipt is returned on exact retries.
// This does NOT make persisted bytes sufficient to reconstruct live authority.
func (a *monitoringAuthority) accept(p monitoringPermitCandidate) (monitoringCommitReceipt, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	now, ok := a.tickLocked()
	if !ok || (a.phase != "active" && a.phase != "awaiting-evidence") {
		return monitoringCommitReceipt{}, errMonitoringAuthority
	}
	if p.Owner != a.context.Owner || !monitoringDigest.MatchString(p.Nonce) || !monitoringDigest.MatchString(p.CoverageEpoch) || p.Sequence == 0 || p.Sequence > monitoringEvidenceMaxSequence {
		return monitoringCommitReceipt{}, errMonitoringScope
	}
	digest := monitoringCandidateHash(p)
	if old, ok := a.committed[p.Nonce]; ok {
		if old.ticket.proofHash != digest {
			return monitoringCommitReceipt{}, errMonitoringScope
		}
		return old.receipt, nil
	}
	c, issued := a.challenges[p.Nonce]
	if !issued || now >= c.ExpiresUptimeMS || now >= c.AuthorityUntilMS || p.Sequence <= a.context.Sequence || p.Sequence <= c.AfterSequence || p.UntilUptimeMS <= now || p.UntilUptimeMS > a.context.DeadlineUptimeMS || p.UntilUptimeMS < c.IssuedUptimeMS || p.UntilUptimeMS-c.IssuedUptimeMS > monitoringEvidenceWindowMS ||
		(a.context.CoverageEpoch != "" && p.CoverageEpoch != a.context.CoverageEpoch) {
		return monitoringCommitReceipt{}, errMonitoringScope
	}
	for n, r := range a.committed {
		if r.receipt.UntilUptimeMS <= now {
			delete(a.committed, n)
		}
	}
	if len(a.committed) >= 32 {
		return monitoringCommitReceipt{}, errMonitoringCapacity
	}
	if a.revision == monitoringEvidenceMaxSequence {
		a.revokeLocked("counter-exhausted")
		return monitoringCommitReceipt{}, errMonitoringAuthority
	}
	effectiveUntil := p.UntilUptimeMS
	if a.phase == "active" {
		effectiveUntil = max(a.context.AuthorityUntilMS, p.UntilUptimeMS)
	}
	if a.context.cutoff != nil && !a.context.cutoff.publish(a.context.AuthorityUntilMS, effectiveUntil) {
		a.revokeLocked("technical-expiry")
		return monitoringCommitReceipt{}, errMonitoringAuthority
	}
	// Initial prior authority allows only the bounded proof exchange, not work.
	// Never inherit that bootstrap interval beyond the first verified cutoff.
	publication := monitoringPublication{Version: 1, Incarnation: a.incarnation, Owner: p.Owner, Nonce: p.Nonce, Sequence: p.Sequence, CoverageEpoch: p.CoverageEpoch, CandidateUntilMS: p.UntilUptimeMS, EffectiveUntilMS: effectiveUntil, PreparedRevision: a.revision}
	b, _ := json.Marshal(publication)
	t := &monitoringCommitTicket{authority: a, proof: p, proofHash: digest, publication: publication, publicationHash: Hash(b)}
	a.revision++
	a.context.AuthorityUntilMS = effectiveUntil
	a.context.CoverageEpoch = p.CoverageEpoch
	a.context.Sequence = p.Sequence
	a.phase = "active"
	r := monitoringCommitReceipt{Nonce: p.Nonce, Sequence: p.Sequence, UntilUptimeMS: effectiveUntil, AcceptedRevision: a.revision}
	a.committed[p.Nonce] = monitoringCommitted{ticket: t, receipt: r}
	delete(a.challenges, p.Nonce)
	return r, nil
}

// Optional storage observation of an ALREADY accepted live outcome. One pending
// publisher is bounded independently; contention never refuses a fresh proof.
// A caller may coalesce to the newest accepted nonce after an earlier child exits.
func (a *monitoringAuthority) preparePublication(nonce string) (*monitoringCommitTicket, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	now, ok := a.tickLocked()
	if !ok || a.phase != "active" {
		return nil, errMonitoringAuthority
	}
	r, found := a.committed[nonce]
	if !found || r.receipt.UntilUptimeMS <= now || r.ticket.confirmed || r.ticket.workerStarted.Load() {
		return nil, errMonitoringPublication
	}
	if a.pending != nil && a.pending != r.ticket {
		return nil, errMonitoringBusy
	}
	a.pending = r.ticket
	return r.ticket, nil
}

// Exact nonblocking launch fence, not just "some publication is pending".
// A retired ticket must not start filesystem work against its replacement.
func (a *monitoringAuthority) publicationReady(t *monitoringCommitTicket) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	now, ok := a.tickLocked()
	if !ok || a.phase != "active" {
		return errMonitoringAuthority
	}
	if t == nil || t.authority != a || a.pending != t || t.confirmed {
		return errMonitoringPublication
	}
	r, found := a.committed[t.proof.Nonce]
	if !found || r.ticket != t || r.receipt.UntilUptimeMS <= now {
		return errMonitoringPublication
	}
	return nil
}

// Publication failure/cancellation cannot kill still-valid existing authority.
// Retire this exact ticket so any later worker success cannot affect a retry.
func (a *monitoringAuthority) publicationFailed(t *monitoringCommitTicket) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.tickLocked()
	if t == nil || t.authority != a || a.pending != t {
		return errMonitoringPublication
	}
	a.pending = nil
	a.publicationFailureObserved = true
	return nil
}

// This acknowledgement is a future trusted publisher/IPC responsibility, not a
// browser-supplied hash. No disk/network/write callback executes under this lock.
// It only confirms storage of the ORIGINAL outcome. It never grants/shortens
// permission, advances a sequence or recreates a receipt. Late success cannot
// undo revocation/failure/deadline or replace a newer live decision.
func (a *monitoringAuthority) published(t *monitoringCommitTicket, verifiedPublicationHash string) (monitoringCommitReceipt, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	_, ok := a.tickLocked()
	if !ok || a.phase != "active" {
		return monitoringCommitReceipt{}, errMonitoringAuthority
	}
	if t == nil || t.authority != a {
		return monitoringCommitReceipt{}, errMonitoringScope
	}
	old, found := a.committed[t.proof.Nonce]
	if !found || old.ticket != t {
		return monitoringCommitReceipt{}, errMonitoringPublication
	}
	if verifiedPublicationHash != t.publicationHash {
		if a.pending == t {
			a.pending = nil
			a.publicationFailureObserved = true
		}
		return monitoringCommitReceipt{}, errMonitoringPublication
	}
	if t.confirmed {
		return old.receipt, nil
	}
	if a.pending != t {
		return monitoringCommitReceipt{}, errMonitoringPublication
	}
	t.confirmed = true
	a.publicationFailureObserved = false
	a.pending = nil
	return old.receipt, nil
}

// History only: always return current phase alongside the ORIGINAL outcome.
// A receipt looked up while revoking is not renewed authority or a thaw proof.
func (a *monitoringAuthority) receipt(nonce string) (monitoringCommitReceipt, monitoringAuthorityView, bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.tickLocked()
	r, ok := a.committed[nonce]
	return r.receipt, a.viewLocked(), ok
}
