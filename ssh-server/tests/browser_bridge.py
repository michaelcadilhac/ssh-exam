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
import traceback
import uuid

if not __debug__:
    raise RuntimeError('Qualification safety checks require Python without -O')

INPUT = Path('/run/ssh-exam-qualification-input')
OUTPUT = Path('/run/ssh-exam-qualification-output')
MAX_FRAME = 1024 * 1024


def private_json(path, *, atomic_snapshot=False):
    # state.json is replaced atomically by the native writer. An opened old
    # inode can therefore have zero links before fstat. Retry that exact benign
    # race only for explicitly mutable snapshots; never accept an unlinked,
    # hard-linked, foreign-owned or oversized file as the observation.
    for _ in range(3):
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(fd, 'rb') as stream:
            info = os.fstat(stream.fileno())
            assert stat.S_ISREG(info.st_mode) and info.st_uid == 0
            assert info.st_size <= MAX_FRAME
            if atomic_snapshot and info.st_nlink == 0:
                continue
            assert info.st_nlink == 1
            return json.loads(stream.read(MAX_FRAME + 1))
    raise RuntimeError('Private state snapshot kept changing; retry inspection')


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
            if result.get('bridge_error'):
                raise RuntimeError('Private callback transport refused before HTTP reply')
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


def verify_fixture_archive(path, expected=None):
    if expected is None:
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


class CoordinatorOutage:
    """Bounded loss of selected proof roles in the guarded guest ONLY."""
    def __init__(self, seconds=22.5, all_proof_paths=False, transport_only=False, role_ready=None):
        assert type(all_proof_paths) is bool and type(transport_only) is bool
        assert not transport_only or all_proof_paths
        guest_identity()
        self.before = self.identity('exam-agent.service', 'Agent')
        self.watchdog = self.identity('exam-deadline-watchdog.service', 'Watchdog')
        self.phase, self.after, self.error = 'stopping', None, None
        self.all_proof_paths, self.watchdog_after = all_proof_paths, None
        self.transport_only = transport_only
        assert role_ready is None or callable(role_ready)
        self.role_ready = role_ready
        self.stop = threading.Event()
        self.lock = threading.Lock()
        self.thread = threading.Thread(target=self.run, args=(seconds,), daemon=True)
        self.thread.start()

    @staticmethod
    def identity(unit, role):
        assert (unit, role) in (('exam-agent.service', 'Agent'), ('exam-deadline-watchdog.service', 'Watchdog'))
        pid = int(root_command('systemctl', 'show', unit, '--property=MainPID', '--value').strip())
        assert pid > 1, 'Owned role MainPID is not ready'
        process = Path('/proc') / str(pid)
        assert process.stat().st_uid == 0, 'Owned role UID mismatch'
        arguments = (process / 'cmdline').read_bytes().rstrip(b'\0').split(b'\0')
        if private_json(INPUT / 'run.json').get('release_native') is True:
            installed, loaded = Path('/usr/local/sbin/exam-agent').stat(), (process / 'exe').stat()
            assert (installed.st_dev,installed.st_ino) == (loaded.st_dev,loaded.st_ino), 'Owned release executable is not ready'
            expected = [b'/usr/local/sbin/exam-agent', b'-config', b'/etc/exam-agent/agent.json']
            if role == 'Watchdog': expected.append(b'-watchdog')
            assert arguments == expected, 'Owned release role arguments are not ready'
        else:
            assert (process / 'exe').resolve() == INPUT / 'core-qualification.test', 'Owned role executable is not ready'
            assert ('-test.run=^TestRetainedPolicy' + role + 'Guest$').encode() in arguments, 'Owned role argument is not ready'
        assert (process / 'cgroup').read_text() == '0::/system.slice/' + unit + '\n', 'Owned role cgroup mismatch'
        return pid

    @classmethod
    def restored_identity(cls, unit, role):
        # Type=simple can acknowledge its fork before exec/argv is observable.
        until = time.monotonic() + 2
        while True:
            try: pid = cls.identity(unit, role); break
            except (AssertionError, FileNotFoundError):
                if time.monotonic() >= until: raise
                time.sleep(.01)
        assert root_command('systemctl', 'show', unit, '--property=NRestarts', '--value').strip() == '0', 'Owned role crashed/restarted unexpectedly'
        return pid

    def status(self):
        with self.lock:
            return {'phase': self.phase, 'before': self.before, 'after': self.after,
                    'watchdog': self.watchdog, 'watchdog_after': self.watchdog_after,
                    'all_proof_paths': self.all_proof_paths, 'error': self.error}

    def run(self, seconds):
        if self.transport_only:
            try:
                with self.lock: self.phase = 'offline'
                self.stop.wait(seconds)
                after = self.restored_identity('exam-agent.service', 'Agent')
                watchdog = self.restored_identity('exam-deadline-watchdog.service', 'Watchdog')
                assert after == self.before and watchdog == self.watchdog, 'Proof-transport fault changed an owned role'
                if self.role_ready is not None:
                    roles = self.role_ready()
                    assert roles['agent']['pid'] == after and roles['watchdog']['pid'] == watchdog
                with self.lock: self.after, self.watchdog_after, self.phase = after, watchdog, 'restored'
            except Exception as error:
                with self.lock: self.phase, self.error = 'failed', type(error).__name__
            return
        error = None
        stage = 'stopping-owned-roles'
        try:
            units = ('exam-agent.service', 'exam-deadline-watchdog.service') if self.all_proof_paths else ('exam-agent.service',)
            root_command('systemctl', 'stop', *units)
            assert root_command('systemctl', 'show', 'exam-agent.service', '--property=MainPID', '--value').strip() == '0'
            if self.all_proof_paths:
                assert root_command('systemctl', 'show', 'exam-deadline-watchdog.service', '--property=MainPID', '--value').strip() == '0'
            else:
                assert self.identity('exam-deadline-watchdog.service', 'Watchdog') == self.watchdog
            with self.lock: self.phase = 'offline'
            self.stop.wait(seconds)
        except Exception as failure:
            error = stage + ':' + type(failure).__name__ + ':' + str(failure)[:160]
        finally:
            try:
                stage = 'starting-owned-roles'
                if self.all_proof_paths: root_command('systemctl', 'start', 'exam-deadline-watchdog.service')
                root_command('systemctl', 'start', 'exam-agent.service')
                stage = 'verifying-coordinator'
                after = self.restored_identity('exam-agent.service', 'Agent')
                assert after != self.before, 'Coordinator was not replaced'
                stage = 'verifying-watchdog'
                watchdog = self.restored_identity('exam-deadline-watchdog.service', 'Watchdog')
                assert (watchdog != self.watchdog) if self.all_proof_paths else (watchdog == self.watchdog)
                if self.role_ready is not None:
                    stage = 'verifying-operational-role-protocol'
                    roles = self.role_ready()
                    assert roles['agent']['pid'] == after and roles['watchdog']['pid'] == watchdog
                with self.lock: self.after, self.watchdog_after = after, watchdog
            except Exception as failure:
                error = stage + ':' + type(failure).__name__ + ':' + str(failure)[:160]
            with self.lock: self.phase, self.error = ('failed' if error else 'restored'), error

    def cancel(self):
        self.stop.set(); self.thread.join(timeout=35)
        assert not self.thread.is_alive(), 'Owned coordinator restoration did not settle'
        assert self.status()['phase'] == 'restored', 'Owned coordinator restore failed; preserve private evidence'


def verify_fixture_clock(attempt):
    """Private browser acceptance: original90min or ONE explicit90min reset."""
    start, original = attempt['start'], attempt['original_deadline']
    assert attempt['access_state'] == 'HELD' and original - start == 5400000
    resets = attempt.get('clock_resets', [])
    if not resets:
        assert attempt.get('clock_revision', 0) == 0 and attempt['deadline'] == original
        return
    assert len(resets) == 1 and attempt.get('clock_revision') == 1
    reset = resets[0]
    assert reset['revision'] == 1 and reset['actor'] == 'instructor'
    assert re.fullmatch(r'[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}', reset['id'])
    assert reset['remaining_seconds'] == 5400 and reset.get('extend_seconds', 0) == 0
    assert reset['previous_deadline'] == original and start <= reset['requested_at'] < original
    assert reset['applied_at'] >= start and reset['requested_at'] <= reset['applied_at'] + 1000
    assert attempt['deadline'] == reset['deadline'] == reset['requested_at'] + 5400000 > original


class GuestBridge:
    def __init__(self, config, role_ready=None):
        self.config = config
        self.role_ready = role_ready
        self.done = threading.Event()
        self.students = private_json(INPUT / 'run.json').get('browser_students', 1)
        self.large = private_json(INPUT / 'run.json').get('browser_large', False)
        # The16-student fixture carries32 simultaneous native proof requests,
        # plus16 SSH links,16 bounded relay workers and inspection/Begin traffic.
        # These private transport bounds do not change native authority limits.
        self.requests = queue.Queue(maxsize=48 if self.students == 16 else 16)
        self.slots = threading.BoundedSemaphore(96 if self.students == 16 else 32)
        self.failures = []
        self.collection_operation = None
        self.collection_lock = threading.Lock()
        self.gate_fault = None
        self.coordinator_fault = None
        self.coordinator_attempt = None
        self.coordinator_attempts = None
        self.transition_attempt = None
        self.recovery_source = None
        self.recovery_before = None
        self.recovery_checksum = None
        self.recovery_grant = None
        self.recovery_cancellation = None
        self.evidence_replies = 0
        self.evidence_lock = threading.Lock()
        self.inspection_context = threading.local()

    def serve(self, name, handler):
        server = socket.socket(socket.AF_UNIX)
        server.bind(str(OUTPUT / name))
        os.chmod(OUTPUT / name, 0o600)
        server.listen(64 if self.students == 16 else 16)
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
                        except (OSError, ValueError, KeyError, AssertionError, RuntimeError, queue.Full, subprocess.SubprocessError) as error:
                            print('BROWSER_BRIDGE_REFUSAL ' + name + ':' + type(error).__name__, flush=True)
                            if name == 'inspect.sock':
                                # Preserve the failing CODE boundary before the
                                # browser receives refusal and closes its panes.
                                # No exception message, locals, credentials,
                                # account names or unrelated history is recorded.
                                receipt = {'stage': name, 'error': type(error).__name__,
                                           'trace': ''.join(traceback.format_tb(error.__traceback__, limit=8))}
                                receipt['context'] = getattr(self.inspection_context, 'current', {})
                                try:
                                    state = private_json(Path(self.config['state']) / 'state.json', atomic_snapshot=True)
                                    rows = [a for a in state['attempts'].values() if a.get('exam') == 'native-browser' and a.get('state') in ('PREPARING', 'ACTIVE', 'LOCKED')]
                                    receipt['synthetic_states'] = {kind: sum(a['state'] == kind for a in rows) for kind in ('PREPARING', 'ACTIVE', 'LOCKED')}
                                    receipt['synthetic_holds'] = {kind: sum((a.get('monitoring_hold_kind') or 'unset') == kind for a in rows) for kind in ('unset', 'technical', 'policy')}
                                except (OSError, ValueError, KeyError, AssertionError, RuntimeError):
                                    receipt['state_unavailable'] = True
                                try:
                                    fd = os.open(OUTPUT / 'inspect-refusal.json', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
                                    with os.fdopen(fd, 'w') as output: json.dump(receipt, output)
                                except OSError: pass # Never replace first evidence or hide the RPC refusal.
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
        thread = threading.Thread(target=accept, daemon=True)
        thread.start()
        return thread

    def ssh(self, client):
        with socket.create_connection(('127.0.0.1', 22), timeout=5) as upstream:
            upstream.settimeout(5)
            copy_streams(client, upstream, timeout=900 if self.students == 16 else 600)

    def http(self, client):
        with client.makefile('rwb', buffering=0) as stream:
            request = line(stream)
            assert request['path'].startswith('/api/agent/')
            fault = getattr(self, 'coordinator_fault', None)
            if fault is not None and fault.transport_only and fault.status()['phase'] == 'offline' and request['path'] in (
                    '/api/agent/monitoring-evidence', '/api/agent/monitoring-continue', '/api/agent/monitoring-technical'):
                send(stream, {'status':503, 'headers':{}, 'body':base64.b64encode(b'Private proof-transport outage').decode()})
                return
            completed, result = threading.Event(), {}
            self.requests.put_nowait((request, completed, result))
            if not completed.wait(5):
                raise TimeoutError('Private gateway reply unavailable')
            if request['path'] == '/api/agent/monitoring-evidence' and result['reply']['status'] == 200:
                with self.evidence_lock: self.evidence_replies += 1
            send(stream, result['reply'])

    def gateway(self, client):
        # Four bounded host links, one outstanding request/reply per link. Keep
        # the authenticated SSH transport instead of launching it for each proof.
        with client.makefile('rwb', buffering=0) as stream:
            while not self.done.is_set():
                try:
                    request, completed, result = self.requests.get(timeout=4)
                except queue.Empty:
                    if self.done.is_set(): return
                    send(stream, {'idle': True})
                    continue
                send(stream, request)
                reply = line(stream)
                if not completed.is_set():
                    result['reply'] = reply
                    completed.set()

    def snapshot(self, attempt_id, scope_retries=2):
        assert re.fullmatch(r'[a-f0-9-]{36}', attempt_id)
        self.inspection_context.current = {'attempt': attempt_id}
        state = private_json(Path(self.config['state']) / 'state.json', atomic_snapshot=True)
        attempt = state['attempts'][attempt_id]
        assert attempt['exam'] == 'native-browser' and attempt['username'] in fixture_accounts(self.students)
        expected_uid = pwd.getpwnam(attempt['username']).pw_uid
        self.inspection_context.current.update(recorded_uid=attempt['uid'], expected_uid=expected_uid)
        assert attempt['uid'] == expected_uid
        supervisor, kernel = None, []
        if attempt.get('terminal_supervised') and attempt['state'] in ('ACTIVE', 'LOCKED'):
            try:
                supervisor = json.loads(root_command('examctl', 'panes', 'supervisor', attempt_id))
            except subprocess.CalledProcessError as error:
                supervisor = {'unavailable': True, 'exit': error.returncode}
            observed_units = supervisor.get('attached_units', [])
            self.inspection_context.current.update(unit_count=len(observed_units), unit_hashes=[hashlib.sha256(unit.encode()).hexdigest() for unit in observed_units[:8]])
            for unit in observed_units:
                events = scope_directory(attempt_id, unit) / 'cgroup.events'
                try:
                    kernel.append(dict(unit=unit, **dict(row.split() for row in events.read_text().splitlines())))
                except FileNotFoundError:
                    # A real pane can retire after the supervisor observation.
                    # Discard ALL partial proof and re-read ownership/cohort;
                    # persistent unknown state still refuses, never becomes [].
                    if scope_retries > 0:
                        return self.snapshot(attempt_id, scope_retries-1)
                    raise
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
                    state = private_json(Path(self.config['state']) / 'state.json', atomic_snapshot=True)
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

    def ssh_recovery(self, request):
        """Join existing PUBLIC root commands for one positively ended SSH owner."""
        assert self.students == 1 and not self.large
        assert self.coordinator_fault is None and self.gate_fault is None
        assert set(request) <= {'attempt', 'ssh_recovery', 'grant'}
        action, attempt_id = request['ssh_recovery'], request['attempt']
        assert action in ('stop', 'verify', 'source-sync', 'release', 'finish')
        value = self.snapshot(attempt_id)
        a = value['attempt']
        assert a['username'] == 'examq' and a['exam'] == 'native-browser'
        if action == 'stop':
            assert a['state'] in ('LOCKED', 'FINALIZING', 'COLLECTION_FAILED', 'COMPLETED')
            assert a.get('ssh_exited_owner') and a['ssh_exited_owner'] == a['registered_owner']
            assert a['monitoring_mode'] == 'v1' and not a['grant'].get('kind')
            assert a['start'] > 0 and a['deadline'] == a['original_deadline'] == a['start'] + 5400000
            assert self.recovery_source in (None, attempt_id)
            self.recovery_source = attempt_id
            if self.recovery_before is None:
                self.recovery_before = {key:a[key] for key in ('start','deadline','original_deadline','grant','uid')}
            root_command('examctl', 'stop', attempt_id, '--reason', 'Private C7 instructor explicitly secures abandoned SSH attempt')
            return self.snapshot(attempt_id)
        assert self.recovery_source is not None
        source = self.snapshot(self.recovery_source)['attempt']
        assert all(source[key] == value for key,value in self.recovery_before.items())
        assert source['state'] == 'COMPLETED' and source['protected'] and source['checksum']
        if self.recovery_checksum is not None: assert source['checksum'] == self.recovery_checksum
        if action == 'finish':
            assert self.recovery_grant and attempt_id != self.recovery_source
            assert source['access_state'] in ('OVERRIDDEN','RELEASED') and source['policy_state'] == 'NORMAL'
            assert source['access_override'] == 'Private C7 instructor separately approves early access disposition'
            assert a['state'] == 'COMPLETED' and a['protected'] and a['checksum'] and a['access_state'] == 'HELD'
            assert a['settings']['duration'] == 1200 and a['start'] > source['start']
            assert a['deadline'] == a['original_deadline'] == a['start'] + 1200000
            assert not a.get('clock_resets') and a['grant']['kind'] == 'ADDITIONAL' and a['grant']['id'] == self.recovery_grant
            expected = {'kind':'saved','attempt':self.recovery_source,'checksum':self.recovery_checksum}
            assert a['grant']['work'] == expected and a['workspace']['source'] == expected
            exported = OUTPUT / ('recovery-target-' + attempt_id + '.tar.gz')
            root_command('examctl', 'manifest', self.recovery_source)
            root_command('examctl', 'manifest', attempt_id)
            root_command('examctl', 'export', attempt_id, '--output', str(exported))
            files = verify_fixture_archive(exported, {'recovery-proof.txt':b'SAVED-before-genuine-SSH-loss\n',
                                                      'recovery-result.txt':b'NEW-20-MINUTE-ATTEMPT\n'})
            return dict(value, source=source, verified_files=files)
        assert attempt_id == self.recovery_source
        if action == 'verify':
            root_command('examctl', 'manifest', attempt_id)
            exported = OUTPUT / ('recovery-source-' + attempt_id + '.tar.gz')
            if not exported.exists(): root_command('examctl', 'export', attempt_id, '--output', str(exported))
            files = verify_fixture_archive(exported, {'recovery-proof.txt':b'SAVED-before-genuine-SSH-loss\n'})
            self.recovery_checksum = source['checksum']
            # A test-only fault in the stopped synthetic LIVE folder proves the
            # new grant restores the verified archive, never this stale folder.
            live = Path(self.config['work']) / attempt_id / 'work/recovery-proof.txt'
            descriptor = os.open(live, os.O_WRONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            with os.fdopen(descriptor, 'wb') as output:
                info = os.fstat(output.fileno())
                assert stat.S_ISREG(info.st_mode) and info.st_uid == source['uid'] and info.st_nlink == 1 and info.st_size <= 1024
                output.truncate(0); output.write(b'CHANGED-UNUSED-LIVE-FOLDER\n'); output.flush(); os.fsync(output.fileno())
            return dict(value, verified_files=files, live_source_changed=True)
        assert self.recovery_checksum is not None
        if action == 'source-sync':
            grant = request['grant']
            assert re.fullmatch(r'[a-f0-9-]{36}', grant)
            reply = json.loads(root_command('examctl', 'web', 'grants', 'show', grant))
            assert reply['confirmed'] is True and reply['operation'] == 'grants.show' and isinstance(reply['result'], dict)
            selected = reply['result']
            assert selected['exam'] == 'native-browser' and selected['username'] == 'examq' and selected['revision'] == 1
            assert selected['settings']['duration'] == 1200
            assert selected['work'] == {'kind':'saved','attempt':attempt_id,'checksum':self.recovery_checksum}
            # Author historical fixture metadata only inside this private guest,
            # then use the actual root cancellation before the separate NEW pin.
            # Keep the exact reviewed intent for a private transport retry.
            if self.recovery_cancellation is None:
                parent = Path(self.config['state']) / 'recovery-preparations'
                directory = parent / 'native-browser'
                for path in (parent, directory):
                    path.mkdir(mode=0o700, exist_ok=True)
                    info = path.lstat()
                    assert stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and stat.S_IMODE(info.st_mode) == 0o700
                path = directory / 'examq.json'
                legacy = {'exam':'native-browser','username':'examq','uid':source['uid'],'duration':3600,
                          'source_attempt':attempt_id,'checksum':self.recovery_checksum,
                          'created_at':int(time.time()*1000),'reason':'Private synthetic unused permission before explicit replacement'}
                original = json.dumps(legacy, separators=(',', ':')).encode()
                descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
                with os.fdopen(descriptor, 'wb') as output:
                    output.write(original); output.flush(); os.fsync(output.fileno())
                descriptor = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
                try: os.fsync(descriptor)
                finally: os.close(descriptor)
                preview = json.loads(root_command('examctl','recovery-grants','revoke-preview','native-browser','examq'))
                assert preview['eligible'] and preview['blockers'] == [] and preview['grant_hash'] == hashlib.sha256(original).hexdigest()
                args = ('examctl','recovery-grants','revoke','native-browser','examq','--review',preview['review'],
                        '--reason','Cancel unused synthetic permission before separate reviewed replacement')
                self.recovery_cancellation = dict(grant=grant, original=original, path=path, args=args)
            cancellation = self.recovery_cancellation
            assert cancellation['grant'] == grant
            receipt = root_command(*cancellation['args'])
            assert root_command(*cancellation['args']) == receipt
            revoked = json.loads(receipt)
            envelope = private_json(cancellation['path'])
            assert revoked['disposition'] == 'revoked' and revoked['duration'] == 3600 and revoked['source_attempt'] == attempt_id
            assert envelope['purpose'] == 'legacy-recovery-revoked/v1' and base64.b64decode(envelope['original'],validate=True) == cancellation['original']
            root_command('examctl', 'web', 'grants', 'source-sync', grant, '--revision', '1')
            self.recovery_grant = grant
            return dict(self.snapshot(attempt_id), legacy_revoked=revoked)
        assert self.recovery_grant and action == 'release'
        assert source['deadline'] > int(time.time()*1000), 'This case must exercise explicit EARLY disposition'
        root_command('examctl', 'override-access', attempt_id, '--reason', 'Private C7 instructor separately approves early access disposition')
        return self.snapshot(attempt_id)

    def inspect(self, client):
        with client.makefile('rwb', buffering=0) as stream:
            request = line(stream)
            if 'ssh_recovery' in request:
                value = self.ssh_recovery(request)
                send(stream, value)
                if request['ssh_recovery'] == 'finish': self.done.set()
                return
            if 'transition' in request:
                assert self.students == 1 and request['transition'] in ('start', 'status')
                snapshot = self.snapshot(request['attempt'])
                attempt = snapshot['attempt']
                assert attempt['exam'] == 'native-browser' and attempt['username'] == 'examq'
                marker = Path(self.config['state']) / 'qualification-resume-transition'
                observed = Path(str(marker) + '.observed')
                if request['transition'] == 'start':
                    assert self.transition_attempt is None and self.coordinator_attempt == request['attempt']
                    assert self.coordinator_fault.all_proof_paths and self.coordinator_fault.status()['phase'] == 'offline'
                    assert snapshot['kernel'] and all(row['frozen'] == '1' and row['populated'] == '1' for row in snapshot['kernel'])
                    assert snapshot['supervisor']['ssh_peer'] == 'pinned-live'
                    assert not any(p.exists() or p.is_symlink() for p in (marker, observed, Path(str(marker)+'.release'), Path(str(marker)+'.timed-out')))
                    descriptor = os.open(marker, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
                    with os.fdopen(descriptor, 'w') as output:
                        json.dump({'attempt':request['attempt'], 'stage':'process-continued', 'block':False}, output)
                        output.flush(); os.fsync(output.fileno())
                    self.transition_attempt = request['attempt']
                assert self.transition_attempt == request['attempt']
                reached = observed.exists()
                if reached:
                    value = private_json(observed)
                    assert value == {'attempt':request['attempt'], 'stage':'process-continued', 'block':False}
                nonces = set()
                audit = Path(self.config['state']) / 'audit.ndjson'
                if audit.exists():
                    descriptor = os.open(audit, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
                    with os.fdopen(descriptor, 'rb') as stream_audit:
                        info = os.fstat(stream_audit.fileno())
                        assert stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1 and info.st_mode & 0o077 == 0
                        data = stream_audit.read(1024*1024+1)
                    assert len(data) <= 1024*1024
                    # A concurrent append's incomplete last line is no receipt.
                    for row in data.rsplit(b'\n', 1)[0].splitlines():
                        record = json.loads(row)
                        if record.get('action') == 'technical-continuation-verified' and record.get('attempt') == request['attempt']:
                            assert re.fullmatch(r'[a-f0-9]{64}', record['nonce'])
                            nonces.add(record['nonce'])
                send(stream, {'observed':reached, 'verified_nonce_count':len(nonces), 'stage':'process-continued'})
                return
            if 'coordinator' in request:
                assert self.students == 1 and request['coordinator'] in ('start', 'status', 'restore')
                if request['coordinator'] == 'start':
                    attempt = self.snapshot(request['attempt'])['attempt']
                    assert attempt['username'] == 'examq' and attempt['state'] == 'ACTIVE'
                    assert self.coordinator_fault is None and self.gate_fault is None
                    both = request.get('all_proof_paths', False)
                    assert type(both) is bool
                    transport = request.get('transport_only', False)
                    assert type(transport) is bool and (not transport or both)
                    self.coordinator_fault = CoordinatorOutage(all_proof_paths=both, transport_only=transport, role_ready=self.role_ready)
                    self.coordinator_attempt = request['attempt']
                assert self.coordinator_fault is not None and self.coordinator_attempt == request['attempt']
                if request['coordinator'] == 'restore': self.coordinator_fault.cancel()
                send(stream, self.coordinator_fault.status())
                return
            if 'gate' in request:
                assert self.students == 1 and request['gate'] in ('start', 'status', 'restore')
                attempt = self.snapshot(request['attempt'])['attempt']
                technical = request.get('technical_recovery', False)
                assert type(technical) is bool and attempt['username'] == 'examq'
                if request['gate'] == 'start':
                    assert self.gate_fault is None
                    if technical:
                        assert self.coordinator_attempt == request['attempt'] and self.coordinator_fault is not None
                        assert self.coordinator_fault.all_proof_paths and self.coordinator_fault.transport_only and self.coordinator_fault.status()['phase'] == 'offline'
                        assert attempt['state'] == 'LOCKED' and attempt.get('retained_hold') == 'held' and attempt.get('monitoring_hold_kind') == 'technical'
                    else:
                        assert self.coordinator_fault is None and attempt['state'] == 'ACTIVE'
                    self.gate_attempt = request['attempt']
                    self.gate_fault = GateStall(Path(self.config['socket']))
                assert self.gate_fault is not None and self.gate_attempt == request['attempt']
                if request['gate'] == 'restore': self.gate_fault.cancel()
                with self.evidence_lock: replies = self.evidence_replies
                send(stream, dict(self.gate_fault.status(), evidence_replies=replies))
                return
            if 'collection' in request:
                send(stream, self.collection(request['collection']))
                return
            if request == {'abort': True}:
                if self.coordinator_fault is not None:
                    try: self.coordinator_fault.cancel()
                    except AssertionError: self.failures.append('Private coordinator restoration failed; preserve exact guest')
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
                if 'recovery' in request:
                    assert not self.large and not request.get('finish')
                    assert request['recovery'] in ('start', 'status', 'restore')
                    if request['recovery'] == 'start':
                        assert self.coordinator_fault is None and self.gate_fault is None
                        assert all(entry['attempt']['state'] == 'ACTIVE' and
                                   entry['supervisor']['ssh_peer'] == 'pinned-live' and
                                   entry['supervisor']['attached_panes'] == 4 and
                                   len(entry['kernel']) == 4 and all(row['populated'] == '1' and row['frozen'] == '0' for row in entry['kernel'])
                                   for entry in snapshots)
                        self.coordinator_attempts = frozenset(ids)
                        # Transport-only: no service stop/restart.35s permits
                        # independent observation of all64 physically held panes.
                        self.coordinator_fault = CoordinatorOutage(seconds=35, all_proof_paths=True, transport_only=True, role_ready=self.role_ready)
                    assert self.coordinator_fault is not None and self.coordinator_attempts == frozenset(ids)
                    if request['recovery'] == 'restore': self.coordinator_fault.cancel()
                    send(stream, self.coordinator_fault.status())
                    return
                if request.get('finish'):
                    for entry in snapshots:
                        attempt = entry['attempt']
                        assert attempt['state'] == 'COMPLETED' and attempt['protected'] and attempt['checksum']
                        verify_fixture_clock(attempt)
                send(stream, {'snapshots': snapshots, 'private_guest': True})
                if request.get('finish'): self.done.set()
                return
            assert re.fullmatch(r'[a-f0-9-]{36}', request['attempt'])
            snapshot = self.snapshot(request['attempt'])
            attempt = snapshot['attempt']
            if request.get('finish'):
                assert attempt['state'] == 'COMPLETED' and attempt['protected'] and attempt['checksum']
                verify_fixture_clock(attempt)
            verified_files = None
            if request.get('finish'):
                assert self.students == 1
                exported = OUTPUT / 'browser-submission.tar.gz'
                root_command('examctl', 'export', request['attempt'], '--output', str(exported))
                verified_files = verify_fixture_archive(exported)
            send(stream, dict(snapshot, verified_files=verified_files))
            if request.get('finish'):
                self.done.set()


def run_guest(config, prepare_roles, role_snapshot):
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
                'releaseNative': private_json(INPUT / 'run.json').get('release_native') is True,
                'students': [{'username': name, 'uid': pwd.getpwnam(name).pw_uid} for name in names],
                'callbackPublicKey': Path('/etc/exam-agent/callback.pub').read_text(),
                'classPins': [hashlib.sha256(base64.b64decode(host_key)).hexdigest()], 'template': version}
    initial_roles = role_snapshot(config)
    assert initial_roles['agent']['hash'] == initial_roles['watchdog']['hash']
    assert all(value['retained_enabled'] for value in initial_roles.values())
    def role_ready():
        observed = role_snapshot(config)
        for name in ('agent','watchdog'):
            assert observed[name]['hash'] == initial_roles[name]['hash'] and observed[name]['exe'] == initial_roles[name]['exe'] and observed[name]['retained_enabled']
        return observed
    bridge = GuestBridge(config, role_ready=role_ready)
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
    if not bridge.done.wait(780 if bridge.students == 16 else 540):
        raise TimeoutError('Actual browser/native qualification did not finish')
    if bridge.gate_fault is not None: bridge.gate_fault.cancel()
    if bridge.coordinator_fault is not None:
        receipt = OUTPUT / 'coordinator-fault.json'
        with receipt.open('x') as stream:
            os.chmod(receipt, 0o600)
            json.dump(bridge.coordinator_fault.status(), stream)
        bridge.coordinator_fault.cancel()
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
    assert mode in ('ssh', 'gateway', 'inspect', 'operator')
    if mode == 'operator':
        assert marker.get('browser_students', 1) == 1 and not marker.get('browser_large')
    target = stage / 'output' / (('inspect' if mode == 'operator' else mode) + '.sock')
    info = target.lstat()
    assert stat.S_ISSOCK(info.st_mode) and info.st_uid == 0 and info.st_mode & 0o777 == 0o600
    with socket.socket(socket.AF_UNIX) as client:
        client.settimeout(6)
        client.connect(str(target))
        # Stdio uses separate fds. Do not buffer or interpret SSH bytes.
        lifetime = (900 if marker.get('browser_students') == 16 else 600) if mode in ('ssh', 'gateway') else (125 if mode == 'operator' else 8)
        deadline = time.monotonic() + lifetime
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
    parser.add_argument('mode', choices=('metadata', 'ssh', 'gateway', 'inspect', 'operator'))
    args = parser.parse_args()
    host_bridge(args.host, args.mode)
