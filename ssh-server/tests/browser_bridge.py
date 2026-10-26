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
import signal
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


def fixture_accounts(count):
    assert count in (1, 16)
    return ['examq'] + (['examq%02d' % value for value in range(1, 16)] if count == 16 else [])


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


def verify_large_fixture_archive(path, work, file_bytes=127 * 1024**2):
    """Stream exact synthetic large files; neither archive nor answers leave guest."""
    expected = {'large-%d.bin' % n for n in range(4)}
    found = set()
    with tarfile.open(path, 'r|gz') as archive:
        count = 0
        for member in archive:
            count += 1
            assert count <= 10001
            if member.name not in expected:
                continue
            assert member.name not in found and member.isfile() and member.size == file_bytes
            source = work / member.name
            info = source.lstat()
            assert stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_size == member.size
            with source.open('rb') as original, archive.extractfile(member) as saved:
                assert hashlib.file_digest(original, 'sha256').digest() == hashlib.file_digest(saved, 'sha256').digest()
            found.add(member.name)
    assert found == expected
    return sorted(found)


class GateStall:
    """Private one-shot socket fault, with exact inode restore and finite expiry."""
    def __init__(self, path, seconds=17.5):
        self.path = path
        original = path.lstat()
        assert stat.S_ISSOCK(original.st_mode) and original.st_uid == os.geteuid()
        self.original = (original.st_dev, original.st_ino)
        self.held = path.with_name(path.name + '.qualification-' + uuid.uuid4().hex)
        assert not self.held.exists()
        self.phase, self.accepted, self.error = 'starting', 0, None
        self.stop = threading.Event()
        self.lock = threading.Lock()
        self.server = socket.socket(socket.AF_UNIX)
        os.rename(path, self.held)
        try:
            self.server.bind(str(path))
            info = path.lstat(); self.fault = (info.st_dev, info.st_ino)
            path.chmod(stat.S_IMODE(original.st_mode))
            self.server.listen(32); self.server.settimeout(.1)
        except Exception:
            self.server.close()
            if hasattr(self, 'fault') and path.exists():
                current = path.lstat()
                if (current.st_dev, current.st_ino) == self.fault: path.unlink()
            if not path.exists(): os.rename(self.held, path)
            raise
        self.phase = 'blocked'
        self.thread = threading.Thread(target=self.run, args=(seconds,), daemon=True)
        self.thread.start()

    def status(self):
        with self.lock:
            return {'phase': self.phase, 'accepted': self.accepted, 'error': self.error}

    def run(self, seconds):
        clients = []
        try:
            until = time.monotonic() + seconds
            while not self.stop.is_set() and time.monotonic() < until:
                try: client, _ = self.server.accept()
                except socket.timeout: continue
                except OSError:
                    if self.stop.is_set(): break
                    raise
                if len(clients) >= 32: client.close(); continue
                clients.append(client)
                with self.lock: self.accepted += 1
                # Do not read or reply: the actual signed command remains at
                # the real native socket boundary while evidence IO stays live.
            self.server.close()
            current, held = self.path.lstat(), self.held.lstat()
            assert (current.st_dev, current.st_ino) == self.fault, 'Gate path changed; preserve both sockets'
            assert (held.st_dev, held.st_ino) == self.original, 'Original gate changed; preserve both sockets'
            self.path.unlink()
            os.rename(self.held, self.path)
            with self.lock: self.phase = 'restored'
        except Exception as error:
            with self.lock: self.phase, self.error = 'failed', type(error).__name__
        finally:
            self.server.close()
            for client in clients: client.close()

    def cancel(self):
        self.stop.set(); self.server.close(); self.thread.join(timeout=3)
        assert not self.thread.is_alive(), 'Owned gate fault did not settle'
        assert self.status()['phase'] == 'restored', 'Owned gate restore failed; preserve private evidence'


class GuestBridge:
    def __init__(self, config):
        self.config = config
        self.done = threading.Event()
        self.requests = queue.Queue(maxsize=16)
        self.students = private_json(INPUT / 'run.json').get('browser_students', 1)
        self.large = private_json(INPUT / 'run.json').get('browser_large', False)
        self.slots = threading.BoundedSemaphore(64 if self.students == 16 else 32)
        self.failures = []
        self.collection_operation = None
        self.collection_lock = threading.Lock()
        self.gate_fault = None
        self.evidence_replies = 0
        self.evidence_lock = threading.Lock()

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
            copy_streams(client, upstream, timeout=900 if self.large else 600)

    def http(self, client):
        with client.makefile('rwb', buffering=0) as stream:
            request = line(stream)
            assert request['path'].startswith('/api/agent/')
            completed, result = threading.Event(), {}
            self.requests.put_nowait((request, completed, result))
            if not completed.wait(5):
                raise TimeoutError('Private gateway reply unavailable')
            if request['path'] == '/api/agent/monitoring-evidence' and result['reply']['status'] == 200:
                with self.evidence_lock: self.evidence_replies += 1
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

    def snapshot(self, attempt_id):
        assert re.fullmatch(r'[a-f0-9-]{36}', attempt_id)
        state = private_json(Path(self.config['state']) / 'state.json')
        attempt = state['attempts'][attempt_id]
        assert attempt['exam'] == 'native-browser' and attempt['username'] in fixture_accounts(self.students)
        assert attempt['uid'] == pwd.getpwnam(attempt['username']).pw_uid
        supervisor, kernel = None, []
        if attempt.get('terminal_supervised') and attempt['state'] in ('ACTIVE', 'LOCKED'):
            try:
                supervisor = json.loads(root_command('examctl', 'panes', 'supervisor', attempt_id))
            except subprocess.CalledProcessError as error:
                supervisor = {'unavailable': True, 'exit': error.returncode}
            for unit in supervisor.get('attached_units', []):
                events = scope_directory(attempt_id, unit) / 'cgroup.events'
                kernel.append(dict(unit=unit, **dict(row.split() for row in events.read_text().splitlines())))
        editor = Path(self.config['work']) / attempt_id / 'work/browser-editor.txt'
        writer = Path(self.config['work']) / attempt_id / 'work/control-stall-proof'
        written = 0
        try:
            fd = os.open(writer, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            with os.fdopen(fd, 'rb') as stream:
                info = os.fstat(stream.fileno())
                assert stat.S_ISREG(info.st_mode) and info.st_uid == attempt['uid'] and info.st_nlink == 1 and info.st_size <= 65536
                raw = stream.read(65537); assert raw == b'x' * len(raw) and len(raw) <= 65536
                written = len(raw)
        except FileNotFoundError: pass
        return {'attempt': attempt, 'supervisor': supervisor, 'kernel': kernel,
                'editor_exists': editor.exists(), 'writer_bytes': written, 'private_guest': True}

    def collectors(self, ids):
        result = []
        pools = set()
        for process in Path('/proc').iterdir():
            if not process.name.isdigit() or int(process.name) < 2:
                continue
            try:
                if process.stat().st_uid != 0 or (process / 'cmdline').read_bytes().split(b'\0')[-2:] != [b'--collection-worker', b'']:
                    continue
                group = (process / 'cgroup').read_text().strip()
                for attempt in ids:
                    match = re.fullmatch(r'0::(/[^\n]+)/(exam-collection-' + re.escape(attempt) + r'-[a-f0-9]{12}\.service)', group)
                    if not match:
                        continue
                    pool_name, unit = match.groups()
                    assert pool_name.endswith('/exam-collection.slice') and '..' not in Path(pool_name).parts
                    pool = Path('/sys/fs/cgroup' + pool_name)
                    if pool_name not in pools:
                        assert root_command('systemctl', 'show', 'exam-collection.slice', '--property=ControlGroup', '--value').strip() == pool_name
                        assert 0 < int((pool / 'memory.max').read_text().strip()) <= 512 * 1024**2
                        assert (pool / 'memory.swap.max').read_text().strip() == '0'
                        assert 2 <= int((pool / 'pids.max').read_text().strip()) <= 96
                        pools.add(pool_name)
                    cgroup = pool / unit
                    assert (cgroup / 'memory.max').read_text().strip() == str(256 * 1024**2)
                    assert (cgroup / 'memory.swap.max').read_text().strip() == '0'
                    assert (cgroup / 'pids.max').read_text().strip() == '32'
                    writing = False
                    for fd in (process / 'fd').iterdir():
                        target = Path(os.readlink(fd))
                        if (target.name == 'submission.tar.gz' and target.parent.parent == Path(self.config['state']) / 'submissions'
                                and re.fullmatch(r'\.' + re.escape(attempt) + r'\.collect-[A-Za-z0-9]+', target.parent.name)):
                            flags = dict(row.split(':', 1) for row in (process / 'fdinfo' / fd.name).read_text().splitlines())
                            info = target.lstat()
                            writing = writing or ((int(flags['flags'].strip(), 8) & os.O_ACCMODE) != os.O_RDONLY
                                                  and stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1 and info.st_size > 0)
                    result.append({'attempt': attempt, 'unit': unit, 'pid': int(process.name), 'writing': writing})
            except (FileNotFoundError, ProcessLookupError):
                continue
        # systemd creates an inactive slice lazily. Zero observed workers means
        # pending, never proof of resources; a live pool path comes from BOTH
        # the pinned candidate's kernel cgroup and systemd's ControlGroup.
        return result

    def collection(self, request):
        assert self.large and self.students == 16
        ids = request['attempts']
        assert isinstance(ids, list) and len(ids) == 2 and len(set(ids)) == 2
        snapshots = [self.snapshot(attempt) for attempt in ids]
        assert [entry['attempt']['username'] for entry in snapshots] == ['examq', 'examq01']
        action = request['action']
        if action == 'observe':
            return {'workers': self.collectors(ids), 'operation': self.collection_operation}
        if action == 'kill':
            assert self.collection_operation is None
            workers = self.collectors(ids)
            assert len(workers) == 2 and {w['attempt'] for w in workers} == set(ids) and all(w['writing'] for w in workers)
            assert all(entry['attempt']['state'] == 'FINALIZING' and not entry['attempt']['protected'] for entry in snapshots)
            target = next(worker for worker in workers if worker['attempt'] == ids[0])
            pinned = os.pidfd_open(target['pid'])
            try:
                assert target in self.collectors(ids)
                signal.pidfd_send_signal(pinned, signal.SIGKILL)
            finally:
                os.close(pinned)
            self.collection_operation = {'status': 'killed', 'workers': workers}
            return self.collection_operation
        assert action == 'retry-verify'
        with self.collection_lock:
            assert self.collection_operation and self.collection_operation['status'] in ('killed', 'pending', 'complete', 'failed')
            if self.collection_operation['status'] != 'killed':
                return self.collection_operation
            assert snapshots[0]['attempt']['state'] == 'COLLECTION_FAILED'
            operation = {'status': 'pending', 'workers': self.collection_operation['workers']}
            self.collection_operation = operation
        def retry_verify():
            try:
                log = OUTPUT / 'large-collection-retry.log'
                with log.open('xb') as stream:
                    os.chmod(log, 0o600)
                    subprocess.run(['examctl', 'retry', ids[0], '--reason', 'Private qualification retries the exact killed large collector'],
                                   stdout=stream, stderr=subprocess.STDOUT, check=True, timeout=135)
                until = time.monotonic() + 135
                while True:
                    state = private_json(Path(self.config['state']) / 'state.json')
                    if all(state['attempts'][attempt]['state'] == 'COMPLETED' and state['attempts'][attempt]['protected'] for attempt in ids):
                        break
                    assert time.monotonic() < until, 'Large collection retry did not complete'
                    time.sleep(.25)
                verified = {}
                for attempt in ids:
                    exported = OUTPUT / ('large-' + attempt + '.tar.gz')
                    subprocess.run(['examctl', 'export', attempt, '--output', str(exported)], check=True,
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=135)
                    verified[attempt] = verify_large_fixture_archive(exported, Path(self.config['work']) / attempt / 'work')
                operation.update(status='complete', verified=verified)
            except Exception as error:
                self.failures.append('Large collection retry/verification: ' + str(error))
                operation.update(status='failed', error=type(error).__name__)
        threading.Thread(target=retry_verify, daemon=True).start()
        return operation

    def inspect(self, client):
        with client.makefile('rwb', buffering=0) as stream:
            request = line(stream)
            if 'gate' in request:
                assert self.students == 1 and request['gate'] in ('start', 'status', 'restore')
                attempt = self.snapshot(request['attempt'])['attempt']
                assert attempt['username'] == 'examq' and attempt['state'] == 'ACTIVE'
                if request['gate'] == 'start':
                    assert self.gate_fault is None
                    self.gate_fault = GateStall(Path(self.config['socket']))
                assert self.gate_fault is not None
                if request['gate'] == 'restore': self.gate_fault.cancel()
                with self.evidence_lock: replies = self.evidence_replies
                send(stream, dict(self.gate_fault.status(), evidence_replies=replies))
                return
            if 'collection' in request:
                send(stream, self.collection(request['collection']))
                return
            if request == {'abort': True}:
                if self.gate_fault is not None:
                    try: self.gate_fault.cancel()
                    except AssertionError: self.failures.append('Private gate restoration failed; preserve exact sockets')
                self.failures.append('Local browser test aborted')
                try: send(stream, {'aborted': True})
                finally: self.done.set()
                return
            if 'attempts' in request:
                ids = request['attempts']
                assert self.students == 16 and len(ids) == 16 and len(set(ids)) == 16
                snapshots = [self.snapshot(attempt) for attempt in ids]
                assert {entry['attempt']['username'] for entry in snapshots} == set(fixture_accounts(16))
                if request.get('finish'):
                    for entry in snapshots:
                        attempt = entry['attempt']
                        assert attempt['state'] == 'COMPLETED' and attempt['protected'] and attempt['checksum']
                        assert attempt['access_state'] == 'HELD' and attempt['deadline'] == attempt['original_deadline'] > attempt['start']
                send(stream, {'snapshots': snapshots, 'private_guest': True})
                if request.get('finish'): self.done.set()
                return
            assert re.fullmatch(r'[a-f0-9-]{36}', request['attempt'])
            snapshot = self.snapshot(request['attempt'])
            attempt = snapshot['attempt']
            if request.get('finish'):
                assert attempt['state'] == 'COMPLETED' and attempt['protected'] and attempt['checksum']
                assert attempt['deadline'] == attempt['original_deadline'] > attempt['start']
            verified_files = None
            if request.get('finish'):
                assert self.students == 1
                exported = OUTPUT / 'browser-submission.tar.gz'
                root_command('examctl', 'export', request['attempt'], '--output', str(exported))
                verified_files = verify_fixture_archive(exported)
            send(stream, dict(snapshot, verified_files=verified_files))
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
    students = private_json(INPUT / 'run.json').get('browser_students', 1)
    names = fixture_accounts(students)
    assert not config.get('accounts') and config.get('temporary_account_policy')
    existing = pwd.getpwall()
    for number, name in enumerate(names):
        if number:
            uid = 29979 + number
            assert all(account.pw_name != name and account.pw_uid != uid for account in existing)
            root_command('useradd', '--create-home', '--uid', str(uid), '--shell', '/bin/bash', '--password', encoded.decode(), name)
        else:
            root_command('usermod', '--password', encoded.decode(), name)
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
                'students': [{'username': name, 'uid': pwd.getpwnam(name).pw_uid} for name in names],
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
    if not bridge.done.wait(780 if bridge.large else 540):
        raise TimeoutError('Actual browser/native qualification did not finish')
    if bridge.gate_fault is not None: bridge.gate_fault.cancel()
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
        deadline = time.monotonic() + ((900 if marker.get('browser_large') else 600) if mode == 'ssh' else 8)
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
