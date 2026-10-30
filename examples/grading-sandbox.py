#!/usr/bin/env python3
"""Run one offline grading job with bwrap and a bounded transient systemd unit."""
import argparse
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys


def executable(name):
    value = shutil.which(os.environ.get("EXAM_GRADE_" + name.upper().replace("-", "_") + "_BIN", name))
    if not value:
        raise RuntimeError("Required executable unavailable: " + name)
    return value


def call(args):
    return subprocess.run(args, stdin=subprocess.DEVNULL, capture_output=True,
                          text=True, timeout=15)


def identity(run_id, job):
    if not re.fullmatch(r"[a-f0-9]{32}", run_id) or not re.fullmatch(r"[a-zA-Z][a-zA-Z0-9_-]{0,31}", job.name):
        raise ValueError("Invalid owned grading identity")
    return "exam-grade-" + run_id + "-" + job.name + ".service"


def manager(job):
    value = (job / "manager.txt").read_text().strip()
    if value not in ("system", "user"):
        raise ValueError("Invalid grading manager")
    return ["--" + value]


def cleanup(run_id, job):
    unit = identity(run_id, job)
    marker = job / "unit.name"
    if not marker.exists():
        return  # A later launch must check the persistent cancellation marker.
    if marker.read_text().strip() != unit:
        raise ValueError("Grading unit identity mismatch")
    ctl = [executable("systemctl"), *manager(job)]

    def status():
        result = call([*ctl, "show", unit, "--no-pager",
                       "--property=LoadState,ActiveState,Description,ControlGroup,MainPID,Result,ExecMainCode,ExecMainStatus"])
        values = dict(line.split("=", 1) for line in result.stdout.splitlines() if "=" in line)
        if result.returncode or not {"LoadState", "ActiveState", "MainPID", "ControlGroup"} <= values.keys():
            raise RuntimeError("Grading manager unavailable: " + result.stderr.strip())
        if values["LoadState"] != "not-found" and values.get("Description") != "SSH Exam offline grading " + run_id:
            raise RuntimeError("Foreign unit: " + unit)
        return values

    state = status()
    if not (job / "unit-state.txt").exists():
        (job / "unit-state.txt").write_text("".join(key + "=" + value + "\n" for key, value in sorted(state.items())))
    group = state["ControlGroup"]
    if state["LoadState"] != "not-found":
        stopped = call([*ctl, "stop", unit])
        # The waiting controller may finish its own cleanup concurrently.
        # Re-read the manager; never infer absence from the stop error text.
        if stopped.returncode and status()["LoadState"] != "not-found":
            raise RuntimeError("Owned grading stop unconfirmed: " + stopped.stderr.strip())
    final = status()
    if final["ActiveState"] not in ("inactive", "failed") or final["MainPID"] != "0":
        raise RuntimeError("Owned grading unit is still active")
    if group:
        if not group.startswith("/") or ".." in Path(group).parts:
            raise ValueError("Invalid grading cgroup")
        events = Path("/sys/fs/cgroup") / group.lstrip("/") / "cgroup.events"
        if events.exists() and "populated 1" in events.read_text().splitlines():
            raise RuntimeError("Owned grading descendants remain")
    if final["LoadState"] != "not-found":
        reset = call([*ctl, "reset-failed", unit])
        if reset.returncode and status()["LoadState"] != "not-found":
            raise RuntimeError("Owned grading reset unconfirmed")
    (job / "cleanup.receipt").write_text("owned sandbox inactive; cgroup empty or removed\n")


def quote_property(value):
    return '"' + str(value).replace("\\", "\\\\").replace('"', '\\"').replace("%", "%%") + '"'


def enter(command):
    """Verify this service's actual kernel bounds before executing bwrap."""
    if os.geteuid() == 0:
        raise RuntimeError("Grading worker must have an unprivileged host UID")
    groups = Path("/proc/self/cgroup").read_text().splitlines()
    unified = [line[3:] for line in groups if line.startswith("0::/")]
    if len(unified) != 1 or ".." in Path(unified[0]).parts:
        raise RuntimeError("A verified cgroup v2 grading unit is required")
    group = Path("/sys/fs/cgroup") / unified[0].lstrip("/")
    for name, value in (("memory.max", str(1024**3)), ("memory.swap.max", "0"), ("pids.max", "128")):
        if (group / name).read_text().strip() != value:
            raise RuntimeError("Grading kernel bound mismatch: " + name)
    quota, period = (group / "cpu.max").read_text().split()
    if quota == "max" or int(quota) != int(period):
        raise RuntimeError("Grading kernel bound mismatch: cpu.max")
    if command[:1] == ["--"]:
        command = command[1:]
    if not command:
        raise ValueError("Missing sandbox command")
    print("Verified grading cgroup: memory=1GiB swap=0 tasks=128 cpu=1", flush=True)
    os.execv(command[0], command)


def run(args):
    job, materials, extractor, control = (Path(p).resolve(strict=True) for p in
                                         (args.job, args.materials, args.extractor, args.control))
    unit = identity(args.run_id, job)
    if (control / "cancelled").exists():
        raise RuntimeError("Grading cancelled before launch")
    scope = "system" if os.geteuid() == 0 else "user"
    (job / "manager.txt").write_text(scope + "\n")
    (job / "unit.name").write_text(unit + "\n")
    bwrap = executable("bwrap")
    properties = ["MemoryMax=1G", "MemorySwapMax=0", "TasksMax=128", "CPUQuota=100%",
                  "RuntimeMaxSec=" + str(args.seconds), "TimeoutStopSec=2s",
                  "KillMode=control-group", "OOMPolicy=kill", "LimitCORE=0",
                  "LimitNOFILE=1024", "NoNewPrivileges=yes"]
    inputs = {"archive": job / "submission.tar.gz", "materials": materials,
              "extractor": extractor, "control": control, "runner": Path(__file__).resolve()}
    if scope == "system":
        # systemd mounts only these inputs before dropping to a transient UID.
        # Their root-private ancestors need not become accessible on the host.
        runtime = unit.removesuffix(".service")
        binds = []
        for name, source in list(inputs.items()):
            destination = Path("/run") / runtime / name
            binds.append(quote_property(source) + ":" + quote_property(destination))
            inputs[name] = destination
        properties += ["DynamicUser=yes", "RuntimeDirectory=" + runtime,
                       "RuntimeDirectoryMode=0700", "ProtectHome=tmpfs",
                       "ProtectSystem=strict", "BindReadOnlyPaths=" + " ".join(binds)]
    command = [executable("systemd-run"), "--" + scope, "--quiet", "--wait", "--pipe",
               "--service-type=exec", "--unit=" + unit,
               "--description=SSH Exam offline grading " + args.run_id,
               "--expand-environment=no"]
    command += ["--property=" + value for value in properties]
    command += ["--", "/usr/bin/python3", str(inputs["runner"]), "enter", "--",
                bwrap, "--unshare-all", "--unshare-user", "--disable-userns",
                "--new-session", "--die-with-parent", "--cap-drop", "ALL",
                "--ro-bind", "/usr", "/usr"]
    for name in ("/bin", "/sbin", "/lib", "/lib64"):
        path = Path(name)
        if path.is_symlink():
            command += ["--symlink", os.readlink(path), name]
        elif path.is_dir():
            command += ["--ro-bind", name, name]
    command += ["--proc", "/proc", "--dev", "/dev",
                "--size", str(640 * 1024**2), "--tmpfs", "/work",
                "--size", str(256 * 1024**2), "--tmpfs", "/tmp", "--dir", "/input",
                "--ro-bind", str(inputs["archive"]), "/input/submission.tar.gz",
                "--ro-bind", str(inputs["materials"]), "/materials",
                "--ro-bind", str(inputs["extractor"]), "/grading-extract.py",
                "--ro-bind", str(inputs["control"]), "/control",
                "--clearenv", "--setenv", "PATH", "/usr/bin:/bin",
                "--setenv", "HOME", "/tmp", "--setenv", "TMPDIR", "/tmp",
                "--setenv", "LC_ALL", "C", "--chdir", "/work",
                "/bin/sh", "-c", '[ ! -e /control/cancelled ] || exit 125; '
                'python3 /grading-extract.py submission /input/submission.tar.gz /work '
                '&& exec /materials/grade --work /work']
    # Inspectable provenance; no submitted code has run before registration.
    import shlex
    (job / "sandbox-command.txt").write_text(shlex.join(command) + "\n")
    if (control / "cancelled").exists():
        raise RuntimeError("Grading cancelled before launch")
    try:
        result = subprocess.run(command, stdin=subprocess.DEVNULL,
                                stderr=subprocess.STDOUT, timeout=args.seconds + 30)
        (job / "sandbox-exit.txt").write_text(str(result.returncode) + "\n")
        return result.returncode if result.returncode >= 0 else 1
    finally:
        cleanup(args.run_id, job)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="mode", required=True)
    start = sub.add_parser("run")
    start.add_argument("run_id")
    start.add_argument("job")
    start.add_argument("materials")
    start.add_argument("extractor")
    start.add_argument("control")
    start.add_argument("seconds", type=int, choices=range(1, 3601), metavar="SECONDS")
    stop = sub.add_parser("cleanup")
    stop.add_argument("run_id")
    stop.add_argument("job", type=Path)
    worker = sub.add_parser("enter")
    worker.add_argument("command", nargs=argparse.REMAINDER)
    options = parser.parse_args()
    try:
        if options.mode == "enter":
            enter(options.command)
        elif options.mode == "cleanup":
            cleanup(options.run_id, options.job)
        else:
            sys.exit(run(options))
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        parser.exit(1, "Sandbox refused: " + str(error) + "\n")
