#!/usr/bin/env python3
"""Real SSH/cgroup qualification; run as root INSIDE a disposable systemd guest.
Requires its preinstalled agent, isolated work/rootfs and root-only test signing key.
Never run against a real student's state or home. Refuses non-fixture guard reports.
"""
import argparse, base64, hashlib, json, os, pathlib, pwd, select, subprocess, tarfile, time, uuid, grp, socket, tempfile, shutil, signal, threading, shlex, struct, fcntl, termios, stat, errno
from cryptography.hazmat.primitives.serialization import load_pem_private_key, load_pem_public_key

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--username',default='mcadilha')
parser.add_argument('--handoff-only',action='store_true',help='Verify automatic SSH handoff and cancel without starting time')
parser.add_argument('--setup-only',action='store_true',help='Focused temporary setup, lingering and offline-expiry recovery')
parser.add_argument('--worker-isolation',action='store_true',help='Real collection-worker death alongside another live SSH PTY; private overlay only')
parser.add_argument('--timed-owner',action='store_true',help='Real BrowserSSH timed owner, two shells, guest coordinator stop and current-policy pause; private overlay only')
parser.add_argument('--framed-owner',action='store_true',help='Actual C15 initial-grant Begin and scoped input/resize/replacement; private overlay only')
parser.add_argument('--retained-policy',action='store_true',help='Guarded test roles: actual CLI pause/verified frozen panes/fresh approved Continue; private overlay only')
parser.add_argument('--peer',help='Separate synthetic guest account for worker isolation')
parser.add_argument('--key',default='/root/qualification-client')
parser.add_argument('--known-hosts',default='/root/qualification-known-hosts')
parser.add_argument('--gateway-key',default='/etc/exam-agent/gateway.key')
a=parser.parse_args()
browser_mode=a.timed_owner or a.worker_isolation or a.framed_owner or a.retained_policy
assert os.geteuid()==0, 'Run as root inside the disposable guest'
config=json.loads(pathlib.Path('/etc/exam-agent/agent.json').read_text())
guards=json.loads(pathlib.Path(config['guard_report']).read_text())
assert guards.get('fixture','').startswith('Private qualification'), 'Not a disposable qualification fixture'
assert not config.get('functional_test_account'), 'Strict isolation required'
account=pwd.getpwnam(a.username)
temporary=config.get('temporary_account_policy',False)
baseline=(account.pw_shell, sorted(os.getgrouplist(a.username,account.pw_gid)), pathlib.Path('/var/lib/systemd/linger',a.username).exists())
key=load_pem_private_key(pathlib.Path(a.gateway_key).read_bytes(),None)
agent_key=load_pem_public_key(pathlib.Path('/etc/exam-agent/callback.pub').read_bytes()) if browser_mode else None
ssh=['ssh','-F','/dev/null','-i',a.key,'-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile='+a.known_hosts,'-o','BatchMode=yes','-o','ConnectTimeout=3','-o','LogLevel=ERROR']
target=a.username+'@127.0.0.1'
passed=[]
def ok(label):
    passed.append(label); print('PASS:',label,flush=True)
def run(args,**kw): return subprocess.run(args,capture_output=True,text=True,timeout=30,**kw)
def root(*args):
    p=run(list(args)); assert p.returncode==0,(args,p.stderr);return p.stdout

def info(id): return json.loads(root('examctl','info',id))
def wait_for(fn,timeout=70,interval=.5):
    end=time.monotonic()+timeout
    while time.monotonic()<end:
        if fn(): return
        time.sleep(interval)
    raise AssertionError('Timed out waiting for durable state')

def agent_ready():
    s=socket.socket(socket.AF_UNIX)
    try:s.connect(config['socket']);return True
    except OSError:return False
    finally:s.close()

class Connection:
    def __init__(self,keyfile=None,certificate=None,username=None):
        self.username=username or a.username
        self.exam='qualification'
        self.target=self.username+'@127.0.0.1'
        self.ssh=[*ssh]
        if keyfile:self.ssh[self.ssh.index('-i')+1]=keyfile
        if certificate:self.ssh+=['-o','CertificateFile='+certificate]
        self.keydir=None
        self.socket='/root/qualification-'+uuid.uuid4().hex
        self.transport=''
        p=run([*self.ssh,'-M','-S',self.socket,'-fN',self.target]);assert p.returncode==0,p.stderr
    def close(self):
        run([*self.ssh,'-S',self.socket,'-O','exit',self.target])
        if self.keydir:shutil.rmtree(self.keydir,ignore_errors=True);self.keydir=None
    def raw(self,command,**kw): return run([*self.ssh,'-S',self.socket,self.target,command],**kw)
    def command(self,op,body=None,nonce=None,discard_reply=False):
        body=dict(body or {})
        if browser_mode:body['browser_ssh']=True
        request={'audience':config['agent_id'],'nonce':nonce or str(uuid.uuid4()),'expires':int(time.time()*1000)+29000,'username':self.username,'transport':self.transport,'op':op,'body':body}
        payload=json.dumps(request,separators=(',',':')).encode()
        frame=json.dumps({'payload':base64.b64encode(payload).decode(),'signature':base64.b64encode(key.sign(payload)).decode()})+'\n'
        p=self.raw('exam-control',input=frame); assert p.returncode==0,(p.stdout,p.stderr)
        if discard_reply:return None # Receiver fault after actual native handling; recover only from the fresh query below.
        value=json.loads(p.stdout)
        if browser_mode:
            # The actual BrowserSSH protocol returns only proof. Never accept
            # an outer result/error or an unbound signed acknowledgment.
            proof=value['proof'];signed=base64.b64decode(proof['payload'],validate=True)
            agent_key.verify(base64.b64decode(proof['signature'],validate=True),signed)
            receipt=json.loads(signed)
            now=int(time.time()*1000)
            assert receipt['agent']==config['agent_id'] and receipt['type']=='ssh-command-receipt' and receipt['nonce']==request['nonce'] and receipt['username']==self.username
            assert now<receipt['expires']<=now+120000
            assert op=='register' or receipt['transport']==self.transport
            if receipt['error']:raise RuntimeError(receipt['error'])
            result=receipt['result']
            if op=='register':assert result['transport']==receipt['transport'] and len(receipt['transport'])==64
            return result
        if 'error' in value: raise RuntimeError(value['error'])
        return value['result']
    def start(self,activate=True,duration=60,initial_grant=False,issued=None):
        account=pwd.getpwnam(self.username)
        if issued:
            assert a.retained_policy and initial_grant and issued['grant']['kind']=='ADDITIONAL'
            self.exam=issued['exam'];duration=issued['settings']['duration']
        elif initial_grant:self.exam='qualification-framed-'+uuid.uuid4().hex[:12]
        self.transport=self.command('register',{'exam':self.exam})['transport'];id=str(uuid.uuid4())
        body={'id':id,'exam':self.exam,'uid':account.pw_uid,'username':self.username,'transport':self.transport,'browser_ssh':browser_mode,'settings':{'duration':duration,'earliest':0,'latest':int(time.time()*1000)+600000,'template':'qualification','terminals':4}}
        if issued:
            body['settings']=dict(issued['settings']);self.grant=dict(issued['grant']);body['grant']=self.grant
            self.page_epoch=hashlib.sha256(uuid.uuid4().bytes).hexdigest()
        elif initial_grant:
            assert (a.framed_owner or a.retained_policy) and temporary and self.username=='examq'
            body['settings']['earliest']=int(time.time()*1000)-1000
            # Author a new public synthetic package. The prepared legacy
            # template intentionally has private materials permissions; never
            # chmod that base or weaken immutable-catalog validation for it.
            authored=pathlib.Path(tempfile.mkdtemp(prefix='qualification-framed-source-',dir='/root'))
            for tree in ('work','materials'):(authored/tree).mkdir(mode=0o755)
            for relative,text in (('work/answer.txt','synthetic initial work\n'),('materials/instructions.txt','Private synthetic framing qualification\n')):
                path=authored/relative;path.write_text(text);path.chmod(0o644)
            if a.retained_policy:
                for name in ('asyncio-probe','thread-leader-probe'):
                    probe=authored/'work'/name
                    shutil.copyfile(pathlib.Path('/run/ssh-exam-qualification-input')/name,probe);probe.chmod(0o755)
            source=str(authored)
            version=json.loads(root('examctl','templates','validate',source))['info']['hash']
            root('examctl','templates','install','qualification',source,'--expected',version,'--reason','Private synthetic framed grant qualification')
            body['settings']['template_version']=version
            self.grant={'id':str(uuid.uuid4()),'revision':1,'hash':hashlib.sha256(json.dumps(body['settings'],sort_keys=True).encode()).hexdigest(),'issuance_order':1}
            body['grant']=self.grant
            self.page_epoch=hashlib.sha256(uuid.uuid4().bytes).hexdigest()
        self.command('prepare-additional-grant-attempt' if issued else 'prepare-grant-attempt' if initial_grant else 'prepare-attempt',body)
        if temporary:
            self.command('prepare-account-policy',{'id':id})
            try:self.command('activate-attempt',{'id':id});raise AssertionError('Bootstrap started exam')
            except RuntimeError:pass
            directory=tempfile.mkdtemp(prefix='qualification-handoff-',dir='/root')
            keyfile=directory+'/key';root('/usr/bin/ssh-keygen','-q','-t','ed25519','-N','','-f',keyfile)
            grant=self.command('issue-ssh-handoff',{'id':id,'public_key':pathlib.Path(keyfile+'.pub').read_text()})
            certfile=directory+'/key-cert.pub';pathlib.Path(certfile).write_text(grant['certificate']+'\n')
            denied(run([*ssh[:ssh.index('-i')+1],keyfile,*ssh[ssh.index('-i')+2:],'-o','CertificateFile='+certfile,self.target,'echo BYPASS']),'handoff certificate cannot launch an ordinary command')
            self.close()
            fresh=Connection(keyfile,certfile,self.username);self.socket=fresh.socket;self.ssh=fresh.ssh;self.keydir=directory;self.transport=""
            self.transport=self.command('register',{'exam':self.exam,'handoff':grant['id']})['transport']
            denied(run([*self.ssh,self.target,'echo BYPASS']),'consumed handoff certificate cannot authenticate another transport')
            assert info(id)['start']==0,'Setup consumed exam time'
        if activate:
            # Matching candidates require private staging before Begin. This
            # signed workflow must not consume time or publish writable /work.
            self.command('prepare-workspace',{'id':id})
            staged=info(id)
            assert not staged['start'] and not staged['deadline'] and not staged.get('original_deadline'), 'Staging consumed exam time'
            base=pathlib.Path(config['work'])/id
            assert not (base/'work').exists(), 'Staging exposed live work'
            receipt=json.loads((base/'workspace-ready/receipt.json').read_text())
            assert receipt['attempt']==id and receipt['uid']==account.pw_uid
            assert base.stat().st_mode&0o077==0 and (base/'workspace-ready').stat().st_mode&0o077==0
            staged_inode=(base/'workspace-ready/work').stat().st_ino
            activation={'id':id}
            if initial_grant:
                activation.update(settings=staged['settings'],grant=self.grant,grant_begin_intent=str(uuid.uuid4()),page_epoch=self.page_epoch)
                expected={'type':'grant-begin/v3' if a.retained_policy else 'grant-begin/v2','agent':config['agent_id'],'attempt':id,'exam':self.exam,'username':self.username,'uid':account.pw_uid,'grant':self.grant,'intent':activation['grant_begin_intent'],'transport':self.transport,'boot':pathlib.Path('/proc/sys/kernel/random/boot_id').read_text().strip(),'settings':staged['settings'],'page_epoch':self.page_epoch}
                if issued:
                    descriptor,temporary_registry=tempfile.mkstemp(prefix='qualification-additional-begin-',dir='/run')
                    try:
                        with os.fdopen(descriptor,'w') as registry:json.dump(expected,registry);registry.flush();os.fsync(registry.fileno())
                        os.replace(temporary_registry,'/run/qualification-framed-grant.json')
                    finally:pathlib.Path(temporary_registry).unlink(missing_ok=True)
                else:
                    descriptor=os.open('/run/qualification-framed-grant.json',os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
                    with os.fdopen(descriptor,'w') as registry:json.dump(expected,registry)
            if a.retained_policy and not issued:
                from overlay_guest import guest_watchdog_override, native_role_snapshot
                receipt_bytes=(base/'workspace-ready/receipt.json').read_bytes()
                with guest_watchdog_override('/usr/local/sbin/exam-agent'):
                    mismatch=native_role_snapshot(config)
                    assert mismatch['agent']['hash']==mismatch['watchdog']['hash'] and mismatch['agent']['exe']!=mismatch['watchdog']['exe']
                    try:
                        self.command('activate-monitored-grant-attempt',activation)
                        raise AssertionError('mixed loaded watchdog consumed the grant/clock')
                    except RuntimeError as error:
                        assert 'live native agent/watchdog agreement' in str(error),error
                    refused=info(id)
                    assert all(refused.get(k)==staged.get(k) for k in ('start','deadline','original_deadline','grant','grant_begin_intent','workspace','settings','transport'))
                    assert not (base/'work').exists() and (base/'workspace-ready/work').stat().st_ino==staged_inode
                    assert (base/'workspace-ready/receipt.json').read_bytes()==receipt_bytes
                repaired=native_role_snapshot(config)
                assert repaired['agent']['hash']==repaired['watchdog']['hash'] and repaired['agent']['exe']==repaired['watchdog']['exe']
                ok('actual signed Begin refuses a positively observed mixed loaded watchdog before clock/grant/work publication; exact source and intent remain retryable after private repair')
            self.command('activate-monitored-additional-grant-attempt' if issued and a.retained_policy else 'activate-monitored-grant-attempt' if a.retained_policy else 'activate-grant-attempt' if initial_grant else 'activate-attempt',activation)
            begun=info(id)
            assert begun['deadline']-begun['start']==duration*1000 and begun['original_deadline']==begun['deadline']
            assert (base/'work').stat().st_ino==staged_inode, 'Begin did not publish the exact staged directory'
            ok('private staging consumes no time; Begin publishes exact work and full allowance')
        return id
    def pane(self,id,framed=False,pane_id=None):
        pane_id=pane_id or str(uuid.uuid4())
        admission=self.command('issue-framed-owner-channel-admission' if framed else 'issue-channel-admission',{'id':id,'username':self.username,'transport':self.transport,'pane':pane_id,'purpose':'exam',**({'page_epoch':self.page_epoch} if framed else {})})
        token=admission['token']
        p=subprocess.Popen([*self.ssh,'-S',self.socket,'-tt',self.target,'exam-gateway'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
        read_until(p,b'EXAM-GATE/1');p.stdin.write((json.dumps({'token':token})+'\n').encode());p.stdin.flush()
        ready=read_until(p,b'EXAM-READY ',line=framed)
        if framed:
            value=json.loads(ready.split(b'EXAM-READY ',1)[1].split(b'\n',1)[0]);proof=value['proof'];payload=base64.b64decode(proof['payload'],validate=True)
            agent_key.verify(base64.b64decode(proof['signature'],validate=True),payload);receipt=json.loads(payload)
            assert receipt['type']=='ssh-pane-receipt' and receipt['nonce']==hashlib.sha256(token.encode()).hexdigest() and receipt['transport']==self.transport and receipt['username']==self.username and receipt['expires']>int(time.time()*1000)
            result=receipt['result'];assert result['attempt']==id and result['pane']==pane_id and result['input_protocol']==admission['input_protocol']=='v1' and result['input_epoch']==admission['input_epoch']
            p.input_epoch=admission['input_epoch'];p.native_pane=pane_id;p.input_sequence=0
        return p
    def input(self,p,data,epoch=None,sequence=None,kind=0,pane=None):
        if sequence is None:p.input_sequence+=1;sequence=p.input_sequence
        payload=data.encode() if isinstance(data,str) else data
        assert 0<sequence<=9007199254740991 and len(payload)<=32768 and kind in (0,1)
        header=struct.pack('!4sBBH32s16sQI',b'EXIN',1,kind,0,bytes.fromhex(epoch or p.input_epoch),uuid.UUID(pane or p.native_pane).bytes,sequence,len(payload))
        p.stdin.write(header+payload);p.stdin.flush()

def read_until(p,needle,timeout=15,line=False):
    output=b''; end=time.monotonic()+timeout
    while time.monotonic()<end:
        if select.select([p.stdout],[],[],.2)[0]:
            data=os.read(p.stdout.fileno(),65536)
            if not data: break
            output+=data
            if b'COMMAND_NOT_FOUND:' in output: raise RuntimeError(output.decode(errors='replace'))
            if needle in output and (not line or b'\n' in output.split(needle,1)[1]):return output
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

def retained_continue(connection,id,paused,previous,live,original,transition_fault=None):
    """Actual signed native Continue with one explicitly finite fixture approval."""
    body={'id':id,'generation':paused['generation'],'page_epoch':connection.page_epoch}
    try:
        connection.command('consume-monitored-continuation',body)
        raise AssertionError('Continue succeeded without current explicit fixture approval')
    except RuntimeError:pass
    assert info(id)['state']=='LOCKED' and all(p.poll() is None for p in live)
    approval={'previous_owner':previous,'generation':paused['generation'],'expires':min(original['deadline'],int(time.time()*1000)+60000)}
    descriptor,temporary=tempfile.mkstemp(prefix='qualification-retained-approval-',dir='/run')
    try:
        with os.fdopen(descriptor,'w') as registry:
            json.dump(approval,registry);registry.flush();os.fsync(registry.fileno())
        os.replace(temporary,'/run/qualification-retained-approval.json')
    finally:pathlib.Path(temporary).unlink(missing_ok=True)
    if transition_fault:
        qualify_partial_transition(connection,id,body,transition_fault,live,original,approval)
    result=connection.command('consume-monitored-continuation',body)
    continued=result['attempt'];assert continued['state']=='ACTIVE' and continued['transport']==original['transport']
    assert not continued.get('retained_hold') and all(continued[k]==original[k] for k in ('start','deadline','original_deadline','grant'))
    assert continued['registered_owner']['generation']==paused['generation']
    assert continued['registered_owner']['page_epoch']==connection.page_epoch
    assert set(result['input_epochs'])=={p.native_pane for p in live}
    for p in live:
        previous_epoch=p.input_epoch;p.input_epoch=result['input_epochs'][p.native_pane];p.input_sequence=0
        assert p.input_epoch!=previous_epoch
        connection.input(p,'exit\n',epoch=previous_epoch,sequence=1000)
    return continued


def qualify_partial_transition(connection,id,body,stage,live,original,approval):
    """Bounded compiled-role fault after real kernel or coordinator commit."""
    assert a.retained_policy and temporary and stage in ('scope-thawed','process-continued','coordinator-committed') and len(live)==2
    coordinator_loss=stage=='coordinator-committed'
    marker=pathlib.Path(config['state'])/'qualification-resume-transition'
    paths=[marker,pathlib.Path(str(marker)+'.observed'),pathlib.Path(str(marker)+'.release'),pathlib.Path(str(marker)+'.timed-out')]
    assert not any(p.exists() or p.is_symlink() for p in paths),'unexpected private fault evidence; preserve it'
    request={'attempt':id,'stage':stage,'block':True}
    descriptor=os.open(marker,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(descriptor,'w') as output:json.dump(request,output);output.flush();os.fsync(output.fileno())
    outcome=[]
    def consume():
        try:outcome.append(('returned',connection.command('consume-monitored-continuation',body)))
        except Exception as error:outcome.append(('error',type(error),str(error)))
    worker=threading.Thread(target=consume,daemon=True);worker.start()
    def kernel_state(units):
        frozen=[];states=[]
        for unit in units:
            directory=pathlib.Path('/sys/fs/cgroup/exam.slice')/unit
            frozen.append(int(dict(line.split() for line in (directory/'cgroup.events').read_text().splitlines())['frozen']))
            for tid in (directory/'cgroup.threads').read_text().split():
                try:status=dict(line.split(':',1) for line in (pathlib.Path('/proc')/tid/'status').read_text().splitlines() if ':' in line)
                except (FileNotFoundError,ProcessLookupError):continue
                assert int(status['Uid'].split()[0]) in (0,account.pw_uid)
                states.append(status['State'].split()[0]);assert len(states)<=256
        assert states,'owned scope task inventory is empty or unverified'
        return frozen,states
    try:
        observed=False;until=time.monotonic()+2
        while time.monotonic()<until:
            if paths[1].is_file():observed=True;break
            assert worker.is_alive(),('native command ended before transition checkpoint',outcome)
            time.sleep(.005)
        assert observed,('transition checkpoint was not observed before its independent bound',outcome)
        metadata=paths[1].lstat()
        assert stat.S_ISREG(metadata.st_mode) and metadata.st_mode&0o777==0o600 and metadata.st_uid==0 and metadata.st_nlink==1
        assert json.loads(paths[1].read_text())==request and worker.is_alive()
        observed=json.loads(root('examctl','panes','supervisor',id));units=observed['attached_units']
        assert len(units)==2 and set(units)==set(info(id)['units'])
        visible=False
        until=time.monotonic()+.5
        while time.monotonic()<until:
            frozen,states=kernel_state(units)
            visible=(sorted(frozen)==[0,1] and all(s in ('T','t','Z') for s in states)) if stage=='scope-thawed' else (frozen==[0,0] and any(s not in ('T','t','Z') for s in states) and (coordinator_loss or any(s in ('T','t') for s in states)))
            if visible:break
            time.sleep(.005)
        assert visible,('exact partial kernel transition not observed',stage,frozen,states)
        if coordinator_loss:
            pending=info(id) # Full supported attempt result; read-only DTO omits pending/grant fields.
            assert pending['state']=='ACTIVE' and pending['retained_hold']=='resuming' and pending['generation']==body['generation']
            pid=int(root('systemctl','show','exam-agent.service','--property=MainPID','--value').strip())
            handle=os.pidfd_open(pid)
            try:
                process=pathlib.Path('/proc',str(pid))
                assert process.stat().st_uid==0 and process.joinpath('cgroup').read_text().strip()=='0::/system.slice/exam-agent.service'
                assert os.path.samefile(process/'exe','/run/ssh-exam-qualification-input/core-qualification.test')
                signal.pidfd_send_signal(handle,0)
                signal.pidfd_send_signal(handle,signal.SIGKILL) # Exact private coordinator only; panes have separate owners.
                exited=select.poll();exited.register(handle,select.POLLIN)
                assert any(events&select.POLLIN for _,events in exited.poll(2000)),'pinned coordinator did not positively exit'
            finally:os.close(handle)
        for pane in live:connection.input(pane,'STALE-PARTIAL-KEYS\n')
        if stage=='process-continued':
            inventory=pathlib.Path(config['state'])/'qualification-rehold-inventory'
            assert not inventory.exists() and not pathlib.Path(str(inventory)+'.observed').exists()
            descriptor=os.open(inventory,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
            with os.fdopen(descriptor,'w') as output:
                json.dump({'attempt':id,'stage':'rehold-inventory'},output);output.flush();os.fsync(output.fileno())
    finally:
        if paths[1].is_file():
            descriptor=os.open(paths[2],os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
            with os.fdopen(descriptor,'w') as output:output.write('release');output.flush();os.fsync(output.fileno())
        worker.join(timeout=8)
    assert not worker.is_alive() and len(outcome)==1 and outcome[0][0]=='error',outcome
    if coordinator_loss:
        assert outcome[0][1] not in (subprocess.TimeoutExpired,TimeoutError) and not paths[3].exists(),outcome
        root('systemctl','start','exam-agent.service');wait_for(agent_ready,timeout=10,interval=.02)
        replacement=int(root('systemctl','show','exam-agent.service','--property=MainPID','--value').strip())
        assert replacement>0 and replacement!=pid and os.path.samefile(pathlib.Path('/proc',str(replacement),'exe'),'/run/ssh-exam-qualification-input/core-qualification.test')
        pending=info(id)
        assert all(pending[k]==original[k] for k in ('start','deadline','original_deadline','grant'))
        assert all(p.poll() is None for p in live) and json.loads(pathlib.Path('/run/qualification-retained-approval.json').read_text())==approval
        assert not marker.exists()
        paths[1].unlink();paths[2].unlink()
        ok('actual pinned coordinator SIGKILL after successful supervisor resume preserves SSH and pending canonical work; fresh coordinator retries the same approval and original interval')
        return
    assert outcome[0][1] is RuntimeError,outcome
    assert 'synthetic transition failure after '+stage in outcome[0][2] and not paths[3].exists(),outcome
    last_hold=None;hold_states=[];until=time.monotonic()+4
    while time.monotonic()<until:
        last_hold=json.loads(root('examctl','panes','supervisor',id)).get('retained_hold',{})
        if len(hold_states)<16 and (not hold_states or hold_states[-1]!=last_hold):hold_states.append(last_hold)
        if last_hold.get('phase')=='held':break
        time.sleep(.02)
    assert last_hold and last_hold.get('phase')=='held',('partial transition re-hold did not complete',stage,last_hold,hold_states)
    if any(observation.get('phase')=='unverified' for observation in hold_states):
        print('REHOLD_OBSERVED_RETRY',stage,json.dumps(hold_states),flush=True)
    frozen,states=kernel_state(units)
    assert frozen==[1,1] and all(s in ('T','t','Z') for s in states)
    pending=info(id)
    assert pending['state']=='ACTIVE' and pending['retained_hold']=='resuming' and pending['generation']==body['generation']
    assert all(pending[k]==original[k] for k in ('start','deadline','original_deadline','grant'))
    assert all(p.poll() is None for p in live) and json.loads(pathlib.Path('/run/qualification-retained-approval.json').read_text())==approval
    if stage=='process-continued':
        inventory=pathlib.Path(config['state'])/'qualification-rehold-inventory'
        receipt=pathlib.Path(str(inventory)+'.observed');metadata=receipt.lstat()
        assert not inventory.exists() and stat.S_ISREG(metadata.st_mode) and metadata.st_mode&0o777==0o600 and metadata.st_uid==0 and metadata.st_nlink==1
        assert json.loads(receipt.read_text())=={'attempt':id,'stage':'rehold-inventory'}
        receipt.unlink()
        ok('actual first re-hold inventory refusal is automatically retried through the same strict writer barrier without a new approval or restored execution permission')
    assert not marker.exists()
    paths[1].unlink();paths[2].unlink() # Only these validated disposable test controls.
    ok('actual '+stage+' fault positively observed, then all scopes/tasks re-held without losing SSH or changing original time/authorization; fresh same-approval retry follows')


def qualify_held_pane_closure(connection,id,continued,live,original,values):
    """Actual reviewed CLI closure of a held pane, then surviving-pane Continue."""
    assert a.retained_policy and temporary and len(live)==len(values)==2
    extra=connection.pane(id,framed=True);handles=[];scope=None
    try:
        value='close-'+uuid.uuid4().hex
        connection.input(extra,"buffer="+value+"; printf 'HELD-%s:%s\\n' ready \"$buffer\"\n")
        read_until(extra,('HELD-ready:'+value).encode(),timeout=3)
        root('examctl','pause',id,'--reason','Private held-pane closure and survivor recovery acceptance')
        paused=info(id);owner=json.loads(root('examctl','panes','supervisor',id))
        assert paused['state']=='LOCKED' and paused['retained_hold']=='held' and owner['attached_panes']==3
        try:
            connection.command('consume-monitored-continuation',{'id':id,'generation':paused['generation'],'page_epoch':connection.page_epoch})
            raise AssertionError('held-pane fixture unexpectedly consumed an approval before closure')
        except RuntimeError as error:
            assert 'approval is unavailable' in str(error),error
        prepared_at=time.monotonic() # Keep this exact cached three-pane intent live across closure.
        units=[unit for unit in owner['attached_units'] if extra.native_pane in unit];assert len(units)==1
        directory=pathlib.Path('/sys/fs/cgroup/exam.slice')/units[0]
        events=dict(line.split() for line in (directory/'cgroup.events').read_text().splitlines())
        assert events['frozen']==events['populated']=='1'
        scope=os.open(directory,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC)
        lifetime=select.poll();student=False
        for pid in (directory/'cgroup.procs').read_text().split():
            status=(pathlib.Path('/proc')/pid/'status').read_text()
            uids=list(map(int,next(line.split()[1:] for line in status.splitlines() if line.startswith('Uid:'))))
            assert uids in ([0]*4,[account.pw_uid]*4);student=student or uids==[account.pw_uid]*4
            handle=os.pidfd_open(int(pid));handles.append(handle);lifetime.register(handle,select.POLLIN)
        assert student and handles and not lifetime.poll(0),'held target lacks positively live pinned tasks'
        snapshot=json.loads(root('examctl','panes','show',id,extra.native_pane));pane=snapshot['panes'][0]
        assert snapshot['read_only'] and snapshot['complete'] and pane['recorded_present'] and not pane['unsafe_metadata']
        closed=json.loads(root('examctl','panes','close',id,extra.native_pane,'--revision',pane['revision'],'--reason','Private verified held-pane retirement acceptance'))
        assert closed['recorded_targets_quiesced'] and not closed['clock_changed'] and not closed['access_released']
        wait_for(lambda:len({fd for fd,event in lifetime.poll(0) if event&select.POLLIN})==len(handles),timeout=3,interval=.01)
        extra.wait(timeout=3)
        wait_for(lambda:json.loads(root('examctl','panes','supervisor',id))['attached_panes']==2,timeout=3,interval=.02)
        current=info(id)
        assert len(current['units'])==2 and all(current[k]==original[k] for k in ('start','deadline','original_deadline','grant'))
        assert time.monotonic()-prepared_at<10,'fixture missed the15s cached-intent boundary'
        print('CLOSED_HELD_SCOPE_OBSERVATION',units[0],'nlink',os.fstat(scope).st_nlink,'path_present',directory.exists(),flush=True)
        try:continued=retained_continue(connection,id,paused,continued['registered_owner'],live,original)
        except Exception:
            observation=run(['examctl','panes','supervisor',id])
            print('HELD_PANE_CLOSURE_RESUME_OBSERVATION',observation.stdout[:8192],observation.stderr[:1024],flush=True)
            raise
        for number,pane in enumerate(live):
            connection.input(pane,"printf 'HELD-%s:%s:END\\n' survivor \"$buffer\"\n")
            read_until(pane,('HELD-survivor:'+values[number]+':END').encode(),timeout=3)
        observed=json.loads(root('examctl','panes','supervisor',id))
        assert observed['pid']==owner['pid'] and observed['attached_panes']==2 and all(p.poll() is None for p in live)
        ok('actual reviewed close proves all held target tasks exited; approved Continue preserves the original two shells/buffers/SSH without stale retired-scope records or clock changes')
        return continued
    finally:
        for handle in handles:os.close(handle)
        if scope is not None:os.close(scope)
        if extra.poll() is not None:
            extra.stdin.close();extra.stdout.close()


def qualify_saved_source_grant(original):
    """Real root CLI pin -> actual saved staging/Begin/collection in this guest."""
    assert a.retained_policy and temporary and account.pw_uid>=1000
    def registry(value):
        descriptor,name=tempfile.mkstemp(prefix='qualification-saved-plan-',dir='/run')
        try:
            with os.fdopen(descriptor,'w') as output:json.dump(value,output);output.flush();os.fsync(output.fileno())
            os.replace(name,'/run/qualification-saved-source-grant.json')
        finally:pathlib.Path(name).unlink(missing_ok=True)
    old=info(original['id'])
    assert old['state']=='COMPLETED' and old['protected'] and old['access_state']=='RELEASED'
    # Legacy-shaped guest settings omit id; the real gateway's issued snapshot
    # includes the exam id. Author that complete new snapshot, not a weaker plan.
    settings=dict(old['settings'],id=old['exam'],duration=5400,earliest=int(time.time()*1000)-1000,latest=int(time.time()*1000)+600000)
    work={'kind':'saved','attempt':old['id'],'checksum':old['checksum']}
    grant={'id':str(uuid.uuid4()),'revision':1,'hash':hashlib.sha256(json.dumps({'settings':settings,'work':work},sort_keys=True).encode()).hexdigest(),
           'kind':'ADDITIONAL','issuance_order':old['grant']['issuance_order']+1,'initial_grant':old['grant']['id'],'work':work}
    plan={'version':1,'agent':config['agent_id'],'grant':grant,'exam':old['exam'],'username':a.username,'uid':account.pw_uid,'settings':settings,
          'source':{'attempt':old['id'],'checksum':old['checksum']},'action':'retain','current_revision':1,'status':'PENDING_NATIVE'}
    expected={'audience':config['callback_url'],'plan':plan};registry(expected)
    synchronized=json.loads(root('examctl','web','grants','source-sync',grant['id'],'--revision','1'))
    assert synchronized['confirmed'] and synchronized['result']['status']=='AVAILABLE'
    pin=json.loads(root('examctl','web','grants','source-show',grant['id'],'--revision','1'))
    assert pin['phase']=='retained' and pin['consumers']==[] and pin['plan']['settings']['duration']==5400
    refused=run(['examctl','delete',old['id'],'--reason','Private synthetic unused source dependency refusal'])
    assert refused.returncode!=0 and 'submission retained by saved-source grant' in refused.stderr, (refused.returncode,refused.stderr)
    ok('actual root source-sync signs fixed-purpose HTTPS, durably pins the real archive before availability and blocks unused-source deletion')
    live=pathlib.Path(config['work'])/old['id']/'work/retained-editor.txt'
    saved=live.read_bytes();assert saved
    live.write_bytes(b'Private synthetic stale live folder; restore must use the protected archive\n')
    connection=Connection();pane=None
    try:
        at=int(time.time()*1000)
        id=connection.start(duration=5400,initial_grant=True,issued=plan)
        active=info(id)
        assert id!=old['id'] and active['start']>=at and active['deadline']-active['start']==5400000 and active['original_deadline']==active['deadline']
        assert active['grant']==grant and active['workspace']['source']==dict(kind='saved',**plan['source'])
        assert active['workspace']['recovery_hash']==pin['retention_hash']
        assert (pathlib.Path(config['work'])/id/'work/retained-editor.txt').read_bytes()==saved
        assert all(info(old['id'])[key]==old[key] for key in ('start','deadline','original_deadline','grant','checksum','protected'))
        pane=connection.pane(id,framed=True)
        connection.input(pane,"IFS= read -r saved < /work/retained-editor.txt; printf 'SAVED-%s:END\\n' \"$saved\"\n")
        read_until(pane,('SAVED-'+saved.decode().splitlines()[0]+':END').encode(),timeout=3)
        ok('actual additional saved-work grant restores archived Nano bytes instead of the changed old live folder and starts its separate full ninety-minute interval only at Begin')
        work_directory=pathlib.Path(config['work'])/id/'work'
        writer_code="import signal,time\nsignal.signal(signal.SIGHUP,signal.SIG_IGN)\nf=open('/work/owner-death-writer','ab',buffering=0)\nwhile True:\n f.write(b'x');time.sleep(.005)"
        connection.input(pane,'python3 -c '+shlex.quote(writer_code)+" & writer=$!; printf '%s' \"$writer\" > /work/owner-death.pid; printf 'SAVED-OWNER-WRITER:END\\n'\n")
        read_until(pane,b'SAVED-OWNER-WRITER:END',timeout=3)
        writer_file=work_directory/'owner-death-writer'
        wait_for(lambda:writer_file.exists() and writer_file.stat().st_size>0,timeout=3,interval=.02)
        root('examctl','pause',id,'--reason','Private saved-work owner-death qualification')
        paused=info(id);assert paused['state']=='LOCKED' and paused['retained_hold']=='held'
        active=retained_continue(connection,id,paused,active['registered_owner'],[pane],active)
        size=writer_file.stat().st_size
        wait_for(lambda:writer_file.stat().st_size>size,timeout=2,interval=.02)
        owner=json.loads(root('examctl','panes','supervisor',id))
        assert owner['attached_panes']==1 and owner['registered_owner']==active['registered_owner']
        scope=next(unit for unit in owner['attached_units'] if pane.native_pane in unit)
        namespace_pid=(work_directory/'owner-death.pid').read_text()
        writers=[]
        for pid in (pathlib.Path('/sys/fs/cgroup/exam.slice')/scope/'cgroup.procs').read_text().split():
            status=dict(line.split(':',1) for line in (pathlib.Path('/proc')/pid/'status').read_text().splitlines() if ':' in line)
            if status['NSpid'].split()[-1]==namespace_pid and int(status['Uid'].split()[0])==account.pw_uid:writers.append(int(pid))
        assert len(writers)==1,'HUP-ignoring writer not positively identified in its real owned scope'
        writer_handle=os.pidfd_open(writers[0])
        try:
            signal.pidfd_send_signal(writer_handle,0)
            supervisor_handle=os.pidfd_open(owner['pid'])
            try:
                supervisor_proc=pathlib.Path('/proc')/str(owner['pid'])
                assert (supervisor_proc/'cgroup').read_text().strip()=='0::/examterminal.slice/'+owner['supervisor']
                assert os.path.samefile(supervisor_proc/'exe','/run/ssh-exam-qualification-input/core-qualification.test')
                signal.pidfd_send_signal(supervisor_handle,0)
                signal.pidfd_send_signal(supervisor_handle,signal.SIGKILL) # Exact pinned disposable owner only.
                owner_exit=select.poll();owner_exit.register(supervisor_handle,select.POLLIN)
                assert owner_exit.poll(3000),'pinned supervisor did not exit after the injected SIGKILL'
            finally:os.close(supervisor_handle)
            exited=select.poll();exited.register(writer_handle,select.POLLIN)
            assert exited.poll(8000),'verified supervisor death left its HUP-ignoring writer alive'
            pane.wait(timeout=8)
            wait_for(lambda:info(id)['state']=='LOCKED' and info(id)['reason']=='Class-server terminal recording failure',timeout=8,interval=.05)
            failed=info(id)
            assert failed['generation']==active['generation']+1
            assert all(failed[k]==active[k] for k in ('start','deadline','original_deadline','grant','registered_owner','access_state'))
            ok('actual supervisor SIGKILL after approved saved-work Continue contains the pinned HUP-ignoring writer and enforces owner loss without changing allowance/hold')
        finally:os.close(writer_handle)
        root('examctl','stop',id,'--reason','Private synthetic saved grant protected completion')
        wait_for(lambda:info(id)['state']=='COMPLETED' and info(id)['protected'],timeout=45)
        finished,archive,checksum=secure(id)
        assert finished['start']==active['start'] and finished['original_deadline']==active['original_deadline'] and finished['grant']==grant
        assert finished['access_state']=='HELD' and finished['original_deadline']>int(time.time()*1000)
        denied(run([*ssh,target,'echo SAVED-SOURCE-BYPASS']),'new saved-work completion keeps its original ninety-minute ordinary SSH restriction')
        plan['action'],plan['status']='release','CONSUMED';registry(expected)
        released=json.loads(root('examctl','web','grants','source-sync',grant['id'],'--revision','1'))
        assert released['confirmed'] and released['result']['state']=='RELEASED'
        current=json.loads(root('examctl','web','grants','source-show',grant['id'],'--revision','1'))
        assert current['phase']=='released' and current['retention_hash']==pin['retention_hash'] and current['consumers']==[id]
        assert info(id)['access_state']=='HELD' and all(info(old['id'])[key]==old[key] for key in ('start','deadline','original_deadline','checksum','protected'))
        ok('actual protected saved-work consumer permits explicit pin retirement while both submissions/history and the new original account hold remain intact')
    finally:
        if pane is not None and pane.poll() is None:pane.kill();pane.wait(timeout=5)
        connection.close()

def check_jobs():
    # Checker must reject already scheduled account writers before activation.
    fixture=pathlib.Path('/etc/cron.d/qualification-writer')
    fixture.write_text('* * * * * '+a.username+' touch /tmp/scheduled-bypass\n')
    try:
        p=run(['/usr/local/sbin/exam-account-policy','inspect','--username',a.username] if temporary else ['/usr/local/sbin/exam-check-isolation']);assert p.returncode!=0 and 'system cron writer' in p.stderr
    finally:fixture.unlink()
    ok('preflight rejects system cron writer')
    p=run(['crontab','-u',a.username,'-'],input='* * * * * touch /tmp/user-cron-bypass\n');assert p.returncode==0,p.stderr
    try:
        p=run(['/usr/local/sbin/exam-account-policy','inspect','--username',a.username] if temporary else ['/usr/local/sbin/exam-check-isolation']);assert p.returncode!=0 and 'crontab' in p.stderr
    finally:root('crontab','-u',a.username,'-r')
    ok('preflight rejects user crontab')
    if not temporary:
        p=run(['su',a.username,'-c','echo BYPASS']);denied(p,'PAM rejects alternate su route')

def normal_access(label):
    user=pwd.getpwnam(a.username)
    actual=(user.pw_shell,sorted(os.getgrouplist(a.username,user.pw_gid)),pathlib.Path('/var/lib/systemd/linger',a.username).exists())
    assert actual==baseline,(actual,baseline)
    root('systemctl','stop','exam-agent')
    try:
        c=Connection()
        try:
            p=c.raw('printf ORDINARY-RESTORED');assert p.returncode==0 and p.stdout=='ORDINARY-RESTORED',p
            p=run(['sftp','-F','/dev/null','-i',a.key,'-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile='+a.known_hosts,'-o','BatchMode=yes','-b','-',target],input='pwd\n')
            assert p.returncode==0,p.stderr
        finally:c.close()
    finally:
        root('systemctl','start','exam-agent')
        wait_for(agent_ready,40)
    ok(label)

wait_for(agent_ready,40)

if a.framed_owner or a.retained_policy:
    marker=json.loads(pathlib.Path('/run/ssh-exam-qualification-input/run.json').read_text())
    assert a.username=='examq' and marker['username']=='examq' and marker['profile']==('retained-policy' if a.retained_policy else 'framed-owner')
    assert pathlib.Path('/run/systemd/container').read_text().strip()=='systemd-nspawn' and temporary
    connection=Connection();panes=[]
    try:
        id=connection.start(duration=120 if a.retained_policy else 90,initial_grant=True);original=info(id)
        assert original['registered_owner']['page_epoch']==connection.page_epoch and original['registered_owner']['transport_hash']==connection.transport
        assert original['grant']==connection.grant and original['browser_ssh'] and original['terminal_supervised']
        ok('actual exact catalog source, initial-grant preparation and authenticated C15 Begin issue registered ownership without seeded state')
        values=['unsaved-'+uuid.uuid4().hex for _ in range(2)]
        for number in range(2):
            if not a.retained_policy:connection.command('renew-owner-execution-lease',{'id':id,'page_epoch':connection.page_epoch})
            pane=connection.pane(id,framed=True);panes.append(pane)
            connection.input(pane,"buffer="+values[number]+"; printf 'FRAMED-%s:%s:END\\n' initial \"$buffer\"\n")
            read_until(pane,('FRAMED-initial:'+values[number]+':END').encode())
            captured=json.loads(root('examctl','panes','show',id,pane.native_pane))
            assert captured['read_only'] and captured['complete'] and captured['panes'][0]['input_epochs']==[pane.input_epoch]
        owner=json.loads(root('examctl','panes','supervisor',id))
        assert owner['attached_panes']==2 and owner['registered_owner']==original['registered_owner']
        assert owner.get('ssh_peer')=='pinned-live', 'actual framed handoff did not pin the authenticated root SSH monitor from the original student socket'
        ok('two actual framed SSH shells share one attempt supervisor; signed pane receipts and root CLI agree on distinct input epochs')
        pane=panes[0]
        connection.input(pane,struct.pack('!II',38,113),kind=1)
        unit=next(unit for unit in owner['attached_units'] if pane.native_pane in unit)
        def resized():
            for item in (pathlib.Path('/sys/fs/cgroup/exam.slice')/unit/'cgroup.procs').read_text().split():
                pid=int(item);status=pathlib.Path('/proc',item,'status').read_text()
                uids=next(line.split()[1:] for line in status.splitlines() if line.startswith('Uid:'))
                if list(map(int,uids))!=[account.pw_uid]*4:continue
                pinned=os.pidfd_open(pid);descriptor=None
                try:
                    poll=select.poll();poll.register(pinned,select.POLLIN)
                    if poll.poll(0):continue
                    descriptor=os.open('/proc/'+item+'/fd/0',os.O_RDONLY|os.O_NOCTTY|os.O_CLOEXEC)
                    size=struct.unpack('HHHH',fcntl.ioctl(descriptor,termios.TIOCGWINSZ,bytes(8)))
                    if not poll.poll(0) and size[:2]==(38,113):return True
                finally:
                    if descriptor is not None:os.close(descriptor)
                    os.close(pinned)
            return False
        wait_for(resized,timeout=3,interval=.02)
        for invalid in ({'epoch':hashlib.sha256(uuid.uuid4().bytes).hexdigest(),'sequence':100},{'pane':str(uuid.uuid4()),'sequence':100},{'sequence':1}):
            connection.input(pane,'exit\n',**invalid)
        connection.input(pane,"printf 'FRAMED-%s:%s:END\\n' checked \"$buffer\"\n")
        read_until(pane,('FRAMED-checked:'+values[0]+':END').encode(),timeout=3)
        ok('actual scoped resize reaches the inner PTY; wrong epoch/pane and replayed exit frames are refused before a positive shell-memory response')
        old_epoch,old_pane=pane.input_epoch,pane.native_pane
        connection.input(pane,'exit\n');pane.wait(timeout=5)
        connection.command('close-pane',{'id':id,'pane':old_pane})
        if not a.retained_policy:connection.command('renew-owner-execution-lease',{'id':id,'page_epoch':connection.page_epoch})
        fresh=connection.pane(id,framed=True,pane_id=old_pane);panes.append(fresh)
        assert fresh.input_epoch!=old_epoch
        connection.input(fresh,'exit\n',epoch=old_epoch,sequence=100)
        connection.input(fresh,"printf 'FRAMED-%s:END\\n' replacement-live\n")
        read_until(fresh,b'FRAMED-replacement-live:END',timeout=3)
        connection.input(fresh,"buffer="+values[0]+"; printf 'FRAMED-%s:%s:END\\n' retained-ready \"$buffer\"\n")
        read_until(fresh,('FRAMED-retained-ready:'+values[0]+':END').encode(),timeout=3)
        connection.input(panes[1],"printf 'FRAMED-%s:%s:END\\n' sibling-live \"$buffer\"\n")
        read_until(panes[1],('FRAMED-sibling-live:'+values[1]+':END').encode(),timeout=3)
        current=info(id)
        assert all(current[k]==original[k] for k in ('start','deadline','original_deadline','grant','registered_owner')) and current['state']=='ACTIVE'
        ok('same UI UUID replacement receives a fresh native epoch; delayed old exit cannot kill it or its sibling or change time/grants')
        if a.retained_policy:
            request={'id':id,'reset_id':str(uuid.uuid4()),'actor':'private-qualification-instructor','requested_at':int(time.time()*1000),'remaining_seconds':60,'clock_revision':current.get('clock_revision',0),'deadline':current['deadline']}
            clocked=connection.command('reset-clock',request)
            assert clocked['clock_revision']==current.get('clock_revision',0)+1 and clocked['deadline']==request['requested_at']+60000
            assert all(clocked[k]==current[k] for k in ('start','original_deadline','grant','transport','units')) and clocked['state']=='ACTIVE'
            expected_owner={**current['registered_owner'],'clock_revision':clocked['clock_revision']}
            assert clocked['registered_owner']==expected_owner
            assert connection.command('reset-clock',request)['clock_resets']==clocked['clock_resets'], 'clock acknowledgement retry applied another allowance'
            registry=pathlib.Path('/run/qualification-framed-grant.json')
            expected=json.loads(registry.read_text());expected['clock_transfer']={'previous_owner':current['registered_owner'],'owner':expected_owner}
            descriptor,temporary_registry=tempfile.mkstemp(prefix='qualification-clock-transfer-',dir='/run')
            try:
                with os.fdopen(descriptor,'w') as output:json.dump(expected,output);output.flush();os.fsync(output.fileno())
                os.replace(temporary_registry,registry)
            finally:pathlib.Path(temporary_registry).unlink(missing_ok=True)
            original=clocked # Current interval baseline; immutable original_deadline/start/grant checked above.
            for number,p in enumerate((fresh,panes[1])):
                connection.input(p,"printf 'FRAMED-%s:%s:END\\n' clock-live \"$buffer\"\n")
                read_until(p,('FRAMED-clock-live:'+values[number]+':END').encode(),timeout=3)
            observed=json.loads(root('examctl','panes','supervisor',id))
            assert observed['registered_owner']==expected_owner and observed['pid']==owner['pid'] and observed['attached_panes']==2
            ok('actual signed instructor clock change/retry preserves both SSH shells/input and supervisor ownership; original deadline/grant remain immutable')
        try:
            root('examctl','pause',id,'--reason','Private synthetic retained policy pause acceptance' if a.retained_policy else 'Private synthetic current-policy framed pause control')
        except AssertionError:
            # Preserve the actual hold refusal BEFORE fixture cleanup retires
            # its shells. Bounded metadata only, never command lines/input.
            print('HOLD_REFUSAL_OBSERVATION',root('examctl','panes','supervisor',id),flush=True)
            for unit in current['units']:
                directory=pathlib.Path('/sys/fs/cgroup/exam.slice')/unit
                for tid in (directory/'cgroup.threads').read_text().split():
                    process=pathlib.Path('/proc')/tid
                    try:
                        status=(process/'status').read_text()
                        fields=[line for line in status.splitlines() if line.startswith(('Uid:','Tgid:','State:'))]
                        print('HOLD_REFUSAL_SCOPE_TASK',tid,fields,os.readlink(process/'exe'),flush=True)
                    except (FileNotFoundError,ProcessLookupError):continue
            observed=0
            for process in pathlib.Path('/proc').iterdir():
                if not process.name.isdecimal():continue
                try:
                    status=(process/'status').read_text()
                    uid_line=next(line.split()[1:] for line in status.splitlines() if line.startswith('Uid:'))
                    if account.pw_uid not in map(int,uid_line):continue
                    observed+=1;assert observed<=256,'Refusal diagnostic bound exceeded'
                    parent=next(line for line in status.splitlines() if line.startswith('PPid:'))
                    print('HOLD_REFUSAL_UID_PROCESS',process.name,parent,(process/'comm').read_text().strip(),os.readlink(process/'exe'),(process/'cgroup').read_text().strip(),flush=True)
                except (FileNotFoundError,ProcessLookupError):continue
            raise
        if a.retained_policy:
            assert all(p.poll() is None for p in (panes[1],fresh)), 'real CLI pause ended an existing authenticated SSH pane'
            paused=connection.command('inspect-attempt',{'id':id})
            assert paused['state']=='LOCKED' and paused['transport']==original['transport'] and paused['retained_hold']=='held'
            assert all(paused[k]==original[k] for k in ('start','deadline','original_deadline','grant'))
            held=json.loads(root('examctl','panes','supervisor',id))
            assert held['pid']==owner['pid'] and held['attached_panes']==2
            assert len(paused.get('units',[]))==2 and set(paused['units'])==set(held['attached_units']), 'retained writer ownership was discarded'
            for scope in held['attached_units']:
                assert scope.startswith('exam-'+id+'-') and scope.endswith('.scope')
                directory=pathlib.Path('/sys/fs/cgroup/exam.slice')/scope
                events=dict(line.split() for line in (directory/'cgroup.events').read_text().splitlines())
                assert events.get('frozen')=='1' and events.get('populated')=='1', 'retained hold lacks positive populated kernel freeze'
                guardians=0
                for tid in (directory/'cgroup.threads').read_text().split():
                    process=pathlib.Path('/proc')/tid;status=(process/'status').read_text()
                    task=dict(line.split(':',1) for line in status.splitlines() if ':' in line)
                    assert task['State'].split()[0] in ('T','t','Z'), 'freezer hid a task that was never positively stopped'
                    if task['Uid'].split()==['0']*4:
                        guardians+=1
                        assert os.path.samefile(process/'exe','/usr/bin/bwrap'), 'unexpected root task in owned pane scope'
                assert guardians>0,'real root Bubblewrap guardian path was not exercised'
            ok('actual CLI pause preserves authenticated SSH and two live pane owners with positively frozen kernel scopes')
            live=(fresh,panes[1])
            # Delayed input captured while locked must never execute after thaw.
            for p in live:connection.input(p,'exit\n')
            continued=retained_continue(connection,id,paused,original['registered_owner'],live,original)
            for number,p in enumerate(live):
                connection.input(p,"printf 'FRAMED-%s:%s:END\\n' continued \"$buffer\"\n")
                read_until(p,('FRAMED-continued:'+values[number]+':END').encode(),timeout=3)
            observation=json.loads(root('examctl','panes','supervisor',id))
            assert observation['pid']==owner['pid'] and observation['attached_panes']==2 and observation['ssh_peer']=='pinned-live'
            assert observation['registered_owner']==continued['registered_owner']
            ok('fresh explicitly approved native Continue preserves both shells/buffers/SSH and original time; locked and stale-epoch exit packets cannot execute')

            work=pathlib.Path(config['work'])/id/'work'
            writer_code="import time\nf=open('/work/retained-writer','ab',buffering=0)\nwhile True:\n f.write(b'x');time.sleep(.005)"
            connection.input(fresh,"PS1='RETAINED-PROMPT> '; sleep 60 & stopped=$!; kill -STOP \"$stopped\"; printf '%s' \"$stopped\" > /work/stopped.pid; python3 -c "+shlex.quote(writer_code)+" & writer=$!; nano -I -w /work/retained-editor.txt\n")
            read_until(fresh,b'Exit',timeout=5) # Actual Nano footer, not the echoed command.
            editor_value='buffer-'+uuid.uuid4().hex[:17];assert len(editor_value)==24
            connection.input(fresh,editor_value+'\x03')
            read_until(fresh,b'char 24/25',timeout=3) # Nano consumed the unsaved keys.
            assert not (work/'retained-editor.txt').exists()
            wait_for(lambda:(work/'retained-writer').exists() and (work/'retained-writer').stat().st_size>0,timeout=3,interval=.02)
            before=(work/'retained-writer').stat().st_size
            wait_for(lambda:(work/'retained-writer').stat().st_size>before,timeout=2,interval=.02)
            scope=next(unit for unit in observation['attached_units'] if fresh.native_pane in unit)
            directory=pathlib.Path('/sys/fs/cgroup/exam.slice')/scope
            namespace_pid=(work/'stopped.pid').read_text()
            stopped=[]
            for pid in (directory/'cgroup.procs').read_text().split():
                status=dict(line.split(':',1) for line in (pathlib.Path('/proc')/pid/'status').read_text().splitlines() if ':' in line)
                if status['NSpid'].split()[-1]==namespace_pid:stopped.append(int(pid))
            assert len(stopped)==1,'originally stopped job not positively identified in its real pane scope'
            stopped_handle=os.pidfd_open(stopped[0])
            intruder=subprocess.Popen(['/usr/bin/sleep','20'],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
            intruder_handle=os.pidfd_open(intruder.pid)
            try:
                (directory/'cgroup.procs').write_text(str(intruder.pid))
                assert str(intruder.pid) in (directory/'cgroup.procs').read_text().split() and intruder.poll() is None
                refused=run(['examctl','pause',id,'--reason','Private unexpected root task refusal control'])
                assert refused.returncode!=0 and 'hold is unverified' in refused.stderr
                rejected=json.loads(root('examctl','panes','supervisor',id))
                assert rejected['retained_hold']['phase']=='unverified' and 'installed trusted Bubblewrap' in rejected['retained_hold']['error']
                assert info(id)['state']=='LOCKED' and not (work/'retained-editor.txt').exists()
                ok('real CLI hold refuses an unrelated root executable in the owned pane scope without inventing a freeze receipt')
            finally:
                signal.pidfd_send_signal(intruder_handle,signal.SIGKILL);intruder.wait(timeout=3);os.close(intruder_handle)
            try:
                for cycle in range(12):
                    root('examctl','pause',id,'--reason','Private editor and background writer retention acceptance')
                    paused=info(id);assert paused['state']=='LOCKED' and paused['retained_hold']=='held'
                    stable=(work/'retained-writer').stat().st_size;time.sleep(.2)
                    assert (work/'retained-writer').stat().st_size==stable,'background writer advanced during verified hold'
                    assert not (work/'retained-editor.txt').exists()
                    signal.pidfd_send_signal(stopped_handle,0)
                    assert 'T'==next(line.split()[1] for line in pathlib.Path('/proc',str(stopped[0]),'status').read_text().splitlines() if line.startswith('State:'))
                    for p in live:connection.input(p,'STALE-EDITOR-KEYS\n')
                    fault=('scope-thawed','process-continued','coordinator-committed')[cycle] if cycle<3 else None
                    continued=retained_continue(connection,id,paused,continued['registered_owner'],live,original,transition_fault=fault)
                    if fault=='coordinator-committed':
                        time.sleep(16.2) # Beyond the original15s seed; positive fresh command requires renewed authority.
                        probe=uuid.uuid4().hex
                        connection.input(panes[1],"printf 'COORDINATOR-%s\\n' '"+probe+"'\n")
                        read_until(panes[1],('COORDINATOR-'+probe).encode(),timeout=3)
                    connection.input(fresh,'\x03');read_until(fresh,b'char 24/25',timeout=3)
                    wait_for(lambda:(work/'retained-writer').stat().st_size>stable,timeout=2,interval=.02)
                    signal.pidfd_send_signal(stopped_handle,0)
                    assert 'T'==next(line.split()[1] for line in pathlib.Path('/proc',str(stopped[0]),'status').read_text().splitlines() if line.startswith('State:'))
                connection.input(fresh,'\x0f');read_until(fresh,b'File Name to Write',timeout=3)
                connection.input(fresh,'\r');read_until(fresh,b'Wrote 1 line',timeout=3)
                assert (work/'retained-editor.txt').read_text()==editor_value+'\n','editor buffer changed or old keys leaked'
                connection.input(fresh,'\x18');read_until(fresh,b'RETAINED-PROMPT>',timeout=3)
                connection.input(fresh,"kill -KILL \"$stopped\" \"$writer\"; wait \"$writer\" \"$stopped\" 2>/dev/null; printf 'FRAMED-%s:%s:END\\n' editor-done \"$buffer\"\n")
                read_until(fresh,('FRAMED-editor-done:'+values[0]+':END').encode(),timeout=3)
                connection.input(panes[1],"printf 'FRAMED-%s:%s:END\\n' editor-peer \"$buffer\"\n")
                read_until(panes[1],('FRAMED-editor-peer:'+values[1]+':END').encode(),timeout=3)
                ok('actual Nano unsaved buffer, foreground shell and peer survive refusal/retry and twelve Continue cycles; writer stops/resumes and originally stopped job stays stopped')
            finally:os.close(stopped_handle)

            continued=qualify_held_pane_closure(connection,id,continued,live,original,values)

            # The existing manifested probe has a dead main thread and a live
            # foreground worker. Exercise the ACTUAL monitored hold/Continue,
            # rather than treating its separate kernel-only test as integration.
            connection.input(fresh,'/work/thread-leader-probe /work/thread-counter tty\n')
            reported=read_until(fresh,b'THREAD-TTY ',timeout=3,line=True)
            row=next(line for line in reported.splitlines() if line.startswith(b'THREAD-TTY ')).split()
            namespace_leader,namespace_worker=map(int,row[1:])
            assert namespace_leader!=namespace_worker
            memory='thread-'+uuid.uuid4().hex[:16]
            connection.input(fresh,'PUT '+memory+'\n')
            read_until(fresh,('THREAD-BUFFER 1 '+memory).encode(),timeout=3)
            scope=next(unit for unit in observation['attached_units'] if fresh.native_pane in unit)
            directory=pathlib.Path('/sys/fs/cgroup/exam.slice')/scope
            workers=[]
            for tid in (directory/'cgroup.threads').read_text().split():
                try:status=dict(line.split(':',1) for line in (pathlib.Path('/proc')/tid/'status').read_text().splitlines() if ':' in line)
                except (FileNotFoundError,ProcessLookupError):continue
                if int(status['Uid'].split()[0])==account.pw_uid and int(status['NSpid'].split()[-1])==namespace_worker and int(status['NStgid'].split()[-1])==namespace_leader:
                    workers.append((int(status['Tgid']),int(tid)))
            assert len(workers)==1,'surviving foreground worker not positively identified in its exact scope'
            leader,worker=workers[0]
            def task_state(pid):
                return next(line.split()[1] for line in (pathlib.Path('/proc')/str(pid)/'status').read_text().splitlines() if line.startswith('State:'))
            wait_for(lambda:task_state(leader)=='Z',timeout=1,interval=.01)
            assert task_state(worker) not in ('Z','T','t')
            assert os.path.samefile(pathlib.Path('/proc')/str(worker)/'exe',work/'thread-leader-probe')
            leader_handle=os.pidfd_open(leader)
            try:
                signal.pidfd_send_signal(leader_handle,0)
                root('examctl','pause',id,'--reason','Private actual dead-leader foreground retention')
                paused=info(id);assert paused['state']=='LOCKED' and paused['retained_hold']=='held'
                stable=(work/'thread-counter').stat().st_size;time.sleep(.15)
                assert (work/'thread-counter').stat().st_size==stable and task_state(worker)=='T' and task_state(leader)=='Z'
                continued=retained_continue(connection,id,paused,continued['registered_owner'],live,original)
                connection.input(fresh,'CHECK\n')
                read_until(fresh,('THREAD-BUFFER 2 '+memory).encode(),timeout=3)
                signal.pidfd_send_signal(leader_handle,0)
                wait_for(lambda:(work/'thread-counter').stat().st_size>stable,timeout=2,interval=.01)
                connection.input(fresh,'EXIT\n');read_until(fresh,b'RETAINED-PROMPT>',timeout=3)
                connection.input(fresh,"printf 'FRAMED-%s:%s:END\\n' thread-done \"$buffer\"\n")
                read_until(fresh,('FRAMED-thread-done:'+values[0]+':END').encode(),timeout=3)
                connection.input(panes[1],"printf 'FRAMED-%s:%s:END\\n' thread-peer \"$buffer\"\n")
                read_until(panes[1],('FRAMED-thread-peer:'+values[1]+':END').encode(),timeout=3)
                ok('actual dead-main-thread foreground worker stops through CLI hold and retains its acknowledged private buffer/job control through fresh Continue; peer and shell memory survive')
            finally:os.close(leader_handle)

            for kind,mode,dispatch in (('pipe','basic','normal'),('pipe','basic','forced'),('pipe','sqpoll','normal'),('pipe','sqpoll','forced'),('timer','basic','normal'),('timer','sqpoll','normal')):
                io_baseline=None
                for frozen in (False,True):
                    tag='uring-'+kind+'-'+mode+'-'+dispatch+('-held' if frozen else '-baseline')
                    connection.input(fresh,"mkfifo -m 600 /work/"+tag+"-data /work/"+tag+"-control; printf 'FRAMED-%s:END\\n' "+tag+"-fifos\n")
                    read_until(fresh,('FRAMED-'+tag+'-fifos:END').encode(),timeout=3)
                    fifo_handles=[]
                    try:
                        for name in (tag+'-data',tag+'-control'):
                            path=work/name;metadata=path.lstat()
                            assert metadata.st_uid==account.pw_uid and metadata.st_nlink==1 and metadata.st_mode&0o777==0o600
                            descriptor=os.open(path,os.O_RDWR|os.O_NONBLOCK|os.O_NOFOLLOW|os.O_CLOEXEC)
                            assert stat.S_ISFIFO(os.fstat(descriptor).st_mode)
                            fifo_handles.append(descriptor)
                        connection.input(fresh,"/work/asyncio-probe "+mode+' '+kind+' '+dispatch+' /work/'+tag+'-output 3</work/'+tag+'-data </work/'+tag+'-control > /work/'+tag+'-status 2>/work/'+tag+"-error & probe=$!; printf 'FRAMED-%s:END\\n' "+tag+"-running\n")
                        read_until(fresh,('FRAMED-'+tag+'-running:END').encode(),timeout=3)
                        def uring_phase(phase):
                            path=work/(tag+'-status')
                            if not path.exists():return None
                            raw=path.read_bytes();assert len(raw)<=8192
                            for line in raw.splitlines():
                                try:record=json.loads(line)
                                except json.JSONDecodeError:continue
                                if record['phase']==phase:return record
                            return None
                        wait_for(lambda:uring_phase('ready'),timeout=4,interval=.01)
                        ready=uring_phase('ready');assert ready['uid']==account.pw_uid and ready['completions']==0
                        output=work/(tag+'-output');assert output.stat().st_size==0
                        print('ACTUAL_LINKED_IO_PENDING',tag,json.dumps(ready),flush=True)
                        if frozen:
                            try:
                                root('examctl','pause',id,'--reason','Private pending linked asynchronous writer hold acceptance '+tag)
                            except AssertionError:
                                print('ASYNC_HOLD_REFUSAL',root('examctl','panes','supervisor',id),flush=True)
                                for scope in info(id)['units']:
                                    for tid in (pathlib.Path('/sys/fs/cgroup/exam.slice')/scope/'cgroup.threads').read_text().split():
                                        try:
                                            status=pathlib.Path('/proc',tid,'status').read_text()
                                            print('ASYNC_HOLD_SCOPE_TASK',tid,[line for line in status.splitlines() if line.startswith(('Name:','State:','Tgid:','Uid:','Kthread:'))],flush=True)
                                        except (FileNotFoundError,ProcessLookupError):pass
                                raise
                            paused=info(id);assert paused['state']=='LOCKED' and paused['retained_hold']=='held'
                            if kind=='timer':
                                assert time.clock_gettime_ns(time.CLOCK_BOOTTIME)//1000000<ready['expires'],'timer completed before hold; fixture inconclusive'
                            else:assert os.write(fifo_handles[0],b'X')==1
                            until=time.monotonic()+.2
                            if kind=='timer':until=time.monotonic()+max(0,(ready['expires']-time.clock_gettime_ns(time.CLOCK_BOOTTIME)//1000000)/1000)+.2
                            while time.monotonic()<until:time.sleep(.02)
                            assert output.stat().st_size==0,'pending asynchronous write advanced during verified hold'
                            assert uring_phase('done') is None
                            continued=retained_continue(connection,id,paused,continued['registered_owner'],live,original)
                        else:
                            if kind=='pipe':assert os.write(fifo_handles[0],b'X')==1
                            wait_for(lambda:output.stat().st_size==1,timeout=3,interval=.01)
                        assert os.write(fifo_handles[1],b'Q')==1
                        wait_for(lambda:uring_phase('done'),timeout=3,interval=.01)
                        completed=uring_phase('done')
                        expected={'phase':'done','first':-errno.ETIME if kind=='timer' else 1,'second':1,'saved':ord('X'),'dropped':0,'overflow':0}
                        assert completed==expected and (not frozen or completed==io_baseline),completed
                        assert output.read_bytes()==b'X' and not (work/(tag+'-error')).read_bytes()
                        connection.input(fresh,"wait \"$probe\"; printf 'FRAMED-%s:%s:END\\n' "+tag+"-done \"$buffer\"\n")
                        read_until(fresh,('FRAMED-'+tag+'-done:'+values[0]+':END').encode(),timeout=3)
                        if frozen:ok('actual linked '+kind+'/'+mode+'/'+dispatch+' stays unwritten while held and matches its positive baseline after fresh Continue')
                        else:io_baseline=completed
                    finally:
                        for descriptor in fifo_handles:os.close(descriptor)

            # A recorder's immutable identity predates all approved Continues.
            # Its real failure must still affect this exact current attempt,
            # never be dismissed merely because its original generation is old.
            before_fault=info(id)
            reports=json.loads(root('examctl','panes','reports',id))
            tracking=next(p for p in reports['pending_captured'] if p['pane']==fresh.native_pane)
            assert tracking['recording_generation']<before_fault['generation']
            assert tracking['continued_generation']==before_fault['generation']
            recording=pathlib.Path(config['state'])/'monitoring'/id/(fresh.native_pane+'.ndjson')
            metadata=recording.lstat()
            assert stat.S_ISREG(metadata.st_mode) and metadata.st_mode&0o777==0o600 and metadata.st_uid==0 and metadata.st_nlink==1
            recording.unlink() # Only this disposable synthetic log; pinned link count becomes zero.
            connection.input(fresh,"printf 'ACTUAL-CONTINUED-RECORDING-FAULT\\n'\n")
            wait_for(lambda:info(id)['state']=='LOCKED' and info(id)['reason']=='Class-server terminal recording failure',timeout=8,interval=.05)
            failed=info(id)
            assert failed['generation']==before_fault['generation']+1
            assert all(failed[k]==before_fault[k] for k in ('start','deadline','original_deadline','grant','registered_owner','access_state'))
            wait_for(lambda:fresh.poll() is not None,timeout=5,interval=.05)
            ok('actual continued recording fault is enforced through CLI reconciliation with unchanged original clocks/grant/hold; no old-generation false dismissal')
        else:
            wait_for(lambda:all(pane.poll() is not None for pane in panes),timeout=8,interval=.05)
            assert info(id)['state']=='LOCKED'
            ok('current policy still terminates framed panes on real pause; no partial retained mode enabled')
        root('examctl','stop',id,'--reason','Private synthetic framed qualification collection')
        wait_for(lambda:info(id)['state']=='COMPLETED' and info(id)['protected'],timeout=45)
        final,archive,checksum=secure(id)
        assert all(final[k]==original[k] for k in ('start','deadline','original_deadline','grant'))
        assert final['registered_owner']==(continued if a.retained_policy else original)['registered_owner']
        ok('actual protected collection preserves grant, page ownership and the original authoritative interval')
    finally:
        for pane in panes:
            if pane.poll() is None:pane.kill();pane.wait(timeout=5)
        connection.close()
    wait_for(lambda:info(id)['access_state']=='RELEASED' and info(id)['policy_state']=='NORMAL',timeout=max(0,max(original['deadline'],original['original_deadline'])/1000-time.time())+30)
    normal_access('original deadline restores ordinary SSH/SFTP after framed qualification without override')
    if a.retained_policy:
        # Separate real SSH-exit episode, after the source interval's verified
        # release and before the saved-source owner-death test. Do not weaken
        # that existing running-writer SIGKILL oracle by pre-holding its owner.
        # Retire only the test server's prior expected-request pointer. Keep
        # its exact inode as history; native grant/attempt/submission state is
        # never removed. No outstanding original interval may be replaced.
        prior=info(id)
        assert prior['state']=='COMPLETED' and prior['protected'] and prior['access_state']=='RELEASED' and prior['policy_state']=='NORMAL'
        assert all(prior[k]==original[k] for k in ('start','deadline','original_deadline','grant'))
        registry_path=pathlib.Path('/run/qualification-framed-grant.json')
        descriptor=os.open(registry_path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
        with os.fdopen(descriptor,'r') as registry:
            registry_stat=os.fstat(registry.fileno())
            assert stat.S_ISREG(registry_stat.st_mode) and registry_stat.st_nlink==1 and registry_stat.st_uid==0 and stat.S_IMODE(registry_stat.st_mode)==0o600 and registry_stat.st_size<=65536
            expected=json.load(registry)
        assert expected['attempt']==id and expected['grant']==prior['grant'] and expected['username']==prior['username']
        registry_history=registry_path.with_name('qualification-framed-grant-'+id+'.previous.json')
        assert not registry_history.exists()
        registry_path.rename(registry_history)
        assert registry_history.stat().st_ino==registry_stat.st_ino and not registry_path.exists()
        exited_connection=Connection();exited_panes=[]
        try:
            exited_id=exited_connection.start(duration=60,initial_grant=True)
            exited_original=info(exited_id)
            exited_pane=exited_connection.pane(exited_id,framed=True);exited_panes.append(exited_pane)
            exit_ready=uuid.uuid4().hex
            exited_connection.input(exited_pane,"printf 'SSH-EXIT-%s:END\\n' '"+exit_ready+"'\n")
            read_until(exited_pane,('SSH-EXIT-'+exit_ready+':END').encode())
            observed=json.loads(root('examctl','panes','supervisor',exited_id))
            assert observed['ssh_peer']=='pinned-live' and observed['registered_owner']==exited_original['registered_owner']
            assert not exited_original.get('ssh_exited_owner')
            root('examctl','pause',exited_id,'--reason','Private SSH-exit during existing policy hold')
            paused_exit=info(exited_id)
            assert paused_exit['state']=='LOCKED' and paused_exit['retained_hold']=='held' and paused_exit['monitoring_hold_kind']=='policy'
            assert not paused_exit.get('ssh_exited_owner')
            assert json.loads(root('examctl','panes','supervisor',exited_id))['ssh_peer']=='pinned-live'
            exited_connection.close() # Exact owned client control socket only.
            wait_for(lambda:info(exited_id).get('ssh_exited_owner')==exited_original['registered_owner'],timeout=10,interval=.1)
            exited=info(exited_id)
            assert all(exited[k]==paused_exit[k] for k in ('state','generation','reason','retained_hold','monitoring_hold_kind'))
            assert all(exited[k]==exited_original[k] for k in ('start','deadline','original_deadline','grant','registered_owner','access_state'))
            ok('actual SSH exit during a verified existing policy hold reports exact owner without changing cause/generation, interval, grant or restriction')
            root('examctl','stop',exited_id,'--reason','Private positive SSH-exit qualification collection')
            wait_for(lambda:info(exited_id)['state']=='COMPLETED' and info(exited_id)['protected'],timeout=45)
            secured,_,_=secure(exited_id)
            assert all(secured[k]==exited_original[k] for k in ('start','deadline','original_deadline','grant'))
        finally:
            for exited_pane in exited_panes:
                if exited_pane.poll() is None:exited_pane.kill();exited_pane.wait(timeout=5)
            exited_connection.close()
        wait_for(lambda:info(exited_id)['access_state']=='RELEASED' and info(exited_id)['policy_state']=='NORMAL',timeout=max(0,exited_original['deadline']/1000-time.time())+30)
        normal_access('SSH-exit collection preserves its original restriction until the deadline and restores ordinary access without override')
        qualify_saved_source_grant(info(id))
    print(json.dumps({'passed':passed,'count':len(passed),'framed_owner':True,'retained_lockout':a.retained_policy,'synthetic_capture':a.retained_policy}),flush=True)
    raise SystemExit(0)

if a.timed_owner:
    marker=json.loads(pathlib.Path('/run/ssh-exam-qualification-input/run.json').read_text())
    assert a.username=='examq' and marker['username']=='examq' and marker['profile']=='timed-owner'
    assert pathlib.Path('/run/systemd/container').read_text().strip()=='systemd-nspawn'
    assert temporary, 'Actual protected account-policy handoff required'
    connection=Connection(); panes=[]; pinned=[]; stopped=False
    try:
        id=connection.start(duration=60)
        original=info(id)
        assert original.get('browser_ssh') and original.get('terminal_supervised'), 'Timed owner mode was not selected through actual prepare/Begin'
        assert not original.get('registered_owner'), 'This native legacy fixture must not invent unified grant/page evidence'
        values=['unsaved-'+uuid.uuid4().hex for _ in range(2)]
        pids=[]
        for number in range(2):
            pane=connection.pane(id);panes.append(pane)
            # The joined marker is absent from echoed input: observe shell work,
            # not an allocated window, EXAM-READY line or a typed command echo.
            pane.stdin.write(("buffer="+values[number]+"; printf 'OWNER-%s%s:%s:END-%s\\n' READY- "+str(number)+" \"$$\" "+str(number)+"\n").encode());pane.stdin.flush()
            output=read_until(pane,(':END-'+str(number)).encode())
            identity=output.split(('OWNER-READY-'+str(number)+':').encode(),1)[1].split((':END-'+str(number)).encode(),1)[0].strip()
            pids.append(int(identity))
        # Shells are PID1 in separate private PID namespaces. Pin the distinct
        # guest-visible kernel processes rather than rejecting that confinement.
        assert all(pid>=1 for pid in pids)
        owner=json.loads(root('examctl','panes','supervisor',id))
        assert owner['observation_only'] and owner['attached_panes']==2 and len(owner['attached_units'])==2
        unit=owner['supervisor'];pid=owner['pid']
        kernel_pids=[]
        for workload in owner['attached_units']:
            assert pathlib.Path(workload).name==workload and workload.startswith('exam-'+id+'-') and workload.endswith('.scope')
            observed=[]
            for process in (pathlib.Path('/sys/fs/cgroup/exam.slice')/workload/'cgroup.procs').read_text().split():
                process=int(process)
                status=(pathlib.Path('/proc')/str(process)/'status').read_text()
                uids=next(line.split()[1:] for line in status.splitlines() if line.startswith('Uid:'))
                if list(map(int,uids))==[account.pw_uid]*4:
                    descriptor=os.pidfd_open(process);pinned.append(descriptor);observed.append(process);kernel_pids.append(process)
            assert observed, 'Actual owned scope has no positively identified synthetic student process'
        assert len(set(kernel_pids))>=2
        lifetime=select.poll()
        for descriptor in pinned:lifetime.register(descriptor,select.POLLIN)
        assert not lifetime.poll(0)
        group=pathlib.Path('/proc',str(pid),'cgroup').read_text()
        agent_pid=int(root('systemctl','show','exam-agent.service','--property=MainPID','--value').strip())
        agent_group=pathlib.Path('/proc',str(agent_pid),'cgroup').read_text()
        assert '/examterminal.slice/'+unit in group and group!=agent_group
        for property,expected in [('MemoryMax',str(64*1024*1024)),('MemorySwapMax','0'),('TasksMax','64')]:
            assert root('systemctl','show',unit,'--property='+property,'--value').strip()==expected
        ok('two actual timed SSH panes share one bounded independently scoped owner, observed through examctl')
        original_nonce=str(uuid.uuid4())
        connection.command('renew-receipted-execution-lease',{'id':id},nonce=original_nonce,discard_reply=True)
        journal=pathlib.Path(config['state'])/'leases'/(id+'.json')
        before_journal=journal.read_bytes();committed=json.loads(before_journal)
        first=connection.command('execution-renewal-receipt',{'id':id,'renewal_nonce':original_nonce})
        second=connection.command('execution-renewal-receipt',{'id':id,'renewal_nonce':original_nonce})
        assert first['version']==second['version']==1 and first['nonce']==second['nonce']==original_nonce
        assert first['until']==second['until']==committed['until'] and 0<second['remaining_ms']<=first['remaining_ms']<=15000
        assert journal.read_bytes()==before_journal, 'Query rewrote or extended the original publication'
        observed=json.loads(root('examctl','info',id,'--read-only'))['attempts'][0]
        assert observed['state']=='ACTIVE' and observed['start']==original['start'] and observed['deadline']==original['deadline'] and observed['original_deadline']==original['original_deadline']
        ok('discarded actual native renewal reply recovers the exact confirmed original cutoff twice without journal or clock changes')
        connection.command('renew-execution-lease',{'id':id})
        root('systemctl','stop','exam-agent.service');stopped=True
        for number,pane in enumerate(panes):
            pane.stdin.write(("printf 'SURVIVED-%s%s:%s:%s\\n' OWNER- "+str(number)+" \"$$\" \"$buffer\"\n").encode());pane.stdin.flush()
            expected=('SURVIVED-OWNER-'+str(number)+':'+str(pids[number])+':'+values[number]).encode()
            read_until(pane,expected,timeout=3)
        still=json.loads(root('examctl','panes','supervisor',id))
        assert still['pid']==pid and still['supervisor']==unit and still['attached_panes']==2
        assert not lifetime.poll(0), 'A pinned original student process exited during coordinator stop'
        ok('both shell PIDs and unsaved variables survive only the guest coordinator stop before legacy lease expiry')
        root('examctl','pause',id,'--reason','Synthetic current-policy negative retention control')
        locked=info(id)
        assert locked['state']=='LOCKED' and locked['start']==original['start'] and locked['deadline']==original['deadline'] and locked['original_deadline']==original['original_deadline']
        wait_for(lambda:all(pane.poll() is not None for pane in panes),timeout=8,interval=.05)
        def original_students_ended():
            for descriptor in pinned:
                poll=select.poll();poll.register(descriptor,select.POLLIN)
                if not poll.poll(0):return False
            return True
        wait_for(original_students_ended,timeout=8,interval=.05)
        assert locked['access_state']=='HELD'
        ok('current legacy policy pause terminates panes without refund/reopening; C3 retained lockout remains unimplemented')
        root('examctl','stop',id,'--reason','Synthetic timed-owner qualification collection')
        wait_for(lambda:info(id)['state']=='COMPLETED' and info(id)['protected'],timeout=45)
        final,archive,checksum=secure(id)
        assert final['start']==original['start'] and final['deadline']==original['deadline'] and final['original_deadline']==original['original_deadline'] and final['access_state']=='HELD'
        ok('protected collection preserves the original timed interval and account hold after owner/coordinator loss')
    finally:
        for pane in panes:
            if pane.poll() is None:
                pane.kill();pane.wait(timeout=5) # Exact owned client only, never a process-name kill.
        connection.close()
        for descriptor in pinned:os.close(descriptor)
        if stopped:
            root('systemctl','start','exam-agent.service')
    def restrictions_restored():
        observed=json.loads(root('examctl','info',id,'--read-only'))['attempts'][0]
        assert observed['start']==original['start'] and observed['deadline']==original['deadline'] and observed['original_deadline']==original['original_deadline']
        if int(time.time()*1000)<original['deadline']:
            assert observed['access_state']=='HELD', 'Restrictions released before authoritative deadline'
        return observed['access_state']=='RELEASED' and observed['policy_state']=='NORMAL'
    wait_for(restrictions_restored,timeout=max(0,original['deadline']/1000-time.time())+30)
    normal_access('original-deadline enforcement restores ordinary SSH/SFTP and original account attributes without override')
    print(json.dumps({'passed':passed,'count':len(passed),'timed_owner':True,'retained_lockout':False}),flush=True)
    raise SystemExit(0)

if a.worker_isolation:
    assert temporary and a.peer and a.peer!=a.username
    assert pathlib.Path('/run/ssh-exam-qualification-input/run.json').is_file(), 'Private overlay only'
    healthy=Connection(username=a.peer); target_connection=Connection()
    stop=threading.Event(); acknowledgements=[]; failures=[]; thread=None
    worker=None; worker_output=tempfile.TemporaryFile()
    def renew(id):
        while not stop.is_set():
            began=time.monotonic()
            try:
                healthy.command('renew-execution-lease',{'id':id})
                acknowledgements.append(time.monotonic()-began)
            except Exception as error:
                failures.append(str(error));return
            stop.wait(.5)
    try:
        healthy_id=healthy.start(duration=120); healthy_pane=healthy.pane(healthy_id)
        before=info(healthy_id)
        thread=threading.Thread(target=renew,args=(healthy_id,),daemon=True);thread.start()
        target_id=target_connection.start();target_pane=target_connection.pane(target_id)
        assert before.get('browser_ssh') and before.get('terminal_supervised') and info(target_id).get('terminal_supervised')
        # EXAM-READY is only the provisional admission reply, before closed
        # bootstrap/owner handoff. Require actual shell execution, not a sleep
        # or a retry that could hide a failed launch, before observing owners.
        for pane in (healthy_pane,target_pane):
            pane.stdin.write(b"printf 'OWNER_%s\\n' SHELL_READY\n");pane.stdin.flush()
            read_until(pane,b'OWNER_SHELL_READY',10)
        healthy_owner=json.loads(root('examctl','panes','supervisor',healthy_id))
        target_owner=json.loads(root('examctl','panes','supervisor',target_id))
        assert healthy_owner['observation_only'] and target_owner['observation_only'] and healthy_owner['pid']!=target_owner['pid'] and healthy_owner['supervisor']!=target_owner['supervisor']
        ok('two synthetic BrowserSSH attempts have independently scoped timed recording owners')
        target_work=pathlib.Path(config['work'])/target_id/'work'
        assert config.get('host_filesystem') is True and config['rootfs']=='/', 'Normal filesystem required, not a minimal rootfs'
        target_pane.stdin.write(b"while IFS= read -r path; do if ! test -x \"$path\"; then printf 'COMMAND_%s: %s\\n' NOT_FOUND \"$path\"; break; fi; done < /work/qualification-command-inventory.txt; printf 'PUBLIC_%s\\n' INVENTORY_CHECKED\n");target_pane.stdin.flush()
        read_until(target_pane,b'PUBLIC_INVENTORY_CHECKED',10)
        target_pane.stdin.write(b"command -v python3 >/dev/null 2>&1 && printf 'STUDENT_%s\\n' PYTHON_OK || printf 'COMMAND_%s: python3\\n' NOT_FOUND\n");target_pane.stdin.flush()
        read_until(target_pane,b'STUDENT_PYTHON_OK',5)
        security_check='''import os,pathlib,ssl,sqlite3,ctypes
status=dict(line.split(':',1) for line in pathlib.Path('/proc/self/status').read_text().splitlines() if ':' in line)
assert all(int(status[k],16)==0 for k in ('CapInh','CapPrm','CapEff','CapBnd','CapAmb'))
assert int(status['NoNewPrivs'])==1
assert os.statvfs('/').f_flag & os.ST_RDONLY
assert os.statvfs(os.environ['HOME']).f_flag & os.ST_RDONLY
for hidden in ('/etc/exam-agent/agent.json','/var/lib/exam-agent/state.json','/run/systemd/private','/sys/fs/cgroup/cgroup.controllers','/srv/exam-workspace/rootfs'):
 assert not pathlib.Path(hidden).exists()
print('NORMAL_STUDENT_'+'SECURITY_OK',flush=True)
'''
        target_pane.stdin.write(('python3 -c '+shlex.quote(security_check)+'\n').encode());target_pane.stdin.flush()
        read_until(target_pane,b'NORMAL_STUDENT_SECURITY_OK',5)
        ok('normal-root public commands/Python libraries remain available; root/home are read-only, private endpoints hidden and student capabilities zero')
        # Real student-side bounded incompressible output keeps the collector
        # alive long enough to identify and kill its actual supervised process.
        target_connection.command('renew-execution-lease',{'id':target_id})
        target_pane.stdin.write(b"cd /work && python3 -c 'import os,pathlib; [(pathlib.Path(\"fault-%d.bin\"%i).write_bytes(os.urandom(10*1024*1024))) for i in range(4)]; pathlib.Path(\"fault-ready\").write_text(\"ready\")'\n");target_pane.stdin.flush()
        wait_for(lambda:(target_work/'fault-ready').is_file(),20)
        original=info(target_id)
        owners=root('systemctl','show','exam-agent','exam-deadline-watchdog','--property=MainPID','--value')
        worker=subprocess.Popen(['examctl','stop',target_id,'--reason','Disposable qualification injects isolated collection worker death'],stdout=worker_output,stderr=subprocess.STDOUT)
        found=[]
        def collector():
            if worker.poll() is not None:
                worker.wait(timeout=5);worker_output.seek(0);output=worker_output.read(16384).decode(errors='replace')
                try:
                    result=json.loads(output)
                    detail=json.dumps({name:result.get(name) for name in ('state','protected','reason')})
                except ValueError:detail='non-JSON CLI refusal (private output not copied into diagnostics)'
                raise AssertionError('Collection command exited before worker detection: '+detail)
            for process in pathlib.Path('/proc').iterdir():
                if not process.name.isdigit() or int(process.name)<2:continue
                try:
                    argv=(process/'cmdline').read_bytes().split(b'\0')
                    if b'--collection-worker' not in argv:continue
                    units=[part for line in (process/'cgroup').read_text().splitlines() for part in line.split('/') if part.startswith('exam-collection-'+target_id+'-') and part.endswith('.service')]
                    if len(units)!=1:continue
                    unit=units[0];pid=int(process.name)
                    # PID namespace is private to the disposable guest; also
                    # pin a pidfd so signal delivery cannot hit a reused PID.
                    descriptor=os.pidfd_open(pid)
                    if b'--collection-worker' not in (process/'cmdline').read_bytes().split(b'\0') or unit not in (process/'cgroup').read_text():
                        os.close(descriptor);continue
                    found.append((unit,descriptor));return True
                except (FileNotFoundError,ProcessLookupError):continue
            return False
        wait_for(collector,10,interval=.01)
        unit,descriptor=found[0]
        try:signal.pidfd_send_signal(descriptor,signal.SIGKILL)
        finally:os.close(descriptor)
        worker.communicate(timeout=30)
        assert worker.returncode!=0,'Killed collection worker was falsely reported successful'
        failed=info(target_id)
        assert failed['state']=='COLLECTION_FAILED' and failed['access_state']=='HELD'
        assert failed['start']==original['start'] and failed['deadline']==original['deadline'] and failed['original_deadline']==original['original_deadline']
        ok('real supervised collection-worker SIGKILL fails only its target and preserves its original hold/interval')
        healthy_pane.stdin.write(b"printf ISOLATION_LIVE > /work/healthy-proof; printf 'PTY_AFTER_%s\\n' WORKER_FAULT\n");healthy_pane.stdin.flush()
        read_until(healthy_pane,b'PTY_AFTER_WORKER_FAULT',10)
        assert (pathlib.Path(config['work'])/healthy_id/'work/healthy-proof').read_text()=='ISOLATION_LIVE'
        extra=healthy.pane(healthy_id)
        extra.stdin.write(b"printf 'FRESH_%s\\n' ADMISSION\n");extra.stdin.flush();read_until(extra,b'FRESH_ADMISSION',10)
        assert owners==root('systemctl','show','exam-agent','exam-deadline-watchdog','--property=MainPID','--value')
        current=info(healthy_id)
        observed_owner=json.loads(root('examctl','panes','supervisor',healthy_id))
        assert observed_owner['pid']==healthy_owner['pid'] and observed_owner['supervisor']==healthy_owner['supervisor'] and observed_owner['attached_panes']==2
        assert current['state']=='ACTIVE' and current['generation']==before['generation'] and current['deadline']==before['deadline'] and current['original_deadline']==before['original_deadline']
        assert healthy_pane.poll() is None and not failures and len(acknowledgements)>=3 and max(acknowledgements)<5
        ok('healthy real PTY, fresh channel admission and signed renewals survive with unchanged owners/generation/deadlines')
        root('examctl','retry',target_id,'--reason','Disposable qualification retries exact worker-death target')
        def retry_completed():
            # Another verified worker may already own the job. Successful retry
            # then reports honest FINALIZING, not a secured archive. Observe its
            # actual completion without issuing another retry or reconciling.
            result=run(['examctl','info',target_id,'--read-only'])
            if result.returncode:
                assert result.returncode==1 and 'native snapshot unavailable or unsafe' in result.stderr,result.stderr
                return False # A canonical atomic rename may invalidate a read.
            observed=json.loads(result.stdout)['attempts'][0]
            assert observed['state'] in ('FINALIZING','COMPLETED'),observed['state']
            assert observed['start']==original['start'] and observed['deadline']==original['deadline'] and observed['original_deadline']==original['original_deadline']
            return observed['state']=='COMPLETED'
        wait_for(retry_completed,45)
        _,archive,checksum=secure(target_id)
        with tarfile.open(archive) as bundle:
            for i in range(4):
                name='fault-%d.bin'%i
                assert hashlib.sha256(bundle.extractfile(name).read()).digest()==hashlib.sha256((target_work/name).read_bytes()).digest()
        ok('explicit retry protects all original target bytes after real worker death')
        stop.set();thread.join(timeout=10);assert not thread.is_alive() and not failures
        healthy.command('finalize-attempt',{'id':healthy_id});secure(healthy_id)
        wait_for(lambda:info(target_id)['access_state']=='RELEASED' and info(healthy_id)['access_state']=='RELEASED',150)
        assert secure(target_id)[2]==checksum
        ok('both synthetic accounts restore only after their unchanged deadlines and verified protection')
        print(json.dumps({'passed':passed,'count':len(passed),'renewals':len(acknowledgements),'max_renewal_seconds':max(acknowledgements),'worker_isolation':True}),flush=True)
    finally:
        stop.set()
        if thread:thread.join(timeout=10)
        if worker and worker.poll() is None:worker.terminate();worker.wait(timeout=10)
        worker_output.close()
        healthy.close();target_connection.close()
    raise SystemExit(0)

if a.handoff_only:
    assert temporary
    c=Connection()
    try:
        id=c.start(False)
        assert info(id)['start']==0 and info(id)['deadline']==0 and info(id)['policy_state']=='READY'
        root('examctl','cancel',id,'--reason','Qualification cancels successful automatic handoff before timed activation')
        assert info(id)['policy_state']=='NORMAL'
        normal_access('automatic handoff preserves zero exam time and cancellation restores ordinary access')
    finally:c.close()
    print(json.dumps({'passed':passed,'count':len(passed),'handoff_only':True}),flush=True)
    raise SystemExit(0)

if a.setup_only:
    assert temporary
    import fcntl,tempfile
    original_baseline=baseline
    root('loginctl','enable-linger',a.username)
    baseline=(baseline[0],baseline[1],True)
    def setup():
        c=Connection();c.transport=c.command('register',{'exam':'qualification'})['transport'];id=str(uuid.uuid4())
        c.command('prepare-attempt',{'id':id,'exam':'qualification','uid':account.pw_uid,'username':a.username,'transport':c.transport,'settings':{'duration':60,'earliest':0,'latest':int(time.time()*1000)+600000,'template':'qualification','terminals':4}})
        c.command('prepare-account-policy',{'id':id});return c,id
    try:
        current,id=setup()
        result=json.loads(root('examctl','cancel',id,'--reason','Qualification cancels setup with original lingering enabled'))
        assert result['policy_state']=='NORMAL' and not result['start'],result
        current.close();normal_access('setup cancellation returns current restoration state and restores initially enabled lingering')
        current,id=setup();current.close()
        expires=info(id)['policy_expires']
        root('systemctl','restart','exam-agent','exam-deadline-watchdog');wait_for(agent_ready,40)
        assert info(id)['policy_expires']==expires and not info(id)['start']
        state_dir=pathlib.Path(config['state'])
        with open(state_dir/'lock','a+') as lock:
            fcntl.flock(lock,fcntl.LOCK_EX)
            state=json.loads((state_dir/'state.json').read_text());attempt=state['attempts'][id]
            assert attempt['state']=='PREPARING' and not attempt['start'] and not attempt['deadline']
            attempt['policy_expires']=int(time.time()*1000)-1
            fd,path=tempfile.mkstemp(dir=state_dir)
            with os.fdopen(fd,'w') as f:json.dump(state,f);f.flush();os.fsync(f.fileno())
            os.replace(path,state_dir/'state.json')
        root('systemctl','stop','exam-agent')
        wait_for(lambda:info(id).get('policy_state')=='NORMAL',30)
        assert not info(id)['start'] and info(id)['state']=='CANCELLED_BEFORE_START'
        normal_access('watchdog restores abandoned setup after restart with no browser, SSH or gate service')
    finally:
        if not original_baseline[2]:root('loginctl','disable-linger',a.username)
        root('systemctl','start','exam-agent')
    print(json.dumps({'passed':passed,'count':len(passed),'setup_only':True}),flush=True)
    raise SystemExit(0)

if temporary:
    normal_access('normal SSH/SFTP work before enrollment without exam daemon')
    bootstrap=Connection()
    try:
        bootstrap.transport=bootstrap.command('register',{'exam':'qualification'})['transport']
        assert pwd.getpwnam(a.username).pw_shell==baseline[0]
        ok('signed registration leaves ordinary account policy unchanged')
    finally:bootstrap.close()
check_jobs()
# Old authenticated connection and detached writer precede the activation barrier.
old=Connection(); current=Connection()
thread_fixture=None; thread_handle=None
try:
    writer='/tmp/preexisting-writer'
    p=old.raw("nohup /bin/sh -c 'while :; do echo writing >> "+writer+"; sleep .1; done' >/dev/null 2>&1 </dev/null & echo STARTED")
    assert p.returncode==0 and 'STARTED' in p.stdout,p
    wait_for(lambda:pathlib.Path(writer).exists(),5)
    # Actual ordinary SSH -> Begin barrier regression, only for the guarded
    # overlay's manifested synthetic fixture. Never select a process by name.
    probe=pathlib.Path('/run/ssh-exam-qualification-input/thread-leader-probe')
    if probe.is_file():
        thread_fixture=tempfile.TemporaryDirectory(prefix='qualification-thread-route-',dir='/var/tmp')
        private=pathlib.Path(thread_fixture.name);private.chmod(0o755)
        executable=private/'probe';data=probe.read_bytes();assert 0<len(data)<=2*1024*1024
        executable.write_bytes(data);executable.chmod(0o755)
        writable=private/'work';writable.mkdir(mode=0o700);os.chown(writable,account.pw_uid,account.pw_gid)
        report=writable/'identity';thread_output=writable/'writes'
        p=old.raw('nohup '+shlex.quote(str(executable))+' '+shlex.quote(str(thread_output))+' >'+shlex.quote(str(report))+' 2>/dev/null </dev/null & printf THREAD_STARTED')
        assert p.returncode==0 and p.stdout=='THREAD_STARTED',p
        wait_for(lambda:report.is_file() and len(report.read_text().split())==2,5,interval=.01)
        thread_pid,thread_tid=map(int,report.read_text().split());assert thread_pid>1 and thread_tid>1 and thread_pid!=thread_tid
        thread_handle=os.pidfd_open(thread_pid)
        process=pathlib.Path('/proc')/str(thread_pid)
        assert os.path.samefile(process/'task'/str(thread_tid)/'exe',executable), 'Exact surviving-thread fixture inode required'
        assert str(account.pw_uid) in next(line.split()[1:] for line in (process/'status').read_text().splitlines() if line.startswith('Uid:'))
        wait_for(lambda:'State:\tZ' in (process/'status').read_text(),3,interval=.01)
        poll=select.poll();poll.register(thread_handle,select.POLLIN)
        assert not poll.poll(0),'Synthetic thread group unexpectedly exited'
        size=thread_output.stat().st_size;time.sleep(.04);assert thread_output.stat().st_size>size
    id=current.start();deadline=info(id)['deadline'];
    if thread_handle is not None:
        wait_for(lambda:bool(poll.poll(0)),3,interval=.01)
        size=thread_output.stat().st_size;time.sleep(.05);assert thread_output.stat().st_size==size
        ok('actual ordinary SSH Begin barrier terminates live worker after main-thread exit, preserving approved transport')
    if temporary:denied(run(['su',a.username,'-c','echo BYPASS']),'temporary PAM restriction blocks alternate su')
    size=pathlib.Path(writer).stat().st_size;time.sleep(.4)
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
    root('systemctl','restart','exam-agent','exam-deadline-watchdog');wait_for(agent_ready,40)
    assert info(id)['deadline']==deadline and info(id)['access_state']=='HELD'
    denied(old.raw('echo BYPASS'),'agent/watchdog restart preserves original access hold')
    current.close()
    wait_for(lambda:info(id)['access_state']=='RELEASED',75)
    assert secure(id)[2]==checksum
    p=old.raw('printf ORDINARY-RESTORED');assert p.returncode==0 and 'ORDINARY-RESTORED' in p.stdout,p
    ok('ordinary access restores only after original deadline and protected collection')
    if temporary:normal_access('exact account baseline and SSH/SFTP restored with gate daemon stopped')
finally:
    old.close();current.close()
    if thread_handle is not None:
        try:signal.pidfd_send_signal(thread_handle,signal.SIGKILL)
        except ProcessLookupError:pass
        finally:os.close(thread_handle)
    if thread_fixture is not None:thread_fixture.cleanup()

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
wait_for(agent_ready,40)
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
if temporary:
    current=Connection()
    try:
        current.transport=current.command('register',{'exam':'qualification'})['transport'];id=str(uuid.uuid4())
        current.command('prepare-attempt',{'id':id,'exam':'qualification','uid':account.pw_uid,'username':a.username,'transport':current.transport,'settings':{'duration':60,'earliest':0,'latest':int(time.time()*1000)+600000,'template':'qualification','terminals':4}})
        current.command('prepare-account-policy',{'id':id})
        root('examctl','cancel',id,'--reason','Qualification cancels unstarted temporary setup')
        assert info(id)['policy_state']=='NORMAL' and not info(id)['start']
        normal_access('cancel unstarted setup restores exact ordinary policy')
    finally:current.close()
print(json.dumps({'passed':passed,'count':len(passed),'uid':account.pw_uid,'strict_isolation':True}),flush=True)
