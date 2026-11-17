"""Safety/report regressions. These mocks never start SSH, browsers or services."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from types import SimpleNamespace
from unittest import mock

spec = importlib.util.spec_from_file_location('manual_stress',Path(__file__).resolve().parents[1]/'scripts/stress-test.py')
runner=importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class ManualStressTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        self.run='20261116T000000Z'
        self.bundle='/var/tmp/ssh-exam-browser-native-upload.synthetic'
        self.child=mock.Mock(pid=999999,wait=mock.Mock(return_value=0))
        self.proof=True
        self.scratch_free=80*1024**3

    def invoke(self,*args):
        def git(command,**kw):
            return 'a'*40+'\n' if kw.get('text') else b''
        def launch(command,**kw):
            env=kw['env']
            if self.proof and env.get('EXAM_STRESS_OUTPUT') and command[0]=='npm':
                output=Path(env['EXAM_STRESS_OUTPUT'])
                output.mkdir(parents=True)
                seconds=int(env['EXAM_STRESS_SECONDS'])
                (output/'endurance-result.json').write_text(json.dumps({'students':70,'terminals':280,
                    'requested_seconds':seconds,'peak_seconds':seconds,'protected':70,'preservation':'FULL'}))
            return self.child
        with mock.patch.object(runner,'ROOT',self.root), \
             mock.patch.object(runner.sys,'argv',['stress','--native-bundle',self.bundle,'--run-id',self.run,*args]), \
             mock.patch.object(runner.shutil,'disk_usage',return_value=SimpleNamespace(free=self.scratch_free)), \
             mock.patch.object(runner.subprocess,'check_output',side_effect=git), \
             mock.patch.object(runner.subprocess,'Popen',side_effect=launch) as launched:
            code=runner.main()
        state=json.loads((self.root/'var/stress'/self.run/'run.json').read_text())
        return code,state,launched

    def test_endurance_uses_private_workspace_scratch_and_a_finite_full_run_budget(self):
        code,state,launched=self.invoke('--phase','endurance')
        self.assertEqual(code,0)
        scratch=Path(launched.call_args.kwargs['env']['TMPDIR'])
        self.assertEqual(scratch,self.root/'var/stress'/self.run/'endurance-1/temporary')
        self.assertEqual(str(scratch),launched.call_args.kwargs['env']['EXAM_STRESS_LOCAL_SCRATCH'])
        self.assertEqual(scratch.stat().st_mode&0o777,0o700)
        self.assertFalse((scratch/'write-probe').exists())
        self.child.wait.assert_called_with(timeout=14400)

    def test_low_disk_refusal_is_durable_before_any_browser_or_guest_launch(self):
        self.scratch_free=39*1024**3
        with mock.patch.object(runner,'marco_generator') as generator:
            code,state,launched=self.invoke('--phase','endurance','--generator','marco')
        self.assertEqual(code,1);launched.assert_not_called();generator.assert_not_called()
        self.assertEqual(state['phases'][0]['status'],'FAILED')
        self.assertIn('40GiB',state['phases'][0]['reason'])

    def test_scratch_refuses_a_preexisting_symlink_without_touching_its_target(self):
        target=self.root/'untouched';target.mkdir();(target/'sentinel').write_text('preserve')
        (self.root/'temporary').symlink_to(target,target_is_directory=True)
        with self.assertRaisesRegex(RuntimeError,'already exists'):
            runner.local_scratch(self.root)
        self.assertEqual((target/'sentinel').read_text(),'preserve')
        self.assertEqual([p.name for p in target.iterdir()],['sentinel'])

    def test_failed_command_is_a_durable_failed_run_not_a_successful_report(self):
        self.child.wait.return_value=42
        code,state,_=self.invoke('--phase','application')
        self.assertEqual(code,1)
        self.assertEqual(state['status'],'AUTOMATED_FAILED')
        self.assertEqual(state['phases'][0]['commands'][0]['exit'],42)
        self.assertTrue((self.root/'var/stress'/self.run/'application-1/command-0.log').is_file())

    def test_automated_pass_requires_agent_review_and_refuses_inherited_native_faults(self):
        with mock.patch.dict(os.environ,{'EXAM_BROWSER_NATIVE_LARGE':'1','EXAM_STRESS_SECONDS':'1'}):
            code,state,launched=self.invoke()
        self.assertEqual(code,0)
        self.assertEqual(state['status'],'AWAITING_AGENT_REVIEW')
        self.assertEqual(state['endurance_seconds'],5400)
        final=launched.call_args_list[-1].kwargs['env']
        self.assertEqual(final['EXAM_BROWSER_NATIVE_STUDENTS'],'70')
        self.assertEqual(final['EXAM_STRESS_SECONDS'],'5400')
        self.assertNotIn('EXAM_BROWSER_NATIVE_LARGE',final)
        self.assertEqual(final['EXAM_BROWSER_NATIVE_BUNDLE'],self.bundle)

    def test_successful_empty_or_skipped_test_process_is_not_an_endurance_pass(self):
        self.proof=False
        code,state,_=self.invoke('--phase','endurance')
        self.assertEqual(code,1)
        self.assertEqual(state['status'],'AUTOMATED_FAILED')
        self.assertIn('Missing unique',state['phases'][0]['reason'])

    def test_recovered_pane_refusal_cannot_be_promoted_to_clean_endurance(self):
        output=self.root/'browser';output.mkdir()
        value={'students':70,'terminals':280,'requested_seconds':5400,
               'peak_seconds':5400,'protected':70,'preservation':'FULL',
               'pane_refusals':[{'username':'synthetic','expected':4}]}
        (output/'endurance-result.json').write_text(json.dumps(value))
        self.assertIn('retained failures',runner.endurance_receipt(self.root,5400))

    def test_browser_phase_explicitly_enables_existing_gateway_restart_cases(self):
        with mock.patch.dict(os.environ,{'EXAM_BROWSER_GATEWAY_PROCESS':'0'}):
            code,state,launched=self.invoke('--phase','browser-corners')
        self.assertEqual(code,0)
        self.assertEqual(launched.call_args.kwargs['env']['EXAM_BROWSER_GATEWAY_PROCESS'],'1')
        self.assertEqual(launched.call_args.kwargs['env']['EXAM_STRESS_SEPARATE_SIGNIN'],'1')
        self.assertEqual(state['phases'][0]['phase'],'browser-corners')
        with mock.patch.dict(os.environ,{'EXAM_STRESS_SEPARATE_SIGNIN':'1'}):
            code,_,cohort=self.invoke('--phase','browser-signin')
        self.assertEqual(code,0)
        self.assertNotIn('EXAM_STRESS_SEPARATE_SIGNIN',cohort.call_args.kwargs['env'])
        self.assertIn('tests/browser/ssh-signin-capacity.spec.ts',cohort.call_args.args[0])

    def test_native_timer_recovery_uses_the_actual_single_student_files_resume_entry(self):
        code,_,launched=self.invoke('--phase','native-timer-recovery')
        self.assertEqual(code,0)
        env=launched.call_args.kwargs['env']
        for key in ('EXAM_BROWSER_NATIVE_SSH_RECOVERY','EXAM_BROWSER_NATIVE_FILES_RESUME',
                    'EXAM_BROWSER_NATIVE_TIMER_CONTROLS','EXAM_BROWSER_NATIVE_RELEASE'):
            self.assertEqual(env[key],'1')
        self.assertEqual(env['EXAM_BROWSER_NATIVE_STUDENTS'],'1')
        self.assertIn('tests/browser/retained-recovery.spec.ts',launched.call_args.args[0])

    def test_marco_generator_is_explicit_scoped_to_endurance_and_closed(self):
        generator=mock.Mock(failure=None)
        generator.start.return_value={'EXAM_STRESS_BROWSER_WS':'ws://127.0.0.1:12345/synthetic',
                                      'EXAM_STRESS_GENERATOR_STATUS':'private-status'}
        with mock.patch.object(runner,'marco_generator',return_value=generator):
            code,state,launched=self.invoke('--phase','endurance','--generator','marco')
        self.assertEqual(code,0)
        generator.start.assert_called_once();generator.close.assert_called_once()
        self.assertEqual(state['phases'][0]['generator'],'marco')
        self.assertEqual(len(launched.call_args_list),3)
        self.assertEqual(launched.call_args_list[0].args[0],['node','scripts/stress-generator-smoke.cjs'])
        self.assertEqual(launched.call_args_list[1].args[0],['node','--import','tsx','tests/fixtures/stress-https-smoke.ts'])
        self.assertEqual(self.child.wait.call_args_list[1].kwargs['timeout'],330)
        self.assertEqual(launched.call_args.kwargs['env']['EXAM_STRESS_BROWSER_WS'],'ws://127.0.0.1:12345/synthetic')
        with self.assertRaises(SystemExit):self.invoke('--phase','application','--generator','marco')

    def test_remote_setup_failure_still_closes_owned_generator_and_cannot_pass(self):
        generator=mock.Mock(failure=None)
        generator.start.side_effect=RuntimeError('bounded setup refusal')
        with mock.patch.object(runner,'marco_generator',return_value=generator):
            code,state,launched=self.invoke('--phase','endurance','--generator','marco')
        self.assertEqual(code,1);self.assertEqual(state['phases'][0]['status'],'FAILED')
        self.assertEqual(state['phases'][0]['commands'],[])
        generator.close.assert_called_once();launched.assert_not_called()

    def test_guarded_native_workflows_can_use_the_same_isolated_marco_browser(self):
        for phase,students in [('native-editor','1'),('native-timer-recovery','1'),('native-recovery','16'),('native-collection','16')]:
            with self.subTest(phase=phase), tempfile.TemporaryDirectory() as directory:
                old=self.root;self.root=Path(directory)
                try:
                    generator=mock.Mock(failure=None)
                    generator.start.return_value={'EXAM_STRESS_BROWSER_WS':'ws://127.0.0.1:12345/synthetic'}
                    with mock.patch.object(runner,'marco_generator',return_value=generator):
                        code,state,launched=self.invoke('--phase',phase,'--generator','marco')
                    self.assertEqual(code,0);generator.close.assert_called_once()
                    self.assertEqual(state['phases'][0]['generator'],'marco')
                    self.assertEqual(len(launched.call_args_list),2)
                    self.assertEqual(launched.call_args.kwargs['env']['EXAM_BROWSER_NATIVE_STUDENTS'],students)
                    self.assertEqual(launched.call_args.kwargs['env']['EXAM_STRESS_BROWSER_WS'],'ws://127.0.0.1:12345/synthetic')
                finally:self.root=old

    def test_remote_cleanup_refusal_is_durable_and_blocks_further_work(self):
        generator=mock.Mock(failure=None)
        generator.start.return_value={}
        generator.close.side_effect=RuntimeError('owned unit not confirmed stopped')
        with mock.patch.object(runner,'marco_generator',return_value=generator),self.assertRaisesRegex(RuntimeError,'cleanup is unconfirmed'):
            self.invoke('--phase','endurance','--generator','marco')
        state=json.loads((self.root/'var/stress'/self.run/'run.json').read_text())
        self.assertEqual(state['status'],'INCOMPLETE')
        self.assertEqual(state['phases'][0]['status'],'CLEANUP_UNCONFIRMED')

    def test_operator_integrations_enable_the_three_normally_gated_real_entries(self):
        code,_,launched=self.invoke('--phase','operator-integrations')
        self.assertEqual(code,0)
        env=launched.call_args.kwargs['env']
        self.assertEqual(env['EXAM_MANAGEMENT_USERNS'],'1')
        self.assertEqual(env['EXAM_GRADING_BWRAP'],'1')
        self.assertIn('tests/integration/offline-grading.test.ts',launched.call_args.args[0])

    def test_rehearsal_cannot_be_relabelled_full_or_overwrite_prior_receipts(self):
        self.invoke('--phase','endurance','--rehearsal')
        before=(self.root/'var/stress'/self.run/'run.json').read_bytes()
        with self.assertRaises(SystemExit) as error:
            self.invoke('--phase','endurance')
        self.assertEqual(error.exception.code,2)
        self.assertEqual((self.root/'var/stress'/self.run/'run.json').read_bytes(),before)


if __name__=='__main__':
    unittest.main()
