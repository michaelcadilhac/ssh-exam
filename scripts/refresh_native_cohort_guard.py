#!/usr/bin/env python3
"""Refresh matched native guard metadata over the existing trusted SSH bridge.

Run on the development host. Only the private release stage is written; this
does not install binaries, stop services or change student authority. While a
web resume waits for startup, repeat after-refresh at intervals below 90 seconds.
The handoff action obtains a fresh stopped-web proof before native write phases.
"""
import argparse
import base64
import datetime
import hashlib
import json
from pathlib import Path
import shlex
import subprocess
import sys

from fresh_native_cohort_guard import validate


def handoff(release, places):
    """Bridge only the controller's freshly observed stopped-web proof."""
    read=['sudo','-n','/usr/bin/python3',str(Path(places['web_code'])/'scripts/deploy-web-ui'),'handoff','--state',places['web_state']]
    result=subprocess.run(['ssh','-o','BatchMode=yes','-o','ConnectTimeout=10','marco',shlex.join(read)],capture_output=True,text=True,timeout=30)
    if result.returncode: raise SystemExit(result.stderr or 'Fresh web handoff refused; preserve current state')
    proof=json.loads(result.stdout)
    at=datetime.datetime.fromisoformat(proof['at'])
    assert at.tzinfo is not None and -1 <= (datetime.datetime.now(datetime.timezone.utc)-at).total_seconds() <= 90, 'Web handoff expired'
    expected={'nonce':release['native_update']['nonce'],'phase':'WAITING_NATIVE','web_state':places['web_state'],
              'revision':release['revision'],'image_config_id':release['image_config_id'],
              'native_binary_sha256':release['native_update']['after']['binary_sha256'],
              'web_image_config_id':release['old_image_config_id'],'web_stopped':True,'web_fenced':True}
    assert all(proof.get(k)==v for k,v in expected.items()), 'Web handoff belongs to another candidate or is not stopped'
    assert len(proof['web_status_sha256'])==64 and all(c in '0123456789abcdef' for c in proof['web_status_sha256'])
    write=r'''from pathlib import Path
import json,os,stat,sys,tempfile
s=Path(sys.argv[1]);assert os.geteuid()==0 and not any(p.is_symlink() for p in (s,*s.parents)) and s.stat().st_uid==0 and not s.stat().st_mode&0o077
raw=sys.stdin.buffer.read(131073);assert len(raw)<=131072;proof=json.loads(raw);release=json.loads((s/'release.json').read_bytes())
assert proof['nonce']==release['native_update']['nonce'] and proof['revision']==release['revision'] and proof['image_config_id']==release['image_config_id']
p=s/'web-stop.json'
if p.exists() or p.is_symlink():
 info=p.lstat();assert stat.S_ISREG(info.st_mode) and info.st_uid==0 and not info.st_mode&0o077 and info.st_nlink==1
 assert json.loads(p.read_bytes())['nonce']==proof['nonce'],'Preserve a foreign handoff'
fd,name=tempfile.mkstemp(prefix='.web-handoff-',dir=s)
try:
 with os.fdopen(fd,'wb') as out:out.write(raw);out.flush();os.fchmod(out.fileno(),0o600);os.fsync(out.fileno())
 os.replace(name,p)
finally:Path(name).unlink(missing_ok=True)
fd=os.open(s,os.O_DIRECTORY);os.fsync(fd);os.close(fd)
print(json.dumps({'phase':'WEB_STOP_BRIDGED','nonce':proof['nonce'],'at':proof['at']}),flush=True)
'''
    result=subprocess.run(['ssh','-o','BatchMode=yes','-o','ConnectTimeout=10','csc-sys',shlex.join(['sudo','-n','python3','-c',write,places['class_stage']])],input=json.dumps(proof),capture_output=True,text=True,timeout=25)
    if result.returncode: raise SystemExit(result.stderr or 'Web handoff bridge failed; preserve current state')
    print(result.stdout,end='')


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--release-dir',required=True,type=Path)
    p.add_argument('phase',choices=['before','after','handoff'],help='handoff refreshes the stopped-web proof before a native write phase')
    args=p.parse_args();release=json.loads((args.release_dir/'release.json').read_text());places=json.loads((args.release_dir/'locations.json').read_text())
    if args.phase=='handoff':
        handoff(release,places)
        return
    read=r'''from pathlib import Path
import base64,contextlib,hashlib,io,json,os,runpy,stat,sys
s=Path(sys.argv[1]);expected=sys.argv[2];phase=sys.argv[3]
assert os.geteuid()==0 and not any(p.is_symlink() for p in (s,*s.parents)) and s.stat().st_uid==0 and not s.stat().st_mode&0o077
p=s/'deploy-native-cohort';info=p.lstat();assert stat.S_ISREG(info.st_mode) and info.st_uid==0 and not info.st_mode&0o022 and hashlib.sha256(p.read_bytes()).hexdigest()==expected
output=io.StringIO();sys.argv=[str(p),'--stage',str(s),'guard-'+phase]
with contextlib.redirect_stdout(output):runpy.run_path(str(p),run_name='__main__')
value={'receipt':json.loads(output.getvalue())}
if phase=='after':
 p=s/'native-transition.json';info=p.lstat();assert stat.S_ISREG(info.st_mode) and info.st_uid==0 and not info.st_mode&0o077 and info.st_nlink==1 and info.st_size<65536
 value['transition']=base64.b64encode(p.read_bytes()).decode()
print(json.dumps(value),flush=True)
'''
    result=subprocess.run(['ssh','-o','BatchMode=yes','-o','ConnectTimeout=10','csc-sys',shlex.join(['sudo','-n','python3','-c',read,places['class_stage'],release['native_update']['controller_sha256'],args.phase])],capture_output=True,text=True,timeout=80)
    if result.returncode: raise SystemExit(result.stderr or 'Class guard failed; no web guard refreshed')
    reply=json.loads(result.stdout);transition=base64.b64decode(reply['transition']) if args.phase=='after' else None
    validate(release,reply['receipt'],args.phase,transition)
    payload={'nonce':release['native_update']['nonce'],'receipt':reply['receipt'],'transition':reply.get('transition')}
    write=r'''from pathlib import Path
import base64,json,os,stat,sys,tempfile
s=Path(sys.argv[1]);phase=sys.argv[2];assert os.geteuid()==0 and not s.is_symlink() and s.stat().st_uid==0 and not s.stat().st_mode&0o077
raw=sys.stdin.buffer.read(131073);assert len(raw)<=131072;value=json.loads(raw);release=json.loads((s/'release.json').read_text());assert value['nonce']==release['native_update']['nonce']
def atomic(path,data,immutable=False):
 if path.exists() or path.is_symlink():
  info=path.lstat();assert stat.S_ISREG(info.st_mode) and info.st_uid==0 and not info.st_mode&0o077 and info.st_nlink==1
  if immutable:assert path.read_bytes()==data,'Transition receipt is immutable';return
  assert json.loads(path.read_bytes())['nonce']==value['nonce'],'Preserve a foreign guard'
 fd,name=tempfile.mkstemp(prefix='.native-bridge-',dir=s)
 try:
  with os.fdopen(fd,'wb') as out:out.write(data);out.flush();os.fchmod(out.fileno(),0o600);os.fsync(out.fileno())
  os.replace(name,path)
 finally:Path(name).unlink(missing_ok=True)
if phase=='after':
 path=Path(release['native_update']['transition_receipt']);assert path.parent==s
 atomic(path,base64.b64decode(value['transition']),True)
atomic(s/('native-guard-'+phase+'.json'),json.dumps({'nonce':value['nonce'],'receipt':value['receipt']},separators=(',',':')).encode())
fd=os.open(s,os.O_DIRECTORY);os.fsync(fd);os.close(fd)
print(json.dumps({'phase':'NATIVE_GUARD_BRIDGED','cohort':phase,'observed':value['receipt']['at'],'production_authority_changed':False}),flush=True)
'''
    result=subprocess.run(['ssh','-o','BatchMode=yes','-o','ConnectTimeout=10','marco',shlex.join(['sudo','-n','python3','-c',write,places['web_stage'],args.phase])],input=json.dumps(payload),capture_output=True,text=True,timeout=25)
    if result.returncode: raise SystemExit(result.stderr or 'Web guard bridge failed; preserve current state')
    print(result.stdout,end='')


if __name__=='__main__':main()
