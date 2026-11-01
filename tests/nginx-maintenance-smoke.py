#!/usr/bin/env python3
"""Qualify maintenance through owned local nginx/TLS; never contacts production."""
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
import sys
import tempfile
import threading
import time

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--baseline', action='store_true', help='Reproduce the old raw upstream error before rendering')
parser.add_argument('--browser', action='store_true')
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)
repository = Path(__file__).resolve().parents[1]
nginx = shutil.which('nginx')
assert nginx, 'Use the installed nginx executable'


class Upstream(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def do_GET(self):
        self.reply()

    def do_POST(self):
        self.reply()

    def reply(self):
        status = 503 if self.path.endswith('?unavailable=1') else 401 if self.path == '/ordinary-refusal' else 200
        payload = b'{"error":"Capacity is temporarily unavailable; retry this same request.","code":"CAPACITY"}' if status == 503 else b'ordinary refusal' if status == 401 else b'synthetic upstream'
        self.send_response(status)
        self.send_header('Content-Length', str(len(payload)))
        self.send_header('X-Synthetic-Upstream', '1')
        if status == 503:
            self.send_header('Content-Type', 'application/json')
            self.send_header('Retry-After', '5')
        self.end_headers()
        self.wfile.write(payload)
        self.close_connection = True

    def log_message(self, *unused):
        pass


def port():
    with socket.socket() as connection:
        connection.bind(('127.0.0.1', 0))
        return connection.getsockname()[1]


receipts = []
with tempfile.TemporaryDirectory(prefix='ssh-exam-maintenance-') as temporary:
    root = Path(temporary)
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subject = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'local-maintenance')])
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (x509.CertificateBuilder().subject_name(subject).issuer_name(subject)
            .public_key(key.public_key()).serial_number(x509.random_serial_number())
            .not_valid_before(now - datetime.timedelta(minutes=1))
            .not_valid_after(now + datetime.timedelta(hours=1))
            .add_extension(x509.SubjectAlternativeName([x509.IPAddress(ipaddress.ip_address('127.0.0.1'))]), critical=False)
            .sign(key, hashes.SHA256()))
    (root/'cert.pem').write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    (root/'key.pem').write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    (root/'key.pem').chmod(0o600)
    context = ssl.create_default_context(cafile=str(root/'cert.pem'))
    for site in ('ssh-exam.cadilhac.name.conf', 'exam-workspace.conf.example'):
        for fenced in (False, True):
            upstream = ThreadingHTTPServer(('127.0.0.1', 0), Upstream)
            upstream.daemon_threads = True
            thread = threading.Thread(target=upstream.serve_forever, daemon=True)
            thread.start()
            stopped = False
            plain, secure = port(), port()
            while secure == plain:
                secure = port()
            candidate = root/(site+'-'+str(fenced)+'.conf')
            source = repository/'deploy/nginx'/site
            if args.baseline:
                candidate.write_bytes(source.read_bytes())
            else:
                command = [sys.executable, str(repository/'scripts/render-rollout-nginx'), '--site', str(source), '--output', str(candidate)]
                if fenced:
                    command.append('--fence')
                subprocess.run(command, check=True, capture_output=True, text=True, timeout=10)
            text = candidate.read_text()
            text = re.sub(r'^\s*listen \[::\]:[^;]+;\n', '', text, flags=re.M)
            text = text.replace('listen 80;', f'listen 127.0.0.1:{plain};')
            text = text.replace('listen 443 ssl;', f'listen 127.0.0.1:{secure} ssl;')
            text = re.sub(r'127\.0\.0\.1:300[01]\b', f'127.0.0.1:{upstream.server_port}', text)
            text = re.sub(r'access_log [^;]+;', 'access_log off;', text)
            text = re.sub(r'ssl_certificate [^;]+;', f'ssl_certificate {root}/cert.pem;', text)
            text = re.sub(r'ssl_certificate_key [^;]+;', f'ssl_certificate_key {root}/key.pem;', text)
            text += (f'\nserver {{ listen 127.0.0.1:{secure} ssl; server_name unrelated.test; '
                     f'ssl_certificate {root}/cert.pem; ssl_certificate_key {root}/key.pem; return 200 "unrelated site"; }}\n')
            config = root/'nginx.conf'
            config.write_text(f'daemon off; master_process off;\npid {root}/pid;\nerror_log {root}/error.log;\nevents {{}}\nhttp {{\naccess_log off;\n'
                + ''.join(f'{name}_temp_path {root}/{name};\n' for name in ('client_body', 'proxy', 'fastcgi', 'uwsgi', 'scgi'))
                + text + '\n}\n')
            syntax = subprocess.run([nginx, '-t', '-p', str(root), '-c', str(config)], capture_output=True, text=True, timeout=10)
            if syntax.returncode:
                upstream.shutdown(); upstream.server_close(); thread.join(timeout=5)
                assert not thread.is_alive()
                (args.output/'cleanup.json').write_text(json.dumps({'nginx_started': False, 'upstream_thread_stopped': True, 'upstream_socket_closed': upstream.socket.fileno() == -1})+'\n')
                raise AssertionError(syntax.stdout + syntax.stderr)
            process = subprocess.Popen([nginx, '-p', str(root), '-c', str(config)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

            def request(path, source_address='127.0.0.2', host=None, method='GET', tls=True):
                connection = (http.client.HTTPSConnection('127.0.0.1', secure, context=context, source_address=(source_address, 0), timeout=3)
                    if tls else http.client.HTTPConnection('127.0.0.1', plain, source_address=(source_address, 0), timeout=3))
                try:
                    connection.request(method, path, headers={'Host': host or 'ssh-exam.cadilhac.name', 'X-Forwarded-For': '127.0.0.1'})
                    response = connection.getresponse()
                    return response.status, dict(response.getheaders()), response.read()
                finally:
                    connection.close()

            def unavailable(path, method='GET', tls=True):
                status, headers, body = request(path, method=method, tls=tls)
                assert status == 503, (site, fenced, path, status, body)
                assert headers['Retry-After'] == '60' and headers['Cache-Control'] == 'no-store', headers
                assert 'X-Synthetic-Upstream' not in headers
                if re.sub('%61', 'a', path).startswith('/api/'):
                    assert headers['Content-Type'].startswith('application/json'), headers
                    message = json.loads(body)
                    assert message['code'] == 'SERVICE_UNAVAILABLE' and 'try again shortly' in message['error']
                else:
                    assert headers['Content-Type'].startswith('text/html'), headers
                    assert b'Exam website is temporarily unavailable' in body and b'Try again' in body

            try:
                until = time.monotonic() + 5
                while True:
                    assert process.poll() is None, (root/'error.log').read_text()
                    try:
                        assert request('/health/live')[0] == 200
                        break
                    except ConnectionRefusedError:
                        assert time.monotonic() < until
                        time.sleep(0.05)
                paths = ('/', '/admin', '/admin?return=exam', '/%61dmin', '/api/auth/start', '/api/%61uth/start', '/api/admin/login', '/api/student/preflight')
                for path in paths:
                    for method in ('GET', 'POST'):
                        if fenced:
                            unavailable(path, method)
                            unavailable(path, method, tls=False)
                        else:
                            assert request(path, method=method)[0] == 200
                            assert request(path, method=method, tls=False)[0] == 308
                        assert request(path, source_address='127.0.0.1', method=method)[0] == 200
                for path in ('/api/agent/status', '/api/student/attempts/synthetic/status', '/api/student/attempts/synthetic/finish', '/health/live'):
                    assert request(path)[0] == 200, path
                refusal_status, refusal_headers, refusal_body = request('/ordinary-refusal')
                assert refusal_status == 401 and refusal_body == b'ordinary refusal' and refusal_headers['X-Synthetic-Upstream'] == '1'
                for path in ('/api/agent/status?unavailable=1', '/api/student/attempts/synthetic/finish?unavailable=1', '/api/agent/submissions/00000000-0000-4000-8000-000000000000?unavailable=1'):
                    status, headers, body = request(path, method='POST')
                    assert status == 503 and headers.get('X-Synthetic-Upstream') == '1' and headers.get('Retry-After') == '5', (path, status, headers, body)
                    assert json.loads(body)['code'] == 'CAPACITY'
                assert request('/', host='unrelated.test')[0] == 200
                upstream.shutdown(); upstream.server_close(); thread.join(timeout=5); stopped = True
                assert not thread.is_alive()
                for path in (*paths, '/api/agent/status', '/api/student/attempts/synthetic/status', '/api/student/attempts/synthetic/finish'):
                    for method in ('GET', 'POST'):
                        unavailable(path, method)
                assert request('/', host='unrelated.test')[0] == 200
                if args.browser:
                    subprocess.run(['node', str(repository/'tests/nginx-maintenance-browser.mjs'), f'https://127.0.0.1:{secure}', str(args.output/site/str(fenced))], check=True, timeout=60)
                receipt = {'site': site, 'fenced': fenced, 'healthy_agent_status_finish_preserved': True, 'ordinary_401_preserved': True,
                           'unrelated_site_preserved': True, 'upstream_unavailable': '503 with Retry-After and HTML/JSON', 'syntax': 'PASS'}
                receipts.append(receipt)
                print(json.dumps(receipt), flush=True)
            finally:
                if process.poll() is None:
                    process.terminate()
                assert process.wait(timeout=5) == 0, (root/'error.log').read_text()
                if not stopped:
                    upstream.shutdown(); upstream.server_close(); thread.join(timeout=5)
                assert not thread.is_alive()
                (args.output/'cleanup.json').write_text(json.dumps({'owned_nginx_pid': process.pid, 'nginx_exit': process.returncode,
                    'upstream_thread_stopped': not thread.is_alive(), 'upstream_socket_closed': upstream.socket.fileno() == -1})+'\n')
assert not root.exists()
result = {'routing': receipts, 'owned_nginx_and_upstreams_stopped': True, 'synthetic_tls_keys_removed': True, 'production_contacted': False}
(args.output/'completion.json').write_text(json.dumps(result, indent=2)+'\n')
print(json.dumps(result), flush=True)
