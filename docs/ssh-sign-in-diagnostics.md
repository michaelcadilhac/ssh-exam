# SSH sign-in failure details

A failed SSH login previously replaced the host dialogue with a generic error.
This concealed host notices that could distinguish Microsoft throttling, a rejected
challenge or another upstream authentication problem.

The error now has a collapsed **SSH sign-in details** section containing the last
host's instruction history. It survives both an explicit error and an unexpected
socket closure. Instructions remain plain escaped text, retain prose formatting,
and scroll inside a bounded area on narrow displays.

Only the host name and instruction strings are retained for this view. Password and
verification-code answers are cleared as before; they are not copied into it.
The details remain in browser memory and are cleared on dismiss, a new login,
cancellation, successful sign-in or logout. The browser does not send this history
back to the server or add it to recordings, audit or telemetry. JavaScript cleanup
remains best-effort rather than guaranteed memory erasure.

This changes failure presentation only: host-key verification, phone MFA, shared
password reuse, retry policy, account isolation and exam timing are unchanged.

DePaul's known number-matching challenge labels its final empty acknowledgment
`Code:`. For that exact jump host, single hidden prompt and explicit Authenticator
number-matching instruction, the UI presents **Continue after phone approval**.
Only clicking it sends the empty acknowledgment. Generic OTP/code prompts, other
hosts and mixed challenges keep their input fields. Nothing is answered automatically
and the SSH host still verifies actual phone approval.

Browser regressions cover explicit failure and unexpected disconnection, same-turn
notice/error delivery, script escaping, absence of entered secrets, narrow-screen
layout, dismissal, a fresh retry and cancellation. The separate
[private real-account test](private-desktop-exam-test.md) completed the full
30-minute workflow with verified protected collection. These diagnostic checks
alone do not establish that result.

Recovery also treats repeated disconnected status as an unchanged condition.
Previously every two-second poll cleared reconnect error feedback and invalidated
the action epoch again. A transition into disconnection still stops capture and
blocks input, while repeated reports preserve the current response. A new pause
generation or reason still clears stale feedback. The regression verifies a denied
reconnect remains visible across repeated snapshots and polling, with input blocked.
