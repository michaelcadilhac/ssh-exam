#!/usr/bin/python3
"""TEST ONLY: private user/mount namespace service-manager interface adapter.

No production switch, host service action, resource-enforcement claim or rootfs
modification. Real kernel resource tests are separate native qualification.
"""
import ctypes
import os
from pathlib import Path
import stat
import sys


def mount(source, target, flags):
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.mount(source.encode(), target.encode(), b'', flags, b'') != 0:
        number = ctypes.get_errno()
        raise OSError(number, os.strerror(number))


args = sys.argv[1:]
if args and args[0] == '--enter':
    assert os.getuid() == os.geteuid() == 0
    adapter, parent_user, parent_mount = args[1:4]
    command = args[4:]
    mapping = Path('/proc/self/uid_map').read_text().split()
    assert len(mapping) == 3 and mapping[0] == '0' and mapping[2] == '1', 'Private mapped user namespace required'
    assert os.stat('/proc/self/ns/user').st_ino != int(parent_user)
    assert os.stat('/proc/self/ns/mnt').st_ino != int(parent_mount), 'Private mount namespace required'
    info = os.lstat(adapter)
    assert stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1
    assert stat.S_IMODE(info.st_mode) == 0o700 and info.st_size <= 16384
    assert len(command) > 2 and os.path.isabs(command[0])
    mount('', '/', (1 << 14) | (1 << 18))  # MS_REC | MS_PRIVATE in this child only.
    for target in ('/usr/bin/systemctl', '/usr/bin/systemd-run'):
        mount(adapter, target, 4096)  # MS_BIND, not a host file write.
    os.execv(command[0], command)

name = os.path.basename(sys.argv[0])
if name == 'systemctl':
    if args and args[0] == 'stop':
        assert len(args) == 2 and args[1].startswith('exam-template-') and args[1].endswith('.service')
        raise SystemExit(0)  # Worker execs directly below, so parent timeout kills that exact child.
    assert args == ['show', 'exam-template.slice', '--property=LoadState', '--property=MemoryMax', '--property=MemorySwapMax', '--property=TasksMax']
    print('LoadState=loaded\nMemoryMax=268435456\nMemorySwapMax=0\nTasksMax=32')
elif name == 'systemd-run':
    for bound in ('--property=Slice=exam-template.slice', '--property=MemoryMax=256M', '--property=MemorySwapMax=0', '--property=TasksMax=32', '--property=RuntimeMaxSec=120', '--property=KillMode=control-group'):
        assert bound in args, 'Missing production service-interface bound'
    command = args[args.index('--') + 1:]
    assert len(command) == 2 and command[1] == '--template-worker'
    os.execv(command[0], command)
else:
    raise RuntimeError('Unexpected test-adapter entry')
