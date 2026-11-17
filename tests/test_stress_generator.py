"""Private browser-worker safety contracts; these tests never contact Marco."""
import importlib.util
import ast
import json
from pathlib import Path
import signal
import socket
import subprocess
import stat
import tempfile
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location('generator', Path(__file__).resolve().parents[1] / 'scripts/stress_generator.py')
generator = importlib.util.module_from_spec(spec)
spec.loader.exec_module(generator)


class GeneratorTests(unittest.TestCase):
    def test_shared_memory_pressure_refuses_only_the_owned_generator(self):
        with tempfile.TemporaryDirectory() as directory:
            owned = generator.MarcoGenerator(directory)
            owned.stop_event = mock.Mock()
            owned.stop_event.wait.return_value = False
            owned.rpc = mock.Mock(side_effect=[{
                'active': True, 'available_bytes': 24*1024**3,
                'scratch_free_bytes': 4*1024**3, 'owned_bytes': 1024,
                'shared_memory_free_bytes': 3*1024**3,
            }, {'stopped': True}])
            owned.monitor()
            self.assertIn('guard refused', owned.failure)
            self.assertEqual([c.args[0] for c in owned.rpc.call_args_list], ['status', 'stop'])
            status = json.loads((Path(directory)/'generator-status.json').read_text())
            self.assertFalse(status['active'])

    def test_port_guard_refuses_live_listeners_but_accepts_owned_tcp_closing_state(self):
        function = next(node for node in ast.parse(generator.RPC).body
                        if isinstance(node, ast.FunctionDef) and node.name == 'free_ports')
        namespace = {'socket': socket, 'Path': Path}
        exec(compile(ast.Module(body=[function], type_ignores=[]), 'remote-port-guard', 'exec'), namespace)
        with socket.socket() as listener, socket.socket() as client:
            listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            listener.settimeout(1);client.settimeout(1)
            listener.bind(('127.0.0.1', 0));port = listener.getsockname()[1];listener.listen(1)
            with self.assertRaises(AssertionError): namespace['free_ports']([port])
            client.connect(('127.0.0.1',port));accepted, _ = listener.accept()
            with accepted:
                accepted.settimeout(1);accepted.shutdown(socket.SHUT_WR)
                self.assertEqual(client.recv(1), b'');client.close()
                self.assertEqual(accepted.recv(1), b'')
        namespace['free_ports']([port])

    def test_remote_disk_observer_accepts_only_a_disappearing_temporary_entry(self):
        # Execute the exact function shipped in the remote RPC, against actual
        # filesystem entries. A deleted temporary file uses no disk space.
        function = next(node for node in ast.parse(generator.RPC).body
                        if isinstance(node, ast.FunctionDef) and node.name == 'owned_bytes')
        namespace = {'stat': stat}
        exec(compile(ast.Module(body=[function], type_ignores=[]), 'remote-profile-observer', 'exec'), namespace)
        with tempfile.TemporaryDirectory() as directory:
            live = Path(directory)/'live'; live.write_bytes(b'12345')
            gone = Path(directory)/'gone'; gone.write_bytes(b'6789'); gone.unlink()
            root = mock.Mock(); root.rglob.return_value = [live, gone]
            self.assertEqual(namespace['owned_bytes'](root), 5)
            refused = mock.Mock(); refused.lstat.side_effect = PermissionError('not a deletion race')
            root.rglob.return_value = [refused]
            with self.assertRaises(PermissionError): namespace['owned_bytes'](root)

    def test_bundle_refuses_real_symlinks_before_uploading_any_data(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            package = root / 'node_modules/playwright-core'; package.mkdir(parents=True)
            (root / 'scripts').mkdir()
            (root / 'scripts/stress-browser-worker.cjs').write_text('synthetic worker')
            (package / 'package.json').write_text('{}')
            with mock.patch.object(generator, 'ROOT', root):
                self.assertEqual(set(generator.browser_files()), {'worker.cjs', 'playwright-core/package.json'})
                secret = root / 'private'; secret.write_text('DO NOT UPLOAD')
                (package / 'linked-file').symlink_to(secret)
                with self.assertRaisesRegex(RuntimeError, 'symlink'):
                    generator.browser_files()

    def test_uncertain_remote_stop_still_closes_only_owned_tunnel_and_retains_receipt(self):
        with tempfile.TemporaryDirectory() as directory:
            owned = generator.MarcoGenerator(directory)
            owned.directory = '/var/tmp/ssh-exam-browser-generator.synthetic'
            owned.rpc = mock.Mock(side_effect=RuntimeError('remote stop unconfirmed'))
            owned.tunnel = mock.Mock(pid=123456, poll=mock.Mock(return_value=None))
            owned.tunnel.wait.return_value = -signal.SIGTERM
            owned.tunnel_log = mock.Mock()
            with mock.patch.object(generator.os, 'killpg') as kill:
                with self.assertRaisesRegex(RuntimeError, 'cleanup unconfirmed'):
                    owned.close()
            kill.assert_called_once_with(123456, signal.SIGTERM)
            owned.tunnel.wait.assert_called_once_with(timeout=10)
            owned.tunnel_log.close.assert_called_once()
            receipt = json.loads((Path(directory) / 'generator-cleanup.json').read_text())
            self.assertIn('cleanup_error', receipt)
            self.assertNotIn('stopped', receipt)

    def test_changed_retired_service_is_a_failed_guard_without_preventing_owned_cleanup(self):
        with tempfile.TemporaryDirectory() as directory:
            owned = generator.MarcoGenerator(directory)
            owned.directory = '/var/tmp/ssh-exam-browser-generator.synthetic'
            owned.rpc = mock.Mock(side_effect=[{'stopped': True, 'web_service_unchanged': False}, {'ports_closed': [9444, 9445]}])
            owned.close()
            self.assertTrue(owned.failure)
            self.assertEqual([call.args[0] for call in owned.rpc.call_args_list], ['stop', 'ports'])
            receipt = json.loads((Path(directory) / 'generator-cleanup.json').read_text())
            self.assertTrue(receipt['stopped'])
            self.assertTrue(receipt['health_failure'])
            self.assertNotIn('cleanup_error', receipt)

    def test_owned_tunnel_timeout_has_bounded_fallback_and_a_cleanup_receipt(self):
        with tempfile.TemporaryDirectory() as directory:
            owned = generator.MarcoGenerator(directory)
            owned.directory = '/var/tmp/ssh-exam-browser-generator.synthetic'
            owned.rpc = mock.Mock(side_effect=[{'stopped': True, 'web_service_unchanged': True}, {'ports_closed': [9444, 9445]}])
            owned.tunnel = mock.Mock(pid=123456, poll=mock.Mock(return_value=None))
            owned.tunnel.wait.side_effect = [subprocess.TimeoutExpired('owned SSH', 10), -signal.SIGKILL]
            owned.tunnel_log = mock.Mock()
            with mock.patch.object(generator.os, 'killpg') as kill:
                owned.close()
            self.assertEqual(kill.call_args_list, [mock.call(123456, signal.SIGTERM), mock.call(123456, signal.SIGKILL)])
            owned.tunnel_log.close.assert_called_once()
            receipt = json.loads((Path(directory) / 'generator-cleanup.json').read_text())
            self.assertTrue(receipt['forced_owned_tunnel_stop'])
            self.assertEqual(receipt['tunnel_exit'], -signal.SIGKILL)
            self.assertNotIn('cleanup_error', receipt)


if __name__ == '__main__':
    unittest.main()
