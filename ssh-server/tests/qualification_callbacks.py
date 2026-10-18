#!/usr/bin/env python3
"""Minimal signed HTTPS callback/timing fixture. Disposable guest only, no exam control API."""
import base64
import datetime
import http.server
import ipaddress
import json
import os
from pathlib import Path
import ssl
import time
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID

assert os.geteuid()==0
config=json.loads(Path('/etc/exam-agent/agent.json').read_text())
guards=json.loads(Path(config['guard_report']).read_text())
assert guards.get('fixture','').startswith('Private qualification')
assert config['callback_url']=='https://127.0.0.1:9444'
gateway=serialization.load_pem_private_key(Path('/etc/exam-agent/gateway.key').read_bytes(),None)
agent=serialization.load_pem_public_key(Path('/etc/exam-agent/callback.pub').read_bytes())
# Refresh only fixture TLS: the real gateway and host keys are not involved.
key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
name=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,'Private qualification callback')])
now=datetime.datetime.now(datetime.timezone.utc)
certificate=(x509.CertificateBuilder().subject_name(name).issuer_name(name).public_key(key.public_key())
 .serial_number(x509.random_serial_number()).not_valid_before(now-datetime.timedelta(minutes=5))
 .not_valid_after(now+datetime.timedelta(days=1))
 .add_extension(x509.SubjectAlternativeName([x509.IPAddress(ipaddress.ip_address('127.0.0.1'))]),critical=False)
 .add_extension(x509.BasicConstraints(ca=True,path_length=None),critical=True).sign(key,hashes.SHA256()))
Path('/etc/exam-agent/callback-tls.key').write_bytes(key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.TraditionalOpenSSL,serialization.NoEncryption()))
os.chmod('/etc/exam-agent/callback-tls.key',0o600)
Path(config['callback_ca']).write_bytes(certificate.public_bytes(serialization.Encoding.PEM))
class Handler(http.server.BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_POST(self):
  try:
   size=int(self.headers['Content-Length']);assert 0<size<=524288
   raw=self.rfile.read(size)
   agent.verify(base64.b64decode(self.headers['X-Exam-Signature']),raw)
   data=json.loads(raw);assert data['agent']==config['agent_id']
   result={'ok':True}
   if self.path=='/api/agent/timing':
    a=data['attempt'];assert a['deadline']<=int(time.time()*1000)
    reply={'type':'deadline-timing','audience':config['agent_id'],'id':a['id'],'nonce':data['nonce'],
           'expires':int(time.time()*1000)+30000,'deadline':a['deadline'],'clock_revision':a.get('clock_revision',0),'collect':True}
    payload=json.dumps(reply,separators=(',',':')).encode()
    result={'payload':base64.b64encode(payload).decode(),'signature':base64.b64encode(gateway.sign(payload)).decode()}
   else:assert self.path in ['/api/agent/events','/api/agent/recordings']
   body=json.dumps(result).encode();self.send_response(200);self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
  except Exception:self.send_error(403)
server=http.server.ThreadingHTTPServer(('127.0.0.1',9444),Handler)
context=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);context.load_cert_chain(config['callback_ca'],'/etc/exam-agent/callback-tls.key')
server.socket=context.wrap_socket(server.socket,server_side=True)
server.serve_forever()
