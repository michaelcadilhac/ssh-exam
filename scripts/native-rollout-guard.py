from pathlib import Path
import json,subprocess,time,os,hashlib,datetime,sys,re
def verify_cli_cohort(release, phase, installed, worker, worker_pid):
 assert release['schema']==37,'Expected matched schema37 release'
 assert phase in ('before-cli','after-cli'),'Choose before-cli or after-cli explicitly'
 for key in ('old_cli_sha256','cli_sha256','worker_cli_sha256'):
  assert re.fullmatch('[a-f0-9]{64}',release[key]),'Invalid pinned CLI digest'
 expected=release['old_cli_sha256' if phase=='before-cli' else 'cli_sha256']
 assert installed==expected,'Installed CLI changed'
 assert worker==release['worker_cli_sha256'],'Loaded source worker changed'
 assert worker_pid==int(release['service_pids']['exam-source-setup.service']),'Source worker restarted'
 return {'installed':installed,'worker':worker,'same_binary':installed==worker}

assert len(sys.argv)==3,'native-guard.py STAGE before-cli|after-cli'
stage=Path(sys.argv[1]);release=json.loads((stage/'release.json').read_text());phase=sys.argv[2]
assert phase in ('before-cli','after-cli')
assert release['schema']==37,'Expected matched schema37 release'

config=Path('/etc/exam-agent/agent.json');assert hashlib.sha256(config.read_bytes()).hexdigest()==release['native_config_sha256'],'Native configuration changed'
c=json.loads(config.read_text());root=Path(c['state']);raw=(root/'state.json').read_bytes();s=json.loads(raw);now=int(time.time()*1000);ats=list(s['attempts'].values())
assert c['state']=='/var/lib/exam-agent' and c['work']=='/srv/exam-workspace/work'
assert all(a['state'] in ('COMPLETED','CANCELLED_BEFORE_START') for a in ats)
assert all(not a.get('units') and not a.get('preparation_pending') and not a.get('timing_pending_since') for a in ats)
assert all(max(a.get('deadline') or 0,a.get('original_deadline') or 0)<=now for a in ats)
assert all(a.get('protected') and a.get('access_state') in ('RELEASED','OVERRIDDEN') for a in ats if a['state']=='COMPLETED')
assert all((a.get('policy_state') or 'NORMAL')=='NORMAL' and not a.get('policy_error') and not a.get('access_error') for a in ats)
assert not s.get('capabilities') and all(until<=now for until in s.get('commands',{}).values()) and not s.get('pane_instances')
journals=[json.loads(p.read_text()) for p in (root/'account-policy').iterdir() if p.name.endswith('.json')]
assert all(j['phase']=='NORMAL' and not j.get('error') for j in journals)
leases=[json.loads(p.read_text()) for p in (root/'leases').iterdir() if p.name.endswith('.json')]
assert all(l['until']<=now for l in leases)
units=['exam-agent.service','exam-deadline-watchdog.service'];owners=[];pids=set()
worker_result=subprocess.run(['systemctl','show','exam-source-setup.service','-p','ActiveState','--value'],capture_output=True,text=True,timeout=10);assert worker_result.returncode==0,worker_result.stderr
worker=worker_result.stdout.strip();assert worker=='active','Existing saved-work worker unavailable'
if worker=='active':
 assert release['schema']==37
 assert hashlib.sha256(Path('/etc/systemd/system/exam-source-setup.service').read_bytes()).hexdigest()==release['unit_sha256']
 units.append('exam-source-setup.service')
for unit in units:
 p=subprocess.run(['systemctl','show',unit,'-p','MainPID','-p','ControlGroup','-p','ActiveState'],capture_output=True,text=True,timeout=10);assert p.returncode==0,p.stderr
 v=dict(line.split('=',1) for line in p.stdout.splitlines());pid=int(v['MainPID']);assert pid>0 and v['ActiveState']=='active';pids.add(pid)
 members=set();group=Path('/sys/fs/cgroup'+v['ControlGroup'])
 for f in group.rglob('cgroup.procs'):members.update(map(int,f.read_text().split()))
 assert members=={pid},'Unexpected agent/watchdog descendant'
 for fd in Path(f'/proc/{pid}/fd').iterdir():
  try:target=os.readlink(fd)
  except FileNotFoundError:continue
  assert not target.startswith('/dev/pts/') and target!='/dev/ptmx','PTY owner remains'
 owners.append({'unit':unit,'pid':pid})
for label in ['exam.slice','examterminal.slice','exam-collection.slice','exam-template.slice','exam-publish.slice']:
 group=Path('/sys/fs/cgroup')/label
 if group.exists():assert not any(f.read_text().strip() for f in group.rglob('cgroup.procs')),'Exam workload cgroup populated'
other_root_scripts=[]
for proc in Path('/proc').iterdir():
 if not proc.name.isdigit():continue
 try:
  exe=os.readlink(proc/'exe');base=Path(exe).name;pid=int(proc.name)
  if base.startswith('exam-') and base!='exam-ssh-relay':assert pid in pids,'Unexpected native exam process'
  if pid!=os.getpid() and proc.stat().st_uid==0 and ('python' in base or base=='node'):
   argv=[x.decode(errors='replace') for x in (proc/'cmdline').read_bytes().split(b'\0') if x]
   scripts={'/system.slice/networkd-dispatcher.service':'/usr/bin/networkd-dispatcher',
            '/system.slice/unattended-upgrades.service':'/usr/share/unattended-upgrades/unattended-upgrade-shutdown',
            '/system.slice/rhsm.service':'/usr/libexec/rhsm-service',
            '/system.slice/rhsm-facts.service':'/usr/libexec/rhsm-facts-service'}
   group=(proc/'cgroup').read_text().strip().removeprefix('0::')
   if pid==os.getppid() and len(argv)==3 and argv[1]==str(stage/'install-cli.py') and argv[2]==str(stage):
    assert stage.is_absolute() and not stage.is_symlink() and stage.stat().st_uid==0 and not stage.stat().st_mode&0o077
    helper=stage/'install-cli.py';manifest=json.loads((stage/'upload-manifest.json').read_text())
    assert helper.is_file() and not helper.is_symlink() and helper.stat().st_uid==0
    assert hashlib.sha256(helper.read_bytes()).hexdigest()==manifest['install-cli.py']['sha256'],'Installer parent not the staged audited helper'
    continue
   if group in scripts:
    assert scripts[group] in argv,'Unexpected system-service script'
    script=scripts[group]
   else:
    # Independently inspected Azure Monitor daemons, started by the host admin.
    # Match these exact existing processes; never admit arbitrary session scripts.
    script='/var/lib/waagent/Microsoft.Azure.Monitor.AzureMonitorLinuxAgent-1.45.1/agent.py'
    assert pid in {804501,804503,805221} and len(argv)>1 and argv[1]==script,'Unclassified root script process'
    path=Path(script)
    for component in [path,*path.parents]:
     info=component.lstat();assert info.st_uid==0 and not info.st_mode&0o022,'Unprotected host monitor path'
    assert os.readlink(proc/'cwd')==str(path.parent),'Unexpected monitor working directory'
    assert os.readlink(proc/'fd/1')==str(path.parent/'daemon.log') and os.readlink(proc/'fd/2')==str(path.parent/'daemon.log')
    assert not (proc/'task'/str(pid)/'children').read_text().strip(),'Unexpected monitor descendants'
   other_root_scripts.append({'pid':pid,'exe':base,'script':script,'unit':group.rsplit('/',1)[-1]})
 except (FileNotFoundError,ProcessLookupError):continue
assert not any(x['script'].startswith(('/tmp/','/var/tmp/')) for x in other_root_scripts),'Unreviewed temporary root helper'

for unit in ['exam-agent-live-upgrade.service','exam-agent-deferred-recovery.service']:
 r=subprocess.run(['systemctl','show',unit,'-p','LoadState','--value'],capture_output=True,text=True,timeout=10)
 assert r.returncode==0 and r.stdout.strip()=='not-found','Temporary role returned'
worker_pid=next(row['pid'] for row in owners if row['unit']=='exam-source-setup.service')
cohort=verify_cli_cohort(release,phase,
 hashlib.sha256(Path('/usr/local/sbin/examctl').read_bytes()).hexdigest(),
 hashlib.sha256(Path('/proc/'+str(worker_pid)+'/exe').read_bytes()).hexdigest(),worker_pid)
expected={'/usr/local/sbin/exam-agent':release['agent_sha256'],'/usr/local/sbin/examctl':cohort['installed']}
for path,digest in expected.items():assert hashlib.sha256(Path(path).read_bytes()).hexdigest()==digest,'Installed cohort changed'
assert sum(l.rstrip().endswith(c['socket']) for l in Path('/proc/net/unix').read_text().splitlines()[1:])==1,'Expected exactly one canonical socket owner'
for owner in owners:
 assert owner['pid']==int(release['service_pids'][owner['unit']]),'Native service restarted'
 running_expected=cohort['worker'] if owner['unit']=='exam-source-setup.service' else release['agent_sha256']
 assert hashlib.sha256(Path('/proc/'+str(owner['pid'])+'/exe').read_bytes()).hexdigest()==running_expected,'Running cohort changed'
relay_result=subprocess.run(['systemctl','show','exam-ssh-relay.service','-p','MainPID','-p','ControlGroup','-p','ActiveState'],capture_output=True,text=True,timeout=10);assert relay_result.returncode==0,relay_result.stderr
relay=dict(line.split('=',1) for line in relay_result.stdout.splitlines());relay_pid=int(relay['MainPID']);assert relay_pid>0 and relay['ActiveState']=='active','Existing relay unavailable'
relay_group=Path('/sys/fs/cgroup'+relay['ControlGroup']);assert relay['ControlGroup'].startswith('/') and relay_group.is_dir()
relay_members=set()
for f in relay_group.rglob('cgroup.procs'):relay_members.update(map(int,f.read_text().split()))
assert relay_members=={relay_pid},'Unexpected relay descendant'
relay_exe=Path('/usr/local/libexec/exam-ssh-relay');assert relay_exe.stat().st_uid==0 and not relay_exe.stat().st_mode&0o022,'Relay executable unprotected'
assert os.readlink('/proc/'+str(relay_pid)+'/exe')==str(relay_exe),'Relay process has unexpected executable'
relay_sha256=hashlib.sha256(relay_exe.read_bytes()).hexdigest();assert hashlib.sha256(Path('/proc/'+str(relay_pid)+'/exe').read_bytes()).hexdigest()==relay_sha256,'Running relay differs from installed executable'
r=subprocess.run(['systemctl','show','exam-reconcile.timer','-p','ActiveState','-p','UnitFileState'],capture_output=True,text=True,timeout=10)
assert r.returncode==0 and 'ActiveState=active' in r.stdout and 'UnitFileState=enabled' in r.stdout,'Reconcile timer unavailable'
history_sha256=hashlib.sha256(json.dumps(s['attempts'],sort_keys=True,separators=(',',':')).encode()).hexdigest()
assert history_sha256==release['native_history_sha256'],'Native attempt history changed'
assert hashlib.sha256(Path('/etc/exam-agent/examctl.json').read_bytes()).hexdigest()==release['cli_config_sha256'],'CLI proxy configuration changed'
assert relay_pid==int(release['service_pids']['exam-ssh-relay.service']) and relay_sha256==release['relay_sha256'],'Relay changed'

print(json.dumps({'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'guard':'PASS','host':'csc-sys','historical_attempts':len(ats),'normal_policy_journals':len(journals),'expired_leases':len(leases),'native_roles':owners,'single_socket_owner':True,'temporary_roles_absent':True,'expected_cohort_hashes_verified':True,'installed_cli_matches_loaded_worker':cohort['same_binary'],'installed_cli_sha256':cohort['installed'],'worker_cli_sha256':cohort['worker'],'phase':phase,'reconciler':'active/enabled','history_sha256':hashlib.sha256(json.dumps(s['attempts'],sort_keys=True,separators=(',',':')).encode()).hexdigest(),'config_sha256':hashlib.sha256(config.read_bytes()).hexdigest(),'cli_config_sha256':hashlib.sha256(Path('/etc/exam-agent/examctl.json').read_bytes()).hexdigest(),'relay_pid':relay_pid,'relay_sha256':relay_sha256,'relay_active':relay['ActiveState'],'relay_cgroup_single_owner':True,'worker_active':worker,'production_writes':False}))
