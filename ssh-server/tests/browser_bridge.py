#!/usr/bin/env python3
"""Test-only transport bridge for one guarded retained-policy browser workflow.

Never imported by installed agent code. The guest remains on its private network;
only the owned overlay's root-private Unix sockets cross its mount boundary.
"""
import argparse
import base64
import ctypes
import hashlib
import json
import os
from pathlib import Path
import pwd
import queue
import re
import select
import socket
import stat
import subprocess
import sys
import tarfile
import threading
import time
import uuid

if not __debug__:
    raise RuntimeError('Qualification safety checks require Python without -O')

INPUT = Path('/run/ssh-exam-qualification-input')
OUTPUT = Path('/run/ssh-exam-qualification-output')
MAX_FRAME = 1024 * 1024


def private_json(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as stream:
        info = os.fstat(stream.fileno())
        assert stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1
        assert info.st_size <= MAX_FRAME
        return json.loads(stream.read(MAX_FRAME + 1))


def guest_identity():
    assert os.getuid() == os.geteuid() == 0
    assert Path('/run/systemd/container').read_text().strip() == 'systemd-nspawn'
    assert INPUT.is_mount() and OUTPUT.is_mount()
    marker = private_json(INPUT / 'run.json')
    assert marker['profile'] == 'retained-policy' and marker['username'] == 'examq'
    assert marker.get('driver') == 'browser'
    config = private_json(Path('/etc/exam-agent/agent.json'))
    guards = private_json(Path(config['guard_report']))
    assert guards.get('fixture', '').startswith('Private qualification')
    assert config['callback_url'] == 'https://127.0.0.1:9444'
    return config


def line(stream):
    raw = stream.readline(MAX_FRAME + 1)
    if not raw or len(raw) > MAX_FRAME or not raw.endswith(b'\n'):
        raise RuntimeError('Private bridge frame missing/oversized')
    return json.loads(raw)


def send(stream, value):
    raw = json.dumps(value, separators=(',', ':')).encode() + b'\n'
    assert len(raw) <= MAX_FRAME
    stream.write(raw)
    stream.flush()


def copy_streams(left, right, timeout=600):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        ready, _, _ = select.select((left, right), (), (), min(1, deadline-time.monotonic()))
        for source in ready:
            raw = source.recv(65536)
            if not raw:
                return
            (right if source is left else left).sendall(raw)
    raise TimeoutError('Private SSH bridge lifetime exceeded')


def forward_http(path, headers, raw):
    """Called by the guest TLS fixture; real gateway verifies the ORIGINAL bytes."""
    guest_identity()
    assert path.startswith('/api/agent/') and len(raw) <= 524288
    with socket.socket(socket.AF_UNIX) as client:
        client.settimeout(6)
        client.connect(str(OUTPUT / 'http.sock'))
        with client.makefile('rwb', buffering=0) as stream:
            send(stream, {'path': path, 'headers': dict(headers), 'body': base64.b64encode(raw).decode()})
            result = line(stream)
            body = base64.b64decode(result['body'], validate=True)
            assert 100 <= result['status'] <= 599 and len(body) <= 524288
            return result['status'], body


def root_command(*args):
    return subprocess.run(args, check=True, capture_output=True, text=True, timeout=30).stdout


def scope_directory(attempt, unit):
    # gate.go uses attempt UUID, pane UUID and ManagementID UUID. Keep this exact
    # production shape; neither a short random suffix nor a filesystem hint is it.
    identity = r'[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}'
    assert re.fullmatch(identity, attempt)
    assert re.fullmatch('exam-' + re.escape(attempt) + '-' + identity + '-' + identity + r'\.scope', unit)
    return Path('/sys/fs/cgroup/exam.slice') / unit


def verify_fixture_archive(path):
    expected = {'browser-proof.txt': b'SAVED-actual-native-END\n',
                'browser-editor.txt': b'UNSAVED-native-editor\n'}
    found = set()
    with tarfile.open(path, 'r:gz') as archive:
        members = archive.getmembers()
        assert len(members) <= 8193
        for member in members:
            if member.name not in expected:
                continue
            assert member.name not in found and member.isfile() and member.size <= 1024
            with archive.extractfile(member) as stream:
                assert stream.read(1025) == expected[member.name]
            found.add(member.name)
    assert found == set(expected), 'Protected export lacks the exact saved browser/editor work'
    return sorted(found)


class GuestBridge:
    def __init__(self, config):
        self.config = config
        self.done = threading.Event()
        self.requests = queue.Queue(maxsize=16)
        self.slots = threading.BoundedSemaphore(32)
        self.failures = []

    def serve(self, name, handler):
        server = socket.socket(socket.AF_UNIX)
        server.bind(str(OUTPUT / name))
        os.chmod(OUTPUT / name, 0o600)
        server.listen(16)
        server.settimeout(.5)
        def accept():
            try:
                while not self.done.is_set():
                    try:
                        client, _ = server.accept()
                    except socket.timeout:
                        continue
                    if not self.slots.acquire(blocking=False):
                        client.close()
                        continue
                    def run(client=client):
                        try:
                            client.settimeout(6)
                            handler(client)
                        except (OSError, ValueError, AssertionError, RuntimeError, queue.Full, subprocess.SubprocessError) as error:
                            print('BROWSER_BRIDGE_REFUSAL ' + name + ':' + type(error).__name__, flush=True)
                            # Retain the refusal stage without exception text,
                            # terminal bytes or credentials. SSH uses plain EOF.
                            if name != 'ssh.sock':
                                try:
                                    with client.makefile('wb', buffering=0) as stream:
                                        send(stream, {'bridge_error': type(error).__name__, 'stage': name})
                                except OSError:
                                    pass
                        finally:
                            client.close()
                            self.slots.release()
                    threading.Thread(target=run, daemon=True).start()
            finally:
                server.close()
        threading.Thread(target=accept, daemon=True).start()

    def ssh(self, client):
        with socket.create_connection(('127.0.0.1', 22), timeout=5) as upstream:
            upstream.settimeout(5)
            copy_streams(client, upstream)

    def http(self, client):
        with client.makefile('rwb', buffering=0) as stream:
            request = line(stream)
            assert request['path'].startswith('/api/agent/')
            completed, result = threading.Event(), {}
            self.requests.put_nowait((request, completed, result))
            if not completed.wait(5):
                raise TimeoutError('Private gateway reply unavailable')
            send(stream, result['reply'])

    def gateway(self, client):
        # One bounded connection per request, reused by a fixed local worker pool.
        with client.makefile('rwb', buffering=0) as stream:
            try:
                request, completed, result = self.requests.get(timeout=4)
            except queue.Empty:
                send(stream, {'idle': True})
                return
            send(stream, request)
            reply = line(stream)
            if not completed.is_set():
                result['reply'] = reply
                completed.set()

    def inspect(self, client):
        with client.makefile('rwb', buffering=0) as stream:
            request = line(stream)
            if request == {'abort': True}:
                self.failures.append('Local browser test aborted')
                send(stream, {'aborted': True})
                self.done.set()
                return
            assert re.fullmatch(r'[a-f0-9-]{36}', request['attempt'])
            state = private_json(Path(self.config['state']) / 'state.json')
            attempt = state['attempts'][request['attempt']]
            assert attempt['exam'] == 'native-browser' and attempt['username'] == 'examq'
            assert attempt['uid'] == pwd.getpwnam('examq').pw_uid
            supervisor, kernel = None, []
            if attempt.get('terminal_supervised') and attempt['state'] in ('ACTIVE', 'LOCKED'):
                try:
                    supervisor = json.loads(root_command('examctl', 'panes', 'supervisor', request['attempt']))
                except subprocess.CalledProcessError as error:
                    supervisor = {'unavailable': True, 'exit': error.returncode}
                for unit in supervisor.get('attached_units', []):
                    events = scope_directory(request['attempt'], unit) / 'cgroup.events'
                    kernel.append(dict(unit=unit, **dict(row.split() for row in events.read_text().splitlines())))
            if request.get('finish'):
                assert attempt['state'] == 'COMPLETED' and attempt['protected'] and attempt['checksum']
                assert attempt['deadline'] == attempt['original_deadline'] > attempt['start']
            editor = Path(self.config['work']) / request['attempt'] / 'work/browser-editor.txt'
            verified_files = None
            if request.get('finish'):
                exported = OUTPUT / 'browser-submission.tar.gz'
                root_command('examctl', 'export', request['attempt'], '--output', str(exported))
                verified_files = verify_fixture_archive(exported)
            send(stream, {'attempt': attempt, 'supervisor': supervisor, 'kernel': kernel,
                          'editor_exists': editor.exists(), 'verified_files': verified_files,
                          'private_guest': True})
            if request.get('finish'):
                self.done.set()


def run_guest(config, prepare_roles):
    guest_identity()
    public = (INPUT / 'browser-gateway.pub').read_bytes()
    assert len(public) <= 256 and public.startswith(b'-----BEGIN PUBLIC KEY-----\n')
    Path(config['gateway_public_key']).write_bytes(public)
    os.chmod(config['gateway_public_key'], 0o644)
    # This password exists only on the synthetic account in the volatile guest.
    crypt = ctypes.CDLL('libcrypt.so.1')
    crypt.crypt.argtypes = (ctypes.c_char_p, ctypes.c_char_p)
    crypt.crypt.restype = ctypes.c_char_p
    encoded = crypt.crypt(b'shared-password', ('$6$' + uuid.uuid4().hex[:16] + '$').encode())
    assert encoded and encoded.startswith(b'$6$')
    root_command('usermod', '--password', encoded.decode(), 'examq')
    ssh_config = Path('/etc/ssh/sshd_config')
    ssh_config.write_text('PasswordAuthentication yes\n' + ssh_config.read_text())
    root_command('sshd', '-t')
    root_command('systemctl', 'restart', 'ssh.service')
    prepare_roles(qualify_roles=False)
    source = Path('/run/browser-template')
    source.mkdir(mode=0o700)
    for tree in ('work', 'materials'):
        (source / tree).mkdir(mode=0o755)
    (source / 'work/README.txt').write_text('Private synthetic browser/native qualification.\n')
    (source / 'materials/instructions.txt').write_text('Private guarded qualification only.\n')
    version = json.loads(root_command('examctl', 'templates', 'validate', str(source)))['info']['hash']
    root_command('examctl', 'templates', 'install', 'native-browser', str(source), '--expected', version,
                 '--reason', 'Private synthetic actual browser/native workflow')
    host_key = Path('/etc/ssh/ssh_host_ed25519_key.pub').read_text().split()[1]
    metadata = {'agent': config['agent_id'], 'username': 'examq', 'uid': pwd.getpwnam('examq').pw_uid,
                'callbackPublicKey': Path('/etc/exam-agent/callback.pub').read_text(),
                'classPins': [hashlib.sha256(base64.b64decode(host_key)).hexdigest()], 'template': version}
    bridge = GuestBridge(config)
    for name, handler in (('ssh.sock', bridge.ssh), ('http.sock', bridge.http),
                          ('gateway.sock', bridge.gateway), ('inspect.sock', bridge.inspect)):
        bridge.serve(name, handler)
    ready = OUTPUT / 'browser-ready.json'
    with ready.open('x') as stream:
        os.chmod(ready, 0o600)
        json.dump(metadata, stream)
    print('BROWSER_NATIVE_READY', flush=True)
    # Supported root CLI, actual signed HTTPS authority; never seed a fabricated
    # source attestation in the web database. The local gateway is starting now.
    until = time.monotonic() + 45
    while True:
        if bridge.done.is_set():
            raise RuntimeError('Local browser test aborted during source registration')
        try:
            root_command('examctl', 'templates', 'sync', 'native-browser', version,
                         '--reason', 'Private actual browser native source registration')
            break
        except subprocess.CalledProcessError:
            if time.monotonic() >= until:
                raise
            time.sleep(.5)
    print('BROWSER_NATIVE_SOURCE_SYNCED', flush=True)
    if not bridge.done.wait(540):
        raise TimeoutError('Actual browser/native qualification did not finish')
    if bridge.failures:
        raise RuntimeError(bridge.failures[0])
    print('BROWSER_NATIVE_PROTECTED_FINISH_OK', flush=True)
    print('OVERLAY_QUALIFICATION_OK', flush=True)
    return 0


def host_bridge(stage, mode):
    """Root host entry: only an active owned private overlay, never host SSH/API."""
    assert os.getuid() == os.geteuid() == 0
    assert re.fullmatch(r'/var/tmp/ssh-exam-overlay-[a-z0-9_]+', str(stage))
    for path in (stage, stage / 'input', stage / 'output'):
        info = path.lstat()
        assert stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and info.st_mode & 0o777 == 0o700
    marker = private_json(stage / 'input/run.json')
    assert marker['profile'] == 'retained-policy' and marker['username'] == 'examq' and marker.get('driver') == 'browser'
    unit = marker['unit']
    assert re.fullmatch(r'ssh-exam-qualification-[a-f0-9]{32}\.service', unit)
    assert root_command('systemctl', 'is-active', unit).strip() == 'active'
    if mode == 'metadata':
        send(sys.stdout.buffer, private_json(stage / 'output/browser-ready.json'))
        return
    assert mode in ('ssh', 'gateway', 'inspect')
    target = stage / 'output' / (mode + '.sock')
    info = target.lstat()
    assert stat.S_ISSOCK(info.st_mode) and info.st_uid == 0 and info.st_mode & 0o777 == 0o600
    with socket.socket(socket.AF_UNIX) as client:
        client.settimeout(6)
        client.connect(str(target))
        # Stdio uses separate fds. Do not buffer or interpret SSH bytes.
        deadline = time.monotonic() + (600 if mode == 'ssh' else 8)
        while time.monotonic() < deadline:
            ready, _, _ = select.select((sys.stdin.buffer, client), (), (), .5)
            for source in ready:
                raw = os.read(source.fileno(), 65536)
                if not raw:
                    return
                if source is client:
                    sys.stdout.buffer.write(raw)
                    sys.stdout.buffer.flush()
                else:
                    client.sendall(raw)
        raise TimeoutError('Private host bridge lifetime exceeded')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', type=Path, required=True)
    parser.add_argument('mode', choices=('metadata', 'ssh', 'gateway', 'inspect'))
    args = parser.parse_args()
    host_bridge(args.host, args.mode)
