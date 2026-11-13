"""Portable logic tests. Hardware/systemd tests still require an actual Linux host."""
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

if sys.platform == 'win32':
    sys.modules['fcntl'] = types.SimpleNamespace()
spec = importlib.util.spec_from_file_location('contour_agent', Path(__file__).resolve().parents[1]/'agent/linux/agent.py')
a = importlib.util.module_from_spec(spec)
spec.loader.exec_module(a)

class LinuxLogic(unittest.TestCase):
    def test_ram_physical_and_available(self):
        with tempfile.TemporaryDirectory() as t:
            p = Path(t)
            (p/'meminfo').write_text('MemTotal: 1000 kB\nMemFree: 100 kB\nMemAvailable: 400 kB\nSwapTotal: 9000 kB\n')
            m = a.ram(p)[0]
            self.assertEqual(m['value'], 60)
            self.assertEqual(m['details']['totalBytes'], 1024000)

    def test_cpu_package_core_and_zero_fan(self):
        out = a.parse_sensors({'coretemp-isa-0000': {'Package id 0': {'temp1_input': 48}, 'Core 0': {'temp2_input': 45}},
                               'nct6798': {'fan1': {'fan1_input': 0}, 'motherboard': {'temp1_input': 80}}})
        self.assertEqual(len(out), 3)
        self.assertEqual(out[-1]['value'], 0)
        self.assertEqual(out[-1]['state'], 'ok')

    def test_missing_sensors_not_zero(self):
        out = a.parse_sensors({})
        self.assertEqual(len(out), 2)
        self.assertTrue(all(m['state'] == 'unsupported' and m['value'] is None for m in out))

    def test_smart_bitmask_warning_is_not_process_error(self):
        raw = {'smart_status': {'passed': False}, 'model_name': 'TEST', 'serial_number': 'SERIAL'}
        m = a.parse_smart(raw, 8, '/dev/sda')
        self.assertEqual(m['state'], 'ok')
        self.assertEqual(m['value'], 1)
        self.assertEqual(m['details']['raw'], raw)

    def test_smart_io_error(self):
        self.assertEqual(a.parse_smart({}, 2, '/dev/sda')['state'], 'error')

    def test_smart_unknown_health(self):
        m = a.parse_smart({}, 0, '/dev/sda')
        self.assertEqual(m['state'], 'unsupported')
        self.assertIsNone(m['value'])

    def test_reallocated_sectors_warn_even_if_passed(self):
        raw = {'smart_status': {'passed': True}, 'ata_smart_attributes': {'table': [{'id': 5, 'raw': {'value': 3}}]}}
        self.assertEqual(a.parse_smart(raw, 0, '/dev/sda')['value'], 1)

    def test_nvme_warning(self):
        raw = {'smart_status': {'passed': True}, 'nvme_smart_health_information_log': {'critical_warning': 1, 'percentage_used': 70, 'media_errors': 5}}
        m = a.parse_smart(raw, 0, '/dev/nvme0')
        self.assertEqual(m['value'], 1)
        self.assertEqual(m['details']['percentageUsed'], 70)

    def test_https_and_internal_ca_urls(self):
        self.assertEqual(a.endpoint('https://monitor.local', '/api/ingest'), 'https://monitor.local/api/ingest')
        for u in ('http://monitor.local', 'file:///etc/passwd', 'https://user:pass@x', 'https://x/a', 'https://x?q=1', 'https://x#x'):
            with self.subTest(u=u), self.assertRaises(ValueError):
                a.endpoint(u, '/health')
        self.assertEqual(a.endpoint('http://127.0.0.1:8080', '/health', True), 'http://127.0.0.1:8080/health')

    def test_atomic_replacement(self):
        with tempfile.TemporaryDirectory() as t:
            p = Path(t)/'c.json'
            a.atomic(p, {'x': 1})
            a.atomic(p, {'x': 2})
            self.assertEqual(json.loads(p.read_text()), {'x': 2})
            self.assertEqual(len(list(Path(t).iterdir())), 1)

    def test_invalid_json_does_not_replace_previous(self):
        with tempfile.TemporaryDirectory() as t:
            p = Path(t)/'c.json'
            a.atomic(p, {'x': 1})
            with self.assertRaises(ValueError):
                a.atomic(p, {'x': float('nan')})
            self.assertEqual(json.loads(p.read_text()), {'x': 1})

    def test_queue_bounded_and_oversized_sample_rejected(self):
        with tempfile.TemporaryDirectory() as t:
            agent = a.Agent(t)
            for i in range(1502):
                (agent.queue/(str(i).zfill(6)+'.json')).write_text(json.dumps({'n': i}))
            agent.enqueue({'n': 1502})
            self.assertEqual(len(list(agent.queue.glob('*.json'))), 1500)
            agent.enqueue({'data': 'x'*1000000})
            self.assertEqual(len(list(agent.queue.glob('*.json'))), 1500)
            agent.pool.shutdown()

    def test_failed_delivery_keeps_queue(self):
        with tempfile.TemporaryDirectory() as t:
            agent = a.Agent(t)
            a.atomic(agent.root/'config.json', {'server': 'https://test.local', 'id': 'abc', 'secret': 'secret'})
            agent.enqueue({'measuredAt': a.iso()})
            with patch.object(a, 'post', side_effect=OSError('offline')):
                with self.assertRaises(OSError):
                    agent.deliver()
            self.assertEqual(len(list(agent.queue.glob('*.json'))), 1)
            with patch.object(a, 'post', return_value={'settings': {'fastSeconds': 120}}):
                agent.deliver()
            self.assertEqual(len(list(agent.queue.glob('*.json'))), 0)
            self.assertEqual(agent.settings['fastSeconds'], 120)
            agent.pool.shutdown()

    def test_registration_retry_uses_same_identity(self):
        with tempfile.TemporaryDirectory() as t:
            agent = a.Agent(t)
            a.atomic(agent.root/'config.json', {'server': 'https://test.local', 'token': 'registration'})
            requests = []
            def post(config, path, body):
                requests.append(body)
                if len(requests) == 1:
                    raise OSError('response lost')
                return dict(id=body['requestId'], secret=body['deviceSecret'])
            with patch.object(a, 'post', side_effect=post):
                with self.assertRaises(OSError):
                    agent.deliver()
                agent.deliver()
            self.assertEqual(requests[0]['requestId'], requests[1]['requestId'])
            c = json.loads((agent.root/'config.json').read_text())
            self.assertNotIn('token', c)
            self.assertNotIn('deviceSecret', c)
            agent.pool.shutdown()

    def test_child_timeout_is_data_error(self):
        import subprocess
        with patch.object(a.subprocess, 'run', side_effect=subprocess.TimeoutExpired('test', 25)):
            m = a.child_collect('smart')[0]
            self.assertEqual(m['state'], 'error')
            self.assertIsNone(m['value'])

if __name__ == '__main__':
    unittest.main(verbosity=2)
