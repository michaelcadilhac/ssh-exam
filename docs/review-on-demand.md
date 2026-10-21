# Screenshot-first review (local, not deployed)

Open an attempt's Review → Monitoring to inspect screen captures and any required
webcam captures. Existing independent timeline sliders and live mode remain.
Use **Open terminal replay**, then choose a terminal, only when investigating its
recorded output. **Close terminal replay** stops recording reads. Activity and
Submission tabs pause replay fetching; returning catches up incrementally without
advancing a paused replay. Reopening preserves its selected pane and position.

Live metadata/capture updates continue without resetting the selected review tab
or capture/replay positions. This is a presentation/loading change only: terminal
recording, protected submissions, monitoring permissions and 60-day monitoring
retention remain unchanged. No new management operation was added.

Local evidence: typecheck/build and 52 Chromium tests pass, including active and
completed review, zero recording reads before explicit opening, closing/tab
switching, network recovery, live updates and actual synthetic browser SSH cleanup.
No production browser or student account was used. Deploy only after a separately
authorized drain with the other gateway changes; this component adds no migration.
