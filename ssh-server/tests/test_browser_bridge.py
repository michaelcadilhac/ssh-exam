"""Private transport contracts; guarded root/browser proof is a separate run."""
import base64
import importlib.util
import io
import json
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location('browser_bridge', Path(__file__).with_name('browser_bridge.py'))
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class BrowserBridgeTests(unittest.TestCase):
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
