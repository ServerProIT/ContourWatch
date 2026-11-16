"""Verified release updates. No unsigned code or arbitrary installer commands."""
import base64
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request

FILES = {'agent.py', 'tray.py', 'agent.svg', 'update.py', 'update-public.pem'}
STATUS = 'Автообновление выключено'

def verify_manifest(text, signature, key, current, now=None):
    data = text.encode('utf8')
    if len(data) > 65536:
        raise ValueError('manifest size')
    sig = base64.b64decode(signature, validate=True)
    if not 256 <= len(sig) <= 1024:
        raise ValueError('signature size')
    with tempfile.TemporaryDirectory(prefix='contour-signature-') as directory:
        path = Path(directory)/'signature'
        path.write_bytes(sig)
        result = subprocess.run(['openssl', 'dgst', '-sha256', '-verify', str(key), '-signature', str(path)],
                                input=data, capture_output=True, timeout=5, check=False)
        if result.returncode:
            raise ValueError('manifest signature')
    manifest = json.loads(text)
    version, tag = manifest['version'], manifest['tag']
    if not re.fullmatch(r'\d{1,3}\.\d{1,3}\.\d{1,5}', version) or not re.fullmatch('agent-'+re.escape(version)+r'(?:-pilot\.\d+)?', tag):
        raise ValueError('version')
    if tuple(map(int, version.split('.'))) <= tuple(map(int, current.split('.'))):
        return None
    now = now or dt.datetime.now(dt.timezone.utc)
    expires = dt.datetime.fromisoformat(manifest['expires'].replace('Z', '+00:00'))
    if expires < now or expires > now+dt.timedelta(days=45):
        raise ValueError('expiry')
    artifact = manifest['artifacts']['linux']
    if artifact['name'] != 'ContourWatch-'+version+'-linux-any.tar.gz' or not re.fullmatch('[a-f0-9]{64}', artifact['sha256']) or not 1000 <= artifact['size'] <= 20*1024*1024:
        raise ValueError('artifact')
    return dict(artifact, version=version, tag=tag)

def allowed_hour(policy, hour):
    start, end = int(policy['start']), int(policy['end'])
    return start <= hour < end if start < end else hour >= start or hour < end

def launch(stage):
    # Independent unit: stopping the agent must not stop its updater.
    subprocess.run(['systemd-run', '--quiet', '--collect', '--unit=contourwatch-update-'+stage.name,
                    '--property=Type=exec', '--property=UMask=0077', '--property=ProtectSystem=strict',
                    '--property=ReadWritePaths=/var/lib/contourwatch /opt/contourwatch',
                    '--property=ProtectHome=true', '--property=PrivateTmp=true',
                    sys.executable, str(Path(__file__).resolve()), '--apply', str(stage)],
                   capture_output=True, check=True, timeout=10)

def check(config, policy, root, current, post):
    global STATUS
    stage = None
    launched = False
    try:
        STATUS = 'Проверка выпуска'
        reply = post(config, '/api/update/check', {})
        if not reply.get('available'):
            STATUS = 'Новых выпусков нет'
            return
        key = Path(__file__).with_name('update-public.pem')
        artifact = verify_manifest(reply['manifest'], reply['signature'], key, current)
        if artifact is None:
            STATUS = 'Установлена актуальная версия'
            return
        updates = Path(root)/'updates'
        updates.mkdir(exist_ok=True, mode=0o700)
        if sum(p.stat().st_size for p in updates.rglob('*') if p.is_file()) > 100*1024*1024:
            STATUS = 'Нужно очистить архивы предыдущих обновлений'
            return
        stage = Path(tempfile.mkdtemp(prefix='stage-', dir=updates))
        url = 'https://github.com/ServerProIT/ContourWatch/releases/download/'+artifact['tag']+'/'+artifact['name']
        target = stage/artifact['name']
        digest, size, started = hashlib.sha256(), 0, time.monotonic()
        with urllib.request.urlopen(url, timeout=20) as response, target.open('wb') as output:
            while True:
                chunk = response.read(65536)
                if not chunk:
                    break
                size += len(chunk)
                if size > artifact['size'] or time.monotonic()-started > 300:
                    raise ValueError('download limit')
                digest.update(chunk)
                output.write(chunk)
        if size != artifact['size'] or digest.hexdigest() != artifact['sha256']:
            raise ValueError('artifact digest')
        again = post(config, '/api/update/check', {})
        if not again.get('available') or again['manifest'] != reply['manifest'] or not allowed_hour(policy, dt.datetime.now(dt.timezone.utc).hour):
            STATUS = 'Установка отложена политикой'
            return
        (stage/'manifest.json').write_text(reply['manifest'], encoding='utf8')
        (stage/'manifest.sig').write_text(reply['signature'], encoding='ascii')
        # A separate systemd unit survives stopping the agent and does not inherit
        # its read-only /opt mount namespace. The running agent remains sandboxed.
        launch(stage)
        launched = True
        STATUS = 'Проверено. Установка '+artifact['version']
    except Exception as e:
        STATUS = 'Обновление отложено: '+type(e).__name__
    finally:
        if stage is not None and not launched and stage.parent.resolve() == (Path(root)/'updates').resolve() and not stage.is_symlink():
            shutil.rmtree(stage)

def unpack(archive, destination):
    found = set()
    with tarfile.open(archive, 'r:gz') as package:
        for count, item in enumerate(package):
            if count >= len(FILES) or item.name not in FILES or not item.isfile() or item.size > 1024*1024 or item.name in found:
                raise ValueError('archive layout')
            found.add(item.name)
            data = package.extractfile(item).read(1024*1024+1)
            if len(data) != item.size:
                raise ValueError('archive length')
            (destination/item.name).write_bytes(data)
    if found != FILES:
        raise ValueError('archive incomplete')

def apply(stage):
    import fcntl
    root, dest = Path('/var/lib/contourwatch'), Path('/opt/contourwatch')
    stage = Path(stage).resolve()
    if os.geteuid() != 0 or stage.parent != (root/'updates').resolve() or not re.fullmatch(r'stage-[a-zA-Z0-9_-]+', stage.name) or dest.is_symlink():
        raise ValueError('update location')
    with (root/'updates'/'update.lock').open('w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        text = (stage/'manifest.json').read_text()
        current = re.search(r"VERSION = '([^']+)'", (dest/'agent.py').read_text())[1]
        artifact = verify_manifest(text, (stage/'manifest.sig').read_text(), dest/'update-public.pem', current)
        if artifact is None:
            return
        archive = stage/artifact['name']
        if archive.stat().st_size != artifact['size'] or hashlib.sha256(archive.read_bytes()).hexdigest() != artifact['sha256']:
            raise ValueError('artifact digest')
        payload, backup = stage/'payload', stage/'rollback'
        payload.mkdir(mode=0o700)
        backup.mkdir(mode=0o700)
        unpack(archive, payload)
        for name in FILES:
            if (dest/name).exists():
                shutil.copy2(dest/name, backup/name)
        def service(action):
            subprocess.run(['systemctl', action, 'contourwatch.service'], check=True, timeout=45)
        def replace(source):
            for name in FILES:
                if (source/name).is_file():
                    temp = dest/(name+'.update-tmp')
                    shutil.copyfile(source/name, temp)
                    temp.chmod(0o644)
                    os.replace(temp, dest/name)
        service('stop')
        try:
            replace(payload)
            service('start')
            healthy = 0
            for _ in range(30):
                time.sleep(2)
                status = root/'public'/'status.json'
                try:
                    active = subprocess.run(['systemctl', 'is-active', '--quiet', 'contourwatch.service'], timeout=5, check=False).returncode == 0
                    if active and status.stat().st_mtime > time.time()-120 and json.loads(status.read_text()).get('version') == artifact['version']:
                        healthy += 1
                        if healthy >= 3:
                            (root/'updates'/'result.txt').write_text('Обновление завершено: '+artifact['version'])
                            return
                    else:
                        healthy = 0
                except (OSError, ValueError):
                    healthy = 0
            raise RuntimeError('health check')
        except Exception:
            service('stop')
            replace(backup)
            service('start')
            (root/'updates'/'result.txt').write_text('Обновление не подтверждено. Возвращена предыдущая версия.')
            raise

if __name__ == '__main__':
    if len(sys.argv) != 3 or sys.argv[1] != '--apply':
        sys.exit(2)
    apply(sys.argv[2])
