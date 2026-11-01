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
parser.add_argument('--from-schema', type=int, choices=(11, 24, 35, 36, 37), default=24,
                    help='synthetic installed schema; equal target checks startup without migration')
parser.add_argument('--target-schema', type=int, choices=(36, 37), default=37,
                    help='qualified image schema; 36 is retained for older image smoke, never a downgrade')
parser.add_argument('--asset-receipt', type=Path,
                    help='independent qualified source/asset receipt instead of a local dist/web build')
args = parser.parse_args()
if args.from_schema > args.target_schema:
    parser.error('from-schema cannot exceed target-schema; this helper never qualifies a downgrade')
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
container_name = 'ssh-exam-release-smoke-' + nonce
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
  assert.equal(db.prepare('SELECT max(version) AS v FROM schema_version').get().v, expected.target_schema);
  const versions = db.prepare('SELECT * FROM schema_version ORDER BY version').all();
  assert.deepEqual(versions.filter(row => row.version <= expected.from_schema), expected.schema_versions);
  if (expected.from_schema === expected.target_schema) assert.deepEqual(versions, expected.schema_versions);
  let oldRowsPreserved = 0;
  for (const table of expected.tables_before) {
    assert(/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table.name));
    const quoted = '"' + table.name + '"';
    const rows = table.rowid ? null : db.prepare('SELECT * FROM ' + quoted).all();
    for (const before of table.rows) {
      let actual;
      if (table.rowid) actual = db.prepare('SELECT * FROM ' + quoted + ' WHERE rowid=?').get(before.__smoke_rowid);
      else {
        const index = rows.findIndex(row => Object.entries(before).every(([key,value]) => row[key] === value));
        assert(index >= 0, table.name + ': old row lost or changed'); actual = rows.splice(index,1)[0];
      }
      assert(actual, table.name + ': old rowid lost');
      for (const [key,value] of Object.entries(before)) if (key !== '__smoke_rowid') assert.deepEqual(actual[key],value,table.name+'.'+key);
      oldRowsPreserved++;
    }
  }
  if (expected.target_schema >= 37) for (const table of ['monitoring_video_segments','monitoring_video_frames','monitoring_video_jobs','monitoring_video_requests'])
    assert.equal(db.prepare('SELECT count(*) AS n FROM '+table).get().n,0,table+': no fabricated video state for ineligible old histories');
  assert.equal(db.prepare('SELECT count(*) AS n FROM exam_native_reconciliations').get().n, 0);
  assert.deepEqual(db.pragma('foreign_key_check'), []);
  assert.equal(db.prepare('SELECT count(*) AS n FROM attempts').get().n, expected.attempts.length);
  assert.equal(db.prepare('SELECT count(*) AS n FROM attempt_grants').get().n, 0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM grant_source_setup').get().n, 0);
  db.close();
  for (const file of ['config.json','gateway.key','callback.pub','metadata.sqlite','expected.json', ...(expected.target_schema >= 37 ? ['video-compat.json','video-compat.webm'] : [])]) {
    const st = fs.lstatSync('/opt/release-smoke/' + file);
    assert(st.isFile() && st.uid === 10001 && (st.mode & 0o777) === 0o600);
  }
  let videoCompatibility = null;
  if (expected.target_schema >= 37) {
    const {Store} = await import('file:///app/dist/apps/server/src/db.js');
    const {Monitoring} = await import('file:///app/dist/apps/server/src/monitoring.js');
    const {MonitoringMedia} = await import('file:///app/dist/apps/server/src/monitoring-media.js');
    const {MonitoringVideoProcess} = await import('file:///app/dist/apps/server/src/monitoring-video-process.js');
    const {videoResult,videoInputFrame} = await import('file:///app/dist/apps/server/src/monitoring-video-schema.js');
    const sharp = require('sharp');
    const fixture = JSON.parse(fs.readFileSync('/opt/release-smoke/video-compat.json'));
    assert.equal(fixture.format,'ssh-exam-synthetic-monitoring-video-v1');
    const result = videoResult.parse(fixture.result), sources = fixture.source_frames.map(frame=>videoInputFrame.parse(frame));
    const blob = fs.readFileSync('/opt/release-smoke/video-compat.webm');
    assert.equal(hash(blob),result.sha256); assert.equal(blob.length,result.bytes);
    assert.equal(sources.length,result.frames.length);
    const directory = fs.mkdtempSync('/tmp/ssh-exam-video-compat-'), store = new Store(directory);
    const originalBatch = MonitoringVideoProcess.prototype.frames;
    let batches = 0, media, session;
    try {
      assert.equal(store.db.prepare('SELECT max(version) v FROM schema_version').get().v,37);
      new Monitoring(store);
      const epoch = Date.now()-5400000-120000, deadline=epoch+5400000, ended=deadline+1000;
      const settings = JSON.stringify({...JSON.parse(expected.exam_config),id:'release-video-compat',name:'Authored video compatibility',earliest:epoch-60000,latest:epoch+60000});
      store.db.prepare('INSERT INTO exams VALUES(?,?)').run('release-video-compat',settings);
      store.db.prepare(`INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline,ended,protected,checksum,access_state,monitoring_mode)
        VALUES(?,'release-video-compat','authored-video',20011,'COMPLETED',?,?,?,?,?,1,?,'RELEASED','legacy')`)
        .run(result.attempt,settings,epoch,deadline,deadline,ended,'e'.repeat(64));
      store.db.prepare(`INSERT INTO enrollments(exam,username,webcam,duration,uid) VALUES('release-video-compat','authored-video',NULL,NULL,20011)`).run();
      const attemptDirectory = directory+'/monitoring/'+result.attempt;
      fs.mkdirSync(attemptDirectory,{recursive:true,mode:0o700});
      fs.writeFileSync(attemptDirectory+'/'+result.file,blob,{mode:0o600,flag:'wx'});
      const insertFrame = store.db.prepare('INSERT INTO frames VALUES(?,?,?,?,?,?,?,?,?,?,?)');
      for (const frame of result.frames) {
        const source=sources[frame.index];
        assert.equal(source.id,frame.id);assert.equal(source.hash,frame.original_hash);assert.equal(source.captured,frame.captured);
        insertFrame.run(frame.id,result.attempt,result.source,frame.index,'authored-compat-page',epoch+source.captured,frame.presentation_ms,epoch+source.captured+1,source.width,source.height,source.hash);
      }
      store.db.prepare(`INSERT INTO monitoring_video_segments(id,attempt,source,sha256,bytes,width,height,frame_count,source_bytes,created,verified,cleaned)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(result.segment,result.attempt,result.source,result.sha256,result.bytes,result.width,result.height,result.frames.length,fixture.source_bytes,ended+1000,ended+1000,ended+1000);
      const insertMapping=store.db.prepare('INSERT INTO monitoring_video_frames VALUES(?,?,?,?)');
      for(const frame of result.frames)insertMapping.run(frame.id,result.segment,frame.index,frame.decoded_sha256);
      const protectedFile=directory+'/submissions/compat-protected';fs.writeFileSync(protectedFile,'AUTHORED-PROTECTED-WORK',{mode:0o600});
      // All synthetic date normalization precedes this preservation baseline.
      const beforeAttempt=store.attempt(result.attempt),beforeFrames=store.db.prepare('SELECT * FROM frames ORDER BY id').all(),beforeEnrollments=store.db.prepare('SELECT * FROM enrollments').all();
      for(const table of ['attempt_grants','monitoring_video_jobs','monitoring_video_requests'])assert.equal(store.db.prepare('SELECT count(*) n FROM '+table).get().n,0);
      assert.deepEqual(fs.readdirSync(attemptDirectory),[result.file]);
      MonitoringVideoProcess.prototype.frames=async function(input){batches++;return originalBatch.call(this,input);};
      media=new MonitoringMedia(store);
      const check=async(image,frame,thumbnail)=>{
        assert.equal(image.id,frame.id);assert.equal(image.attempt,result.attempt);assert.equal(image.thumbnail,thumbnail);
        const source=sources[frame.index];
        assert.deepEqual(image.provenance,{encoding:'vp9-webm-v1',capture_sha256:source.hash,capture_width:source.width,capture_height:source.height,segment:result.segment,segment_sha256:result.sha256,index:frame.index,decoded_sha256:frame.decoded_sha256});
        const metadata=await sharp(image.data).metadata();assert.equal(metadata.format,'jpeg');
        assert.equal(metadata.width,thumbnail?256:result.width);assert.equal(metadata.height,thumbnail?192:result.height);
      };
      await check(await media.read(result.frames[0].id,false,'release-smoke',result.attempt),result.frames[0],false);
      await check(await media.read(result.frames[0].id,true,'release-smoke',result.attempt),result.frames[0],true);
      session=media.createReadSession();const beforeBatches=batches;
      for(const frame of result.frames)for(const thumbnail of [false,true])await check(await session.read(frame.id,thumbnail,'release-smoke',result.attempt),frame,thumbnail);
      assert.equal(batches-beforeBatches,1,'one isolated decode for the whole export segment');
      assert.deepEqual(store.attempt(result.attempt),beforeAttempt);assert.deepEqual(store.db.prepare('SELECT * FROM frames ORDER BY id').all(),beforeFrames);assert.deepEqual(store.db.prepare('SELECT * FROM enrollments').all(),beforeEnrollments);
      assert.equal(fs.readFileSync(protectedFile,'utf8'),'AUTHORED-PROTECTED-WORK');assert.deepEqual(fs.readdirSync(attemptDirectory),[result.file]);
      // A durable deletion must fence buffered images and still-present orphan video.
      store.db.prepare('INSERT INTO tombstones VALUES(?,?)').run(result.attempt,Date.now());
      await assert.rejects(session.read(result.frames[0].id,true,'release-smoke',result.attempt),error=>error.statusCode===410);
      await assert.rejects(media.read(result.frames[0].id,false,'release-smoke',result.attempt),error=>error.statusCode===410);
      assert(fs.existsSync(attemptDirectory+'/'+result.file));assert.equal(fs.readFileSync(protectedFile,'utf8'),'AUTHORED-PROTECTED-WORK');
      assert.deepEqual(store.attempt(result.attempt),beforeAttempt);
      videoCompatibility={format:fixture.format,producer:fixture.producer,frames:result.frames.length,clip_sha256:result.sha256,existingRgb24HashesVerified:true,noOriginalJpegFallback:true,defaultAndThumbnailReads:true,oneBatchDecode:true,captureProvenancePreserved:true,deletionFenceWithBufferedAndOrphanVideo:true,protectedWorkPreserved:true};
    } finally {
      session?.close();if(media)await media.close();MonitoringVideoProcess.prototype.frames=originalBatch;store.close();fs.rmSync(directory,{recursive:true,force:true});
    }
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
  console.log(JSON.stringify({uid:process.getuid(), productionMaintenance:true, schema:expected.target_schema,
    schemaVersionRowsPreserved:true, exactSchemaStartup:expected.from_schema===expected.target_schema,oldRowsPreserved,videoCompatibility,
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
        tables_before = []
        for table in db.execute("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").fetchall():
            name = table['name']
            assert re.fullmatch(r'[a-zA-Z_][a-zA-Z0-9_]*', name)
            keep_rowid = args.from_schema >= 36 and 'WITHOUT ROWID' not in table['sql'].upper()
            columns = 'rowid AS __smoke_rowid,*' if keep_rowid else '*'
            rows = [dict(row) for row in db.execute('SELECT '+columns+' FROM "'+name+'"')]
            if rows:
                tables_before.append({'name':name,'rowid':keep_rowid,'rows':rows})
        expected = {'attempts':[dict(row) for row in db.execute('SELECT * FROM attempts ORDER BY id')],
                    'enrollments':[dict(row) for row in db.execute('SELECT * FROM enrollments ORDER BY username')],
                    'exam_config':settings, 'from_schema':args.from_schema, 'target_schema':args.target_schema,
                    'tables_before':tables_before,
                    'schema_versions':[dict(row) for row in db.execute('SELECT * FROM schema_version ORDER BY version')]}
        db.commit(); db.close()
        (fixture / 'expected.json').write_text(json.dumps(expected))
        if args.target_schema >= 37:
            video_fixture = project / 'tests/fixtures/monitoring-video-v1'
            manifest = json.loads((video_fixture / 'manifest.json').read_text())
            video = (video_fixture / 'segment.webm').read_bytes()
            assert hashlib.sha256(video).hexdigest() == manifest['result']['sha256']
            assert len(video) == manifest['result']['bytes']
            (fixture / 'video-compat.webm').write_bytes(video)
            (fixture / 'video-compat.json').write_text(json.dumps(manifest))
        for path in fixture.iterdir():
            path.chmod(0o600)
            assert path.is_file() and not path.is_symlink()
            assert path.stat().st_uid == os.getuid() and path.stat().st_nlink == 1
        private_paths = ' '.join('/opt/release-smoke/' + path for path in
            (['config.json', 'gateway.key', 'callback.pub', 'metadata.sqlite', 'expected.json'] +
             (['video-compat.json', 'video-compat.webm'] if args.target_schema >= 37 else [])))
        (staging / 'Dockerfile').write_text('FROM ' + base + '\nUSER root\nCOPY fixture /opt/release-smoke\n'
            'LABEL ' + label + '="' + nonce + '"\n'
            'RUN chown -R 10001:10001 /opt/release-smoke && chmod 700 /opt/release-smoke && chmod 600 ' + private_paths + '\n'
            'USER 10001:10001\nENV EXAM_CONFIG=/opt/release-smoke/config.json\n'
            'ENTRYPOINT ["/bin/sh","-c","cp /opt/release-smoke/metadata.sqlite /data/metadata.sqlite && exec node dist/apps/server/src/main.js"]\n')
        run(docker + ['build', '--tag', tag, str(staging)], timeout=120)
        fixture_image = True
        container = run(docker + ['create', '--name', container_name, '--label', label + '=' + nonce,
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
            found = subprocess.run(docker + ['inspect', container_name], capture_output=True, text=True, timeout=10)
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
