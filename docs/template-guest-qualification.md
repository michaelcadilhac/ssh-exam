# Template CLI: disposable system-manager qualification

October22,2026. Local candidate qualification only; no deployment, installed-host
service/configuration/account change, grant issuance or source selection.

The template-catalog profile uses the existing guarded disposable nspawn overlay,
private PID/mount/network namespaces and manifested candidate inputs. It adds the
supplied exam-template.slice as a read-only candidate bind, not a host install.
The runner continuously refuses/aborts on live or unresolved host attempts and
compares installed binaries/configuration/authority plus the untouched guest base
after exit. The existing1GiB/no-swap/512-task/50%-CPU/900-second guest boundary
is unchanged. No production service is stopped or restarted.

Inside that guest the actual root examctl uses an exclusive private synthetic
state/source beneath this run's disk-backed output bind, not the guest agent's
state. No manager adapter or worker test option is used. Tests exercise actual
validate/install/show/verify/list/jobs/clean commands and the real system manager:
128MiB streamed source, separately bounded template pool, exact retry after author
changes/disappearing source, conflicting intent/wrong expected hash, symlink
refusal, and published-job cleanup preserving the installed exact version.
Original synthetic authority and private protected-byte sentinels are unchanged.
No gateway acknowledgement, native Begin or unified grant is manufactured.

Systemd reports /exam.slice/exam-template.slice; live memory.max268435456,
memory.swap.max0 and pids.max32 are checked. Slice-name dashes encode hierarchy,
as described by the primary [systemd slice documentation](https://www.freedesktop.org/software/systemd/man/257/systemd.slice.html).
Template and collection are sibling bounded slices; the supplied parent exam.slice
is accounting-only. Whole-host/ancestor headroom still matters. This is a real
128MiB workflow, not worst-case combined capacity or every resource-failure claim.
Existing local user-systemd worker death/OOM/runtime and namespace fault tests
remain separately recorded in template-catalog.md/todo-progress.md.

Failed fixtures are retained and are NOT qualification passes:

- /var/tmp/ssh-exam-overlay-urmj72yk expected a top-level template cgroup path,
  contrary to systemd's slice hierarchy. The test now checks the exact hierarchy
  and unchanged limits; no unit/limit is altered to fit the assertion.
- /var/tmp/ssh-exam-overlay-cd4kd5b_ and
  /var/tmp/ssh-exam-overlay-91j3h3u7 expose byte equality against the idle guest
  agent's independently updated callback queue. Scoped diagnosis proves changes
  only in events/sequence, with private CLI-state and protected sentinels unchanged.
  The corrected comparison excludes exactly callback events/sequence/reported
  bookkeeping and compares every other field, including unknown future keys.
  Native regressions refuse changed deadlines, holds, protection, settings and
  64-bit identities, duplicate JSON and trailing data. Private CLI-state remains
  strictly byte-compared. These are fixture corrections, not weaker live policy.

The corrected preliminary workflow passes3.92s in
/var/tmp/ssh-exam-overlay-fgdaptsp. The final artifact adds published-job cleanup
and passes4.21s in /var/tmp/ssh-exam-overlay-gc3qjte_. Host/base preservation passes
both. The identical final artifact passes4.21s again in
/var/tmp/ssh-exam-overlay-q72z3s0n; host/base preservation passes. All31 Python
safety/helper checks and20 repeated native host-refusal/preservation cases pass.
Final full uncached native race/resource/namespace/compiler/default-size suite
passes core171.016s/CLI6.960s; static build/vet pass. There are no product runtime
changes in this guest-only increment. The contemporaneous414-app/113-browser
export qualification has140 source/runtime hashes unchanged; no new web build
or different browser artifact is assigned to this test fixture.

Final candidate hashes:

```text
de4679447bc1f869c2e6c2f0db79d8b0518bc0aba67dede97604dca76e387098  examctl
f6cf8fe6c4254618db901b116ce4ca0f3f03c4af8e440bfeeb5ac67fe239edbc  core-qualification.test
```

The exact13-file SHA256.json is retained in each private run's input directory;
no candidate binaries, private monitoring, credentials or student records enter
this repository. Test outputs are bounded synthetic evidence, retained without
blanket cleanup. This qualifies a narrow real template CLI/system-manager gate,
not immutable gateway issuance/claim/Begin, legacy migration, saved-work grants,
definition retirement, retained SSH or deployment. Those TODOs remain open.
