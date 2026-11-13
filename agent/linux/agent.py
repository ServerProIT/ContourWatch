#!/usr/bin/env python3
"""ContourWatch Linux agent; Python >=3.9. No third-party modules in the service."""
import argparse
import concurrent.futures
import datetime as dt
import fcntl
import json
import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path
import platform
import random
import re
import secrets
import shutil
import signal
import ssl
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

VERSION = '0.1.0'
DEFAULTS = dict(fastSeconds=60, volumeSeconds=300, smartSeconds=900)
STOP = threading.Event()

def iso():
    return dt.datetime.now(dt.timezone.utc).isoformat()

def atomic(path, value, mode=0o600):
    path = Path(path)
    tmp = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    try:
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
        with os.fdopen(fd, 'w', encoding='utf8') as f:
            json.dump(value, f, ensure_ascii=False, allow_nan=False)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)

def metric(ident, kind, name, state='ok', value=None, unit='', source='Linux', details=None):
    return dict(id=ident, kind=kind, name=name, state=state, value=value, unit=unit,
                source=source, details=details, measuredAt=iso())

def ram(proc=Path('/proc')):
    fields = {}
    for line in (proc / 'meminfo').read_text().splitlines():
        k, val = line.split(':', 1)
        fields[k] = int(val.strip().split()[0]) * 1024
    total, free = fields['MemTotal'], fields['MemAvailable']
    return [metric('ram', 'ram', 'Физическая память', value=(total-free)*100/total,
                   unit='%', details=dict(totalBytes=total, availableBytes=free, usedBytes=total-free))]

def volumes(proc=Path('/proc')):
    result, seen = [], set()
    excluded = {'proc', 'sysfs', 'devtmpfs', 'devpts', 'tmpfs', 'cgroup', 'cgroup2', 'securityfs',
                'debugfs', 'tracefs', 'pstore', 'mqueue', 'hugetlbfs', 'autofs', 'nfs', 'nfs4',
                'cifs', 'smb3', 'fuse.sshfs', 'squashfs', 'nsfs', 'rpc_pipefs', 'configfs'}
    for line in (proc / 'self/mountinfo').read_text().splitlines():
        left, right = line.split(' - ', 1)
        parts, fs = left.split(), right.split()[0]
        if fs in excluded or fs.startswith('fuse.'):
            continue
        mount = re.sub(r'\\([0-7]{3})', lambda m: chr(int(m[1], 8)), parts[4])
        # Deduplicate bind mounts by device + filesystem root.
        key = (parts[2], parts[3])
        if key in seen:
            continue
        seen.add(key)
        try:
            s = os.statvfs(mount)
            total, free = s.f_blocks*s.f_frsize, s.f_bfree*s.f_frsize
            if total:
                result.append(metric('volume:'+mount, 'volume', mount, value=(total-free)*100/total, unit='%',
                                     details=dict(totalBytes=total, freeBytes=free, usedBytes=total-free,
                                                  availableBytes=s.f_bavail*s.f_frsize, filesystem=fs)))
        except PermissionError:
            result.append(metric('volume:'+mount, 'volume', mount, 'denied'))
        except OSError:
            result.append(metric('volume:'+mount, 'volume', mount, 'error'))
    return result[:256]

def command(args, timeout=8):
    p = subprocess.run(args, capture_output=True, timeout=timeout, check=False)
    if len(p.stdout) > 200000:
        raise ValueError('output limit')
    return p.returncode, json.loads(p.stdout)

def parse_smart(raw, code, device):
    known = isinstance(raw.get('smart_status', {}).get('passed'), bool)
    nvme = raw.get('nvme_smart_health_information_log', {})
    attrs = {a['id']: a.get('raw', {}).get('value', 0)
             for a in raw.get('ata_smart_attributes', {}).get('table', [])}
    bad = (known and not raw['smart_status']['passed']) or bool(code & 248)
    bad = bad or bool(nvme.get('critical_warning', 0)) or bool(nvme.get('media_errors', 0)) or nvme.get('percentage_used', 0) >= 100
    bad = bad or any(attrs.get(k, 0) > 0 for k in (5, 197, 198)) or raw.get('scsi_grown_defect_list', 0) > 0
    state = 'error' if code & 7 else 'ok' if known else 'unsupported'
    return metric('disk:'+device, 'smart', raw.get('model_name', device), state,
                  int(bool(bad)) if state == 'ok' else None, 'risk', 'smartctl',
                  dict(model=raw.get('model_name'), serial=raw.get('serial_number'),
                       interface=raw.get('device', {}).get('protocol'),
                       capacityBytes=raw.get('user_capacity', {}).get('bytes'),
                       temperature=raw.get('temperature', {}).get('current'),
                       powerOnHours=raw.get('power_on_time', {}).get('hours'),
                       reallocated=attrs.get(5), pending=attrs.get(197), uncorrectable=attrs.get(198),
                       percentageUsed=nvme.get('percentage_used'), mediaErrors=nvme.get('media_errors'), raw=raw))

def smart():
    exe = shutil.which('smartctl')
    if not exe:
        return [metric('smart:unavailable', 'smart', 'Физические накопители', 'unsupported', source='smartctl',
                       details='Установите smartmontools из репозитория ОС')]
    code, scan = command([exe, '--scan-open', '-j'], 5)
    result = []
    for d in scan.get('devices', [])[:32]:
        name, typ = d['name'], d.get('type', 'auto')
        if not re.fullmatch(r'/dev/[a-zA-Z0-9/_.:-]+', name) or not re.fullmatch(r'[a-zA-Z0-9,+_-]+', typ):
            continue
        try:
            code, raw = command([exe, '-a', '-j', '-d', typ, name])
            result.append(parse_smart(raw, code, name))
        except Exception as e:
            result.append(metric('disk:'+name, 'smart', name, 'error', source='smartctl', details=type(e).__name__))
    return result or [metric('smart:unavailable', 'smart', 'Физические накопители', 'denied' if code & 2 else 'unsupported', source='smartctl')]

def parse_sensors(raw):
    result = []
    for chip, values in raw.items():
        cpu = any(k in chip.lower() for k in ('coretemp', 'k10temp', 'zenpower', 'cpu_thermal', 'soc_thermal'))
        for name, attrs in values.items():
            if not isinstance(attrs, dict):
                continue
            for key, val in attrs.items():
                kind = 'temperature' if cpu and re.fullmatch(r'temp\d+_input', key) else 'fan' if re.fullmatch(r'fan\d+_input', key) else None
                if kind and isinstance(val, (float, int)):
                    result.append(metric(chip+'/'+name+'/'+key, kind, name, value=val,
                                         unit='°C' if kind == 'temperature' else 'RPM', source='lm-sensors'))
    for kind, ident, name in [('temperature', 'cpu:unavailable', 'Температура CPU'), ('fan', 'fan:unavailable', 'Вентиляторы')]:
        if not any(m['kind'] == kind for m in result):
            result.append(metric(ident, kind, name, 'unsupported', source='lm-sensors'))
    return result

def sensors():
    exe = shutil.which('sensors')
    return parse_sensors(command([exe, '-j'], 5)[1] if exe else {})

def collect(kind):
    try:
        return {'ram': ram, 'volume': volumes, 'smart': smart, 'sensors': sensors}[kind]()
    except Exception as e:
        return [metric(kind+':collector', 'temperature' if kind == 'sensors' else kind,
                       kind, 'denied' if isinstance(e, PermissionError) else 'error', details=type(e).__name__)]

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def endpoint(server, path, local=False):
    u = urllib.parse.urlsplit(server)
    if (u.scheme != 'https' and not (local and u.scheme == 'http' and u.hostname in ('127.0.0.1', '::1', 'localhost'))) or not u.hostname or u.username or u.password or u.path not in ('', '/') or u.query or u.fragment:
        raise ValueError('Нужен HTTPS адрес сервера без пути и учётных данных')
    return server.rstrip('/') + path

def post(config, path, body):
    headers = {'Content-Type': 'application/json'}
    if config.get('secret'):
        headers.update({'Authorization': 'Bearer '+config['secret'], 'X-Device-Id': config['id']})
    ctx = ssl.create_default_context(cafile=config.get('caFile'))
    opener = urllib.request.build_opener(NoRedirect(), urllib.request.HTTPSHandler(context=ctx))
    request = urllib.request.Request(endpoint(config['server'], path, config.get('localTest', False)),
                                     json.dumps(body, allow_nan=False).encode(), headers)
    with opener.open(request, timeout=12) as response:
        data = response.read(1048577)
        if len(data) > 1048576:
            raise ValueError('response limit')
        return json.loads(data)

class Agent:
    def __init__(self, root):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True, mode=0o711)
        self.queue = self.root/'queue'
        self.queue.mkdir(exist_ok=True, mode=0o700)
        self.settings, self.cache, self.due, self.jobs = dict(DEFAULTS), {}, {}, {}
        self.pool = concurrent.futures.ThreadPoolExecutor(max_workers=4)

    def interval(self, kind):
        key = 'smartSeconds' if kind == 'smart' else 'volumeSeconds' if kind == 'volume' else 'fastSeconds'
        return max(300 if kind == 'smart' else 30, min(86400, int(self.settings[key])))

    def enqueue(self, payload):
        if len(json.dumps(payload).encode()) > 950000:
            logging.error('sample exceeds size limit')
            return
        atomic(self.queue/(str(time.time_ns())+'-'+uuid.uuid4().hex+'.json'), payload)
        files = sorted(self.queue.glob('*.json'))
        size = sum(f.stat().st_size for f in files)
        while len(files) > 1500 or size > 50*1024*1024:
            f = files.pop(0)
            size -= f.stat().st_size
            f.unlink()
            logging.warning('queue limit: oldest sample dropped')

    def deliver(self):
        config = json.loads((self.root/'config.json').read_text())
        if not config.get('secret'):
            if not config.get('requestId'):
                config.update(requestId=str(uuid.uuid4()), deviceSecret=secrets.token_urlsafe(32))
                atomic(self.root/'config.json', config)
            reply = post(config, '/api/register', dict(token=config['token'], name=config.get('name', platform.node()),
                         group=config.get('group', 'Без группы'), os=os_name(), version=VERSION,
                         requestId=config['requestId'], deviceSecret=config['deviceSecret']))
            config.update(id=reply['id'], secret=reply['secret'])
            for k in ('token', 'requestId', 'deviceSecret'):
                config.pop(k, None)
            atomic(self.root/'config.json', config)
        for f in sorted(self.queue.glob('*.json'))[:20]:
            try:
                payload = json.loads(f.read_text())
            except (ValueError, UnicodeError):
                f.unlink()
                logging.error('corrupt queue entry removed')
                continue
            if dt.datetime.fromisoformat(payload['measuredAt']).timestamp() < time.time()-7*86400:
                f.unlink()
                continue
            reply = post(config, '/api/ingest', payload)
            self.settings.update({k: reply['settings'][k] for k in DEFAULTS if k in reply.get('settings', {})})
            f.unlink()
        self.status('В сети', config.get('server'))

    def status(self, state, server=None):
        public = self.root/'public'
        public.mkdir(exist_ok=True, mode=0o755)
        atomic(public/'status.json', dict(state=state, version=VERSION, updated=iso(),
               queue=len(list(self.queue.glob('*.json'))), server=server), 0o644)

    def sample(self):
        return dict(batchId=str(uuid.uuid4()), measuredAt=iso(), version=VERSION,
                    metrics=[m for ms in self.cache.values() for m in ms],
                    hardware=dict(architecture=platform.machine(), virtual=virtual()),
                    updateStatus='Автообновление: требуется подписанный канал; автоматическая установка пока не реализована')

    def run(self, once=False):
        next_send = next_delivery = 0
        failures = 0
        while not STOP.is_set():
            now = time.monotonic()
            for kind in DEFAULT_KINDS:
                if once:
                    self.cache[kind] = child_collect(kind)
                    continue
                job = self.jobs.get(kind)
                if job and job.done():
                    try:
                        self.cache[kind] = job.result()
                    except Exception as e:
                        self.cache[kind] = [metric(kind+':collector', 'temperature' if kind == 'sensors' else kind, kind, 'error', details=type(e).__name__)]
                    del self.jobs[kind]
                    self.due[kind] = now + self.interval(kind)
                if kind not in self.jobs and self.due.get(kind, 0) <= now:
                    self.jobs[kind] = self.pool.submit(child_collect, kind)
            if self.cache and (once or now >= next_send):
                self.enqueue(self.sample())
                next_send = now + self.interval('ram')
            if once:
                print(json.dumps(self.sample(), ensure_ascii=False))
                self.pool.shutdown(wait=False)
                return
            if now >= next_delivery:
                try:
                    self.deliver()
                    failures = 0
                    next_delivery = now+2
                except Exception as e:
                    failures = min(failures+1, 12)
                    next_delivery = now+min(300, 2**failures)+random.uniform(1, 10)
                    logging.warning('delivery: %s', type(e).__name__)
                    self.status('Нет связи / ошибка конфигурации')
            STOP.wait(1)
        self.pool.shutdown(wait=True)

DEFAULT_KINDS = ('ram', 'volume', 'sensors', 'smart')

def child_collect(kind):
    try:
        p = subprocess.run([sys.executable, str(Path(__file__).resolve()), '--collect', kind],
                           capture_output=True, timeout=25, check=True)
        if len(p.stdout) > 900000:
            raise ValueError('output limit')
        return json.loads(p.stdout)
    except Exception as e:
        return [metric(kind+':collector', 'temperature' if kind == 'sensors' else kind,
                       kind, 'error', details=type(e).__name__)]

def os_name():
    try:
        lines = dict(line.split('=', 1) for line in Path('/etc/os-release').read_text().splitlines() if '=' in line)
        return lines.get('PRETTY_NAME', 'Linux').strip('"')
    except OSError:
        return 'Linux '+platform.release()

def virtual():
    try:
        p = subprocess.run(['systemd-detect-virt'], capture_output=True, timeout=2)
        return p.returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', default='/var/lib/contourwatch')
    parser.add_argument('--collect', choices=DEFAULT_KINDS)
    parser.add_argument('--once', action='store_true')
    parser.add_argument('--configure', action='store_true')
    parser.add_argument('--reregister', action='store_true')
    parser.add_argument('--server')
    parser.add_argument('--token-file')
    parser.add_argument('--name', default=platform.node())
    parser.add_argument('--group', default='Без группы')
    args = parser.parse_args()
    if args.collect:
        print(json.dumps(collect(args.collect), ensure_ascii=False, allow_nan=False))
        return
    agent = Agent(args.root)
    # One lock guards both configuration changes and delivery, preventing lost updates.
    with open(agent.root/'agent.lock', 'w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            parser.error('Агент уже работает. Для настройки остановите службу.')
        if args.configure:
            endpoint(args.server or '', '/health')
            path = agent.root/'config.json'
            config = json.loads(path.read_text()) if path.exists() else {}
            if config.get('secret') and config.get('server', '').rstrip('/') != args.server.rstrip('/') and not args.reregister:
                parser.error('При смене сервера нужен --reregister и новый токен')
            config.update(server=args.server, name=args.name, group=args.group)
            if not config.get('secret') or args.reregister:
                if not args.token_file:
                    parser.error('Нужен --token-file')
                for key in ('id', 'secret', 'requestId', 'deviceSecret'):
                    config.pop(key, None)
                config['token'] = Path(args.token_file).read_text().strip()
            atomic(path, config)
            return
        handler = RotatingFileHandler(agent.root/'agent.log', maxBytes=1048576, backupCount=2)
        logging.basicConfig(level=logging.INFO, handlers=[handler], format='%(asctime)s %(levelname)s %(message)s')
        for sig in (signal.SIGINT, signal.SIGTERM):
            signal.signal(sig, lambda *_: STOP.set())
        agent.run(args.once)

if __name__ == '__main__':
    main()
