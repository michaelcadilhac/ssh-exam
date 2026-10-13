"""Installation checker contract tests; real root/PAM deployment remains a signoff."""
import importlib.machinery,types,unittest,unittest.mock as mock,pathlib,tempfile,os
loader=importlib.machinery.SourceFileLoader('isolation',str(pathlib.Path(__file__).parents[1]/'scripts/check-isolation'))
isolation=types.ModuleType(loader.name);loader.exec_module(isolation)
class Checks(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
  root=pathlib.Path(self.temp.name);self.root=root
  def path(*parts):
   text=str(pathlib.Path(*parts));return root/text.lstrip('/') if text.startswith('/') else pathlib.Path(text)
  self.path=path;self.settings='forcecommand exam-dispatch\npermituserrc no\npermituserenvironment no\ndisableforwarding yes\nusepam yes\nacceptenv LANG LC_*\nsubsystem sftp /usr/lib/openssh/sftp-server\n'
  self.cron='';self.service_user='';self.contexts=[];self.sudo_output='';self.declared='example.service loaded active running Example\n';self.template_user=''
  self.config={'accounts':{'student':{'uid':10001}}}
  for name in ['login','su','su-l','runuser','runuser-l','cron','atd']:
   p=path('/etc/pam.d',name);p.parent.mkdir(parents=True,exist_ok=True);p.write_text('account requisite pam_succeed_if.so user notingroup exam-managed\n')
  path('/etc/pam.d/sshd').write_text('session required pam_permit.so\n')
  path('/etc/pam.d/chsh').write_text('auth requisite pam_succeed_if.so user notingroup exam-managed\n')
  p=path('/usr/bin/crontab');p.parent.mkdir(parents=True);p.touch()
  user=types.SimpleNamespace(pw_uid=10001,pw_gid=10001,pw_shell='/usr/local/libexec/exam-login')
  original=pathlib.Path
  # Path is scoped to the checker module; other libraries keep their filesystem.
  isolation.pathlib=types.SimpleNamespace(Path=path)
  self.addCleanup(setattr,isolation,'pathlib',types.SimpleNamespace(Path=original))
  patches=[mock.patch.object(isolation,'trusted_gate',return_value=True),mock.patch.object(isolation.pwd,'getpwnam',return_value=user),mock.patch.object(isolation.os,'getgrouplist',return_value=[10001]),mock.patch.object(isolation.grp,'getgrgid',return_value=types.SimpleNamespace(gr_name='exam-managed')),mock.patch.object(isolation.subprocess,'run',side_effect=self.run_command)]
  for p in patches:p.start();self.addCleanup(p.stop)
 def run_command(self,args,**kw):
  output=''
  if args[0].endswith('sshd'):self.contexts.append(args[-1]);output=self.settings
  elif args[0].endswith('crontab'):output=self.cron
  elif args[0].endswith('sudo'):output=self.sudo_output
  elif 'list-unit-files' in args:output=self.declared
  elif 'list-units' in args:output='example.service loaded active running Example\n'
  elif 'cat' in args:output='User='+self.template_user+'\n'
  elif 'show' in args:output=self.service_user
  return types.SimpleNamespace(returncode=0,stdout=output,stderr='')
 def test_safe_policy_checks_both_address_contexts(self):
  self.assertEqual(isolation.check(self.config),[]);self.assertEqual(len(self.contexts),2)
 def test_missing_channel_gate_and_unsafe_environment_fail(self):
  self.settings=self.settings.replace('forcecommand exam-dispatch','forcecommand none').replace('acceptenv LANG LC_*','acceptenv *')
  errors=isolation.check(self.config);self.assertTrue(any('forcecommand' in e for e in errors));self.assertTrue(any('AcceptEnv' in e for e in errors))
 def test_missing_or_writable_static_gate_fails(self):
  with mock.patch.object(isolation,'trusted_gate',return_value=False):
   self.assertTrue(any('Static login gate' in e for e in isolation.check(self.config)))
 def test_direct_sudoers_privilege_fails_without_admin_group(self):
  p=self.path('/usr/bin/sudo');p.touch()
  self.assertTrue(any('sudo privileges' in e for e in isolation.check(self.config)))
 def test_sudo_success_status_can_mean_no_permissions(self):
  self.path('/usr/bin/sudo').touch();self.sudo_output='User student is not allowed to run sudo on class.example.edu.\n'
  self.assertEqual(isolation.check(self.config),[])
 def test_uninstantiated_template_is_inspected_as_file(self):
  self.declared='user@.service static -\nwriter@.service disabled -\n';self.template_user='root'
  self.assertEqual(isolation.check(self.config),[])
  self.template_user='10001';self.assertTrue(any('system service' in e for e in isolation.check(self.config)))
 def test_unknown_dynamic_service_template_fails_closed(self):
  self.declared='writer@.service disabled -\n';self.template_user='%i'
  self.assertTrue(any('Unresolved service template' in e for e in isolation.check(self.config)))
 def test_pending_user_scheduler_writer_fails(self):
  self.cron='* * * * * echo changed > /work/answer\n';self.assertTrue(any('crontab' in e for e in isolation.check(self.config)))
 def test_system_cron_writer_fails(self):
  self.path('/etc/crontab').write_text('* * * * * student echo changed\n');self.assertTrue(any('system cron' in e for e in isolation.check(self.config)))
 def test_loaded_service_writer_fails(self):
  self.service_user='10001\n';self.assertTrue(any('system service' in e for e in isolation.check(self.config)))
 def test_sshd_included_user_manager_requires_immediate_skip(self):
  self.path('/etc/pam.d/sshd').write_text('@include common-session\n')
  self.path('/etc/pam.d/common-session').write_text('session optional pam_systemd.so\n')
  self.assertTrue(any('skip pam_systemd' in e for e in isolation.check(self.config)))
  self.path('/etc/pam.d/common-session').write_text('session [success=1 default=ignore] pam_succeed_if.so user ingroup exam-managed\nsession optional pam_systemd.so\n')
  self.assertEqual(isolation.check(self.config),[])
 def test_missing_pam_include_fails_closed(self):
  self.path('/etc/pam.d/sshd').write_text('@include missing-stack\n')
  self.assertTrue(any('Missing PAM stack' in e for e in isolation.check(self.config)))
 def test_lingering_and_alternate_pam_route_fail(self):
  p=self.path('/var/lib/systemd/linger/student');p.parent.mkdir(parents=True);p.touch();self.path('/etc/pam.d/cron').write_text('account required pam_permit.so\n')
  errors=isolation.check(self.config);self.assertTrue(any('lingering' in e for e in errors));self.assertTrue(any('cron:' in e for e in errors))
if __name__=='__main__':unittest.main()
