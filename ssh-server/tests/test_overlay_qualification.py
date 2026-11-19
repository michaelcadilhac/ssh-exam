"""Runner safety contracts; real guest results are recorded separately."""
import importlib.util
import ast
import copy
import json
from pathlib import Path
import tempfile
import fcntl
import os
import types
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location('overlay', Path(__file__).with_name('overlay_qualification.py'))
overlay = importlib.util.module_from_spec(spec)
spec.loader.exec_module(overlay)
guest_spec = importlib.util.spec_from_file_location('overlay_guest', Path(__file__).with_name('overlay_guest.py'))
guest = importlib.util.module_from_spec(guest_spec)
guest_spec.loader.exec_module(guest)


class OverlayTests(unittest.TestCase):
    def test_colocation_uses_only_the_exact_owned_aggregate_slice(self):
        arguments=('test.service',Path('/guest'),Path('/input'),Path('/output'))
        storage={'work':'/srv/exam-workspace/work','state':'/var/lib/exam-agent'}
        owned='ssh-exam-colocation-'+'a'*16+'.slice'
        command=overlay.candidate_command(*arguments,35,storage,'retained-policy',qualification_slice=owned)
        self.assertIn('--slice='+owned,command)
        self.assertIn('--property=MemoryMax=3G',command)
        single=overlay.candidate_command(*arguments,1,None,'retained-policy',qualification_slice=owned)
        self.assertIn('--slice='+owned,single)
        self.assertIn('--property=MemoryMax=1G',single)
        for wrong in ('system.slice','ssh-exam.service','ssh-exam-colocation-bad.slice'):
            with self.subTest(slice=wrong),self.assertRaises(AssertionError):
                overlay.candidate_command(*arguments,35,storage,'retained-policy',qualification_slice=wrong)
        with self.assertRaises(AssertionError):
            overlay.candidate_command(*arguments,16,storage,'retained-policy',qualification_slice=owned)
        with self.assertRaises(AssertionError):
            overlay.candidate_command(*arguments,1,None,'enforcement',qualification_slice=owned)

    def test_shared_policy_probe_contract_accepts_both_exact_profiles_and_verified_installation(self):
        guest.require_execution_policy_profile({'profile':'execution-policy','username':'examq'}, 'examq')
        nonce = '11111111-1111-4111-8111-111111111111'
        hashes = {name:'a'*64 for name in guest.NATIVE_PATHS}
        marker = {'profile':'native-install','username':'examq','native_nonce':nonce,'native_sha256':hashes}
        proof = {'results':{
            'verify':{'phase':'NATIVE_MATCHED_VERIFIED','nonce':nonce,'binary_sha256':hashes},
            'guard-after':{'phase':'after-native','nonce':nonce,'binary_sha256':hashes,'policy_supported':True,
                           'host':'private-native-install-qualification','fixture':True,'production_writes':False}}}
        guest.require_execution_policy_profile(marker, 'examq', proof)
        for wrong in ('enforcement','framed-owner','retained-policy','loaded-roles'):
            with self.subTest(profile=wrong), self.assertRaises(AssertionError):
                guest.require_execution_policy_profile(dict(marker,profile=wrong), 'examq', proof)
        with self.assertRaises(AssertionError): guest.require_execution_policy_profile(marker,'another',proof)
        with self.assertRaises(AssertionError): guest.require_execution_policy_profile(marker,'examq')
        for key,value in (('nonce','22222222-2222-4222-8222-222222222222'),('binary_sha256',{}),
                          ('phase','before-native'),('policy_supported',False),('host','csc-sys'),('production_writes',True)):
            changed=copy.deepcopy(proof);changed['results']['guard-after'][key]=value
            with self.subTest(field=key), self.assertRaises(AssertionError):
                guest.require_execution_policy_profile(marker,'examq',changed)

    def test_native_install_profile_has_replaceable_overlay_binaries_and_exact_extra_input(self):
        self.assertEqual(overlay.profile_files('enforcement'), overlay.FILES)
        selected = overlay.profile_files('native-install')
        self.assertEqual(set(selected) - set(overlay.FILES), {'deploy-native-cohort'})
        command = overlay.candidate_command('test.service', Path('/guest'), Path('/input'), Path('/output'), profile='native-install')
        for name in overlay.NATIVE_BINARIES:
            target, _ = overlay.FILES[name]
            self.assertNotIn('--bind-ro=/input/' + name + ':' + target, command)
        self.assertIn('--bind-ro=/input/exam-source-setup.service:/etc/systemd/system/exam-source-setup.service', command)
        self.assertIn('--bind-ro=/input/account-policy:/usr/local/sbin/exam-account-policy', command)
        for service in overlay.NATIVE_SERVICES:
            self.assertIn('--bind-ro=/input/native-bootstrap.conf:/etc/systemd/system/' + service + '.d/00-private-qualification-bootstrap.conf', command)
        self.assertIn('Before=exam-agent.service exam-deadline-watchdog.service exam-source-setup.service', overlay.NATIVE_BOOTSTRAP_UNIT)
        self.assertIn('Requires=' + overlay.NATIVE_BOOTSTRAP, overlay.NATIVE_BOOTSTRAP_DEPENDENCY)
        ast.parse(guest.NATIVE_FIXTURE_GUARD)

    def test_native_bootstrap_wrong_profile_refuses_before_file_or_service_operation(self):
        def contents(path, *_args, **_kwargs):
            return 'systemd-nspawn' if str(path) == '/run/systemd/container' else json.dumps({'profile':'enforcement','username':'examq'})
        with mock.patch.object(guest.os, 'getuid', return_value=0), mock.patch.object(guest.os, 'geteuid', return_value=0), \
             mock.patch.object(Path, 'read_text', contents), mock.patch.object(Path, 'is_mount', return_value=True), \
             mock.patch.object(guest.os, 'open') as mutation, mock.patch.object(guest.subprocess, 'run') as service:
            with self.assertRaises(AssertionError): guest.bootstrap_native_install()
            mutation.assert_not_called(); service.assert_not_called()

    def test_relay_install_is_explicit_and_confined_to_native_install(self):
        selected = overlay.profile_files('native-install', native_relay=True)
        self.assertEqual(set(selected) - set(overlay.profile_files('native-install')),
                         {'exam-ssh-relay', 'relay-nginx.conf', 'qualify_relay_install.py'})
        command = overlay.candidate_command('test.service', Path('/guest'), Path('/input'), Path('/output'),
                                            profile='native-install', native_relay=True)
        self.assertIn('--bind-ro=/input/nginx-runtime:/run/ssh-exam-nginx-runtime', command)
        self.assertNotIn('--bind-ro=/input/exam-ssh-relay:/usr/local/libexec/exam-ssh-relay', command)
        for profile in ('enforcement', 'retained-policy', 'execution-policy'):
            with self.subTest(profile=profile), self.assertRaises(AssertionError):
                overlay.profile_files(profile, native_relay=True)
        module = ast.parse(Path(__file__).with_name('qualify_relay_install.py').read_text())
        strings = {node.targets[0].id: ast.literal_eval(node.value) for node in module.body
                   if isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name)
                   and node.targets[0].id in ('GUARD', 'NGINX_WRAPPER')}
        self.assertEqual(set(strings), {'GUARD', 'NGINX_WRAPPER'})
        for source in strings.values(): ast.parse(source)

    def test_native_bootstrap_refuses_loaded_role_before_replacing_any_binary(self):
        (self.root / 'state.json').write_text(json.dumps({'attempts': {}}))
        with mock.patch.object(guest, 'native_install_context', return_value=({}, {'state':str(self.root)})), \
             mock.patch.object(guest.subprocess, 'run', return_value=types.SimpleNamespace(stdout='123\n')), \
             mock.patch.object(guest.os, 'open') as mutation:
            with self.assertRaisesRegex(AssertionError, 'already loaded'): guest.bootstrap_native_install()
            mutation.assert_not_called()

    def test_execution_policy_probe_requires_exact_private_overlay_profile(self):
        self.assertEqual(overlay.FILES['exam-source-setup.service'],('/etc/systemd/system/exam-source-setup.service',0o644))
        with mock.patch.object(Path,'read_text',return_value=json.dumps({'profile':'enforcement','username':'examq'})), \
             mock.patch.object(guest.subprocess,'run') as operation:
            with self.assertRaises(AssertionError):guest.qualify_execution_policy_roles({})
            operation.assert_not_called()

    def test_capacity_uses_only_owned_disk_binds_and_bounded_private_resources(self):
        command = overlay.candidate_command('test.service', Path('/guest'), Path('/input'), Path('/output'),
                                             16, {'work': '/srv/exam-workspace/work', 'state': '/var/lib/exam-agent'})
        for value in ('--property=MemoryMax=3G', '--property=TasksMax=2048', '--property=CPUQuota=200%',
                      '--private-network', '--read-only', '--volatile=overlay', '--drop-capability=CAP_SYS_TIME',
                      '--bind=/output/work:/srv/exam-workspace/work', '--bind=/output/state:/var/lib/exam-agent'):
            self.assertIn(value, command)
        for storage in ({'work': '/', 'state': '/var/lib/exam-agent'},
                        {'work': '/srv/exam-workspace/work', 'state': '/etc'},
                        {'work': '/srv/exam-workspace/../other', 'state': '/var/lib/exam-agent'}):
            with self.subTest(storage=storage), self.assertRaises(AssertionError):
                overlay.candidate_command('test.service', Path('/guest'), Path('/input'), Path('/output'), 16, storage)

    def test_manual_seventy_student_mode_retains_containment_and_has_finite_endurance(self):
        storage = {'work': '/srv/exam-workspace/work', 'state': '/var/lib/exam-agent'}
        command = overlay.candidate_command('test.service', Path('/guest'), Path('/input'), Path('/output'), 70, storage)
        for value in ('--property=MemoryMax=3G', '--property=MemorySwapMax=0', '--property=TasksMax=8192',
                      '--property=CPUQuota=200%', '--property=RuntimeMaxSec=14400', '--private-network',
                      '--read-only', '--volatile=overlay', '--drop-capability=CAP_SYS_TIME',
                      '--bind=/output/work:/srv/exam-workspace/work', '--bind=/output/state:/var/lib/exam-agent'):
            self.assertIn(value, command)
        with self.assertRaises(AssertionError):
            overlay.candidate_command('test.service', Path('/guest'), Path('/input'), Path('/output'), 70, {'work':'/','state':'/var/lib/exam-agent'})
        with self.assertRaises(AssertionError):
            overlay.candidate_command('test.service', Path('/guest'), Path('/input'), Path('/output'), 71, storage)
        debug = overlay.candidate_command('test.service', Path('/guest'), Path('/input'), Path('/output'),
                                          70, storage, profile='retained-policy', debugger=True)
        self.assertIn('--bind-ro=/input/gdb-runtime:/usr/lib/ssh-exam-stress-gdb', debug)
        self.assertIn('--bind-ro=/input/gdb-wrapper:/usr/bin/gdb', debug)
        self.assertNotIn('--bind=/input/gdb-runtime:/usr/lib/ssh-exam-stress-gdb', debug)
        with self.assertRaises(AssertionError):
            overlay.candidate_command('test.service', Path('/guest'), Path('/input'), Path('/output'),
                                      16, storage, profile='retained-policy', debugger=True)

    def test_thirty_five_students_keep_isolation_debugger_and_finite_resource_limits(self):
        storage={'work':'/srv/exam-workspace/work','state':'/var/lib/exam-agent'}
        command=overlay.candidate_command('test.service',Path('/guest'),Path('/input'),Path('/output'),
                                          35,storage,profile='retained-policy',debugger=True)
        for flag in ('--property=MemoryMax=3G','--property=MemorySwapMax=0','--property=TasksMax=4096',
                     '--property=CPUQuota=200%','--property=RuntimeMaxSec=14400','--private-network',
                     '--read-only','--volatile=overlay','--drop-capability=CAP_SYS_TIME',
                     '--bind-ro=/input/gdb-runtime:/usr/lib/ssh-exam-stress-gdb'):
            self.assertIn(flag,command)
        for count in (34,36):
            with self.subTest(count=count),self.assertRaises(AssertionError):
                overlay.candidate_command('test.service',Path('/guest'),Path('/input'),Path('/output'),count,storage)

    def test_debugger_hashes_do_not_overflow_the_existing_readiness_marker(self):
        inputs = self.root / 'input'; inputs.mkdir()
        source = self.root / 'public-code'; source.write_bytes(b'public synthetic code')
        sources = {f'share/python/gdb/code-{i}.py':source for i in range(100)}
        digest = overlay.write_debugger_inputs(inputs, sources)
        self.assertEqual(len(digest),64)
        self.assertLess(len(json.dumps({'debugger_manifest_sha256':digest})),4096)
        self.assertGreater((inputs/'debugger.json').stat().st_size,4096)
        self.assertEqual((inputs/'gdb-runtime/share/python/gdb').stat().st_mode & 0o777,0o755)
        self.assertEqual(set(json.loads((inputs/'debugger.json').read_text())),set(sources))

    def test_debugger_copy_refuses_paths_outside_its_public_runtime(self):
        inputs = self.root / 'input'; inputs.mkdir()
        source = self.root / 'public-code'; source.write_bytes(b'code')
        with self.assertRaises(AssertionError):
            overlay.write_debugger_inputs(inputs, {'../escape':source})
        self.assertFalse((inputs/'escape').exists())

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def state(self, attempt):
        (self.root / 'state.json').write_text(json.dumps({'attempts': {'synthetic': attempt}}))
        return {'state': str(self.root)}

    def test_bounded_json_refuses_large_input(self):
        path = self.root / 'metadata'
        path.write_text('{} ' * 100)
        with self.assertRaisesRegex(RuntimeError, 'bounds'):
            overlay.bounded_json(path, 8)

    def test_symlink_parent_is_not_a_private_guest(self):
        (self.root / 'real').mkdir()
        (self.root / 'link').symlink_to('real', target_is_directory=True)
        with self.assertRaisesRegex(RuntimeError, 'symlink'):
            overlay.private_directory(self.root / 'link')

    def test_concurrent_guest_runner_is_refused_without_base_writes(self):
        descriptor = os.open(self.root, os.O_RDONLY | os.O_DIRECTORY)
        self.addCleanup(os.close, descriptor)
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with mock.patch.object(overlay.os, 'getuid', return_value=0), mock.patch.object(overlay.os, 'geteuid', return_value=0), mock.patch.object(overlay, 'run_locked') as body:
            with self.assertRaises(BlockingIOError):
                overlay.run(types.SimpleNamespace(guest=self.root))
            body.assert_not_called()
        self.assertEqual(list(self.root.iterdir()), [])

    def test_authority_refuses_live_and_unresolved_attempts(self):
        for attempt in ({'state': 'ACTIVE'}, {'state': 'PREPARING'},
                        {'state': 'COMPLETED', 'access_state': 'HELD'},
                        {'state': 'COMPLETED', 'policy_state': 'RESTORE_FAILED'}):
            with self.subTest(attempt=attempt), self.assertRaisesRegex(RuntimeError, 'live/unresolved'):
                overlay.authority(self.state(attempt))

    def test_guest_uses_normal_root_not_a_second_minimal_install(self):
        original = {'rootfs': '/legacy/rootfs', 'work': '/srv/exam-workspace/work',
                    'state': '/var/lib/exam-agent', 'host_filesystem_hidden_paths': ['/var/private'],
                    'callback_url': 'https://127.0.0.1:9444', 'accounts': {}}
        proposed = guest.normal_filesystem_settings(original, ['/run/dbus/system_bus_socket',
                     '/home/examq/.private.sock', '/var/lib/service/control.sock', '@abstract'])
        self.assertIs(proposed['host_filesystem'], True)
        self.assertEqual(proposed['rootfs'], '/')
        self.assertEqual(proposed['host_filesystem_hidden_paths'], ['/srv/exam-workspace', '/var/lib/service', '/var/private'])
        self.assertEqual(proposed['callback_url'], original['callback_url'])
        self.assertEqual(original['rootfs'], '/legacy/rootfs')
        self.assertNotIn('host_filesystem', original)
        for path in ('/usr/bin/control.sock', '/etc/control.sock', '/var/control.sock'):
            with self.subTest(path=path), self.assertRaisesRegex(RuntimeError, 'unexpected guest service socket'):
                guest.normal_filesystem_settings(original, [path])

    def test_final_guest_hold_must_be_the_exact_protected_saved_work_consumer(self):
        plan = dict(action='release', status='CONSUMED', exam='synthetic', username='examq', uid=20001,
                    source=dict(attempt='source', checksum='source-checksum'),
                    grant={'id': 'saved-grant'}, settings={'duration': 5400})
        source = dict(id='source', state='COMPLETED', protected=True, access_state='RELEASED',
                      checksum='source-checksum', uid=20001, start=1000)
        consumer = dict(id='consumer', state='COMPLETED', protected=True, access_state='HELD', policy_state='HELD',
                        checksum='consumer-checksum', exam='synthetic', username='examq', uid=20001,
                        grant=plan['grant'], settings=plan['settings'], start=2000, deadline=5402000,
                        original_deadline=5402000,
                        workspace=dict(source=dict(kind='saved', **plan['source']), recovery_hash='retention'))
        state = {'attempts': {'source': source, 'consumer': consumer}}
        pin = dict(phase='released', consumers=['consumer'], retention_hash='retention')
        guest.verify_finished_guest(state, 'retained-policy', plan, pin, 3000)
        for change in ({'state': 'ACTIVE'}, {'protected': False}, {'checksum': ''},
                       {'grant': {'id': 'other'}}, {'uid': 20002}, {'deadline': 5402001},
                       {'policy_state': 'RESTORE_FAILED'}, {'policy_state': 'NORMAL'},
                       {'policy_error': 'unverified'}, {'access_error': 'unverified'},
                       {'settings': {'duration': 60}}):
            bad = copy.deepcopy(state); bad['attempts']['consumer'].update(change)
            with self.subTest(change=change), self.assertRaises(AssertionError):
                guest.verify_finished_guest(bad, 'retained-policy', plan, pin, 3000)
        with self.assertRaises(AssertionError):
            guest.verify_finished_guest(state, 'enforcement', plan, pin, 3000)
        with self.assertRaises(AssertionError):
            guest.verify_finished_guest(state, 'retained-policy', plan, {**pin, 'phase': 'retained'}, 3000)
        with self.assertRaises(AssertionError):
            guest.verify_finished_guest(state, 'retained-policy', plan, pin, 5402000)
        bad = copy.deepcopy(state); bad['attempts']['source']['access_state'] = 'HELD'
        with self.assertRaises(AssertionError):
            guest.verify_finished_guest(bad, 'retained-policy', plan, pin, 3000)

    def test_preservation_tracks_authority_not_background_delivery_timestamps(self):
        attempt = {'state': 'COMPLETED', 'deadline': 1234, 'original_deadline': 5678,
                   'checksum': 'protected', 'settings': {'duration': 60}}
        original = overlay.authority(self.state(attempt))
        self.assertEqual(original, overlay.authority(self.state({**attempt, 'callback_at': 999})))
        self.assertNotEqual(original, overlay.authority(self.state({**attempt, 'deadline': 999})))
        for field, value in [('grant', {'id': 'synthetic-one-use-grant'}),
                             ('grant_begin_intent', 'original-intent'),
                             ('registered_owner', {'page_epoch': 'native-page'}),
                             ('workspace', {'source': {'kind': 'saved', 'checksum': 'protected'}}),
                             ('terminal_supervised', True), ('monitoring_mode', 'v1'),
                             ('retained_hold', 'held'), ('monitoring_hold_kind', 'policy'),
                             ('monitoring_resume_nonce', 'current-operation')]:
            with self.subTest(field=field):
                self.assertNotEqual(original, overlay.authority(self.state({**attempt, field: value})))

    def test_command_is_volatile_private_and_bounded_without_host_network(self):
        self.assertEqual(overlay.FILES['exam-login'][1], 0o755)
        command = overlay.candidate_command('ssh-exam-qualification-test.service',
                                            self.root / 'guest', self.root / 'in', self.root / 'out')
        for flag in ('--volatile=overlay', '--read-only', '--private-network',
                     '--settings=no', '--register=no', '--keep-unit',
                     '--property=MemoryMax=1G', '--property=MemorySwapMax=0',
                     '--property=CPUQuota=50%', '--property=RuntimeMaxSec=900',
                     '--property=KillMode=control-group', '--property=Delegate=yes',
                     '--system-call-filter=adjtimex clock_adjtime', '--drop-capability=CAP_SYS_TIME'):
            self.assertIn(flag, command)
        writable = [arg for arg in command if arg.startswith('--bind=')]
        self.assertEqual(writable, ['--bind=' + str(self.root / 'out') + ':/run/ssh-exam-qualification-output'])
        self.assertNotIn('--network-veth', command)
        self.assertNotIn('--template', command)
        self.assertNotIn('/bin/sh', command)
        self.assertIn('--bind-ro=' + str(self.root / 'in' / 'exam-agent') + ':/usr/local/sbin/exam-agent', command)
        self.assertEqual(overlay.FILES['examterminal.slice'], ('/etc/systemd/system/examterminal.slice', 0o644))
        self.assertIn('--bind-ro=' + str(self.root / 'in' / 'examterminal.slice') + ':/etc/systemd/system/examterminal.slice', command)

    def test_monitoring_owner_uses_only_the_manifested_test_executable(self):
        self.assertEqual(overlay.FILES['core-qualification.test'], (None, 0o755))
        self.assertEqual(guest.monitoring_owner_command(), [
            '/run/ssh-exam-qualification-input/core-qualification.test',
            '-test.run=^TestMonitoringSSHProcessGuest$', '-test.v', '-test.count=5',
            '-test.timeout=60s'])
        command = overlay.candidate_command('ssh-exam-qualification-test.service',
                                            self.root / 'guest', self.root / 'in', self.root / 'out')
        self.assertFalse(any('core-qualification.test:/' in arg for arg in command))

    def test_freeze_profile_is_scoped_to_the_same_private_test_binary(self):
        self.assertEqual(guest.monitoring_freeze_command(), [
            '/run/ssh-exam-qualification-input/core-qualification.test',
            '-test.run=^TestMonitoringFreezePTYGuest$', '-test.v', '-test.count=5',
            '-test.timeout=60s'])

    def test_retained_roles_are_only_bounded_manifested_test_entries(self):
        for role in ('Agent', 'Watchdog'):
            self.assertEqual(guest.retained_role_override(role),
                '[Service]\nExecStart=\nExecStart=/run/ssh-exam-qualification-input/core-qualification.test '
                '-test.run=^TestRetainedPolicy' + role + 'Guest$ -test.timeout=12m\n'
                'Environment=EXAM_RETAINED_POLICY_GUEST=1\n')
        with self.assertRaisesRegex(AssertionError, 'Unknown private test role'):
            guest.retained_role_override('InstalledAgent')

    def test_public_release_selection_verifies_live_roles_without_test_override_or_service_actions(self):
        # Container/mount/role identities are mocked here; the guarded browser
        # qualification independently verifies their real kernel counterparts.
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            inputs, outputs = root/'input', root/'output'
            inputs.mkdir(); outputs.mkdir()
            (inputs/'run.json').write_text(json.dumps({'profile':'retained-policy','username':'examq',
                                                      'driver':'browser','release_native':True}))
            container, config, executable = root/'container', root/'config.json', root/'agent'
            container.write_text('systemd-nspawn\n'); config.write_text('{}'); executable.write_bytes(b'synthetic fixture')
            info = executable.stat()
            paths = {'/run/systemd/container':container, '/etc/exam-agent/agent.json':config,
                     '/usr/local/sbin/exam-agent':executable}
            health = {'native_roles':{'observation_only':True,'complete':True,'retained_enabled':True,
                                      'roles':['agent','watchdog'],'issues':[]}}
            def command(args, **kwargs):
                self.assertEqual(args,['examctl','health'], 'Release selection attempted a service/test-override action')
                return types.SimpleNamespace(stdout=json.dumps(health))
            roles = {name:{'retained_enabled':True,'exe':(info.st_dev,info.st_ino)} for name in ('agent','watchdog')}
            with mock.patch.object(guest,'INPUT',inputs), mock.patch.object(guest,'OUTPUT',outputs), \
                 mock.patch.object(guest,'Path',side_effect=lambda path:paths[path]), \
                 mock.patch.object(Path,'is_mount',autospec=True,side_effect=lambda path:path in (inputs,outputs)), \
                 mock.patch.object(guest,'native_role_snapshot',return_value=roles), \
                 mock.patch.object(guest.subprocess,'run',side_effect=command) as run:
                guest.prepare_retained_roles(qualify_roles=False)
                self.assertEqual(run.call_count,1)
                roles['watchdog']['retained_enabled']=False
                with self.assertRaises(AssertionError): guest.prepare_retained_roles(qualify_roles=False)
                self.assertEqual(run.call_count,1)

    def test_asyncio_profile_uses_a_manifested_unprivileged_fixture_and_bounded_test(self):
        self.assertEqual(overlay.FILES['asyncio-probe'], (None, 0o755))
        self.assertEqual(guest.monitoring_asyncio_command(), [
            '/run/ssh-exam-qualification-input/core-qualification.test',
            '-test.run=^TestMonitoringAsyncIOGuest$', '-test.v', '-test.count=3',
            '-test.timeout=120s'])

    def test_asyncio_stop_experiment_has_its_own_exact_opt_in_test(self):
        self.assertEqual(guest.monitoring_asyncio_stopped_command(), [
            '/run/ssh-exam-qualification-input/core-qualification.test',
            '-test.run=^TestMonitoringAsyncIOStoppedGuest$', '-test.v', '-test.count=3',
            '-test.timeout=120s'])

    def test_editor_experiment_is_separate_and_bounded(self):
        self.assertEqual(guest.monitoring_editor_command(), [
            '/run/ssh-exam-qualification-input/core-qualification.test',
            '-test.run=^TestMonitoringEditorGuest$', '-test.v', '-test.count=10',
            '-test.timeout=60s'])

    def test_catalog_profile_uses_actual_slice_and_manifested_test_only(self):
        self.assertEqual(overlay.FILES['exam-template.slice'], ('/etc/systemd/system/exam-template.slice', 0o644))
        self.assertEqual(guest.template_catalog_command(), [
            '/run/ssh-exam-qualification-input/core-qualification.test',
            '-test.run=^TestTemplateCatalogSystemManagerGuest$', '-test.v', '-test.count=1',
            '-test.timeout=240s'])

    def test_collection_pool_profile_is_scoped_bounded_and_repeated(self):
        self.assertEqual(guest.collection_pool_command(), [
            '/run/ssh-exam-qualification-input/core-qualification.test',
            '-test.run=^TestCollectionPoolReadinessGuest$', '-test.v', '-test.count=3',
            '-test.timeout=90s'])

    def test_thread_profile_has_a_manifested_unprivileged_fixture_and_bounded_test(self):
        self.assertEqual(overlay.FILES['thread-leader-probe'], (None, 0o755))
        self.assertEqual(guest.writer_threads_command(), [
            '/run/ssh-exam-qualification-input/core-qualification.test',
            '-test.run=^TestWriterThreadGroupGuest$', '-test.v', '-test.count=5',
            '-test.timeout=90s'])

    def test_dead_leader_foreground_tty_profile_is_separate_and_bounded(self):
        self.assertEqual(guest.monitoring_thread_tty_command(), [
            '/run/ssh-exam-qualification-input/core-qualification.test',
            '-test.run=^TestMonitoringThreadTTYGuest$', '-test.v', '-test.count=10',
            '-test.timeout=90s'])

    def test_actual_ssh_pane_ack_profile_is_separate_and_bounded(self):
        self.assertEqual(guest.pane_ack_command(), [
            '/run/ssh-exam-qualification-input/core-qualification.test',
            '-test.run=^TestPaneAcknowledgementGuest$', '-test.v', '-test.count=3',
            '-test.timeout=90s'])


if __name__ == '__main__':
    unittest.main()
