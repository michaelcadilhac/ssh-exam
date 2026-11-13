#!/usr/bin/env python3
"""Actual streamed child exports plus classic/containerd identity refusals."""
import base64
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'scripts'))
import docker_image_identity as identity


class Identity(unittest.TestCase):
    def setUp(self):
        self.raw = json.dumps({'rootfs': {'diff_ids': ['sha256:'+'a'*64]}}).encode()
        self.config = 'sha256:'+hashlib.sha256(self.raw).hexdigest()
        self.engine = 'sha256:'+'b'*64
        self.expected = {'config_id': self.config, 'tag': 'synthetic:qualified', 'layers': ['sha256:'+'a'*64]}

    def archive(self, config=None, manifest_config=None):
        name = 'blobs/sha256/'+self.config[7:]
        target = io.BytesIO()
        with tarfile.open(fileobj=target, mode='w') as stream:
            for path, raw in [(name, self.raw if config is None else config),
                              ('manifest.json', json.dumps([{'Config': manifest_config or name}]).encode())]:
                info = tarfile.TarInfo(path); info.size = len(raw); stream.addfile(info, io.BytesIO(raw))
        return target.getvalue()

    def export(self, payload):
        original = subprocess.Popen
        def spawn(args, **kwargs):
            self.assertEqual(args, ['/usr/bin/docker', 'image', 'save', self.engine])
            return original([sys.executable, '-c', 'import base64,sys;sys.stdout.buffer.write(base64.b64decode(sys.argv[1]))', base64.b64encode(payload).decode()], **kwargs)
        return patch.object(identity.subprocess, 'Popen', side_effect=spawn)

    def test_actual_stream_binds_raw_config_and_manifest(self):
        with self.export(self.archive()):
            self.assertEqual(identity.exported_config(self.engine, self.config), json.loads(self.raw))

    def test_wrong_config_or_manifest_refuses(self):
        for payload in (self.archive(config=b'{}'), self.archive(manifest_config='another.json')):
            with self.subTest(), self.export(payload), self.assertRaises(ValueError):
                identity.exported_config(self.engine, self.config)

    def test_containerd_cache_is_bound_to_exact_engine_and_layers(self):
        actual = {'Id': self.engine, 'RootFS': {'Layers': self.expected['layers']}, 'Descriptor': {'digest': self.engine}}
        command = lambda _: json.dumps([actual])
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(identity, 'exported_config', return_value=json.loads(self.raw)) as export:
                first = identity.inspect(command, self.expected, Path(directory))
                second = identity.inspect(command, self.expected, Path(directory))
                self.assertEqual(first['Id'], self.config); self.assertEqual(second['EngineId'], self.engine)
                self.assertEqual(export.call_count, 1)
                actual['RootFS']['Layers'] = ['sha256:'+'c'*64]
                with self.assertRaises(ValueError): identity.inspect(command, self.expected, Path(directory))

    def test_unverified_engine_descriptor_and_unknown_container_refuse(self):
        with tempfile.TemporaryDirectory() as directory:
            actual = {'Id': self.engine, 'RootFS': {'Layers': self.expected['layers']}}
            with self.assertRaises(ValueError): identity.inspect(lambda _: json.dumps([actual]), self.expected, Path(directory))
            actual['Id'] = self.config
            with self.assertRaises(ValueError):
                identity.container(lambda _: json.dumps([actual]), {'Image': 'sha256:'+'d'*64}, [self.expected], Path(directory))


if __name__ == '__main__': unittest.main()
