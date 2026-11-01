#!/usr/bin/env python3
"""Private local production-image startup/current-schema/upgrade smoke; never deploys."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import tempfile
import uuid

from cryptography.hazmat.primitives.asymmetric import ed25519
from cryptography.hazmat.primitives import serialization

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--image', required=True, help='already-built local release image')
parser.add_argument('--docker-host', default='unix:///var/run/docker.sock')
parser.add_argument('--from-schema', type=int, choices=(11, 24, 35, 36), default=24,
                    help='synthetic installed schema; 36 checks startup without migration')
parser.add_argument('--asset-receipt', type=Path,
                    help='independent qualified source/asset receipt instead of a local dist/web build')
args = parser.parse_args()
assert re.fullmatch(r'[a-z0-9][a-z0-9./_-]*:[a-zA-Z0-9_.-]+', args.image)
assert args.docker_host in ('unix:///var/run/docker.sock',
                           f'unix:///run/user/{os.getuid()}/docker.sock'), 'Local engine only'
assert Path(args.docker_host.removeprefix('unix://')).is_socket()
project = Path(__file__).resolve().parents[1]
asset_receipt = json.loads(args.asset_receipt.read_text()) if args.asset_receipt else None
if asset_receipt:
    assert isinstance(asset_receipt.get('assets'), dict)
    assert re.fullmatch(r'sha256:[a-f0-9]{64}', asset_receipt['release_image']['id'])
docker = ['docker', '--host', args.docker_host]
nonce = uuid.uuid4().hex
tag = 'ssh-exam-private-release-smoke:' + nonce
name = 'ssh-exam-release-smoke-' + nonce
label = 'ssh-exam.private-release-smoke'


def run(words, timeout=30):
    result = subprocess.run(words, capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError(f'{words[:3]} failed ({result.returncode}): '
                           + (result.stdout + result.stderr)[-4000:])
    return result.stdout.strip()


probe = r'''
const assert = require('node:assert/strict'), fs = require('node:fs');
const {createHash} = require('node:crypto');
const Database = require('better-sqlite3');
const hash = b => createHash('sha256').update(b).digest('hex');
(async () => {
  assert.equal(process.getuid(), 10001);
  const until = Date.now() + 30000;
  while (true) {
    try {
      const live = await fetch('http://127.0.0.1:3000/health/live', {signal: AbortSignal.timeout(1000)});
      assert.equal(live.status, 200); assert.deepEqual(await live.json(), {ok:true}); break;
    } catch (error) {
      if (Date.now() >= until) throw error;
      await new Promise(r => setTimeout(r, 100));
    }
  }
  const ready = await fetch('http://127.0.0.1:3000/health/ready', {signal: AbortSignal.timeout(2000)});
  assert.equal(ready.status, 503);
  assert.deepEqual(await ready.json(), {ready:false, maintenance:true, mode:'production',
    productionReady:false, reason:'Exam starts paused for maintenance'});
  const mode = await (await fetch('http://127.0.0.1:3000/api/login-test')).json();
  assert.equal(mode.maintenance, true); assert.equal(mode.loginOnly, false);
  assert.equal(mode.functionalTest, false); assert.equal(mode.browserSSH, true);
  const clock = require('/app/dist/apps/server/native/monitoring_clock.node');
  assert.equal(clock.kind, 'linux-boottime-ms-v1');
  const first = clock.now(), second = clock.now();
  assert(Number.isSafeInteger(first) && first > 0 && second >= first);
  const db = new Database('/data/metadata.sqlite', {readonly:true});
  const expected = JSON.parse(fs.readFileSync('/opt/release-smoke/expected.json'));
  for (const row of expected.attempts) {
    const actual = db.prepare('SELECT * FROM attempts WHERE id=?').get(row.id);
    for (const [key, value] of Object.entries(row)) assert.deepEqual(actual[key], value, key);
    assert.equal(actual.monitoring_mode, row.start === null ? null : 'legacy');
    for (const key of ['registered_owner','retained_hold','monitoring_hold_kind','native_resume_kind','native_resume_nonce'])
      assert.equal(actual[key], null, key);
  }
  assert.deepEqual(db.prepare('SELECT * FROM enrollments ORDER BY username').all(), expected.enrollments);
  assert.equal(db.prepare('SELECT config FROM exams WHERE id=?').get('release-smoke').config, expected.exam_config);
  assert.equal(db.prepare('SELECT max(version) AS v FROM schema_version').get().v, 36);
  if (expected.schema_versions)
    assert.deepEqual(db.prepare('SELECT * FROM schema_version ORDER BY version').all(), expected.schema_versions);
  assert.equal(db.prepare('SELECT count(*) AS n FROM exam_native_reconciliations').get().n, 0);
  assert.deepEqual(db.pragma('foreign_key_check'), []);
  assert.equal(db.prepare('SELECT count(*) AS n FROM attempts').get().n, expected.attempts.length);
  assert.equal(db.prepare('SELECT count(*) AS n FROM attempt_grants').get().n, 0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM grant_source_setup').get().n, 0);
  db.close();
  for (const file of ['config.json','gateway.key','callback.pub','metadata.sqlite','expected.json']) {
    const st = fs.lstatSync('/opt/release-smoke/' + file);
    assert(st.isFile() && st.uid === 10001 && (st.mode & 0o777) === 0o600);
  }
  const root = await fetch('http://127.0.0.1:3000/');
  assert.equal(root.status, 200); const html = await root.text();
  assert(html.includes('<title>SSH Exam Workspace</title>'));
  const paths = [...html.matchAll(/(?:src|href)="(\/assets\/[^"?]+)"/g)].map(m => m[1]);
  assert(paths.some(p => p.endsWith('.js')) && paths.some(p => p.endsWith('.css')));
  paths.push('/ssh/client.wasm', '/ssh/wasm_exec.js');
  const assets = {};
  for (const path of paths) {
    const response = await fetch('http://127.0.0.1:3000' + path, {signal: AbortSignal.timeout(10000)});
    assert.equal(response.status, 200, path);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(hash(bytes), hash(fs.readFileSync('/app/dist/web' + path)), path);
    if (path.endsWith('.wasm')) assert.deepEqual([...bytes.subarray(0,4)], [0,97,115,109]);
    assets[path] = hash(bytes);
  }
  console.log(JSON.stringify({uid:process.getuid(), productionMaintenance:true, schema:36,
    schemaVersionRowsPreserved:!!expected.schema_versions,
    historicalAttemptsPreserved:expected.attempts.length, enrollmentSettingsPreserved:true,
    noInventedGrants:true, nativeBootClock:true, assets}));
})().catch(error => { console.error(error); process.exit(1); });
'''

container = None
fixture_image = False
with tempfile.TemporaryDirectory(prefix='ssh-exam-release-container-') as directory:
    staging = Path(directory)
    fixture = staging / 'fixture'
    fixture.mkdir(mode=0o700)
    try:
        base = run(docker + ['image', 'inspect', '--format', '{{.Id}}', args.image])
        assert re.fullmatch(r'sha256:[a-f0-9]{64}', base)
        if asset_receipt:
            assert base == asset_receipt['release_image']['id'], 'Receipt is for another image'
        key = ed25519.Ed25519PrivateKey.generate()
        (fixture / 'gateway.key').write_bytes(key.private_bytes(serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
        (fixture / 'callback.pub').write_bytes(ed25519.Ed25519PrivateKey.generate().public_key().public_bytes(
            serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo))
        config = {'mode':'production', 'origin':'https://release-smoke.invalid', 'data':'/data', 'port':3000,
                  'maintenance':True, 'jump':{'host':'jump.release-smoke.invalid', 'pins':['a'*64]},
                  'class':{'host':'class.release-smoke.invalid', 'pins':['b'*64]},
                  'browserSSH':{'relay':'wss://relay.release-smoke.invalid/ssh', 'audience':'release-smoke'},
                  'agent':{'id':'release-smoke', 'signingKey':'/opt/release-smoke/gateway.key',
                           'callbackPublicKey':'/opt/release-smoke/callback.pub'}}
        (fixture / 'config.json').write_text(json.dumps(config))
        db = sqlite3.connect(fixture / 'metadata.sqlite')
        db.row_factory = sqlite3.Row
        for path in sorted((project / 'migrations').iterdir()):
            if re.fullmatch(r'\d{3}\.sql', path.name) and int(path.stem) <= args.from_schema:
                db.executescript(path.read_text())
        assert db.execute('SELECT max(version) FROM schema_version').fetchone()[0] == args.from_schema
        settings = json.dumps({'id':'release-smoke', 'name':'Synthetic historical exam', 'template':'v1',
                               'duration':5400, 'webcam':True, 'terminals':4, 'earliest':100, 'latest':200})
        db.execute('INSERT INTO exams VALUES(?,?)', ('release-smoke', settings))
        attempt = '12345678-1234-4234-8234-123456789abc'
        db.execute('INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline,ended,protected,checksum,access_state) '
                   'VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
                   (attempt,'release-smoke','synthetic',20001,'COMPLETED',settings,1000,5401000,5401000,2000,1,'c'*64,'HELD'))
        db.execute('INSERT INTO enrollments(exam,username,webcam,duration,uid) VALUES(?,?,?,?,?)',
                   ('release-smoke','synthetic',None,None,20001))
        if args.from_schema == 11:
            for suffix,username,state,access,start,deadline,protected,webcam,duration,uid in (
                ('ab1','synthetic-released','COMPLETED','RELEASED',1000,5401000,1,1,4500,20002),
                ('ab2','synthetic-overridden','COMPLETED','OVERRIDDEN',1000,5401000,1,0,3600,20003),
                ('ab3','synthetic-cancelled','CANCELLED_BEFORE_START','UNKNOWN',None,None,0,None,None,0),
            ):
                identifier=attempt[:-3]+suffix
                db.execute('INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline,ended,protected,checksum,access_state,policy_state) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                           (identifier,'release-smoke',username,uid,state,settings,start,deadline,deadline,2000,protected,'d'*64 if protected else None,access,None))
                db.execute('INSERT INTO enrollments(exam,username,webcam,duration,uid) VALUES(?,?,?,?,?)',
                           ('release-smoke',username,webcam,duration,uid))
        if args.from_schema >= 30:
            db.execute("UPDATE attempts SET monitoring_mode='legacy' WHERE start IS NOT NULL")
        expected = {'attempts':[dict(row) for row in db.execute('SELECT * FROM attempts ORDER BY id')],
                    'enrollments':[dict(row) for row in db.execute('SELECT * FROM enrollments ORDER BY username')],
                    'exam_config':settings,
                    'schema_versions':[dict(row) for row in db.execute('SELECT * FROM schema_version ORDER BY version')]
                        if args.from_schema == 36 else None}
        db.commit(); db.close()
        (fixture / 'expected.json').write_text(json.dumps(expected))
        for path in fixture.iterdir():
            path.chmod(0o600)
            assert path.is_file() and not path.is_symlink()
            assert path.stat().st_uid == os.getuid() and path.stat().st_nlink == 1
        private_paths = ' '.join('/opt/release-smoke/' + path for path in
            ['config.json', 'gateway.key', 'callback.pub', 'metadata.sqlite', 'expected.json'])
        (staging / 'Dockerfile').write_text('FROM ' + base + '\nUSER root\nCOPY fixture /opt/release-smoke\n'
            'LABEL ' + label + '="' + nonce + '"\n'
            'RUN chown -R 10001:10001 /opt/release-smoke && chmod 700 /opt/release-smoke && chmod 600 ' + private_paths + '\n'
            'USER 10001:10001\nENV EXAM_CONFIG=/opt/release-smoke/config.json\n'
            'ENTRYPOINT ["/bin/sh","-c","cp /opt/release-smoke/metadata.sqlite /data/metadata.sqlite && exec node dist/apps/server/src/main.js"]\n')
        run(docker + ['build', '--tag', tag, str(staging)], timeout=120)
        fixture_image = True
        container = run(docker + ['create', '--name', name, '--label', label + '=' + nonce,
            '--read-only', '--network', 'none', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
            '--tmpfs', '/tmp:rw,noexec,nosuid,size=128m',
            '--tmpfs', '/data:rw,nosuid,nodev,size=64m,uid=10001,gid=10001,mode=0700',
            '--pids-limit', '128', '--memory', '512m', '--cpus', '1', tag])
        assert re.fullmatch(r'[a-f0-9]{64}', container)
        print(json.dumps({'fixture_image':tag, 'container':container, 'base_image':base}), flush=True)
        run(docker + ['start', container])
        result = json.loads(run(docker + ['exec', container, 'node', '-e', probe], timeout=45))
        inspection = json.loads(run(docker + ['inspect', container]))[0]
        assert inspection['Config']['User'] == '10001:10001'
        assert inspection['HostConfig']['ReadonlyRootfs'] and inspection['HostConfig']['NetworkMode'] == 'none'
        assert inspection['HostConfig']['CapDrop'] == ['ALL']
        assert 'no-new-privileges' in inspection['HostConfig']['SecurityOpt']
        for path, digest in result['assets'].items():
            if asset_receipt:
                assert asset_receipt['assets'].get('dist/web'+path) == digest, 'Packaged asset differs from independent qualified receipt: ' + path
            else:
                local = project / 'dist/web' / path.lstrip('/')
                assert local.is_file() and hashlib.sha256(local.read_bytes()).hexdigest() == digest, 'Packaged asset differs from browser-qualified host build: ' + path
        print(json.dumps({'image':base, 'container':container, 'from_schema':args.from_schema, **result}), flush=True)
    except BaseException:
        if container:
            log = subprocess.run(docker + ['logs', '--tail', '30', container], capture_output=True, text=True, timeout=10)
            print((log.stdout + log.stderr)[-4000:], flush=True)
        raise
    finally:
        # Exact unique label/ID only. Never stop another container or prune images.
        if not container:
            found = subprocess.run(docker + ['inspect', name], capture_output=True, text=True, timeout=10)
            if found.returncode == 0:
                value = json.loads(found.stdout)[0]
                assert value['Config']['Labels'].get(label) == nonce
                container = value['Id']
        if container:
            value = json.loads(run(docker + ['inspect', container]))[0]
            assert value['Config']['Labels'].get(label) == nonce
            run(docker + ['rm', '--force', container])
            # A successful exact-ID query with an empty result proves absence;
            # daemon failure or localized/case-varied error text cannot do so.
            assert run(docker + ['ps', '-a', '--no-trunc', '--filter', 'id=' + container,
                                 '--format', '{{.ID}}']) == ''
        if fixture_image:
            value = json.loads(run(docker + ['image', 'inspect', tag]))[0]
            assert value['Config']['Labels'].get(label) == nonce
            run(docker + ['image', 'rm', value['Id']])
assert not staging.exists()
print('Private container/image and synthetic key/data directory removed; base release image preserved', flush=True)
