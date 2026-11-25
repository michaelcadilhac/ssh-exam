# Current checkpoint — pushed, deployed and online

November25: runtime96a323e/controller6083777 are deployed on csc-sys.
Admissions reopened23:48:20UTC (17:48 Chicago). Student capture/preview videos
request no picture-in-picture; Start/Resume close existing owned pop-outs before
requesting authority. Recording, monitoring enforcement and deadlines are unchanged.
[Behavior](student-video-preview.md) · [Deployment/recovery](student-video-preview-release.md).

Verification:39 affected unit checks, two HTTP capture tests and14browser
workflows pass; typecheck/build pass. Release qualification passes76 public
controller,34 preservation and eight observer checks, actual-image signed-poll
startup expiry, background writers and same-running-candidate recovery. Production
passes47 exact external assets,41 preservation contracts,270 unchanged native
histories, all native binaries/PIDs/configuration and a signed root CLI read.
No migration, native restart, student sign-in/MFA or test email was performed.

Cutover116.30s. Snapshot398,024,704database bytes and773,581other small bytes;
2,532,979,981recording bytes reused, zero new media objects. The owned video pause
is released. Total instruction-to-reopening2h39m02s includes authentication wait;
key-loaded continuation-to-reopening8m29s includes the cancelled template correction.
The rejected first fence left the old site online; its state remains CANCELLED.
The corrected rendered nginx files exactly match prior qualified csc-sys bytes.

Recovery state:
`/var/tmp/ssh-exam-preview-20261125-96a323e-ae0a67a3-state`.
Use its frozen controller, SAME candidate, CURRENT data and original snapshot.
Never restore historical metadata or reopen an older writer. Private receipts:
`var/student-video-preview-release/20261125/retry-csc-template/`.

This deployment is complete. Any future deployment needs a new instruction.
Optional certificate-path staging checks are separate follow-up work. Larger
35/70 capacity and physical multi-display/Windows-drag acceptance remain unclaimed.
Final's instructor-enabled one-display setting is preserved. Keep the ten
pre-existing modified documentation PNGs unstaged; no recurring deploy timer exists.
