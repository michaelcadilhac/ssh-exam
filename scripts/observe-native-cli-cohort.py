#!/usr/bin/env python3
"""Refresh one private native proof after a guarded CLI-only installation.

Run as root on csc-sys before web prepare/apply/resume, with no deployment
controller running. This invokes the pinned strict read-only guard in-process,
checks every installed binary and publishes only a nonce-bound private receipt.
It never installs, restarts a service or changes student authority.
"""
import argparse
import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import runpy
import stat
import sys

from fresh_native_cohort_guard import private_json, validate
from shared_backup import atomic_json, private_directory

TARGETS = {
    'exam-agent': Path('/usr/local/sbin/exam-agent'),
    'examctl': Path('/usr/local/sbin/examctl'),
    'exam-login': Path('/usr/local/libexec/exam-login'),
    'exam-info': Path('/usr/local/bin/exam-info'),
}


def observe(stage):
    stage = stage.absolute()
    if any(p.is_symlink() for p in (stage, *stage.parents)):
        raise ValueError('Use the real private release stage')
    private_directory(stage)
    release, original = private_json(stage/'release.json')
    update = release['native_update']
    if (release['fast_ui'].get('mode'), release['fast_ui'].get('reviewed_scope')) not in (
            ('reviewed-web-cli', 'display-alert-diagnostics-v1'),
            ('reviewed-web-read', 'student-video-preview-v1')):
        raise ValueError('Use the qualified display/alert or student-preview release')
    guard = stage/'native-guard.py'
    info = guard.lstat()
    if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid()
            or info.st_mode & 0o022 or info.st_nlink != 1
            or hashlib.sha256(guard.read_bytes()).hexdigest() != update['guard_sha256']):
        raise ValueError('Native guard is not the pinned protected script')
    hashes = {}
    for name, path in TARGETS.items():
        info = path.lstat()
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid()
                or stat.S_IMODE(info.st_mode) != 0o755):
            raise ValueError('Unprotected installed binary: '+name)
        hashes[name] = hashlib.sha256(path.read_bytes()).hexdigest()
    if hashes != update['before']['binary_sha256']:
        raise ValueError('Installed binaries differ from the qualified CLI cohort')
    previous = sys.argv
    output = io.StringIO()
    try:
        sys.argv = [str(guard), str(stage), 'after-cli']
        with contextlib.redirect_stdout(output):
            runpy.run_path(str(guard), run_name='__main__')
    finally:
        sys.argv = previous
    receipt = json.loads(output.getvalue())
    receipt.update(phase='before-native', nonce=update['nonce'], binary_sha256=hashes)
    validate(release, receipt, 'before')
    if (stage/'release.json').read_bytes() != original:
        raise ValueError('Release metadata changed during observation')
    target = stage/'native-guard-before.json'
    if target.exists() or target.is_symlink():
        existing, _ = private_json(target)
        if existing.get('nonce') != update['nonce']:
            raise ValueError('Preserve the foreign native proof')
    atomic_json(target, {'nonce':update['nonce'], 'receipt':receipt})
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('stage', type=Path, help='Frozen root-private qualified release directory')
    args = parser.parse_args()
    if os.geteuid() != 0:
        parser.error('Run as root on the class server; no service or authority writes occur')
    print(json.dumps(observe(args.stage)), flush=True)


if __name__ == '__main__':
    main()
