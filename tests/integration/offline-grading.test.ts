import { afterEach, expect, test } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
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

test("offline grader help is discoverable without SSH or Docker", () => {
  const result = spawnSync("/usr/bin/zsh", [script, "--help"], {
    encoding: "utf8",
  });
  expect(result.status).toBe(0);
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

test.skipIf(process.env.EXAM_GRADING_DOCKER !== "1")(
  "actual zsh workflow selects latest, compiles in isolated containers, writes CSV/zeroes/errors and proves cleanup",
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "offline-grading-"));
    chmodSync(dir, 0o700);
    const run = join(dir, "private run");
    const grade = `#!/bin/sh
set -u
points=0
if [ -f /work/answer.c ] && gcc -std=gnu2x /work/answer.c -o /tmp/answer >/tmp/build.log 2>&1; then
 if /tmp/answer; then points=20; fi
fi
printf 'TOTAL: %s/100\\n' "$points"
echo 'Checks only: synthetic public grader'
`;
    const materials = join(dir, "materials.tar.gz");
    pack(materials, {
      grade,
      "scoring.tsv": "A1\ttest\t100\town\t1\tSynthetic\n",
    });
    const attempts: (string | number | null)[][] = [];
    const exports: Record<string, string | null> = {};
    const good = "int main(void) { return 0; }";
    const bad = "int main(void) { return 1; }";
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
    const aliceNew = add("alice", "midterm-recovery", 2000, good);
    const aliceOld = add("alice", "midterm", 1000, bad);
    const bobNew = add("bob", "midterm", 3000, bad);
    const bobOld = add("bob", "midterm-recovery", 1000, good);
    const bobPreflight = add("bob", "midterm-recovery", 0, good, "active");
    attempts.at(-1)![2] = null; // Real unstarted exports use an empty TSV start.
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
    const fixture = join(dir, "fixture.json");
    const trace = join(dir, "ssh-trace.jsonl");
    writeFileSync(
      fixture,
      JSON.stringify({ attempts, exports, materials, trace }),
    );
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
    const docker = join(dir, "docker");
    const sandboxAudit = join(dir, "sandbox.jsonl");
    writeFileSync(
      docker,
      `#!/usr/bin/env python3
import json,os,subprocess,sys,time
from pathlib import Path
a=sys.argv[1:]
action=a[2:] if a[:1]==['--host'] else a
with open(os.environ['EXAM_GRADE_ENGINE_TRACE'],'a') as f:f.write(json.dumps(action)+'\\n')
if action[:2]==['container','create']:
 control=os.environ.get('EXAM_GRADE_BLOCK_CREATE')
 if control:
  Path(control+'.ready').write_text('registered, before Docker create')
  until=time.monotonic()+10
  while not Path(control+'.release').exists():
   if time.monotonic()>until:sys.exit(71)
   time.sleep(.02)
 r=subprocess.run(['/usr/bin/docker',*a],capture_output=True);sys.stderr.buffer.write(r.stderr)
 if r.returncode:sys.exit(r.returncode)
 cid=r.stdout.decode().strip();v=json.loads(subprocess.check_output(['/usr/bin/docker','container','inspect',cid]))[0]
 with open(os.environ['EXAM_GRADE_SANDBOX_AUDIT'],'a') as f:f.write(json.dumps(v)+'\\n')
 sys.stdout.buffer.write(r.stdout)
else:os.execv('/usr/bin/docker',['docker',*a])
`,
      { mode: 0o700 },
    );
    const env = {
      ...process.env,
      EXAM_GRADE_SSH_BIN: ssh,
      EXAM_GRADE_DOCKER_BIN: docker,
      EXAM_GRADE_FIXTURE: fixture,
      EXAM_GRADE_SANDBOX_AUDIT: sandboxAudit,
      EXAM_GRADE_ENGINE_TRACE: join(dir, "engine-commands.jsonl"),
      EXAM_GRADE_GRADER_SHA256: createHash("sha256")
        .update(grade)
        .digest("hex"),
      EXAM_GRADE_SECONDS: "2",
    };
    roots.push({ run, env });
    const result = spawnSync(
      "/usr/bin/zsh",
      [script, "run", "synthetic-class", run],
      {
        env,
        encoding: "utf8",
        timeout: 100000,
        maxBuffer: 1024 * 1024,
      },
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
    expect(fetched).not.toContain(aliceOld);
    expect(fetched).not.toContain(bobOld);
    expect(fetched).not.toContain(bobPreflight);
    const containers = readFileSync(sandboxAudit, "utf8")
      .trim()
      .split("\n")
      .map((r) => JSON.parse(r));
    expect(containers.length).toBeGreaterThan(3);
    for (const c of containers) {
      expect(c.Config.User).toBe("65534:65534");
      expect(c.HostConfig.NetworkMode).toBe("none");
      expect(c.HostConfig.ReadonlyRootfs).toBe(true);
      expect(c.HostConfig.Privileged).toBe(false);
      expect(c.HostConfig.CapDrop).toEqual(["ALL"]);
      expect(c.HostConfig.SecurityOpt).toContain("no-new-privileges");
      expect(c.HostConfig.PidsLimit).toBe(128);
      expect(c.HostConfig.Memory).toBe(1024 ** 3);
      expect(c.HostConfig.MemorySwap).toBe(c.HostConfig.Memory);
      expect(
        c.Mounts.filter((m: any) => m.Type === "bind").every(
          (m: any) => m.RW === false,
        ),
      ).toBe(true);
      expect(Object.keys(c.HostConfig.Tmpfs).sort()).toEqual(["/tmp", "/work"]);
    }
    expect(existsSync(join(run, "jobs/escape"))).toBe(false);
    expect(
      readFileSync(join(run, "jobs/iris/engine-state.txt"), "utf8"),
    ).toContain("exited 124 false");
    for (const user of ["alice", "bob", "hank", "iris", "jack"])
      expect(
        readFileSync(join(run, "jobs", user, "cleanup.receipt"), "utf8"),
      ).toContain("absent");
    const check = spawnSync(
      "/usr/bin/docker",
      [
        "container",
        "ls",
        "--all",
        "--filter",
        `label=ssh-exam.offline-run=${readFileSync(join(run, "run-id"), "utf8").trim()}`,
        "--format",
        "{{.ID}}",
      ],
      { encoding: "utf8" },
    );
    expect(check.status).toBe(0);
    expect(check.stdout).toBe("");

    // Cancellation acts on the exact live grading namespace, not just its
    // client process. Preserve the preceding CSV and prove the owned PID dies.
    const cancelRun = join(dir, "cancel run");
    writeFileSync(
      fixture,
      JSON.stringify({
        attempts: attempts.filter((row) => row[0] === "iris"),
        exports,
        materials,
        trace,
      }),
    );
    const cancelEnv = { ...env, EXAM_GRADE_SECONDS: "20" };
    roots.push({ run: cancelRun, env: cancelEnv });
    const child = spawn(
      "/usr/bin/zsh",
      [script, "run", "synthetic-class", cancelRun],
      { env: cancelEnv },
    );
    let cancelOutput = "";
    child.stdout.on("data", (chunk) => (cancelOutput += chunk.toString()));
    child.stderr.on("data", (chunk) => (cancelOutput += chunk.toString()));
    const closed = new Promise<number | null>((resolve) =>
      child.on("close", resolve),
    );
    const namePath = join(cancelRun, "jobs/iris/container.name");
    let running: any;
    const until = Date.now() + 15000;
    while (Date.now() < until) {
      if (existsSync(namePath)) {
        const name = readFileSync(namePath, "utf8").trim();
        const inspect = spawnSync(
          "/usr/bin/docker",
          ["container", "inspect", name],
          { encoding: "utf8", timeout: 5000 },
        );
        if (inspect.status === 0) {
          const current = JSON.parse(inspect.stdout)[0];
          if (current.State.Running) {
            running = current;
            break;
          }
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(
      running,
      "grading worker ended before running checkpoint: " + cancelOutput,
    ).toBeTruthy();
    const pidStat = `/proc/${running.State.Pid}/stat`;
    const identity = readFileSync(pidStat, "utf8")
      .split(")")[1]
      .trim()
      .split(/\s+/)[19];
    const cleanup = spawnSync("/usr/bin/zsh", [script, "cleanup", cancelRun], {
      env: cancelEnv,
      encoding: "utf8",
      timeout: 15000,
    });
    expect(cleanup.status, cleanup.stdout + cleanup.stderr).toBe(0);
    const outcome = await Promise.race([
      closed,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(Error("controller did not observe cancelled namespace")),
          10000,
        ),
      ),
    ]);
    expect(outcome, cancelOutput).toBe(1);
    if (existsSync(pidStat))
      expect(
        readFileSync(pidStat, "utf8").split(")")[1].trim().split(/\s+/)[19],
      ).not.toBe(identity);
    expect(existsSync(join(cancelRun, "grades.csv"))).toBe(false);
    expect(
      readFileSync(join(cancelRun, "jobs/iris/cleanup.receipt"), "utf8"),
    ).toContain("absent");
    expect(readFileSync(join(run, "grades.csv"), "utf8")).toContain("alice,20");

    // Force cancellation while create is blocked: absence at the cleanup RPC
    // is insufficient, so the controller must refuse its later start as well.
    const blockedRun = join(dir, "blocked run"),
      control = join(dir, "create-control");
    const blockedEnv = { ...cancelEnv, EXAM_GRADE_BLOCK_CREATE: control };
    roots.push({ run: blockedRun, env: blockedEnv });
    const blocked = spawn(
      "/usr/bin/zsh",
      [script, "run", "synthetic-class", blockedRun],
      { env: blockedEnv },
    );
    let blockedOutput = "";
    blocked.stdout.on("data", (chunk) => (blockedOutput += chunk.toString()));
    blocked.stderr.on("data", (chunk) => (blockedOutput += chunk.toString()));
    const blockedClosed = new Promise<number | null>((resolve) =>
      blocked.on("close", resolve),
    );
    await expect
      .poll(() => existsSync(control + ".ready"), { timeout: 15000 })
      .toBe(true);
    const blockedName = readFileSync(
      join(blockedRun, "jobs/iris/container.name"),
      "utf8",
    ).trim();
    const cancelled = spawnSync(
      "/usr/bin/zsh",
      [script, "cleanup", blockedRun],
      { env: blockedEnv, encoding: "utf8", timeout: 15000 },
    );
    expect(cancelled.status, cancelled.stdout + cancelled.stderr).toBe(0);
    writeFileSync(control + ".release", "allow exact create to finish");
    const blockedOutcome = await Promise.race([
      blockedClosed,
      new Promise((_, reject) =>
        setTimeout(
          () => reject(Error("cancelled create did not resolve")),
          10000,
        ),
      ),
    ]);
    expect(blockedOutcome, blockedOutput).toBe(1);
    expect(blockedOutput).toContain("cancelled before execution");
    const engineCommands = readFileSync(env.EXAM_GRADE_ENGINE_TRACE, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(
      engineCommands.filter(
        (args) =>
          args[0] === "container" &&
          args[1] === "start" &&
          args.includes(blockedName),
      ),
    ).toHaveLength(0);
    expect(
      readFileSync(join(blockedRun, "jobs/iris/cleanup.receipt"), "utf8"),
    ).toContain("absent");
    expect(existsSync(join(blockedRun, "grades.csv"))).toBe(false);
  },
  120000,
);
