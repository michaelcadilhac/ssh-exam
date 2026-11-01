from pathlib import Path
import hashlib,json,os,re,subprocess,sys,time
stage=Path(sys.argv[1]);gate=json.loads((stage/'gate.json').read_text());settings=json.loads((stage/'release.json').read_text())['fast_ui']
assert hashlib.sha256(Path(settings['nginx_site']).read_bytes()).hexdigest()==gate['fence_sha256']
r=subprocess.run(['/usr/bin/nginx','-v'],capture_output=True,text=True,timeout=10);assert r.returncode==0 and 'nginx/1.30.3' in r.stderr
r=subprocess.run(['/usr/bin/nginx','-T'],capture_output=True,text=True,timeout=15);assert r.returncode==0;text=r.stdout
assert not re.search(r'(?m)^\s*(?:http2\s+on\s*;|listen\s+[^;\n]*\bhttp2\b|http3\s+on\s*;|listen\s+[^;\n]*\bquic\b)',text),'Multiplexed clients require a separate drain proof'
assert not re.search(r'(?m)^\s*keepalive_min_timeout\s+',text),'Nondefault keepalive minimum requires separate qualification'
assert any('8181' in block and 'ssh-exam.cadilhac.name' not in block for block in text.split('# configuration file '))
assert '8181' not in Path(settings['nginx_site']).read_text()
rows=[]
for pid in gate['old_workers']:
 p=Path('/proc')/str(pid)
 if not p.exists():continue
 command=(p/'cmdline').read_bytes().split(b'\0')[0];assert command==b'nginx: worker process is shutting down'
 identity=(p/'stat').read_text().rsplit(')',1)[1].split()[19]
 owned=set()
 for fd in (p/'fd').iterdir():
  try:target=os.readlink(fd)
  except FileNotFoundError:continue
  if target.startswith('socket:['):owned.add(target[8:-1])
 connections=[]
 for family in ('tcp','tcp6','udp','udp6'):
  for line in (p/'net'/family).read_text().splitlines()[1:]:
   fields=line.split()
   if fields[9] not in owned:continue
   assert family=='tcp' and fields[3]=='01','Unexpected listening/pending/multiplexed socket'
   local,remote=fields[1].rsplit(':',1),fields[2].rsplit(':',1);lp,rp=int(local[1],16),int(remote[1],16)
   assert lp!=3001 and rp!=3001
   assert lp==443 or (remote[0]=='0100007F' and rp==8181)
   connections.append((lp,rp))
 assert len(connections)==2 and sum(lp==443 for lp,rp in connections)==1 and sum(rp==8181 for lp,rp in connections)==1,'Every surviving HTTP/1 client must have its sole current request bound to the unrelated upstream'
 for line in (p/'net/unix').read_text().splitlines()[1:]:
  fields=line.split()
  if fields[6] in owned:assert len(fields)==7,'Unexpected named upstream socket'
 assert (p/'stat').read_text().rsplit(')',1)[1].split()[19]==identity
 rows.append({'pid':pid,'start_ticks':identity,'state':'shutting down','http1_current_upstream':8181,'exam_upstream':False,'listening_sockets':0})
receipt={'guard':'PASS','fenced':True,'relevant_old_exam_workers_drained':True,'remaining_unrelated_workers':rows,'nginx':'1.30.3','http2_http3':False,'keepalive_min_timeout':'default0','proof':'Exiting HTTP/1 workers cannot accept new connections or reuse their current non-exam request for pipelined/keepalive requests; current backend8181 is not exam3001. Existing unrelated connections preserved.','observed':int(time.time()*1000)}
(stage/'old-workers-qualified.json').write_text(json.dumps(receipt,indent=2)+'\n');print(json.dumps(receipt),flush=True)
