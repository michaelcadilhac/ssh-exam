#!/usr/bin/env python3
"""Exercise the backup cleanup CLI against private synthetic archives."""
import hashlib
import io
import json
from pathlib import Path
import runpy
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/compact-release-backups'
PREFIX = 'app/data'


class CompactionTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.keep = self.root / 'ssh-exam-backup-new'
        self.old = self.root / 'ssh-exam-backup-old'
        self.make(self.keep, {PREFIX + '/monitoring/shared.jpg': b'authored screenshot',
                              PREFIX + '/metadata.sqlite': b'new synthetic database'})
        self.make(self.old, {PREFIX + '/monitoring/shared.jpg': b'authored screenshot',
                             PREFIX + '/monitoring/unique.jpg': b'old unique screenshot',
                             PREFIX + '/metadata.sqlite': b'old synthetic database',
                             'config/example.json': b'old synthetic configuration'})
        self.keep_bytes = (self.keep / 'web-data-config-before.tar').read_bytes()

    def tearDown(self):
        self.temp.cleanup()

    def make(self, directory, files):
        directory.mkdir(mode=0o700)
        archive = directory / 'web-data-config-before.tar'
        with tarfile.open(archive, 'w') as out:
            for name, contents in files.items():
                member = tarfile.TarInfo(name)
                member.size = len(contents)
                member.mode = 0o600
                out.addfile(member, io.BytesIO(contents))
        (directory / 'backup.json').write_text(json.dumps({'archive_sha256': hashlib.sha256(archive.read_bytes()).hexdigest()}))

    def run_cli(self, apply=True):
        args = [sys.executable, str(SCRIPT), '--root', str(self.root), '--keep', str(self.keep), '--data-prefix', PREFIX]
        if apply:
            args.append('--apply')
        return subprocess.run(args, capture_output=True, text=True, timeout=15)

    def test_cli_preserves_verified_baseline_unique_payloads_and_old_configuration(self):
        result = self.run_cli()
        self.assertEqual(result.returncode, 0, result.stderr)
        receipt = json.loads(result.stdout)
        self.assertEqual(receipt['phase'], 'COMPACTED')
        self.assertEqual(receipt['results'][0]['shared_monitoring_files'], 1)
        self.assertFalse(receipt['live_data_opened_or_changed'])
        self.assertEqual((self.keep / 'web-data-config-before.tar').read_bytes(), self.keep_bytes)
        self.assertFalse((self.old / 'web-data-config-before.tar').exists())
        with tarfile.open(self.old / 'configuration-and-unique-data.tar') as archive:
            self.assertNotIn(PREFIX + '/monitoring/shared.jpg', archive.getnames())
            self.assertEqual(archive.extractfile(PREFIX + '/monitoring/unique.jpg').read(), b'old unique screenshot')
            self.assertEqual(archive.extractfile(PREFIX + '/metadata.sqlite').read(), b'old synthetic database')
            self.assertEqual(archive.extractfile('config/example.json').read(), b'old synthetic configuration')
        again = self.run_cli()
        self.assertEqual(again.returncode, 0, again.stderr)
        self.assertEqual(json.loads(again.stdout)['results'], [])

    def test_preview_removes_nothing(self):
        result = self.run_cli(False)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue((self.old / 'web-data-config-before.tar').is_file())
        self.assertFalse((self.old / 'configuration-and-unique-data.tar').exists())

    def test_corrupt_retained_archive_refuses_before_any_deletion(self):
        with (self.keep / 'web-data-config-before.tar').open('ab') as out:
            out.write(b'corrupt trailer')
        result = self.run_cli()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Retained full backup failed', result.stderr)
        self.assertTrue((self.old / 'web-data-config-before.tar').is_file())

    def test_corrupt_older_archive_preserves_original(self):
        with (self.old / 'web-data-config-before.tar').open('ab') as out:
            out.write(b'corrupt trailer')
        result = self.run_cli()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Older archive failed', result.stderr)
        self.assertTrue((self.old / 'web-data-config-before.tar').is_file())
        self.assertFalse((self.old / 'configuration-and-unique-data.tar').exists())

    def test_crash_after_durable_replacement_has_verified_retry(self):
        compact = runpy.run_path(str(SCRIPT))['compact']
        unlink = Path.unlink
        original = self.old / 'web-data-config-before.tar'
        def crash(path, *args, **kwargs):
            if path == original:
                raise OSError('synthetic interrupted deletion')
            return unlink(path, *args, **kwargs)
        with patch.object(Path, 'unlink', crash):
            with self.assertRaisesRegex(OSError, 'synthetic interrupted deletion'):
                compact(self.root, self.keep, PREFIX, True)
        self.assertTrue(original.is_file())
        self.assertTrue((self.old / 'compaction.json').is_file())
        retry = self.run_cli()
        self.assertEqual(retry.returncode, 0, retry.stderr)
        self.assertTrue(json.loads(retry.stdout)['results'][0]['retry_completed'])
        self.assertFalse(original.exists())

    def test_symlink_backup_directory_is_refused(self):
        link = self.root / 'ssh-exam-backup-linked'
        link.symlink_to(self.old, target_is_directory=True)
        result = self.run_cli()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('private and owned', result.stderr)
        self.assertTrue((self.old / 'web-data-config-before.tar').is_file())

    def test_completed_receipt_cannot_hide_corrupt_replacement(self):
        result = self.run_cli()
        self.assertEqual(result.returncode, 0, result.stderr)
        with (self.old / 'configuration-and-unique-data.tar').open('ab') as out:
            out.write(b'synthetic post-compaction corruption')
        result = self.run_cli()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Completed compaction replacement does not verify', result.stderr)


if __name__ == '__main__':
    unittest.main()
