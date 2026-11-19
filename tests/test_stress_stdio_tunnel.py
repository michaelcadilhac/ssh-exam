"""Actual opaque stream/half-close/short-write checks, no production connection."""
import hashlib
import os
from pathlib import Path
import socket
import socketserver
import struct
import subprocess
import sys
import tempfile
import threading
import time
import unittest

ROOT=Path(__file__).resolve().parents[1]
SCRIPT=ROOT/'scripts/stress_stdio_tunnel.py'
REMOTE="""import importlib.util,sys,os
spec=importlib.util.spec_from_file_location('tunnel',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
original=m.os.write;forced=0
def short(fd,data):
 global forced
 if forced<3 and len(data)>37:
  forced+=1;return original(fd,data[:37])
 return original(fd,data)
m.os.write=short
try:m.pump(sys.stdin.buffer,sys.stdout.buffer,remote=True,lifetime=30)
finally:print('FORCED_SHORT_WRITES='+str(forced),file=sys.stderr)
"""


class Echo(socketserver.BaseRequestHandler):
    def handle(self):
        self.request.settimeout(8)
        self.request.setsockopt(socket.SOL_SOCKET,socket.SO_SNDBUF,4096)
        data=bytearray()
        while raw:=self.request.recv(4096):
            data.extend(raw)
            if len(data)>3*1024**2:raise AssertionError('Fixture data bound')
        self.request.sendall(data)
        self.request.shutdown(socket.SHUT_WR)


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address=True
    daemon_threads=True


class StreamTunnel(unittest.TestCase):
    def test_actual_public_local_entry_preserves_large_binary_frames_and_half_closes(self):
        servers=[];threads=[];child=None
        with tempfile.TemporaryDirectory(prefix='stdio-tunnel-') as directory:
            log=Path(directory)/'tunnel.log'
            evidence=Path(os.environ.get('EXAM_TEST_OUTPUT_DIR',directory))
            evidence.mkdir(parents=True,exist_ok=True)
            log=evidence/'opaque-stream.log'
            try:
                for port in (9444,9445):
                    server=Server(('127.0.0.1',port),Echo);servers.append(server)
                    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start();threads.append(thread)
                ports=[]
                for _ in range(2):
                    with socket.socket() as probe:probe.bind(('127.0.0.1',0));ports.append(probe.getsockname()[1])
                with log.open('wb') as output:
                    child=subprocess.Popen([sys.executable,str(SCRIPT),'--listen',*map(str,ports),'--command',sys.executable,'-u','-c',REMOTE,str(SCRIPT)],stdout=output,stderr=subprocess.STDOUT)
                    until=time.monotonic()+5
                    while True:
                        try:probe=socket.create_connection(('127.0.0.1',ports[0]),timeout=.1);probe.close();break
                        except OSError:
                            self.assertLess(time.monotonic(),until);time.sleep(.02)
                    payload=bytes(range(256))*8192;outcomes=[]
                    def exchange(port,data):
                        try:
                            with socket.create_connection(('127.0.0.1',port),timeout=10) as sock:
                                sock.settimeout(10);sock.setsockopt(socket.SOL_SOCKET,socket.SO_RCVBUF,65536)
                                sock.sendall(data);sock.shutdown(socket.SHUT_WR);result=bytearray()
                                while raw:=sock.recv(4096):result.extend(raw);time.sleep(.001)
                                outcomes.append((len(data),len(result),hashlib.sha256(data).digest()==hashlib.sha256(result).digest()))
                        except BaseException as error:outcomes.append(error)
                    jobs=[threading.Thread(target=exchange,args=(ports[0],payload)),threading.Thread(target=exchange,args=(ports[1],b'independent relay channel'*1024))]
                    for job in jobs:job.start()
                    for job in jobs:job.join(timeout=20);self.assertFalse(job.is_alive())
                    self.assertCountEqual(outcomes,[(len(payload),len(payload),True),(25*1024,25*1024,True)])
                    child.terminate();self.assertEqual(child.wait(timeout=10),0)
                self.assertIn('FORCED_SHORT_WRITES=3',log.read_text())
            finally:
                if child and child.poll() is None:child.terminate();child.wait(timeout=10)
                for server in servers:server.shutdown();server.server_close()
                for thread in threads:thread.join(timeout=2)

    def test_oversized_private_frame_refuses_before_allocating_a_target(self):
        child=subprocess.run([sys.executable,'-u','-c',REMOTE,str(SCRIPT)],input=struct.pack('!IIB',65537,1,1),capture_output=True,timeout=5)
        self.assertNotEqual(child.returncode,0)
        self.assertIn(b'Malformed private transport frame',child.stderr)

    def test_configured_lifetime_carries_data_then_expires_and_reaps_its_peer(self):
        child=None;server=None;thread=None
        with tempfile.TemporaryDirectory(prefix='stdio-lifetime-') as directory:
            log=Path(directory)/'transport.log'
            try:
                server=Server(('127.0.0.1',9444),Echo)
                thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
                ports=[]
                for _ in range(2):
                    with socket.socket() as probe:probe.bind(('127.0.0.1',0));ports.append(probe.getsockname()[1])
                remote="import os,sys;print('REMOTE_PID='+str(os.getpid()),file=sys.stderr,flush=True)\n"+REMOTE
                with log.open('wb') as output:
                    child=subprocess.Popen([sys.executable,str(SCRIPT),'--lifetime','2','--listen',*map(str,ports),'--command',sys.executable,'-u','-c',remote,str(SCRIPT)],stdout=output,stderr=subprocess.STDOUT)
                    until=time.monotonic()+5
                    while True:
                        self.assertIsNone(child.poll(),log.read_text())
                        try:
                            probe=socket.create_connection(('127.0.0.1',ports[0]),timeout=.1);probe.close();break
                        except OSError:
                            self.assertLess(time.monotonic(),until);time.sleep(.02)
                    time.sleep(.4)
                    with socket.create_connection(('127.0.0.1',ports[0]),timeout=2) as sock:
                        sock.settimeout(2);sock.sendall(b'configured lifetime');sock.shutdown(socket.SHUT_WR)
                        body=bytearray()
                        while raw:=sock.recv(4096):body.extend(raw)
                    self.assertEqual(body,b'configured lifetime')
                    self.assertNotEqual(child.wait(timeout=5),0)
                text=log.read_text()
                self.assertIn('Private transport finite lifetime expired',text)
                peer=int(next(line.split('=',1)[1] for line in text.splitlines() if line.startswith('REMOTE_PID=')))
                self.assertFalse(Path('/proc',str(peer)).exists(),'Expired local transport left its peer alive')
                for port in ports:
                    with socket.socket() as probe:
                        probe.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1);probe.bind(('127.0.0.1',port))
            finally:
                if child and child.poll() is None:child.terminate();child.wait(timeout=10)
                if server:server.shutdown();server.server_close()
                if thread:thread.join(timeout=2);self.assertFalse(thread.is_alive())

    def test_invalid_lifetime_refuses_before_launching_its_command(self):
        with tempfile.TemporaryDirectory(prefix='stdio-lifetime-refusal-') as directory:
            marker=Path(directory)/'must-not-start'
            for value in ('0','-1','14401','nan'):
                with self.subTest(value=value):
                    r=subprocess.run([sys.executable,str(SCRIPT),'--lifetime',value,'--command',sys.executable,'-c','from pathlib import Path;Path('+repr(str(marker))+').write_text("started")'],capture_output=True,timeout=5)
                    self.assertEqual(r.returncode,2)
                    self.assertIn(b'lifetime',r.stderr)
                    self.assertFalse(marker.exists())


if __name__=='__main__':unittest.main()
