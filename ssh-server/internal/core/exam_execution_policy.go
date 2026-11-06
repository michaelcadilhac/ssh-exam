package core

import (
	"bytes"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"strings"
	"syscall"
)

const ExamExecutionPolicyCapability = "live-exam-execution-policy-v1"

// This is separate from immutable allowance/grant Settings. Only the current
// policy limits NEW pane admissions and NEW collection jobs.
type ExamExecutionPolicy struct {
	Schema             int    `json:"schema"`
	Agent              string `json:"agent"`
	Exam               string `json:"exam"`
	Instance           string `json:"instance"`
	Revision           int64  `json:"revision"`
	Terminals          int    `json:"terminals"`
	CollectionFileMiB  int64  `json:"collection_file_mib"`
	CollectionTotalMiB int64  `json:"collection_total_mib"`
}

type CollectionExecutionPolicy struct {
	Job    string              `json:"job"`
	Policy ExamExecutionPolicy `json:"policy"`
}

type verifiedExecutionPolicy struct {
	policy    ExamExecutionPolicy
	untilBoot int64
	expires   int64
}

var executionPolicyInstance = regexp.MustCompile(`^[a-f0-9]{32}$`)
var errExecutionPolicy = errors.New("fresh exam-wide execution policy unavailable or changed; retry this NEW pane/collection operation after checking the web connection and matching native roles; existing work, deadlines and holds remain unchanged")

func validExecutionPolicy(p ExamExecutionPolicy, agent, exam string) bool {
	return p.Schema == 1 && identifier.MatchString(p.Agent) && identifier.MatchString(p.Exam) &&
		p.Agent == agent && p.Exam == exam && executionPolicyInstance.MatchString(p.Instance) &&
		p.Revision > 0 && p.Revision <= 9007199254740991 && p.Terminals >= 1 && p.Terminals <= 4 &&
		p.CollectionFileMiB >= 1 && p.CollectionFileMiB <= 4096 &&
		p.CollectionTotalMiB >= p.CollectionFileMiB && p.CollectionTotalMiB <= 16384
}

// Validate everything before touching a map: WithState persists mutations even
// when its callback returns an error. A service restart restores only the
// monotonic revision fence, never the memory-only fresh response below.
func (e *Engine) cacheExecutionPolicyLocked(p ExamExecutionPolicy) error {
	if !validExecutionPolicy(p, e.Config.AgentID, p.Exam) {
		return errExecutionPolicy
	}
	if previous, exists := e.state.ExamExecutionPolicies[p.Exam]; exists {
		if previous.Instance != p.Instance || previous.Revision > p.Revision ||
			(previous.Revision == p.Revision && previous != p) {
			return errExecutionPolicy
		}
	}
	if e.state.ExamExecutionPolicies == nil {
		e.state.ExamExecutionPolicies = map[string]ExamExecutionPolicy{}
	}
	e.state.ExamExecutionPolicies[p.Exam] = p
	return nil
}

// HTTP is performed outside WithState. Final admission checks retain this
// nonce-bound, memory-only response and recheck the persisted revision fence.
func (e *Engine) fetchExecutionPolicy(exam string) (*verifiedExecutionPolicy, error) {
	if !identifier.MatchString(exam) || e.Config.CallbackURL == "" || !identifier.MatchString(e.Config.AgentID) {
		return nil, errExecutionPolicy
	}
	client, err := e.callbackClient()
	if err != nil {
		return nil, err
	}
	defer client.CloseIdleConnections()
	client.Timeout = operationTimeout
	key, err := privateKey(e.Config.CallbackKey)
	if err != nil {
		return nil, err
	}
	defer func() {
		for i := range key {
			key[i] = 0
		}
	}()
	nonce := Token()
	payload, err := json.Marshal(map[string]any{"agent": e.Config.AgentID, "exam": exam, "nonce": nonce, "at": Millis()})
	if err != nil {
		return nil, err
	}
	request, err := http.NewRequest("POST", strings.TrimSuffix(e.Config.CallbackURL, "/")+"/api/agent/exam-execution-policy", bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", "application/vnd.ssh-exam-event")
	request.Header.Set("X-Exam-Signature", base64.StdEncoding.EncodeToString(ed25519.Sign(key, payload)))
	issuedBoot, err := monitoringBootMillis()
	if err != nil {
		return nil, err
	}
	response, err := client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", errExecutionPolicy, err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%w: HTTP %d", errExecutionPolicy, response.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, 65537))
	if err != nil || len(body) > 65536 {
		return nil, errExecutionPolicy
	}
	var frame SignedFrame
	if json.Unmarshal(body, &frame) != nil {
		return nil, errExecutionPolicy
	}
	signed, err := base64.StdEncoding.DecodeString(frame.Payload)
	if err != nil {
		return nil, errExecutionPolicy
	}
	signature, err := base64.StdEncoding.DecodeString(frame.Signature)
	if err != nil {
		return nil, errExecutionPolicy
	}
	public, err := publicKey(e.Config.GatewayPublicKey)
	if err != nil || !ed25519.Verify(public, signed, signature) || !validReadOnlyJSON(signed) {
		return nil, errExecutionPolicy
	}
	var reply struct {
		Type     string              `json:"type"`
		Audience string              `json:"audience"`
		Nonce    string              `json:"nonce"`
		Expires  int64               `json:"expires"`
		Policy   ExamExecutionPolicy `json:"policy"`
	}
	d := json.NewDecoder(bytes.NewReader(signed))
	d.DisallowUnknownFields()
	if d.Decode(&reply) != nil || d.Decode(new(any)) != io.EOF || reply.Type != "exam-execution-policy" ||
		reply.Audience != e.Config.AgentID || reply.Nonce != nonce || reply.Expires <= Millis() || reply.Expires > Millis()+operationTimeoutMS+1000 ||
		!validExecutionPolicy(reply.Policy, e.Config.AgentID, exam) {
		return nil, errExecutionPolicy
	}
	nowBoot, err := monitoringBootMillis()
	if err != nil || nowBoot < issuedBoot || nowBoot-issuedBoot >= operationTimeoutMS {
		return nil, errExecutionPolicy
	}
	until := min(issuedBoot+operationTimeoutMS, nowBoot+reply.Expires-Millis())
	if until <= nowBoot {
		return nil, errExecutionPolicy
	}
	return &verifiedExecutionPolicy{policy: reply.Policy, untilBoot: until, expires: reply.Expires}, nil
}

func (e *Engine) refreshExecutionPolicy(exam string) (*verifiedExecutionPolicy, error) {
	var required bool
	if err := e.WithState(func() error {
		_, cached := e.state.ExamExecutionPolicies[exam]
		required = e.Config.CallbackURL != "" || cached
		return nil
	}); err != nil {
		return nil, err
	}
	// Empty outbound configuration is used by historical in-process fixtures.
	// Once a live revision is recorded, removing configuration cannot downgrade it.
	if !required {
		return nil, nil
	}
	v, err := e.fetchExecutionPolicy(exam)
	if err != nil {
		return nil, err
	}
	if err := e.WithState(func() error { return e.cacheExecutionPolicyLocked(v.policy) }); err != nil {
		return nil, err
	}
	return v, nil
}

func (e *Engine) admissionTerminalLimitLocked(a *Attempt, v *verifiedExecutionPolicy) (int, error) {
	current, cached := e.state.ExamExecutionPolicies[a.Exam]
	if v == nil {
		if e.Config.CallbackURL != "" || cached {
			return 0, errExecutionPolicy
		}
		return a.Settings.Terminals, nil
	}
	now, err := monitoringBootMillis()
	if err != nil || now >= v.untilBoot || Millis() >= v.expires || !cached || current != v.policy || !validExecutionPolicy(current, e.Config.AgentID, a.Exam) {
		return 0, errExecutionPolicy
	}
	return current.Terminals, nil
}

func collectionPolicyBounds(binding *CollectionExecutionPolicy, exam, job string) (collectionBounds, error) {
	if binding == nil || binding.Job != job || !monitoringDigest.MatchString(binding.Job) || !validExecutionPolicy(binding.Policy, binding.Policy.Agent, exam) {
		return collectionBounds{}, errExecutionPolicy
	}
	return limitsForSettings(Settings{CollectionFileMiB: binding.Policy.CollectionFileMiB, CollectionTotalMiB: binding.Policy.CollectionTotalMiB})
}

func collectionBoundsForAttempt(a *Attempt) (collectionBounds, error) {
	if a.CollectionPolicy != nil {
		return collectionPolicyBounds(a.CollectionPolicy, a.Exam, a.CollectionJob)
	}
	return limitsForSettings(a.Settings)
}

func collectionBoundsForManifest(m *Manifest) (collectionBounds, error) {
	if m == nil || m.Attempt == nil {
		return collectionBounds{}, errors.New("protected manifest snapshot required")
	}
	if m.CollectionPolicy != nil {
		return collectionPolicyBounds(m.CollectionPolicy, m.Attempt.Exam, m.Attempt.CollectionJob)
	}
	return limitsForSettings(m.Attempt.Settings)
}

func sameCollectionPolicy(a, b *CollectionExecutionPolicy) bool { return reflect.DeepEqual(a, b) }

// This bounded metadata read selects an archive's OWN resource bounds only.
// It is not archive verification: retention/cleanup still run ReadProtected
// before adoption, extraction or deletion can be authorized.
func protectedCollectionBounds(dest string, a *Attempt) (collectionBounds, error) {
	root, err := os.OpenRoot(dest)
	if err != nil {
		return collectionBounds{}, err
	}
	defer root.Close()
	f, err := root.OpenFile("manifest.json", os.O_RDONLY|syscall.O_NOFOLLOW, 0)
	if err != nil {
		return collectionBounds{}, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() > 4*1024*1024 {
		return collectionBounds{}, errSourceRetention
	}
	data, err := io.ReadAll(io.LimitReader(f, 4*1024*1024+1))
	if err != nil || len(data) > 4*1024*1024 {
		return collectionBounds{}, errSourceRetention
	}
	var m Manifest
	if json.Unmarshal(data, &m) != nil || !protectedIdentity(m.Attempt, a) {
		return collectionBounds{}, errSourceRetention
	}
	return collectionBoundsForManifest(&m)
}

func (e *Engine) workspaceCollectionBounds(a *Attempt) (collectionBounds, error) {
	v, err := e.refreshExecutionPolicy(a.Exam)
	if err != nil {
		return collectionBounds{}, err
	}
	if v == nil {
		return limitsForSettings(a.Settings)
	}
	return limitsForSettings(Settings{CollectionFileMiB: v.policy.CollectionFileMiB, CollectionTotalMiB: v.policy.CollectionTotalMiB})
}

func (e *Engine) protectedWorkspaceBounds(a *Attempt) (collectionBounds, error) {
	return protectedCollectionBounds(filepath.Join(e.Config.State, "submissions", a.ID), a)
}
