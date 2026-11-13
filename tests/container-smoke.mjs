// Explicitly invoked by CI; never included in the ordinary *.test.mjs suite.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, readdirSync, rmSync, readFileSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';

if (process.env.CONTOUR_CONTAINER_TEST !== '1') throw Error('Run only against an explicitly disposable CI deployment');
const deploy = resolve(import.meta.dirname, '../deploy');
const compose = args => execFileSync('docker', ['compose', ...args], {cwd: deploy, encoding: 'utf8', timeout: 120000});
const configuration = JSON.parse(compose(['config', '--format', 'json']));
assert.match(configuration.volumes['contour-data'].name, /^contourwatch-ci-/);
assert.equal(configuration.services.server.environment.PUBLIC_URL, 'https://monitor.example.test');
const base = 'http://127.0.0.1:8080', origin = 'https://monitor.example.test';
const request = async (path, body, cookie) => {
  const response = await fetch(base + path, {method: body === undefined ? 'GET' : 'POST',
    headers: {...(body === undefined ? {} : {'content-type': 'application/json', Origin: origin}), ...(cookie ? {cookie} : {})},
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000)});
  assert.equal(response.ok, true, `${path}: ${response.status}`);
  return response;
};
const adminKey = compose(['exec', '-T', 'server', 'cat', '/data/admin.key']).trim();
const viewerKey = compose(['exec', '-T', 'server', 'cat', '/data/viewer.key']).trim();
assert.notEqual(adminKey, viewerKey);
assert.ok(adminKey.length >= 32);
let cookie = (await request('/api/login', {key: adminKey})).headers.get('set-cookie').split(';')[0];
const token = (await (await request('/api/tokens', {uses: 1, minutes: 10}, cookie)).json()).token;
const device = await (await request('/api/register', {token, name: 'CI-CONTAINER', os: 'Ubuntu CI', version: '0.1.0'})).json();
async function ingest() {
  const r = await fetch(base + '/api/ingest', {method: 'POST', headers: {'content-type': 'application/json',
    'X-Device-Id': device.id, Authorization: `Bearer ${device.secret}`}, body: JSON.stringify({
      batchId: randomUUID(), measuredAt: new Date().toISOString(), metrics: [
        {id: 'ram', name: 'RAM', kind: 'ram', state: 'ok', value: 50, unit: '%', source: 'CI'}
      ]}), signal: AbortSignal.timeout(5000)});
  assert.equal(r.status, 200);
}
await ingest();
compose(['restart', 'server']);
const deadline = Date.now() + 60000;
let ready = false;
while (Date.now() < deadline) {
  try { ready = (await fetch(base + '/ready', {signal: AbortSignal.timeout(2000)})).ok; } catch {}
  if (ready) break;
  await new Promise(r => setTimeout(r, 1000));
}
assert.equal(ready, true, 'container ready after restart');
assert.equal(compose(['exec', '-T', 'server', 'cat', '/data/admin.key']).trim(), adminKey);
cookie = (await request('/api/login', {key: adminKey})).headers.get('set-cookie').split(';')[0];
const devices = await (await request('/api/devices', undefined, cookie)).json();
assert.equal(devices.length, 1);
assert.equal(devices[0].name, 'CI-CONTAINER');
await ingest();
console.log('PASS container readiness, Secure-cookie login, registration, restart, persistent keys, data and device credentials');

const backupDir = mkdtempSync(join(tmpdir(), 'contour-ci-backup-'));
const restoreVolume = 'contourwatch-ci-restore-' + randomUUID();
let volumeCreated = false;
try {
  execFileSync('sh', ['deploy/backup.sh', backupDir], {cwd: resolve(deploy, '..'), timeout: 120000, stdio: 'pipe'});
  const folders = readdirSync(backupDir).filter(name => !name.startsWith('.'));
  assert.equal(folders.length, 1);
  const snapshot = join(backupDir, folders[0]);
  assert.equal(readFileSync(join(snapshot, 'admin.key'), 'utf8').trim(), adminKey);
  execFileSync('sha256sum', ['--check', 'SHA256SUMS'], {cwd: snapshot, stdio: 'pipe'});
  execFileSync('docker', ['volume', 'create', restoreVolume], {stdio: 'pipe'});
  volumeCreated = true;
  const image = configuration.services.server.image;
  const copyCode = `const fs=require('node:fs');for(const name of ['contour.db','admin.key','viewer.key']){fs.copyFileSync('/restore/'+name,'/data/'+name);fs.chmodSync('/data/'+name,0o600);fs.chownSync('/data/'+name,1000,1000);}fs.chownSync('/data',1000,1000);fs.chmodSync('/data',0o700);`;
  execFileSync('docker', ['run', '--rm', '--network', 'none', '--user', '0:0', '-v', `${snapshot}:/restore:ro`,
    '-v', `${restoreVolume}:/data`, '--entrypoint', 'node', image, '-e', copyCode], {stdio: 'pipe', timeout: 30000});
  const verifyCode = `import {Store} from './server/core.mjs';import {loadConfig} from './server/config.mjs';const config=loadConfig();const s=new Store('/data/contour.db');try{if(s.devices().length!==1||s.devices()[0].name!=='CI-CONTAINER')throw Error('restore devices');if(config.adminKey.length<32)throw Error('restore key');if(s.one('PRAGMA quick_check').quick_check!=='ok')throw Error('restore integrity');}finally{s.close();}`;
  execFileSync('docker', ['run', '--rm', '--network', 'none', '-v', `${restoreVolume}:/data`, '--entrypoint', 'node',
    image, '--input-type=module', '-e', verifyCode], {stdio: 'pipe', timeout: 30000});
  console.log('PASS online backup script, checksums and restore into a separate volume as an unprivileged container user');
} finally {
  if (volumeCreated) execFileSync('docker', ['volume', 'rm', restoreVolume], {stdio: 'pipe'});
  rmSync(backupDir, {recursive: true, force: true});
}
