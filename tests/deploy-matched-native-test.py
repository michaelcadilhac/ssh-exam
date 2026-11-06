#!/usr/bin/env python3
"""Public web-controller handoff/recovery tests; native/systemd transport mocked.

Backups, SQLite preservation, nonce files, CLI dispatch and rendered fences are
real isolated filesystem operations. Actual loaded native roles/startup/proxy
qualification remains a separate release gate.
"""
import datetime
import importlib.util
from importlib.machinery import SourceFileLoader
import json
from pathlib import Path
import unittest
from unittest.mock import patch

path = Path(__file__).with_name('deploy-web-ui-test.py')
loader = SourceFileLoader('matched_existing_workflows', str(path))
spec = importlib.util.spec_from_loader(loader.name, loader)
existing = importlib.util.module_from_spec(spec); loader.exec_module(existing)
deploy = existing.deploy


class MatchedNative(unittest.TestCase):
    def setUp(self):
        self.f = f = existing.FastUI(); f.setUp(); f.reviewed_web_cli()
        self.installed = False; self.support = True; self.overrides = {}; self.support_age = 0
        before = {'exam-agent':'1'*64,'examctl':'9'*64,'exam-login':'2'*64,'exam-info':'3'*64}
        after = {'exam-agent':'4'*64,'examctl':'c'*64,'exam-login':'5'*64,'exam-info':'6'*64}
        self.pids = {'exam-agent.service':101,'exam-deadline-watchdog.service':102,'exam-source-setup.service':103,'exam-ssh-relay.service':4}
        self.receipt = f.root/'native-transition.json'
        f.release.update(agent_sha256=after['exam-agent'], worker_cli_sha256=after['examctl'], relay_sha256='7'*64, native_update={
            'nonce':'11111111-1111-4111-8111-111111111111',
            'before':{'binary_sha256':before,'worker_cli_sha256':'d'*64,'service_pids':f.release['service_pids']},
            'after':{'binary_sha256':after,'worker_cli_sha256':after['examctl']},
            'transition_receipt':str(self.receipt)})
        f.release['fast_ui'].update(mode='reviewed-web-native',reviewed_scope='live-exam-execution-policy-v1',
            state=str(f.state),native_guard=['/synthetic/before-native-guard'],native_after_guard=['/synthetic/after-native-guard'])
        (f.bundle/'release.json').write_text(json.dumps(f.release))
        original_snapshot = f.snapshot
        def snapshot():
            value = original_snapshot()
            if self.installed:
                value['health'].update(capabilities=['live-exam-execution-policy-v1'], execution_policy_support={
                    'schema':1,'capability':'live-exam-execution-policy-v1','observation_only':True,
                    'supported':self.support,'observed':int(deploy.time.time()*1000)-self.support_age,
                    'roles':['agent','watchdog','source-worker'],'issues':[]})
            return value
        f.snapshot = snapshot
        original_command = f.command
        def command(args, timeout=30):
            if str(args[0]) in ('/synthetic/before-native-guard','/synthetic/after-native-guard'):
                f.calls.append(list(map(str,args)))
                after_guard = str(args[0]) == '/synthetic/after-native-guard'
                if after_guard and not self.installed: raise RuntimeError('New native cohort is not installed')
                cohort = f.release['native_update']['after' if after_guard else 'before']
                pids = self.pids if after_guard else f.release['service_pids']
                value = {'guard':'PASS','host':'csc-sys','production_writes':False,
                    'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),
                    'phase':'after-native' if after_guard else 'before-native',
                    'nonce':f.release['native_update']['nonce'],'binary_sha256':cohort['binary_sha256'],
                    'history_sha256':f.release['native_history_sha256'],'config_sha256':f.release['native_config_sha256'],
                    'cli_config_sha256':f.release['cli_config_sha256'],'installed_cli_sha256':cohort['binary_sha256']['examctl'],
                    'worker_cli_sha256':cohort['worker_cli_sha256'],'relay_pid':pids['exam-ssh-relay.service'],'relay_sha256':cohort['binary_sha256'].get('exam-ssh-relay',f.release['relay_sha256']),
                    'native_roles':[{'unit':unit,'pid':pid} for unit,pid in pids.items() if unit!='exam-ssh-relay.service']}
                if after_guard: value.update(transition_receipt_sha256=deploy.digest(self.receipt),policy_supported=True)
                value.update(self.overrides)
                return json.dumps(value)
            return original_command(args,timeout)
        f.command = command

    def tearDown(self): self.f.tearDown()

    def native_transition(self):
        f = self.f; self.installed = True
        value = {'phase':'NATIVE_MATCHED_VERIFIED','nonce':f.release['native_update']['nonce'],
            'binary_sha256':f.release['native_update']['after']['binary_sha256'],'service_pids':self.pids,
            'history_sha256':f.release['native_history_sha256'],'config_sha256':f.release['native_config_sha256'],
            'cli_config_sha256':f.release['cli_config_sha256']}
        deploy.atomic_json(self.receipt,value)
        return value

    def waiting(self):
        self.f.cli('prepare'); result,_ = self.f.cli('apply')
        self.assertEqual(result['phase'],'WAITING_NATIVE')
        return result

    def test_public_apply_stops_at_durable_waiting_boundary_then_resume_opens_only_matched_cohort(self):
        f = self.f; history = f.history(); result = self.waiting()
        self.assertFalse(f.running); self.assertEqual(f.current,f.old['config_id'])
        self.assertTrue((f.state/'snapshot/snapshot.json').is_file())
        self.assertTrue(result['current_database_preserved']); self.assertEqual(f.history(),history)
        self.assertFalse(any(call[0]=='/synthetic/after-native-guard' for call in f.calls))
        self.native_transition(); result,_ = f.cli('resume')
        self.assertEqual(result['phase'],'ONLINE'); self.assertEqual(f.current,f.new['config_id'])
        self.assertEqual(result['native_service_pids'],self.pids); self.assertEqual(f.history(),history)
        self.assertEqual(len(result['proof']['preserved_tables']),41)
        f.busy = True; stops=len(f.stopped_calls()); result,_=f.cli('resume')
        self.assertEqual(result['phase'],'ONLINE'); self.assertEqual(len(f.stopped_calls()),stops)

    def test_handoff_is_fresh_current_stopped_proof_not_a_replayed_status_record(self):
        f=self.f; self.waiting(); result,_=f.cli('handoff')
        self.assertEqual(result['phase'],'WAITING_NATIVE'); self.assertTrue(result['web_stopped']); self.assertTrue(result['web_fenced'])
        self.assertEqual(result['revision'],f.release['revision']); self.assertEqual(result['native_binary_sha256'],f.release['native_update']['after']['binary_sha256'])
        self.assertEqual(result['web_status_sha256'],deploy.digest(f.state/'status.json'))
        self.assertEqual(result['guard']['scope'],'STOPPED')
        f.busy=True; f.cli('handoff',expect=1); f.busy=False
        f.site.write_text('not the owned fence'); f.cli('handoff',expect=1)

    def test_snapshot_status_crash_resumes_to_supported_handoff_without_install_or_restart(self):
        f=self.f; f.cli('prepare'); original=deploy.Rollout.save; failed=False
        def save(rollout,phase,**details):
            nonlocal failed
            if phase=='WAITING_NATIVE' and not failed: failed=True; raise RuntimeError('Synthetic handoff publication crash')
            return original(rollout,phase,**details)
        with patch.object(deploy.Rollout,'save',save): f.cli('apply',expect=1)
        self.assertFalse(f.running); result,_=f.cli('resume'); self.assertEqual(result['phase'],'WAITING_NATIVE')
        result,_=f.cli('handoff'); self.assertTrue(result['web_stopped']); self.assertFalse(self.installed)

    def test_missing_or_mutated_transition_never_starts_gateway_or_overwrites_current_data(self):
        f=self.f; self.waiting(); history=f.history()
        f.cli('resume',expect=1); self.assertFalse(f.running)
        original=self.native_transition()
        for field,value in [('nonce','22222222-2222-4222-8222-222222222222'),('config_sha256','f'*64),('binary_sha256',{})]:
            with self.subTest(field=field):
                deploy.atomic_json(self.receipt,{**original,field:value}); result,_=f.cli('resume',expect=1)
                self.assertEqual(result['phase'],'WAITING_NATIVE'); self.assertFalse(f.running); self.assertEqual(f.history(),history)
        deploy.atomic_json(self.receipt,original); self.receipt.chmod(0o644)
        f.cli('resume',expect=1); self.assertFalse(f.running)

    def test_stale_wrong_scope_or_unsupported_after_guard_refuses_before_start(self):
        f=self.f; self.waiting(); self.native_transition()
        invalid=[('nonce','22222222-2222-4222-8222-222222222222'),('phase','before-native'),
            ('at',(datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(seconds=91)).isoformat()),
            ('binary_sha256',{}),('policy_supported',False),('transition_receipt_sha256','f'*64),('relay_pid',5),('relay_sha256','f'*64)]
        for field,value in invalid:
            with self.subTest(field=field):
                self.overrides={field:value}; result,_=f.cli('resume',expect=1)
                self.assertEqual(result['phase'],'WAITING_NATIVE'); self.assertFalse(f.running)

    def test_wrong_before_guard_refuses_before_fence_and_stop(self):
        f=self.f; f.cli('prepare'); self.overrides={'worker_cli_sha256':'f'*64}
        f.cli('apply',expect=1); self.assertTrue(f.running); self.assertEqual(f.stopped_calls(),[])
        self.assertEqual(f.site.read_text(),'original synthetic site')

    def test_failed_start_has_only_compatible_forward_recovery_and_no_old_writer_rollback(self):
        f=self.f; self.waiting(); self.native_transition(); history=f.history(); f.fail_start=True
        result,_=f.cli('resume',expect=1); self.assertEqual(result['phase'],'NATIVE_UPDATED')
        for action in ('rollback','reopen'):
            _,error=f.cli(action,expect=1); self.assertIn('Older',error)
        self.assertFalse(f.running); self.assertEqual(f.history(),history)
        result,_=f.cli('resume'); self.assertEqual(result['phase'],'ONLINE'); self.assertEqual(f.history(),history)

    def test_actual_start_crash_before_running_receipt_resumes_without_second_restart(self):
        f=self.f; self.waiting(); self.native_transition(); original=deploy.Rollout.save; failed=False
        def save(rollout,phase,**details):
            nonlocal failed
            if phase=='RUNNING_GATED' and not failed: failed=True; raise RuntimeError('Synthetic post-start crash')
            return original(rollout,phase,**details)
        with patch.object(deploy.Rollout,'save',save): f.cli('resume',expect=1)
        starts=sum(call[:3]==['/usr/bin/systemctl','start','ssh-exam.service'] for call in f.calls)
        self.assertTrue(f.running); result,_=f.cli('resume'); self.assertEqual(result['phase'],'ONLINE')
        self.assertEqual(sum(call[:3]==['/usr/bin/systemctl','start','ssh-exam.service'] for call in f.calls),starts)

    def test_old_ready_roles_cannot_replace_fresh_policy_support_and_expiry_keeps_fence(self):
        f=self.f; self.waiting(); self.native_transition(); self.support_age=120001
        with patch.object(deploy.time,'monotonic',side_effect=[0,121]):
            result,_=f.cli('resume',expect=1)
        self.assertEqual(result['phase'],'NATIVE_UPDATED'); self.assertTrue(f.running)
        self.assertIn('ssh_exam_rollout_refuse',f.site.read_text())
        self.support_age=0
        with existing.database_file(f.data/'metadata.sqlite') as db:
            db.execute('UPDATE agent_snapshot SET payload=?',(json.dumps(f.snapshot()),))
        starts=sum(call[:3]==['/usr/bin/systemctl','start','ssh-exam.service'] for call in f.calls)
        result,_=f.cli('resume'); self.assertEqual(result['phase'],'ONLINE')
        self.assertEqual(sum(call[:3]==['/usr/bin/systemctl','start','ssh-exam.service'] for call in f.calls),starts)

    def test_public_failure_refences_and_same_running_candidate_resumes_without_old_writer(self):
        f=self.f; self.waiting(); self.native_transition(); original=f.urlopen; failures=0
        def urlopen(url,timeout=5):
            nonlocal failures
            if url=='https://synthetic.invalid/' and 'ssh_exam_rollout_refuse' not in f.site.read_text() and failures==0:
                failures+=1; return existing.Response(b'wrong opened asset')
            return original(url,timeout)
        f.urlopen=urlopen; result,_=f.cli('resume',expect=1)
        self.assertEqual(result['phase'],'VERIFIED_GATED'); self.assertIn('ssh_exam_rollout_refuse',f.site.read_text())
        starts=sum(call[:3]==['/usr/bin/systemctl','start','ssh-exam.service'] for call in f.calls)
        result,_=f.cli('resume'); self.assertEqual(result['phase'],'ONLINE')
        self.assertEqual(sum(call[:3]==['/usr/bin/systemctl','start','ssh-exam.service'] for call in f.calls),starts)

    def test_manifest_cannot_claim_old_scope_or_compatible_old_writer(self):
        f=self.f; original=json.loads(json.dumps(f.release))
        for number,(key,value) in enumerate([('reviewed_scope','unified-exam-student-list-v1'),('previous_reader_policy_compatible',True),('unchanged_backend_protocol_native',True)]):
            with self.subTest(field=key):
                f.state=f.root/('invalid-'+str(number)); f.release=json.loads(json.dumps(original));f.release['fast_ui'][key]=value
                (f.bundle/'release.json').write_text(json.dumps(f.release)); f.cli('prepare',expect=1)
                self.assertEqual(f.stopped_calls(),[])


class FilesOnlyResume(MatchedNative):
    """Run the same public installation/recovery/refusal matrix for this scope."""
    def setUp(self):
        super().setUp()
        self.f.release['fast_ui']['reviewed_scope'] = 'files-only-resume-v1'
        (self.f.bundle/'release.json').write_text(json.dumps(self.f.release))

    def test_scope_is_exact_and_does_not_allow_a_mismatched_source(self):
        f=self.f; original=json.loads(json.dumps(f.release))
        for number,(key,value) in enumerate([
            ('reviewed_scope','files-only-resume-v2'),
            ('reviewed_scope','files-only-resume-v1-extra'),
            ('qualified_source','f'*40),
        ]):
            with self.subTest(field=key,value=value):
                f.state=f.root/('invalid-files-scope-'+str(number))
                f.release=json.loads(json.dumps(original));f.release['fast_ui'][key]=value
                (f.bundle/'release.json').write_text(json.dumps(f.release))
                f.cli('prepare',expect=1)
                self.assertEqual(f.stopped_calls(),[])


class MonitoringTimeouts(MatchedNative):
    """The matched relay is part of this exact forward-only scope."""
    def setUp(self):
        super().setUp()
        f = self.f
        f.release['fast_ui']['reviewed_scope'] = 'monitoring-timeouts-v2'
        f.release['native_update']['before']['binary_sha256']['exam-ssh-relay'] = f.release['relay_sha256']
        f.release['native_update']['after']['binary_sha256']['exam-ssh-relay'] = '8'*64
        self.pids['exam-ssh-relay.service'] = 104
        (f.bundle/'release.json').write_text(json.dumps(f.release))

    def test_missing_relay_pin_refuses_before_fencing(self):
        f = self.f
        del f.release['native_update']['after']['binary_sha256']['exam-ssh-relay']
        (f.bundle/'release.json').write_text(json.dumps(f.release))
        f.cli('prepare', expect=1)
        self.assertFalse(f.stopped_calls())


if __name__=='__main__': unittest.main()
