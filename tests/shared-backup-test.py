#!/usr/bin/env python3
"""Actual backup/restore CLI regressions using synthetic monitoring and history."""
import json
from contextlib import closing
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class SharedBackupTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.source = self.root / 'live'
        self.source.mkdir(mode=0o700)
        (self.source / 'monitoring/kept').mkdir(parents=True)
        (self.source / 'monitoring/deleted').mkdir(parents=True)
        (self.source / 'monitoring/kept/a.jpg').write_bytes(b'authored retained synthetic image' * 1000)
        (self.source / 'monitoring/deleted/b.jpg').write_bytes(b'authored deleted synthetic image')
        (self.source / 'receipts').mkdir()
        (self.source / 'receipts/receipt.json').write_text('{"synthetic":true}')
        with closing(sqlite3.connect(self.source / 'metadata.sqlite')) as db:
            db.executescript("""
             CREATE TABLE attempts(id TEXT PRIMARY KEY,state TEXT,reason TEXT,ended INTEGER,export_status TEXT);
             INSERT INTO attempts VALUES('kept','ACTIVE',NULL,NULL,NULL);
             INSERT INTO attempts VALUES('deleted','ENDED',NULL,NULL,NULL);
             CREATE TABLE tombstones(attempt TEXT PRIMARY KEY,deleted INTEGER);
             CREATE TABLE audit(target TEXT,action TEXT);
             CREATE TABLE frames(attempt TEXT);
             INSERT INTO frames VALUES('kept'),('deleted');
             CREATE TABLE recordings(attempt TEXT);
             CREATE TABLE incidents(attempt TEXT,events TEXT,message TEXT);
             CREATE TABLE sessions(id TEXT);
             INSERT INTO sessions VALUES('synthetic-old-session');
            """)
        self.backups = self.root / 'backups'
        self.first = self.backups / 'first'
        self.second = self.backups / 'second'

    def tearDown(self):
        self.temp.cleanup()

    def cli(self, script, *args):
        return subprocess.run([sys.executable, str(ROOT / 'scripts' / script), *map(str, args)], capture_output=True, text=True, timeout=20)

    def create(self, target):
        result = self.cli('backup', self.source, target, '--gateway-stopped')
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_second_snapshot_reuses_media_without_copying_or_linking_live_data(self):
        first = self.create(self.first)
        second = self.create(self.second)
        self.assertEqual(first['new_monitoring_objects'], 2)
        self.assertEqual(second['new_monitoring_objects'], 0)
        self.assertGreater(second['reused_monitoring_bytes'], 0)
        relative = 'monitoring/kept/a.jpg'
        self.assertEqual((self.first / relative).stat().st_ino, (self.second / relative).stat().st_ino)
        self.assertNotEqual((self.source / relative).stat().st_ino, (self.first / relative).stat().st_ino)
        self.assertEqual((self.source / relative).stat().st_nlink, 1)
        self.assertEqual(self.cli('backup', '--verify-backup', self.second).returncode, 0)

    def test_changed_live_file_creates_one_object_and_keeps_previous_snapshot_exact(self):
        self.create(self.first)
        previous = (self.first / 'monitoring/kept/a.jpg').read_bytes()
        (self.source / 'monitoring/kept/a.jpg').write_bytes(b'new authored image')
        second = self.create(self.second)
        self.assertEqual(second['new_monitoring_objects'], 1)
        self.assertEqual((self.first / 'monitoring/kept/a.jpg').read_bytes(), previous)
        self.assertEqual((self.second / 'monitoring/kept/a.jpg').read_bytes(), b'new authored image')

    def test_codec_copy_scratch_is_excluded_but_other_directories_and_clips_are_preserved(self):
        leaf = '.video-work-00000000-0000-4000-8000-000000000001'
        scratch = self.source / 'monitoring/kept' / leaf
        scratch.mkdir()
        (scratch / 'duplicate.jpg').write_bytes(b'transient copied input')
        (self.source / 'monitoring/kept/verified.webm').write_bytes(b'authored durable clip')
        unknown = self.source / 'monitoring/kept/.video-work-not-a-uuid'
        unknown.mkdir()
        (unknown / 'preserved').write_bytes(b'unknown preserved bytes')
        nested = self.source / 'monitoring/kept/history' / leaf
        nested.mkdir(parents=True)
        (nested / 'preserved').write_bytes(b'non-reserved nested bytes')
        (self.source / 'monitoring-video-deploy.pause').write_text('installation-only marker')
        store = self.backups / '.ssh-exam-media-objects'
        warm = self.cli('backup', '--warm-media', self.source, '--shared-store', store)
        self.assertEqual(warm.returncode, 0, warm.stderr)
        result = self.cli('backup', self.source, self.first, '--gateway-stopped', '--require-warmed')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)['new_monitoring_objects'], 0)
        self.assertFalse((self.first / 'monitoring/kept' / leaf).exists())
        self.assertFalse((self.first / 'monitoring-video-deploy.pause').exists())
        self.assertEqual((self.first / 'monitoring/kept/verified.webm').read_bytes(), b'authored durable clip')
        self.assertTrue((self.first / unknown.relative_to(self.source) / 'preserved').is_file())
        self.assertTrue((self.first / nested.relative_to(self.source) / 'preserved').is_file())
        self.assertEqual(self.cli('backup', '--verify-backup', self.first).returncode, 0)
        # A matching name never exempts a symlink from the safety check.
        import shutil
        shutil.rmtree(scratch)
        scratch.symlink_to(unknown, target_is_directory=True)
        refused = self.cli('backup', self.source, self.second, '--gateway-stopped')
        self.assertNotEqual(refused.returncode, 0)
        self.assertIn('symlinks', refused.stderr)

    def test_restore_applies_latest_deletion_to_video_rows_and_files_without_losing_request_audit(self):
        with closing(sqlite3.connect(self.source / 'metadata.sqlite')) as db:
            db.executescript("""
             CREATE TABLE monitoring_video_segments(id TEXT PRIMARY KEY,attempt TEXT);
             INSERT INTO monitoring_video_segments VALUES('kept-segment','kept'),('deleted-segment','deleted');
             CREATE TABLE monitoring_video_frames(frame TEXT,segment TEXT);
             INSERT INTO monitoring_video_frames VALUES('kept-frame','kept-segment'),('deleted-frame','deleted-segment');
             CREATE TABLE monitoring_video_jobs(attempt TEXT,status TEXT,owner TEXT,error TEXT,updated INTEGER);
             INSERT INTO monitoring_video_jobs VALUES('kept','complete',NULL,NULL,1),('deleted','retry','stale-owner','old error',1);
             CREATE TABLE monitoring_video_requests(id TEXT,attempt TEXT);
             INSERT INTO monitoring_video_requests VALUES('historical-request','deleted');
            """)
        (self.source / 'monitoring/kept/kept-segment.webm').write_bytes(b'kept synthetic clip')
        (self.source / 'monitoring/deleted/deleted-segment.webm').write_bytes(b'deleted synthetic clip')
        self.create(self.first)
        ledger = self.root / 'latest.sqlite'
        with closing(sqlite3.connect(ledger)) as db:
            db.executescript("CREATE TABLE tombstones(attempt TEXT,deleted INTEGER); INSERT INTO tombstones VALUES('deleted',1); CREATE TABLE audit(target TEXT,action TEXT);")
        restored = self.root / 'restored'
        result = self.cli('restore', self.first, restored, '--gateway-stopped', '--deletion-ledger', ledger)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse((restored / 'monitoring/deleted').exists())
        self.assertEqual((restored / 'monitoring/kept/kept-segment.webm').read_bytes(), b'kept synthetic clip')
        with closing(sqlite3.connect(restored / 'metadata.sqlite')) as db:
            self.assertEqual(db.execute('SELECT id FROM monitoring_video_segments').fetchall(), [('kept-segment',)])
            self.assertEqual(db.execute('SELECT frame FROM monitoring_video_frames').fetchall(), [('kept-frame',)])
            self.assertEqual(db.execute("SELECT status,owner,error FROM monitoring_video_jobs WHERE attempt='deleted'").fetchone(), ('deleted',None,None))
            self.assertEqual(db.execute('SELECT id FROM monitoring_video_requests').fetchall(), [('historical-request',)])

    def test_actual_restore_detaches_files_merges_deletions_and_locks_active_history(self):
        self.create(self.first)
        ledger = self.root / 'latest.sqlite'
        with closing(sqlite3.connect(ledger)) as db:
            db.executescript("CREATE TABLE tombstones(attempt TEXT,deleted INTEGER); INSERT INTO tombstones VALUES('deleted',1); CREATE TABLE audit(target TEXT,action TEXT);")
        destination = self.root / 'restored'
        result = self.cli('restore', self.first, destination, '--gateway-stopped', '--deletion-ledger', ledger)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse((destination / 'monitoring/deleted').exists())
        self.assertTrue((destination / 'monitoring/kept/a.jpg').is_file())
        self.assertEqual((destination / 'monitoring/kept/a.jpg').stat().st_nlink, 1)
        with closing(sqlite3.connect(destination / 'metadata.sqlite')) as db:
            self.assertEqual(db.execute("SELECT state FROM attempts WHERE id='kept'").fetchone()[0], 'LOCKED')
            self.assertEqual(db.execute('SELECT count(*) FROM sessions').fetchone()[0], 0)
            self.assertEqual(db.execute("SELECT count(*) FROM frames WHERE attempt='deleted'").fetchone()[0], 0)

    def test_corrupt_shared_object_refuses_new_snapshot_and_restore(self):
        self.create(self.first)
        (self.first / 'monitoring/kept/a.jpg').write_bytes(b'corrupt synthetic backup')
        result = self.cli('backup', self.source, self.second, '--gateway-stopped')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Shared object changed', result.stderr)
        self.assertFalse(self.second.exists())
        self.assertEqual(list(self.backups.glob('.incomplete-backup-*')), [])
        result = self.cli('backup', '--verify-backup', self.first)
        self.assertNotEqual(result.returncode, 0)
        destination = self.root / 'restored'
        result = self.cli('restore', self.first, destination, '--gateway-stopped', '--deletion-ledger', self.source / 'metadata.sqlite')
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(destination.exists())

    def test_symlink_source_refuses_without_publishing_snapshot(self):
        (self.source / 'monitoring/kept/unsafe.jpg').symlink_to(self.source / 'metadata.sqlite')
        result = self.cli('backup', self.source, self.first, '--gateway-stopped')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('non-regular', result.stderr)
        self.assertFalse(self.first.exists())

    def test_stopped_attestation_and_new_destination_are_required(self):
        result = self.cli('backup', self.source, self.first)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('--gateway-stopped', result.stderr)
        self.create(self.first)
        result = self.cli('backup', self.source, self.first, '--gateway-stopped')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('New snapshot', result.stderr)

    def test_unlisted_snapshot_file_is_refused(self):
        self.create(self.first)
        (self.first / 'unexpected').write_text('synthetic unknown file')
        result = self.cli('backup', '--verify-backup', self.first)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('membership', result.stderr)

    def test_online_warm_does_not_open_locked_database_or_publish_snapshot(self):
        store = self.backups / '.ssh-exam-media-objects'
        with closing(sqlite3.connect(self.source / 'metadata.sqlite')) as locked:
            locked.execute('BEGIN EXCLUSIVE')
            result = self.cli('backup', '--warm-media', self.source, '--shared-store', store)
        self.assertEqual(result.returncode, 0, result.stderr)
        receipt = json.loads(result.stdout)
        self.assertEqual(receipt['phase'], 'MEDIA_WARMED')
        self.assertFalse(receipt['database_opened'])
        self.assertFalse(receipt['complete_snapshot_created'])
        self.assertEqual(list(self.backups.glob('*/snapshot.json')), [])
        snapshot = self.create(self.first)
        self.assertEqual(snapshot['new_monitoring_objects'], 0)

    def test_production_wal_database_copies_committed_wal_without_transient_snapshot_files(self):
        db = sqlite3.connect(self.source / 'metadata.sqlite')
        try:
            self.assertEqual(db.execute('PRAGMA journal_mode=WAL').fetchone()[0], 'wal')
            db.execute("UPDATE attempts SET reason='committed only through WAL' WHERE id='kept'")
            db.commit()
            self.assertTrue((self.source / 'metadata.sqlite-wal').is_file())
            self.create(self.first)
            self.assertFalse((self.first / 'metadata.sqlite-wal').exists())
            self.assertFalse((self.first / 'metadata.sqlite-shm').exists())
            result = self.cli('backup', '--verify-backup', self.first)
            self.assertEqual(result.returncode, 0, result.stderr)
            restored = sqlite3.connect(self.first / 'metadata.sqlite')
            try:
                self.assertEqual(restored.execute("SELECT reason FROM attempts WHERE id='kept'").fetchone()[0], 'committed only through WAL')
            finally:
                restored.close()
        finally:
            db.close()

    def test_pruning_removes_only_objects_without_snapshot_links(self):
        import shutil
        self.create(self.first)
        self.create(self.second)
        store = self.backups / '.ssh-exam-media-objects'
        preview = self.cli('backup', '--prune-unused-objects', store)
        self.assertEqual(preview.returncode, 0, preview.stderr)
        self.assertEqual(json.loads(preview.stdout)['objects'], 0)
        shutil.rmtree(self.first)
        protected = self.cli('backup', '--prune-unused-objects', store, '--apply-prune')
        self.assertEqual(protected.returncode, 0, protected.stderr)
        self.assertEqual(json.loads(protected.stdout)['objects'], 0)
        self.assertEqual(self.cli('backup', '--verify-backup', self.second).returncode, 0)
        shutil.rmtree(self.second)
        removed = self.cli('backup', '--prune-unused-objects', store, '--apply-prune')
        self.assertEqual(removed.returncode, 0, removed.stderr)
        self.assertEqual(json.loads(removed.stdout)['objects'], 2)
        self.assertFalse(json.loads(removed.stdout)['referenced_snapshot_objects_removed'])
        retry = self.create(self.first)
        self.assertEqual(retry['new_monitoring_objects'], 2)

    def test_interrupted_prune_with_stale_cache_recopies_objects_on_retry(self):
        import runpy
        import shutil
        from unittest.mock import patch
        (self.source / 'monitoring/kept/duplicate.jpg').write_bytes((self.source / 'monitoring/kept/a.jpg').read_bytes())
        self.create(self.first)
        shutil.rmtree(self.first)
        store = self.backups / '.ssh-exam-media-objects'
        functions = runpy.run_path(str(ROOT / 'scripts/shared_backup.py'))
        prune = functions['prune_unused_objects']
        with patch.dict(prune.__globals__, {'atomic_json': lambda *args: (_ for _ in ()).throw(OSError('synthetic crash before cache update'))}):
            with self.assertRaisesRegex(OSError, 'synthetic crash'):
                prune(store, True)
        result = self.create(self.second)
        self.assertEqual(result['new_monitoring_objects'], 2)
        self.assertGreater(result['reused_monitoring_bytes'], 0)
        self.assertEqual(self.cli('backup', '--verify-backup', self.second).returncode, 0)

    def test_fast_snapshot_refuses_unwarmed_or_pruned_media_without_copying_it(self):
        store = self.backups / '.ssh-exam-media-objects'
        refused = self.cli('backup', self.source, self.first, '--gateway-stopped', '--require-warmed')
        self.assertNotEqual(refused.returncode, 0)
        self.assertIn('not warmed', refused.stderr)
        self.assertFalse(self.first.exists())
        warm = self.cli('backup', '--warm-media', self.source, '--shared-store', store)
        self.assertEqual(warm.returncode, 0, warm.stderr)
        pruned = self.cli('backup', '--prune-unused-objects', store, '--apply-prune')
        self.assertEqual(pruned.returncode, 0, pruned.stderr)
        refused = self.cli('backup', self.source, self.first, '--gateway-stopped', '--require-warmed')
        self.assertNotEqual(refused.returncode, 0)
        self.assertIn('not warmed', refused.stderr)
        self.assertFalse(self.first.exists())
        self.assertEqual(list(store.glob('[0-9a-f][0-9a-f]/*')), [])
        warm = self.cli('backup', '--warm-media', self.source, '--shared-store', store)
        self.assertEqual(warm.returncode, 0, warm.stderr)
        ready = self.cli('backup', self.source, self.first, '--gateway-stopped', '--require-warmed')
        self.assertEqual(ready.returncode, 0, ready.stderr)
        receipt = json.loads(ready.stdout)
        self.assertEqual(receipt['new_monitoring_objects'], 0)
        self.assertEqual(receipt['copied_bytes_excluding_database'], len(b'{"synthetic":true}'))


if __name__ == '__main__':
    unittest.main()
