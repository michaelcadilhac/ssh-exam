import { afterEach, expect, test } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";

const script = resolve("examples/grade-midterm.zsh");
const extractor = resolve("examples/grading-extract.py");
const roots: { run: string; env: NodeJS.ProcessEnv }[] = [];
afterEach(() => {
  for (const { run, env } of roots.splice(0)) {
    if (!existsSync(join(run, "run-id"))) continue;
    const result = spawnSync("/usr/bin/zsh", [script, "cleanup", run], {
      env,
      encoding: "utf8",
      timeout: 30000,
    });
    expect(result.status, result.stdout + result.stderr).toBe(0);
  }
});

function pack(path: string, files: Record<string, string>, kind = "regular") {
  const result = spawnSync(
    "python3",
    [
      "-c",
      `
import io,json,tarfile,sys
files=json.loads(sys.argv[2])
with tarfile.open(sys.argv[1],'w:gz') as archive:
 for name,value in files.items():
  data=value.encode();entry=tarfile.TarInfo(name);entry.size=len(data);entry.mode=0o7777
  if sys.argv[3]=='symlink':entry.type=tarfile.SYMTYPE;entry.linkname='/etc/passwd';entry.size=0
  archive.addfile(entry,io.BytesIO(data))
`,
      path,
      JSON.stringify(files),
      kind,
    ],
    { encoding: "utf8", timeout: 5000 },
  );
  expect(result.status, result.stderr).toBe(0);
}
function hash(path: string) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

test("offline grader help is discoverable without SSH or sandbox tools", () => {
  const result = spawnSync("/usr/bin/zsh", [script, "--help"], {
    encoding: "utf8",
  });
  expect(result.status).toBe(0);
  expect(result.stderr).toContain(`${script} run CLASS_SSH_HOST`);
  expect(result.stderr).not.toContain("  usage run ");
  expect(result.stderr).toContain("USERNAME,GRADE");
  expect(result.stderr).toContain("cleanup OUTPUT_DIRECTORY");
});

test.each(["../escape", "/escape", "link", "a/../escape"])(
  "archive validator refuses unsafe student member %s",
  (name) => {
    const dir = mkdtempSync(join(tmpdir(), "grading-archive-"));
    const archive = join(dir, "input.tar.gz"),
      output = join(dir, "work");
    mkdirSync(output, { mode: 0o700 });
    pack(
      archive,
      { [name]: "UNTRUSTED" },
      name === "link" ? "symlink" : "regular",
    );
    const result = spawnSync(
      "python3",
      [extractor, "submission", archive, output],
      {
        encoding: "utf8",
        timeout: 5000,
      },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Archive refused");
    expect(existsSync(join(dir, "escape"))).toBe(false);
  },
);

test("archive validator strips submitted privileges and excludes collection metadata", () => {
  const dir = mkdtempSync(join(tmpdir(), "grading-permissions-"));
  const archive = join(dir, "input.tar.gz"),
    output = join(dir, "work");
  mkdirSync(output, { mode: 0o700 });
  pack(archive, { "a/source.c": "saved", "MANIFEST.json": "{}" });
  const result = spawnSync(
    "python3",
    [extractor, "submission", archive, output],
    {
      encoding: "utf8",
      timeout: 5000,
    },
  );
  expect(result.status, result.stderr).toBe(0);
  expect(readFileSync(join(output, "a/source.c"), "utf8")).toBe("saved");
  expect(statSync(join(output, "a/source.c")).mode & 0o7777).toBe(0o644);
  expect(existsSync(join(output, "MANIFEST.json"))).toBe(false);
});

test.skipIf(process.env.EXAM_GRADING_BWRAP !== "1")(
  "actual zsh workflow grades in bounded bwrap namespaces and cancels active or delayed jobs",
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "offline-grading-bwrap-"));
    chmodSync(dir, 0o700);
    const run = join(dir, "private run");
    const grade = `#!/bin/sh
set -eu
python3 - <<'CHECK'
import os,pathlib
assert os.getuid()!=0
status=pathlib.Path('/proc/self/status').read_text()
assert 'NoNewPrivs:\\t1' in status
assert 'CapEff:\\t0000000000000000' in status
assert not pathlib.Path('${dir}/host-secret').exists()
assert not pathlib.Path('/home/micha').exists()
assert not pathlib.Path('/etc/shadow').exists()
assert not pathlib.Path('/sys/fs/cgroup').exists()
try:
 pathlib.Path('/materials/grade').write_text('bad')
 raise RuntimeError('materials writable')
except OSError:pass
print('NETNS: '+os.readlink('/proc/self/ns/net'))
print('SANDBOX: nonroot, empty capabilities, nnp, private files, readonly materials')
CHECK
points=0
if [ -f /work/answer.c ] && gcc -std=gnu2x /work/answer.c -o /tmp/answer >/tmp/build.log 2>&1; then
 if /tmp/answer; then points=20; fi
fi
printf 'TOTAL: %s/100\\n' "$points"
`;
    writeFileSync(join(dir, "host-secret"), "private host sentinel", {
      mode: 0o600,
    });
    const materials = join(dir, "materials.tar.gz");
    pack(materials, {
      grade,
      "scoring.tsv": "A1\\ttest\\t100\\town\\t1\\tSynthetic\\n",
    });
    const attempts: (string | number | null)[][] = [];
    const exports: Record<string, string | null> = {};
    const good = "int main(void) { return 0; }",
      bad = "int main(void) { return 1; }";
    const add = (
      user: string,
      exam: string,
      start: number,
      program: string,
      special = "",
    ) => {
      const id = randomUUID(),
        archive = join(dir, id + ".tar.gz");
      pack(
        archive,
        special === "traversal"
          ? { "../escape": "BAD" }
          : { "answer.c": program, "MANIFEST.json": "{}" },
      );
      attempts.push([
        user,
        exam,
        start,
        id,
        special === "checksum" ? "0".repeat(64) : hash(archive),
        special === "active" ? 0 : 1,
        special === "active" ? "ACTIVE" : "COMPLETED",
      ]);
      exports[id] = special === "export" ? null : archive;
      return id;
    };
    const aliceNew = add("alice", "midterm-recovery", 2000, good),
      aliceOld = add("alice", "midterm", 1000, bad);
    const bobNew = add("bob", "midterm", 3000, bad),
      bobOld = add("bob", "midterm-recovery", 1000, good);
    const bobPreflight = add("bob", "midterm-recovery", 0, good, "active");
    attempts.at(-1)![2] = null;
    add("charlie", "midterm", 0, good, "active");
    add("dave", "midterm", 1000, good, "export");
    add("erin", "midterm-recovery", 5000, good, "active");
    add("erin", "midterm", 1000, good);
    add("frank", "midterm", 1000, good);
    add("frank", "midterm-recovery", 1000, bad);
    add("gina", "midterm", 1000, good, "checksum");
    add("hank", "midterm", 1000, bad, "traversal");
    add("iris", "midterm", 1000, "int main(void) { for (;;) {} }");
    add(
      "jack",
      "midterm",
      1000,
      '#include <stdio.h>\nint main(void) { puts("TOTAL: 100/100"); return 0; }',
    );
    const fixture = join(dir, "fixture.json"),
      trace = join(dir, "ssh-trace.jsonl");
    const saveFixture = (rows = attempts) =>
      writeFileSync(
        fixture,
        JSON.stringify({ attempts: rows, exports, materials, trace }),
      );
    saveFixture();
    const ssh = join(dir, "ssh");
    writeFileSync(
      ssh,
      `#!/usr/bin/env python3
import json,os,shlex,sys
from pathlib import Path
c=json.loads(Path(os.environ['EXAM_GRADE_FIXTURE']).read_text());a=shlex.split(sys.argv[-1])
with open(c['trace'],'a') as f:f.write(json.dumps(a)+'\\n')
if a[:3]==['sudo','-n','/usr/local/sbin/examctl']:
 a=a[3:]
 if a[:3]==['web','students','list']:
  assert '--all' in a and a[a.index('--fields')+1]=='username'
  print('alice\\nbob\\ncharlie' if a[3]=='midterm' else 'alice\\ndave')
 elif a[:3]==['web','attempts','list']:
  assert '--all' in a and a.count('--exam')==2
  for row in c['attempts']:print('\\t'.join('' if v is None else str(v) for v in row))
 elif a[0]=='export':
  path=c['exports'][a[1]]
  if path is None:sys.exit(1)
  sys.stdout.buffer.write(Path(path).read_bytes())
 else:raise RuntimeError('Unexpected management mutation')
elif a[:3]==['sudo','-n','tar']:sys.stdout.buffer.write(Path(c['materials']).read_bytes())
else:raise RuntimeError('Unexpected SSH command')
`,
      { mode: 0o700 },
    );
    const systemd = join(dir, "systemd-run");
    writeFileSync(
      systemd,
      `#!/usr/bin/env python3
import json,os,sys,time
from pathlib import Path
with open(os.environ['EXAM_GRADE_SYSTEMD_TRACE'],'a') as f:f.write(json.dumps(sys.argv[1:])+'\\n')
control=os.environ.get('EXAM_GRADE_BLOCK_START')
if control:
 Path(control+'.ready').write_text('before StartTransientUnit')
 until=time.monotonic()+10
 while not Path(control+'.release').exists():
  if time.monotonic()>until:sys.exit(71)
  time.sleep(.02)
a=sys.argv[1:]
if os.environ.get('EXAM_GRADE_BAD_BOUND'):
 a=['--property=MemoryMax=128M' if v=='--property=MemoryMax=1G' else v for v in a]
os.execv('/usr/bin/systemd-run',['systemd-run',*a])
`,
      { mode: 0o700 },
    );
    const env = {
      ...process.env,
      EXAM_GRADE_SSH_BIN: ssh,
      EXAM_GRADE_SYSTEMD_RUN_BIN: systemd,
      EXAM_GRADE_FIXTURE: fixture,
      EXAM_GRADE_SYSTEMD_TRACE: join(dir, "systemd-trace.jsonl"),
      EXAM_GRADE_GRADER_SHA256: createHash("sha256")
        .update(grade)
        .digest("hex"),
      EXAM_GRADE_SECONDS: "2",
    };
    roots.push({ run, env });
    const result = spawnSync(
      "/usr/bin/zsh",
      [script, "run", "synthetic-class", run],
      { env, encoding: "utf8", timeout: 100000 },
    );
    expect(result.status, result.stdout + result.stderr).toBe(1);
    expect(readFileSync(join(run, "grades.csv"), "utf8")).toBe(
      "USERNAME,GRADE\nalice,20\nbob,0\ncharlie,0\ndave,\nerin,\nfrank,\ngina,\nhank,\niris,\njack,\n",
    );
    const errors = readFileSync(join(run, "errors.tsv"), "utf8");
    for (const reason of [
      "EXPORT_FAILED",
      "LATEST_NOT_PROTECTED",
      "AMBIGUOUS_LATEST",
      "CHECKSUM_MISMATCH",
      "GRADER_FAILED",
      "INVALID_GRADER_TOTAL",
    ])
      expect(errors).toContain(reason);
    const requests = readFileSync(trace, "utf8")
      .trim()
      .split("\n")
      .map((r) => JSON.parse(r));
    const fetched = requests.filter((r) => r[3] === "export").map((r) => r[4]);
    expect(fetched).toContain(aliceNew);
    expect(fetched).toContain(bobNew);
    for (const old of [aliceOld, bobOld, bobPreflight])
      expect(fetched).not.toContain(old);
    expect(existsSync(join(run, "jobs/escape"))).toBe(false);
    const logs = readFileSync(join(run, "jobs/alice/grader.log"), "utf8");
    expect(logs).toContain("SANDBOX: nonroot");
    expect(logs).toContain("Verified grading cgroup: memory=1GiB");
    expect(logs).not.toContain("NETNS: " + readlinkSync("/proc/self/ns/net"));
    expect(
      readFileSync(join(run, "jobs/iris/sandbox-exit.txt"), "utf8").trim(),
    ).not.toBe("0");
    expect(
      readFileSync(join(run, "jobs/iris/unit-state.txt"), "utf8"),
    ).toContain("Result=timeout");
    for (const user of ["alice", "bob", "hank", "iris", "jack"])
      expect(
        readFileSync(join(run, "jobs", user, "cleanup.receipt"), "utf8"),
      ).toContain("cgroup empty or removed");
    const commands = readFileSync(env.EXAM_GRADE_SYSTEMD_TRACE, "utf8")
      .trim()
      .split("\n")
      .map((r) => JSON.parse(r));
    for (const command of commands) {
      for (const prop of [
        "MemoryMax=1G",
        "MemorySwapMax=0",
        "TasksMax=128",
        "CPUQuota=100%",
        "KillMode=control-group",
        "NoNewPrivileges=yes",
      ])
        expect(command).toContain("--property=" + prop);
      expect(command).toContain("--unshare-user");
      expect(command).toContain("--disable-userns");
    }

    // Exercise local class-server invocation without SSH, through a synthetic
    // examctl executable. The sandbox and compiler remain real.
    const localMaterials = join(dir, "local-materials");
    mkdirSync(localMaterials);
    for (const path of ["include", "tests"])
      mkdirSync(join(localMaterials, path));
    writeFileSync(join(localMaterials, "grade"), grade);
    writeFileSync(join(localMaterials, "scoring.tsv"), "synthetic");
    const ec = join(dir, "examctl");
    writeFileSync(
      ec,
      `#!/usr/bin/env python3
import os,sys,shlex
os.execv(${JSON.stringify(ssh)},[${JSON.stringify(ssh)},shlex.join(['sudo','-n','/usr/local/sbin/examctl',*sys.argv[1:]])])
`,
      { mode: 0o700 },
    );
    const localRun = join(dir, "local run");
    const localEnv = {
      ...env,
      EXAM_GRADE_EXAMCTL_BIN: ec,
      EXAM_GRADE_MATERIALS: localMaterials,
    };
    roots.push({ run: localRun, env: localEnv });
    saveFixture(attempts.filter((r) => r[0] === "alice"));
    const local = spawnSync(
      "/usr/bin/zsh",
      [script, "run", "--local", localRun],
      { env: localEnv, encoding: "utf8", timeout: 20000 },
    );
    expect(local.status, local.stdout + local.stderr).toBe(0);
    expect(readFileSync(join(localRun, "grades.csv"), "utf8")).toContain(
      "alice,20",
    );

    // A real kernel limit differing from the requested properties must refuse
    // before the supplied grader or any submitted program is executed.
    const badRun = join(dir, "wrong kernel bound");
    const badEnv = { ...env, EXAM_GRADE_BAD_BOUND: "1" };
    roots.push({ run: badRun, env: badEnv });
    const badLimit = spawnSync(
      "/usr/bin/zsh",
      [script, "run", "synthetic-class", badRun],
      {
        env: badEnv,
        encoding: "utf8",
        timeout: 20000,
      },
    );
    expect(badLimit.status, badLimit.stdout + badLimit.stderr).toBe(1);
    expect(readFileSync(join(badRun, "grades.csv"), "utf8")).toContain(
      "alice,\n",
    );
    const badLog = readFileSync(join(badRun, "jobs/alice/grader.log"), "utf8");
    expect(badLog).toContain("kernel bound mismatch: memory.max");
    expect(badLog).not.toContain("SANDBOX:");
    expect(badLog).not.toContain("TOTAL:");

    const mode = process.getuid!() === 0 ? "--system" : "--user";
    function status(unit: string) {
      const result = spawnSync(
        "/usr/bin/systemctl",
        [
          mode,
          "show",
          unit,
          "--no-pager",
          "--property=ActiveState,MainPID,ControlGroup,MemoryMax,MemorySwapMax,TasksMax,CPUQuotaPerSecUSec",
        ],
        { encoding: "utf8", timeout: 5000 },
      );
      expect(result.status, result.stderr).toBe(0);
      return Object.fromEntries(
        result.stdout
          .trim()
          .split("\n")
          .map((line) => line.split("=")),
      );
    }
    const ctl = join(dir, "systemctl");
    const stopRace = join(dir, "stop-race.txt");
    writeFileSync(
      ctl,
      `#!/usr/bin/env python3
import os,subprocess,sys,time
from pathlib import Path
a=sys.argv[1:]
if len(a)>=3 and a[1]=='stop':
 assert a[2].startswith('exam-grade-')
 subprocess.run(['/usr/bin/systemctl',*a],capture_output=True)
 subprocess.run(['/usr/bin/systemctl',a[0],'reset-failed',a[2]],capture_output=True)
 until=time.monotonic()+5
 while time.monotonic()<until:
  state=subprocess.check_output(['/usr/bin/systemctl',a[0],'show',a[2],'--property=LoadState','--value'],text=True).strip()
  if state=='not-found':break
  time.sleep(.01)
 else:raise RuntimeError('peer cleanup did not unload exact unit')
 result=subprocess.run(['/usr/bin/systemctl',*a],capture_output=True)
 assert result.returncode!=0 and b'not loaded' in result.stderr
 Path(${JSON.stringify(stopRace)}).write_text(result.stderr.decode())
 sys.stderr.buffer.write(result.stderr);sys.exit(result.returncode)
os.execv('/usr/bin/systemctl',['systemctl',*a])
`,
      { mode: 0o700 },
    );
    const cancelRun = join(dir, "cancel run"),
      cancelEnv = {
        ...env,
        EXAM_GRADE_SECONDS: "20",
        EXAM_GRADE_SYSTEMCTL_BIN: ctl,
      };
    roots.push({ run: cancelRun, env: cancelEnv });
    saveFixture(attempts.filter((row) => row[0] === "iris"));
    const child = spawn(
      "/usr/bin/zsh",
      [script, "run", "synthetic-class", cancelRun],
      { env: cancelEnv },
    );
    let output = "";
    child.stdout.on("data", (c) => (output += c));
    child.stderr.on("data", (c) => (output += c));
    const closed = new Promise<number | null>((resolve) =>
      child.on("close", resolve),
    );
    const unitPath = join(cancelRun, "jobs/iris/unit.name");
    let live: Record<string, string> | undefined;
    await expect
      .poll(
        () => {
          if (!existsSync(unitPath)) return false;
          const state = status(readFileSync(unitPath, "utf8").trim());
          if (state.ActiveState === "active" && state.MainPID !== "0") {
            live = state;
            return true;
          }
          return false;
        },
        { timeout: 15000 },
      )
      .toBe(true);
    expect(live!.MemoryMax).toBe(String(1024 ** 3));
    expect(live!.MemorySwapMax).toBe("0");
    expect(live!.TasksMax).toBe("128");
    const group = join("/sys/fs/cgroup", live!.ControlGroup);
    expect(readFileSync(join(group, "memory.max"), "utf8").trim()).toBe(
      String(1024 ** 3),
    );
    expect(readFileSync(join(group, "pids.max"), "utf8").trim()).toBe("128");
    const pidStat = "/proc/" + live!.MainPID + "/stat";
    const started = (path: string) =>
      readFileSync(path, "utf8").split(")").at(-1)!.trim().split(/\s+/)[19];
    const identity = started(pidStat);
    const cleanup = spawnSync("/usr/bin/zsh", [script, "cleanup", cancelRun], {
      env: cancelEnv,
      encoding: "utf8",
      timeout: 15000,
    });
    expect(cleanup.status, cleanup.stdout + cleanup.stderr).toBe(0);
    expect(readFileSync(stopRace, "utf8")).toContain("not loaded");
    const outcome = await Promise.race([
      closed,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(Error("controller did not cancel: " + output)),
          10000,
        ),
      ),
    ]);
    expect(outcome, output).toBe(1);
    if (existsSync(pidStat)) expect(started(pidStat)).not.toBe(identity);
    if (existsSync(join(group, "cgroup.events")))
      expect(readFileSync(join(group, "cgroup.events"), "utf8")).toContain(
        "populated 0",
      );
    expect(existsSync(join(cancelRun, "grades.csv"))).toBe(false);
    expect(readFileSync(join(run, "grades.csv"), "utf8")).toContain("alice,20");

    const blockedRun = join(dir, "blocked run"),
      control = join(dir, "start-control");
    const blockedEnv = { ...cancelEnv, EXAM_GRADE_BLOCK_START: control };
    roots.push({ run: blockedRun, env: blockedEnv });
    const blocked = spawn(
      "/usr/bin/zsh",
      [script, "run", "synthetic-class", blockedRun],
      { env: blockedEnv },
    );
    let blockedOutput = "";
    blocked.stdout.on("data", (c) => (blockedOutput += c));
    blocked.stderr.on("data", (c) => (blockedOutput += c));
    const blockedClosed = new Promise<number | null>((resolve) =>
      blocked.on("close", resolve),
    );
    await expect
      .poll(() => existsSync(control + ".ready"), { timeout: 15000 })
      .toBe(true);
    const cancelled = spawnSync(
      "/usr/bin/zsh",
      [script, "cleanup", blockedRun],
      { env: blockedEnv, encoding: "utf8", timeout: 15000 },
    );
    expect(cancelled.status, cancelled.stdout + cancelled.stderr).toBe(0);
    writeFileSync(control + ".release", "release exact StartTransientUnit");
    const blockedOutcome = await Promise.race([
      blockedClosed,
      new Promise((_, reject) =>
        setTimeout(() => reject(Error("late start did not cancel")), 10000),
      ),
    ]);
    expect(blockedOutcome, blockedOutput).toBe(1);
    const lateLog = readFileSync(
      join(blockedRun, "jobs/iris/grader.log"),
      "utf8",
    );
    expect(lateLog).not.toContain("SANDBOX:");
    expect(lateLog).not.toContain("TOTAL:");
    expect(
      readFileSync(join(blockedRun, "jobs/iris/cleanup.receipt"), "utf8"),
    ).toContain("cgroup empty or removed");
    expect(existsSync(join(blockedRun, "grades.csv"))).toBe(false);

    // The service deadline is independent of the controller. Verify an exact
    // controller SIGKILL and kernel teardown, not just a failed command.
    const crashRun = join(dir, "controller death");
    roots.push({ run: crashRun, env });
    const crashed = spawn(
      "/usr/bin/zsh",
      [script, "run", "synthetic-class", crashRun],
      { env },
    );
    const crashedClosed = new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
    }>((resolve) =>
      crashed.on("close", (code, signal) => resolve({ code, signal })),
    );
    const crashUnitPath = join(crashRun, "jobs/iris/unit.name");
    let crashUnit = "";
    let crashGroup = "";
    await expect
      .poll(
        () => {
          if (!existsSync(crashUnitPath)) return false;
          crashUnit = readFileSync(crashUnitPath, "utf8").trim();
          const current = status(crashUnit);
          if (current.ActiveState !== "active") return false;
          crashGroup = current.ControlGroup;
          return true;
        },
        { timeout: 15000 },
      )
      .toBe(true);
    crashed.kill("SIGKILL");
    expect(await crashedClosed).toEqual({ code: null, signal: "SIGKILL" });
    await expect
      .poll(
        () => ["inactive", "failed"].includes(status(crashUnit).ActiveState),
        { timeout: 8000 },
      )
      .toBe(true);
    const crashEvents = join("/sys/fs/cgroup", crashGroup, "cgroup.events");
    if (existsSync(crashEvents))
      expect(readFileSync(crashEvents, "utf8")).toContain("populated 0");
    expect(existsSync(join(crashRun, "grades.csv"))).toBe(false);
  },
  120000,
);
