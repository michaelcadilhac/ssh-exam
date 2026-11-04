# Resume approval after a lost session

Superseded November4 by the instructor's explicit SAME-attempt files-only resume
request. See [files-only-resume.md](files-only-resume.md). This document records
the preceding local-only correction, not the new policy or its implementation.

Local correction; **not deployed**. The approved recovery policy is unchanged.

Resume approval applies to the original retained page/SSH session. A page reload
that clears its binding, or an authenticated native exit of its current registered
SSH owner, requires a reviewed new attempt from verified saved files. Repeated
approvals cannot reconnect that session. Heartbeat delays and unknown transport
state do not prove loss; a retired owner's exit must not block its successor.

The defect was in administration: Review still offered Allow resume, and the
shared web/CLI service accepted that approval after known session loss. Student
and native recovery correctly refused the impossible continuation, leaving an
unused approval and misleading instructor feedback.

The correction adds metadata-only requiresNewAttempt to interruption inspection
and dashboard descriptions. It uses only a known missing original page binding or
the accepted, exact current-owner native exit receipt. Private page/owner/UID
fields used during inspection are excluded from the interruption response.
Review shows saved-work guidance and removes the unusable approval controls.
The shared service rejects new approvals before changing any grant, history,
clock or hold. Historical identical-request receipts remain inspectable and do
not renew permission. Same-page retained and legacy reconnection paths remain.

## Supported recovery

An instructor chooses the new allowance and finite start dates. Inspect the old
attempt with examctl info ATTEMPT --read-only. After explicit authorization,
examctl stop ATTEMPT --reason TEXT finishes/protects it; examctl manifest ATTEMPT
verifies the exact archive. Inspect omissions before selecting that archive.
Review a NEW permission with examctl web grants additional-preview, confirm it,
and complete source-sync for its exact revision. The permission remains unusable
until durable source retention is confirmed. See examctl web grants help.

Issuance does not release an old account restriction. If immediate new sign-in
requires early release, obtain separate explicit authorization and use examctl
override-access ATTEMPT --reason TEXT only after verified protection and native
writer/restoration checks pass. It preserves the old interval and submission.
The student signs in afresh; the chosen allowance begins only at Start. No old
attempt is reopened, no time is refunded automatically, and unsaved editor
buffers are not promised by saved-file recovery.

## Verification

All33 affected application tests pass, including actual namespace-root compiled
examctl over TLS, real HTTP refusal and same-page retained continuation. Six
browser cases pass for unavailable/valid approvals, lost replies and stale
reviews. Browser administration uses synthetic API fixtures; it is not new native
freeze/PAM qualification. Full fixture typecheck and production build pass.
All314 native inputs are unchanged, so existing native qualification applies.
The test's second current-owner account initially collided with an existing
hold; it was corrected to an independent synthetic account without weakening
the actual restriction. Frozen inputs, original dirty images and owned fixture
cleanup are checked before commit. No deployment or production restart occurred.

A separately authorized live recovery used the supported workflows, retained the
newly protected current archive, and explicitly released only its old restriction.
The replacement was observed ACTIVE with5400seconds, webcam Off and that exact
saved source. Private incident evidence: var/incident-reports/jmoor144-resume.20261104/.
