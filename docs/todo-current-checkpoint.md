# Current investigation — reduce live dependence on marco

Source inspection complete; proposal only. Capture challenge/upload verification
and one-Hz native signed monitoring evidence still cross the webserver. Freshness
is60seconds, charged from challenge issue including transit. This can expose a
healthy SSH session to a long webserver/WAN stall; no actual route measurements
or particular-incident diagnosis were made.

Preferred proposal: move the one existing authoritative web runtime/data near
csc-sys; France receives asynchronous copies. Alternative: a substantially larger
regional live verifier/control service with explicit ownership and management
revision acknowledgements. Full protocol, preservation, migration/recovery and
qualification boundaries:docs/marco-runtime-dependency-review.md.

csc-sys hosting was inventoried read-only: nginx/HTTPS already available,3001 free;
4CPUs/7.7GiB RAM,53.7GiB free /var. Docker/Compose/host Node absent; nspawn present.
Existing Docker recipe needs package setup; nspawn needs a new qualified procedure.
Native agent/watchdog use an HTTPS proxy, so same-host HTTPS routing/proxy bypass
must be qualified. Capacity, TLS, SMTP and drained single-writer data migration
remain prerequisites; no package/service/configuration/student record changed.
Evidence:var/collection-tests/csc-web-feasibility.20261112/.

Await implementation/hosting authorization and runtime setup choice. No runtime/tests/deploy
changed for this investigation. The prior --all removal remains locally tested
at dc15f46, unpushed; installed CLI47bda3d/webed09efc/schema37 remain the last
verified production cohort. Next deployment must migrate bundled script calls.
Original ten dirty documentation screenshots preserved. Separate grading-helper
installation and idle task:null diagnostic remain pending as previously recorded.
