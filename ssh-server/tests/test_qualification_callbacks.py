"""Pure synthetic callback contracts; real signatures/kernel are guest checks."""
import ast
import copy
import hashlib
import json
from pathlib import Path
import unittest


# Load ONLY this fixture's pure reply function, never its root startup/server.
source = Path(__file__).with_name('qualification_callbacks.py')
tree = ast.parse(source.read_text())
namespace = {'hashlib': hashlib, 'json': json}
exec(compile(ast.Module(body=[n for n in tree.body if isinstance(n, ast.FunctionDef)
                             and n.name in ('fixture_reply','source_fixture_reply')], type_ignores=[]),
             str(source), 'exec'), namespace)
reply = namespace['fixture_reply']
source_reply = namespace['source_fixture_reply']


class CallbackTests(unittest.TestCase):
    def test_source_management_requires_exact_plan_and_already_published_pin(self):
        plan=dict(version=1,agent='private-agent',grant=dict(id='one-grant',revision=1,hash='a'*64),
                  exam='retake',username='examq',uid=20001,settings={'duration':5400},
                  source=dict(attempt='source',checksum='b'*64),action='retain',current_revision=1,status='PENDING_NATIVE')
        expected=dict(audience='https://127.0.0.1:9444',plan=plan)
        request=dict(version=1,purpose='ssh-exam-management/v1',audience=expected['audience'],agent=plan['agent'],actor='agent-root',
                     request='one-request',nonce='e'*64,issued=1000000,expires=1030000,operation='grants.source-plan',body=dict(id='one-grant',revision=1))
        self.assertEqual(source_reply(request,expected,None,1000000),plan)
        record=dict(plan=copy.deepcopy(plan),phase='retained',metadata_hash='c'*64,retention_hash='d'*64,retained_at=1000000)
        request['operation']='grants.source-confirm'
        request['body']=dict(id='one-grant',revision=1,grant_hash='a'*64,state='RETAINED',source=dict(**plan['source'],uid=20001,metadata_hash='c'*64),retention_hash='d'*64,retained_at=1000000)
        self.assertEqual(source_reply(request,expected,record,1000000)['status'],'AVAILABLE')
        for change in ({'phase':'closing'},{'metadata_hash':'f'*64},{'retention_hash':'f'*64}):
            with self.subTest(change=change), self.assertRaises(AssertionError):
                source_reply(request,expected,{**record,**change},1000000)
        for change in ({'actor':'browser'},{'audience':'https://other.invalid'},{'operation':'arbitrary-native-command'}):
            with self.subTest(change=change), self.assertRaises(AssertionError):
                source_reply({**request,**change},expected,record,1000000)

    def setUp(self):
        self.owner = dict(attempt='synthetic-attempt', exam='qualification', username='examq',
                          uid=20001, transport_hash='a'*64, boot='synthetic-boot',
                          page_epoch='b'*64, input_epoch='c'*64, generation=0, clock_revision=0)
        self.expected = dict(type='grant-begin/v3', agent='private-agent',
                             attempt=self.owner['attempt'], exam='qualification',
                             username='examq', uid=20001, grant={'id': 'one-use'},
                             intent='begin-intent', transport='a'*64, boot='synthetic-boot',
                             settings={'duration': 90}, page_epoch='b'*64)
        self.request = {**copy.deepcopy(self.expected), 'nonce': 'd'*64,
                        'initial_owner': copy.deepcopy(self.owner)}
        self.owners = {}
        self.now = 1000000

    def begin(self):
        return reply('/api/agent/grant-begin', self.request, self.expected, None,
                     self.owners, self.now)

    def test_v3_begin_binds_exact_registry_and_owner_before_evidence(self):
        seed = self.begin()['bootstrap']
        self.assertEqual(seed['owner'], self.owner)
        self.assertEqual(seed['sequence'], 1)
        query = dict(type='monitoring-execution-challenge-v1', agent='private-agent',
                     nonce='e'*64, owner=self.owner, coverage_epoch=seed['coverage_epoch'],
                     after_sequence=1)
        evidence = reply('/api/agent/monitoring-evidence', query, self.expected, None,
                         self.owners, self.now)
        self.assertEqual(evidence['sequence'], 2)
        self.assertTrue(evidence['complete'])
        for field, value in [('exam', 'other'), ('transport_hash', 'f'*64),
                             ('page_epoch', 'f'*64), ('generation', 1)]:
            bad = copy.deepcopy(query); bad['owner'][field] = value
            with self.subTest(field=field), self.assertRaises(KeyError):
                reply('/api/agent/monitoring-evidence', bad, self.expected, None,
                      self.owners, self.now)
        query['coverage_epoch'] = '0'*64
        with self.assertRaises(AssertionError):
            reply('/api/agent/monitoring-evidence', query, self.expected, None,
                  self.owners, self.now)

    def test_begin_refusal_does_not_register_authority(self):
        for field, value in [('settings', {'duration': 91}), ('intent', 'other-intent')]:
            bad = {**self.request, field: value}
            with self.subTest(field=field), self.assertRaises(AssertionError):
                reply('/api/agent/grant-begin', bad, self.expected, None, self.owners, self.now)
        self.request['initial_owner']['transport_hash'] = '0'*64
        with self.assertRaises(AssertionError): self.begin()
        self.assertEqual(self.owners, {})

    def test_clock_transfer_requires_exact_private_registry_and_preserves_coverage(self):
        seed = self.begin()['bootstrap']
        owner = {**self.owner, 'clock_revision': 1}
        self.expected['clock_transfer'] = dict(previous_owner=self.owner, owner=owner)
        query = dict(type='monitoring-execution-challenge-v1', agent='private-agent',
                     nonce='e'*64, owner=owner, coverage_epoch=seed['coverage_epoch'], after_sequence=1)
        actual = reply('/api/agent/monitoring-evidence', query, self.expected, None, self.owners, self.now)
        self.assertEqual(actual['coverage_epoch'], seed['coverage_epoch'])
        self.assertEqual(actual['owner'], owner)
        for change in ({'generation': 1}, {'clock_revision': 2}, {'input_epoch': 'f'*64}):
            bad = copy.deepcopy(self.expected)
            bad['clock_transfer']['owner'].update(change)
            with self.subTest(change=change), self.assertRaises(AssertionError):
                reply('/api/agent/monitoring-evidence', query, bad, None, self.owners, self.now)

    def test_continue_requires_exact_finite_approval_and_preserves_scope(self):
        self.begin()
        owner = {**self.owner, 'generation': 1, 'input_epoch': 'f'*64}
        query = dict(type='monitoring-continue/v1', agent='private-agent', nonce='e'*64,
                     previous_owner=self.owner, owner=owner)
        approval = dict(previous_owner=copy.deepcopy(self.owner), generation=1,
                        expires=self.now+10000)
        for rejected in (None, {**approval, 'expires': self.now},
                         {**approval, 'expires': self.now+300001},
                         {**approval, 'generation': 2},
                         {**approval, 'previous_owner': {**self.owner, 'page_epoch': '0'*64}}):
            with self.subTest(approval=rejected), self.assertRaises(AssertionError):
                reply('/api/agent/monitoring-continue', query, self.expected, rejected,
                      self.owners, self.now)
        for field, value in [('transport_hash', '0'*64), ('clock_revision', 1),
                             ('page_epoch', '0'*64), ('input_epoch', self.owner['input_epoch'])]:
            bad = copy.deepcopy(query); bad['owner'][field] = value
            with self.subTest(field=field), self.assertRaises(AssertionError):
                reply('/api/agent/monitoring-continue', bad, self.expected, approval,
                      self.owners, self.now)
        result = reply('/api/agent/monitoring-continue', query, self.expected, approval,
                       self.owners, self.now)
        self.assertEqual(result['bootstrap']['owner'], owner)
        self.assertEqual(result['previous_owner'], self.owner)
        self.assertEqual(result['authorization_expires'], approval['expires'])
        self.assertEqual(len(self.owners), 2)

    def test_legacy_begin_does_not_invent_monitoring_permission(self):
        self.expected['type'] = self.request['type'] = 'grant-begin/v2'
        self.request.pop('initial_owner')
        self.assertNotIn('bootstrap', self.begin())
        self.assertEqual(self.owners, {})
