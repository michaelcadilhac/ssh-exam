"""Fresh private bridge receipts; synthetic metadata only, no network/service calls."""
import datetime
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import subprocess
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'scripts'))
from fresh_native_cohort_guard import read_current
from refresh_native_cohort_guard import handoff


class FreshCohort(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.root.chmod(0o700)
        self.now=datetime.datetime.now(datetime.timezone.utc)
        old={'exam-agent':'1'*64,'examctl':'2'*64,'exam-login':'3'*64,'exam-info':'4'*64}
        new={key:'a'*64 for key in old}
        self.before={'exam-agent.service':1,'exam-deadline-watchdog.service':2,'exam-source-setup.service':3,'exam-ssh-relay.service':4}
        self.after={**self.before,'exam-agent.service':101,'exam-deadline-watchdog.service':102,'exam-source-setup.service':103}
        self.release={'native_history_sha256':'5'*64,'native_config_sha256':'6'*64,'cli_config_sha256':'7'*64,'relay_sha256':'8'*64,
            'native_update':{'nonce':'11111111-1111-4111-8111-111111111111','transition_receipt':str(self.root/'native-transition.json'),
                'before':{'binary_sha256':old,'worker_cli_sha256':'9'*64,'service_pids':self.before},
                'after':{'binary_sha256':new,'worker_cli_sha256':'a'*64}}}
        self.transition={'nonce':self.release['native_update']['nonce'],'phase':'NATIVE_MATCHED_VERIFIED','binary_sha256':new,'service_pids':self.after,
            **{key:self.release[key] for key in ('cli_config_sha256',)},'history_sha256':self.release['native_history_sha256'],'config_sha256':self.release['native_config_sha256']}
        self.write('release.json',self.release);self.write('native-transition.json',self.transition)
        self.values={}
        for phase,pids in [('before',self.before),('after',self.after)]:
            cohort=self.release['native_update'][phase]
            value={'at':self.now.isoformat(),'guard':'PASS','host':'csc-sys','production_writes':False,'phase':phase+'-native','nonce':self.release['native_update']['nonce'],
                'history_sha256':self.release['native_history_sha256'],'config_sha256':self.release['native_config_sha256'],'cli_config_sha256':self.release['cli_config_sha256'],
                'relay_sha256':self.release['relay_sha256'],'relay_pid':4,'binary_sha256':cohort['binary_sha256'],
                'installed_cli_sha256':cohort['binary_sha256']['examctl'],'worker_cli_sha256':cohort['worker_cli_sha256'],
                'native_roles':[{'unit':key,'pid':pid} for key,pid in pids.items() if key!='exam-ssh-relay.service']}
            if phase=='after':value.update(transition_receipt_sha256=hashlib.sha256((self.root/'native-transition.json').read_bytes()).hexdigest(),policy_supported=True)
            self.values[phase]=value;self.wrap(phase,value)
    def tearDown(self):self.temp.cleanup()
    def write(self,name,value):
        p=self.root/name;p.write_text(json.dumps(value));p.chmod(0o600)
    def wrap(self,phase,value):self.write('native-guard-'+phase+'.json',{'nonce':self.release['native_update']['nonce'],'receipt':value})
    def test_real_private_before_split_cli_and_after_cohort_proofs(self):
        self.assertEqual(read_current(self.root,'before',self.now)['worker_cli_sha256'],'9'*64)
        self.assertTrue(read_current(self.root,'after',self.now)['policy_supported'])
    def test_expired_nonce_phase_binary_and_relay_failures_refuse(self):
        for field,value in [('at',(self.now-datetime.timedelta(seconds=91)).isoformat()),('nonce','other'),('phase','before-native'),('binary_sha256',{}),('relay_pid',10),('relay_sha256','0'*64)]:
            with self.subTest(field=field),self.assertRaises(ValueError):
                self.wrap('after',{**self.values['after'],field:value});read_current(self.root,'after',self.now)
    def test_transition_hash_or_support_cannot_be_faked(self):
        for field,value in [('transition_receipt_sha256','0'*64),('policy_supported',False),('worker_cli_sha256','0'*64)]:
            with self.subTest(field=field),self.assertRaises(ValueError):
                self.wrap('after',{**self.values['after'],field:value});read_current(self.root,'after',self.now)
    def test_wrong_transition_candidate_or_processes_refuse(self):
        for field,value in [('binary_sha256',{}),('service_pids',self.before),('config_sha256','0'*64),('nonce','other')]:
            with self.subTest(field=field),self.assertRaises(ValueError):
                self.write('native-transition.json',{**self.transition,field:value});read_current(self.root,'after',self.now)
    def test_unsafe_permissions_symlinks_and_missing_receipts_refuse(self):
        path=self.root/'native-guard-before.json';path.chmod(0o644)
        with self.assertRaises(ValueError):read_current(self.root,'before',self.now)
        path.unlink();path.symlink_to(self.root/'native-guard-after.json')
        with self.assertRaises(ValueError):read_current(self.root,'before',self.now)
        path.unlink()
        with self.assertRaises(FileNotFoundError):read_current(self.root,'before',self.now)

    def handoff_values(self):
        release={**self.release,'revision':'b'*40,'image_config_id':'sha256:'+'c'*64,'old_image_config_id':'sha256:'+'d'*64}
        places={'web_code':'/private/code','web_state':'/private/state','class_stage':'/private/class'}
        proof={'nonce':release['native_update']['nonce'],'phase':'WAITING_NATIVE','web_state':places['web_state'],
               'at':self.now.isoformat(),'revision':release['revision'],'image_config_id':release['image_config_id'],
               'native_binary_sha256':release['native_update']['after']['binary_sha256'],
               'web_status_sha256':'e'*64,'web_image_config_id':release['old_image_config_id'],'web_stopped':True,'web_fenced':True}
        return release,places,proof
    def test_handoff_reads_real_public_action_then_bridges_same_proof(self):
        release,places,proof=self.handoff_values()
        results=[subprocess.CompletedProcess([],0,json.dumps(proof),''),subprocess.CompletedProcess([],0,'{"phase":"WEB_STOP_BRIDGED"}\n','')]
        with patch('refresh_native_cohort_guard.subprocess.run',side_effect=results) as run:
            handoff(release,places)
        self.assertEqual(run.call_count,2)
        self.assertIn('handoff --state /private/state',run.call_args_list[0].args[0][-1])
        self.assertEqual(json.loads(run.call_args_list[1].kwargs['input']),proof)
        self.assertIn('csc-sys',run.call_args_list[1].args[0])
    def test_handoff_stale_foreign_unfenced_or_wrong_candidate_never_bridges(self):
        release,places,proof=self.handoff_values()
        for field,value in [('at',(self.now-datetime.timedelta(seconds=91)).isoformat()),('nonce','other'),('web_fenced',False),('web_stopped',False),('native_binary_sha256',{}),('image_config_id','other')]:
            with self.subTest(field=field),patch('refresh_native_cohort_guard.subprocess.run',return_value=subprocess.CompletedProcess([],0,json.dumps({**proof,field:value}),'')) as run,self.assertRaises(AssertionError):
                handoff(release,places)
            self.assertEqual(run.call_count,1)
    def test_handoff_failed_public_command_never_bridges(self):
        release,places,_=self.handoff_values()
        with patch('refresh_native_cohort_guard.subprocess.run',return_value=subprocess.CompletedProcess([],1,'','stopped check refused')) as run,self.assertRaisesRegex(SystemExit,'stopped check refused'):
            handoff(release,places)
        self.assertEqual(run.call_count,1)
    def test_handoff_failed_bridge_does_not_report_completion(self):
        release,places,proof=self.handoff_values()
        results=[subprocess.CompletedProcess([],0,json.dumps(proof),''),subprocess.CompletedProcess([],1,'','foreign stage')]
        with patch('refresh_native_cohort_guard.subprocess.run',side_effect=results),self.assertRaisesRegex(SystemExit,'foreign stage'):
            handoff(release,places)


if __name__=='__main__':unittest.main()
