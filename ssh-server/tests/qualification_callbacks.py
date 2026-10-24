#!/usr/bin/env python3
"""Minimal signed HTTPS callback/timing fixture. Disposable guest only, no exam control API."""
import base64
import datetime
import hashlib
import http.server
import ipaddress
import json
import os
from pathlib import Path
import ssl
import stat
import threading
import time
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID


def private_registry(path):
 descriptor=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK|os.O_CLOEXEC)
 try:
  metadata=os.fstat(descriptor)
  assert stat.S_ISREG(metadata.st_mode) and metadata.st_uid==0 and metadata.st_nlink==1
  assert metadata.st_mode&0o777==0o600 and 0<metadata.st_size<=65536
  raw=os.read(descriptor,65537);assert len(raw)==metadata.st_size
  return json.loads(raw)
 finally:os.close(descriptor)


def fixture_reply(path,data,expected,approval,owners,now):
 """Finite synthetic capture, NOT real camera qualification or a control API."""
 def key(owner):return json.dumps(owner,sort_keys=True,separators=(',',':'))
 def bootstrap(owner):
  encoded=key(owner);coverage=hashlib.sha256(encoded.encode()).hexdigest()
  owners[encoded]=coverage
  return {'type':'monitoring-bootstrap/v1','owner':owner,'coverage_epoch':coverage,'sequence':1}
 assert data['agent']==expected['agent']
 transfer=expected.get('clock_transfer')
 if transfer:
  previous,owner=transfer['previous_owner'],transfer['owner']
  assert set(previous)==set(owner) and owner['clock_revision']==previous['clock_revision']+1
  assert all(owner[k]==v for k,v in previous.items() if k!='clock_revision')
  owners[key(owner)]=owners[key(previous)]
 if path=='/api/agent/grant-begin':
  assert expected['type'] in ('grant-begin/v2','grant-begin/v3')
  assert all(data.get(k)==v for k,v in expected.items())
  reply={k:data[k] for k in ('type','nonce','attempt','grant','intent','transport','boot','page_epoch')}
  reply.update(audience=data['agent'],expires=now+15000,capture_valid_for_ms=15000)
  if data['type']=='grant-begin/v3':
   owner=data['initial_owner']
   assert set(owner)=={'attempt','exam','username','uid','transport_hash','boot','page_epoch','input_epoch','generation','clock_revision'}
   assert all(owner[k]==data[v] for k,v in (('attempt','attempt'),('exam','exam'),('username','username'),('uid','uid'),('transport_hash','transport'),('boot','boot'),('page_epoch','page_epoch')))
   assert owner['generation']==0 and owner['clock_revision']==0 and len(bytes.fromhex(owner['input_epoch']))==32
   reply['bootstrap']=bootstrap(owner)
  return reply
 if path=='/api/agent/monitoring-evidence':
  assert data['type']=='monitoring-execution-challenge-v1'
  coverage=owners[key(data['owner'])]
  assert data['coverage_epoch']==coverage and 0<data['after_sequence']<9007199254740991
  return {'type':'monitoring-execution-evidence-v1','audience':data['agent'],'nonce':data['nonce'],
          'owner':data['owner'],'coverage_epoch':coverage,'sequence':data['after_sequence']+1,'age_ms':0,'complete':True}
 assert path=='/api/agent/monitoring-continue' and data['type']=='monitoring-continue/v1'
 assert approval and approval['expires']>now and approval['expires']<=now+300000
 previous,owner=data['previous_owner'],data['owner']
 assert previous==approval['previous_owner'] and key(previous) in owners
 assert owner['generation']==approval['generation'] and owner['generation']>previous['generation']
 assert set(owner)==set(previous) and all(owner[k]==v for k,v in previous.items() if k not in ('generation','input_epoch'))
 assert owner['input_epoch']!=previous['input_epoch'] and len(bytes.fromhex(owner['input_epoch']))==32
 seed=bootstrap(owner)
 return {'type':'monitoring-continue/v1','audience':data['agent'],'nonce':data['nonce'],
         'previous_owner':previous,'owner':owner,'authorization_expires':approval['expires'],
         'expires':min(approval['expires'],now+15000),'capture_valid_for_ms':15000,'bootstrap':seed}


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
owners={}
owner_lock=threading.Lock()
class Handler(http.server.BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_POST(self):
  try:
   size=int(self.headers['Content-Length']);assert 0<size<=524288
   raw=self.rfile.read(size)
   agent.verify(base64.b64decode(self.headers['X-Exam-Signature']),raw)
   data=json.loads(raw);assert data['agent']==config['agent_id']
   result={'ok':True}
   if self.path in ('/api/agent/grant-begin','/api/agent/monitoring-evidence','/api/agent/monitoring-continue'):
    expected=private_registry('/run/qualification-framed-grant.json')
    assert expected['agent']==config['agent_id']
    approval=private_registry('/run/qualification-retained-approval.json') if self.path.endswith('/monitoring-continue') else None
    with owner_lock:reply=fixture_reply(self.path,data,expected,approval,owners,int(time.time()*1000))
    payload=json.dumps(reply,separators=(',',':')).encode()
    result={'payload':base64.b64encode(payload).decode(),'signature':base64.b64encode(gateway.sign(payload)).decode()}
   elif self.path=='/api/agent/timing':
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
