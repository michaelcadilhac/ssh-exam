from pathlib import Path
import datetime,hashlib,json,os,sqlite3,subprocess,time,urllib.request,sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import deployment_pause
stage=Path(sys.argv[1]); release=json.loads((stage/'release.json').read_text()); settings=release['fast_ui']
root=Path(settings['project'])
expected_schema=int(sys.argv[2]);assert expected_schema == release['schema'] == release['old_schema']
assert len(sys.argv) in (3,4) and (len(sys.argv)==3 or sys.argv[3]=='stopped')
stopped=len(sys.argv)==4
now=int(time.time()*1000)
c=json.loads((root/'deploy/config/config.json').read_text())
assert c['mode']=='production' and c['maintenance'] is False and not c.get('functionalTest')
assert c['origin']=='https://ssh-exam.cadilhac.name'
db=sqlite3.connect('file:'+str(root/'var/production/metadata.sqlite')+'?mode=ro',uri=True)
db.execute('PRAGMA query_only=ON');db.execute('BEGIN')
queries={
 'unfinished':"SELECT count(*) FROM attempts WHERE coalesce(state,'') NOT IN ('COMPLETED','CANCELLED_BEFORE_START')",
 'unprotected':"SELECT count(*) FROM attempts WHERE state='COMPLETED' AND coalesce(protected,0)<>1",
 'unreleased':"SELECT count(*) FROM attempts WHERE state='COMPLETED' AND coalesce(access_state,'') NOT IN ('RELEASED','OVERRIDDEN')",
 'policy_access_errors':"SELECT count(*) FROM attempts WHERE coalesce(policy_error,'')<>'' OR coalesce(access_error,'')<>'' OR coalesce(policy_state,'NORMAL')<>'NORMAL'",
 'pending_clock':"SELECT count(*) FROM clock_reset_requests WHERE status<>'applied'",
 'pending_alerts':"SELECT count(*) FROM outbox WHERE status='pending'",
 'previews':'SELECT count(*) FROM previews',
}
counts={key:db.execute(q).fetchone()[0] for key,q in queries.items()}
video_tables={'monitoring_video_segments','monitoring_video_frames','monitoring_video_jobs','monitoring_video_requests'}
present={row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}&video_tables
if present:
 assert present==video_tables,'Incomplete video schema; preserve records and inspect the matched migration'
 pause=deployment_pause.owned(root/'var/production',stage,json.loads((stage/'status.json').read_text())) if (stage/'status.json').exists() else False
 counts['video_jobs']=db.execute("SELECT count(*) FROM monitoring_video_jobs WHERE status IN ('pending','running','retry')").fetchone()[0]
 counts['video_running']=db.execute("SELECT count(*) FROM monitoring_video_jobs WHERE status='running' OR owner IS NOT NULL").fetchone()[0]
 counts['video_unqueued']=db.execute("""SELECT count(*) FROM attempts a
 LEFT JOIN monitoring_video_jobs j ON j.attempt=a.id
 WHERE a.state='COMPLETED' AND a.start IS NOT NULL AND a.ended IS NOT NULL
 AND j.attempt IS NULL AND NOT EXISTS(SELECT 1 FROM tombstones t WHERE t.attempt=a.id)""").fetchone()[0]
 counts['video_unmapped_complete']=db.execute("""SELECT count(*) FROM monitoring_video_jobs j
 JOIN attempts a ON a.id=j.attempt WHERE j.status='complete'
 AND a.state='COMPLETED' AND a.start IS NOT NULL AND a.ended IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM tombstones t WHERE t.attempt=a.id)
 AND EXISTS(SELECT 1 FROM frames f WHERE f.attempt=a.id
 AND NOT EXISTS(SELECT 1 FROM monitoring_video_frames v WHERE v.frame=f.id))""").fetchone()[0]
 if pause:
  # The scheduler observes this installer's durable marker and starts no new
  # chunks. Never permit a running job or unresolved process owner.
  counts['video_queued_while_owned_pause']=counts.pop('video_jobs')
  counts['video_unqueued_while_owned_pause']=counts.pop('video_unqueued')
  counts['video_unmapped_while_owned_pause']=counts.pop('video_unmapped_complete')
  allowed_video={key:counts.pop(key) for key in list(counts) if key.endswith('_while_owned_pause')}
 else:allowed_video={}
for key,q,args in [
 ('sessions','SELECT count(*) FROM sessions WHERE expires>?',(now,)),
 ('continuations','SELECT count(*) FROM continuations WHERE consumed=0 AND expires>?',(now,)),
 ('future_deadlines','SELECT count(*) FROM attempts WHERE deadline>? OR original_deadline>?',(now,now)),
 ('grant_reviews',"SELECT count(*) FROM grant_issuance_previews WHERE status='REVIEW' AND expires>?",(now,)),
 ('begin_pending',"SELECT count(*) FROM grant_begin_intents WHERE state='PENDING'",()),
]:counts[key]=db.execute(q,args).fetchone()[0]
assert not any(counts.values()),('BUSY/UNCERTAIN',counts)
assert db.execute('SELECT max(version) FROM schema_version').fetchone()[0]==expected_schema
assert db.execute("SELECT count(*) FROM grant_source_setup WHERE status NOT IN ('READY','CANCELLED')").fetchone()[0]==0,'Pending/failed source setup remains'
assert not db.execute('PRAGMA foreign_key_check').fetchall()
historical=db.execute('SELECT count(*) FROM attempts').fetchone()[0]
history_hash=hashlib.sha256(json.dumps(db.execute('SELECT * FROM attempts ORDER BY id').fetchall(),separators=(',',':')).encode()).hexdigest()
if stopped:
 # Resume-only proof: every original idle/hold/history SQL check above still
 # applies. A stopped gateway cannot publish fresh callbacks; its caller MUST
 # also obtain the independent fresh pinned native guard before using this proof.
 db.rollback();db.close()
 container=json.loads(subprocess.check_output(['docker','inspect','ssh-exam-app-1'],timeout=15))[0]
 assert not container['State']['Running'],'Unknown running gateway; do not take it over'
 assert subprocess.check_output(['systemctl','show','ssh-exam.service','-p','ActiveState','--value'],text=True,timeout=15).strip()=='inactive'
 print(json.dumps({'guard':'PASS','scope':'STOPPED','counts':counts,'video_pause':{'owned':pause,'stable_backlog':allowed_video} if present else None,'attempts':historical,'history_sha256':history_hash,'image':container['Image'],'fresh_native_guard_required':True,'production_writes':False}),flush=True)
 raise SystemExit(0)
snapshot=json.loads(db.execute('SELECT payload FROM agent_snapshot WHERE agent=?',(c['agent']['id'],)).fetchone()[0])
h=snapshot['health'];roles=h['native_roles'];age=now-roles['observed']
assert h['production_ready'] and roles['complete'] and roles['retained_enabled'] and not h.get('missing') and -1000<=age<120000
db.rollback();db.close()
container=json.loads(subprocess.check_output(['docker','inspect','ssh-exam-app-1'],timeout=15))[0]
assert container['State']['Running'] and container['State']['Health']['Status']=='healthy'
assert container['Config']['User']=='10001:10001' and container['HostConfig']['ReadonlyRootfs'] and container['HostConfig']['CapDrop']==['ALL']
pending=[container['State']['Pid']];pids=[];inodes=set()
while pending:
 pid=pending.pop();pids.append(pid)
 pending.extend(map(int,Path(f'/proc/{pid}/task/{pid}/children').read_text().split()))
 for fd in Path(f'/proc/{pid}/fd').iterdir():
  try:target=os.readlink(fd)
  except FileNotFoundError:continue
  if target.startswith('socket:['):inodes.add(target[8:-1])
connections=0
for family in ('tcp','tcp6'):
 for line in Path(f'/proc/{pids[0]}/net/{family}').read_text().splitlines()[1:]:
  fields=line.split()
  if fields[9] in inodes and fields[3]!='0A':connections+=1
assert len(pids)==2 and connections==0,('BUSY/UNCERTAIN',len(pids),connections)
with urllib.request.urlopen('http://127.0.0.1:3001/health/ready',timeout=5) as response:ready=json.load(response)
assert ready['ready'] and ready['productionReady'] and not ready['maintenance']
print(json.dumps({'guard':'PASS','host':'marco','at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'counts':counts,'video_pause':{'owned':pause,'stable_backlog':allowed_video} if present else None,'attempts':historical,'history_sha256':history_hash,'image':container['Image'],'container_processes':len(pids),'owned_tcp_connections':connections,'snapshot_age_ms':age,'nginx_sha256':hashlib.sha256(Path(settings['nginx_site']).read_bytes()).hexdigest(),'config_sha256':hashlib.sha256((root/'deploy/config/config.json').read_bytes()).hexdigest(),'env_sha256':hashlib.sha256(Path(settings['environment']).read_bytes()).hexdigest(),'production_writes':False}),flush=True)
