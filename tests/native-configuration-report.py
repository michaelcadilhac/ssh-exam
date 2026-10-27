#!/usr/bin/env python3
"""Public reconcile regression with synthetic state/keys and a local TLS receiver."""
import argparse
import base64
import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import ipaddress
import json
import os
from pathlib import Path
import shutil
import ssl
import subprocess
import tempfile
import threading
import time

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ed25519, rsa
from cryptography.x509.oid import NameOID

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--binary', required=True, type=Path)
parser.add_argument('--entry', required=True, choices=('agent', 'examctl'))
args = parser.parse_args()
binary = args.binary.resolve(strict=True)
assert binary.is_file() and os.access(binary, os.X_OK)
unshare = shutil.which('unshare')
assert unshare, 'The existing native-test user-namespace executable is required'

with tempfile.TemporaryDirectory(prefix='ssh-exam-configuration-report-') as directory:
    root = Path(directory)
    signing = ed25519.Ed25519PrivateKey.generate()
    (root / 'callback.key').write_bytes(signing.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    (root / 'gateway.pub').write_bytes(signing.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo))
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'synthetic-report')])
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (x509.CertificateBuilder().subject_name(subject).issuer_name(subject)
            .public_key(key.public_key()).serial_number(x509.random_serial_number())
            .not_valid_before(now - datetime.timedelta(minutes=1))
            .not_valid_after(now + datetime.timedelta(hours=1))
            .add_extension(x509.SubjectAlternativeName([
                x509.IPAddress(ipaddress.ip_address('127.0.0.1'))]), critical=False)
            .sign(key, hashes.SHA256()))
    (root / 'tls.pem').write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    (root / 'tls.key').write_bytes(key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    events, failures = [], []

    class Receiver(BaseHTTPRequestHandler):
        def do_POST(self):
            self.connection.settimeout(2)
            try:
                assert self.path == '/api/agent/events'
                assert self.headers['Content-Type'] == 'application/vnd.ssh-exam-event'
                length = int(self.headers['Content-Length'])
                assert 0 < length <= 1024 * 1024
                body = self.rfile.read(length)
                assert len(body) == length
                signing.public_key().verify(base64.b64decode(self.headers['X-Exam-Signature']), body)
                event = json.loads(body)
                assert event['agent'] == 'report-regression'
                assert isinstance(event['sequence'], int) and event['sequence'] > 0
                assert abs(time.time() * 1000 - event['at']) < 10000
                events.append(event)
                self.send_response(200)
            except BaseException as error:
                failures.append(type(error).__name__)
                self.send_response(400)
            self.send_header('Content-Length', '2')
            self.end_headers()
            self.wfile.write(b'{}')

        def log_message(self, *unused):
            pass

    server = ThreadingHTTPServer(('127.0.0.1', 0), Receiver)
    server.daemon_threads = True
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.minimum_version = ssl.TLSVersion.TLSv1_3
    context.load_cert_chain(root / 'tls.pem', root / 'tls.key')
    server.socket = context.wrap_socket(server.socket, server_side=True)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        for name in ('state', 'work', 'rootfs', 'templates', 'home'):
            (root / name).mkdir(mode=0o700)
        config = {'agent_id':'report-regression', 'state':str(root / 'state'),
                  'work':str(root / 'work'), 'rootfs':str(root / 'rootfs'),
                  'templates':str(root / 'templates'),
                  'accounts':{'synthetic-report':{'uid':10001, 'gid':10001,
                      'shell':'/bin/bash', 'home':str(root / 'home')}},
                  'socket':str(root / 'gate.sock'), 'guard_report':str(root / 'guards.json'),
                  'callback_key':str(root / 'callback.key'), 'gateway_public_key':str(root / 'gateway.pub'),
                  'callback_ca':str(root / 'tls.pem'),
                  'callback_url':f'https://127.0.0.1:{server.server_port}'}
        (root / 'guards.json').write_text('{}')
        (root / 'config.json').write_text(json.dumps(config))
        for path in root.iterdir():
            if path.is_file():
                path.chmod(0o600)
        command = ([str(binary), '-config', str(root / 'config.json'), '-reconcile']
                   if args.entry == 'agent' else
                   [str(binary), '--config', str(root / 'config.json'), 'reconcile'])
        # Map only this synthetic fixture's owning UID to root. No mount/network
        # namespace or production service/account/configuration is changed.
        result = subprocess.run([unshare, '--user', '--map-root-user', '--', *command],
                                capture_output=True, text=True, timeout=25)
        assert result.returncode == 0, result.stdout + result.stderr
        assert not failures, failures
        state = json.loads((root / 'state/state.json').read_text())
        assert state['attempts'] == {} and state['capabilities'] == {}
        if args.entry == 'agent':
            reports = [event for event in events if 'health' in event]
            assert len(reports) == 1, 'reconcile exited successfully without delivering a signed configuration snapshot'
            assert not state.get('events'), 'delivered configuration remains queued'
        else:
            assert json.loads(result.stdout) == {'ok':True}
            assert not events, 'offline CLI reconciliation must not require gateway delivery'
            reports = [event for event in state.get('events', []) if 'health' in event]
            assert len(reports) == 1, 'CLI reconcile did not durably queue a fresh configuration snapshot'
        health = reports[0]['health']
        assert reports[0]['accounts'] == {'synthetic-report':10001}
        assert health['ready'] is False and health['production_ready'] is False
        assert health['native_roles']['observation_only'] is True
        assert health['native_roles']['complete'] is False
        print(json.dumps({'entry':args.entry, 'status':'PASS', 'configuration_snapshots':1,
                          'signed_tls_delivery':args.entry == 'agent',
                          'offline_durable_queue':args.entry == 'examctl',
                          'unavailable_observation_never_permission':True,
                          'attempts_or_grants_created':0}))
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)
        assert not thread.is_alive()
assert not root.exists()
print('Owned receiver/process completed; synthetic state and keys removed')
