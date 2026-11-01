#!/usr/bin/env python3
"""Actual runner/backup/SQLite/renderer tests; privileged host boundaries are mocked.

No Docker/systemd/native-host qualification is claimed. Real nginx/TLS/Chromium
routing is tested independently by nginx-maintenance-smoke.py. Tests call main(),
the same CLI dispatcher used by operators, and actual backup subprocesses.
"""
from contextlib import contextmanager, redirect_stderr, redirect_stdout
import hashlib
from importlib.machinery import SourceFileLoader
import importlib.util
import io
import json
import os
from pathlib import Path
import runpy
import sqlite3
import sys
import tarfile
import tempfile
import time
import unittest
from unittest.mock import patch
import urllib.error
from email.message import Message

REPOSITORY = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPOSITORY/'scripts'))
loader = SourceFileLoader('deploy_web_ui', str(REPOSITORY/'scripts/deploy-web-ui'))
spec = importlib.util.spec_from_loader(loader.name, loader)
deploy = importlib.util.module_from_spec(spec); loader.exec_module(deploy)
REAL_COMMAND = deploy.command


@contextmanager
def database_file(path):
    connection = sqlite3.connect(path)
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def archive(path, label):
    raw = json.dumps({'rootfs': {'diff_ids': ['sha256:'+hashlib.sha256(label.encode()).hexdigest()]}}, separators=(',', ':')).encode()
    identity = 'sha256:'+hashlib.sha256(raw).hexdigest()
    tag = 'synthetic-ui:'+label
    with tarfile.open(path, 'w') as target:
        for name, data in [('config.json', raw), ('manifest.json', json.dumps([{'Config': 'config.json', 'RepoTags': [tag], 'Layers': []}]).encode())]:
            member = tarfile.TarInfo(name); member.size = len(data); target.addfile(member, io.BytesIO(data))
    return {'config_id': identity, 'id': identity, 'tag': tag, 'layers': json.loads(raw)['rootfs']['diff_ids']}


class Response(io.BytesIO):
    status = 200
    def __enter__(self): return self
    def __exit__(self, *unused): self.close()


class FastUI(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='web-ui-synthetic-')
        self.root = Path(self.temporary.name); self.root.chmod(0o700)
        self.project = self.root/'project'; self.data = self.project/'var/production'
        (self.data/'monitoring').mkdir(parents=True)
        (self.data/'receipts').mkdir(); (self.data/'submissions').mkdir()
        for number in range(128):
            (self.data/'monitoring'/f'{number}.jpg').write_bytes(number.to_bytes(4, 'big')+b'x'*65532)
        (self.data/'receipts/source.json').write_text('{"synthetic":true}')
        (self.data/'submissions/protected.tar').write_bytes(b'protected historical submission')
        for name in ('config', 'trust', 'secrets'):
            (self.project/'deploy'/name).mkdir(parents=True)
        self.config = self.project/'deploy/config/config.json'
        self.config.write_text(json.dumps({'agent': {'id': 'class'}, 'origin': 'https://synthetic.invalid'}))
        (self.project/'deploy/trust/public').write_text('synthetic public key')
        (self.project/'deploy/secrets/private').write_text('synthetic private fixture only')
        (self.project/'compose.yaml').write_text('services: {}')
        (self.project/'docker-compose.yml').symlink_to('compose.yaml')
        self.unit = self.root/'unit'; self.unit.write_text('synthetic service')
        self.dropin = self.root/'dropin.conf'; self.dropin.write_text('synthetic drop-in')
        self.environment = self.root/'environment'; self.environment.write_text('KEEP=value\nEXAM_IMAGE=synthetic-ui:old\n')
        self.site = self.root/'site'; self.site.write_text('original synthetic site')
        self.nginx_main = self.root/'nginx-main'; self.nginx_main.write_text('original main config')
        for path in (self.unit, self.dropin, self.environment, self.site, self.nginx_main): path.chmod(0o600)
        self.bundle = self.root/'bundle'; self.bundle.mkdir(mode=0o700)
        self.state = self.root/'state'; self.store = self.root/'store'
        self.old_archive = self.root/'old.tar'
        self.old = archive(self.old_archive, 'old'); self.new = archive(self.bundle/'web-image.tar', 'new')
        self.asset_bodies = {image['config_id']: {name: (image['tag']+name).encode() for name in (
            'dist/web/index.html', 'dist/web/assets/app.js', 'dist/web/assets/app.css',
            'dist/web/assets/worker.js', 'dist/web/ssh/client.wasm', 'dist/web/ssh/wasm_exec.js')}
            for image in (self.old, self.new)}
        self.old_assets = self.root/'old-assets.json'
        self.old_assets.write_text(json.dumps(self.assets(self.old)))
        (self.bundle/'image-assets.json').write_text(json.dumps(self.assets(self.new)))
        self.release = {'revision': 'synthetic-new', 'schema': 36, 'old_schema': 36,
            'old_image_config_id': self.old['config_id'], 'image_config_id': self.new['config_id'],
            'old_cli_sha256': 'c'*64, 'cli_sha256': 'c'*64, 'worker_cli_sha256': 'd'*64,
            'native_history_sha256': 'a'*64, 'native_config_sha256': 'b'*64, 'cli_config_sha256': 'e'*64,
            'service_pids': {'exam-agent.service': 1, 'exam-deadline-watchdog.service': 2, 'exam-source-setup.service': 3, 'exam-ssh-relay.service': 4},
            'fast_ui': {'project': str(self.project), 'data': str(self.data), 'environment': str(self.environment),
                'nginx_site': str(self.site), 'nginx_main': str(self.nginx_main), 'shared_store': str(self.store),
                'previous_image_archive': str(self.old_archive), 'previous_image_assets': str(self.old_assets),
                'image_archive_sha256': deploy.digest(self.bundle/'web-image.tar'),
                'previous_image_archive_sha256': deploy.digest(self.old_archive),
                'native_guard': ['/synthetic/read-only-native-guard'], 'unchanged_backend_protocol_native': True}}
        (self.bundle/'release.json').write_text(json.dumps(self.release))
        with database_file(self.data/'metadata.sqlite') as db:
            db.execute('PRAGMA foreign_keys=OFF')
            for file in sorted((REPOSITORY/'migrations').iterdir()):
                if file.suffix == '.sql' and file.stem.isdigit() and int(file.stem) <= 36: db.executescript(file.read_text())
            settings = {'id': 'synthetic', 'name': 'Synthetic', 'template': 'sample', 'template_version': 'f'*64,
                        'earliest': 1, 'latest': 10, 'duration': 300, 'webcam': False, 'terminals': 4}
            db.execute('INSERT INTO exams VALUES(?,?)', ('synthetic', json.dumps(settings)))
            db.execute("INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline,ended,protected,access_state,policy_state,checksum) VALUES('history','synthetic','synthetic-student',10001,'COMPLETED',?,1,10,10,10,1,'RELEASED','NORMAL',?)", (json.dumps(settings), 'f'*64))
            db.execute("INSERT INTO attempt_grants(id,agent,exam,username,revision,status,issued_at,actor,reason,issuance) VALUES('unused','class','synthetic','synthetic-student',1,'AVAILABLE',1,'instructor','fixture','ADDITIONAL_TEMPLATE')")
            db.execute('INSERT INTO grant_revisions VALUES(?,1,?,?,?,?,?,?)', ('unused', json.dumps(settings), json.dumps({'kind':'template','name':'sample','hash':'f'*64}), 'f'*64, 'instructor', 'fixture', 1))
            db.execute('INSERT INTO agent_snapshot VALUES(?,?,?)', ('class', 1, json.dumps(self.snapshot())))
        self.current = self.old['config_id']; self.running = True; self.calls = []
        self.fail_start = self.busy = self.mutate_grant = False
        self.bad_public = False

    def tearDown(self): self.temporary.cleanup()

    def assets(self, image):
        return {'source': 'synthetic-new', 'release_image': image, 'assets': {name: hashlib.sha256(value).hexdigest() for name, value in self.asset_bodies[image['config_id']].items()}}

    def snapshot(self):
        return {'health': {'native_roles': {'complete': True, 'retained_enabled': True, 'observed': int(time.time()*1000)}}}

    def history(self):
        with database_file(self.data/'metadata.sqlite') as db:
            return hashlib.sha256(json.dumps(db.execute('SELECT * FROM attempts ORDER BY id').fetchall(), separators=(',', ':')).encode()).hexdigest()

    def command(self, arguments, timeout=30):
        args = [str(value) for value in arguments]; self.calls.append(args)
        if args[0] == '/synthetic/read-only-native-guard':
            return json.dumps({'guard': 'PASS', 'history_sha256': 'a'*64, 'config_sha256': 'b'*64,
                'cli_config_sha256': 'e'*64, 'installed_cli_sha256': 'c'*64, 'worker_cli_sha256': 'd'*64,
                'native_roles': [{'unit': name, 'pid': pid} for name, pid in self.release['service_pids'].items() if name != 'exam-ssh-relay.service'], 'relay_pid': 4})
        if args[0] == '/usr/bin/systemctl':
            if args[1] == 'show': return (str(self.dropin) if 'DropInPaths' in args else str(self.unit))+'\n'
            if args[1:3] == ['stop', 'ssh-exam.service']: self.running = False
            if args[1:3] == ['start', 'ssh-exam.service']:
                if self.fail_start:
                    self.fail_start = False
                    raise RuntimeError('Synthetic candidate start failure')
                self.running = True
                self.current = self.new['config_id'] if self.new['tag'] in self.environment.read_text() else self.old['config_id']
                with database_file(self.data/'metadata.sqlite') as db:
                    db.execute('UPDATE agent_snapshot SET payload=?', (json.dumps(self.snapshot()),))
                    if self.mutate_grant: db.execute("UPDATE attempt_grants SET status='REVOKED'")
            return ''
        if args[0] == '/usr/bin/nginx': return ''
        if args[0] == '/usr/bin/docker':
            if args[1:3] == ['image', 'load']: return 'synthetic image loaded'
            if args[1:3] == ['image', 'inspect']:
                image = self.new if args[3] in (self.new['config_id'], self.new['tag']) else self.old
                return json.dumps([{'Id': image['config_id'], 'RootFS': {'Layers': image['layers']}}])
            if args[1] == 'inspect': return json.dumps([{'Image': self.current, 'State': {'Running': self.running, 'Health': {'Status': 'healthy'}},
                'Config': {'User':'10001:10001'}, 'HostConfig': {'ReadonlyRootfs':True,'CapDrop':['ALL']}}])
            raise AssertionError('Unexpected Docker mutation: '+str(args))
        if len(args) > 1 and args[1].endswith('/web-ui-ops/inventory-web.py'):
            if self.busy: raise RuntimeError('Synthetic existing guard reports BUSY')
            return json.dumps({'guard': 'PASS', 'scope': 'STOPPED' if args[-1]=='stopped' else 'RUNNING', 'image': self.current, 'attempts': 1, 'history_sha256': self.history()})
        return REAL_COMMAND(arguments, timeout)

    def urlopen(self, url, timeout=5):
        if url == 'http://127.0.0.1:3001/health/ready':
            return Response(json.dumps({'ready': True, 'productionReady': True, 'notifications': True, 'maintenance': False, 'functionalTest': False}).encode())
        origin = json.loads(self.config.read_text())['origin']
        self.assertTrue(url.startswith(origin+'/'), 'Test must use this synthetic fixture transport only')
        path = url.removeprefix(origin)
        if path == '/' and 'ssh_exam_rollout_refuse' in self.site.read_text():
            headers = Message(); headers['Retry-After'] = '60'
            raise urllib.error.HTTPError(url, 503, 'synthetic maintenance', headers, None)
        name = 'dist/web/index.html' if path == '/' else 'dist/web'+path
        body = self.asset_bodies[self.current][name]
        if self.bad_public and path == '/': body = b'wrong public asset'
        return Response(body)

    def fence(self, rollout):
        # Actual local renderer/atomic config replacement; privileged nginx
        # master/worker drain boundary is explicitly mocked in this harness.
        rollout.install_site((rollout.state/'fenced.conf').read_bytes())
        deploy.atomic_json(rollout.state/'gate.json', {'synthetic_worker_drain': True})

    def cli(self, action, expect=0):
        arguments = ['deploy-web-ui', action, '--state', str(self.state)]
        if action == 'prepare': arguments += ['--release', str(self.bundle)]
        out, error = io.StringIO(), io.StringIO()
        # The installer/root ownership boundary is mocked in this nonroot test;
        # regular/mode/link/nonce checks and all file writes remain actual.
        with patch.object(deploy, 'require_root'), patch.object(deploy.deployment_pause, 'OWNER_UID', os.geteuid()), patch.object(deploy, 'LOCK_FILE', self.root/'host.lock'), patch.object(deploy, 'command', self.command), patch.object(deploy.urllib.request, 'urlopen', self.urlopen), patch.object(deploy.Rollout, 'fence', lambda rollout: self.fence(rollout)), patch.object(sys, 'argv', arguments), redirect_stdout(out), redirect_stderr(error):
            try:
                deploy.main(); result = 0
            except SystemExit as stopped: result = stopped.code
        self.assertEqual(result, expect, error.getvalue())
        return json.loads(out.getvalue() if result == 0 else (self.state/'status.json').read_text()), error.getvalue()

    def stopped_calls(self): return [args for args in self.calls if args[:3] == ['/usr/bin/systemctl', 'stop', 'ssh-exam.service']]

    def test_timed_actual_prepare_warmed_backup_apply_and_online_under_three_minutes(self):
        before = self.history(); prepared, _ = self.cli('prepare')
        self.assertEqual(prepared['coverage']['new_media_bytes_required'], 0)
        self.assertFalse(self.stopped_calls())
        result, _ = self.cli('apply')
        self.assertEqual(result['phase'], 'ONLINE'); self.assertLess(result['cutover_seconds'], 180)
        self.assertEqual(result['backup']['new_monitoring_objects'], 0)
        self.assertEqual(result['backup']['reused_monitoring_bytes'], 8*1024**2)
        self.assertEqual(len(result['proof']['preserved_tables']), 37)
        self.assertEqual(before, self.history())
        self.assertEqual(self.current, self.new['config_id']); self.assertTrue(self.running)
        self.assertNotIn('ssh_exam_rollout_refuse', self.site.read_text())
        self.assertTrue((self.state/'configuration/secrets/private').exists())
        self.assertTrue((self.state/'configuration/compose.yaml').exists())
        self.assertTrue((self.state/'configuration/web-service-dropin-0').exists())
        self.assertFalse(any(args[:3] == ['/usr/bin/docker', 'image', 'save'] for args in self.calls))
        self.assertEqual(self.cli('status')[0]['phase'], 'ONLINE')
        print(json.dumps({'synthetic_cutover_seconds': result['cutover_seconds'], 'media_bytes_reused': result['backup']['reused_monitoring_bytes'], 'privileged_boundaries_mocked': True}), flush=True)

    def test_busy_refuses_before_fence_or_stop(self):
        self.cli('prepare'); self.busy = True
        _, error = self.cli('apply', expect=1)
        self.assertIn('BUSY', error); self.assertFalse(self.stopped_calls())
        self.assertEqual(self.site.read_text(), 'original synthetic site')

    def test_another_owned_rollout_lock_refuses_before_any_stop(self):
        self.cli('prepare')
        with (self.root/'host.lock').open('r+') as held:
            deploy.fcntl.flock(held, deploy.fcntl.LOCK_EX | deploy.fcntl.LOCK_NB)
            _, error = self.cli('apply', expect=1)
        self.assertIn('temporarily unavailable', error)
        self.assertFalse(self.stopped_calls())

    def test_unwarmed_new_media_and_changed_dropin_refuse_before_stop(self):
        self.cli('prepare'); (self.data/'monitoring/new.jpg').write_bytes(b'new')
        _, error = self.cli('apply', expect=1)
        self.assertIn('warming', error); self.assertFalse(self.stopped_calls())
        (self.data/'monitoring/new.jpg').unlink(); self.dropin.write_text('concurrent unit change')
        _, error = self.cli('apply', expect=1)
        self.assertIn('configuration/unit changed', error); self.assertFalse(self.stopped_calls())

    def test_candidate_start_failure_retains_fence_then_rolls_back_and_reopens_current_data(self):
        self.cli('prepare'); before = self.history(); self.fail_start = True
        self.cli('apply', expect=1)
        self.assertIn('ssh_exam_rollout_refuse', self.site.read_text())
        result, _ = self.cli('rollback')
        self.assertEqual(result['phase'], 'ROLLED_BACK_GATED'); self.assertTrue(result['current_database_preserved'])
        self.assertTrue((self.state/'rollback-current-snapshot/snapshot.json').exists())
        self.assertEqual(self.current, self.old['config_id']); self.assertEqual(before, self.history())
        self.assertEqual(self.cli('reopen')[0]['phase'], 'ONLINE_ROLLED_BACK')

    def test_public_failure_refences_without_stopping_candidate_again(self):
        self.cli('prepare'); self.bad_public = True
        self.cli('apply', expect=1)
        self.assertTrue(self.running); self.assertEqual(len(self.stopped_calls()), 1)
        self.assertIn('ssh_exam_rollout_refuse', self.site.read_text())
        # A loopback SSH sign-in can precede canonical attempt creation. Native
        # and durable-table proof alone must not authorize stopping its worker.
        self.busy = True
        _, error = self.cli('rollback', expect=1)
        self.assertIn('BUSY', error)
        self.assertTrue(self.running); self.assertEqual(len(self.stopped_calls()), 1)

    def test_authority_change_cannot_be_erased_by_rollback(self):
        self.cli('prepare'); self.mutate_grant = True
        self.cli('apply', expect=1)
        self.cli('rollback', expect=1)
        self.assertEqual(len(self.stopped_calls()), 1)
        with database_file(self.data/'metadata.sqlite') as db:
            self.assertEqual(db.execute("SELECT status FROM attempt_grants WHERE id='unused'").fetchone(), ('REVOKED',))

    def test_snapshot_publication_crash_is_adopted_without_database_restore(self):
        self.cli('prepare'); original_save = deploy.Rollout.save
        def crash(rollout, phase, **details):
            if phase == 'SNAPSHOT_DURABLE': raise RuntimeError('synthetic process death after snapshot publication')
            return original_save(rollout, phase, **details)
        with patch.object(deploy.Rollout, 'save', crash): self.cli('apply', expect=1)
        self.assertEqual(json.loads((self.state/'status.json').read_text())['phase'], 'STOPPED')
        self.assertTrue((self.state/'snapshot/snapshot.json').exists())
        result, _ = self.cli('rollback')
        self.assertEqual(result['phase'], 'ROLLED_BACK_GATED')
        self.assertTrue(result['backup']['recovered_after_crash'])

    def test_stopped_backup_failure_has_supported_fresh_resume(self):
        self.cli('prepare'); original = deploy.Rollout.snapshot
        def failure(rollout, name):
            if name == 'snapshot': raise RuntimeError('synthetic disk failure before snapshot publication')
            return original(rollout, name)
        with patch.object(deploy.Rollout, 'snapshot', failure): self.cli('apply', expect=1)
        self.assertFalse((self.state/'snapshot').exists())
        self.assertEqual(json.loads((self.state/'status.json').read_text())['phase'], 'STOPPED')
        result, _ = self.cli('resume')
        self.assertEqual(result['phase'], 'ONLINE')
        self.assertEqual(len(self.stopped_calls()), 1)

    def test_fencing_failure_before_install_has_supported_guarded_resume(self):
        self.cli('prepare')
        def refusal(rollout):
            raise RuntimeError('synthetic syntax check refused before fence installation')
        with patch.object(self, 'fence', refusal): self.cli('apply', expect=1)
        self.assertEqual(json.loads((self.state/'status.json').read_text())['phase'], 'FENCING')
        self.assertEqual(self.site.read_text(), 'original synthetic site')
        self.assertFalse(self.stopped_calls())
        self.assertEqual(self.cli('resume')[0]['phase'], 'ONLINE')

    def test_fenced_guard_refusal_never_stops_work_and_fresh_resume_rechecks(self):
        self.cli('prepare'); original = self.fence
        def uncertain(rollout):
            original(rollout); self.busy = True
        with patch.object(self, 'fence', uncertain): self.cli('apply', expect=1)
        self.assertEqual(json.loads((self.state/'status.json').read_text())['phase'], 'FENCED')
        self.assertIn('ssh_exam_rollout_refuse', self.site.read_text())
        self.assertFalse(self.stopped_calls()); self.assertTrue(self.running)
        self.cli('resume', expect=1)
        self.assertFalse(self.stopped_calls()); self.assertTrue(self.running)
        self.busy = False
        self.assertEqual(self.cli('resume')[0]['phase'], 'ONLINE')

    def test_stop_completion_crash_before_status_uses_fresh_stopped_resume(self):
        self.cli('prepare'); original = deploy.Rollout.save
        def interrupted(rollout, phase, **details):
            if phase == 'STOPPED': raise RuntimeError('synthetic process death after service stop')
            return original(rollout, phase, **details)
        with patch.object(deploy.Rollout, 'save', interrupted): self.cli('apply', expect=1)
        self.assertEqual(json.loads((self.state/'status.json').read_text())['phase'], 'FENCED')
        self.assertFalse(self.running); self.assertEqual(len(self.stopped_calls()), 1)
        self.assertEqual(self.cli('resume')[0]['phase'], 'ONLINE')
        self.assertEqual(len(self.stopped_calls()), 1)

    def test_prepared_manifest_or_rendered_file_changes_refuse_without_stop(self):
        self.cli('prepare')
        for name in ('release.json','image-assets.json','normal.conf','fenced.conf'):
            path = self.state/name; original = path.read_bytes(); path.write_bytes(original+b' ')
            _, error = self.cli('apply', expect=1)
            self.assertIn('input changed', error); self.assertFalse(self.stopped_calls())
            path.write_bytes(original)

    def test_actual_stopped_idle_sql_refuses_active_history_without_query_bypasses(self):
        self.state.mkdir(mode=0o700)
        (self.state/'release.json').write_text(json.dumps(self.release))
        self.config.write_text(json.dumps({'mode':'production','maintenance':False,'origin':'https://ssh-exam.cadilhac.name','agent':{'id':'class'}}))
        arguments=[sys.executable,REPOSITORY/'scripts/web-ui-ops/inventory-web.py',self.state,36]
        query=self.actual_idle_sql()
        self.assertTrue(json.loads(query(arguments))['fresh_native_guard_required'])
        with database_file(self.data/'metadata.sqlite') as database:
            database.execute("UPDATE attempts SET state='ACTIVE'")
        with self.assertRaises(RuntimeError): query(arguments)

    def video_schema(self):
        with database_file(self.data/'metadata.sqlite') as database:
            database.executescript((REPOSITORY/'migrations/037.sql').read_text())
        self.release['schema'] = self.release['old_schema'] = 37
        (self.bundle/'release.json').write_text(json.dumps(self.release))

    def actual_idle_sql(self):
        original = self.command
        def query(arguments, timeout=30):
            args = [str(value) for value in arguments]
            if len(args) < 2 or not args[1].endswith('/web-ui-ops/inventory-web.py'):
                return original(arguments, timeout)
            text = io.StringIO()
            def host(arguments, **unused):
                return json.dumps([{'Image':self.current,'State':{'Running':False}}]) if arguments[0]=='docker' else 'inactive\n'
            connections=[]; connect=sqlite3.connect
            def observed_connection(*values,**options):
                connection=connect(*values,**options);connections.append(connection);return connection
            try:
                with patch.object(sys,'argv',[args[1],str(self.state),str(self.release['schema']),'stopped']), patch('subprocess.check_output',host), patch('sqlite3.connect',observed_connection), redirect_stdout(text):
                    runpy.run_path(args[1],run_name='__main__')
            except SystemExit as finished:
                if finished.code != 0: raise
            except AssertionError as error:
                raise RuntimeError('Actual original idle SQL refused: '+str(error)) from error
            finally:
                # Real helper-process exit closes these handles. runpy retains
                # assertion tracebacks, so this in-process host adapter must too.
                for connection in connections: connection.close()
            return text.getvalue()
        return query

    def test_schema37_without_owned_pause_refuses_pending_retry_and_eligible_unqueued(self):
        self.video_schema()
        self.config.write_text(json.dumps({'mode':'production','maintenance':False,'origin':'https://ssh-exam.cadilhac.name','agent':{'id':'class'}}))
        self.cli('prepare')
        (self.data/deploy.deployment_pause.NAME).unlink()
        query=self.actual_idle_sql()
        arguments=[sys.executable,REPOSITORY/'scripts/web-ui-ops/inventory-web.py',self.state,37]
        with self.assertRaisesRegex(RuntimeError,'video_unqueued'): query(arguments)
        for status in ('pending','running','retry'):
            with database_file(self.data/'metadata.sqlite') as database:
                database.execute("INSERT INTO monitoring_video_jobs(attempt,status,next,updated) VALUES('history',?,0,0) ON CONFLICT(attempt) DO UPDATE SET status=excluded.status",(status,))
            with self.assertRaisesRegex(RuntimeError,'video_jobs'): query(arguments)
        with database_file(self.data/'metadata.sqlite') as database:
            database.execute("UPDATE monitoring_video_jobs SET status='complete'")
            database.execute("INSERT INTO frames(id,attempt,source,seq,page_hash,captured,monotonic,received,width,height,hash) VALUES('late-frame','history','screen',1,'synthetic',1,1.5,2,2,2,?)",('b'*64,))
        with self.assertRaisesRegex(RuntimeError,'video_unmapped_complete'): query(arguments)
        self.assertFalse(self.stopped_calls())
        self.assertTrue(self.running); self.assertEqual(self.site.read_text(),'original synthetic site')

    def test_owned_pause_allows_stable_backlog_but_never_running_or_owned_jobs(self):
        self.video_schema()
        self.config.write_text(json.dumps({'mode':'production','maintenance':False,'origin':'https://ssh-exam.cadilhac.name','agent':{'id':'class'}}))
        self.cli('prepare')
        with patch.object(self,'command',self.actual_idle_sql()):
            # The current chunk must finish naturally. Even an inconsistent
            # queued row with a process owner is not a drain receipt.
            for status in ('pending','running','retry'):
                with database_file(self.data/'metadata.sqlite') as database:
                    database.execute("INSERT INTO monitoring_video_jobs(attempt,status,owner,next,updated) VALUES('history',?,'chunk-owner',0,0) ON CONFLICT(attempt) DO UPDATE SET status=excluded.status,owner='chunk-owner'",(status,))
                _, error = self.cli('apply',expect=1)
                self.assertIn('video_running',error); self.assertFalse(self.stopped_calls())
            with database_file(self.data/'metadata.sqlite') as database:
                database.execute("UPDATE monitoring_video_jobs SET status='pending',owner=NULL")
            result,_=self.cli('apply')
        self.assertEqual(result['phase'],'ONLINE'); self.assertEqual(result['video_pause']['status'],'RELEASED')
        self.assertFalse((self.data/deploy.deployment_pause.NAME).exists())
        self.assertNotIn(deploy.deployment_pause.NAME,json.loads((self.state/'snapshot/snapshot.json').read_text())['files'])
        with database_file(self.data/'metadata.sqlite') as database:
            self.assertEqual(database.execute("SELECT status,owner FROM monitoring_video_jobs").fetchall(),[('pending',None)])
        self.assertEqual(len(result['proof']['preserved_tables']),41)

    def test_foreign_or_unsafe_pause_is_never_adopted_or_removed(self):
        self.video_schema(); self.cli('prepare'); marker=self.data/deploy.deployment_pause.NAME
        marker.write_bytes(b'another installer'); marker.chmod(0o600)
        self.cli('apply',expect=1); self.assertEqual(marker.read_bytes(),b'another installer')
        record=json.loads((self.state/'status.json').read_text()); expected=deploy.deployment_pause.content(self.state,record['video_pause']['nonce'])
        marker.write_bytes(expected); marker.chmod(0o644)
        self.cli('apply',expect=1); self.assertEqual(marker.stat().st_mode & 0o777,0o644)
        marker.chmod(0o600); extra=self.data/'another-link'; os.link(marker,extra)
        self.cli('apply',expect=1); self.assertEqual(marker.stat().st_nlink,2)
        marker.unlink(); marker.symlink_to(extra)
        self.cli('apply',expect=1); self.assertTrue(marker.is_symlink()); self.assertEqual(extra.read_bytes(),expected)
        self.cli('cancel',expect=1); self.assertTrue(marker.is_symlink()); self.assertFalse(self.stopped_calls())

    def test_owned_pause_publication_and_post_open_crashes_have_supported_resume(self):
        self.video_schema(); original=deploy.Rollout.save
        scratch=self.data/'monitoring/history/.video-work-11111111-1111-4111-8111-111111111111'
        scratch.mkdir(parents=True);(scratch/'copy.jpg').write_bytes(b'ephemeral codec copy')
        retained=self.data/'monitoring/history/unknown-directory';retained.mkdir();(retained/'keep').write_bytes(b'retained unknown bytes')
        def interrupted(rollout,phase,**details):
            if details.get('video_pause',{}).get('status')=='OWNED':
                raise RuntimeError('synthetic installer exit after marker publication')
            return original(rollout,phase,**details)
        with patch.object(deploy.Rollout,'save',interrupted): self.cli('prepare',expect=1)
        marker=self.data/deploy.deployment_pause.NAME
        self.assertTrue(marker.exists()); self.assertEqual(self.cli('status')[0]['video_pause']['status'],'PENDING')
        self.assertEqual(self.cli('status')[0]['video_pause_observed']['condition'],'owned')
        self.assertFalse(self.stopped_calls())
        prepared,_=self.cli('resume')
        self.assertEqual(prepared['phase'],'PREPARED');self.assertEqual(prepared['coverage']['monitoring_files'],129)
        cache=json.loads((self.store/'source-cache.json').read_text())
        self.assertNotIn(str(scratch/'copy.jpg'),cache);self.assertIn(str(retained/'keep'),cache)
        with patch.object(deploy.Rollout,'release_background',side_effect=RuntimeError('synthetic exit after ONLINE')):
            self.cli('apply',expect=1)
        self.assertEqual(self.cli('status')[0]['phase'],'ONLINE');self.assertTrue(marker.exists())
        calls=len(self.stopped_calls()); self.busy=True
        result,_=self.cli('resume')
        self.assertEqual(result['phase'],'ONLINE');self.assertTrue(result['recovered_online_read_only'])
        self.assertFalse(marker.exists());self.assertEqual(len(self.stopped_calls()),calls);self.assertTrue(self.running)

    def test_cancel_owned_pause_restores_only_owned_fence_without_stopping_busy_gateway(self):
        self.video_schema(); self.cli('prepare'); original=self.fence
        def uncertain(rollout):
            original(rollout);self.busy=True
        with patch.object(self,'fence',uncertain): self.cli('apply',expect=1)
        marker=self.data/deploy.deployment_pause.NAME
        self.assertTrue(marker.exists());self.assertEqual(self.cli('status')[0]['phase'],'FENCED')
        self.running=False;self.cli('cancel',expect=1);self.assertTrue(marker.exists())
        self.running=True
        save=deploy.Rollout.save
        def interrupted(rollout,phase,**details):
            if phase=='CANCELLED':raise RuntimeError('synthetic exit after original site restored')
            return save(rollout,phase,**details)
        with patch.object(deploy.Rollout,'save',interrupted):self.cli('cancel',expect=1)
        self.assertEqual(self.site.read_text(),'original synthetic site');self.assertTrue(marker.exists())
        result,_=self.cli('resume')
        self.assertEqual(result['phase'],'CANCELLED');self.assertEqual(self.site.read_text(),'original synthetic site')
        self.assertFalse(marker.exists());self.assertFalse(self.stopped_calls());self.assertTrue(self.running)

    def test_prepare_pauses_before_actual_warm_and_cancels_failed_warm_without_student_drain(self):
        self.video_schema();self.busy=True
        with database_file(self.data/'metadata.sqlite') as database:
            database.execute("INSERT INTO monitoring_video_jobs(attempt,status,owner,next,updated) VALUES('history','running','current-chunk',0,0)")
        marker=self.data/deploy.deployment_pause.NAME; original=self.command
        observed=[]
        def finish_chunk(_seconds):
            self.assertTrue(marker.exists())
            record=json.loads((self.state/'status.json').read_text())
            self.assertTrue(deploy.deployment_pause.owned(self.data,self.state,record))
            with database_file(self.data/'metadata.sqlite') as database:
                database.execute("UPDATE monitoring_video_jobs SET status='pending',owner=NULL")
            # The existing chunk may finish removing an original before warm.
            (self.data/'monitoring/0.jpg').unlink()
            observed.append('current-chunk-finished')
        def warm_failure(arguments,timeout=30):
            args=[str(value) for value in arguments]
            if '--warm-media' in args:
                self.assertTrue(marker.exists());self.assertEqual(observed,['current-chunk-finished'])
                result=original(arguments,timeout)
                self.assertEqual(json.loads(result)['phase'],'MEDIA_WARMED')
                observed.append('actual-warm-complete')
                raise RuntimeError('synthetic interruption after online warm')
            return original(arguments,timeout)
        with patch.object(self,'command',warm_failure),patch.object(deploy.time,'sleep',finish_chunk):
            self.cli('prepare',expect=1)
        self.assertEqual(observed,['current-chunk-finished','actual-warm-complete'])
        self.assertEqual(self.cli('status')[0]['phase'],'PREPARING')
        self.assertEqual(self.site.read_text(),'original synthetic site');self.assertFalse(self.stopped_calls())
        result,_=self.cli('cancel')
        self.assertEqual(result['phase'],'CANCELLED');self.assertFalse(marker.exists())
        self.assertTrue(self.running);self.assertFalse(self.stopped_calls())

    def test_schema37_same_schema_snapshot_preserves_all_four_video_tables(self):
        self.video_schema()
        with database_file(self.data/'metadata.sqlite') as database:
            database.execute("INSERT INTO monitoring_video_jobs(attempt,status,next,updated) VALUES('history','paused',0,0)")
            database.execute("INSERT INTO monitoring_video_segments(id,attempt,source,sha256,bytes,width,height,frame_count,source_bytes,created,verified) VALUES('clip','history','screen',?,9,2,2,1,20,1,1)",('a'*64,))
            database.execute("INSERT INTO frames(id,attempt,source,seq,page_hash,captured,monotonic,received,width,height,hash) VALUES('frame','history','screen',1,'synthetic',1,1.5,2,2,2,?)",('b'*64,))
            database.execute("INSERT INTO monitoring_video_frames VALUES('frame','clip',0,?)",('c'*64,))
            database.execute("INSERT INTO monitoring_video_requests VALUES('intent','history','cancel',1,'synthetic',?,?)",('d'*64,json.dumps({'id':'history','action':'cancel','accepted':True})))
        self.cli('prepare'); result,_=self.cli('apply')
        self.assertEqual(result['phase'],'ONLINE')
        self.assertEqual(len(result['proof']['preserved_tables']),41)
        for table in ('monitoring_video_jobs','monitoring_video_segments','monitoring_video_frames','monitoring_video_requests'):
            self.assertIn(table,result['proof']['preserved_tables'])
        with database_file(self.data/'metadata.sqlite') as database:
            database.execute("UPDATE monitoring_video_requests SET result='{}'")
        with self.assertRaises(AssertionError): deploy.Rollout(self.state).preserved()

    def test_schema37_paused_complete_deleted_or_ineligible_rows_are_stable_idle_metadata(self):
        self.video_schema()
        self.config.write_text(json.dumps({'mode':'production','maintenance':False,'origin':'https://ssh-exam.cadilhac.name','agent':{'id':'class'}}))
        self.state.mkdir(mode=0o700);(self.state/'release.json').write_text(json.dumps(self.release))
        query=self.actual_idle_sql()
        for status in ('paused','complete','deleted'):
            with database_file(self.data/'metadata.sqlite') as database:
                database.execute("INSERT INTO monitoring_video_jobs(attempt,status,next,updated) VALUES('history',?,0,0) ON CONFLICT(attempt) DO UPDATE SET status=excluded.status",(status,))
                if status=='deleted': database.execute("INSERT INTO tombstones VALUES('history',1)")
                if status=='paused': database.execute("INSERT INTO frames(id,attempt,source,seq,page_hash,captured,monotonic,received,width,height,hash) VALUES('paused-original','history','screen',1,'synthetic',1,1.5,2,2,2,?)",('b'*64,))
            self.assertEqual(json.loads(query([sys.executable,REPOSITORY/'scripts/web-ui-ops/inventory-web.py',self.state,37]))['guard'],'PASS')
            with database_file(self.data/'metadata.sqlite') as database: database.execute("DELETE FROM frames WHERE id='paused-original'")
        with database_file(self.data/'metadata.sqlite') as database:
            database.execute("DELETE FROM monitoring_video_jobs")
            database.execute("INSERT OR IGNORE INTO tombstones VALUES('history',1)")
        self.assertEqual(json.loads(query([sys.executable,REPOSITORY/'scripts/web-ui-ops/inventory-web.py',self.state,37]))['guard'],'PASS')


if __name__ == '__main__': unittest.main()
