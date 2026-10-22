#!/usr/bin/python3
"""TEST ONLY: exact systemctl reader in a private user/mount namespace.

Never installs a file, contacts a host manager or runs a collection worker.
"""
import ctypes
import json
import os
from pathlib import Path
import stat
import sys


def mount(source, target, flags):
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.mount(source.encode(), target.encode(), b'', flags, b'') != 0:
        code = ctypes.get_errno()
        raise OSError(code, os.strerror(code))


args = sys.argv[1:]
if args and args[0] == '--enter':
    assert os.getuid() == os.geteuid() == 0
    adapter, parent_user, parent_mount = args[1:4]
    command = args[4:]
    mapping = Path('/proc/self/uid_map').read_text().split()
    assert len(mapping) == 3 and mapping[0] == '0' and mapping[2] == '1'
    assert os.stat('/proc/self/ns/user').st_ino != int(parent_user)
    assert os.stat('/proc/self/ns/mnt').st_ino != int(parent_mount)
    info = os.lstat(adapter)
    assert stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1
    assert stat.S_IMODE(info.st_mode) == 0o700 and info.st_size <= 16384
    assert len(command) > 2 and os.path.isabs(command[0])
    mount('', '/', (1 << 14) | (1 << 18))  # MS_REC | MS_PRIVATE only in this child.
    mount(adapter, '/usr/bin/systemctl', 4096)  # Namespace bind, not a host file write.
    mount(adapter, '/usr/bin/getent', 4096)  # Synthetic NSS only; never query host accounts.
    os.execv(command[0], command)

if os.path.basename(sys.argv[0]) == 'getent':
    assert os.getuid() == os.geteuid() == 0
    assert args == ['passwd', 'synthetic']
    print('synthetic:x:20001:20001::/home/synthetic:/usr/local/libexec/exam-login')
    sys.exit(0)

assert os.path.basename(sys.argv[0]) == 'systemctl'
expected = ['show', 'exam-collection.slice', '--property=LoadState',
            '--property=MemoryMax', '--property=MemorySwapMax', '--property=TasksMax']
assert args == expected, 'Readiness must explicitly request every existing pool bound'
policy_path = Path(os.environ['EXAM_COLLECTION_READINESS_FIXTURE'])
info = policy_path.lstat()
assert stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1
assert stat.S_IMODE(info.st_mode) == 0o600 and info.st_size <= 4096
policy = json.loads(policy_path.read_text())
assert set(policy) in ({'swap', 'capture'}, {'swap', 'capture', 'hold'})
capture = Path(policy['capture'])
assert capture.parent == policy_path.parent and capture.name == 'captured-query.json'
assert not capture.is_symlink()
capture.write_text(json.dumps(args) + '\n')
if 'hold' in policy:
    assert policy['hold'] is True
    gate = policy_path.parent / 'health-probe-gate'
    info = gate.lstat()
    assert stat.S_ISFIFO(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1
    assert stat.S_IMODE(info.st_mode) == 0o600
    entered = policy_path.parent / 'health-probe-entered'
    fd = os.open(entered, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    os.write(fd, b'entered\n')
    os.close(fd)
    # Deliberately held dependency ONLY in this guarded namespace test adapter.
    with gate.open('rb', buffering=0) as stream:
        assert stream.read(1) == b'1'
print('LoadState=loaded\nMemoryMax=536870912\nTasksMax=96')
if policy['swap'] is not None:
    print('MemorySwapMax=' + policy['swap'])
