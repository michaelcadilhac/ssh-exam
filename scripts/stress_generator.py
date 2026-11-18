"""Owned, bounded Marco browser worker for the explicitly requested stress run."""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import signal
import socket
import subprocess
import threading
import time
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]

# This runs as the existing unprivileged Marco user. No installed file is written.
RPC = r'''
import base64,hashlib,json,os,re,shutil,socket,stat,subprocess,sys,tempfile,time
from pathlib import Path,PurePosixPath
v=json.loads(sys.stdin.buffer.read(32*1024**2+1));op=v['op'];uid=os.getuid()
runtime=Path('/run/user')/str(uid);bus=runtime/'bus'
assert runtime.stat().st_uid==uid and bus.stat().st_uid==uid and stat.S_ISSOCK(bus.stat().st_mode)
env=dict(os.environ,XDG_RUNTIME_DIR=str(runtime),DBUS_SESSION_BUS_ADDRESS='unix:path='+str(bus))
def command(args):
 return subprocess.run(args,env=env,capture_output=True,text=True,timeout=12,check=True).stdout
def web():
 return dict(line.split('=',1) for line in command(['systemctl','show','ssh-exam.service','--property=ActiveState,SubState,MainPID,UnitFileState']).splitlines())
def memory():
 return int(next(line.split()[1] for line in Path('/proc/meminfo').read_text().splitlines() if line.startswith('MemAvailable:')))*1024
def shared_memory():
 assert any(row.split()[4]=='/dev/shm' and ' - tmpfs ' in row for row in Path('/proc/self/mountinfo').read_text().splitlines()),'Browser shared memory must be tmpfs'
 return shutil.disk_usage('/dev/shm').free
def free_ports(ports=(9444,9445)):
 for name in ('tcp','tcp6'):
  for line in (Path('/proc/net')/name).read_text().splitlines()[1:]:
   fields=line.split()
   assert not (fields[3]=='0A' and int(fields[1].split(':')[1],16) in ports),'Private port has a live listener'
 for port in ports:
  with socket.socket() as s:
   s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
   s.bind(('127.0.0.1',port))
def unit_state(unit):
 return dict(line.split('=',1) for line in command(['systemctl','--user','show',unit,'--property=ActiveState,SubState,MainPID,ControlGroup,MemoryCurrent,MemoryPeak,MemoryHigh,MemoryMax,MemorySwapMax,TasksCurrent,TasksMax,RuntimeMaxUSec,LimitCORE,LimitCORESoft,LimitNOFILE,LimitNOFILESoft']).splitlines())
def resource_view(state,group):
 # The measured70-client growth approaches20GiB. Reserve21GiB for this owned
 # generator, with25GiB startup availability and the unchanged4GiB live floor.
 assert int(state['MemoryMax'])==21*1024**3 and int(state['MemoryHigh'])==21*1024**3 and state['MemorySwapMax']=='0' and state['TasksMax']=='4096'
 bounds={n:(group/n).read_text().strip() for n in ('memory.max','memory.high','memory.swap.max','pids.max','cpu.max')}
 quota,period=map(int,bounds['cpu.max'].split());assert quota==8*period
 assert bounds['memory.max']==str(21*1024**3) and bounds['memory.high']==str(21*1024**3) and bounds['memory.swap.max']=='0' and bounds['pids.max']=='4096'
 observations={n:(group/n).read_text().strip() for n in ('memory.events','memory.pressure','cpu.stat','cpu.pressure','pids.events')}
 return {'kernel_bounds':bounds,'resource_observations':observations}
def verify_process(state,root):
 pid=state['MainPID'];assert int(pid)>1
 p=Path('/proc')/pid;assert p.stat().st_uid==uid
 assert (p/'cmdline').read_bytes().rstrip(b'\0').split(b'\0')==[b'/usr/bin/node',str(root/'worker.cjs').encode()]
 assert (p/'cgroup').read_text()=='0::'+state['ControlGroup']+'\n'
 limits=(p/'limits').read_text().splitlines()
 nofile=next(re.fullmatch(r'Max open files\s+(\d+)\s+(\d+)\s+files',line.rstrip()) for line in limits if line.startswith('Max open files'))
 core=next(re.fullmatch(r'Max core file size\s+(\d+)\s+(\d+)\s+bytes',line.rstrip()) for line in limits if line.startswith('Max core file size'))
 assert nofile and nofile.groups()==('524288','524288'),'Actual private Node descriptor limits differ'
 assert core and core.groups()==('0','0'),'Actual private Node core limit differs'
 return {'nofile':[int(v) for v in nofile.groups()],'core':[int(v) for v in core.groups()]}
def listeners(ports):
 found=[]
 for name,allowed in [('tcp','0100007F'),('tcp6','00000000000000000000000001000000')]:
  for line in (Path('/proc/net')/name).read_text().splitlines()[1:]:
   fields=line.split();address,encoded=fields[1].split(':');port=int(encoded,16)
   if fields[3]=='0A' and port in ports:
    assert address==allowed,'Private forward is not loopback-only'
    found.append({'port':port,'address':'127.0.0.1' if name=='tcp' else '::1'})
 assert {x['port'] for x in found}==set(ports),'Private listeners unavailable'
 return found
def private_json(path):
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 with os.fdopen(fd,'rb') as stream:
  i=os.fstat(stream.fileno());assert stat.S_ISREG(i.st_mode) and i.st_uid==uid and i.st_nlink==1 and i.st_mode&0o077==0 and i.st_size<=128*1024
  return json.loads(stream.read(128*1024+1))
def browser_process(endpoint):
 pid=endpoint['browser_pid'];assert isinstance(pid,int) and pid>1 and re.fullmatch(r'[0-9]+',endpoint['browser_start_ticks'])
 p=Path('/proc')/str(pid)
 try:
  raw=(p/'stat').read_text();fields=raw[raw.rfind(')')+2:].split()
  if fields[19]!=endpoint['browser_start_ticks']:return None
  assert p.stat().st_uid==uid
  return {'state':fields[0],'cgroup':(p/'cgroup').read_text()}
 except FileNotFoundError:return None
def verify_network(identity,state):
 host=os.readlink('/proc/self/ns/net');private=identity['browser_network_namespace']
 assert re.fullmatch(r'net:\[[0-9]+\]',private) and private!=host and identity['host_network_namespace']==host
 for pid in (identity['namespace_node_pid'],identity['browser_pid']):
  assert isinstance(pid,int) and pid>1
  p=Path('/proc')/str(pid);assert p.stat().st_uid==uid and (p/'cgroup').read_text()=='0::'+state['ControlGroup']+'\n'
  assert os.readlink(p/'ns/net')==private
 devices={l.split(':')[0].strip() for l in (Path('/proc')/str(identity['namespace_node_pid'])/'net/dev').read_text().splitlines()[2:]}
 assert devices=={'lo','exam-test0','exam-test1'},'Private browser must contain only its closed test link and loopback'
 routes=(Path('/proc')/str(identity['namespace_node_pid'])/'net/route').read_text().splitlines()[1:]
 defaults=[l.split() for l in routes if l.split()[1]=='00000000']
 assert len(defaults)==1 and defaults[0][:3]==['exam-test0','00000000','020200C0'],'Private route must end at the unconnected test peer'
def owned_bytes(root):
 paths=list(root.rglob('*'));assert len(paths)<10000
 total=0
 for path in paths:
  try:info=path.lstat()
  except FileNotFoundError:continue
  if stat.S_ISREG(info.st_mode):total+=info.st_size
 return total
expected={'ActiveState':'inactive','SubState':'dead','MainPID':'0','UnitFileState':'disabled'}
if op not in ('stop','ports'):
 assert web()==expected,'Retired exam service changed; no generator action'
if op=='preflight':
 assert memory()>=25*1024**3,'Marco needs25GiB available before this run'
 assert shared_memory()>=12*1024**3,'Private browser run needs12GiB shared-memory headroom'
 assert shutil.disk_usage('/var/tmp').free>=3*1024**3,'Private browser scratch needs3GiB free'
 free_ports()
 assert Path('/usr/bin/ip').is_file(),'Private browser namespace requires the installed ip tool'
 command(['/usr/bin/unshare','--user','--map-current-user','--net','/usr/bin/python3','-c',
          'import os;assert os.readlink("/proc/self/ns/net")!='+repr(os.readlink('/proc/self/ns/net'))])
 print(json.dumps({'uid':uid,'cpus':os.cpu_count(),'available_bytes':memory(),'scratch_free_bytes':shutil.disk_usage('/var/tmp').free,'shared_memory_free_bytes':shared_memory(),'node':command(['/usr/bin/node','--version']).strip(),'chromium':command(['/usr/bin/chromium','--version']).strip(),'web_service':expected}))
elif op=='setup':
 files=v['files'];assert 1<len(files)<=1000
 decoded={};total=0
 for name,item in files.items():
  p=PurePosixPath(name);assert not p.is_absolute() and '..' not in p.parts and str(p)==name
  assert name=='worker.cjs' or name.startswith('playwright-core/')
  raw=base64.b64decode(item['data'],validate=True);total+=len(raw)
  assert total<=16*1024**2 and hashlib.sha256(raw).hexdigest()==item['sha256']
  decoded[name]=raw
 assert 'worker.cjs' in decoded and 'playwright-core/package.json' in decoded
 assert re.fullmatch(r'[a-f0-9]{16}',v['token'])
 os.umask(0o077);root=Path(tempfile.mkdtemp(prefix='ssh-exam-browser-generator.',dir='/var/tmp'))
 for name,raw in decoded.items():
  p=root/name;p.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
  with p.open('xb') as f:f.write(raw)
 unit='ssh-exam-browser-'+v['token']+'.service'
 marker={'unit':unit,'token':v['token'],'uid':uid,'web_service':expected,'hashes':{n:files[n]['sha256'] for n in files}}
 (root/'run.json').write_text(json.dumps(marker))
 print(json.dumps({'directory':str(root),'unit':unit,'files':len(files),'bytes':total}))
else:
 root=Path(v['directory']);assert re.fullmatch(r'/var/tmp/ssh-exam-browser-generator\.[A-Za-z0-9_]+',str(root))
 info=root.lstat();assert stat.S_ISDIR(info.st_mode) and info.st_uid==uid and info.st_mode&0o077==0 and root.resolve()==root
 marker=private_json(root/'run.json');unit=marker['unit']
 assert marker['uid']==uid and marker['token']==v['token'] and re.fullmatch(r'ssh-exam-browser-[a-f0-9]{16}\.service',unit)
 if op=='start':
  for name,digest in marker['hashes'].items():
   p=root/name;i=p.lstat();assert stat.S_ISREG(i.st_mode) and i.st_uid==uid and i.st_nlink==1 and hashlib.sha256(p.read_bytes()).hexdigest()==digest
  free_ports()
  command(['systemd-run','--user','--quiet','--collect','--service-type=exec','--unit='+unit,
    '--property=MemoryHigh=21G','--property=MemoryMax=21G','--property=MemorySwapMax=0',
    '--property=CPUQuota=800%','--property=TasksMax=4096','--property=RuntimeMaxSec=14400',
    '--property=LimitCORE=0','--property=LimitNOFILE=524288',
    '--property=TimeoutStopSec=30','--property=KillMode=control-group','--property=UMask=0077','--property=Restart=no',
    '--property=StandardOutput=append:'+str(root/'worker.log'),
    '--property=StandardError=append:'+str(root/'worker.log'),
    '--working-directory='+str(root),'/usr/bin/node',str(root/'worker.cjs')])
  state=unit_state(unit);group=state.get('ControlGroup','')
  if group:
   assert group.startswith('/') and '..' not in PurePosixPath(group).parts and group.endswith('/'+unit)
   fd=os.open(root/'scope.json',os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
   with os.fdopen(fd,'w') as stream:json.dump({'control_group':group},stream)
  print(json.dumps({'started':True,'unit':unit}))
 elif op=='status':
  state=unit_state(unit);active=state['ActiveState']=='active' and int(state['MainPID'])>1
  result={'active':active,'unit_state':state,'available_bytes':memory(),'scratch_free_bytes':shutil.disk_usage(root).free,'shared_memory_free_bytes':shared_memory(),'web_service':web()}
  if active:
   assert state['RuntimeMaxUSec']=='4h','Private browser lifetime must be finite and match the measured ramp plus90-minute peak budget'
   assert state['LimitCORE']=='0' and state['LimitCORESoft']=='0','Private browser core dumps must stay disabled'
   assert state['LimitNOFILE']=='524288' and state['LimitNOFILESoft']=='524288','Private browser descriptor limits must match the qualified runner'
   result['process_limits']=verify_process(state,root)
   group=Path('/sys/fs/cgroup')/state['ControlGroup'].lstrip('/')
   result.update(resource_view(state,group))
   for parent in group.parents:
    if parent==Path('/sys/fs'):break
    limit=parent/'memory.max';current=parent/'memory.current'
    if limit.is_file() and current.is_file() and limit.read_text().strip()!='max':
     result['available_bytes']=min(result['available_bytes'],max(0,int(limit.read_text())-int(current.read_text())))
  endpoint=root/'endpoint.json'
  if endpoint.exists():
   i=endpoint.lstat();assert stat.S_ISREG(i.st_mode) and i.st_uid==uid and i.st_mode&0o077==0
   identity=private_json(endpoint);result.update(identity)
   if active:
    browser=browser_process(identity);assert browser and browser['state'] not in ('Z','X')
    assert identity['node_pid']==int(state['MainPID']) and browser['cgroup']=='0::'+state['ControlGroup']+'\n'
    verify_network(identity,state);result['network_isolation_verified']=True
    assert b'--disable-dev-shm-usage' not in (Path('/proc')/str(identity['browser_pid'])/'cmdline').read_bytes().split(b'\0'),'Browser shared pages must not use root-disk scratch'
  if not active and (root/'worker.log').is_file():result['worker_log_tail']=(root/'worker.log').read_text()[-8192:]
  result['owned_bytes']=owned_bytes(root)
  print(json.dumps(result))
 elif op=='stop':
  state=unit_state(unit)
  until=time.monotonic()+35;requested=False
  while state['ActiveState']!='inactive' and time.monotonic()<until:
   if not requested and state['ActiveState'] not in ('failed','deactivating') and int(state['MainPID'])>1:
    verify_process(state,root)
    command(['systemctl','--user','stop','--no-block',unit]);requested=True
   time.sleep(.2);state=unit_state(unit)
  assert state['ActiveState']=='inactive' and state['SubState']=='dead' and state['MainPID']=='0',state
  endpoint=root/'endpoint.json';browser=browser_process(private_json(endpoint)) if endpoint.exists() else None
  assert browser is None or browser['state'] in ('Z','X'),'Owned browser still executes after unit stop'
  scope=root/'scope.json'
  if scope.exists():
   group=private_json(scope)['control_group'];assert group.startswith('/') and '..' not in PurePosixPath(group).parts and group.endswith('/'+unit)
   events=Path('/sys/fs/cgroup')/group.lstrip('/')/'cgroup.events'
   assert not events.exists() or dict(l.split() for l in events.read_text().splitlines())['populated']=='0','Owned namespace/proxy processes remain'
  print(json.dumps({'unit':unit,'unit_state':state,'web_service_unchanged':web()==marker['web_service'],'stopped':True,'browser_stopped':True,'scope_empty':True}))
 elif op=='ports':
  free_ports();print(json.dumps({'ports_closed':[9444,9445]}))
 elif op=='listeners':
  port=v['browser_port'];assert isinstance(port,int) and 1024<=port<=65535
  print(json.dumps({'loopback_listeners':listeners([9444,9445,port])}))
 else:raise AssertionError('Unknown private generator operation')
'''


def browser_files():
    package = ROOT / 'node_modules/playwright-core'
    files = {}
    for path in sorted(package.rglob('*')):
        if path.is_symlink():
            raise RuntimeError('Browser dependency bundle contains a symlink')
        if path.is_file():
            files['playwright-core/' + str(path.relative_to(package))] = path.read_bytes()
    files['worker.cjs'] = (ROOT / 'scripts/stress-browser-worker.cjs').read_bytes()
    if len(files) > 1000 or sum(map(len, files.values())) > 16 * 1024**2:
        raise RuntimeError('Browser dependency bundle exceeds its code-only bound')
    return files


class MarcoGenerator:
    def __init__(self, output):
        self.output = Path(output)
        self.token = os.urandom(8).hex()
        self.directory = None
        self.tunnel = None
        self.stop_event = threading.Event()
        self.thread = None
        self.failure = None
        self.endpoint = None

    def rpc(self, op, **fields):
        payload = {'op': op, **fields}
        if self.directory:
            payload.update(directory=self.directory, token=self.token)
        # Reuse an existing operator master if present, but never create an idle
        # persistent master in this owned test unit after the RPC finishes.
        reply = subprocess.run(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10',
                                '-o', 'ControlMaster=no', '-o', 'ControlPersist=no', 'marco',
                                shlex.join(['python3', '-c', RPC])], input=json.dumps(payload),
                               text=True, capture_output=True, timeout=45 if op == 'stop' else 25)
        if reply.returncode:
            with (self.output / ('generator-' + op + '-refusal.log')).open('a') as log:
                log.write(json.dumps({'at': time.time(), 'stderr': reply.stderr[-12000:]}) + '\n')
            raise RuntimeError('Private Marco generator operation refused: ' + op)
        return json.loads(reply.stdout)

    def start(self):
        preflight = self.rpc('preflight')
        (self.output / 'generator-preflight.json').write_text(json.dumps(preflight, indent=2) + '\n')
        files = browser_files()
        manifest = {name: hashlib.sha256(raw).hexdigest() for name, raw in files.items()}
        (self.output / 'generator-code-audit.json').write_text(json.dumps({'host': 'marco', 'files': manifest,
            'bytes': sum(map(len, files.values())), 'private_profiles': True, 'mfa': False}, indent=2) + '\n')
        setup = self.rpc('setup', token=self.token, files={name: {'sha256': manifest[name],
            'data': base64.b64encode(raw).decode()} for name, raw in files.items()})
        self.directory = setup['directory']
        (self.output / 'generator-owned.json').write_text(json.dumps(setup, indent=2) + '\n')
        self.rpc('start')
        until = time.monotonic() + 40
        while True:
            status = self.rpc('status')
            (self.output / 'generator-start-status.json').write_text(json.dumps({k: v for k, v in status.items() if k != 'endpoint'}, indent=2) + '\n')
            if status.get('endpoint') and status['active']:
                break
            if time.monotonic() >= until:
                raise RuntimeError('Private Marco browser did not become ready')
            if not status['active']:
                raise RuntimeError('Private Marco browser exited before readiness')
            time.sleep(.5)
        endpoint = urlsplit(status['endpoint'])
        if endpoint.scheme != 'ws' or endpoint.hostname != '127.0.0.1' or not endpoint.port or not re.fullmatch(r'/[A-Za-z0-9_-]+', endpoint.path):
            raise RuntimeError('Unexpected private browser endpoint')
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0)); port = listener.getsockname()[1]
        self.tunnel_log = (self.output / 'generator-tunnel.log').open('xb')
        self.tunnel = subprocess.Popen(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10',
            '-o', 'ControlMaster=no', '-o', 'ControlPath=none',
            '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=2',
            '-N', '-L', f'127.0.0.1:{port}:127.0.0.1:{endpoint.port}',
            '-R', '127.0.0.1:9444:127.0.0.1:9444', '-R', '127.0.0.1:9445:127.0.0.1:9445', 'marco'],
            stdin=subprocess.DEVNULL, stdout=self.tunnel_log, stderr=subprocess.STDOUT, start_new_session=True)
        self.endpoint = f'ws://127.0.0.1:{port}{endpoint.path}'
        until = time.monotonic() + 15
        while True:
            if self.tunnel.poll() is not None:
                raise RuntimeError('Owned private browser tunnel exited')
            with socket.socket() as probe:
                probe.settimeout(.2)
                if probe.connect_ex(('127.0.0.1', port)) == 0: break
            if time.monotonic() >= until:
                raise RuntimeError('Owned private browser tunnel did not become ready')
            time.sleep(.1)
        verified = self.rpc('listeners', browser_port=endpoint.port)
        (self.output / 'generator-listeners.json').write_text(json.dumps(verified, indent=2) + '\n')
        if status['available_bytes'] < 21 * 1024**3:
            raise RuntimeError('Marco ancestor memory budget is insufficient')
        self.publish_status(status)
        self.thread = threading.Thread(target=self.monitor, daemon=True)
        self.thread.start()
        return {'EXAM_STRESS_BROWSER_WS': self.endpoint,
                'EXAM_STRESS_GENERATOR_STATUS': str(self.output / 'generator-status.json')}

    def publish_status(self, value, started=None):
        value = {k: v for k, v in value.items() if k != 'endpoint'}
        value.update(host='marco', observed_local_ms=started or int(time.time() * 1000),
                     minimum_available_bytes=4 * 1024**3)
        temporary = self.output / 'generator-status.tmp'
        temporary.write_text(json.dumps(value) + '\n')
        os.replace(temporary, self.output / 'generator-status.json')
        with (self.output / 'generator-metrics.jsonl').open('a') as stream:
            stream.write(json.dumps(value) + '\n')

    def monitor(self):
        try:
            while not self.stop_event.wait(5):
                started = int(time.time() * 1000)
                status = self.rpc('status')
                if not status['active'] or status['available_bytes'] < 4 * 1024**3 or status['scratch_free_bytes'] < 1024**3 or status['shared_memory_free_bytes'] < 4 * 1024**3 or status['owned_bytes'] > 2 * 1024**3:
                    raise RuntimeError('Marco generator resource/readiness guard refused')
                self.publish_status(status, started)
        except Exception as error:
            self.failure = str(error)
            self.publish_status({'active': False, 'error': self.failure})
            try: self.rpc('stop')
            except Exception: pass  # close() must still verify exact owned cleanup.

    def close(self):
        self.stop_event.set()
        failure = None
        if self.thread:
            self.thread.join(timeout=50)
            if self.thread.is_alive():
                failure = 'Marco monitor cleanup is unconfirmed'
        receipt = {'directory': self.directory, 'health_failure': self.failure}
        try:
            receipt.update(self.rpc('stop') if self.directory else {'not_started': True})
        except Exception as error:
            failure = str(error)
        finally:
            if self.tunnel:
                try:
                    if self.tunnel.poll() is None:
                        os.killpg(self.tunnel.pid, signal.SIGTERM)
                    try:
                        receipt['tunnel_exit'] = self.tunnel.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        receipt['forced_owned_tunnel_stop'] = True
                        if self.tunnel.poll() is None:
                            os.killpg(self.tunnel.pid, signal.SIGKILL)
                        receipt['tunnel_exit'] = self.tunnel.wait(timeout=5)
                except Exception as error:
                    failure = 'Owned tunnel cleanup: ' + str(error)
                finally:
                    self.tunnel_log.close()
        if self.directory and not failure:
            try: receipt.update(self.rpc('ports'))
            except Exception as error: failure = str(error)
        if receipt.get('web_service_unchanged') is False:
            self.failure = 'Retired Marco exam service changed during qualification'
            receipt['health_failure'] = self.failure
        if failure: receipt['cleanup_error'] = failure
        (self.output / 'generator-cleanup.json').write_text(json.dumps(receipt, indent=2) + '\n')
        if failure:
            raise RuntimeError('Marco generator cleanup unconfirmed: ' + failure)
