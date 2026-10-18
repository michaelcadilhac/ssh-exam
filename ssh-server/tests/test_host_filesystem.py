import importlib.machinery
import importlib.util
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

loader = importlib.machinery.SourceFileLoader('host_fs_install', str(Path(__file__).resolve().parents[1] / 'scripts/install-host-filesystem'))
spec = importlib.util.spec_from_loader(loader.name, loader)
m = importlib.util.module_from_spec(spec)
loader.exec_module(m)


class HostFilesystemInstallTests(unittest.TestCase):
    def test_never_interrupts_attempts_or_restores_accounts_early(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory)
            policy = state / 'account-policy'
            policy.mkdir()
            with patch.object(m, 'Path', return_value=SimpleNamespace(glob=lambda _: iter([]))):
                for status in ['PREPARING', 'ACTIVATING', 'ACTIVE', 'LOCKED', 'FINALIZING', 'COLLECTION_FAILED']:
                    (state / 'state.json').write_text(json.dumps({'attempts': {'a': {'id': 'a', 'state': status}}}))
                    with self.subTest(status=status), self.assertRaises(ValueError):
                        m.drained(state)
                attempt = {'id': 'a', 'state': 'COMPLETED', 'start': 100, 'access_state': 'HELD'}
                (state / 'state.json').write_text(json.dumps({'attempts': {'a': attempt}}))
                with self.assertRaises(ValueError):
                    m.drained(state)
                attempt['access_state'] = 'RELEASED'
                (state / 'state.json').write_text(json.dumps({'attempts': {'a': attempt}}))
                (policy / '1001.json').write_text('{"phase":"RESTRICTED"}')
                with self.assertRaises(ValueError):
                    m.drained(state)
                (policy / '1001.json').write_text('{"phase":"NORMAL"}')
                self.assertEqual(m.drained(state)[0][0], 'a')

    def test_socket_inventory_excludes_runtime_not_programs(self):
        table = ('1: 2 0 10000 1 01 1 /run/systemd/private\n'
                 '2: 2 0 10000 1 01 2 /tmp/ssh-agent/socket\n'
                 '3: 2 0 10000 1 01 3 /var/lib/service/pipes/control.sock\n')
        actual_path = Path
        def paths(name):
            return SimpleNamespace(read_text=lambda: table) if name == '/proc/net/unix' else actual_path(name)
        with patch.object(m, 'Path', side_effect=paths):
            self.assertEqual(m.socket_directories(), {'/var/lib/service/pipes'})
            table += '4: 2 0 10000 1 01 4 /usr/bin/unexpected.sock\n'
            with self.assertRaisesRegex(ValueError, 'unexpected host service'):
                m.socket_directories()


if __name__ == '__main__':
    unittest.main()
