#!/usr/bin/env python3
"""Root-only candidate test runner; never deploys or edits the existing guest.

Run on an idle test-authorized host with its pre-existing prepared private guest.
The guest root gets a volatile overlay; all candidate inputs are private copies.
Production commands/configuration/account records are never changed or reconciled.
"""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import stat
import subprocess
import tempfile
import time
import uuid

if not __debug__:
    raise RuntimeError('Qualification safety checks require Python without -O')

FILES = {
    'exam-agent': ('/usr/local/sbin/exam-agent', 0o755),
    'examctl': ('/usr/local/sbin/examctl', 0o755),
    # The gate MUST run with the authenticated student's real/effective UID.
    # A setuid gate would authenticate root to SO_PEERCRED and is refused.
    'exam-login': ('/usr/local/libexec/exam-login', 0o755),
    'exam-info': ('/usr/local/bin/exam-info', 0o755),
    'account-policy': ('/usr/local/sbin/exam-account-policy', 0o755),
    'check-isolation': ('/usr/local/sbin/exam-check-isolation', 0o755),
    'qualification_callbacks.py': ('/root/qualification-callbacks.py', 0o600),
    'exam-collection.slice': ('/etc/systemd/system/exam-collection.slice', 0o644),
    'exam-template.slice': ('/etc/systemd/system/exam-template.slice', 0o644),
    'examterminal.slice': ('/etc/systemd/system/examterminal.slice', 0o644),
    'linux_qualification.py': (None, 0o600),
    'overlay_guest.py': (None, 0o600),
    'browser_bridge.py': ('/root/browser_bridge.py', 0o600),
    'core-qualification.test': (None, 0o755),
    'asyncio-probe': (None, 0o755),
    'thread-leader-probe': (None, 0o755),
}
SERVICE = 'ssh-exam-overlay-qualification.service'
UNIT = '''[Unit]
Description=Disposable overlay candidate qualification (not production)
After=ssh.service exam-agent.service qualification-callbacks.service
Wants=ssh.service exam-agent.service qualification-callbacks.service
[Service]
Type=oneshot
ExecStart=/usr/bin/python3 /run/ssh-exam-qualification-input/overlay_guest.py
ExecStopPost=/usr/bin/systemctl --no-block poweroff
TimeoutStartSec=720
StandardOutput=append:/run/ssh-exam-qualification-output/guest.log
StandardError=inherit
'''


def bounded_json(path, limit=64 * 1024 * 1024):
    with path.open('rb') as stream:
        data = stream.read(limit + 1)
    if len(data) > limit:
        raise RuntimeError('Qualification metadata exceeds bounds')
    return json.loads(data)


def private_directory(path):
    if not path.is_absolute() or any(p.is_symlink() for p in (path, *path.parents)):
        raise RuntimeError('A real absolute directory without symlink parents is required')
    if not path.is_dir():
        raise RuntimeError('Qualification directory unavailable')


def authority(config):
    state = bounded_json(Path(config['state']) / 'state.json')
    attempts = state.get('attempts', {})
    for a in attempts.values():
        if (a['state'] not in ('COMPLETED', 'CANCELLED_BEFORE_START')
                or a.get('access_state') == 'HELD'
                or a.get('policy_state', 'NORMAL') != 'NORMAL'):
            raise RuntimeError('Host has live/unresolved exam work; isolated test refused/aborted')
    fields = ('id', 'exam', 'username', 'uid', 'state', 'settings', 'start',
              'deadline', 'original_deadline', 'clock_revision', 'protected',
              'checksum', 'access_state', 'policy_state', 'clock_resets',
              'grant', 'grant_begin_intent', 'registered_owner', 'workspace',
              'expected_recovery', 'browser_ssh', 'terminal_supervised',
              'monitoring_mode', 'retained_hold', 'monitoring_hold_kind',
              'monitoring_resume_nonce')
    return {key: {field: a.get(field) for field in fields}
            for key, a in attempts.items()}


def digest(paths):
    return {str(path): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in paths if path.is_file()}


def ensure_guest_idle(guest):
    prefix = str(guest) + '/'
    for process in Path('/proc').iterdir():
        if not process.name.isdigit():
            continue
        try:
            root = os.readlink(process / 'root')
            if root == str(guest) or root.startswith(prefix):
                raise RuntimeError('Guest base is already in use; refuse concurrent qualification')
        except (FileNotFoundError, ProcessLookupError):
            pass
    for line in Path('/proc/self/mountinfo').read_text().splitlines():
        mount = line.split()[4]
        if mount == str(guest) or mount.startswith(prefix):
            raise RuntimeError('Guest base has active mounts; qualification refused')


def candidate_command(unit, guest, inputs, output, students=1, storage=None):
    assert students in (1, 16)
    command = [
        'systemd-run', '--quiet', '--wait', '--pipe', '--collect',
        '--service-type=exec', '--unit=' + unit,
        '--property=Delegate=yes', '--property=MemoryMax=' + ('3G' if students == 16 else '1G'),
        '--property=MemorySwapMax=0', '--property=TasksMax=' + ('2048' if students == 16 else '512'),
        '--property=CPUQuota=' + ('200%' if students == 16 else '50%'), '--property=RuntimeMaxSec=900',
        '--property=TimeoutStopSec=10s', '--property=KillMode=control-group',
        '--property=OOMPolicy=kill', '--', 'systemd-nspawn',
        '--directory=' + str(guest), '--machine=' + unit.removesuffix('.service'),
        '--settings=no', '--register=no', '--keep-unit', '--boot',
        '--read-only', '--volatile=overlay', '--private-network',
        # nspawn's default seccomp list rejects even modes-zero clock queries.
        # Permit those syscalls, but explicitly exclude the clock-write capability.
        '--system-call-filter=adjtimex clock_adjtime', '--drop-capability=CAP_SYS_TIME',
        '--resolv-conf=off', '--timezone=off', '--link-journal=no',
        '--console=pipe', '--bind-ro=' + str(inputs) + ':/run/ssh-exam-qualification-input',
        '--bind=' + str(output) + ':/run/ssh-exam-qualification-output',
    ]
    if students == 16:
        assert storage and set(storage) == {'work', 'state'}
        for name, target in storage.items():
            assert Path(target).is_absolute() and '..' not in Path(target).parts
            assert (name == 'work' and str(target).startswith('/srv/exam-workspace/')) or (name == 'state' and str(target) == '/var/lib/exam-agent')
            command.append('--bind=' + str(output / name) + ':' + str(target))
    for name, (target, _) in FILES.items():
        if target:
            command.append('--bind-ro=' + str(inputs / name) + ':' + target)
    command.append('--bind-ro=' + str(inputs / 'test.service') + ':/etc/systemd/system/' + SERVICE)
    return command


def start_guest_check(unit, inputs):
    """Pin only this test guest's namespaces/root, never enter a reused PID."""
    for process in Path('/proc').iterdir():
        if not process.name.isdigit():
            continue
        descriptors = []
        try:
            if not any(unit in line.strip().split('/') for line in (process / 'cgroup').read_text().splitlines()):
                continue
            if (process / 'comm').read_text().strip() != 'systemd':
                continue
            ns = next(line for line in (process / 'status').read_text().splitlines() if line.startswith('NSpid:')).split()[1:]
            if len(ns) < 2 or ns[-1] != '1':
                continue
            root = os.open(process / 'root', os.O_RDONLY | os.O_DIRECTORY)
            descriptors.append(root)
            marker = Path('/proc/self/fd') / str(root) / 'run/ssh-exam-qualification-input/run.json'
            if bounded_json(marker, 4096) != bounded_json(inputs / 'run.json', 4096):
                raise RuntimeError('Guest test identity mismatch')
            if not (Path('/proc/self/fd') / str(root) / 'run/systemd/private').is_socket():
                continue
            flags = []
            for namespace in ('mnt', 'uts', 'ipc', 'net', 'pid'):
                descriptor = os.open(process / 'ns' / namespace, os.O_RDONLY)
                descriptors.append(descriptor)
                if namespace in ('mnt', 'net', 'pid'):
                    assert os.fstat(descriptor).st_ino != os.stat('/proc/self/ns/' + namespace).st_ino, 'Refuse host namespaces'
                flags.append('--' + ('mount' if namespace == 'mnt' else namespace) + '=/proc/self/fd/' + str(descriptor))
            # FDs remain valid even if the process dies; no numeric PID is passed
            # to nsenter, and the unique marker is inside the pinned guest root.
            assert any(unit in line.strip().split('/') for line in (process / 'cgroup').read_text().splitlines())
            subprocess.run(['nsenter', *flags, '--root=/proc/self/fd/' + str(root),
                            '--wd=/', '/usr/bin/systemctl', '--no-block', 'start', SERVICE],
                           pass_fds=descriptors, check=True, timeout=10)
            return True
        except (FileNotFoundError, ProcessLookupError):
            continue
        finally:
            for descriptor in descriptors:
                os.close(descriptor)
    return False


def run_locked(args):
    assert os.getuid() == os.geteuid() == 0, 'Root required'
    for command in ('systemd-nspawn', 'systemd-run', 'systemctl', 'nsenter'):
        if not shutil.which(command):
            print('COMMAND_NOT_FOUND: ' + command, flush=True)
            return 127
    guest, bundle = args.guest, args.bundle
    private_directory(guest)
    private_directory(bundle)
    assert guest != Path('/') and guest != bundle
    config = bounded_json(Path('/etc/exam-agent/agent.json'))
    baseline = authority(config)
    guest_config = bounded_json(guest / 'etc/exam-agent/agent.json')
    guards = bounded_json(guest / guest_config['guard_report'].lstrip('/'))
    assert guards.get('fixture', '').startswith('Private qualification'), 'Not a private qualification guest'
    assert not guest_config.get('functional_test_account')
    assert guest_config.get('temporary_account_policy')
    ensure_guest_idle(guest)
    manifest = bounded_json(bundle / 'SHA256.json', 16384)
    assert set(manifest) == set(FILES), 'Exact candidate manifest required'
    source_bytes = {}
    for name in FILES:
        fd = os.open(bundle / name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(fd, 'rb') as stream:
            info = os.fstat(stream.fileno())
            assert stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_size <= 64 * 1024 * 1024
            data = stream.read(64 * 1024 * 1024 + 1)
        assert hashlib.sha256(data).hexdigest() == manifest[name], 'Candidate checksum mismatch'
        source_bytes[name] = data
        assert sum(map(len, source_bytes.values())) <= 96 * 1024 * 1024, 'Candidate bundle exceeds aggregate bound'
    # Read-only preservation evidence, not a live backup or modification API.
    host_paths = [Path('/etc/exam-agent/agent.json'),
                  Path('/usr/local/sbin/exam-agent'), Path('/usr/local/sbin/examctl'),
                  Path('/usr/local/libexec/exam-login'), Path('/usr/local/bin/exam-info')]
    guest_paths = [guest / relative for relative in (
        'etc/exam-agent/agent.json', 'var/lib/exam-agent/state.json',
        'etc/passwd', 'etc/group', 'etc/shadow', 'etc/ssh/sshd_config',
        *(target.lstrip('/') for target, _ in FILES.values() if target))]
    preserved = digest(host_paths + guest_paths)
    stage = Path(tempfile.mkdtemp(prefix='ssh-exam-overlay-', dir='/var/tmp'))
    unit = 'ssh-exam-qualification-' + uuid.uuid4().hex + '.service'
    process = None
    try:
        inputs, output = stage / 'input', stage / 'output'
        inputs.mkdir(mode=0o700)
        output.mkdir(mode=0o700)
        for name, (_, mode) in FILES.items():
            target = inputs / name
            target.write_bytes(source_bytes[name])
            target.chmod(mode)
        marker = {'username': args.username, 'unit': unit, 'profile': args.profile}
        if getattr(args, 'browser_gateway_public_key', None):
            assert args.profile == 'retained-policy' and args.username == 'examq'
            public = args.browser_gateway_public_key.read_bytes()
            assert len(public) <= 256 and public.startswith(b'-----BEGIN PUBLIC KEY-----\n')
            assert b'PRIVATE' not in public
            (inputs / 'browser-gateway.pub').write_bytes(public)
            marker['driver'] = 'browser'
        students = getattr(args, 'browser_students', 1)
        large = getattr(args, 'browser_large', False)
        assert not large or students == 16
        storage = None
        if students == 16:
            assert marker.get('driver') == 'browser'
            assert shutil.disk_usage(stage).free >= (5 if large else 4) * 1024**3, 'Private capacity scratch unavailable; no test'
            memory = dict(row.split(':', 1) for row in Path('/proc/meminfo').read_text().splitlines())
            assert int(memory['MemAvailable'].split()[0]) >= 4 * 1024**2, 'Private capacity needs4GiB available RAM; no test'
            storage = {'work': guest_config['work'], 'state': guest_config['state']}
            for name in storage:
                (output / name).mkdir(mode=0o700)
            # Clone ONLY the already-guarded synthetic guest state; never reset
            # its fences/history or copy production authority. Omit stale Unix
            # sockets so the new guest's actual agent creates its own endpoints.
            source = guest / guest_config['state'].lstrip('/')
            private_directory(source)
            copied = 0
            for path in source.rglob('*'):
                info = path.lstat()
                assert info.st_uid == 0 and not stat.S_ISLNK(info.st_mode)
                target = output / 'state' / path.relative_to(source)
                if stat.S_ISDIR(info.st_mode):
                    target.mkdir(mode=stat.S_IMODE(info.st_mode))
                elif stat.S_ISREG(info.st_mode):
                    assert info.st_nlink == 1
                    copied += info.st_size
                    assert copied <= 64 * 1024**2, 'Synthetic baseline state exceeds copy bound'
                    target.write_bytes(path.read_bytes()); target.chmod(stat.S_IMODE(info.st_mode))
                else:
                    assert stat.S_ISSOCK(info.st_mode), 'Unexpected synthetic state entry'
        marker['browser_students'] = students
        marker['browser_large'] = large
        (inputs / 'run.json').write_text(json.dumps(marker))
        (inputs / 'run.json').chmod(0o600)
        (inputs / 'test.service').write_text(UNIT.replace('TimeoutStartSec=720', 'TimeoutStartSec=840') if students == 16 else UNIT)
        command = candidate_command(unit, guest, inputs, output, students, storage)
        print('Private test evidence: ' + str(stage), flush=True)
        print('Starting bounded private-overlay qualification; no deployment', flush=True)
        process = subprocess.Popen(command, stdin=subprocess.DEVNULL,
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        deadline = time.monotonic() + 930
        activation_deadline = time.monotonic() + 60
        activated = False
        while process.poll() is None:
            authority(config)  # New live exams abort only this private test unit.
            if not activated:
                activated = start_guest_check(unit, inputs)
                if not activated and time.monotonic() > activation_deadline:
                    raise RuntimeError('Private guest init did not become ready')
            if time.monotonic() >= deadline:
                raise RuntimeError('Qualification runtime exceeded')
            time.sleep(2)
        result = bounded_json(output / 'result.json', 4096) if (output / 'result.json').is_file() else {'exit': 1}
        log = output / 'guest.log'
        if log.is_file():
            with log.open('rb') as stream:
                stream.seek(max(0, log.stat().st_size - 32768))
                print(stream.read(32768).decode('utf8', errors='replace'), flush=True)
        assert digest(host_paths + guest_paths) == preserved, 'Preservation check failed; retain private test evidence'
        assert authority(config) == baseline, 'Host attempt authority changed during qualification'
        print('Preservation checks passed: live binaries/config/authority and guest base unchanged', flush=True)
        assert process.returncode == 0 and result['exit'] == 0, 'Overlay candidate qualification failed'
        return 0
    finally:
        if process is not None:
            # Exact unique test unit only; never stop any installed exam unit.
            subprocess.run(['systemctl', 'stop', unit], timeout=30, check=False,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            process.wait(timeout=30)
        # Keep read-only preservation evidence even when the local fixture dies
        # or a failed run closes stdout before the diagnostic log is printed.
        same_authority = False
        try:
            same_authority = authority(config) == baseline
        except RuntimeError:
            pass  # A new real exam means no unchanged-authority claim.
        receipt = {'unit': unit, 'profile': args.profile,
                   'files_unchanged': digest(host_paths + guest_paths) == preserved,
                   'authority_unchanged': same_authority}
        if (stage / 'output').is_dir():
            fd = os.open(stage / 'output/preservation.json', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, 'w') as stream:
                json.dump(receipt, stream); stream.flush(); os.fsync(stream.fileno())
        # Preserve bounded logs/results for diagnosis; discard candidate binaries
        # only with an explicit later artifact cleanup, not on a failed test.
        print('Private test evidence: ' + str(stage), flush=True)


def run(args):
    assert os.getuid() == os.geteuid() == 0, 'Root required'
    private_directory(args.guest)
    # Advisory lock on the pre-existing directory, without creating or changing
    # any base files. One aggregate-bounded test guest at a time per base image.
    descriptor = os.open(args.guest, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return run_locked(args)
    finally:
        os.close(descriptor)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--guest', type=Path, required=True)
    parser.add_argument('--bundle', type=Path, required=True)
    parser.add_argument('--username', default='examq')
    parser.add_argument('--browser-gateway-public-key', type=Path,
                        help='Private browser driver only: PUBLIC signing key; never supply a private key')
    parser.add_argument('--browser-students', type=int, choices=(1, 16), default=1,
                        help='Private browser capacity target; sixteen uses only owned disk binds and bounded3GiB/2CPU/2048tasks')
    parser.add_argument('--browser-large', action='store_true', help='Private16-student large-worker fault/export qualification; no production limit change')
    parser.add_argument('--profile', choices=('loaded-roles', 'enforcement', 'worker-isolation', 'timed-owner', 'framed-owner', 'retained-policy', 'monitoring-owner', 'monitoring-freeze', 'monitoring-async-io', 'monitoring-async-io-stopped', 'monitoring-editor', 'template-catalog', 'collection-pool', 'writer-threads', 'monitoring-thread-tty', 'pane-ack'), default='enforcement')
    arguments = parser.parse_args()
    assert re.fullmatch(r'[a-zA-Z][a-zA-Z0-9_-]{0,31}', arguments.username)
    def interrupted(_signal, _frame):
        raise RuntimeError('Interrupted; stop only the exact private test unit')
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    raise SystemExit(run(arguments))
