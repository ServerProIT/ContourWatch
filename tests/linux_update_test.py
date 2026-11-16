import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
if sys.platform == 'win32':
    sys.modules['fcntl'] = types.SimpleNamespace()
def module(name, file):
    spec = importlib.util.spec_from_file_location(name, ROOT/file)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result
a = module('wear_agent', 'agent/linux/agent.py')
u = module('update_agent', 'agent/linux/update.py')

class UpdateLogic(unittest.TestCase):
    def test_wear(self):
        self.assertEqual(a.wear_percent({'endurance_used': {'current_percent': 23}}), 23)
        self.assertEqual(a.wear_percent({'nvme_smart_health_information_log': {'percentage_used': 127}}), 127)
        for raw in ({}, {'endurance_used': {'current_percent': True}}, {'endurance_used': {'current_percent': 256}}, {'ata_smart_attributes': {'table': [{'id': 202, 'value': 77}]}}):
            self.assertIsNone(a.wear_percent(raw))
        self.assertIsNone(a.wear_metric({}, 0, '/dev/sda')['value'])
        self.assertIsNone(a.wear_metric({'endurance_used': {'current_percent': 10}}, 2, '/dev/sda')['value'])

    def test_archive_allowlist_and_traversal(self):
        with tempfile.TemporaryDirectory() as directory:
            p = Path(directory)
            archive, output = p/'release.tar.gz', p/'output'
            output.mkdir()
            def package(names):
                with tarfile.open(archive, 'w:gz') as t:
                    for name in names:
                        info = tarfile.TarInfo(name)
                        info.size = 4
                        t.addfile(info, io.BytesIO(b'test'))
            package(u.FILES)
            u.unpack(archive, output)
            self.assertEqual({f.name for f in output.iterdir()}, u.FILES)
            for names in (['../escape'], ['agent.py'], ['agent.py', 'agent.py']):
                package(names)
                with self.assertRaises(ValueError):
                    u.unpack(archive, output)
            self.assertFalse((p/'escape').exists())

    def test_signature_fail_closed(self):
        import base64
        with patch.object(u.subprocess, 'run', return_value=types.SimpleNamespace(returncode=1)):
            with self.assertRaisesRegex(ValueError, 'signature'):
                u.verify_manifest('{}', base64.b64encode(b'x'*384).decode(), 'test-public-key', '0.2.0')

    def test_update_window(self):
        self.assertTrue(u.allowed_hour({'start': 22, 'end': 6}, 23))
        self.assertTrue(u.allowed_hour({'start': 22, 'end': 6}, 5))
        self.assertFalse(u.allowed_hour({'start': 22, 'end': 6}, 12))
        self.assertTrue(u.allowed_hour({'start': 0, 'end': 24}, 12))

if __name__ == '__main__':
    unittest.main(verbosity=2)
