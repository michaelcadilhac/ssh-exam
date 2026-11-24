"""Actual private-file/guard execution/receipt checks; synthetic owner/cohort.

The institutional native/kernel guard is not simulated as production evidence.
The CLI entry refuses nonroot callers; real class-side proof remains mandatory.
"""
import datetime
import hashlib
from importlib.machinery import SourceFileLoader
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
loader=SourceFileLoader('cli_native_observer',str(ROOT/'scripts/observe-native-cli-cohort.py'))
spec=importlib.util.spec_from_loader(loader.name,loader)
observer=importlib.util.module_from_spec(spec);loader.exec_module(observer)


class Observer(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.stage=Path(self.temp.name);self.stage.chmod(0o700)
        self.targets={name:self.stage/name for name in observer.TARGETS}
        for name,path in self.targets.items():path.write_bytes(('synthetic '+name).encode());path.chmod(0o755)
        self.hashes={name:hashlib.sha256(p.read_bytes()).hexdigest() for name,p in self.targets.items()}
        self.pids={'exam-agent.service':1,'exam-deadline-watchdog.service':2,'exam-source-setup.service':3,'exam-ssh-relay.service':4}
        self.release={'fast_ui':{'mode':'reviewed-web-cli','reviewed_scope':'display-alert-diagnostics-v1'},'native_history_sha256':'5'*64,'native_config_sha256':'6'*64,'cli_config_sha256':'7'*64,'relay_sha256':'8'*64,
            'native_update':{'nonce':'11111111-1111-4111-8111-111111111111','before':{'binary_sha256':self.hashes,'worker_cli_sha256':'9'*64,'service_pids':self.pids}}}
        self.value={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'guard':'PASS','host':'csc-sys','production_writes':False,
            'history_sha256':'5'*64,'config_sha256':'6'*64,'cli_config_sha256':'7'*64,'relay_sha256':'8'*64,'relay_pid':4,
            'installed_cli_sha256':self.hashes['examctl'],'worker_cli_sha256':'9'*64,'native_roles':[{'unit':k,'pid':v} for k,v in self.pids.items() if k!='exam-ssh-relay.service']}
        self.producer()
    def tearDown(self):self.temp.cleanup()
    def producer(self,code=None):
        code=code or 'import sys,json\nassert sys.argv[2]=="after-cli"\nprint('+repr(json.dumps(self.value))+')\n'
        path=self.stage/'native-guard.py';path.write_text(code);path.chmod(0o600)
        self.release['native_update']['guard_sha256']=hashlib.sha256(path.read_bytes()).hexdigest()
        path=self.stage/'release.json';path.write_text(json.dumps(self.release));path.chmod(0o600)
    def observe(self):
        with patch.object(observer,'TARGETS',self.targets):return observer.observe(self.stage)
    def test_actual_guard_execution_publishes_fresh_split_cli_proof_and_restores_argv(self):
        before=sys.argv;receipt=self.observe();self.assertIs(sys.argv,before)
        value=observer.private_json(self.stage/'native-guard-before.json')[0]
        self.assertEqual(value['receipt'],receipt);self.assertEqual(receipt['binary_sha256'],self.hashes)
        self.assertEqual(receipt['worker_cli_sha256'],'9'*64)
        self.assertEqual(receipt['installed_cli_sha256'],self.hashes['examctl'])
    def test_guard_failure_preserves_existing_proof_and_argv(self):
        self.observe();path=self.stage/'native-guard-before.json';before=path.read_bytes();argv=sys.argv
        self.producer('raise RuntimeError("synthetic guard busy")\n')
        with self.assertRaises(RuntimeError):self.observe()
        self.assertEqual(path.read_bytes(),before);self.assertIs(sys.argv,argv)
    def test_changed_binary_or_guard_refuses_without_publishing(self):
        self.targets['exam-login'].write_bytes(b'changed')
        with self.assertRaises(ValueError):self.observe()
        self.targets['exam-login'].write_bytes(b'synthetic exam-login')
        (self.stage/'native-guard.py').write_text('print("unqualified")')
        with self.assertRaises(ValueError):self.observe()
        self.assertFalse((self.stage/'native-guard-before.json').exists())
    def test_expired_or_wrong_metadata_refuses_without_publishing(self):
        for field,value in [('at',(datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(seconds=91)).isoformat()),('config_sha256','0'*64),('worker_cli_sha256','0'*64),('relay_pid',99)]:
            old=self.value[field];self.value[field]=value;self.producer()
            with self.subTest(field=field),self.assertRaises(ValueError):self.observe()
            self.value[field]=old
        self.assertFalse((self.stage/'native-guard-before.json').exists())
    def test_foreign_receipt_is_never_overwritten(self):
        path=self.stage/'native-guard-before.json';path.write_text('{"nonce":"foreign"}');path.chmod(0o600);before=path.read_bytes()
        with self.assertRaises(ValueError):self.observe()
        self.assertEqual(path.read_bytes(),before)
    @unittest.skipIf(os.geteuid()==0,'This refusal needs an ordinary user')
    def test_cli_requires_root_before_writing(self):
        r=subprocess.run([sys.executable,str(ROOT/'scripts/observe-native-cli-cohort.py'),str(self.stage)],capture_output=True,text=True,timeout=5)
        self.assertNotEqual(r.returncode,0);self.assertIn('Run as root',r.stderr)
        self.assertFalse((self.stage/'native-guard-before.json').exists())


if __name__=='__main__':unittest.main()
