"""Bind deployment Config digests to classic or containerd engine identifiers."""
import hashlib
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile
import threading

from shared_backup import atomic_json


def exported_config(identity, expected_config):
    """Read the pinned Config from a bounded, streamed local-engine export."""
    result = {}
    failures = []
    names = {expected_config.removeprefix('sha256:')+'.json',
             'blobs/sha256/'+expected_config.removeprefix('sha256:')}
    with tempfile.TemporaryFile() as errors:
        process = subprocess.Popen(['/usr/bin/docker', 'image', 'save', identity],
                                   stdout=subprocess.PIPE, stderr=errors)
        def read():
            try:
                with tarfile.open(fileobj=process.stdout, mode='r|') as stream:
                    for member in stream:
                        name = member.name.removeprefix('./')
                        if name == 'manifest.json':
                            if 'manifest' in result or not member.isfile() or member.size > 1024**2:
                                raise ValueError('Invalid loaded-image manifest')
                            result['manifest'] = json.load(stream.extractfile(member))
                        elif name in names:
                            if 'config' in result or not member.isfile() or member.size > 16*1024**2:
                                raise ValueError('Invalid loaded-image Config')
                            result['config'] = stream.extractfile(member).read()
                while process.stdout.read(1024**2):
                    pass
            except BaseException as error:
                failures.append(error)
        reader = threading.Thread(target=read, daemon=True)
        reader.start()
        try:
            reader.join(timeout=60)
            if reader.is_alive():
                raise TimeoutError('Loaded-image identity export exceeded 60 seconds')
            if failures:
                raise failures[0]
            if process.wait(timeout=5):
                raise ValueError('Loaded-image identity export failed')
        finally:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill(); process.wait(timeout=5)
            reader.join(timeout=5)
            if not reader.is_alive():
                process.stdout.close()
    manifest = result.get('manifest')
    raw = result.get('config')
    if (not isinstance(manifest, list) or len(manifest) != 1
            or manifest[0].get('Config', '').removeprefix('./') not in names
            or raw is None or 'sha256:'+hashlib.sha256(raw).hexdigest() != expected_config):
        raise ValueError('Loaded-image export differs from the qualified Config digest')
    return json.loads(raw)


def inspect(command, expected, state):
    """Return canonical Config identity, retaining the distinct EngineId."""
    actual = json.loads(command(['/usr/bin/docker', 'image', 'inspect', expected['tag']]))[0]
    config_id = expected['config_id']
    if actual['RootFS']['Layers'] != expected['layers']:
        raise ValueError('Loaded image layers differ from the qualified image')
    engine_id = actual['Id']
    if engine_id != config_id:
        descriptor = actual.get('Descriptor', {})
        if descriptor.get('digest') != engine_id:
            raise ValueError('Unknown engine image identity; preserve the current runtime')
        proof = {'config_id': config_id, 'engine_id': engine_id,
                 'layers': expected['layers'], 'descriptor': descriptor}
        path = Path(state)/('image-identity-'+config_id.removeprefix('sha256:')+'.json')
        if not path.exists() or json.loads(path.read_text()) != proof:
            config = exported_config(engine_id, config_id)
            if config['rootfs']['diff_ids'] != expected['layers']:
                raise ValueError('Exported Config layers differ from the qualified image')
            after = json.loads(command(['/usr/bin/docker', 'image', 'inspect', expected['tag']]))[0]
            if after != actual:
                raise ValueError('Loaded image changed during identity verification')
            atomic_json(path, proof)
    return {**actual, 'Id': config_id, 'EngineId': engine_id}


def container(command, value, expected_images, state):
    """Canonicalize only an exactly verified container image; refuse unknowns."""
    for expected in expected_images:
        image = inspect(command, expected, state)
        if value['Image'] == image['EngineId']:
            return {**value, 'Image': image['Id'], 'EngineImage': value['Image']}
    raise ValueError('Container image is outside the qualified old/new image cohort')
