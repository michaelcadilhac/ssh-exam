# One-display policy

Implemented, tested and pushed. Not deployed or enabled in production.
[Matched release qualification/status](display-alerts-release.md).

## Bounded delivery plan

1. Add an opt-in exam-wide setting in Exam settings and `examctl web exams`
   (`--single-display on|off`). Preserve existing defaults, saved grants and clocks.
   Acceptance: both management entries share validation and round-trip the setting.
2. Add permission-based preflight verification and live display/permission change
   detection. Exactly one browser-reported active display is required before Start
   or resume. Known additional displays use the existing shared 15-second grace;
   unknown/denied/revoked verification blocks input as a technical problem.
   Acceptance: no failure consumes a grant or starts a clock; recovery requires
   fresh capture and existing server/native authorization.
3. Gate server readiness and challenged monitoring evidence using the current
   exam-wide policy, including old clients and live policy changes. Do not change
   immutable settings, native owner identity, deadlines or enforcement freshness.
4. Run focused protocol/HTTP/CLI/browser regressions, then affected integration,
   type/build and browser checks. Record exact evidence and limitations, update
   operator/design/checkpoint documentation and commit locally. Stop at validated
   local completion; release qualification, push and deployment are separate.

## Verification matrix

Single/two/zero displays; unsupported API; permission denial/revocation; stale
async results after disposal; unplug/reconnect; short and prolonged additional
display; unavailable verification beyond grace without a policy accusation;
overlapping fullscreen/focus loss; current-policy enable/disable; legacy client
missing observation; fresh capture requirements at Start/resume; CLI bad values,
update preservation and help. Browser API fixtures must expose the real API/event
shape and clearly distinguish simulated topology from physical-device testing.

## Limits

Window Management API permission and a supported browser are necessary. This is
an active-display check reported by the student's browser, not proof against a
modified client, mirrored displays or another physical device. `screen.isExtended`
alone is insufficient proof. No new HTTP polling or automatic permission prompts.

## Operation

In **Exam settings**, enable **Require one display** and save. The CLI uses the
same revision-checked, authorized and audited definition writer:

```sh
examctl web exams show final
examctl web exams update final --revision HASH_FROM_SHOW --single-display on
```

Use `--single-display off` to disable. `examctl web exams update --help` documents
the option. The setting defaults off when absent, including on existing exams;
sandbox can opt in too. Select it before students start. Changing it during an
attempt takes effect through the existing authenticated state channel and
requires fresh verification; it does not change the student's allowance or clock.

Before Start, the student clicks **Check displays**, grants the browser's display
permission, and disconnects or disables any extra displays. Screen sharing still
independently requires Entire Screen. Practice terminals can be used before the
display check; Start and resumption require a positive check and fresh challenged
capture. A rejected check starts no clock and consumes no grant.

The live `ScreenDetails` object reports topology changes, and `PermissionStatus`
reports revocation. Returning to one display within the shared grace restores
typing only after fresh capture and current server checks. The timer continues.
Repeated topology changes do not restart that grace. Known other condition losses
remain enforceable. Unknown topology is a technical input barrier, with a visible
retry instruction, rather than a student violation. Permission being granted again
alone does not restore work: the student must check displays again.

## Implementation and preservation

`single_display` belongs to the exam definition, outside immutable grant/attempt
settings. There is no SQL migration or rewrite of historical settings/hashes.
Current policy is read by Start, resume, preflight capture and live monitoring.
Old clients omitting the observation cannot start or obtain fresh positive live
proof when the requirement is enabled. Existing disabled-policy clients retain
their behavior.

Capture, heartbeat and condition messages carry an optional observation:
`single`, `multiple` or `unavailable`. Exactly one reported active display is the
positive case; missing or invalid topology is not positive evidence. The server
uses its current exam setting, rather than a browser-supplied policy flag.
Policy changes invalidate prior requirements' capture cohorts and live facts.
Native signed proof/owner/settings formats are unchanged: the existing generic
complete-proof gate now also requires the display observation.

An authenticated unavailable-display notification immediately invalidates live
positive proof and pending capture challenges, without waiting for the next image.
It clears an unproven display-grace interval and cannot cure an already recorded
policy block. Subsequent unknown reports do not continually invalidate new capture
challenges. Earlier delayed images remain recordable but cannot restore live
authority. Existing coverage, clock and ownership rules still apply.

The browser helper owns one event-listener set, removes it on replacement/disposal,
bounds unanswered verification at 60 seconds, and rejects late async results.
It requests permission only from the student's button click. Unsupported browsers,
denied/revoked permission and failed queries remain unavailable; there is no
`isExtended=false` fallback. HTTPS/secure context and an allowed
`window-management` Permissions Policy are required (the feature's default
allowlist is self).

## Qualification evidence and limits

Private logs, receipts, input digests and per-test screenshots:
`var/one-display/20261123/`. Focused protocol/readiness/ledger/HTTP/definition checks
pass, including explicit bootstrap promotion with the policy both on and off.
The ordinary and required-display signed SSH preparation → Start paths pass;
the required path rejects old capture metadata before consuming a grant, then
starts with its full allowance after fresh positive capture. Required-display
proofs pass the actual native verifier. Affected examctl help/argument/reply checks
pass under Go's race detector. Typecheck and production build pass.

The actual Chromium Window Management API has verified its real single headless
display through the preflight button. Permission for that test uses Chromium's
native CDP permission control; Playwright's generic grantPermissions helper does
not recognize this permission. Other topology/revocation UI scenarios use an
explicit ScreenDetails/PermissionStatus fixture. These tests do not claim a human
permission-prompt or physical two-monitor hotplug acceptance pass.

Final browser qualification passes 17 student/live-policy/grace cases plus the
explicitly selected mobile instructor setting case. The latter was run by its
declared title after a line selector omitted it from the combined run; it verifies
off/on, save, reload and prefill. Mobile preflight layout was inspected from its
private per-test screenshot. The ordinary interruption suite still verifies
deadline expiry, authoritative holds and genuine SSH loss. No class-capacity,
production installation, human permission-prompt or physical hotplug pass is
claimed by this increment.

Initial failures are retained: the CLI global argument router needed the new
value-taking flag; an attempted ledger change would have weakened the existing
unknown-coverage safeguard and was reverted; HTTP fixtures needed separate
synthetic accounts to respect account holds. No guard was relaxed. The browser
permission-helper mismatch was corrected using the supported native interface.

Before release, freeze and qualify the matched web image and examctl binary with
the existing guarded preservation/recovery workflow. No native authority binary
or database migration is required. Keep the policy off until the new interface
is installed, and include a consenting synthetic account's supported desktop
browser/physical-display acceptance check before requiring it for a class.
Disabling the exam setting is the supported policy rollback; it does not reopen
an attempt already requiring instructor review or alter deadlines/history.

API references: [Chrome Window Management](https://developer.chrome.com/docs/capabilities/web-apis/window-management),
[Window Management standard](https://www.w3.org/TR/window-management/),
[Chromium permission control](https://chromedevtools.github.io/devtools-protocol/tot/Browser/#method-setPermission).
