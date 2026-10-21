"""Runner safety contracts; real guest results are recorded separately."""
import importlib.util
import json
from pathlib import Path
import tempfile
import fcntl
import os
import types
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location('overlay', Path(__file__).with_name('overlay_qualification.py'))
overlay = importlib.util.module_from_spec(spec)
spec.loader.exec_module(overlay)


class OverlayTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def state(self, attempt):
        (self.root / 'state.json').write_text(json.dumps({'attempts': {'synthetic': attempt}}))
        return {'state': str(self.root)}

    def test_bounded_json_refuses_large_input(self):
        path = self.root / 'metadata'
        path.write_text('{} ' * 100)
        with self.assertRaisesRegex(RuntimeError, 'bounds'):
            overlay.bounded_json(path, 8)

    def test_symlink_parent_is_not_a_private_guest(self):
        (self.root / 'real').mkdir()
        (self.root / 'link').symlink_to('real', target_is_directory=True)
        with self.assertRaisesRegex(RuntimeError, 'symlink'):
            overlay.private_directory(self.root / 'link')

    def test_concurrent_guest_runner_is_refused_without_base_writes(self):
        descriptor = os.open(self.root, os.O_RDONLY | os.O_DIRECTORY)
        self.addCleanup(os.close, descriptor)
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with mock.patch.object(overlay.os, 'getuid', return_value=0), mock.patch.object(overlay.os, 'geteuid', return_value=0), mock.patch.object(overlay, 'run_locked') as body:
            with self.assertRaises(BlockingIOError):
                overlay.run(types.SimpleNamespace(guest=self.root))
            body.assert_not_called()
        self.assertEqual(list(self.root.iterdir()), [])

    def test_authority_refuses_live_and_unresolved_attempts(self):
        for attempt in ({'state': 'ACTIVE'}, {'state': 'PREPARING'},
                        {'state': 'COMPLETED', 'access_state': 'HELD'},
                        {'state': 'COMPLETED', 'policy_state': 'RESTORE_FAILED'}):
            with self.subTest(attempt=attempt), self.assertRaisesRegex(RuntimeError, 'live/unresolved'):
                overlay.authority(self.state(attempt))

    def test_preservation_tracks_authority_not_background_delivery_timestamps(self):
        attempt = {'state': 'COMPLETED', 'deadline': 1234, 'original_deadline': 5678,
                   'checksum': 'protected', 'settings': {'duration': 60}}
        original = overlay.authority(self.state(attempt))
        self.assertEqual(original, overlay.authority(self.state({**attempt, 'callback_at': 999})))
        self.assertNotEqual(original, overlay.authority(self.state({**attempt, 'deadline': 999})))

    def test_command_is_volatile_private_and_bounded_without_host_network(self):
        self.assertEqual(overlay.FILES['exam-login'][1], 0o755)
        command = overlay.candidate_command('ssh-exam-qualification-test.service',
                                            self.root / 'guest', self.root / 'in', self.root / 'out')
        for flag in ('--volatile=overlay', '--read-only', '--private-network',
                     '--settings=no', '--register=no', '--keep-unit',
                     '--property=MemoryMax=1G', '--property=MemorySwapMax=0',
                     '--property=CPUQuota=50%', '--property=RuntimeMaxSec=900',
                     '--property=KillMode=control-group', '--property=Delegate=yes',
                     '--system-call-filter=adjtimex clock_adjtime', '--drop-capability=CAP_SYS_TIME'):
            self.assertIn(flag, command)
        writable = [arg for arg in command if arg.startswith('--bind=')]
        self.assertEqual(writable, ['--bind=' + str(self.root / 'out') + ':/run/ssh-exam-qualification-output'])
        self.assertNotIn('--network-veth', command)
        self.assertNotIn('--template', command)
        self.assertNotIn('/bin/sh', command)
        self.assertIn('--bind-ro=' + str(self.root / 'in' / 'exam-agent') + ':/usr/local/sbin/exam-agent', command)


if __name__ == '__main__':
    unittest.main()
