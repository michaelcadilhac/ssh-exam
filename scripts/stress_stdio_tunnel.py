#!/usr/bin/env python3
"""Private manual-qualification transport; never imported by the application.

One existing SSH command carries opaque connections to the two owned test ports.
No SSH forwarding policy, TLS, HTTP, signed bytes or production endpoint changes.
"""
import argparse
import errno
import json
import os
from pathlib import Path
import re
import selectors
import signal
import socket
import struct
import subprocess
import sys
import time

HEADER = struct.Struct('!IIB')  # length, connection, OPEN/DATA/EOF/CLOSE
OPEN, DATA, EOF, CLOSE = range(4)
MAX_PACKET, MAX_QUEUE, MAX_WIRE, MAX_CHANNELS = 65536, 262144, 4*1024**2, 384


def pump(reader, writer, listeners=(), *, remote=False, lifetime=3600):
    selector=selectors.DefaultSelector();registered={};channels={};incoming=bytearray();outgoing=bytearray();sequence=0;stopped=False
    readfd,writefd=reader.fileno(),writer.fileno();os.set_blocking(readfd,False);os.set_blocking(writefd,False)
    started=time.monotonic()
    def ending(_sig,_frame):
        nonlocal stopped
        stopped=True
    previous={sig:signal.signal(sig,ending) for sig in (signal.SIGTERM,signal.SIGINT)}
    def watch(file,mask,data):
        fd=file if isinstance(file,int) else file.fileno()
        if not mask:
            if fd in registered:selector.unregister(fd);registered.pop(fd)
        elif registered.get(fd)!=(mask,data):
            if fd in registered:selector.modify(fd,mask,data)
            else:selector.register(fd,mask,data)
            registered[fd]=(mask,data)
    def emit(kind,identity,payload=b''):
        assert 0<identity<2**32 and len(payload)<=MAX_PACKET
        outgoing.extend(HEADER.pack(len(payload),identity,kind));outgoing.extend(payload)
        assert len(outgoing)<=MAX_WIRE+MAX_PACKET+HEADER.size,'Private tunnel wire queue exceeded'
    def drop(identity,notify=False):
        channel=channels.pop(identity,None)
        if channel:
            watch(channel['socket'],0,None);channel['socket'].close()
        if notify:emit(CLOSE,identity)
    def add(identity,sock,connecting=False):
        assert identity not in channels and len(channels)<MAX_CHANNELS
        sock.setblocking(False)
        channels[identity]={'socket':sock,'queue':bytearray(),'connecting':connecting,'read_eof':False,'write_eof':False,'shutdown':False}
    def dispatch():
        while len(incoming)>=HEADER.size:
            size,identity,kind=HEADER.unpack_from(incoming)
            assert size<=MAX_PACKET and identity>0 and kind in (OPEN,DATA,EOF,CLOSE),'Malformed private transport frame'
            if len(incoming)<HEADER.size+size:return False
            channel=channels.get(identity)
            if kind==DATA and channel and len(channel['queue'])+size>MAX_QUEUE:return True
            payload=bytes(incoming[HEADER.size:HEADER.size+size]);del incoming[:HEADER.size+size]
            if kind==OPEN:
                assert remote and size==1 and payload[0]<2 and identity not in channels
                if len(channels)>=MAX_CHANNELS:emit(CLOSE,identity);continue
                sock=socket.socket();sock.setblocking(False)
                result=sock.connect_ex(('127.0.0.1',(9444,9445)[payload[0]]))
                if result not in (0,errno.EINPROGRESS,errno.EWOULDBLOCK):sock.close();emit(CLOSE,identity);continue
                add(identity,sock,result!=0)
            elif kind==DATA:
                assert size>0
                if channel:channel['queue'].extend(payload)
            elif kind==EOF:
                assert size==0
                if channel:channel['write_eof']=True
            else:
                assert size==0
                drop(identity)
        return False
    try:
        for listener,_ in listeners:listener.setblocking(False)
        while not stopped:
            assert time.monotonic()-started<lifetime,'Private transport finite lifetime expired'
            blocked=dispatch();assert len(incoming)<=MAX_PACKET*2+HEADER.size
            watch(readfd,0 if blocked else selectors.EVENT_READ,('wire-read',0))
            watch(writefd,selectors.EVENT_WRITE if outgoing else 0,('wire-write',0))
            for listener,index in listeners:watch(listener,selectors.EVENT_READ,('accept',index))
            for identity,channel in list(channels.items()):
                sock=channel['socket']
                if channel['write_eof'] and not channel['queue'] and not channel['connecting'] and not channel['shutdown']:
                    try:sock.shutdown(socket.SHUT_WR)
                    except OSError:pass
                    channel['shutdown']=True
                if channel['read_eof'] and channel['shutdown']:drop(identity);continue
                mask=0
                if not channel['read_eof'] and not channel['connecting'] and len(outgoing)<MAX_WIRE:mask|=selectors.EVENT_READ
                if channel['queue'] or channel['connecting']:mask|=selectors.EVENT_WRITE
                watch(sock,mask,('socket',identity))
            for key,events in selector.select(1):
                kind,identity=key.data
                if kind=='wire-read':
                    raw=os.read(readfd,MAX_PACKET)
                    if not raw:return 'eof'
                    incoming.extend(raw)
                elif kind=='wire-write':
                    try:written=os.write(writefd,outgoing)
                    except BlockingIOError:continue
                    assert written>0;del outgoing[:written]
                elif kind=='accept':
                    listener=next(s for s,index in listeners if index==identity)
                    sock,_=listener.accept()
                    if len(channels)>=MAX_CHANNELS:sock.close();continue
                    sequence+=1;add(sequence,sock);emit(OPEN,sequence,bytes([identity]))
                else:
                    channel=channels.get(identity)
                    if not channel:continue
                    sock=channel['socket']
                    try:
                        if channel['connecting'] and events&selectors.EVENT_WRITE:
                            if sock.getsockopt(socket.SOL_SOCKET,socket.SO_ERROR):drop(identity,True);continue
                            channel['connecting']=False
                        if events&selectors.EVENT_WRITE and channel['queue']:
                            try:written=sock.send(channel['queue'])
                            except BlockingIOError:written=0
                            del channel['queue'][:written]
                        if events&selectors.EVENT_READ:
                            if len(outgoing)>=MAX_WIRE:continue
                            try:raw=sock.recv(MAX_PACKET)
                            except BlockingIOError:continue
                            if raw:emit(DATA,identity,raw)
                            else:channel['read_eof']=True;emit(EOF,identity)
                    except OSError:drop(identity,True)
        return 'signal'
    finally:
        for channel in channels.values():channel['socket'].close()
        for listener,_ in listeners:listener.close()
        selector.close()
        for sig,handler in previous.items():signal.signal(sig,handler)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--remote',type=Path)
    parser.add_argument('--smoke',action='store_true')
    parser.add_argument('--listen',type=int,nargs=2,default=(9444,9445))
    parser.add_argument('--command',nargs=argparse.REMAINDER)
    args=parser.parse_args()
    if args.remote:
        stage=args.remote;assert os.getuid()==0 and re.fullmatch(r'/var/tmp/ssh-exam-colocation\.[a-f0-9]{16}',str(stage))
        assert stage.stat().st_uid==0 and stage.stat().st_mode&0o777==0o700
        token=stage.name.split('.')[-1];unit='ssh-exam-colocation-'+('transport-smoke' if args.smoke else 'server')+'-'+token+'.service'
        def state(name):
            result=subprocess.run(['systemctl','show',name,'--property=ActiveState,ControlGroup'],capture_output=True,text=True,check=True,timeout=5)
            return dict(line.split('=',1) for line in result.stdout.splitlines())
        assert state(unit)['ActiveState']=='active','Owned target fixture unavailable'
        budget=state('ssh-exam-colocation-bridge-'+token+'.service');assert budget['ActiveState']=='active' and token in budget['ControlGroup']
        Path('/sys/fs/cgroup'+budget['ControlGroup']+'/cgroup.procs').write_text(str(os.getpid()))
        pump(sys.stdin.buffer,sys.stdout.buffer,remote=True)
    else:
        assert args.command and len(set(args.listen))==2 and all(1024<p<65536 for p in args.listen)
        listeners=[];child=None
        try:
            for index,port in enumerate(args.listen):
                listener=socket.socket();listener.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1);listener.bind(('127.0.0.1',port));listener.listen(128);listeners.append((listener,index))
            child=subprocess.Popen(args.command,stdin=subprocess.PIPE,stdout=subprocess.PIPE)
            outcome=pump(child.stdout,child.stdin,listeners)
            if outcome=='eof':
                assert child.wait(timeout=5)==0,'Owned remote transport exited unsuccessfully'
        finally:
            for listener,_ in listeners:listener.close()
            if child and child.poll() is None:
                child.terminate()
                try:child.wait(timeout=10)
                except subprocess.TimeoutExpired:raise RuntimeError('Owned remote tunnel cleanup unconfirmed')


if __name__=='__main__':main()
