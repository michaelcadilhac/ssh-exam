# Personal attempt editing and saved-file choices

The November1 single-unused-attempt policy supersedes this milestone's remaining
student chooser and support for several unused permissions. Personal editing and
historical cards remain; current replacement behavior is documented in
[single unused attempt](single-unused-attempt.md).

Implemented and tested after runtime63903bd; subsequently pushed and deployed
with f0c7e10/schema36. The current replacement policy supersedes this milestone's
historical student selector and web-only rollback instructions below. Use the
[deployment record](single-unused-attempt-deployment.md) for current backups and
schema-compatible rollback.

The instructor's screenshots exposed two unrelated selections on the same screen:
which unused attempt to change, and which earlier attempt supplies its files. A
checkbox looked like an on/off permission switch. An empty saved-file selector
gave no explanation, and the default display name “Programming exam” hid `midterm`.

Prof agreed the following bounded workflow before implementation:

- In a student's **Allowed attempts**, each unused card has **Edit settings** and
  **Cancel attempt**. There are no target-selection checkboxes, even with several
  attempts. Editing stays on the same screen, names its target, and uses the
  existing review as the second screen. Switching targets clears draft changes.
- Bulk student management retains explicit selection and shared edits. A selection
  chooses action targets; it does not enable or disable their permissions.
- Current starting files stay visible on the card. **Change starting files** is
  optional and starts at **Keep current files**. Opening it changes no files.
- **Use files from an earlier attempt** explains the alternative to starter files.
  Exam choices use **Name · exam-code**, including archived markers. This follows
  the existing dashboard convention without renaming exam definitions.
- Loading, failed retrieval and a completed empty source list have distinct
  messages. One safe latest source is shown as text; multiple choices remain a
  selector. An unavailable or tied latest attempt requires explicit selection;
  an older source is never silently substituted. Empty or removed explicit choices
  cannot fall back to an automatic source during review.

The same endpoints and `examctl web grants revise` / `revoke` workflows remain
authoritative. Review checks the exact target and current revision again. Lost
responses retain the exact request body and identity. Native durable source
confirmation remains necessary before a saved-work permission becomes available.
No source/archive, grant, clock, deadline, account-hold or monitoring policy changes.

For students, multiple available attempts already require an explicit choice after
SSH sign-in and before setup. Selection is read-only and starts no clock. A running
attempt takes precedence. Prof identified a separate clarity limitation: several
extra attempts can differ only by their creation date in the selector; friendly
starting-file metadata would help distinguish them. This follow-up records that
observation without introducing a new source-retrieval protocol.

Acceptance: personal single/multiple-target editing and exact cancellation; bulk
selection retained; draft reset and focused-history/refresh refusal to retarget;
no-op file preservation; zero/one/multiple sources, unsafe/tied latest, retrieval
retry and explicit stale/empty refusal; unknown-result exact retry; actual Review
clicks through collapsed file options; readable desktop/mobile ordinary views.
Fresh frontend assets and complete fixture typechecking are required before
browser evidence. Existing backend/native/CLI evidence applies only to unchanged
inputs, not to a new release image.

Evidence: `var/collection-tests/attempt-editor-clarity.yep1wcu5`. Initial public
regressions reproduced nine personal-editor defects and the hidden exam code;
the existing unknown-request protection already passed. A real keyboard regression
also reproduced malformed native number input being treated as unchanged. The
bounded form guard rejects `badInput` before any request, preserves the draft and
focuses the affected field; collapsed required source controls still reach the
existing manual review checks. Switching editors remounts native controls so their
unfinished input cannot leak into another target.

All 42 affected browser cases pass: 37 management workflows, including real HTTP /
WASM SSH student selection/start, enrollment, practice, bulk operations and unknown
retries; five desktop/mobile provenance, timing and source-history checks. Full
typecheck, fresh frontend build, formatting and diff checks pass. Prof viewed and
accepted four actual desktop/mobile/empty/single-source renders. The owned fixture
listeners closed; all ten original dirty documentation images remain unchanged
and unstaged. `completion.json` binds the tested source, fixtures, assets and logs.

Early green attempts exposed fixture mistakes: an incorrectly scoped descendant
locator, a disclosure opened before its editor loaded, and a label lookup used
instead of the observed combobox role. Those failures remain recorded. Corrections
use visible public controls and retain the original no-mutation/target/source
oracles; the final affected run includes all focused cases. No product enforcement
was relaxed to obtain the pass.

Backend, shared protocol, native/CLI source and SSH WASM/runtime bytes are unchanged.
The prior application663/3 existing skips and native/CLI qualification therefore
remain applicable to those inputs; they were not rerun or claimed as new tests.
This is local interface qualification, not qualification of a new release image.

If deployment is later authorized, build a matched web release and use the existing
guarded web-only cutover, private backup, asset/readiness checks and rollback
procedure. This change needs no database migration, native binary replacement or
native service restart. The prior matched web image remains the code rollback;
rolling code back must not undo reviewed administrator actions or student history.
