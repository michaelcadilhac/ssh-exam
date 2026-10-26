"""Synthetic course-artifact sizing; no student files or installed exam service.

Run with Python3. The output directory must not exist; its parent must already
be a private, owned directory. Keep the JSON receipt with qualification evidence.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    commands = {}
    # Check all requirements before creating anything; never install/substitute.
    for name in ("gcc", "g++", "gdb"):
        commands[name] = shutil.which(name)
        if not commands[name]:
            print("COMMAND_NOT_FOUND: " + name, flush=True)
            return 127
    output = args.output
    assert output.is_absolute() and not any(p.is_symlink() for p in (output, *output.parents))
    info = output.parent.stat()
    assert stat.S_ISDIR(info.st_mode) and info.st_uid == os.getuid() and info.st_mode & 0o077 == 0
    assert not output.exists(), "Use a fresh output directory; never overwrite evidence"
    assert shutil.disk_usage(output.parent).free >= 1024**3, "At least1GiB synthetic scratch required"
    output.mkdir(mode=0o700)
    versions = {}
    for name, command in commands.items():
        versions[name] = subprocess.run([command, "--version"], check=True, capture_output=True, text=True, timeout=10).stdout.splitlines()[0]
    c_source = "int main(void) { return 0; }\n"
    cpp_source = '''#include <cstdlib>
#include <vector>
extern "C" __attribute__((noinline)) void sizing_checkpoint(unsigned char *buffer, size_t n) {
    asm volatile("" : : "r"(buffer), "r"(n) : "memory");
}
int main(int argc, char **argv) {
    if (argc != 2) return 2;
    size_t n = std::strtoul(argv[1], nullptr, 10) * 1024 * 1024;
    std::vector<unsigned char> buffer(n, 42);
    sizing_checkpoint(buffer.data(), buffer.size());
    return buffer.front() == 42 && buffer.back() == 42 ? 0 : 1;
}
'''
    receipts = []
    for name, compiler, source, memory_mib in (
        ("c-debug", "gcc", c_source, 0),
        ("cpp-debug-64mib", "g++", cpp_source, 64),
        ("cpp-debug-192mib", "g++", cpp_source, 192),
    ):
        root = output / name
        root.mkdir(mode=0o700)
        answer = root / ("answer.c" if compiler == "gcc" else "answer.cpp")
        answer.write_text(source)
        started = time.monotonic()
        for flags in (("-g3", "-O0", "-c", answer.name, "-o", "answer.o"),
                      ("-g3", "answer.o", "-o", "answer")):
            subprocess.run([commands[compiler], *flags], cwd=root, check=True, capture_output=True, text=True, timeout=60)
        if memory_mib:
            core = root / "answer.core"
            run = subprocess.run([commands["gdb"], "-nx", "-nh", "--batch",
                "-iex", "set auto-load off", "-ex", "set pagination off", "-ex", "set confirm off",
                "-ex", "break sizing_checkpoint", "-ex", "run",
                "-ex", 'printf "SIZING-VALUES %d %d\\n", buffer[0], buffer[n-1]',
                "-ex", "generate-core-file " + str(core), "-ex", "kill",
                "--args", str(root / "answer"), str(memory_mib)],
                cwd=root, check=True, capture_output=True, text=True, timeout=40)
            assert "SIZING-VALUES 42 42" in run.stdout, "GDB did not reach the intended live buffer"
            info = core.lstat()
            assert stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid() and info.st_nlink == 1
            with core.open("rb") as stream:
                assert stream.read(4) == b"\x7fELF", "Missing actual ELF core"
            core.chmod(0o600)
            verify = subprocess.run([commands["gdb"], "-nx", "-nh", "--batch",
                "-iex", "set auto-load off", "-ex", "bt 1",
                "-ex", 'printf "CORE-VALUES %d %d\\n", buffer[0], buffer[n-1]',
                str(root / "answer"), str(core)],
                cwd=root, check=True, capture_output=True, text=True, timeout=30)
            assert "sizing_checkpoint" in verify.stdout and "CORE-VALUES 42 42" in verify.stdout
        files = {p.name:p.stat().st_size for p in root.iterdir() if p.is_file()}
        total, maximum = sum(files.values()), max(files.values())
        fits = maximum <= 128*1024**2 and total <= 512*1024**2
        assert fits == (memory_mib != 192), "Workload did not reach the intended collection-size boundary"
        receipts.append({"workload":name, "runtime_buffer_mib":memory_mib, "files":files,
                         "total_logical_bytes":total, "largest_file_bytes":maximum,
                         "fits_default_collection_limits":fits,
                         "elapsed_seconds":round(time.monotonic()-started, 3)})
    report = {"synthetic_only":True, "versions":versions,
              "limits":{"per_file_mib":128,"total_mib":512,"entries":10000,"depth":32},
              "workloads":receipts}
    path = output / "sizing.json"
    path.write_text(json.dumps(report, indent=2) + "\n")
    path.chmod(0o600)
    print(json.dumps(report, indent=2))
    print("Synthetic sizing receipt: " + str(path), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
