"""Private transport contracts; guarded root/browser proof is a separate run."""
import base64
import importlib.util
import io
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import threading
import time
import types
import tarfile
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location('browser_bridge', Path(__file__).with_name('browser_bridge.py'))
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class BrowserBridgeTests(unittest.TestCase):
    def test_snapshot_reobserves_retired_scope_without_publishing_partial_kernel_proof(self):
        attempt='11111111-1234-4234-8234-123456789abc'
        gone='exam-'+attempt+'-22222222-1234-4234-8234-123456789abc-aaaaaaaa-1234-4234-8234-123456789abc.scope'
        live='exam-'+attempt+'-33333333-1234-4234-8234-123456789abc-bbbbbbbb-1234-4234-8234-123456789abc.scope'
        a={'id':attempt,'exam':'native-browser','username':'examq','uid':20001,'state':'ACTIVE','terminal_supervised':True}
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/'live').mkdir()
            (root/'live/cgroup.events').write_text('populated 1\nfrozen 0\n')
            old={'attached_units':[gone,live],'attached_panes':2}
            current={'attached_units':[live],'attached_panes':1}
            def metadata(path,**kwargs):
                return {'attempts':{attempt:a}} if path.name=='state.json' else {'browser_students':1}
            with mock.patch.object(bridge,'private_json',side_effect=metadata), \
                 mock.patch.object(bridge.pwd,'getpwnam',return_value=types.SimpleNamespace(pw_uid=20001)), \
                 mock.patch.object(bridge,'scope_directory',side_effect=lambda _,unit:root/('gone' if unit==gone else 'live')), \
                 mock.patch.object(bridge,'root_command',side_effect=[json.dumps(old),json.dumps(current)]) as command:
                fixture=bridge.GuestBridge({'state':str(root),'work':str(root)})
                value=fixture.snapshot(attempt)
                self.assertEqual(command.call_count,2)
                self.assertEqual(value['supervisor']['attached_panes'],1)
                self.assertEqual(value['kernel'],[{'unit':live,'populated':'1','frozen':'0'}])
            with mock.patch.object(bridge,'private_json',side_effect=metadata), \
                 mock.patch.object(bridge.pwd,'getpwnam',return_value=types.SimpleNamespace(pw_uid=20001)), \
                 mock.patch.object(bridge,'scope_directory',return_value=root/'gone'), \
                 mock.patch.object(bridge,'root_command',return_value=json.dumps(old)) as command:
                fixture=bridge.GuestBridge({'state':str(root),'work':str(root)})
                with self.assertRaises(FileNotFoundError):fixture.snapshot(attempt)
                self.assertEqual(command.call_count,3,'Persistent unknown scope must refuse after a bounded fresh read')

    def test_inspection_key_error_returns_a_private_receipt_instead_of_empty_json(self):
        secret='PRIVATE-DICTIONARY-KEY-MUST-NOT-BE-RECORDED'
        def refuse(client): raise KeyError(secret)
        with tempfile.TemporaryDirectory() as directory, \
             mock.patch.object(bridge,'OUTPUT',Path(directory)), \
             mock.patch.object(bridge,'private_json',return_value={'attempts':{}}):
            fixture=bridge.GuestBridge({'state':'/unused-private-state'})
            worker=fixture.serve('inspect.sock',refuse)
            try:
                with socket.socket(socket.AF_UNIX) as client:
                    client.settimeout(1);client.connect(str(Path(directory)/'inspect.sock'))
                    with client.makefile('rb') as stream:
                        self.assertEqual(bridge.line(stream),{'bridge_error':'KeyError','stage':'inspect.sock'})
                receipt=Path(directory)/'inspect-refusal.json'
                raw=receipt.read_text()
                self.assertEqual(json.loads(raw)['error'],'KeyError')
                self.assertNotIn(secret,raw)
                self.assertEqual(receipt.stat().st_mode&0o777,0o600)
                self.assertEqual(receipt.stat().st_uid,os.geteuid())
            finally:
                fixture.done.set();worker.join(timeout=1);self.assertFalse(worker.is_alive())

    def test_c7_source_sync_reads_the_verified_public_cli_result_envelope(self):
        attempt='11111111-1234-4234-8234-123456789abc'
        grant='22222222-1234-4234-8234-123456789abc'
        a={'id':attempt,'username':'examq','uid':20001,'exam':'native-browser','state':'COMPLETED',
           'protected':True,'checksum':'f'*64,'start':1000,'deadline':5401000,'original_deadline':5401000,'grant':{'id':'initial'}}
        selected={'exam':'native-browser','username':'examq','revision':1,'settings':{'duration':1200},
                  'work':{'kind':'saved','attempt':attempt,'checksum':'f'*64}}
        # core.ManagementResult is the CLI output, not the signed HTTPS reply.
        reply={'request':'33333333-1234-4234-8234-123456789abc',
               'confirmed':True,'operation':'grants.show','result':selected}
        # This unit isolates the public CLI envelope, not root/filesystem proof.
        # Actual record creation/cancellation belongs to the guarded joined case.
        original=json.dumps({'exam':'native-browser','username':'examq','duration':3600}).encode()
        revoked={'disposition':'revoked','duration':3600,'source_attempt':attempt}
        cancel=('examctl','recovery-grants','revoke','native-browser','examq','--review','a'*64,'--reason','Reviewed synthetic cancellation')
        def result(*args):
            if args==('examctl','web','grants','show',grant):return json.dumps(reply)
            if args==cancel:return json.dumps(revoked)
            return '{}'
        with mock.patch.object(bridge,'private_json',return_value={'browser_students':1}) as private, \
             mock.patch.object(bridge,'root_command',side_effect=result) as command:
            fixture=bridge.GuestBridge({});fixture.snapshot=lambda _: {'attempt':a}
            fixture.recovery_source=attempt
            fixture.recovery_before={key:a[key] for key in ('start','deadline','original_deadline','grant','uid')}
            fixture.recovery_checksum='f'*64
            fixture.recovery_cancellation=dict(grant=grant,original=original,path=Path('/private/mock-legacy.json'),args=cancel)
            private.return_value={'purpose':'legacy-recovery-revoked/v1','original':base64.b64encode(original).decode()}
            synced=fixture.ssh_recovery({'attempt':attempt,'ssh_recovery':'source-sync','grant':grant})
            self.assertEqual(synced['legacy_revoked'],revoked)
            self.assertEqual(fixture.recovery_grant,grant)
            self.assertEqual(command.call_args_list,[
                mock.call('examctl','web','grants','show',grant),
                mock.call(*cancel),mock.call(*cancel),
                mock.call('examctl','web','grants','source-sync',grant,'--revision','1')])

    def test_c7_operator_refuses_unproven_loss_and_unsecured_release_before_public_cli(self):
        attempt='11111111-1234-4234-8234-123456789abc'
        owner={'attempt':attempt,'generation':0}
        a={'id':attempt,'username':'examq','uid':29979,'exam':'native-browser',
           'monitoring_mode':'v1','registered_owner':owner,'state':'LOCKED','grant':{'id':'initial'},
           'start':1000,'deadline':5401000,'original_deadline':5401000}
        with mock.patch.object(bridge,'private_json',return_value={'browser_students':1}), \
             mock.patch.object(bridge,'root_command') as command:
            fixture=bridge.GuestBridge({});fixture.snapshot=lambda _: {'attempt':a}
            request={'attempt':attempt,'ssh_recovery':'stop'}
            with self.assertRaises(AssertionError): fixture.ssh_recovery(request)
            command.assert_not_called()
            a['ssh_exited_owner']={**owner,'generation':1}
            with self.assertRaises(AssertionError): fixture.ssh_recovery(request)
            command.assert_not_called()
            a['ssh_exited_owner']=owner
            fixture.ssh_recovery(request)
            command.assert_called_once_with('examctl','stop',attempt,'--reason','Private C7 instructor explicitly secures abandoned SSH attempt')
            with self.assertRaises(AssertionError): fixture.ssh_recovery({'attempt':attempt,'ssh_recovery':'release'})
            a.update(state='COMPLETED',protected=True,checksum='f'*64)
            with self.assertRaises(AssertionError): fixture.ssh_recovery({'attempt':attempt,'ssh_recovery':'release'})
            self.assertEqual(command.call_count,1)

    def test_class_recovery_requires_exact_live_synthetic_fleet_before_transport_fault(self):
        ids = ['%08x-1234-4234-8234-123456789abc' % index for index in range(16)]
        snapshots = {attempt: {'attempt': {'username':name, 'state':'ACTIVE'},
                     'supervisor': {'ssh_peer':'pinned-live', 'attached_panes':4},
                     'kernel':[{'populated':'1', 'frozen':'0'} for _ in range(4)]}
                     for attempt,name in zip(ids,bridge.fixture_accounts(16))}
        def invoke(fixture, request):
            server,client=socket.socketpair()
            try:
                server.settimeout(1);client.settimeout(1)
                client.sendall((json.dumps(request)+'\n').encode())
                fixture.inspect(server)
                with client.makefile('rb') as stream: return bridge.line(stream)
            finally: server.close();client.close()
        with mock.patch.object(bridge,'private_json',return_value={'browser_students':16}), \
             mock.patch.object(bridge,'CoordinatorOutage') as outage:
            fixture=bridge.GuestBridge({});fixture.snapshot=lambda attempt:snapshots[attempt]
            outage.return_value.status.return_value={'phase':'offline'}
            # One incomplete physical scope refuses before creating any fault.
            snapshots[ids[0]]['kernel'].pop()
            with self.assertRaises(AssertionError): invoke(fixture,{'attempts':ids,'recovery':'start'})
            outage.assert_not_called()
            snapshots[ids[0]]['kernel'].append({'populated':'1','frozen':'0'})
            self.assertEqual(invoke(fixture,{'attempts':ids,'recovery':'start'}),{'phase':'offline'})
            outage.assert_called_once_with(seconds=35,all_proof_paths=True,transport_only=True,role_ready=None)
            self.assertEqual(invoke(fixture,{'attempts':list(reversed(ids)),'recovery':'status'}),{'phase':'offline'})
            with self.assertRaises(AssertionError): invoke(fixture,{'attempts':ids[:-1],'recovery':'status'})
            with self.assertRaises(AssertionError): invoke(fixture,{'attempts':ids,'recovery':'start'})
            outage.return_value.cancel.assert_not_called()

    def test_browser_finish_accepts_only_unchanged_clock_or_exact_authorized_reset_history(self):
        original = {'start':1000, 'original_deadline':5401000, 'deadline':5401000, 'access_state':'HELD'}
        bridge.verify_fixture_clock(original)
        reset = {'id':'11111111-1234-4234-8234-123456789abc', 'revision':1, 'actor':'instructor',
                 'remaining_seconds':5400, 'previous_deadline':5401000, 'requested_at':2000,
                 'applied_at':2002, 'deadline':5402000}
        current = {**original, 'deadline':5402000, 'clock_revision':1, 'clock_resets':[reset]}
        bridge.verify_fixture_clock(current)
        for change in ({'original_deadline':5402000}, {'access_state':'RELEASED'}, {'clock_revision':2},
                       {'deadline':5403000}, {'clock_resets':[]}, {'clock_resets':[reset,reset]}):
            with self.subTest(change=change), self.assertRaises(AssertionError):
                bridge.verify_fixture_clock({**current, **change})
        for change in ({'actor':'student'}, {'remaining_seconds':5401}, {'previous_deadline':5400000},
                       {'requested_at':5401000}, {'deadline':5403000}, {'revision':2}, {'extend_seconds':60}):
            with self.subTest(change=change), self.assertRaises(AssertionError):
                bridge.verify_fixture_clock({**current, 'clock_resets':[{**reset, **change}]})

    def test_proof_transport_outage_never_stops_or_restarts_owned_roles(self):
        with mock.patch.object(bridge, 'guest_identity'), \
             mock.patch.object(bridge.CoordinatorOutage, 'identity', side_effect=lambda unit, role: 101 if role == 'Agent' else 102), \
             mock.patch.object(bridge.CoordinatorOutage, 'restored_identity', side_effect=lambda unit, role: 101 if role == 'Agent' else 102), \
             mock.patch.object(bridge, 'root_command') as command:
            fault = bridge.CoordinatorOutage(seconds=.01, all_proof_paths=True, transport_only=True)
            fault.thread.join(timeout=1)
            self.assertFalse(fault.thread.is_alive())
            self.assertEqual(fault.status()['phase'], 'restored')
            self.assertEqual(fault.status()['after'], 101)
            self.assertEqual(fault.status()['watchdog_after'], 102)
            command.assert_not_called()

    def test_proof_transport_outage_is_an_explicit_503_before_gateway_dispatch(self):
        fixture = object.__new__(bridge.GuestBridge)
        fixture.coordinator_fault = types.SimpleNamespace(transport_only=True, status=lambda: {'phase':'offline'})
        fixture.requests = types.SimpleNamespace(put_nowait=mock.Mock(side_effect=AssertionError('Outage dispatched to gateway')))
        for path in ('monitoring-evidence', 'monitoring-continue', 'monitoring-technical'):
            server, client = socket.socketpair()
            try:
                server.settimeout(1); client.settimeout(1)
                client.sendall((json.dumps({'path':'/api/agent/'+path})+'\n').encode())
                fixture.http(server)
                with client.makefile('rb') as stream:
                    self.assertEqual(bridge.line(stream)['status'], 503)
            finally: server.close(); client.close()
        fixture.requests.put_nowait.assert_not_called()

    def test_class_listener_accept_backlog_holds_both_proof_bursts(self):
        with mock.patch.object(bridge, 'private_json', return_value={'browser_students':16}):
            fixture=bridge.GuestBridge({})
        entered,release=threading.Event(),threading.Event()
        real_accept=socket.socket.accept
        def paused_accept(server,*args,**kwargs):
            entered.set()
            if not release.wait(2): raise TimeoutError('Owned listener test did not release accept')
            return real_accept(server,*args,**kwargs)
        clients=[]
        with tempfile.TemporaryDirectory() as directory, \
             mock.patch.object(bridge,'OUTPUT',Path(directory)), \
             mock.patch.object(socket.socket,'accept',paused_accept):
            worker=fixture.serve('backlog.sock',lambda client:None)
            try:
                self.assertTrue(entered.wait(1))
                path=Path(directory)/'backlog.sock'
                self.assertTrue(path.is_socket())
                self.assertEqual(path.stat().st_mode&0o777,0o600)
                self.assertEqual(path.stat().st_uid,os.geteuid())
                # Keep the acceptor at a known boundary: all32 connections must
                # fit the REAL kernel backlog before any userspace dispatch.
                for _ in range(32):
                    client=socket.socket(socket.AF_UNIX);client.settimeout(.1)
                    clients.append(client);client.connect(str(path))
                self.assertEqual(len(clients),32)
            finally:
                fixture.done.set();release.set()
                for client in clients:client.close()
                worker.join(timeout=1);self.assertFalse(worker.is_alive())

    def test_class_relay_preserves_both_sixteen_owner_proof_bursts_before_dispatch(self):
        # Only guest startup metadata is synthetic.32 simultaneous actual Unix
        # requests must survive before dispatch; the former16-entry queue fails
        # at this boundary instead of silently becoming an authentication error.
        with mock.patch.object(bridge, 'private_json', return_value={'browser_students':16}):
            fixture=bridge.GuestBridge({})
        clients, workers, errors = [], [], []
        def serve(server, handler):
            try: handler(server)
            except Exception as error: errors.append(error)
            finally: server.close()
        try:
            for index in range(32):
                server,client=socket.socketpair();server.settimeout(1);client.settimeout(1)
                clients.append((client,index))
                bridge.send(client.makefile('wb',buffering=0), {'path':'/api/agent/monitoring-evidence',
                    'headers':{'X-Exam-Signature':'original-'+str(index)},
                    'body':base64.b64encode(('signed-'+str(index)).encode()).decode()})
                worker=threading.Thread(target=serve,args=(server,fixture.http));worker.start();workers.append(worker)
            until=time.monotonic()+1
            while fixture.requests.qsize()!=32 and not errors and time.monotonic()<until: time.sleep(.005)
            self.assertEqual(fixture.requests.qsize(),32)
            self.assertFalse(errors)
            server,peer=socket.socketpair();server.settimeout(1);peer.settimeout(1)
            worker=threading.Thread(target=serve,args=(server,fixture.gateway));worker.start();workers.append(worker)
            with peer,peer.makefile('rwb',buffering=0) as stream:
                for _ in range(32):
                    request=bridge.line(stream)
                    index=int(request['headers']['X-Exam-Signature'].removeprefix('original-'))
                    self.assertEqual(base64.b64decode(request['body']),('signed-'+str(index)).encode())
                    bridge.send(stream,{'status':200,'body':request['body']})
            for client,index in clients:
                with client.makefile('rb') as stream:
                    response=bridge.line(stream)
                    self.assertEqual(response,{'status':200,'body':base64.b64encode(('signed-'+str(index)).encode()).decode()})
            self.assertEqual(fixture.evidence_replies,32)
            self.assertFalse(errors)
        finally:
            fixture.done.set()
            while not fixture.requests.empty():
                _,completed,result=fixture.requests.get_nowait()
                result['reply']={'status':503,'body':''};completed.set()
            for client,_ in clients: client.close()
            for worker in workers:
                worker.join(timeout=5);self.assertFalse(worker.is_alive())

    def test_mutable_snapshot_retries_actual_unlinked_inode_without_relaxing_sealed_reads(self):
        real_open, real_fstat = os.open, os.fstat
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'state.json'
            replacement = Path(directory)/'next.json'
            for mutable in (False, True):
                path.write_text('{"revision":1}'); replacement.write_text('{"revision":2}')
                opened, links = [], []
                def replacing_open(name, *args, **kwargs):
                    fd = real_open(name, *args, **kwargs)
                    opened.append(fd)
                    if len(opened) == 1: os.replace(replacement, path)
                    return fd
                def root_stat(fd):
                    info = real_fstat(fd); links.append(info.st_nlink)
                    # Only root ownership is synthetic; open/replace/unlink,
                    # link counts, descriptor lifetime and JSON are actual.
                    return types.SimpleNamespace(st_mode=info.st_mode, st_uid=0,
                                                 st_nlink=info.st_nlink, st_size=info.st_size)
                with mock.patch.object(bridge.os, 'open', side_effect=replacing_open), \
                     mock.patch.object(bridge.os, 'fstat', side_effect=root_stat):
                    if mutable:
                        self.assertEqual(bridge.private_json(path, atomic_snapshot=True), {'revision': 2})
                        self.assertEqual(links, [0, 1])
                    else:
                        with self.assertRaises(AssertionError): bridge.private_json(path)
                        self.assertEqual(links, [0])
                for fd in opened:
                    with self.assertRaises(OSError): real_fstat(fd)

    def test_mutable_snapshot_refuses_continuous_replacement_and_hard_links(self):
        real_open, real_fstat = os.open, os.fstat
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'state.json'; path.write_text('{}')
            replacement = Path(directory)/'next.json'
            opened = []
            def changing_open(name, *args, **kwargs):
                fd = real_open(name, *args, **kwargs); opened.append(fd)
                replacement.write_text('{}'); os.replace(replacement, path)
                return fd
            def root_stat(fd):
                info = real_fstat(fd)
                return types.SimpleNamespace(st_mode=info.st_mode, st_uid=0,
                                             st_nlink=info.st_nlink, st_size=info.st_size)
            with mock.patch.object(bridge.os, 'open', side_effect=changing_open), \
                 mock.patch.object(bridge.os, 'fstat', side_effect=root_stat):
                with self.assertRaisesRegex(RuntimeError, 'kept changing'):
                    bridge.private_json(path, atomic_snapshot=True)
            self.assertEqual(len(opened), 3)
            for fd in opened:
                with self.assertRaises(OSError): real_fstat(fd)
            os.link(path, Path(directory)/'hard-link')
            with mock.patch.object(bridge.os, 'fstat', side_effect=root_stat):
                with self.assertRaises(AssertionError): bridge.private_json(path, atomic_snapshot=True)

    def test_inspection_refusal_persists_code_boundary_without_secrets_or_unrelated_history(self):
        fixture = object.__new__(bridge.GuestBridge)
        fixture.done = threading.Event(); fixture.slots = threading.BoundedSemaphore(1)
        fixture.students = 1
        fixture.config = {'state': '/private-unused-state'}
        fixture.inspection_context = threading.local()
        secret = 'DO-NOT-RECORD-PRIVATE-EXCEPTION-OR-ACCOUNT'
        def refuse(client): raise AssertionError(secret)
        state = {'attempts': {'owned': {'exam': 'native-browser', 'state': 'ACTIVE'},
                              'other': {'exam': secret, 'state': 'LOCKED'}}}
        with tempfile.TemporaryDirectory() as directory, \
             mock.patch.object(bridge, 'OUTPUT', Path(directory)), \
             mock.patch.object(bridge, 'private_json', return_value=state):
            worker = fixture.serve('inspect.sock', refuse)
            try:
                with socket.socket(socket.AF_UNIX) as client:
                    client.settimeout(1); client.connect(str(Path(directory)/'inspect.sock'))
                    with client.makefile('rb') as stream:
                        self.assertEqual(bridge.line(stream), {'bridge_error': 'AssertionError', 'stage': 'inspect.sock'})
                path = Path(directory)/'inspect-refusal.json'
                raw = path.read_text(); record = json.loads(raw)
                self.assertNotIn(secret, raw)
                self.assertEqual(record['synthetic_states'], {'PREPARING': 0, 'ACTIVE': 1, 'LOCKED': 0})
                self.assertIn('refuse', record['trace'])
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)
                self.assertEqual(path.stat().st_uid, os.geteuid())
            finally:
                fixture.done.set(); worker.join(timeout=1)
                self.assertFalse(worker.is_alive())

    def test_restored_role_waits_for_actual_exec_but_never_hides_a_crash_restart(self):
        with mock.patch.object(bridge.CoordinatorOutage, 'identity', side_effect=[AssertionError('pre-exec'), 303]) as identity, \
             mock.patch.object(bridge, 'root_command', return_value='0'):
            self.assertEqual(bridge.CoordinatorOutage.restored_identity('exam-agent.service', 'Agent'), 303)
            self.assertEqual(identity.call_count, 2)
        with mock.patch.object(bridge.CoordinatorOutage, 'identity', return_value=303), \
             mock.patch.object(bridge, 'root_command', return_value='1'):
            with self.assertRaisesRegex(AssertionError, 'crashed/restarted'):
                bridge.CoordinatorOutage.restored_identity('exam-agent.service', 'Agent')

    def test_restored_coordinator_requires_fresh_operational_role_protocol_before_reporting_restored(self):
        reached,released=threading.Event(),threading.Event()
        def ready():
            reached.set()
            self.assertTrue(released.wait(1),'Owned readiness gate was not released')
            return {'agent':{'pid':303},'watchdog':{'pid':202}}
        with mock.patch.object(bridge,'guest_identity'), \
             mock.patch.object(bridge.CoordinatorOutage,'identity',side_effect=[101,202,202]), \
             mock.patch.object(bridge.CoordinatorOutage,'restored_identity',side_effect=[303,202]), \
             mock.patch.object(bridge,'root_command',return_value='0'):
            fault=bridge.CoordinatorOutage(.01,role_ready=ready)
            try:
                self.assertTrue(reached.wait(1),'Fixture never reached operational role boundary')
                self.assertEqual(fault.status()['phase'],'offline')
                self.assertIsNone(fault.status()['after'])
            finally:
                released.set();fault.cancel()
            self.assertEqual(fault.status()['phase'],'restored')

    def test_public_role_fault_selector_requires_exact_installed_inode_arguments_and_scope(self):
        # Only this selector unit mocks root ownership; actual root failure runs
        # use the guest's real /proc and systemd MainPID without these substitutes.
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); process=root/'proc/101'; process.mkdir(parents=True)
            installed=root/'agent'; installed.write_bytes(b'private synthetic executable')
            (process/'exe').symlink_to(installed)
            (process/'cmdline').write_bytes(b'/usr/local/sbin/exam-agent\0-config\0/etc/exam-agent/agent.json\0')
            (process/'cgroup').write_text('0::/system.slice/exam-agent.service\n')
            original_stat=Path.stat
            def owned(path,*args,**kwargs):
                if path==process: return types.SimpleNamespace(st_uid=0)
                return original_stat(path,*args,**kwargs)
            def paths(path):
                return {'/proc':root/'proc','/usr/local/sbin/exam-agent':installed}.get(str(path),Path(path))
            with mock.patch.object(bridge,'Path',side_effect=paths), \
                 mock.patch.object(Path,'stat',owned), \
                 mock.patch.object(bridge,'private_json',return_value={'release_native':True}), \
                 mock.patch.object(bridge,'root_command',return_value='101\n') as command:
                self.assertEqual(bridge.CoordinatorOutage.identity('exam-agent.service','Agent'),101)
                (process/'cmdline').write_bytes(b'/usr/local/sbin/exam-agent\0-config\0/etc/exam-agent/agent.json\0-watchdog\0')
                with self.assertRaisesRegex(AssertionError,'arguments'): bridge.CoordinatorOutage.identity('exam-agent.service','Agent')
                (process/'cmdline').write_bytes(b'/usr/local/sbin/exam-agent\0-config\0/etc/exam-agent/agent.json\0')
                (process/'cgroup').write_text('0::/unrelated.slice/exam-agent.service\n')
                with self.assertRaisesRegex(AssertionError,'cgroup'): bridge.CoordinatorOutage.identity('exam-agent.service','Agent')
                (process/'cgroup').write_text('0::/system.slice/exam-agent.service\n')
                other=root/'different-agent';other.write_bytes(installed.read_bytes())
                (process/'exe').unlink();(process/'exe').symlink_to(other)
                with self.assertRaisesRegex(AssertionError,'executable'): bridge.CoordinatorOutage.identity('exam-agent.service','Agent')
                self.assertTrue(all(call.args==('systemctl','show','exam-agent.service','--property=MainPID','--value') for call in command.call_args_list))

    def test_coordinator_outage_restores_only_owned_role_and_preserves_watchdog(self):
        with mock.patch.object(bridge, 'guest_identity'), \
             mock.patch.object(bridge.CoordinatorOutage, 'identity', side_effect=[101, 202, 202, 303, 202]), \
             mock.patch.object(bridge, 'root_command', side_effect=['', '0', '', '0', '0']) as command:
            fault = bridge.CoordinatorOutage(.02)
            fault.thread.join(timeout=1)
            self.assertFalse(fault.thread.is_alive())
            self.assertEqual(fault.status(), {'phase': 'restored', 'before': 101, 'after': 303, 'watchdog': 202, 'watchdog_after': 202, 'all_proof_paths': False, 'error': None})
            self.assertEqual(command.call_args_list, [mock.call('systemctl', 'stop', 'exam-agent.service'),
                mock.call('systemctl', 'show', 'exam-agent.service', '--property=MainPID', '--value'),
                mock.call('systemctl', 'start', 'exam-agent.service'),
                mock.call('systemctl', 'show', 'exam-agent.service', '--property=NRestarts', '--value'),
                mock.call('systemctl', 'show', 'exam-deadline-watchdog.service', '--property=NRestarts', '--value')])
            fault.cancel()

    def test_all_proof_path_fault_observes_both_stopped_and_restores_watchdog_first(self):
        with mock.patch.object(bridge, 'guest_identity'), \
             mock.patch.object(bridge.CoordinatorOutage, 'identity', side_effect=[101, 202, 303, 404]), \
             mock.patch.object(bridge, 'root_command', side_effect=['', '0', '0', '', '', '0', '0']) as command:
            fault = bridge.CoordinatorOutage(.02, all_proof_paths=True)
            fault.thread.join(timeout=1)
            self.assertFalse(fault.thread.is_alive())
            self.assertEqual(fault.status(), {'phase': 'restored', 'before': 101, 'after': 303, 'watchdog': 202, 'watchdog_after': 404, 'all_proof_paths': True, 'error': None})
            self.assertEqual(command.call_args_list, [
                mock.call('systemctl', 'stop', 'exam-agent.service', 'exam-deadline-watchdog.service'),
                mock.call('systemctl', 'show', 'exam-agent.service', '--property=MainPID', '--value'),
                mock.call('systemctl', 'show', 'exam-deadline-watchdog.service', '--property=MainPID', '--value'),
                mock.call('systemctl', 'start', 'exam-deadline-watchdog.service'),
                mock.call('systemctl', 'start', 'exam-agent.service'),
                mock.call('systemctl', 'show', 'exam-agent.service', '--property=NRestarts', '--value'),
                mock.call('systemctl', 'show', 'exam-deadline-watchdog.service', '--property=NRestarts', '--value')])
            fault.cancel()

    def test_coordinator_stop_failure_still_restores_and_remains_a_failure(self):
        with mock.patch.object(bridge, 'guest_identity'), \
             mock.patch.object(bridge.CoordinatorOutage, 'identity', side_effect=[101, 202, 303, 202]), \
             mock.patch.object(bridge, 'root_command', side_effect=[subprocess.CalledProcessError(1, 'owned stop'), '', '0', '0']) as command:
            fault = bridge.CoordinatorOutage(.02)
            fault.thread.join(timeout=1)
            self.assertFalse(fault.thread.is_alive())
            self.assertEqual(fault.status()['phase'], 'failed')
            self.assertEqual(fault.status()['after'], 303)
            self.assertIn(mock.call('systemctl', 'start', 'exam-agent.service'), command.call_args_list)
            with self.assertRaisesRegex(AssertionError, 'restore failed'): fault.cancel()

    def test_coordinator_outage_never_stops_an_unqualified_role(self):
        with mock.patch.object(bridge, 'guest_identity'), \
             mock.patch.object(bridge.CoordinatorOutage, 'identity', side_effect=AssertionError('wrong executable')), \
             mock.patch.object(bridge, 'root_command') as command:
            with self.assertRaisesRegex(AssertionError, 'wrong executable'): bridge.CoordinatorOutage(.02)
            command.assert_not_called()

    def test_abort_always_completes_even_when_owned_gate_restore_refuses(self):
        fixture = object.__new__(bridge.GuestBridge)
        fixture.coordinator_fault = None
        fixture.gate_fault = types.SimpleNamespace(cancel=mock.Mock(side_effect=AssertionError('changed socket')))
        fixture.failures = []; fixture.done = threading.Event()
        server, client = socket.socketpair()
        try:
            server.settimeout(1); client.settimeout(1)
            client.sendall(b'{"abort":true}\n')
            fixture.inspect(server)
            self.assertTrue(fixture.done.is_set())
            with client.makefile('rb') as stream: self.assertEqual(bridge.line(stream), {'aborted': True})
            self.assertEqual(fixture.failures, ['Private gate restoration failed; preserve exact sockets', 'Local browser test aborted'])
        finally: server.close(); client.close()

    def test_gate_stall_accepts_actual_request_without_reply_and_restores_original_listener(self):
        with tempfile.TemporaryDirectory() as directory, socket.socket(socket.AF_UNIX) as original:
            path = Path(directory) / 'gate.sock'
            original.bind(str(path)); original.listen(1); original.settimeout(1); path.chmod(0o600)
            identity = (path.stat().st_dev, path.stat().st_ino)
            fault = bridge.GateStall(path, .5)
            try:
                with socket.socket(socket.AF_UNIX) as client:
                    client.settimeout(.05); client.connect(str(path)); client.sendall(b'{"signed":"original"}\n')
                    until = time.monotonic() + 1
                    while not fault.status()['accepted'] and time.monotonic() < until: time.sleep(.005)
                    self.assertEqual(fault.status()['accepted'], 1)
                    with self.assertRaises(socket.timeout): client.recv(1)
                fault.thread.join(timeout=2)
                self.assertEqual(fault.status()['phase'], 'restored')
                self.assertEqual((path.stat().st_dev, path.stat().st_ino), identity)
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)
                with socket.socket(socket.AF_UNIX) as client:
                    client.settimeout(1); client.connect(str(path)); client.sendall(b'after-stall')
                    peer, _ = original.accept()
                    with peer:
                        peer.settimeout(1); self.assertEqual(peer.recv(32), b'after-stall')
            finally: fault.cancel()

    def test_gate_cancel_is_bounded_and_does_not_replace_a_changed_socket(self):
        with tempfile.TemporaryDirectory() as directory, socket.socket(socket.AF_UNIX) as original:
            path = Path(directory) / 'gate.sock'
            original.bind(str(path)); original.listen(1)
            fault = bridge.GateStall(path, 10)
            fault.cancel(); self.assertEqual(fault.status()['phase'], 'restored')
            fault = bridge.GateStall(path, 10)
            path.unlink()
            with socket.socket(socket.AF_UNIX) as replacement:
                replacement.bind(str(path)); replacement.listen(1)
                identity = (path.stat().st_dev, path.stat().st_ino)
                with self.assertRaisesRegex(AssertionError, 'restore failed'): fault.cancel()
                self.assertEqual(fault.status()['phase'], 'failed')
                self.assertEqual((path.stat().st_dev, path.stat().st_ino), identity)
                self.assertTrue(fault.held.exists())

    def test_observer_checks_nested_kernel_pool_against_systemd_and_all_resource_bounds(self):
        attempt = 'aaaaaaaa-1234-4234-8234-123456789abc'
        unit = 'exam-collection-' + attempt + '-123456abcdef.service'
        pool_name = '/exam.slice/exam-collection.slice'
        fixture = object.__new__(bridge.GuestBridge)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); process = root / 'process'; process.mkdir()
            (process / 'cmdline').write_bytes(b'/private/core-qualification.test\0--collection-worker\0')
            (process / 'cgroup').write_text('0::' + pool_name + '/' + unit + '\n')
            for name in ('fd', 'fdinfo'): (process / name).mkdir()
            fixture.config = {'state': str(root / 'state')}
            archive = root / 'state/submissions' / ('.' + attempt + '.collect-123') / 'submission.tar.gz'
            archive.parent.mkdir(parents=True); archive.write_bytes(b'writing')
            (process / 'fd/7').symlink_to(archive)
            (process / 'fdinfo/7').write_text('flags:\t0100001\n')
            pool = root / 'kernel'; (pool / unit).mkdir(parents=True)
            for target, memory, tasks in ((pool, 512, 96), (pool / unit, 256, 32)):
                (target / 'memory.max').write_text(str(memory * 1024**2))
                (target / 'memory.swap.max').write_text('0')
                (target / 'pids.max').write_text(str(tasks))
            class Process:
                name = '987654'
                def stat(self): return types.SimpleNamespace(st_uid=0)
                def __truediv__(self, name): return process / name
            def path(value):
                if value == '/proc': return types.SimpleNamespace(iterdir=lambda: iter([Process()]))
                if value == '/sys/fs/cgroup' + pool_name: return pool
                return Path(value)
            real_lstat = os.lstat
            owner = 0
            def lstat(value, *args, **kwargs):
                result = real_lstat(value, *args, **kwargs)
                if Path(value) == archive:
                    values = list(result); values[4] = owner; return os.stat_result(values)
                return result
            with mock.patch.object(bridge, 'Path', side_effect=path), mock.patch.object(bridge.os, 'lstat', side_effect=lstat), mock.patch.object(bridge, 'root_command', return_value=pool_name + '\n') as command:
                self.assertEqual(fixture.collectors([attempt]), [{'attempt': attempt, 'unit': unit, 'pid': 987654, 'writing': True}])
                command.assert_called_once_with('systemctl', 'show', 'exam-collection.slice', '--property=ControlGroup', '--value')
                owner = 2000
                self.assertFalse(fixture.collectors([attempt])[0]['writing'])
                owner = 0
                command.return_value = '/wrong/exam-collection.slice'
                with self.assertRaises(AssertionError): fixture.collectors([attempt])
                command.return_value = pool_name
                (pool / 'memory.swap.max').write_text('1')
                with self.assertRaises(AssertionError): fixture.collectors([attempt])

    def test_observer_waits_for_real_collectors_before_reading_lazy_pool_cgroup(self):
        fixture = object.__new__(bridge.GuestBridge)
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); processes = root / 'proc'; processes.mkdir()
            def path(value):
                if value == '/proc': return processes
                if value == '/sys/fs/cgroup/exam-collection.slice': return root / 'not-created-yet'
                return Path(value)
            with mock.patch.object(bridge, 'Path', side_effect=path):
                self.assertEqual(fixture.collectors(['aaaaaaaa-1234-4234-8234-123456789abc']), [])

    def test_worker_fault_refuses_unqualified_active_protected_or_nonwriting_targets_before_signal(self):
        fixture = object.__new__(bridge.GuestBridge)
        fixture.large = True; fixture.students = 16; fixture.collection_operation = None
        ids = ['aaaaaaaa-1234-4234-8234-123456789abc', 'bbbbbbbb-1234-4234-8234-123456789abc']
        for state, protected, writing in (('ACTIVE', False, True), ('FINALIZING', True, True), ('FINALIZING', False, False)):
            with self.subTest(state=state, protected=protected, writing=writing):
                fixture.snapshot = lambda attempt: {'attempt': {'username': 'examq' if attempt == ids[0] else 'examq01', 'state': state, 'protected': protected}}
                fixture.collectors = lambda attempts: [{'attempt': attempt, 'pid': 123, 'unit': 'fixture', 'writing': writing} for attempt in attempts]
                with mock.patch.object(bridge.os, 'pidfd_open') as pin, mock.patch.object(bridge.signal, 'pidfd_send_signal') as send:
                    with self.assertRaises(AssertionError): fixture.collection({'action': 'kill', 'attempts': ids})
                    pin.assert_not_called(); send.assert_not_called()
        fixture.large = False
        with mock.patch.object(fixture, 'snapshot') as snapshot, self.assertRaises(AssertionError):
            fixture.collection({'action': 'kill', 'attempts': ids})
        snapshot.assert_not_called()

    def test_large_export_stream_compares_all_bytes_and_refuses_wrong_missing_linked_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); work = root / 'work'; work.mkdir()
            path = root / 'export.tar.gz'
            for n in range(4): (work / ('large-%d.bin' % n)).write_bytes(b'abc')
            def write(missing=False, wrong=False, linked=False):
                with tarfile.open(path, 'w:gz') as archive:
                    for n in range(3 if missing else 4):
                        value = b'xyz' if wrong and n == 1 else b'abc'
                        header = tarfile.TarInfo('large-%d.bin' % n); header.size = len(value)
                        if linked and n == 1: header.type = tarfile.SYMTYPE; header.linkname = '/other'; header.size = 0
                        archive.addfile(header, io.BytesIO(value))
            write()
            self.assertEqual(bridge.verify_large_fixture_archive(path, work, 3), ['large-%d.bin' % n for n in range(4)])
            for missing, wrong, linked in ((True, False, False), (False, True, False), (False, False, True)):
                write(missing, wrong, linked)
                with self.subTest(missing=missing, wrong=wrong, linked=linked), self.assertRaises(AssertionError):
                    bridge.verify_large_fixture_archive(path, work, 3)

    def test_capacity_account_names_are_finite_synthetic_and_never_arbitrary(self):
        self.assertEqual(bridge.fixture_accounts(1), ['examq'])
        names = bridge.fixture_accounts(16)
        self.assertEqual(len(names), 16)
        self.assertEqual(len(set(names)), 16)
        self.assertEqual(names[0], 'examq')
        self.assertEqual(names[-1], 'examq15')
        for count in (0, 2, 17):
            with self.subTest(count=count), self.assertRaises(AssertionError):
                bridge.fixture_accounts(count)

    def test_export_checks_exact_saved_work_and_rejects_missing_or_linked_proofs(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'submission.tar.gz'
            def write(editor=b'UNSAVED-native-editor\n', linked=False):
                with tarfile.open(path, 'w:gz') as archive:
                    for name, value in (('browser-proof.txt', b'SAVED-actual-native-END\n'), ('browser-editor.txt', editor)):
                        if value is None: continue
                        header = tarfile.TarInfo(name); header.size = len(value)
                        if linked and name == 'browser-editor.txt':
                            header.type = tarfile.SYMTYPE; header.linkname = '/other'; header.size = 0
                        archive.addfile(header, io.BytesIO(value))
            write()
            self.assertEqual(bridge.verify_fixture_archive(path), ['browser-editor.txt', 'browser-proof.txt'])
            for editor, linked in ((None, False), (b'other\n', False), (b'UNSAVED-native-editor\n', True)):
                write(editor, linked)
                with self.subTest(editor=editor, linked=linked), self.assertRaises(AssertionError):
                    bridge.verify_fixture_archive(path)

    def test_optimized_python_refuses_before_any_host_access(self):
        result = subprocess.run([sys.executable, '-O', str(Path(bridge.__file__)), '--host',
                                 '/var/tmp/ssh-exam-overlay-probe', 'metadata'],
                                capture_output=True, text=True, timeout=3)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Qualification safety checks require Python without -O', result.stderr)

    def test_kernel_observation_accepts_the_real_gate_scope_and_refuses_other_owners(self):
        attempt = 'aaaaaaaa-1234-4234-8234-123456789abc'
        pane = 'bbbbbbbb-1234-4234-8234-123456789abc'
        incarnation = 'cccccccc-1234-4234-8234-123456789abc'
        unit = 'exam-' + attempt + '-' + pane + '-' + incarnation + '.scope'
        self.assertEqual(bridge.scope_directory(attempt, unit), Path('/sys/fs/cgroup/exam.slice') / unit)
        for bad in (unit.replace(attempt, pane), unit + '/../other', 'exam-' + attempt + '-' + 'a'*32 + '.scope'):
            with self.subTest(unit=bad), self.assertRaises(AssertionError):
                bridge.scope_directory(attempt, bad)

    def test_frames_refuse_truncation_and_oversize(self):
        for raw in (b'', b'{}', b'x' * (bridge.MAX_FRAME + 1) + b'\n'):
            with self.subTest(length=len(raw)), self.assertRaises(RuntimeError):
                bridge.line(io.BytesIO(raw))
        output = io.BytesIO()
        bridge.send(output, {'native': '\u03bb', 'unchanged': True})
        output.seek(0)
        self.assertEqual(bridge.line(output), {'native': '\u03bb', 'unchanged': True})

    def test_host_refuses_nonqualification_paths_before_command_or_socket(self):
        with mock.patch.object(bridge.os, 'getuid', return_value=0), mock.patch.object(bridge.os, 'geteuid', return_value=0), mock.patch.object(bridge, 'root_command') as command:
            for target in ('/', '/etc/exam-agent', '/var/tmp/ssh-exam-overlay-test/../other'):
                with self.subTest(target=target), self.assertRaises(AssertionError):
                    bridge.host_bridge(Path(target), 'ssh')
            command.assert_not_called()

    def test_http_bridge_preserves_original_signed_bytes_and_refusal_status(self):
        # Only the root guest guard is mocked; this crosses a real owned Unix
        # listener and independently bounded connect/accept/read/reply waits.
        raw = b'{ "agent": "synthetic", "signed": "original bytes" }'
        for transport_refusal in (False, True):
            seen, failures = [], []
            with self.subTest(transport_refusal=transport_refusal), tempfile.TemporaryDirectory() as directory:
                with socket.socket(socket.AF_UNIX) as server:
                    server.bind(directory + '/http.sock')
                    server.listen(1)
                    server.settimeout(2)
                    def peer():
                        try:
                            client, _ = server.accept()
                            with client:
                                client.settimeout(2)
                                with client.makefile('rwb', buffering=0) as stream:
                                    seen.append(bridge.line(stream))
                                    bridge.send(stream, {'bridge_error':'Full','stage':'http.sock'} if transport_refusal else
                                                {'status': 409, 'body': base64.b64encode(b'{"error":"refused"}').decode()})
                        except Exception as error:
                            failures.append(error)
                    thread = threading.Thread(target=peer, daemon=True)
                    thread.start()
                    with mock.patch.object(bridge, 'guest_identity'), mock.patch.object(bridge, 'OUTPUT', Path(directory)):
                        if transport_refusal:
                            with self.assertRaisesRegex(RuntimeError,'transport refused'):
                                bridge.forward_http('/api/agent/monitoring-evidence', {'X-Exam-Signature': 'unchanged'}, raw)
                        else:
                            result = bridge.forward_http('/api/agent/monitoring-evidence', {'X-Exam-Signature': 'unchanged'}, raw)
                            self.assertEqual(result, (409, b'{"error":"refused"}'))
                    thread.join(3)
                    self.assertFalse(thread.is_alive())
                    self.assertFalse(failures)
                    self.assertEqual(seen, [{'path': '/api/agent/monitoring-evidence', 'headers': {'X-Exam-Signature': 'unchanged'}, 'body': base64.b64encode(raw).decode()}])


if __name__ == '__main__':
    unittest.main()
