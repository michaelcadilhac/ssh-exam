#!/usr/bin/env python3
"""Exercise staged rollout nginx configs locally; never contacts production."""
import argparse
import datetime
import hashlib
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import ipaddress
import json
from pathlib import Path
import re
import shutil
import socket
import ssl
import subprocess
import tempfile
import threading
import time

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--candidates', required=True, type=Path)
args = parser.parse_args()
nginx = shutil.which('nginx')
assert nginx, 'Use the already-installed nginx executable'
names = ('nginx-01-fenced-legacy.conf', 'nginx-02-fenced-release.conf', 'nginx-03-release.conf')
manifest = json.loads((args.candidates / 'candidate-manifest.json').read_text())
for name in names:
    assert hashlib.sha256((args.candidates / name).read_bytes()).hexdigest() == manifest['files'][name]


class Upstream(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def do_GET(self):
        self.reply()

    def do_POST(self):
        self.reply()

    def reply(self):
        upgrade = self.headers.get('Upgrade', '').lower() == 'websocket'
        body = (self.command + ' ' + self.path).encode()
        self.send_response(101 if upgrade else 200)
        self.send_header('X-Synthetic-Upstream', '1')
        if upgrade:
            self.send_header('Upgrade', 'websocket')
            self.send_header('Connection', 'Upgrade')
        else:
            self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        if not upgrade:
            self.wfile.write(body)
        self.close_connection = True

    def log_message(self, *unused):
        pass


def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


with tempfile.TemporaryDirectory(prefix='ssh-exam-nginx-rollout-') as directory:
    root = Path(directory)
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'synthetic-rollout')])
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name)
            .public_key(key.public_key()).serial_number(x509.random_serial_number())
            .not_valid_before(now - datetime.timedelta(minutes=1))
            .not_valid_after(now + datetime.timedelta(hours=1))
            .add_extension(x509.SubjectAlternativeName([
                x509.IPAddress(ipaddress.ip_address('127.0.0.1'))]), critical=False)
            .sign(key, hashes.SHA256()))
    (root / 'cert.pem').write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    (root / 'key.pem').write_bytes(key.private_bytes(serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    (root / 'key.pem').chmod(0o600)
    context = ssl.create_default_context(cafile=str(root / 'cert.pem'))
    upstream = ThreadingHTTPServer(('127.0.0.1', 0), Upstream)
    upstream.daemon_threads = True
    thread = threading.Thread(target=upstream.serve_forever, daemon=True)
    thread.start()
    try:
        for filename in names:
            fenced = filename != names[-1]
            plain, secure = free_port(), free_port()
            while secure == plain:
                secure = free_port()
            text = (args.candidates / filename).read_text()
            # Adapt only endpoints, logs and certificates, not maps/locations.
            text = re.sub(r'^\s*listen \[::\]:[^;]+;\n', '', text, flags=re.M)
            text = text.replace('listen 80;', f'listen 127.0.0.1:{plain};')
            text = text.replace('listen 443 ssl;', f'listen 127.0.0.1:{secure} ssl;')
            text = text.replace('127.0.0.1:3001', f'127.0.0.1:{upstream.server_port}')
            text = re.sub(r'access_log [^;]+;', 'access_log off;', text)
            text = re.sub(r'ssl_certificate [^;]+;', f'ssl_certificate {root}/cert.pem;', text)
            text = re.sub(r'ssl_certificate_key [^;]+;', f'ssl_certificate_key {root}/key.pem;', text)
            config = root / 'nginx.conf'
            config.write_text('daemon off; master_process off;\npid ' + str(root / 'pid')
                + ';\nerror_log ' + str(root / 'error.log') + ';\nevents {}\nhttp {\n'
                + 'client_body_temp_path ' + str(root / 'body') + ';\nproxy_temp_path '
                + str(root / 'proxy') + ';\nfastcgi_temp_path ' + str(root / 'fastcgi')
                + ';\nuwsgi_temp_path ' + str(root / 'uwsgi') + ';\nscgi_temp_path '
                + str(root / 'scgi') + ';\n' + text + '\n}\n')
            syntax = subprocess.run([nginx, '-t', '-p', str(root), '-c', str(config)],
                                    capture_output=True, text=True, timeout=10)
            assert syntax.returncode == 0, syntax.stdout + syntax.stderr
            process = subprocess.Popen([nginx, '-p', str(root), '-c', str(config)],
                                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            checked = 0

            def request(path, source='127.0.0.2', method='POST', headers=None, tls=True):
                connection = (http.client.HTTPSConnection('127.0.0.1', secure, context=context,
                              source_address=(source, 0), timeout=2) if tls else
                              http.client.HTTPConnection('127.0.0.1', plain,
                              source_address=(source, 0), timeout=2))
                try:
                    connection.request(method, path, headers=headers or {})
                    response = connection.getresponse()
                    return response.status, response.getheader('X-Synthetic-Upstream'), response.read()
                finally:
                    connection.close()

            try:
                until = time.monotonic() + 5
                while True:
                    assert process.poll() is None, (root / 'error.log').read_text()
                    try:
                        assert request('/health/live', method='GET')[0] == 200
                        break
                    except ConnectionRefusedError:
                        assert time.monotonic() < until
                        time.sleep(0.05)
                blocked = ['/api/auth/start', '/api/auth/complete', '/api/auth/dialogue',
                           '/api/browser/ssh', '/api/student/preflight',
                           '/api/student/attempts/synthetic/begin',
                           '/api/student/attempts/synthetic/practice',
                           '/api/auth/start?exam=synthetic', '/api/%61uth/start',
                           '/api/student/attempts/synthetic/beg%69n']
                for path in blocked:
                    for method in ('GET', 'POST'):
                        status, marker, _ = request(path, method=method,
                            headers={'X-Forwarded-For':'127.0.0.1', 'X-Real-IP':'127.0.0.1'})
                        assert (status, marker) == ((503, None) if fenced else (200, '1')), path
                        checked += 1
                    assert request(path, source='127.0.0.1')[:2] == (200, '1'), path
                    assert request(path, tls=False)[0] == (503 if fenced else 308), path
                    checked += 2
                ws = {'Connection':'Upgrade', 'Upgrade':'websocket'}
                assert request('/api/browser/ssh', method='GET', headers=ws)[:2] == (
                    (503, None) if fenced else (101, '1'))
                assert request('/api/browser/ssh', source='127.0.0.1', method='GET', headers=ws)[:2] == (101, '1')
                checked += 2
                for path in ['/health/live', '/api/agent/status', '/api/admin/login',
                             '/api/auth/startled', '/api/student/attempts/synthetic/status',
                             '/api/student/attempts/synthetic/frames',
                             '/api/student/attempts/synthetic/capture-challenges',
                             '/api/student/attempts/synthetic/continue',
                             '/api/student/attempts/synthetic/finish']:
                    assert request(path)[:2] == (200, '1'), path
                    checked += 1
                print(json.dumps({'config':filename, 'sha256':manifest['files'][filename],
                                  'checks':checked, 'syntax':'PASS', 'routing':'PASS'}), flush=True)
            finally:
                if process.poll() is None:
                    process.terminate()
                assert process.wait(timeout=5) == 0, (root / 'error.log').read_text()
    finally:
        upstream.shutdown()
        upstream.server_close()
        thread.join(timeout=5)
        assert not thread.is_alive()
assert not root.exists()
print('All owned nginx/upstream processes stopped; synthetic TLS keys and temporary files removed', flush=True)
