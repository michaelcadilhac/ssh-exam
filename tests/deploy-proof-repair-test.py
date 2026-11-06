"""Proof repair pins and refusal boundaries; real running-image recovery separate."""
from importlib.machinery import SourceFileLoader
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
loader=SourceFileLoader('nonce_proof_repair',str(ROOT/'scripts/deploy-web-ui-proof-repair'))
spec=importlib.util.spec_from_loader(loader.name,loader);repair=importlib.util.module_from_spec(spec);loader.exec_module(repair)


class ProofRepair(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name);self.scripts=self.root/'code/scripts';(self.scripts/'web-ui-ops').mkdir(parents=True)
        self.proof=self.root/'repair';self.proof.mkdir(mode=0o700)
        for relative in ('deploy-web-ui','shared_backup.py','deployment_pause.py','public_reopen_readiness.py'):
            data = subprocess.check_output(['git','show','5ed57ca:scripts/'+relative],cwd=ROOT) if relative == 'deploy-web-ui' else (ROOT/'scripts'/relative).read_bytes()
            (self.scripts/relative).write_bytes(data)
        self.original=self.scripts/'web-ui-ops/preservation.py'
        self.original.write_bytes(subprocess.check_output(['git','show','5ed57ca:scripts/web-ui-ops/preservation.py'],cwd=ROOT))
        self.corrected=self.proof/'preservation-60.py';self.corrected.write_bytes((ROOT/'scripts/web-ui-ops/preservation.py').read_bytes())

    def test_loads_only_exact_corrected_proof_and_preserves_original_inputs(self):
        before={p:repair.digest(p) for p in (self.scripts/'deploy-web-ui',self.original)}
        module=repair.load_controller(self.scripts/'deploy-web-ui',self.proof)
        self.assertEqual(module.preservation.MANAGEMENT_REQUEST_MAX_MS,60000)
        self.assertEqual(before,{p:repair.digest(p) for p in before})
        self.assertEqual(module.SCRIPTS,self.scripts)

    def test_changed_original_controller_old_proof_or_corrected_proof_refuses(self):
        for path in (self.scripts/'deploy-web-ui',self.original,self.corrected):
            original=path.read_bytes();path.write_bytes(original+b'\n# unqualified\n')
            with self.subTest(path=path.name),self.assertRaises(AssertionError):repair.load_controller(self.scripts/'deploy-web-ui',self.proof)
            path.write_bytes(original)

    def test_symlinked_proof_is_not_a_trusted_repair(self):
        self.corrected.rename(self.root/'outside.py');self.corrected.symlink_to(self.root/'outside.py')
        with self.assertRaises(AssertionError):repair.load_controller(self.scripts/'deploy-web-ui',self.proof)

    def test_service_and_container_replacement_is_blocked_before_dispatch(self):
        calls=[]
        dispatch=repair.no_service_replacement(lambda words,timeout=30:calls.append(words) or 'read-only')
        for verb in ('start','stop','restart','try-restart','reload-or-restart'):
            with self.subTest(verb=verb),self.assertRaises(ValueError):dispatch(['/usr/bin/systemctl',verb,'ssh-exam.service'])
        for verb in ('start','stop','restart','run','create','rm','compose'):
            with self.subTest(verb=verb),self.assertRaises(ValueError):dispatch(['/usr/bin/docker',verb,'candidate'])
        self.assertEqual(calls,[])
        self.assertEqual(dispatch(['/usr/bin/docker','inspect','ssh-exam-app-1']),'read-only')
        self.assertEqual(dispatch(['/usr/bin/systemctl','reload','nginx.service']),'read-only')
        self.assertEqual(len(calls),2)

    def test_cli_help_and_unsupported_mutation(self):
        result=subprocess.run(['python3',str(ROOT/'scripts/deploy-web-ui-proof-repair'),'--help'],capture_output=True,text=True)
        self.assertEqual(result.returncode,0);self.assertIn('resume,status',result.stdout)
        result=subprocess.run(['python3',str(ROOT/'scripts/deploy-web-ui-proof-repair'),'--controller','/unused','--repair','/unused','--state','/unused','apply'],capture_output=True,text=True)
        self.assertEqual(result.returncode,2);self.assertIn('invalid choice',result.stderr)


if __name__=='__main__':unittest.main()
