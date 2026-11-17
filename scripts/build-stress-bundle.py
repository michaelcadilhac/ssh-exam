#!/usr/bin/env python3
"""Build only public executable/test code for a private disposable guest. No upload."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def build(destination):
    destination = destination.resolve()
    destination.mkdir(mode=0o700)
    os.umask(0o077)
    spec = importlib.util.spec_from_file_location('overlay', ROOT / 'ssh-server/tests/overlay_qualification.py')
    overlay = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(overlay)
    env = dict(os.environ, CGO_ENABLED='0')
    for name in ('exam-agent', 'examctl', 'exam-login', 'exam-info'):
        subprocess.run(['go', 'build', '-trimpath', '-o', str(destination / name), './cmd/' + name],
                       cwd=ROOT / 'ssh-server', env=env, check=True, timeout=180)
    subprocess.run(['go', 'test', '-c', '-o', str(destination / 'core-qualification.test'), './internal/core'],
                   cwd=ROOT / 'ssh-server', env=env, check=True, timeout=180)
    for name, source in (('asyncio-probe', 'asyncio_fixture.c'), ('thread-leader-probe', 'thread_leader_fixture.c')):
        subprocess.run(['gcc', '-O2', '-pthread', str(ROOT / 'ssh-server/tests' / source), '-o', str(destination / name)],
                       check=True, timeout=60)
    for name in overlay.FILES:
        if (destination / name).exists():
            continue
        directory = 'scripts' if name in ('account-policy', 'check-isolation') else 'systemd' if name.endswith(('.slice', '.service')) else 'tests'
        shutil.copyfile(ROOT / 'ssh-server' / directory / name, destination / name)
    shutil.copyfile(ROOT / 'ssh-server/tests/overlay_qualification.py', destination / 'overlay_qualification.py')
    manifest = {name: hashlib.sha256((destination / name).read_bytes()).hexdigest() for name in overlay.FILES}
    size = sum((destination / name).stat().st_size for name in overlay.FILES)
    if size > 96 * 1024**2:
        raise RuntimeError('Code-only bundle exceeds96MiB; no upload')
    (destination / 'SHA256.json').write_text(json.dumps(manifest, sort_keys=True) + '\n')
    for path in destination.iterdir():
        path.chmod(0o600)
    print(json.dumps({'bundle':str(destination),'files':len(manifest),'bytes':size,'manifest_sha256':hashlib.sha256((destination/'SHA256.json').read_bytes()).hexdigest()}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('destination', type=Path, help='New private directory; must not exist')
    build(parser.parse_args().destination)
