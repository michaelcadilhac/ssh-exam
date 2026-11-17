#!/usr/bin/env python3
"""Explicit manual stress qualification. Never called by builds or deployment."""
import argparse
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import signal
import stat
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
PHASES = ('harness', 'build', 'installed-capacity', 'anonymous-burst', 'application', 'operator-integrations', 'native-race', 'browser-signin', 'browser-corners',
          'native-editor', 'native-timer-recovery', 'native-recovery', 'native-collection', 'endurance')
MARCO_PHASES = ('native-editor','native-timer-recovery','native-recovery','native-collection','endurance')


def source_manifest():
    names=subprocess.check_output(['git','ls-files','-co','--exclude-standard','-z','--',
                                   'apps','packages','ssh-server','scripts','tests','package.json','package-lock.json'],cwd=ROOT)
    result={}
    for name in sorted(set(filter(None,names.decode().split('\0')))):
        path=ROOT/name
        raw=os.readlink(path).encode() if path.is_symlink() else path.read_bytes()
        result[name]={'sha256':hashlib.sha256(raw).hexdigest(),'mode':path.lstat().st_mode}
    return result


def local_scratch(output):
    scratch = output / 'temporary'
    try:
        scratch.mkdir(mode=0o700)
    except FileExistsError as error:
        raise RuntimeError('Owned stress scratch already exists; preserve it and use a new phase attempt') from error
    info = scratch.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise RuntimeError('Private stress scratch ownership/mode refused')
    if shutil.disk_usage(scratch).free < 40 * 1024**3:
        raise RuntimeError('The70-person run needs40GiB free in its private workspace scratch; /tmp is unsuitable for the measured raw recordings')
    probe = scratch / 'write-probe'
    fd = os.open(probe, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(b'private synthetic scratch\n')
            stream.flush();os.fsync(stream.fileno())
    finally:
        probe.unlink()
    return scratch


def endurance_receipt(output,seconds):
    files=list((output/'browser').rglob('endurance-result.json'))
    if len(files)!=1:
        return 'Missing unique70-student endurance receipt; skipped/empty tests do not qualify'
    value=json.loads(files[0].read_text())
    if (value.get('students'),value.get('terminals'),value.get('requested_seconds'),value.get('protected'),value.get('preservation')) != (70,280,seconds,70,'FULL'):
        return 'Endurance receipt does not prove the requested fleet, duration, protected work and preservation'
    if value.get('peak_seconds',0)<seconds:
        return 'The requested real peak duration was not completed'
    if value.get('pane_refusals'):
        return 'Recovered terminal refusals are retained failures, not a clean endurance pass'
    return None


def marco_generator(output):
    spec = importlib.util.spec_from_file_location('stress_generator', ROOT / 'scripts/stress_generator.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.MarcoGenerator(output)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--native-bundle', required=True, help='Audited code-only bundle in a NEW private csc-sys directory')
    p.add_argument('--run-id', help='Existing run to resume; prior phase receipts are retained')
    p.add_argument('--phase', choices=('all', *PHASES), default='all')
    p.add_argument('--rehearsal', action='store_true', help='70-student30s harness rehearsal; never a full endurance pass')
    p.add_argument('--generator', choices=('local', 'marco'), default='local',
                   help='Browser host for guarded native phases/endurance; Marco uses an owned isolated worker and private SSH forwards')
    args = p.parse_args()
    if args.generator == 'marco' and args.phase not in ('all', *MARCO_PHASES):
        p.error('--generator marco requires a guarded native phase, endurance or all')
    if not re.fullmatch(r'/var/tmp/ssh-exam-browser-native-upload\.[A-Za-z0-9_]+', args.native_bundle):
        p.error('Expected a private code-only native-browser upload directory')
    run = args.run_id or datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    if not re.fullmatch(r'\d{8}T\d{6}Z(?:-rehearsal)?', run):
        p.error('Run ID must be a UTC timestamp, optionally suffixed-rehearsal')
    evidence = ROOT / 'var/stress' / run
    report = ROOT / 'reports/stress' / run
    os.umask(0o077)
    evidence.mkdir(parents=True, exist_ok=True, mode=0o700)
    report.mkdir(parents=True, exist_ok=True)
    metadata = evidence / 'run.json'
    source = subprocess.check_output(['git','rev-parse','HEAD'], cwd=ROOT, text=True).strip()
    diff = subprocess.check_output(['git','diff','--','apps','packages','ssh-server','tests','scripts'], cwd=ROOT)
    state = json.loads(metadata.read_text()) if metadata.exists() else {
        'run':run,'started':datetime.now(timezone.utc).isoformat(),'phases':[],
        'students':70,'terminals':280,'endurance_seconds':30 if args.rehearsal else 5400,
        'source':source,'source_diff_sha256':hashlib.sha256(diff).hexdigest(),
        'native_bundle':args.native_bundle,'mfa':False,'real_student_accounts':False,'outbound_mail':False,
        'environment':'isolated local gateway/browser + guarded private csc-sys guest',
        'limitations':['Browser screen/camera/keyboard permissions and jump authentication are synthetic; institutional MFA is excluded.',
                       'The gateway is local; this does not certify production gateway co-location resource capacity.']}
    if state.get('endurance_seconds') not in (None,30 if args.rehearsal else 5400):
        p.error('Cannot replace a rehearsal with a full run under the same ID')
    state.setdefault('phases',[])
    def save():
        metadata.write_text(json.dumps(state,indent=2)+'\n')
        (report/'results.json').write_text(json.dumps(state,indent=2)+'\n')
    chosen = PHASES if args.phase=='all' else (args.phase,)
    for phase in chosen:
        attempt = sum(row['phase']==phase for row in state['phases'])+1
        output = evidence / (phase+'-'+str(attempt))
        output.mkdir(mode=0o700)
        env = dict(os.environ)
        # Explicit values prevent inherited production configuration selecting a service.
        for key in tuple(env):
            if key.startswith('EXAM_BROWSER_NATIVE_') or key.startswith('EXAM_STRESS_'):
                del env[key]
        env['EXAM_BROWSER_SSH']='1'
        env['PLAYWRIGHT_JSON_OUTPUT_FILE']=str(output/'playwright.json')
        if phase=='harness':
            commands=[(['python3','-m','unittest','discover','-s','ssh-server/tests','-p','test_overlay_qualification.py'],ROOT,60),
                      (['python3','-m','unittest','discover','-s','ssh-server/tests','-p','test_browser_bridge.py'],ROOT,60),
                      (['python3','-m','unittest','discover','-s','tests','-p','test_stress_runner.py'],ROOT,60)]
            commands.append((['python3','-m','unittest','discover','-s','tests','-p','test_stress_generator.py'],ROOT,60))
            commands.append((['node','--test','tests/stress-network-proxy.cjs'],ROOT,30))
        elif phase=='build':
            commands=[(['npm','run','typecheck'],ROOT,180),(['npm','run','build'],ROOT,600)]
        elif phase=='installed-capacity':
            # Read one operating limit only. Never copy configuration/keys or
            # change the installed admission policy merely to get a green run.
            code="""import json,sys;from pathlib import Path
p=Path('/opt/ssh-exam/deploy/config/config.json');raw=p.read_bytes();assert len(raw)<=65536
c=json.loads(raw);limit=c.get('connectionWorkers',32);assert isinstance(limit,int) and limit>0
print(json.dumps({'installed_connection_workers':limit,'required_students':70,'meets_target':limit>=70}))
sys.exit(0 if limit>=70 else 1)
"""
            commands=[(['ssh','-o','BatchMode=yes','-o','ConnectTimeout=10','csc-sys',
                       shlex.join(['sudo','-n','python3','-c',code])],ROOT,30)]
        elif phase=='anonymous-burst':
            env['EXAM_STRESS_BASELINE_OUTPUT']=str(output/'baseline.json')
            commands=[(['node','--import','tsx','tests/fixtures/anonymous-bootstrap-burst.ts'],ROOT,60)]
        elif phase=='application':
            commands=[(['npm','test','--','--reporter=default','--reporter=json','--outputFile='+str(output/'vitest.json')],ROOT,1200)]
        elif phase=='operator-integrations':
            env.update(EXAM_MANAGEMENT_USERNS='1',EXAM_GRADING_BWRAP='1')
            commands=[(['npm','test','--','tests/integration/agent-management.test.ts',
                        'tests/integration/monitoring-export-cli.test.ts','tests/integration/offline-grading.test.ts',
                        '-t','runs actual root-mapped examctl|runs legacy and optimized private export|actual zsh workflow grades',
                        '--reporter=default','--reporter=json','--outputFile='+str(output/'vitest.json')],ROOT,600)]
        elif phase=='native-race':
            commands=[(['go','test','-race','-count=1','-json','./...'],ROOT/'ssh-server',1200)]
        elif phase in ('browser-signin','browser-corners'):
            env['EXAM_BROWSER_GATEWAY_PROCESS']='1'
            selection=['tests/browser/ssh-signin-capacity.spec.ts'] if phase=='browser-signin' else []
            if phase=='browser-corners': env['EXAM_STRESS_SEPARATE_SIGNIN']='1'
            # Full ordinary suite: native-only cases remain explicitly skipped
            # here and run through their separate guarded phases below.
            commands=[(['npm','run','test:browser','--',*selection,
                        '--output',str(output/'browser'),'--reporter','list,json'],ROOT,3600)]
        elif phase in ('native-editor','native-timer-recovery'):
            env.update(EXAM_BROWSER_NATIVE_BUNDLE=args.native_bundle,EXAM_BROWSER_NATIVE_STUDENTS='1',
                       EXAM_BROWSER_NATIVE_RELEASE='1')
            if phase=='native-editor':
                env['EXAM_BROWSER_NATIVE_GATEWAY_PROCESS']='1'
                name='retained-native.spec.ts'
            else:
                env.update(EXAM_BROWSER_NATIVE_SSH_RECOVERY='1',EXAM_BROWSER_NATIVE_FILES_RESUME='1',
                           EXAM_BROWSER_NATIVE_TIMER_CONTROLS='1')
                name='retained-recovery.spec.ts'
            commands=[(['npm','run','test:browser','--','tests/browser/'+name,
                        '--output',str(output/'browser'),'--reporter','list,json'],ROOT,600)]
        elif phase in ('native-recovery','native-collection'):
            env.update(EXAM_BROWSER_NATIVE_BUNDLE=args.native_bundle,EXAM_BROWSER_NATIVE_STUDENTS='16',
                       EXAM_BROWSER_NATIVE_RELEASE='1',PLAYWRIGHT_JSON_OUTPUT_FILE=str(output/'playwright.json'))
            env['EXAM_BROWSER_NATIVE_CAPACITY_RECOVERY' if phase=='native-recovery' else 'EXAM_BROWSER_NATIVE_LARGE']='1'
            commands=[(['npm','run','test:browser','--','tests/browser/retained-capacity.spec.ts',
                        '--output',str(output/'browser'),'--reporter','list,json'],ROOT,1200)]
        else:
            env.update(EXAM_STRESS_RUN=run,EXAM_STRESS_OUTPUT=str(output/'browser'),
                       EXAM_STRESS_SECONDS='30' if args.rehearsal else '5400',
                       EXAM_BROWSER_NATIVE_BUNDLE=args.native_bundle,EXAM_BROWSER_NATIVE_STUDENTS='70',
                       EXAM_BROWSER_NATIVE_RELEASE='1')
            commands=[(['npm','run','test:browser','--','--config','tests/stress.config.ts'],ROOT,14400)]
        state['status']='RUNNING';save()
        current_diff = subprocess.check_output(['git','diff','--','apps','packages','ssh-server','tests','scripts'], cwd=ROOT)
        inputs=source_manifest()
        (output/'inputs.json').write_text(json.dumps(inputs,sort_keys=True)+'\n')
        row={'phase':phase,'attempt':attempt,'started':datetime.now(timezone.utc).isoformat(),
             'source':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
             'source_diff_sha256':hashlib.sha256(current_diff).hexdigest(),
             'inputs_sha256':hashlib.sha256(json.dumps(inputs,sort_keys=True).encode()).hexdigest(),
             'native_bundle':args.native_bundle,
             'status':'RUNNING','commands':[],'evidence':str(output.relative_to(ROOT))}
        state['phases'].append(row);save()
        generator = None
        failed = False
        cleanup_error = None
        use_marco = args.generator == 'marco' and phase in MARCO_PHASES
        row['generator'] = 'marco' if use_marco else 'local'
        try:
            if phase == 'endurance' or use_marco:
                scratch = local_scratch(output)
                env.update(TMPDIR=str(scratch), EXAM_STRESS_LOCAL_SCRATCH=str(scratch))
                row['local_scratch'] = str(scratch)
            if use_marco:
                generator = marco_generator(output)
                env.update(generator.start())
                if phase == 'endurance':
                    commands.insert(0, (['node','--import','tsx','tests/fixtures/stress-https-smoke.ts'],ROOT,330))
                commands.insert(0, (['node','scripts/stress-generator-smoke.cjs'],ROOT,45))
            for index,(command,cwd,timeout) in enumerate(commands):
                print(json.dumps({'run':run,'phase':phase,'attempt':attempt,'command':command}),flush=True)
                started=time.monotonic()
                with (output/('command-'+str(index)+'.log')).open('xb') as log:
                    child=subprocess.Popen(command,cwd=cwd,env=env,stdout=log,stderr=subprocess.STDOUT,start_new_session=True)
                    try:
                        code=child.wait(timeout=timeout)
                    except (subprocess.TimeoutExpired,KeyboardInterrupt):
                        # Signal only this owned test tree. Its fixture performs guarded guest cleanup.
                        os.killpg(child.pid,signal.SIGTERM)
                        try: code=child.wait(timeout=35)
                        except subprocess.TimeoutExpired:
                            row['status']='CLEANUP_UNCONFIRMED';row['pid']=child.pid
                            state['status']='INCOMPLETE';save()
                            raise RuntimeError('Owned test cleanup is still pending; preserve its state; do not launch another guest')
                        if code==0: code=124
                row['commands'].append({'argv':command,'exit':code,'seconds':round(time.monotonic()-started,3)})
                save()
                if code!=0: break
        except (Exception, KeyboardInterrupt) as error:
            failed = True
            row['reason'] = str(error)
        finally:
            if generator:
                try:
                    generator.close()
                    if generator.failure:
                        failed = True;row['reason'] = generator.failure
                except Exception as error:
                    cleanup_error = str(error)
        if cleanup_error or row['status']=='CLEANUP_UNCONFIRMED':
            row['status']='CLEANUP_UNCONFIRMED';row['reason']=cleanup_error or row.get('reason')
            state['status']='INCOMPLETE';save()
            raise RuntimeError('Owned cleanup is unconfirmed; preserve evidence and do not launch another test')
        row['status']='PASSED' if not failed and row['commands'] and all(c['exit']==0 for c in row['commands']) else 'FAILED'
        if row['status']=='PASSED' and source_manifest()!=inputs:
            row['status']='FAILED';row['reason']='Test source changed during execution; receipt is not qualified'
        if row['status']=='PASSED' and phase=='endurance':
            refusal=endurance_receipt(output,30 if args.rehearsal else 5400)
            if refusal: row['status']='FAILED';row['reason']=refusal
        row['finished']=datetime.now(timezone.utc).isoformat();save()
        print(json.dumps({'run':run,'phase':phase,'status':row['status']}),flush=True)
    latest={row['phase']:row for row in state['phases']}
    complete=all(name in latest for name in PHASES)
    failed=any(row['status']!='PASSED' for row in latest.values())
    state['status']='AUTOMATED_FAILED' if failed else 'AWAITING_AGENT_REVIEW' if complete else 'PARTIAL'
    save()
    print(json.dumps({'run':run,'status':state['status'],'report':str(report),'agent_report_required':True}),flush=True)
    return 1 if failed else 0


if __name__=='__main__':
    raise SystemExit(main())
