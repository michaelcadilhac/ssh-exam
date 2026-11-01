# Attempt editor and administration controls

November 1, 2026. Source b70a080 is pushed and deployed; admissions are open.
The web-only release preserves schema36 and the f0c7e10 one-unused-attempt policy,
immutable historical work, review identities, native retention and original clocks.
All37 authority tables/settings/history and110 web/175 native attempts remain
unchanged. No migration, CLI installation or native-service restart. Public TLS,
readiness, all six exact assets and four desktop/mobile focus checks pass; this
does not claim a new live exam, MFA or media test. Exact artifacts, private backup,
preservation and compatible rollback:
[deployment record](admin-editor-deployment.md).

Agreed with a fresh Prof before implementation:

1. **Allowed attempts → Edit settings → review.** The overview has no open editor.
   Clicking Edit settings opens a form showing the saved values, including dates
   and starting files. Untouched values produce no changes, preserve exact seconds
   and repeated-hour occurrence, and never substitute newer saved work. Personal
   editing omits Exam name. Bulk changes retain their Unchanged choices.
2. **Choose previous files.** Keep the current exact source selected. Show exam
   code, attempt number and date. Show a single safe source as text; multiple
   sources remain distinct choices. A tied/unavailable latest source never silently
   selects older files. No hash, UID or copy/paste is needed.
3. **Administration controls.** Remove editable Reason inputs, retaining contextual
   audit descriptions, historical facts and student messages. Use Cancel editing
   for a draft, Close for inspection, Back to editing for an unapplied review and
   Done after completion. Unknown requests retain their original retry identities.
   Refresh is a subdued, labelled circular arrow with a 44px touch target.
4. **Mobile and fresh review.** Fields, nested fieldsets and long choices fit
   320/375/430px screens. A fresh Prof reviews actual desktop/mobile forms and
   results for natural labels, real prefills and relevant actions.

Acceptance: public browser regressions for each workflow, no-op/source/DST/stale
authority and unknown-outcome protection; actual audited management requests;
native keyboard input, icon accessible names and descendant overflow checks.
Typecheck all changed fixtures, rebuild browser assets, read focused results before
affected broad browser qualification and production build. Backend/native policy
is unchanged; earlier native race/kernel evidence remains applicable to identical
inputs. Keep screenshots in per-test output and preserve the ten existing images.

Implementation and all 15 final focused browser checks pass, with full fixture
typechecking and the rebuilt production assets. All 134 selected browser scenarios
have passing current-artifact coverage: the broad run passed 128; a corrected
nine-case run passed its six fixture failures plus all shared-helper prerequisites
and callers. Application source/assets were unchanged between these runs. No open
design choice. A fresh Prof has accepted the actual desktop
and 320/375/430px renders, including dedicated scrolled saved-source views.

The editor holds an immutable reviewed baseline while open. Refresh cannot adopt
another instructor's revision and turn untouched prefills into changes. A stale
edit must be reopened; Back to editing fetches the current settings and preserves
only the explicit proposed changes. Back from cancellation returns to inspection.
Existing saved files stay selected even when a history lookup fails or returns a
newer source. Personal prefills preserve exact seconds and the repeated-hour DST
occurrence. A 95-second allowance is shown as such, with an optional whole-minute
override; it is never rounded into an unsolicited change.

Single-student issuance shows the fetched source directly. Bulk source choices
remain expandable. Native selects can truncate long labels, so the chosen source
also appears as wrapping text with its exam code, attempt number and start time.
Starter-file versions/hashes stay available in Technical details.

Intentional presentation change requested by the instructor: no editable Reason
fields in issuance, unused-attempt changes, resume approval, exam retirement,
reminders or recording deletion. Their action-specific audit descriptions remain;
historical reasons and student messages remain visible. CLI/API audit parameters
are unchanged. A sent request with an unknown result says Close and retains its
original retry identity; closing does not cancel a possibly committed operation.

Refresh guidance checked online: [WAI accessible button names](https://www.w3.org/WAI/standards-guidelines/act/rules/image-button-accessible-name-59796f/)
and [WCAG target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum/).
The shared circular-arrow control has an explicit accessible name, tooltip,
keyboard focus indicator, native button semantics and a 44px target. Refresh inside
a form never submits it. Loading keeps the action disabled with existing status
feedback. Fieldsets can shrink and controls stack within the available width.

Evidence: `var/collection-tests/admin-form-cleanup.ztdlo53r`. The initial three
Reason regressions failed against the former forms, as intended. The first wider
focused run exposed test mistakes: label selectors including native option text,
a nonexistent per-row issuance menu, hidden source controls and incomplete catalog
fixture envelopes. These were corrected against observed roles and typed producer
schemas; all failures are retained. No validator, refusal, clock, pin or history
check was relaxed. Fresh Prof's actual-render review also caught truncated source
identity, which now has both visible text and no-clipping browser assertions.

The broad failures were fixture assumptions: a hidden bulk-source selector,
overview-card checks after the editor replaced it, a hardcoded CDT label after
the DST transition, a fixed closing date before the fixture's current opening,
and an unchanged-baseline comparison made before authoring empty starting files.
Corrections preserve exact timezone/selected-frame assertions, refusal checks,
original settings/history comparisons and the full saved-source issuance sequence.
The corrected fixtures typecheck. All six failures are covered by passing retries;
the broad and focused failures remain available for inspection.

There is no new durable authority or intermediate reservation. Review/request
storage and backend/native enforcement are unchanged. Earlier application/native
race/kernel qualification applies only to those identical inputs; this UI-only
follow-up does not claim a new privileged or production exam test.

The local Go build embeds Git revision/dirty metadata in SSH WASM, unlike the
earlier image build without a Git checkout. Its current digest is
`6d255449603be2e72e09f78d3a075c5fdbe772a62fa7188d0ac58537b8197d25`;
the browser checks used those exact rebuilt bytes. SSH source and wasm_exec.js are
unchanged. Qualification records bind the active index assets rather than older
files left in the local dist directory.

The subsequent authorized web-only cutover completed with a zero-session/exam
drain, full durable private backup, exact-image schema36 preservation and public
acceptance before reopening at18:16:09UTC. Packaged WASM is the unchanged prior
qualified `49946ceb…` built with pinned Docker Go1.27.2; the development-host
`6d255449…` above uses Go1.27.3 and Git metadata. All five non-WASM assets match
the browser-qualified bytes. No database migration or CLI/native replacement
was performed. The prior f0c7e10 image supports schema36 and is the code rollback,
preserving CURRENT records and all subsequent administrator actions. Full evidence:
[deployment record](admin-editor-deployment.md).
