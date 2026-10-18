"""Temporary-policy transaction tests. OS mutations use an explicit fake backend."""
import importlib.machinery
import importlib.util
import copy
import json
from pathlib import Path
import tempfile
import threading
from concurrent.futures import ThreadPoolExecutor
import time
import unittest
from unittest.mock import patch

loader = importlib.machinery.SourceFileLoader('policy', str(Path(__file__).parents[1]/'scripts/account-policy'))
spec = importlib.util.spec_from_loader(loader.name, loader)
p = importlib.util.module_from_spec(spec)
loader.exec_module(p)
ID = '12345678-1234-1234-1234-123456789abc'
GEN = 'a'*64

class Machine:
    def __init__(self):
        self.original = {'account':{'uid':1001,'gid':1001,'shell':'/bin/bash','home':'/home/student'},
                         'groups':['students'], 'linger':True, 'override':None}
        self.value = copy.deepcopy(self.original)
        self.crash = None
        self.restoration_error = False
        self.calls = []
    def capture(self, name):
        self.calls.append('capture')
        if self.value != self.original: raise RuntimeError('Unowned restriction')
        return copy.deepcopy(self.value)
    def check(self, name, baseline, active):
        self.calls.append('check-held' if active else 'check-normal')
    def apply(self, name, baseline, step):
        for key in ['shell','group','linger']:
            step(key)
            if key == 'shell': self.value['account']['shell'] = p.GATE
            if key == 'group': self.value['groups'] = ['students',p.MANAGED]
            if key == 'linger': self.value['linger'] = False
            if self.crash == key: raise RuntimeError('Injected interruption')
    def verify(self, name, baseline, active):
        if active:
            if self.value['account']['shell'] != p.GATE or p.MANAGED not in self.value['groups']: raise RuntimeError('Inactive gate')
        elif self.value != self.original: raise RuntimeError('Incomplete restore')
    def secured(self, attempt):
        if attempt.get('start') and not attempt.get('protected'): raise RuntimeError('No protected copy')
    def restore(self, name, baseline, steps):
        self.calls.append('restore')
        if self.restoration_error:
            self.value['account']['shell']=baseline['account']['shell']
            raise RuntimeError('Injected partial restore failure')
        self.value = copy.deepcopy(baseline)

class Transactions(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.machine = Machine()
        self.attempt = {'id':ID,'username':'student','uid':1001,'policy_generation':GEN,'state':'PREPARING',
                        'policy_expires':int(time.time()*1000)+300000}
        # Production files require root ownership; test state belongs to the test runner.
        patcher = patch.object(p, 'protected_json', lambda path:json.loads(path.read_text()))
        patcher.start(); self.addCleanup(patcher.stop)
        self.tx = p.Transactions(self.root, self.machine, lambda id:self.attempt)
    def run_op(self, op, gen=GEN): return self.tx.transact(op,'student',1001,ID,gen)
    def cancel(self):
        self.attempt.update(state='CANCELLED_BEFORE_START',policy_restore_authorized=True)
    def test_setup_does_not_start_clock_and_roundtrips_exact_baseline(self):
        result = self.run_op('apply')
        self.assertEqual(result['phase'],'READY')
        self.assertNotIn('start',self.attempt)
        self.run_op('apply')
        self.assertEqual(self.machine.calls.count('capture'),1)
        self.cancel()
        self.assertEqual(self.run_op('restore')['phase'],'NORMAL')
        self.run_op('restore')
        self.assertEqual(self.machine.value,self.machine.original)
        with self.assertRaises(RuntimeError): self.run_op('apply')
    def test_write_ahead_intent_recovers_each_partial_apply(self):
        for step in ['shell','group','linger']:
            with self.subTest(step=step):
                self.machine.crash=step
                with self.assertRaises(RuntimeError): self.run_op('apply')
                journal=json.loads((self.root/'1001.json').read_text())
                self.assertIn(step,journal['steps'])
                self.cancel()
                # A new Transactions instance models helper restart; no memory baseline required.
                self.tx=p.Transactions(self.root,self.machine,lambda id:self.attempt)
                self.run_op('restore')
                self.assertEqual(self.machine.value,self.machine.original)
                (self.root/'1001.json').unlink()
                self.attempt.update(state='PREPARING',policy_restore_authorized=False)
    def test_early_finish_retains_original_deadline(self):
        self.run_op('apply')
        now=int(time.time()*1000)
        self.attempt.update(start=now-1000,state='COMPLETED',protected=True,deadline=now-1,
                            original_deadline=now+5400000,policy_restore_authorized=True)
        with self.assertRaisesRegex(RuntimeError,'deadline still held'): self.run_op('restore')
        self.assertIn(p.MANAGED,self.machine.value['groups'])
        self.attempt['original_deadline']=now-1
        self.assertEqual(self.run_op('restore')['phase'],'NORMAL')
    def test_override_cannot_release_unsecured_or_unfinished_work(self):
        self.run_op('apply')
        self.attempt.update(start=1,state='COMPLETED',protected=False,deadline=2,original_deadline=2,
                            policy_override=True,policy_restore_authorized=True)
        with self.assertRaisesRegex(RuntimeError,'not secured'): self.run_op('restore')
        self.attempt.update(protected=True,state='ACTIVE')
        with self.assertRaises(RuntimeError): self.run_op('restore')
        self.attempt.update(state='COMPLETED',deadline=int(time.time()*1000)+100000)
        self.assertEqual(self.run_op('restore')['phase'],'NORMAL')
    def test_failed_restore_remains_retryable_after_restart(self):
        self.run_op('apply');self.cancel();self.machine.restoration_error=True
        with self.assertRaises(RuntimeError): self.run_op('restore')
        self.assertEqual(json.loads((self.root/'1001.json').read_text())['phase'],'RESTORE_FAILED')
        self.machine.restoration_error=False
        self.tx=p.Transactions(self.root,self.machine,lambda id:self.attempt)
        self.assertEqual(self.run_op('restore')['phase'],'NORMAL')
    def test_wrong_uid_generation_and_conflicting_hold_cannot_restore(self):
        self.run_op('apply');self.cancel()
        with self.assertRaises(RuntimeError): self.run_op('restore','b'*64)
        self.attempt['policy_generation']='b'*64
        with self.assertRaisesRegex(RuntimeError,'Another attempt'): self.run_op('restore','b'*64)
        self.assertIn(p.MANAGED,self.machine.value['groups'])
    def test_missing_journal_fails_closed_without_guessing_baseline(self):
        self.cancel()
        with self.assertRaisesRegex(RuntimeError,'baseline missing'): self.run_op('restore')
    def test_expired_setup_never_applies(self):
        self.attempt['policy_expires']=1
        with self.assertRaisesRegex(RuntimeError,'expired'):self.run_op('apply')
        self.assertEqual(self.machine.calls,[])
    def test_concurrent_attempt_cannot_take_over_active_uid(self):
        entered=threading.Event();release=threading.Event()
        apply=self.machine.apply
        def paused(name, baseline, step):
            entered.set()
            if not release.wait(2): raise RuntimeError('Test barrier timeout')
            apply(name,baseline,step)
        self.machine.apply=paused
        other={**self.attempt,'id':'98765432-1234-1234-1234-123456789abc','policy_generation':'b'*64}
        tx=p.Transactions(self.root,self.machine,lambda id:self.attempt if id==ID else other)
        with ThreadPoolExecutor(max_workers=2) as pool:
            first=pool.submit(self.run_op,'apply')
            self.assertTrue(entered.wait(2))
            second=pool.submit(tx.transact,'apply','student',1001,other['id'],other['policy_generation'])
            release.set();self.assertEqual(first.result()['phase'],'READY')
            with self.assertRaisesRegex(RuntimeError,'Another attempt'):second.result()
        self.assertIn(p.MANAGED,self.machine.value['groups'])
    def test_failed_read_only_qualification_leaves_recoverable_baseline(self):
        check=self.machine.check
        def fail(name,baseline,active):
            if not active:raise RuntimeError('Unsupported scheduler')
            check(name,baseline,active)
        self.machine.check=fail
        with self.assertRaisesRegex(RuntimeError,'scheduler'):self.run_op('apply')
        journal=json.loads((self.root/'1001.json').read_text())
        self.assertEqual(journal['steps'],[])
        self.assertEqual(self.machine.value,self.machine.original)
        self.cancel();self.assertEqual(self.run_op('restore')['phase'],'NORMAL')
    def test_verify_detects_missing_gate(self):
        self.run_op('apply');self.machine.value=copy.deepcopy(self.machine.original)
        with self.assertRaises(RuntimeError): self.run_op('verify')

class SSSD(unittest.TestCase):
    def test_existing_override_attributes_survive_apply_and_restore(self):
        original=['student@example','alias','1001','1002','Student Name','/srv/home/student','/bin/zsh','certificate']
        snapshot={'backend':'sssd','override':original,'account':{'shell':'/bin/zsh'}}
        system=p.System({});calls=[]
        with patch.object(p,'run',lambda *args,**kwargs:calls.append(args)):
            system.set_shell('student',snapshot,True)
            system.set_shell('student',snapshot,False)
        self.assertEqual(original[6],'/bin/zsh')
        apply,restore=calls[0],calls[2]
        self.assertIn(p.GATE,apply)
        self.assertIn('/bin/zsh',restore)
        for value in ['alias','1001','1002','Student Name','/srv/home/student','certificate']:
            self.assertIn(value,apply);self.assertIn(value,restore)
        self.assertFalse(any('systemctl' in arg or 'restart' in arg for call in calls for arg in call))
    def test_absent_override_is_removed_instead_of_guessed(self):
        system=p.System({});calls=[]
        with patch.object(p,'run',lambda *args,**kwargs:calls.append(args)):
            system.set_shell('student',{'backend':'sssd','override':None,'account':{'shell':'/bin/bash'}},False)
        self.assertEqual(calls[0],('/usr/sbin/sss_override','user-del','student'))
        self.assertEqual(calls[1],('/usr/sbin/sss_cache','-u','student'))

if __name__=='__main__':unittest.main()
