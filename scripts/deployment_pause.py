"""Exact ownership proof for the installer's temporary background-video pause.

The gateway only observes the marker's existence. These root installer callers
must additionally prove ownership before allowing queued work or unlinking it.
"""
import hashlib
import json
import os
from pathlib import Path
import stat
import uuid

OWNER_UID = 0
NAME = 'monitoring-video-deploy.pause'


def content(state, nonce):
    if str(uuid.UUID(nonce)) != nonce:
        raise ValueError('Invalid deployment pause nonce')
    return (json.dumps({'format': 'ssh-exam-web-ui-pause-v1',
                        'state': str(Path(state).resolve()), 'nonce': nonce},
                       sort_keys=True, separators=(',', ':'))+'\n').encode()


def owned(data, state, record):
    pause = record.get('video_pause')
    if not pause or pause.get('status') == 'RELEASED':
        return False
    expected = content(state, pause['nonce'])
    if hashlib.sha256(expected).hexdigest() != pause['sha256']:
        raise ValueError('Deployment pause receipt changed; preserve the marker and reinventory')
    path = Path(data)/NAME
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except FileNotFoundError:
        return False
    try:
        info = os.fstat(fd)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != OWNER_UID
                or info.st_nlink != 1 or stat.S_IMODE(info.st_mode) != 0o600
                or info.st_size != len(expected)):
            raise ValueError('Deployment pause is not the exact private owned marker; preserve it')
        actual = os.read(fd, len(expected)+1)
        after = path.lstat()
        if (actual != expected or (after.st_dev, after.st_ino) != (info.st_dev, info.st_ino)
                or after.st_nlink != 1):
            raise ValueError('Deployment pause changed; preserve it and reinventory')
    finally:
        os.close(fd)
    return True
