"""Private transport contracts; guarded root/browser proof is a separate run."""
import base64
import importlib.util
import io
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import threading
import time
import types
import tarfile
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location('browser_bridge', Path(__file__).with_name('browser_bridge.py'))
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class BrowserBridgeTests(unittest.TestCase):
    def test_abort_always_completes_even_when_owned_gate_restore_refuses(self):
        fixture = object.__new__(bridge.GuestBridge)
        fixture.gate_fault = types.SimpleNamespace(cancel=mock.Mock(side_effect=AssertionError('changed socket')))
        fixture.failures = []; fixture.done = threading.Event()
        server, client = socket.socketpair()
        try:
            server.settimeout(1); client.settimeout(1)
            client.sendall(b'{"abort":true}\n')
            fixture.inspect(server)
            self.assertTrue(fixture.done.is_set())
            with client.makefile('rb') as stream: self.assertEqual(bridge.line(stream), {'aborted': True})
            self.assertEqual(fixture.failures, ['Private gate restoration failed; preserve exact sockets', 'Local browser test aborted'])
        finally: server.close(); client.close()

    def test_gate_stall_accepts_actual_request_without_reply_and_restores_original_listener(self):
        with tempfile.TemporaryDirectory() as directory, socket.socket(socket.AF_UNIX) as original:
            path = Path(directory) / 'gate.sock'
            original.bind(str(path)); original.listen(1); original.settimeout(1); path.chmod(0o600)
            identity = (path.stat().st_dev, path.stat().st_ino)
            fault = bridge.GateStall(path, .5)
            try:
                with socket.socket(socket.AF_UNIX) as client:
                    client.settimeout(.05); client.connect(str(path)); client.sendall(b'{"signed":"original"}\n')
                    until = time.monotonic() + 1
                    while not fault.status()['accepted'] and time.monotonic() < until: time.sleep(.005)
                    self.assertEqual(fault.status()['accepted'], 1)
                    with self.assertRaises(socket.timeout): client.recv(1)
                fault.thread.join(timeout=2)
                self.assertEqual(fault.status()['phase'], 'restored')
                self.assertEqual((path.stat().st_dev, path.stat().st_ino), identity)
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)
                with socket.socket(socket.AF_UNIX) as client:
                    client.settimeout(1); client.connect(str(path)); client.sendall(b'after-stall')
                    peer, _ = original.accept()
                    with peer:
                        peer.settimeout(1); self.assertEqual(peer.recv(32), b'after-stall')
            finally: fault.cancel()

    def test_gate_cancel_is_bounded_and_does_not_replace_a_changed_socket(self):
        with tempfile.TemporaryDirectory() as directory, socket.socket(socket.AF_UNIX) as original:
            path = Path(directory) / 'gate.sock'
            original.bind(str(path)); original.listen(1)
            fault = bridge.GateStall(path, 10)
            fault.cancel(); self.assertEqual(fault.status()['phase'], 'restored')
            fault = bridge.GateStall(path, 10)
            path.unlink()
            with socket.socket(socket.AF_UNIX) as replacement:
                replacement.bind(str(path)); replacement.listen(1)
                identity = (path.stat().st_dev, path.stat().st_ino)
                with self.assertRaisesRegex(AssertionError, 'restore failed'): fault.cancel()
                self.assertEqual(fault.status()['phase'], 'failed')
                self.assertEqual((path.stat().st_dev, path.stat().st_ino), identity)
                self.assertTrue(fault.held.exists())

    def test_observer_checks_nested_kernel_pool_against_systemd_and_all_resource_bounds(self):
        attempt = 'aaaaaaaa-1234-4234-8234-123456789abc'
        unit = 'exam-collection-' + attempt + '-123456abcdef.service'
        pool_name = '/exam.slice/exam-collection.slice'
        fixture = object.__new__(bridge.GuestBridge)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); process = root / 'process'; process.mkdir()
            (process / 'cmdline').write_bytes(b'/private/core-qualification.test\0--collection-worker\0')
            (process / 'cgroup').write_text('0::' + pool_name + '/' + unit + '\n')
            for name in ('fd', 'fdinfo'): (process / name).mkdir()
            fixture.config = {'state': str(root / 'state')}
            archive = root / 'state/submissions' / ('.' + attempt + '.collect-123') / 'submission.tar.gz'
            archive.parent.mkdir(parents=True); archive.write_bytes(b'writing')
            (process / 'fd/7').symlink_to(archive)
            (process / 'fdinfo/7').write_text('flags:\t0100001\n')
            pool = root / 'kernel'; (pool / unit).mkdir(parents=True)
            for target, memory, tasks in ((pool, 512, 96), (pool / unit, 256, 32)):
                (target / 'memory.max').write_text(str(memory * 1024**2))
                (target / 'memory.swap.max').write_text('0')
                (target / 'pids.max').write_text(str(tasks))
            class Process:
                name = '987654'
                def stat(self): return types.SimpleNamespace(st_uid=0)
                def __truediv__(self, name): return process / name
            def path(value):
                if value == '/proc': return types.SimpleNamespace(iterdir=lambda: iter([Process()]))
                if value == '/sys/fs/cgroup' + pool_name: return pool
                return Path(value)
            real_lstat = os.lstat
            owner = 0
            def lstat(value, *args, **kwargs):
                result = real_lstat(value, *args, **kwargs)
                if Path(value) == archive:
                    values = list(result); values[4] = owner; return os.stat_result(values)
                return result
            with mock.patch.object(bridge, 'Path', side_effect=path), mock.patch.object(bridge.os, 'lstat', side_effect=lstat), mock.patch.object(bridge, 'root_command', return_value=pool_name + '\n') as command:
                self.assertEqual(fixture.collectors([attempt]), [{'attempt': attempt, 'unit': unit, 'pid': 987654, 'writing': True}])
                command.assert_called_once_with('systemctl', 'show', 'exam-collection.slice', '--property=ControlGroup', '--value')
                owner = 2000
                self.assertFalse(fixture.collectors([attempt])[0]['writing'])
                owner = 0
                command.return_value = '/wrong/exam-collection.slice'
                with self.assertRaises(AssertionError): fixture.collectors([attempt])
                command.return_value = pool_name
                (pool / 'memory.swap.max').write_text('1')
                with self.assertRaises(AssertionError): fixture.collectors([attempt])

    def test_observer_waits_for_real_collectors_before_reading_lazy_pool_cgroup(self):
        fixture = object.__new__(bridge.GuestBridge)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); processes = root / 'proc'; processes.mkdir()
            def path(value):
                if value == '/proc': return processes
                if value == '/sys/fs/cgroup/exam-collection.slice': return root / 'not-created-yet'
                return Path(value)
            with mock.patch.object(bridge, 'Path', side_effect=path):
                self.assertEqual(fixture.collectors(['aaaaaaaa-1234-4234-8234-123456789abc']), [])

    def test_worker_fault_refuses_unqualified_active_protected_or_nonwriting_targets_before_signal(self):
        fixture = object.__new__(bridge.GuestBridge)
        fixture.large = True; fixture.students = 16; fixture.collection_operation = None
        ids = ['aaaaaaaa-1234-4234-8234-123456789abc', 'bbbbbbbb-1234-4234-8234-123456789abc']
        for state, protected, writing in (('ACTIVE', False, True), ('FINALIZING', True, True), ('FINALIZING', False, False)):
            with self.subTest(state=state, protected=protected, writing=writing):
                fixture.snapshot = lambda attempt: {'attempt': {'username': 'examq' if attempt == ids[0] else 'examq01', 'state': state, 'protected': protected}}
                fixture.collectors = lambda attempts: [{'attempt': attempt, 'pid': 123, 'unit': 'fixture', 'writing': writing} for attempt in attempts]
                with mock.patch.object(bridge.os, 'pidfd_open') as pin, mock.patch.object(bridge.signal, 'pidfd_send_signal') as send:
                    with self.assertRaises(AssertionError): fixture.collection({'action': 'kill', 'attempts': ids})
                    pin.assert_not_called(); send.assert_not_called()
        fixture.large = False
        with mock.patch.object(fixture, 'snapshot') as snapshot, self.assertRaises(AssertionError):
            fixture.collection({'action': 'kill', 'attempts': ids})
        snapshot.assert_not_called()

    def test_large_export_stream_compares_all_bytes_and_refuses_wrong_missing_linked_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); work = root / 'work'; work.mkdir()
            path = root / 'export.tar.gz'
            for n in range(4): (work / ('large-%d.bin' % n)).write_bytes(b'abc')
            def write(missing=False, wrong=False, linked=False):
                with tarfile.open(path, 'w:gz') as archive:
                    for n in range(3 if missing else 4):
                        value = b'xyz' if wrong and n == 1 else b'abc'
                        header = tarfile.TarInfo('large-%d.bin' % n); header.size = len(value)
                        if linked and n == 1: header.type = tarfile.SYMTYPE; header.linkname = '/other'; header.size = 0
                        archive.addfile(header, io.BytesIO(value))
            write()
            self.assertEqual(bridge.verify_large_fixture_archive(path, work, 3), ['large-%d.bin' % n for n in range(4)])
            for missing, wrong, linked in ((True, False, False), (False, True, False), (False, False, True)):
                write(missing, wrong, linked)
                with self.subTest(missing=missing, wrong=wrong, linked=linked), self.assertRaises(AssertionError):
                    bridge.verify_large_fixture_archive(path, work, 3)

    def test_capacity_account_names_are_finite_synthetic_and_never_arbitrary(self):
        self.assertEqual(bridge.fixture_accounts(1), ['examq'])
        names = bridge.fixture_accounts(16)
        self.assertEqual(len(names), 16)
        self.assertEqual(len(set(names)), 16)
        self.assertEqual(names[0], 'examq')
        self.assertEqual(names[-1], 'examq15')
        for count in (0, 2, 17):
            with self.subTest(count=count), self.assertRaises(AssertionError):
                bridge.fixture_accounts(count)

    def test_export_checks_exact_saved_work_and_rejects_missing_or_linked_proofs(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'submission.tar.gz'
            def write(editor=b'UNSAVED-native-editor\n', linked=False):
                with tarfile.open(path, 'w:gz') as archive:
                    for name, value in (('browser-proof.txt', b'SAVED-actual-native-END\n'), ('browser-editor.txt', editor)):
                        if value is None: continue
                        header = tarfile.TarInfo(name); header.size = len(value)
                        if linked and name == 'browser-editor.txt':
                            header.type = tarfile.SYMTYPE; header.linkname = '/other'; header.size = 0
                        archive.addfile(header, io.BytesIO(value))
            write()
            self.assertEqual(bridge.verify_fixture_archive(path), ['browser-editor.txt', 'browser-proof.txt'])
            for editor, linked in ((None, False), (b'other\n', False), (b'UNSAVED-native-editor\n', True)):
                write(editor, linked)
                with self.subTest(editor=editor, linked=linked), self.assertRaises(AssertionError):
                    bridge.verify_fixture_archive(path)

    def test_optimized_python_refuses_before_any_host_access(self):
        result = subprocess.run([sys.executable, '-O', str(Path(bridge.__file__)), '--host',
                                 '/var/tmp/ssh-exam-overlay-probe', 'metadata'],
                                capture_output=True, text=True, timeout=3)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Qualification safety checks require Python without -O', result.stderr)

    def test_kernel_observation_accepts_the_real_gate_scope_and_refuses_other_owners(self):
        attempt = 'aaaaaaaa-1234-4234-8234-123456789abc'
        pane = 'bbbbbbbb-1234-4234-8234-123456789abc'
        incarnation = 'cccccccc-1234-4234-8234-123456789abc'
        unit = 'exam-' + attempt + '-' + pane + '-' + incarnation + '.scope'
        self.assertEqual(bridge.scope_directory(attempt, unit), Path('/sys/fs/cgroup/exam.slice') / unit)
        for bad in (unit.replace(attempt, pane), unit + '/../other', 'exam-' + attempt + '-' + 'a'*32 + '.scope'):
            with self.subTest(unit=bad), self.assertRaises(AssertionError):
                bridge.scope_directory(attempt, bad)

    def test_frames_refuse_truncation_and_oversize(self):
        for raw in (b'', b'{}', b'x' * (bridge.MAX_FRAME + 1) + b'\n'):
            with self.subTest(length=len(raw)), self.assertRaises(RuntimeError):
                bridge.line(io.BytesIO(raw))
        output = io.BytesIO()
        bridge.send(output, {'native': '\u03bb', 'unchanged': True})
        output.seek(0)
        self.assertEqual(bridge.line(output), {'native': '\u03bb', 'unchanged': True})

    def test_host_refuses_nonqualification_paths_before_command_or_socket(self):
        with mock.patch.object(bridge.os, 'getuid', return_value=0), mock.patch.object(bridge.os, 'geteuid', return_value=0), mock.patch.object(bridge, 'root_command') as command:
            for target in ('/', '/etc/exam-agent', '/var/tmp/ssh-exam-overlay-test/../other'):
                with self.subTest(target=target), self.assertRaises(AssertionError):
                    bridge.host_bridge(Path(target), 'ssh')
            command.assert_not_called()

    def test_http_bridge_preserves_original_signed_bytes_and_refusal_status(self):
        # Only the root guest guard is mocked; this crosses a real owned Unix
        # listener and independently bounded connect/accept/read/reply waits.
        raw = b'{ "agent": "synthetic", "signed": "original bytes" }'
        seen, failures = [], []
        with tempfile.TemporaryDirectory() as directory:
            with socket.socket(socket.AF_UNIX) as server:
                server.bind(directory + '/http.sock')
                server.listen(1)
                server.settimeout(2)
                def peer():
                    try:
                        client, _ = server.accept()
                        with client:
                            client.settimeout(2)
                            with client.makefile('rwb', buffering=0) as stream:
                                seen.append(bridge.line(stream))
                                bridge.send(stream, {'status': 409, 'body': base64.b64encode(b'{"error":"refused"}').decode()})
                    except Exception as error:
                        failures.append(error)
                thread = threading.Thread(target=peer, daemon=True)
                thread.start()
                with mock.patch.object(bridge, 'guest_identity'), mock.patch.object(bridge, 'OUTPUT', Path(directory)):
                    result = bridge.forward_http('/api/agent/monitoring-evidence', {'X-Exam-Signature': 'unchanged'}, raw)
                thread.join(3)
                self.assertFalse(thread.is_alive())
                self.assertFalse(failures)
                self.assertEqual(result, (409, b'{"error":"refused"}'))
                self.assertEqual(seen, [{'path': '/api/agent/monitoring-evidence', 'headers': {'X-Exam-Signature': 'unchanged'}, 'body': base64.b64encode(raw).decode()}])


if __name__ == '__main__':
    unittest.main()
