# Admin student list and exam timezone

November6: implementation/push/deployment authorized. No production changes yet.
Milestone1 locally validated:14focused HTTP/presentation checks and4built-browser
workflows pass, including reviewed1360px/390px screenshots. Types/build pass.
The first synthetic pagination fixture attempted to add raw enrollments after
grant issuance, then to invent history for an already-issued unused permission.
Both correctly refused. The fixture now keeps legacy history and new enrollment/
initial-grant issuance distinct; no trigger or enforcement was changed.

Bounded delivery plan:

1. Dashboard HTTP and web list: independent All students/Working/Needs attention
   tabs, extra available/paused/webcam filters and latest-completion sorting.
   Select students before pagination, keep their complete history, count students
   in tabs, and reset selection/pagination when controls change. Remove Files saved
   tab. Give Next attempt a blue inset panel, explicit upcoming label/icon and
   dashed separation from muted completed history, including mobile layouts.
   Acceptance: public HTTP pagination/composition/sorting and browser controls,
   selection, history and mobile regression tests.
2. Exam settings: validated IANA timezone, Chicago fallback for existing exams,
   display/entry only. Store outside immutable grant/attempt settings. Update all
   admin date controls and review displays, preserving instants and DST overlap/
   gap handling. Provide matching examctl flag/help and signed interface tests.
   Acceptance: multiple device/exam zones, DST folds/gaps, unchanged grant hashes,
   attempts/deadlines and exact retry/revision behavior; types/build/affected suites.
3. Freeze exact artifacts and qualify the existing same-schema web/CLI release
   workflow, preservation, recovery and reopening. Reuse unchanged native evidence;
   no authority/watchdog/relay mechanism changes. Push/deploy only after the gates,
   with fresh student/unfinished guards and authorized admin-only signout.

Available means an authorized, unused, unexpired next attempt; scheduled future
starts are included, while setup claims and pending saved-work verification are
not. Paused includes both paused work and a paused countdown. These are list
filters only, never new admission or monitoring permission.
