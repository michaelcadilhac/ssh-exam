"""Actual schema37 SQLite preservation checks; synthetic rows, no host access."""
from pathlib import Path
from importlib.util import spec_from_file_location, module_from_spec
import hashlib,json,sqlite3,tempfile,unittest

ROOT=Path(__file__).resolve().parents[1]
SPEC=spec_from_file_location('recording_nonce_preservation',ROOT/'scripts/web-ui-ops/preservation.py')
MODULE=module_from_spec(SPEC);SPEC.loader.exec_module(MODULE)
STARTED=1793582273875
OBSERVED=1793582374967
EXPIRES=[1793582272673,1793582267372,1793582277977,1793582283277,1793582288596,1793582293900]
POLL=json.dumps({'operation':'grants.source-next','body':{}},separators=(',',':'))
FINGERPRINT=hashlib.sha256(POLL.encode()).hexdigest()
OUTCOME=json.dumps({'ok':True,'status':200,'result':{'task':None}})
DETAIL=json.dumps({'confirmed':True,'operation':'grants.source-next','target':'exams'})

class NoncePreservation(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='recording-nonce-preservation-')
        self.path=Path(self.temp.name);self.db=sqlite3.connect(self.path/'current.sqlite')
        for p in sorted((ROOT/'migrations').iterdir()):
            if p.suffix=='.sql' and p.stem.isdigit() and int(p.stem)<=37:self.db.executescript(p.read_text())
        self.db.execute("INSERT INTO exams VALUES('synthetic','{}')")
        self.db.execute("INSERT INTO attempts(id,exam,username,uid,state,settings,start,deadline,original_deadline,protected,checksum,access_state) VALUES('history','synthetic','synthetic',1001,'COMPLETED','{}',100,200,200,1,?,'HELD')",('a'*64,))
        self.db.execute("INSERT INTO audit VALUES('prior-audit',1,'prior','prior','history','preserve')")
        self.db.execute("INSERT INTO agent_management_requests VALUES('class','prior-request','prior',1,'{}')")
        for n,expiry in enumerate(EXPIRES):self.db.execute('INSERT INTO agent_management_nonces VALUES(?,?,?)',('class','expired-'+str(n),expiry))
        self.db.execute('INSERT INTO agent_management_nonces VALUES(?,?,?)',('class','live',OBSERVED+5000))
        self.db.commit()
        with sqlite3.connect(self.path/'previous.sqlite') as previous:self.db.backup(previous)
        self.db.execute('ATTACH DATABASE ? AS previous',(str(self.path/'previous.sqlite'),))

    def tearDown(self):self.db.close();self.temp.cleanup()

    def poll(self,n,created):
        self.db.execute('INSERT INTO agent_management_requests VALUES(?,?,?,?,?)',('class','poll-'+str(n),FINGERPRINT,created,OUTCOME))
        self.db.execute('INSERT INTO audit VALUES(?,?,?,?,?,?)',('poll-audit-'+str(n),created+1,'agent:class:root','management-grants.source-next','poll-'+str(n),DETAIL))

    def remove(self,nonce):self.db.execute('DELETE FROM main.agent_management_nonces WHERE nonce=?',(nonce,))
    def verify(self):return MODULE.verify(self.db,STARTED,OBSERVED,'class')

    def test_actual_expiry_pattern_live_at_start_expires_before_audited_poll(self):
        for n in range(17):self.poll(n,1793582280150+n*5000)
        self.poll(17,1793582370372)
        for n in range(6):self.remove('expired-'+str(n))
        proof=self.verify()
        self.assertEqual(len(proof['preserved_tables']),41)
        self.assertEqual(proof['audited_empty_queue_polls'],18)
        self.assertEqual(proof['expired_before_start_nonces_pruned'],2)
        self.assertEqual(proof['expired_after_proof_start_nonces_pruned'],4)
        self.assertEqual(proof['nonce_prune_audited_cutoff_ms'],1793582370372)

    def test_currently_live_future_nonce_loss_refuses(self):
        self.poll(0,1793582370372);self.remove('live')
        with self.assertRaises(AssertionError):self.verify()

    def test_expired_removed_without_any_poll_evidence_refuses(self):
        self.remove('expired-0')
        with self.assertRaises(AssertionError):self.verify()

    def test_expiry_after_last_audited_poll_refuses_even_if_expired_now(self):
        self.poll(0,1793582280150);self.remove('expired-5')
        with self.assertRaises(AssertionError):self.verify()

    def test_pruning_at_equal_expiry_refuses_strict_runtime_predicate(self):
        self.poll(0,EXPIRES[2]);self.remove('expired-2')
        with self.assertRaises(AssertionError):self.verify()

    def test_request_without_matching_audit_cannot_authorize_pruning(self):
        self.poll(0,1793582370372);self.db.execute("DELETE FROM main.audit WHERE id='poll-audit-0'");self.remove('expired-2')
        with self.assertRaises(AssertionError):self.verify()

    def test_wrong_poll_fingerprint_cannot_authorize_pruning(self):
        self.poll(0,1793582370372);self.db.execute("UPDATE main.agent_management_requests SET fingerprint='wrong' WHERE request='poll-0'");self.remove('expired-0')
        with self.assertRaises(AssertionError):self.verify()

    def test_nonempty_poll_result_cannot_authorize_pruning(self):
        self.poll(0,1793582370372);self.db.execute("UPDATE main.agent_management_requests SET outcome=? WHERE request='poll-0'",(json.dumps({'ok':True,'status':200,'result':{'task':{'id':'work'}}}),));self.remove('expired-2')
        with self.assertRaises(AssertionError):self.verify()

    def test_authority_history_and_original_nonce_must_stay_exact(self):
        for change in ["UPDATE main.attempts SET deadline=201", "DELETE FROM main.audit WHERE id='prior-audit'", "DELETE FROM main.agent_management_requests WHERE request='prior-request'", "UPDATE main.agent_management_nonces SET expires=expires+1 WHERE nonce='live'"]:
            self.db.execute('SAVEPOINT change');self.db.execute(change)
            with self.subTest(change=change),self.assertRaises(AssertionError):self.verify()
            self.db.execute('ROLLBACK TO change');self.db.execute('RELEASE change')

    def test_unchanged_database_needs_no_poll(self):self.assertEqual(self.verify()['audited_empty_queue_polls'],0)

if __name__=='__main__':unittest.main()
