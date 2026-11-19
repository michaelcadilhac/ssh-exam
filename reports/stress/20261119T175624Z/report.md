# Co-located 35-student diagnostic — failed during ramp

November 19, 2026. Agent report from the saved browser, native, resource and cleanup
receipts, with the independent [Prof review](../20261119T1756-class10-ui-review.md).
Source: `309e60d`. This selected phase failed; it is not a complete-suite pass or
production acceptance. No student accounts, institutional MFA or external email.

## Outcome and student experience

The real Marco Chromium/WASM clients opened four GCC/GDB terminals for each of
33 synthetic students: 132 verified terminals. The 34th student's Start response
exceeded the unchanged 60-second budget. The planned ten-minute peak at35 students
and simultaneous protected Finish were not reached.

The lost-reply recovery then observed the SAME attempt ACTIVE in both native and
web state, with its original start/deadline and generation. The workspace appeared;
this observation does not prove enabled terminal input. No Start was replayed and
no fresh clock was granted. The original timeout remains a failure.

The33 successful HTTP Start responses had a24.222s median,49.390s p95 and56.368s
maximum. Three explicit setup-busy refusals were retained; only verified no-start
outcomes offered the existing explicit retry. The last successful native activation
took16.707s, after account preparation13.288s, secure SSH handoff14.524s and a
health observation7.333s. These operation timings identify slow stages; they do not
by themselves identify which CPU, filesystem or network wait caused them.

## Capture and resource evidence

The bounded private recorder retained22,515 rows /3,402,570 bytes:

| Capture result | Count |
| --- | ---: |
| Accepted |21,413|
| Challenge refusal |28|
| Decoder queue expiry |299|
| Image-worker capacity refusal |1|

This identifies the current video refusal boundary. It does not retrospectively
classify the preceding run's generic video errors or establish that every refusal
caused a student interruption. Queue expiry is not evidence of student misconduct.

| Measured quantity | Result |
| --- | ---: |
| Native sampled memory maximum |1,452MiB|
| Web sampled memory maximum |1,834MiB|
| Combined sampled memory maximum |3,907MiB|
| Minimum host available memory |2,154MiB|
| Native CPU, final five sampled minutes |0.715core|
| Web CPU, same interval |0.822core|
| CPU-quota throttling in that interval |0|
| Memory high/max/OOM events |0|

The native and web actors were below their respective two-core quotas. Ancestor
CPU bounds did not impose another quota. Read-only measurements after complete
test cleanup found the installed idle deadline watchdog using about0.86–0.99core
and ordinary user work about2cores. Neither was stopped or changed. The generator
retained substantial memory headroom and low CPU pressure; no generator capacity
failure explains this run. These observations support investigating CPU waste,
not assuming that larger test quotas will solve the Start delay.

The private native observer inherited an1100-second lifetime and expired with
SIGTERM. Its replacement retained the same64MiB/10%CPU limits. The resulting
255.121-second sample gap is preserved. Continuous two-second web/host samples and
cumulative memory event counters remain; the native CPU series is not uninterrupted.
The observer's exit was not an OOM or a product-service failure.

## UX assessment and suggested fixes

Prof verified unchanged frontend source against the approved waiting/recovery
review. Stable “Preparing exam…” and bounded “Checking whether your exam started…”
remain clear. A recovered capture needs no codec terminology or student action.
No new UI text/layout defect was established. This review reuses prior rendered
evidence; it adds no physical-camera, institutional MFA or assistive-device claim.

1. **High:** remove redundant state rewrites from native background history and
   recording scans. Reproduce with synthetic history; preserve durable callback
   acknowledgements, retries, original deadlines, holds and one-second cutoff.
2. **High:** repeat the bounded co-location qualification only after the measured
   CPU saving and matched native artifacts pass interface/race/kernel checks.
   The instructor requires optimization within the existing four cores.
3. **High:** correlate decoder queue expiry with the improved CPU measurements.
   Do not weaken capture freshness or enlarge execution authority to hide delay.
4. **Medium:** carry the full phase lifetime into passive observers before another
   ramp; retain prior rows and exact cleanup on publication/observer failures.

A separate real-ffmpeg, one-core component experiment compared prediction groups
of12 and4. Both saturated/refused before steady state; the shorter group increased
synthetic high-motion upload bytes about45% for only a small CPU improvement.
No encoding change was made. This is a rejected investigation, not a class test.

## Preservation and remaining gates

Independent cleanup is FULL: native, application, bridge, observers, Marco browser,
local driver and tunnels stopped; private ports3100/3102/9444/9445 closed. Original
host installation/configuration/authority and guest base were preserved. Frozen
source/build inputs and all16 documentation-image hashes match; the10 pre-existing
dirty PNGs were preserved. No production restart, deployment, fencing or record
change occurred.

Raw evidence: `var/qualification35/profile-20261119T044302Z-8d3c93/native-small-profile/class-10/`:
`result.json`, `analysis-initial.json`, `resource-summary.json`, browser lost-Start
observation, private profile, resource/journal snapshots, independent cleanup and
input-preservation receipts. Codec experiment: sibling `decoder-benchmark-1/`.

The earlier35-student/140-terminal90-minute pass used a different runtime layout.
It remains valid for that scope; co-location, current production configuration and
70-student capacity are not qualified by it or by this failed diagnostic.
