#!/usr/bin/env python3
"""Actual candidate startup, signed idle-poll expiry and live-policy freshness.

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
        run(docker+['stop','--time','5',container],timeout=12)
        before=json.loads(run(docker+['inspect',container]))[0];assert before['State']['ExitCode']==0
        previous=root/'previous.sqlite'
        with sqlite3.connect(dbpath) as source,sqlite3.connect(previous) as target:source.backup(target)
        proof_started=int(time.time()*1000)
        def proof():
            with sqlite3.connect('file:'+str(dbpath)+'?mode=ro',uri=True) as db:
                db.execute('PRAGMA query_only=ON');db.execute('ATTACH DATABASE ? AS previous',('file:'+str(previous)+'?mode=ro',));db.execute('BEGIN')
                return deploy.preservation.verify(db,proof_started,int(time.time()*1000),config['agent']['id'])
        def verified(image):
            assert rollout.execution_policy_ready()
            reply=http('/health/ready');assert reply['status']==200 and json.loads(reply['body'])['productionReady'] is True
            return proof()
        rollout.verified=verified
        def command(args,timeout=30):
            if failures: raise AssertionError('Private sender failed immediately: '+failures[0])
            words=list(map(str,args))
            if words[:3]==['/usr/bin/systemctl','start','ssh-exam.service']:
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
        assert len(result['preserved_tables'])==41 and not sql(dbpath,'SELECT id FROM attempt_grants')
        assert not sql(dbpath,'SELECT nonce FROM agent_management_nonces WHERE nonce=?',(original['nonce'],))
        inspection=json.loads(run(docker+['inspect',container]))[0]
        assert inspection['Image']==base['Id'] and inspection['Config']['User']=='10001:10001'
        assert inspection['HostConfig']['ReadonlyRootfs'] and inspection['HostConfig']['NetworkMode']=='none' and inspection['HostConfig']['CapDrop']==['ALL']
        print(json.dumps({'status':'PASS','base_image':base['Id'],'qualified_export_config':qualified['config_id'],'rootfs_layers_match':True,
            'actual_startup_wait_seconds':elapsed,'publisher_interval_seconds':a.fresh_after_seconds,
            'old_ready_blocked':events['old_ready_blocked'],'expired_policy_blocked':events['expired_support_blocked'],'nonce_live_at_start':True,
            'real_signed_polls':len(polls),'production_wait_predicate':True,'preservation':result,
            'seams':['Synthetic readiness/kernel flags signed by private fixture key; real loaded roles/install qualified separately',
                     'Systemd start/inspect dispatched only to this exact owned Docker container; no production or institutional SSH/media'] }),flush=True)
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
