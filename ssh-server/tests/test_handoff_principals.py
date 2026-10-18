import copy,importlib.machinery,importlib.util,pathlib,unittest
p=pathlib.Path(__file__).resolve().parents[1]/'scripts/exam-principals';loader=importlib.machinery.SourceFileLoader('principals',str(p));spec=importlib.util.spec_from_loader(loader.name,loader);m=importlib.util.module_from_spec(spec);loader.exec_module(m)
class PrincipalTests(unittest.TestCase):
 def setUp(self):
  self.c={'temporary_account_policy':True};self.a={'id':'attempt','username':'student','uid':1001,'state':'PREPARING','start':0,'policy_state':'READY','policy_ready_boot':'boot','policy_expires':2000,'policy_generation':'generation','ssh_handoff':{'id':'a'*64,'principal':'exam:attempt:generation','certificate_key':'encoded','expires':1500}}
  self.j={'phase':'READY','attempt':'attempt','generation':'generation'}
 def call(self,user='student',encoded='encoded'):
  return m.principal(self.c,{'attempts':{'attempt':self.a}},user,'a'*64,encoded,1000,'boot',lambda uid:self.j)
 def test_ready_exact_certificate(self):self.assertEqual(self.call(),'exam:attempt:generation')
 def test_reject_changed_scope(self):
  self.assertIsNone(self.call(user='other'));self.assertIsNone(self.call(encoded='other'))
 def test_reject_expired_consumed_started_and_restored(self):
  for kind in ['expired','consumed','active','finished','boot','policy','deadline','generation','journal']:
   with self.subTest(kind=kind):
    a=copy.deepcopy(self.a);j=copy.deepcopy(self.j)
    if kind=='expired':self.a['ssh_handoff']['expires']=999
    elif kind=='consumed':self.a['ssh_handoff']['consumed']='transport'
    elif kind=='active':self.a['start']=900
    elif kind=='finished':self.a['state']='COMPLETED'
    elif kind=='boot':self.a['policy_ready_boot']='other'
    elif kind=='policy':self.a['policy_state']='NORMAL'
    elif kind=='deadline':self.a['original_deadline']=900
    elif kind=='generation':self.j['generation']='other'
    elif kind=='journal':self.j['phase']='NORMAL'
    self.assertIsNone(self.call());self.a=a;self.j=j
if __name__=='__main__':unittest.main()
