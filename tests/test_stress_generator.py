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
    def test_rpc_does_not_create_a_persistent_ssh_master(self):
        with tempfile.TemporaryDirectory() as directory:
            owned=generator.MarcoGenerator(directory)
            with mock.patch.object(generator.subprocess,'run',return_value=mock.Mock(returncode=0,stdout='{}')) as run:
                self.assertEqual(owned.rpc('preflight'),{})
            args=run.call_args.args[0]
            self.assertIn('ControlMaster=no',args);self.assertIn('ControlPersist=no',args)
            self.assertEqual(json.loads(run.call_args.kwargs['input']),{'op':'preflight'})

    def test_actual_cgroup_view_requires_the_qualified_finite_budget_and_retains_pressure(self):
        function=next(node for node in ast.parse(generator.RPC).body if isinstance(node,ast.FunctionDef) and node.name=='resource_view')
        namespace={};exec(compile(ast.Module(body=[function],type_ignores=[]),'generator-resource-view','exec'),namespace)
        with tempfile.TemporaryDirectory() as directory:
            group=Path(directory)
            fields={'memory.max':str(21*1024**3),'memory.high':str(21*1024**3),'memory.swap.max':'0','pids.max':'4096','cpu.max':'800000 100000',
                    'memory.events':'low 0\nhigh 13\nmax 0\noom 0\noom_kill 0','memory.pressure':'some avg10=3.14 avg60=2.00 avg300=1.00 total=100',
                    'cpu.stat':'usage_usec 50000\nnr_throttled 2','cpu.pressure':'some avg10=0.50 avg60=0.25 avg300=0.10 total=50','pids.events':'max 0'}
            for name,value in fields.items():(group/name).write_text(value+'\n')
            state={'MemoryMax':str(21*1024**3),'MemoryHigh':str(21*1024**3),'MemorySwapMax':'0','TasksMax':'4096'}
            observe=lambda:namespace['resource_view'](state,group)
            result=observe();self.assertEqual(result['resource_observations']['memory.events'],fields['memory.events']);self.assertEqual(result['resource_observations']['cpu.stat'],fields['cpu.stat'])
            for name,bad in [('memory.high',str(18*1024**3)),('memory.max','max'),('memory.swap.max','1'),('cpu.max','max 100000'),('pids.max','max')]:
                (group/name).write_text(bad)
                with self.assertRaises((AssertionError,ValueError)):observe()
                (group/name).write_text(fields[name])
            state['MemoryHigh']=str(18*1024**3)
            with self.assertRaises(AssertionError):observe()
            state['MemoryHigh']=str(21*1024**3);state['MemoryMax']=str(20*1024**3)
            with self.assertRaises(AssertionError):observe()
            state['MemoryMax']=str(21*1024**3);(group/'memory.events').unlink()
            with self.assertRaises(FileNotFoundError):observe()

    def test_actual_process_limit_view_must_match_declared_private_unit_limits(self):
        import os,re
        function=next(node for node in ast.parse(generator.RPC).body if isinstance(node,ast.FunctionDef) and node.name=='verify_process')
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);process=root/'1001';process.mkdir();owned=root/'worker';owned.mkdir()
            (process/'cmdline').write_bytes(b'/usr/bin/node\0'+str(owned/'worker.cjs').encode()+b'\0')
            (process/'cgroup').write_text('0::/owned\n')
            namespace={'Path':lambda path:root if str(path)=='/proc' else Path(path),'uid':os.getuid(),'re':re}
            exec(compile(ast.Module(body=[function],type_ignores=[]),'actual-process-limit-guard','exec'),namespace)
            limits=process/'limits'
            for suffix in ('', '     ', '\t '):
                limits.write_text('Max open files            524288               524288               files'+suffix+'\nMax core file size        0                    0                    bytes'+suffix+'\n')
                result=namespace['verify_process']({'MainPID':'1001','ControlGroup':'/owned'},owned)
                self.assertEqual(result,{'nofile':[524288,524288],'core':[0,0]})
            limits.write_text('Max open files            1024                 524288               files\nMax core file size        0                    0                    bytes\n')
            with self.assertRaisesRegex(AssertionError,'descriptor'):namespace['verify_process']({'MainPID':'1001','ControlGroup':'/owned'},owned)
            limits.write_text('Max open files            524288               524288               files\nMax core file size        unlimited            unlimited            bytes\n')
            with self.assertRaisesRegex(AssertionError,'core'):namespace['verify_process']({'MainPID':'1001','ControlGroup':'/owned'},owned)

    def test_network_guard_requires_current_owned_pids_and_a_closed_private_link(self):
        function = next(node for node in ast.parse(generator.RPC).body
                        if isinstance(node, ast.FunctionDef) and node.name == 'verify_network')
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            for pid in (1001,1002):
                p=root/str(pid);(p/'net').mkdir(parents=True)
                (p/'cgroup').write_text('0::/owned\n')
                (p/'net/dev').write_text('header\nheader\nlo: 0\nexam-test0: 0\nexam-test1: 0\n')
                (p/'net/route').write_text('header\nexam-test0 00000000 020200C0 0003\n')
            import os,re
            current={'1001':'net:[2]','1002':'net:[2]'}
            def readlink(path):
                return 'net:[1]' if str(path)=='/proc/self/ns/net' else current[Path(path).parts[-3]]
            namespace={'Path':lambda path:root if str(path)=='/proc' else Path(path),
                       'os':mock.Mock(readlink=readlink),'uid':os.getuid(),'re':re}
            exec(compile(ast.Module(body=[function],type_ignores=[]),'network-guard','exec'),namespace)
            identity={'host_network_namespace':'net:[1]','browser_network_namespace':'net:[2]',
                      'namespace_node_pid':1001,'browser_pid':1002}
            state={'ControlGroup':'/owned'}
            namespace['verify_network'](identity,state)
            current['1002']='net:[1]'
            with self.assertRaises(AssertionError):namespace['verify_network'](identity,state)
            current['1002']='net:[2]';(root/'1001/net/dev').write_text('header\nheader\nlo: 0\neth0: 0\n')
            with self.assertRaises(AssertionError):namespace['verify_network'](identity,state)
            (root/'1001/net/dev').write_text('header\nheader\nlo: 0\nexam-test0: 0\nexam-test1: 0\n')
            (root/'1001/net/route').write_text('header\neth0 00000000 0100000A 0003\n')
            with self.assertRaises(AssertionError):namespace['verify_network'](identity,state)
            (root/'1001/net/route').write_text('header\nexam-test0 00000000 020200C0 0003\n');(root/'1002/cgroup').write_text('0::/unrelated\n')
            with self.assertRaises(AssertionError):namespace['verify_network'](identity,state)

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
