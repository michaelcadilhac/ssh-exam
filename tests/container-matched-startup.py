#!/usr/bin/env python3
"""Actual candidate startup, purge rechecks and CURRENT-data forward recovery.

Only an owned local Docker container and synthetic data/keys are used. Systemd
dispatch is mapped to that exact container. Physical role/installation checks are
qualified separately in the disposable native guest; no institutional SSH/MFA,
SMTP delivery or production signoff is claimed by the synthetic readiness flags.
"""
import argparse
import base64
import datetime
import hashlib
from importlib.machinery import SourceFileLoader
import importlib.util
import json
import os
from pathlib import Path
import secrets
import shlex
import sqlite3
import subprocess
import tempfile
import threading
import time
from unittest.mock import patch
import uuid

from cryptography.hazmat.primitives.asymmetric import ed25519
from cryptography.hazmat.primitives import serialization

p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--image',required=True)
p.add_argument('--image-receipt',required=True,type=Path)
p.add_argument('--docker-host',default='unix:///var/run/docker.sock')
p.add_argument('--fresh-after-seconds',type=int,default=62)
a=p.parse_args()
assert 60 <= a.fresh_after_seconds <= 90, 'Exercise a real publisher interval, not a fast mock'
assert a.docker_host in ('unix:///var/run/docker.sock',f'unix:///run/user/{os.getuid()}/docker.sock')
assert Path(a.docker_host.removeprefix('unix://')).is_socket()
ROOT=Path(__file__).resolve().parents[1]; docker=['docker','--host',a.docker_host]
loader=SourceFileLoader('matched_startup_controller',str(ROOT/'scripts/deploy-web-ui'))
spec=importlib.util.spec_from_loader(loader.name,loader)
# The controller imports its existing sibling helpers.
import sys
sys.path.insert(0,str(ROOT/'scripts'))
deploy=importlib.util.module_from_spec(spec);loader.exec_module(deploy)
def run(words,timeout=30,data=None):
    r=subprocess.run(words,input=data,capture_output=True,text=True,timeout=timeout)
    if r.returncode: raise RuntimeError(str(words[:3])+' failed: '+(r.stdout+r.stderr)[-1800:])
    return r.stdout.strip()
def sql(path,query,args=()):
    with sqlite3.connect('file:'+str(path)+'?mode=ro',uri=True) as db:
        db.execute('PRAGMA query_only=ON'); return db.execute(query,args).fetchall()

base=json.loads(run(docker+['image','inspect',a.image]))[0]
qualified=json.loads(a.image_receipt.read_text())
assert base['Id']==qualified['engine_id'] and base['RootFS']['Layers']==qualified['layers'], 'Actual source image differs from verified export/rootfs'
nonce=uuid.uuid4().hex;name='ssh-exam-startup-'+nonce;label='ssh-exam.private-matched-startup'
container=None;thread=None;failures=[];events={};polls=[];stop=threading.Event()
with tempfile.TemporaryDirectory(prefix='ssh-exam-matched-startup-') as directory:
    root=Path(directory);root.chmod(0o700)
    data=root/'data';data.mkdir();data.chmod(0o2770)
    fixture=root/'fixture';fixture.mkdir(mode=0o750)
    project=root/'project';(project/'deploy/config').mkdir(parents=True)
    state=root/'controller';state.mkdir(mode=0o700)
    agent=ed25519.Ed25519PrivateKey.generate();gateway=ed25519.Ed25519PrivateKey.generate()
    private=lambda key:key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,serialization.NoEncryption())
    public=lambda key:key.public_key().public_bytes(serialization.Encoding.PEM,serialization.PublicFormat.SubjectPublicKeyInfo)
    (fixture/'gateway.key').write_bytes(private(gateway));(fixture/'callback.pub').write_bytes(public(agent))
    readiness={key:True for key in ('institutionalSSH','browserMatrix','serverGuards','protectedCollection','sshCommandTransport','statusCallbacks','intervalAccessHold','alerts')}
    (fixture/'readiness.json').write_text(json.dumps(readiness))
    config={'mode':'production','origin':'https://startup-qualification.invalid','data':'/data','port':3000,'maintenance':False,
        'jump':{'host':'jump.startup-qualification.invalid','pins':['a'*64]},
        'class':{'host':'class.startup-qualification.invalid','pins':['b'*64]},
        'agent':{'id':'startup-qualification','signingKey':'/fixture/gateway.key','callbackPublicKey':'/fixture/callback.pub','managementOperations':['grants.source-next']},
        'smtp':{'socket':'/tmp/no-synthetic-mail.sock','from':'test@startup-qualification.invalid','to':['test@startup-qualification.invalid']},
        'readinessFile':'/fixture/readiness.json'}
    (fixture/'config.json').write_text(json.dumps(config));(project/'deploy/config/config.json').write_text(json.dumps(config))
    for file in fixture.iterdir(): file.chmod(0o440)
    dbpath=data/'metadata.sqlite'
    with sqlite3.connect(dbpath) as db:
        for file in sorted((ROOT/'migrations').iterdir()):
            if file.suffix=='.sql' and file.stem.isdigit() and int(file.stem)<=37: db.executescript(file.read_text())
        settings=json.dumps({'id':'startup-qualification','name':'Synthetic history','duration':300,'webcam':False,'terminals':4,'template':'sample','earliest':1,'latest':2})
        db.execute('INSERT INTO exams VALUES(?,?)',('startup-qualification',settings))
        db.execute("INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline,ended,protected,checksum,access_state,policy_state,monitoring_mode) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            ('11111111-1111-4111-8111-111111111111','startup-qualification','synthetic',20001,'COMPLETED',settings,1,300001,300001,300001,1,'a'*64,'RELEASED','NORMAL','legacy'))
    dbpath.chmod(0o660)
    # The production DB and private monitoring root share the application owner.
    # The host runner remains unprivileged; a read-only root helper below executes
    # the exact preservation method without changing the worker's 0700 directory.
    run(docker+['run','--rm','--network','none','--read-only','--cap-drop','ALL',
        '--cap-add','CHOWN','--cap-add','DAC_OVERRIDE','--user','0',
        '--mount','type=bind,src='+str(data)+',dst=/fixture-data',
        '--entrypoint','node',a.image,'-e',"require('node:fs').chownSync('/fixture-data/metadata.sqlite',10001,"+str(os.getgid())+")"])
    old_preservation=run(['git','show','51dfc95:scripts/web-ui-ops/preservation.py'])
    (root/'old-preservation.py').write_text(old_preservation)
    verifier_source='''import importlib.util,json,sqlite3,sys,time
from importlib.machinery import SourceFileLoader
from pathlib import Path
sys.path.insert(0,'/source/scripts')
loader=SourceFileLoader('private_actual_rollout','/source/scripts/deploy-web-ui')
spec=importlib.util.spec_from_loader(loader.name,loader)
deploy=importlib.util.module_from_spec(spec);loader.exec_module(deploy)
r=object.__new__(deploy.Rollout);r.data=Path('/synthetic/data');r.state=Path('/synthetic/controller');r.project=Path('/synthetic/project')
r.release={'schema':37};r.record={'proof_started_ms':int(sys.argv[2])}
if sys.argv[1]=='current':
 print(json.dumps(r.preserved()))
else:
 db=sqlite3.connect('file:/synthetic/data/metadata.sqlite?mode=ro',uri=True)
 if sys.argv[1]=='old':
  spec=importlib.util.spec_from_file_location('private_old_preservation','/synthetic/old-preservation.py')
  module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
  db.execute('PRAGMA query_only=ON');db.execute("ATTACH DATABASE 'file:/synthetic/controller/snapshot/metadata.sqlite?mode=ro' AS previous")
  try:module.verify(db,int(sys.argv[2]),int(time.time()*1000),'startup-qualification')
  except AssertionError as error:
   assert str(error)=='Existing authority changed: monitoring_purges',str(error)
   print(json.dumps({'old_verifier_refused':str(error)}))
  else:raise AssertionError('Original verifier did not reproduce the purge-ledger refusal')
 elif sys.argv[1]=='preflight':
  deploy.preservation._physical_absence(db,r.data/'monitoring',['startup-due-purge'])
  metadata=(r.data/'metadata.sqlite').stat();monitoring=(r.data/'monitoring').stat()
  print(json.dumps({'physical_root_preflight':True,'metadata_uid':metadata.st_uid,'monitoring_uid':monitoring.st_uid,'monitoring_mode':oct(monitoring.st_mode&0o7777)}))
 elif sys.argv[1] in ('mutations','clone-preflight'):
  physical_db=db
  copy=sqlite3.connect(':memory:',uri=True);db.backup(copy);db=copy
  real_absence=deploy.preservation._physical_absence
  # SQL authority mutations use a disposable memory copy. The physical oracle
  # still checks the real readonly live DB path/owner and private root, unchanged.
  deploy.preservation._physical_absence=lambda _db,root,attempts:real_absence(physical_db,root,attempts)
  db.execute("ATTACH DATABASE 'file:/synthetic/controller/snapshot/metadata.sqlite?mode=ro' AS previous")
  def verify_mutable_authority():return deploy.preservation.verify(db,int(sys.argv[2]),int(time.time()*1000),'startup-qualification',r.data/'monitoring')
  if sys.argv[1]=='clone-preflight':
   assert verify_mutable_authority()['physical_purge_rechecks']==0
   print(json.dumps({'readonly_clone_attach_preflight':True}));sys.exit(0)
  assert verify_mutable_authority()['physical_purge_rechecks']==1
  changes=[
   ('history',"UPDATE attempts SET deadline=deadline+1"),
   ('new-retention-tombstone',"INSERT INTO tombstones VALUES('unreviewed-retention',1)"),
   ('tombstone-removal',"DELETE FROM tombstones WHERE attempt='startup-due-purge'"),
   ('extra-recheck',"UPDATE monitoring_purges SET tries=tries+1 WHERE attempt='startup-due-purge'"),
   ('incomplete-purge',"UPDATE monitoring_purges SET status='running',owner='unverified-owner' WHERE attempt='startup-due-purge'"),
   ('failed-purge',"UPDATE monitoring_purges SET status='retry',error='storage' WHERE attempt='startup-due-purge'"),
   ('changed-next',"UPDATE monitoring_purges SET next=next+1 WHERE attempt='startup-due-purge'"),
   ('outbox-delivery',"UPDATE outbox SET status='pending',tries=tries+1"),
   ('preview-expiry',"DELETE FROM previews"),
   ('video-job-reset',"UPDATE monitoring_video_jobs SET status='pending',owner=NULL"),
   ('interruption-recovery',"UPDATE attempt_interruptions SET outcome='historical'")]
  refused=[]
  for label,statement in changes:
   assert verify_mutable_authority()['physical_purge_rechecks']==1,label
   db.execute('SAVEPOINT mutation');assert db.execute(statement).rowcount>0,label
   try:verify_mutable_authority()
   except (AssertionError,ValueError):refused.append(label)
   else:raise AssertionError('Preservation accepted '+label)
   finally:db.execute('ROLLBACK TO mutation');db.execute('RELEASE mutation')
  print(json.dumps({'independent_mutation_refusals':refused,'positive_baseline_before_each_mutation':True,'physical_oracle_uses_real_readonly_database':True}))
 else:raise AssertionError('Unknown private verifier mode')
'''
    (root/'verify.py').write_text(verifier_source)
    def root_verify(mode='current'):
        # Installed host Python/stdlib only, mounted read-only at a private path.
        # No host root, Docker socket, production data or network is exposed.
        return json.loads(run(docker+['run','--rm','--network','none','--read-only',
            '--cap-drop','ALL','--cap-add','DAC_READ_SEARCH','--user','0',
            '--mount','type=bind,src=/usr/lib,dst=/qualification/lib,readonly',
            '--mount','type=bind,src='+str(Path('/usr/bin/python3').resolve())+',dst=/qualification/bin/python3,readonly',
            '--mount','type=bind,src='+str(ROOT)+',dst=/source,readonly',
            '--mount','type=bind,src='+str(root)+',dst=/synthetic,readonly',
            '--env','PYTHONHOME=/qualification','--env','PYTHONDONTWRITEBYTECODE=1',
            '--entrypoint','/qualification/lib/ld-linux-x86-64.so.2',a.image,
            '--library-path','/qualification/lib','/qualification/bin/python3',
            '/synthetic/verify.py',mode,str(proof_started)],timeout=15))
    http_script="""const fs=require('node:fs');const r=JSON.parse(fs.readFileSync(0,'utf8'));fetch('http://127.0.0.1:3000'+r.path,{method:r.method||'GET',headers:r.headers,body:r.body?Buffer.from(r.body,'base64'):undefined,signal:AbortSignal.timeout(3000)}).then(async x=>console.log(JSON.stringify({status:x.status,body:await x.text()}))).catch(e=>{console.error(e.name);process.exit(1)});"""
    def http(path,body=None,kind=None):
        raw=json.dumps(body,separators=(',',':')).encode() if body is not None else None
        request={'path':path}
        if raw is not None:request.update(method='POST',body=base64.b64encode(raw).decode(),headers={'Content-Type':kind,'X-Exam-Signature':base64.b64encode(agent.sign(raw)).decode()})
        return json.loads(run(docker+['exec','-i',container,'node','-e',http_script],data=json.dumps(request),timeout=8))
    def live():
        until=time.monotonic()+25
        while not stop.is_set():
            try:
                value=http('/health/live')
                if value['status']==200:return
            except RuntimeError:pass
            assert time.monotonic()<until,'Owned app did not become live'
            time.sleep(.1)
    sequence=0
    capabilities=['interval-access-hold','all-session-channel-gate','signed-ssh-control','durable-status-callbacks','server-only-submissions','clock-reset','deadline-timing-check','private-workspace-staging','collection-limits-v1']
    def health(policy=None):
        global sequence
        sequence+=1;now=int(time.time()*1000)
        value={'ready':True,'production_ready':True,'functional_test':False,'capabilities':list(capabilities),
            'native_roles':{'complete':True,'retained_enabled':True,'observed':now}}
        if policy is not None:
            value['capabilities'].append('live-exam-execution-policy-v1')
            value['execution_policy_support']={'schema':1,'capability':'live-exam-execution-policy-v1','observation_only':True,'supported':True,
                'observed':now-(120001 if policy=='expired' else 0),'roles':['agent','watchdog','source-worker'],'issues':[]}
        reply=http('/api/agent/events',{'agent':config['agent']['id'],'sequence':sequence,'at':now,'health':value},'application/vnd.ssh-exam-event')
        assert reply['status']==200,reply
    def poll(lifetime=30000):
        now=int(time.time()*1000);request={'version':1,'purpose':'ssh-exam-management/v1','audience':config['origin'],'agent':config['agent']['id'],'actor':'agent-root',
            'request':str(uuid.uuid4()),'nonce':secrets.token_hex(32),'issued':now,'expires':now+lifetime,'operation':'grants.source-next','body':{}}
        reply=http('/api/agent/management',request,'application/vnd.ssh-exam-management');assert reply['status']==200,reply
        frame=json.loads(reply['body']);raw=base64.b64decode(frame['payload']);gateway.public_key().verify(base64.b64decode(frame['signature']),raw)
        outcome=json.loads(raw);assert outcome['ok'] is True and outcome['result']=={'task':None},outcome
        polls.append(request);return request
    rollout=object.__new__(deploy.Rollout);rollout.project=project;rollout.data=data;rollout.state=state
    rollout.settings={'mode':'reviewed-web-native'};rollout.record={'phase':'NATIVE_UPDATED'}
    rollout.release={'schema':37};rollout.image={'config_id':base['Id'],'tag':a.image}
    rollout.env=state/'environment';rollout.env.write_text('EXAM_IMAGE='+a.image+'\n');rollout.env.chmod(0o600)
    (state/'environment-before').write_bytes(rollout.env.read_bytes())
    try:
        container=run(docker+['create','--name',name,'--label',label+'='+nonce,'--read-only','--network','none','--cap-drop','ALL','--security-opt','no-new-privileges',
            '--group-add',str(os.getgid()),'--mount','type=bind,src='+str(fixture)+',dst=/fixture,readonly',
            '--mount','type=bind,src='+str(data)+',dst=/data','--tmpfs','/tmp:rw,nosuid,nodev,mode=1777,size=64m',
            '--env','EXAM_CONFIG=/fixture/config.json','--memory','512m','--cpus','1',
            '--health-cmd',shlex.join(['node','-e',"fetch('http://127.0.0.1:3000/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]),
            '--health-interval','20s','--health-timeout','5s','--health-retries','3','--health-start-period','30s',a.image])
        run(docker+['start',container]);live();health();original=poll(30000)
        # Stable historical inputs make independent startup writers observable.
        # The expired legacy history is already scrubbed during this warm boot.
        run(docker+['exec',container,'node','-e',"const fs=require('node:fs');fs.chmodSync('/data/monitoring',0o700);fs.writeFileSync('/data/submissions/preserved-synthetic.txt','protected synthetic submission',{mode:0o600});fs.writeFileSync('/data/monitoring-video-deploy.pause','private qualification pause',{mode:0o600})"])
        run(docker+['stop','--time','5',container],timeout=12)
        before=json.loads(run(docker+['inspect',container]))[0];assert before['State']['ExitCode']==0
        seeded=int(time.time()*1000);verified_before=seeded-3600001
        with sqlite3.connect(dbpath) as db:
            db.execute('INSERT INTO tombstones VALUES(?,?)',('startup-due-purge',verified_before-1))
            db.execute("INSERT INTO monitoring_purges(attempt,status,owner,tries,next,updated,verified,error) VALUES(?,'verified-absent',NULL,7,?,?,?,NULL)",('startup-due-purge',verified_before+3600000,verified_before,verified_before))
            db.execute("INSERT INTO previews VALUES('preserved-preview','startup-qualification','[]',?,0)",(seeded,))
            db.execute("INSERT INTO outbox VALUES('preserved-sent','Synthetic prior mail','Preserve',1,1,'sent')")
            db.execute("INSERT INTO monitoring_video_jobs(attempt,status,next,updated) VALUES(?,'paused',?,?)",('11111111-1111-4111-8111-111111111111',seeded+3600000,seeded))
            # A separate recent completed history exercises closed interruptions;
            # the tombstone trigger correctly removed details of deleted history.
            db.execute("INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline,ended,protected,checksum,access_state,policy_state,monitoring_mode) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",('22222222-2222-4222-8222-222222222222','startup-qualification','recent-synthetic',20002,'COMPLETED',settings,seeded-300000,seeded,seeded,seeded,1,'b'*64,'RELEASED','NORMAL','v1'))
            db.execute("INSERT INTO attempt_interruptions(id,attempt,opened,generation,ended,outcome) VALUES('preserved-interruption',?, ?,1,?,'completed')",('22222222-2222-4222-8222-222222222222',seeded-1000,seeded))
        (state/'snapshot').mkdir(mode=0o700)
        previous=state/'snapshot/metadata.sqlite'
        with sqlite3.connect(dbpath) as source,sqlite3.connect(previous) as target:source.backup(target)
        previous_digest=hashlib.sha256(previous.read_bytes()).hexdigest();previous_inode=previous.stat().st_ino
        stable_exclusions={'monitoring_purges','agent_snapshot','agent_events','agent_attempt_sequence','agent_management_nonces','agent_management_requests','audit'}
        with sqlite3.connect(previous) as db:
            stable_tables={name:db.execute('SELECT rowid,* FROM "'+name+'" ORDER BY rowid').fetchall() for (name,) in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'") if name not in stable_exclusions}
            prior_purge=db.execute("SELECT * FROM monitoring_purges WHERE attempt='startup-due-purge'").fetchone()
        proof_started=int(time.time()*1000)
        root_preflight=root_verify('preflight')
        assert root_preflight['metadata_uid']==root_preflight['monitoring_uid']==10001 and root_preflight['monitoring_mode']=='0o700'
        print(json.dumps(root_preflight),flush=True)
        clone_preflight=root_verify('clone-preflight');assert clone_preflight['readonly_clone_attach_preflight']
        print(json.dumps(clone_preflight),flush=True)
        def proof():
            return root_verify()
        rollout.preserved=proof
        def verified(image):
            assert rollout.execution_policy_ready()
            reply=http('/health/ready');assert reply['status']==200 and json.loads(reply['body'])['productionReady'] is True
            return proof()
        rollout.verified=verified
        def command(args,timeout=30):
            if failures: raise AssertionError('Private sender failed immediately: '+failures[0])
            words=list(map(str,args))
            if words[:3]==['/usr/bin/systemctl','start','ssh-exam.service']:
                events['starts']=events.get('starts',0)+1
                events['actual_start']=time.monotonic();return run(docker+['start',container])
            if words==['/usr/bin/docker','inspect','ssh-exam-app-1']:
                raw=run(docker+['inspect',container]);assert 'Health' in json.loads(raw)[0]['State'],'Private fixture omitted production Compose healthcheck'
                return raw
            raise AssertionError('Unexpected privileged dispatch '+str(words))
        def sender():
            try:
                live();health();assert http('/health/ready')['status']==200
                assert not rollout.execution_policy_ready(),'Old ready roles incorrectly proved live-policy support'
                events['old_ready_blocked']=True;events['nonce_live_at_start']=original['expires']>rollout.record['latest_start_ms'];assert events['nonce_live_at_start']
                started=events['actual_start'];next_poll=time.monotonic();expired=False
                while time.monotonic()-started<a.fresh_after_seconds and not stop.is_set():
                    if time.monotonic()>=next_poll:poll();next_poll=time.monotonic()+5
                    if not expired and time.monotonic()-started>=32:
                        health('expired');assert not rollout.execution_policy_ready();events['expired_support_blocked']=True;expired=True
                    time.sleep(.1)
                if stop.is_set():return
                health('fresh');events['fresh_sent']=time.monotonic()
            except BaseException as error:
                failures.append(repr(error));print(json.dumps({'private_sender_failed':repr(error)}),flush=True);stop.set()
        thread=threading.Thread(target=sender,daemon=True);thread.start()
        with patch.object(deploy,'command',command):result=rollout.start(base['Id'],a.image)
        thread.join(timeout=8);assert not thread.is_alive();assert not failures,failures
        elapsed=time.monotonic()-events['actual_start'];assert elapsed>=a.fresh_after_seconds
        assert result['expired_after_proof_start_nonces_pruned']>=1,result
        assert result['audited_empty_queue_polls']>=10,result
        assert result['physical_purge_rechecks']==1,result
        old_refusal=root_verify('old');mutation_refusals=root_verify('mutations')
        current_purge=sql(dbpath,"SELECT * FROM monitoring_purges WHERE attempt='startup-due-purge'")[0]
        assert current_purge!=prior_purge and current_purge[1:4]==('verified-absent',None,8)
        assert current_purge[5]==current_purge[6] and current_purge[4]==current_purge[6]+3600000
        for table,rows in stable_tables.items():
            assert sql(dbpath,'SELECT rowid,* FROM "'+table+'" ORDER BY rowid')==rows,'Independent unchanged-table oracle: '+table
        assert run(docker+['exec',container,'node','-e',"process.stdout.write(require('node:fs').readFileSync('/data/submissions/preserved-synthetic.txt','utf8'))"])=='protected synthetic submission'
        # Reproduce the held NATIVE_UPDATED boundary, then use the real resume
        # branch and CURRENT ledger. Only external native/proxy transports are
        # synthetic; no restart, replacement snapshot or record reset is allowed.
        rollout.site=root/'site.conf';rollout.site.write_text('owned private maintenance fence')
        (state/'fenced.conf').write_bytes(rollout.site.read_bytes());(state/'normal.conf').write_text('private normal site')
        shared=root/'shared';shared.mkdir(mode=0o700);(shared/'source-cache.json').write_text('{}')
        rollout.settings['shared_store']=str(shared)
        rollout.record.update(guard={'history_sha256':'private-unchanged-history','attempts':2},proof_started_ms=proof_started,cutover_started=events['actual_start'])
        rollout.inputs_unchanged=lambda: (hashlib.sha256(previous.read_bytes()).hexdigest()==previous_digest) or (_ for _ in ()).throw(AssertionError('Original snapshot changed'))
        rollout.configuration_unchanged=lambda: ((fixture/'config.json').read_bytes()==(project/'deploy/config/config.json').read_bytes()) or (_ for _ in ()).throw(AssertionError('Configuration changed'))
        rollout.capacity=lambda: {'private_fixture':True}
        rollout.native=lambda after=False: {'fixture_native_transport':True}
        rollout.transition=lambda: ({'service_pids':{'fixture':'qualified-separately'}},'f'*64)
        def inventory(stopped=False):
            value=json.loads(run(docker+['inspect',container]))[0]
            assert value['State']['Running'] and not stopped
            assert sql(dbpath,"SELECT count(*) FROM attempts WHERE state IN ('PREPARING','ACTIVE','LOCKED','FINALIZING','COLLECTION_FAILED')")==[(0,)]
            assert sql(dbpath,'SELECT count(*) FROM sessions')==[(0,)]
            return {'image':value['Image'],'history_sha256':'private-unchanged-history','attempts':2}
        rollout.inventory=inventory
        def public(opened):
            assert http('/health/live')['status']==200
            assert rollout.site.read_bytes()==(state/('normal.conf' if opened else 'fenced.conf')).read_bytes()
        rollout.public=public;rollout.install_site=lambda value:rollout.site.write_bytes(value)
        rollout.release_background=lambda: None # The owned pause remains untouched.
        starts_before=events['starts'];running_before=json.loads(run(docker+['inspect',container]))[0]['State']['StartedAt']
        with patch.object(deploy,'command',command):rollout.resume()
        assert rollout.record['phase']=='ONLINE'
        assert events['starts']==starts_before==1
        assert json.loads(run(docker+['inspect',container]))[0]['State']['StartedAt']==running_before
        assert sql(dbpath,"SELECT * FROM monitoring_purges WHERE attempt='startup-due-purge'")[0]==current_purge
        assert previous.stat().st_ino==previous_inode and hashlib.sha256(previous.read_bytes()).hexdigest()==previous_digest
        assert len(result['preserved_tables'])==41 and not sql(dbpath,'SELECT id FROM attempt_grants')
        assert not sql(dbpath,'SELECT nonce FROM agent_management_nonces WHERE nonce=?',(original['nonce'],))
        inspection=json.loads(run(docker+['inspect',container]))[0]
        assert inspection['Image']==base['Id'] and inspection['Config']['User']=='10001:10001'
        assert inspection['HostConfig']['ReadonlyRootfs'] and inspection['HostConfig']['NetworkMode']=='none' and inspection['HostConfig']['CapDrop']==['ALL']
        print(json.dumps({'status':'PASS','base_image':base['Id'],'qualified_export_config':qualified['config_id'],'rootfs_layers_match':True,
            'actual_startup_wait_seconds':elapsed,'publisher_interval_seconds':a.fresh_after_seconds,
            'old_ready_blocked':events['old_ready_blocked'],'expired_policy_blocked':events['expired_support_blocked'],'nonce_live_at_start':True,
            'real_signed_polls':len(polls),'production_wait_predicate':True,'preservation':result,
            'physical_purge_rechecks':1,'original_verifier':old_refusal,'negative_controls':mutation_refusals,
            'current_data_resume':{'phase':rollout.record['phase'],'additional_starts':events['starts']-starts_before,'snapshot_unchanged':True,'current_purge_ledger_unchanged':True,'stable_tables_independently_checked':len(stable_tables)},
            'startup_writers_reviewed':['schema37 idempotent migrations','closed interruption recovery','existing sandbox definition','legacy active lock/lifecycle and preflight expiry require zero live attempts','logical retention requires no new tombstones or scrub','purge restart/backfill and due verified-absent recheck','video restart requires no running jobs; owned pause blocks encoding','nonexpired preview housekeeping','historical sent outbox cannot deliver','signed health callbacks and audited empty source polls'],
            'seams':['Synthetic readiness/kernel flags signed by private fixture key; real loaded roles/install qualified separately',
                     'Systemd start/inspect dispatched only to this exact owned Docker container; no production or institutional SSH/media',
                     'Real preservation runs in readonly root Python helper over synthetic binds; actual app monitoring owner10001/mode0700 unchanged',
                     'Recovery native receipt/public proxy transport are synthetic; real resume/preservation/coverage/phase files and candidate HTTP are exercised; pause release is deferred'] }),flush=True)
    finally:
        stop.set()
        if thread:thread.join(timeout=10)
        if container:
            owned=json.loads(run(docker+['inspect',container]))[0];assert owned['Config']['Labels'].get(label)==nonce
            if owned['State']['Running']:run(docker+['stop','--time','5',container],timeout=12)
            run(docker+['rm',container]);assert run(docker+['ps','-a','--no-trunc','--filter','id='+container,'--format','{{.ID}}'])==''
        # Only this owned synthetic bind directory; never follow links or mount a
        # production path. Restore caller ownership so TemporaryDirectory cleans it.
        cleanup="const fs=require('node:fs');const walk=p=>{const s=fs.lstatSync(p);if(s.isSymbolicLink())return;if(s.isDirectory()){fs.chownSync(p,0,0);fs.chmodSync(p,0o700);for(const n of fs.readdirSync(p))walk(p+'/'+n);}fs.chownSync(p,+process.argv[1],+process.argv[2]);if(s.isDirectory())fs.chmodSync(p,0o700);};walk('/cleanup');"
        run(docker+['run','--rm','--network','none','--read-only','--cap-drop','ALL','--cap-add','CHOWN','--cap-add','FOWNER','--user','0',
            '--mount','type=bind,src='+str(data)+',dst=/cleanup','--entrypoint','node',a.image,'-e',cleanup,str(os.getuid()),str(os.getgid())])
assert not root.exists()
print('Owned container absent; synthetic data/keys removed; exact base image preserved',flush=True)
