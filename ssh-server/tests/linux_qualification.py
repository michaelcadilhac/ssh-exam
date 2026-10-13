#!/usr/bin/env python3
"""Real SSH/cgroup qualification; run as root INSIDE a disposable systemd guest.
Requires its preinstalled agent, isolated work/rootfs and root-only test signing key.
Never run against a real student's state or home. Refuses non-fixture guard reports.
"""
import argparse, base64, hashlib, json, os, pathlib, pwd, select, subprocess, tarfile, time, uuid
from cryptography.hazmat.primitives.serialization import load_pem_private_key

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--username',default='mcadilha')
parser.add_argument('--key',default='/root/qualification-client')
parser.add_argument('--known-hosts',default='/root/qualification-known-hosts')
parser.add_argument('--gateway-key',default='/etc/exam-agent/gateway.key')
a=parser.parse_args()
assert os.geteuid()==0, 'Run as root inside the disposable guest'
config=json.loads(pathlib.Path('/etc/exam-agent/agent.json').read_text())
guards=json.loads(pathlib.Path(config['guard_report']).read_text())
assert guards.get('fixture','').startswith('Private qualification'), 'Not a disposable qualification fixture'
assert not config.get('functional_test_account'), 'Strict isolation required'
account=pwd.getpwnam(a.username)
key=load_pem_private_key(pathlib.Path(a.gateway_key).read_bytes(),None)
ssh=['ssh','-F','/dev/null','-i',a.key,'-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile='+a.known_hosts,'-o','BatchMode=yes','-o','ConnectTimeout=3','-o','LogLevel=ERROR']
target=a.username+'@127.0.0.1'
passed=[]
def ok(label):
    passed.append(label); print('PASS:',label,flush=True)
def run(args,**kw): return subprocess.run(args,capture_output=True,text=True,timeout=30,**kw)
def root(*args):
    p=run(list(args)); assert p.returncode==0,(args,p.stderr);return p.stdout

def info(id): return json.loads(root('examctl','info',id))
def wait_for(fn,timeout=70):
    end=time.monotonic()+timeout
    while time.monotonic()<end:
        if fn(): return
        time.sleep(.5)
    raise AssertionError('Timed out waiting for durable state')

class Connection:
    def __init__(self):
        self.socket='/root/qualification-'+uuid.uuid4().hex
        self.transport=''
        p=run([*ssh,'-M','-S',self.socket,'-fN',target]);assert p.returncode==0,p.stderr
    def close(self): run([*ssh,'-S',self.socket,'-O','exit',target])
    def raw(self,command,**kw): return run([*ssh,'-S',self.socket,target,command],**kw)
    def command(self,op,body=None):
        payload=json.dumps({'audience':config['agent_id'],'nonce':str(uuid.uuid4()),'expires':int(time.time()*1000)+29000,'username':a.username,'transport':self.transport,'op':op,'body':body or {}},separators=(',',':')).encode()
        frame=json.dumps({'payload':base64.b64encode(payload).decode(),'signature':base64.b64encode(key.sign(payload)).decode()})+'\n'
        p=self.raw('exam-control',input=frame); assert p.returncode==0,(p.stdout,p.stderr)
        value=json.loads(p.stdout)
        if 'error' in value: raise RuntimeError(value['error'])
        return value['result']
    def start(self):
        self.transport=self.command('register')['transport'];id=str(uuid.uuid4())
        self.command('prepare-attempt',{'id':id,'exam':'qualification','uid':account.pw_uid,'username':a.username,'transport':self.transport,'settings':{'duration':60,'earliest':0,'latest':int(time.time()*1000)+600000,'template':'qualification','terminals':4}})
        self.command('activate-attempt',{'id':id});return id
    def pane(self,id):
        token=self.command('issue-channel-admission',{'id':id,'username':a.username,'transport':self.transport,'pane':str(uuid.uuid4()),'purpose':'exam'})['token']
        p=subprocess.Popen([*ssh,'-S',self.socket,'-tt',target,'exam-gateway'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
        read_until(p,b'EXAM-GATE/1');p.stdin.write((json.dumps({'token':token})+'\n').encode());p.stdin.flush();read_until(p,b'EXAM-READY');return p

def read_until(p,needle,timeout=15):
    output=b''; end=time.monotonic()+timeout
    while time.monotonic()<end:
        if select.select([p.stdout],[],[],.2)[0]:
            data=os.read(p.stdout.fileno(),65536)
            if not data: break
            output+=data
            if needle in output:return output
    raise AssertionError(('Terminal marker missing',needle,output[-2000:]))
def denied(p,label):
    assert p.returncode!=0 and 'BYPASS' not in p.stdout,(label,p.returncode,p.stdout,p.stderr)
    ok(label)
def secure(id):
    x=info(id); assert x['protected'] and x['state']=='COMPLETED',x
    base=pathlib.Path(config['state'])/'submissions'/id
    archive=base/'submission.tar.gz'; checksum=hashlib.sha256(archive.read_bytes()).hexdigest()
    assert checksum==x['checksum'];assert base.stat().st_mode&0o077==0
    return x,archive,checksum

def check_jobs():
    # Checker must reject already scheduled account writers before activation.
    fixture=pathlib.Path('/etc/cron.d/qualification-writer')
    fixture.write_text('* * * * * '+a.username+' touch /tmp/scheduled-bypass\n')
    try:
        p=run(['/usr/local/sbin/exam-check-isolation']);assert p.returncode!=0 and 'system cron writer' in p.stderr
    finally:fixture.unlink()
    ok('preflight rejects system cron writer')
    p=run(['crontab','-u',a.username,'-'],input='* * * * * touch /tmp/user-cron-bypass\n');assert p.returncode==0,p.stderr
    try:
        p=run(['/usr/local/sbin/exam-check-isolation']);assert p.returncode!=0 and 'crontab' in p.stderr
    finally:root('crontab','-u',a.username,'-r')
    ok('preflight rejects user crontab')
    p=run(['su',a.username,'-c','echo BYPASS']);denied(p,'PAM rejects alternate su route')

check_jobs()
# Old authenticated connection and detached writer precede the activation barrier.
old=Connection(); current=Connection()
try:
    writer='/tmp/preexisting-writer'
    p=old.raw("nohup /bin/sh -c 'while :; do echo writing >> "+writer+"; sleep .1; done' >/dev/null 2>&1 </dev/null & echo STARTED")
    assert p.returncode==0 and 'STARTED' in p.stdout,p
    wait_for(lambda:pathlib.Path(writer).exists(),5)
    id=current.start();deadline=info(id)['deadline'];size=pathlib.Path(writer).stat().st_size;time.sleep(.4)
    assert pathlib.Path(writer).stat().st_size==size
    ok('activation terminates detached pre-existing writer')
    denied(old.raw('echo BYPASS'),'pre-existing multiplexed SSH channel denied')
    pane=current.pane(id)
    pane.stdin.write(b"printf saved-answer > /work/answer.txt; (while :; do echo write >> /work/background.txt; sleep .05; done) &\n");pane.stdin.flush()
    work=pathlib.Path(config['work'])/id/'work';wait_for(lambda:(work/'background.txt').exists(),10)
    current.command('renew-execution-lease',{'id':id})
    current.command('finalize-attempt',{'id':id})
    x,archive,checksum=secure(id);assert x['deadline']==deadline and x['access_state']=='HELD' and int(time.time()*1000)<deadline
    with tarfile.open(archive) as bundle: assert bundle.extractfile('answer.txt').read()==b'saved-answer'
    ok('early completion secures saved work and keeps original access hold')
    pane.wait(timeout=10);size=(work/'background.txt').stat().st_size;time.sleep(.4);assert (work/'background.txt').stat().st_size==size
    ok('finalization stops detached exam writer and terminal')
    for name,command in [('remote command','echo BYPASS'),('forged variables',"EXAM_ID=qualification EXAM_AUTHORIZED=true /bin/sh -c 'echo BYPASS'"),('SCP command','scp -f /work/answer.txt')]:
        denied(current.raw(command),name+' denied after early finish')
    p=run(['sftp','-F','/dev/null','-i',a.key,'-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile='+a.known_hosts,'-o','BatchMode=yes','-b','-',target],input='get /work/answer.txt\n')
    assert p.returncode!=0;ok('SFTP denied after early finish')
    fresh=Connection()
    try:
        try:fresh.command('register');raise AssertionError('Finished attempt reopened')
        except RuntimeError:ok('browser reload/fresh signed registration cannot reopen finished attempt')
        denied(fresh.raw('echo BYPASS'),'fresh direct SSH denied before original deadline')
    finally:fresh.close()
    root('systemctl','restart','exam-agent','exam-deadline-watchdog');wait_for(lambda:pathlib.Path(config['socket']).exists(),10)
    assert info(id)['deadline']==deadline and info(id)['access_state']=='HELD'
    denied(old.raw('echo BYPASS'),'agent/watchdog restart preserves original access hold')
    current.close()
    wait_for(lambda:info(id)['access_state']=='RELEASED',75)
    assert secure(id)[2]==checksum
    p=old.raw('printf ORDINARY-RESTORED');assert p.returncode==0 and 'ORDINARY-RESTORED' in p.stdout,p
    ok('ordinary access restores only after original deadline and protected collection')
finally:old.close();current.close()

# Class watchdog must finish locally while gate service and all clients are absent.
current=Connection()
try:
    id=current.start();pane=current.pane(id)
    pane.stdin.write(b'printf automatic-answer > /work/answer.txt; ln -s /etc/shadow /work/outside-link; mkfifo /work/unsafe-fifo\n');pane.stdin.flush()
    work=pathlib.Path(config['work'])/id/'work';wait_for(lambda:(work/'unsafe-fifo').exists(),10)
    current.close();root('systemctl','stop','exam-agent')
    wait_for(lambda:info(id)['state']=='COMPLETED',75)
    x,archive,checksum=secure(id);assert x['reason']=='expiration'
    with tarfile.open(archive) as bundle:
        assert bundle.extractfile('answer.txt').read()==b'automatic-answer'
        assert 'outside-link' not in bundle.getnames() and 'unsafe-fifo' not in bundle.getnames()
    ok('local deadline collection succeeds with no SSH/browser and gate service stopped')
    ok('student symlink and FIFO omitted without reading outside tree')
    root('systemctl','start','exam-agent');root('systemctl','restart','exam-deadline-watchdog')
    assert secure(id)[2]==checksum;ok('restart preserves the original protected archive')
    wait_for(lambda:info(id)['access_state']=='RELEASED',10)
finally:current.close();root('systemctl','start','exam-agent')

# Unsafe regular-file aliases fail collection; failures must retain the access hold.
wait_for(lambda:pathlib.Path(config['socket']).exists(),10)
current=Connection()
try:
    id=current.start();pane=current.pane(id)
    pane.stdin.write(b'printf recoverable > /work/answer.txt; ln /work/answer.txt /work/alias\n');pane.stdin.flush()
    work=pathlib.Path(config['work'])/id/'work';wait_for(lambda:(work/'alias').exists(),10)
    try:current.command('finalize-attempt',{'id':id})
    except RuntimeError:pass
    assert info(id)['state']=='COLLECTION_FAILED' and not info(id)['protected']
    current.close();wait_for(lambda:int(time.time()*1000)>info(id)['deadline']+1500,75)
    assert info(id)['access_state']=='HELD'
    c=Connection()
    try:denied(c.raw('echo BYPASS'),'collection failure retains access hold after deadline')
    finally:c.close()
    root('systemctl','restart','exam-agent','exam-deadline-watchdog')
    assert info(id)['access_state']=='HELD';ok('failed collection and hold survive restart')
    (work/'alias').unlink() # Explicit operator repair; never student retry/recollection of a secured archive.
    root('examctl','retry',id,'--reason','Qualification administrator repairs hardlink fixture')
    x,archive,checksum=secure(id)
    wait_for(lambda:info(id)['access_state']=='RELEASED',10)
    ok('operator repair retries failed collection and secures protected copy before release')
finally:current.close()
print(json.dumps({'passed':passed,'count':len(passed),'uid':account.pw_uid,'strict_isolation':True}),flush=True)
