"""Private incremental monitoring storage used by the backup/restore CLIs."""
import datetime
from contextlib import closing
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import stat
import tempfile
import time
import uuid


def signature(path, source=False):
    value = path.lstat()
    if not stat.S_ISREG(value.st_mode):
        raise ValueError(f'Refusing non-regular file: {path}')
    result = [value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns]
    if source:
        result.append(value.st_ctime_ns)
    return result


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def digest(path):
    with path.open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def atomic_json(path, value):
    fd, name = tempfile.mkstemp(prefix='.manifest-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as output:
            json.dump(value, output, separators=(',', ':'))
            output.write('\n')
            output.flush()
            os.fsync(output.fileno())
        os.replace(name, path)
        sync_directory(path.parent)
    finally:
        Path(name).unlink(missing_ok=True)


def private_directory(path):
    value = path.lstat()
    if not stat.S_ISDIR(value.st_mode) or value.st_uid != os.geteuid() or value.st_mode & 0o077:
        raise ValueError(f'Require a private directory owned by the current user: {path}')


def monitoring_copy_scratch(path, monitoring):
    """Only the codec's reserved per-attempt copies are disposable scratch."""
    relative = path.relative_to(monitoring)
    return (len(relative.parts) == 2 and re.fullmatch(
        r'\.video-work-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}',
        relative.name) is not None)


def verify_backup(path):
    private_directory(path)
    manifest = json.loads((path / 'snapshot.json').read_text())
    if manifest.get('format') != 'shared-monitoring-v1':
        raise ValueError('Not a completed shared-monitoring snapshot')
    actual = set()
    for directory, directories, names in os.walk(path, followlinks=False):
        for name in directories:
            if (Path(directory) / name).is_symlink():
                raise ValueError('Snapshot directory symlink')
        for name in names:
            actual.add(str((Path(directory) / name).relative_to(path)))
    if actual != set(manifest['files']) | {'snapshot.json'}:
        raise ValueError('Snapshot membership differs from the completed manifest')
    for name, record in manifest['files'].items():
        relative = Path(name)
        if relative.is_absolute() or '..' in relative.parts:
            raise ValueError('Invalid snapshot member path')
        target = path / relative
        for parent in relative.parents:
            if (path / parent).is_symlink():
                raise ValueError('Snapshot directory symlink')
        if signature(target)[2] != record['bytes'] or digest(target) != record['sha256']:
            raise ValueError(f'Snapshot content verification failed: {name}')
    return {'phase': 'BACKUP_VERIFIED', 'files': len(manifest['files']),
            'snapshot': str(path), 'all_contents_hashed': True}


def create_backup(source, destination, store, media_only=False, require_warmed=False):
    os.umask(0o077)
    source = source.resolve(strict=True)
    if destination.is_symlink() or store.is_symlink():
        raise ValueError('Snapshot and store paths cannot be symlinks')
    destination = destination.resolve()
    store = store.resolve()
    if (destination.exists() or destination == source or source in destination.parents
            or store == source or source in store.parents or destination == store
            or store in destination.parents or destination in store.parents):
        raise ValueError('New snapshot and shared store must be distinct and outside live data')
    destination.parent.mkdir(parents=True, exist_ok=True)
    store.mkdir(mode=0o700, parents=True, exist_ok=True)
    private_directory(store)
    if store.stat().st_dev != destination.parent.stat().st_dev:
        raise ValueError('Snapshot and shared store must use the same filesystem for hard links')
    with (store / 'backup.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        cache_path = store / 'source-cache.json'
        cache = json.loads(cache_path.read_text()) if cache_path.exists() else {}
        working = Path(tempfile.mkdtemp(prefix='.incomplete-backup-', dir=destination.parent))
        files = {}
        recreated_objects = {}
        copied_bytes = reused_bytes = new_objects = 0
        try:
            database_bytes = 0
            if not media_only:
                metadata = working / 'metadata.sqlite'
                signature(source / 'metadata.sqlite', source=True)
                deadline = time.monotonic() + 20
                def progress(status, remaining, total):
                    if time.monotonic() > deadline:
                        raise ValueError('Database backup exceeded 20 seconds; verify the gateway is stopped and retry')
                with closing(sqlite3.connect((source / 'metadata.sqlite').as_uri() + '?mode=ro', uri=True)) as original:
                    with closing(sqlite3.connect(metadata)) as output:
                        original.backup(output, pages=128, progress=progress, sleep=0.01)
                        if output.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
                            raise ValueError('SQLite backup failed quick_check')
                metadata.chmod(0o600)
                database_bytes = metadata.stat().st_size
                files['metadata.sqlite'] = {'sha256': digest(metadata), 'bytes': database_bytes}
                with metadata.open('rb') as fd:
                    os.fsync(fd.fileno())
            for subtree in (('monitoring',) if media_only else ('receipts', 'monitoring', 'submissions')):
                origin = source / subtree
                if not origin.exists():
                    continue
                if origin.is_symlink() or not origin.is_dir():
                    raise ValueError(f'Unsafe source directory: {subtree}')
                (working / subtree).mkdir(mode=0o700)
                for directory, directories, names in os.walk(origin, followlinks=False):
                    parent = Path(directory)
                    for name in list(directories):
                        path = parent / name
                        if path.is_symlink():
                            raise ValueError('Source directory symlinks are not supported')
                        if subtree == 'monitoring' and monitoring_copy_scratch(path, origin):
                            directories.remove(name)
                            continue
                        (working / path.relative_to(source)).mkdir(mode=0o700)
                    for name in names:
                        path = parent / name
                        relative = path.relative_to(source)
                        target = working / relative
                        before = signature(path, source=True)
                        if subtree != 'monitoring':
                            shutil.copyfile(path, target)
                            target.chmod(0o600)
                            value = digest(target)
                            if signature(path, source=True) != before:
                                raise ValueError('Source changed while backing up; keep gateway stopped')
                            with target.open('rb') as fd:
                                os.fsync(fd.fileno())
                            files[str(relative)] = {'sha256': value, 'bytes': before[2]}
                            copied_bytes += before[2]
                            continue
                        key = str(path)
                        previous = cache.get(key)
                        if previous and previous['source'] == before:
                            value = previous['sha256']
                            if not re.fullmatch('[0-9a-f]{64}', value):
                                raise ValueError('Invalid cached object digest')
                            obj = store / value[:2] / value
                            if not obj.exists():
                                # An interrupted orphan prune can leave a stale
                                # cache entry. No existing snapshot is overwritten.
                                previous = None
                            elif (signature(obj) != previous['object']
                                  and recreated_objects.get(value) != signature(obj)):
                                raise ValueError('Shared object changed; run --verify-backup and preserve snapshots')
                            else:
                                cache[key]['object'] = signature(obj)
                                reused_bytes += before[2]
                        if not (previous and previous['source'] == before):
                            if require_warmed:
                                raise ValueError('Monitoring recovery objects are not warmed; run --warm-media before stopping the gateway')
                            fd, temporary = tempfile.mkstemp(prefix='.object-', dir=store)
                            try:
                                hashed = hashlib.sha256()
                                with os.fdopen(fd, 'wb') as out, path.open('rb') as incoming:
                                    while True:
                                        block = incoming.read(1024 * 1024)
                                        if not block:
                                            break
                                        hashed.update(block)
                                        out.write(block)
                                    out.flush()
                                if signature(path, source=True) != before:
                                    raise ValueError('Source changed while backing up; keep gateway stopped')
                                value = hashed.hexdigest()
                                obj = store / value[:2] / value
                                obj.parent.mkdir(mode=0o700, exist_ok=True)
                                if obj.exists():
                                    if signature(obj)[2] != before[2] or digest(obj) != value:
                                        raise ValueError('Existing shared object is corrupt; preserve snapshots')
                                    reused_bytes += before[2]
                                else:
                                    # Only a new durable object needs a sync.
                                    # A duplicate temporary copy is discarded.
                                    with Path(temporary).open('rb') as out:
                                        os.fsync(out.fileno())
                                    os.rename(temporary, obj)
                                    sync_directory(obj.parent)
                                    recreated_objects[value] = signature(obj)
                                    copied_bytes += before[2]
                                    new_objects += 1
                                cache[key] = {'source': before, 'sha256': value, 'object': signature(obj)}
                            finally:
                                Path(temporary).unlink(missing_ok=True)
                        os.link(obj, target)
                        files[str(relative)] = {'sha256': value, 'bytes': before[2]}
            for directory, _, _ in os.walk(working, topdown=False):
                sync_directory(Path(directory))
            if media_only:
                atomic_json(cache_path, cache)
                shutil.rmtree(working)
                sync_directory(destination.parent)
                return {'phase': 'MEDIA_WARMED', 'source': str(source), 'store': str(store),
                        'new_monitoring_objects': new_objects, 'copied_bytes': copied_bytes,
                        'reused_monitoring_bytes': reused_bytes,
                        'database_opened': False, 'complete_snapshot_created': False}
            manifest = {'format': 'shared-monitoring-v1',
                        'at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                        'gateway_stopped_attested': True, 'files': files,
                        'require_warmed': require_warmed,
                        'shared_store': str(store), 'new_monitoring_objects': new_objects,
                        'copied_bytes_excluding_database': copied_bytes,
                        'reused_monitoring_bytes': reused_bytes}
            atomic_json(working / 'snapshot.json', manifest)
            atomic_json(cache_path, cache)
            os.rename(working, destination)
            sync_directory(destination.parent)
            return {'phase': 'BACKUP_COMPLETE', 'snapshot': str(destination),
                    'files': len(files), 'database_bytes': database_bytes,
                    'new_monitoring_objects': new_objects, 'copied_bytes_excluding_database': copied_bytes,
                    'reused_monitoring_bytes': reused_bytes,
                    'verification': 'new bytes hashed; unchanged shared objects identity-checked'}
        except BaseException:
            shutil.rmtree(working, ignore_errors=True)
            raise


def warm_media(source, store):
    """Prepare media objects online; this is not a consistent database backup."""
    target = store.absolute().parent / ('.media-warm-' + uuid.uuid4().hex)
    return create_backup(source, target, store, media_only=True)


def prune_unused_objects(store, apply=False):
    """Only reclaim objects without ANY snapshot hard link, under the store lock."""
    os.umask(0o077)
    private_directory(store)
    removed = set()
    total = 0
    with (store / 'backup.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        for directory in store.iterdir():
            if not re.fullmatch('[0-9a-f]{2}', directory.name):
                continue
            private_directory(directory)
            for path in directory.iterdir():
                if not re.fullmatch('[0-9a-f]{64}', path.name) or not path.name.startswith(directory.name):
                    raise ValueError('Unexpected shared object name; nothing more removed')
                signature(path)
                value = path.lstat()
                if value.st_nlink != 1:
                    continue
                total += value.st_size
                removed.add(path.name)
                if apply:
                    path.unlink()
            if apply:
                sync_directory(directory)
        if apply:
            cache_path = store / 'source-cache.json'
            if cache_path.exists():
                cache = json.loads(cache_path.read_text())
                atomic_json(cache_path, {key: value for key, value in cache.items() if value['sha256'] not in removed})
            sync_directory(store)
    return {'phase': 'UNUSED_OBJECTS_PRUNED' if apply else 'UNUSED_OBJECTS_PREVIEW',
            'objects': len(removed), 'bytes': total, 'referenced_snapshot_objects_removed': False}
