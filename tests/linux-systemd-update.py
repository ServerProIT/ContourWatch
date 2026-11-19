"""Real systemd update/rollback integration; disposable CI hosts only. No hardware collection."""
import base64
import datetime as dt
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import time

if os.environ.get('CI') != 'true' or os.geteuid() != 0:
    raise SystemExit('Requires a disposable root CI host')
REPO = Path(__file__).resolve().parents[1]
DEST, ROOT = Path('/opt/contourwatch'), Path('/var/lib/contourwatch')
SERVICE = Path('/etc/systemd/system/contourwatch.service')
if any(p.exists() for p in (DEST, ROOT, SERVICE)):
    raise SystemExit('Existing installation: refusing to modify host')

def run(*args, **kwargs):
    return subprocess.run(args, check=True, capture_output=True, timeout=45, **kwargs)

def wait(predicate, seconds=90):
    until = time.monotonic()+seconds
    while time.monotonic() < until:
        if predicate():
            return
        time.sleep(1)
    raise AssertionError('Timed out waiting for update')

def status(version):
    try:
        return json.loads((ROOT/'public/status.json').read_text())['version'] == version
    except (OSError, ValueError, KeyError):
        return False

MOCK = '''import json,time
from pathlib import Path
import update
VERSION = 'VERSION_HERE'
root=Path('/var/lib/contourwatch')
while True:
 (root/'public/status.json').write_text(json.dumps({'version':VERSION,'state':'CI fixture'}))
 if (root/'launch.txt').exists():
  stage=Path((root/'launch.txt').read_text().strip());(root/'launch.txt').unlink();update.launch(stage)
 time.sleep(1)
'''
created = False
try:
    DEST.mkdir(mode=0o755);created = True
    ROOT.mkdir(mode=0o700)
    (ROOT/'public').mkdir(mode=0o755)
    (ROOT/'updates').mkdir(mode=0o700)
    (ROOT/'config.json').write_text('CI-IDENTITY-MUST-SURVIVE')
    with tempfile.TemporaryDirectory(prefix='contour-ci-signing-') as temporary:
        key = Path(temporary)/'key.pem'
        run('openssl', 'genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:2048', '-out', str(key))
        run('openssl', 'pkey', '-in', str(key), '-pubout', '-out', str(DEST/'update-public.pem'))
        for name in ('update.py','tray.py','agent.svg'):
            shutil.copyfile(REPO/'agent/linux'/name, DEST/name)
        (DEST/'agent.py').write_text(MOCK.replace('VERSION_HERE', '0.2.1'))
        shutil.copyfile(REPO/'agent/linux/contourwatch.service', SERVICE)
        run('systemctl','daemon-reload');run('systemctl','start','contourwatch.service')
        wait(lambda: status('0.2.1'))
        def release(version, broken=False):
            stage = Path(tempfile.mkdtemp(prefix='stage-', dir=ROOT/'updates'))
            name = 'ContourWatch-'+version+'-linux-any.tar.gz'
            with tarfile.open(stage/name, 'w:gz') as archive:
                for filename in ('agent.py','tray.py','agent.svg','update.py','update-public.pem'):
                    data = (("VERSION = '"+version+"'\nraise RuntimeError('CI deliberate failure')\n") if broken else MOCK.replace('VERSION_HERE',version)).encode() if filename=='agent.py' else (DEST/filename).read_bytes()
                    info=tarfile.TarInfo(filename);info.size=len(data);archive.addfile(info,io.BytesIO(data))
            manifest={'version':version,'tag':'agent-'+version,'expires':(dt.datetime.now(dt.timezone.utc)+dt.timedelta(days=1)).isoformat(),'artifacts':{'linux':{'name':name,'size':(stage/name).stat().st_size,'sha256':hashlib.sha256((stage/name).read_bytes()).hexdigest()}}}
            data=json.dumps(manifest).encode();(stage/'manifest.json').write_bytes(data)
            signature=run('openssl','dgst','-sha256','-sign',str(key),input=data).stdout
            (stage/'manifest.sig').write_text(base64.b64encode(signature).decode())
            result=ROOT/'updates/result.txt'
            result.unlink(missing_ok=True)
            (ROOT/'launch.txt').write_text(str(stage))
            wait(result.exists)
            return result.read_text()
        assert 'завершено: 0.2.2' in release('0.2.2')
        assert status('0.2.2')
        assert 'Возвращена предыдущая версия' in release('0.2.3',broken=True)
        assert (ROOT/'updates/blocked-release.txt').read_text() == 'agent-0.2.3'
        wait(lambda: status('0.2.2'))
        run('systemctl','is-active','--quiet','contourwatch.service')
        assert (ROOT/'config.json').read_text()=='CI-IDENTITY-MUST-SURVIVE'
        print('PASS actual sandboxed systemd agent launch, signed update, independent installer, failed-start rollback and identity preservation')
finally:
    if created:
        subprocess.run(['systemctl','stop','contourwatch.service'],capture_output=True,timeout=45)
        if SERVICE.exists():
            SERVICE.unlink()
        subprocess.run(['systemctl','daemon-reload'],capture_output=True,timeout=45)
        # These exact locations were verified absent before this isolated CI test.
        for target in (DEST, ROOT):
            if target.resolve() == target and not target.is_symlink() and target.exists():
                shutil.rmtree(target)
