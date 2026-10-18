# Exam timing across timezones

Students can take an exam from any browser timezone. Start-window checks, attempt
start/deadline values, individual allowances, clock changes and collection use
absolute Unix timestamps or elapsed durations. They do not use the student's
local calendar date or UTC offset. The class agent also retains a monotonic
cutoff, and the browser countdown advances from a server-time snapshot.

The web interface and terminal welcome display Chicago dates with explicit
CST/CDT labels. Exam-settings start-window inputs use the instructor device's
local timezone, as stated beside those inputs; saving converts them to absolute
timestamps. A timezone change does not grant more time or reset an attempt.
A 90-minute exam lasts 90 elapsed minutes even when a daylight-saving transition
makes the displayed wall-clock interval look longer or shorter.

## Regression coverage

The browser matrix covers UTC, America/Los_Angeles, America/New_York,
Europe/London, Asia/Kathmandu, Pacific/Honolulu and Pacific/Kiritimati. This
includes daylight-saving zones, UTC-10, UTC+14, different calendar dates and
Nepal's 45-minute offset.

The matrix checks local start-window input conversion,
SSH/password/MFA login, a permitted exam start, default 90-minute and individual
120-minute allowances, the live countdown, reset/extension while connected,
preservation of the original deadline and secured early collection. Each browser timezone is exercised through the browser SSH/relay path and the
legacy backend SSH path, using disposable local SSH
fixtures. These are timezone checks, not additional qualification of the real
DePaul authentication provider or account isolation.

Webserver timing/display tests and class-agent deadline/recovery/collection tests
also run with each of the seven server timezone settings. Dedicated cases cover
spring-forward, fall-back, midnight/date rollover, 90/120-minute allowances and
CST/CDT display. No production server's timezone is changed by these checks.

Tests live in:

- `tests/browser/timezones.spec.ts`
- `tests/unit/timezone.test.ts` and `tests/unit/clock-control.test.ts`
- `ssh-server/internal/core/timezone_test.go` and the deadline/collection tests

Run browser checks after building, using free fixture ports (3100/3101 by default):

```sh
npm run build
npx playwright test tests/browser/timezones.spec.ts
EXAM_BROWSER_SSH=1 npx playwright test tests/browser/timezones.spec.ts
```

For each timezone above, run the webserver tests with `TZ` set to that zone:

```sh
TZ=Pacific/Kiritimati npx vitest run tests/unit/timezone.test.ts tests/unit/clock-control.test.ts
```

Run native checks from `ssh-server/`, likewise varying `TZ`:

```sh
TZ=Pacific/Kiritimati go test -count=1 ./internal/core -run 'Test(IndividualDeadline|DeadlineCollectsWithoutBrowserOrGateway|ConcurrentFinishAndDeadline|ClockResetLive|ClockExtension|DisconnectedReset|MonotonicDeadline|ExamWelcome|TimedExamWelcome)'
```
