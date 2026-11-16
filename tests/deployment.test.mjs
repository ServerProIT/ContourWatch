import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import http from 'node:http';
import {loadConfig, publicOrigin, proxyIps, clientIp, normalizeIp} from '../server/config.mjs';
import {backupDatabase} from '../server/backup.mjs';
import {Store} from '../server/core.mjs';
import {createApp} from '../server/http.mjs';

const key = 'deployment-test-admin-key-at-least-32-chars';
function directory(t) {
  const dir = mkdtempSync(join(tmpdir(), 'contour-deploy-'));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  return dir;
}
async function app(t, options = {}) {
  const store = new Store();await store.bootstrapAdmin({password:key});
  const server = createApp(store, {adminKey: key, secureCookies: true,
    publicUrl: 'https://monitor.example.test', ...options});
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(r => server.close(r));
    if (store.db.isOpen) store.close();
  });
  return {store, server, base: `http://127.0.0.1:${server.address().port}`};
}
const post = (base, path, body, headers = {}) => fetch(base + path, {
  method: 'POST', headers: {'content-type': 'application/json', ...headers},
  body: JSON.stringify(body), signal: AbortSignal.timeout(5000)
});

test('canonical HTTPS public URL is normalized', () => {
  assert.equal(publicOrigin('https://MONITOR.example.test/'), 'https://monitor.example.test');
  assert.equal(publicOrigin('https://monitor.example.test:8443'), 'https://monitor.example.test:8443');
  assert.equal(publicOrigin(''), null);
});
for (const url of ['http://monitor.local', 'https://user:pass@host', 'https://host/panel', 'https://host?q=1', 'https://host#x', 'not a URL']) {
  test(`reject invalid PUBLIC_URL: ${url}`, () => assert.throws(() => publicOrigin(url), /PUBLIC_URL/));
}
test('configuration creates no shared keys and ignores removed key variables',t=>{const dir=directory(t),config=loadConfig({ADMIN_KEY_FILE:'/not-used',PUBLIC_URL:'https://monitor.example.test'},dir);assert.equal(config.adminKey,undefined);assert.equal(config.viewerKey,undefined);assert.equal(existsSync(join(dir,'data/admin.key')),false);assert.equal(config.secureCookies,true);});

test('rejects invalid ports and insecure cookies for HTTPS deployment', t => {
  const dir = directory(t);
  for (const port of ['0', '-1', '1.5', '65536', 'abc']) assert.throws(() => loadConfig({PORT: port}, dir), /PORT/);
  assert.throws(() => loadConfig({PUBLIC_URL: 'https://monitor.example.test', SECURE_COOKIES: '0'}, dir), /Secure/);
});
test('proxy list normalizes exact IPv4/mapped/IPv6 and rejects broad or malformed entries', () => {
  const trusted = proxyIps('192.0.2.10,::ffff:192.0.2.10,0:0:0:0:0:0:0:1');
  assert.equal(trusted.size, 2);
  assert.ok(trusted.has('::1'));
  for (const value of ['*', '0.0.0.0/0', '10.0.0.0/24', 'npm.local', '192.0.2.1:8080', 'fe80::1%eth0']) {
    assert.throws(() => proxyIps(value), /TRUSTED_PROXY_IPS/);
  }
  assert.equal(normalizeIp('not-ip'), null);
});
test('untrusted direct peer cannot spoof forwarded client IP', () => {
  assert.equal(clientIp('192.0.2.20', '203.0.113.7', proxyIps('192.0.2.10')), '192.0.2.20');
  assert.equal(clientIp('::ffff:127.0.0.1', '203.0.113.7', new Set()), '127.0.0.1');
});
test('trusted NPM uses its appended client, not forged leftmost XFF', () => {
  const trusted = proxyIps('192.0.2.10');
  assert.equal(clientIp('192.0.2.10', '198.51.100.99, 203.0.113.7', trusted), '203.0.113.7');
  assert.equal(clientIp('192.0.2.10', 'bad-input, 203.0.113.7', trusted), '203.0.113.7');
  assert.equal(clientIp('192.0.2.10', 'bad-input', trusted), '192.0.2.10');
  assert.equal(clientIp('192.0.2.10', 'x'.repeat(4097), trusted), '192.0.2.10');
});
test('multiple explicitly trusted proxies are walked right to left', () => {
  const trusted = proxyIps('192.0.2.10,192.0.2.11');
  assert.equal(clientIp('192.0.2.10', '198.51.100.99,203.0.113.7,192.0.2.11', trusted), '203.0.113.7');
});
test('login behind proxy uses PUBLIC_URL despite an internal Host and untrusted forwarded host/proto', async t => {
  const {base} = await app(t);
  const response = await post(base, '/api/login', {username:'admin',password:key}, {
    Origin: 'https://monitor.example.test', 'X-Forwarded-Host': 'evil.invalid', 'X-Forwarded-Proto': 'http'
  });
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Strict/); assert.match(cookie, /; Secure/);
  const session = await fetch(base + '/api/session', {headers: {cookie: cookie.split(';')[0]}});
  assert.equal((await session.json()).role, 'admin');
});
test('forged Host and forwarded headers cannot authorize a foreign Origin', async t => {
  const {base} = await app(t);
  for (const origin of ['https://evil.invalid', 'null', 'http://monitor.example.test']) {
    const r = await post(base, '/api/login', {username:'admin',password:key}, {Origin: origin, Host: 'evil.invalid', 'X-Forwarded-Host': 'evil.invalid'});
    assert.equal(r.status, 403);
  }
});
test('agent registration without browser Origin works behind HTTPS proxy', async t => {
  const {base, store} = await app(t);
  const r = await post(base, '/api/register', {token: store.token().token, name: 'VM-AGENT', os: 'Linux', version: '0.1.0'});
  assert.equal(r.status, 201);
});
test('trusted proxy separates login rate limits for different clients', async t => {
  const {base} = await app(t, {trustedProxies: proxyIps('127.0.0.1')});
  for (let i = 0; i < 20; i++) await post(base, '/api/login', {key: 'wrong'}, {'X-Forwarded-For': '203.0.113.7'});
  assert.equal((await post(base, '/api/login', {username:'admin',password:key}, {'X-Forwarded-For': '203.0.113.7'})).status, 429);
  assert.equal((await post(base, '/api/login', {username:'admin',password:key}, {'X-Forwarded-For': '203.0.113.8'})).status, 200);
});
test('changing XFF does not evade rate limiting for an untrusted direct peer', async t => {
  const {base} = await app(t);
  for (let i = 0; i < 20; i++) await post(base, '/api/login', {key: 'wrong'}, {'X-Forwarded-For': `203.0.113.${i}`});
  assert.equal((await post(base, '/api/login', {username:'admin',password:key}, {'X-Forwarded-For': '198.51.100.8'})).status, 429);
});
test('readiness checks database and returns 503 after storage failure', async t => {
  const {base, store} = await app(t);
  assert.equal((await fetch(base + '/ready')).status, 200);
  store.close();
  assert.equal((await fetch(base + '/health')).status, 200);
  assert.equal((await fetch(base + '/ready')).status, 503);
});
test('online backup contains committed WAL data, survives restore, and source remains writable', async t => {
  const dir = directory(t), store = new Store(join(dir, 'live.db'));
  try {
  const device = store.register({token: store.token().token, name: 'BACKUP-TEST', os: 'Linux', version: '0.1.0'});
  const payload = {batchId: randomUUID(), measuredAt: new Date().toISOString(), metrics: []};
  store.ingest(device.id, payload);
  store.saveSettings({historyDays: 14});
  const output = join(dir, 'backup', 'snapshot.sqlite');
  assert.equal((await backupDatabase(join(dir, 'live.db'), output)).ok, true);
  const restored = new Store(output);
  try {
    assert.equal(restored.auth(device.id, device.secret).name, 'BACKUP-TEST');
    assert.equal(restored.history(device.id).length, 1);
    assert.equal(restored.settings().historyDays, 14);
  } finally { restored.close(); }
  store.ingest(device.id, {...payload, batchId: randomUUID()});
  assert.equal(store.history(device.id).length, 2);
  } finally { store.close(); }
});
test('backup refuses overwrite and missing source, leaves no partial files', async t => {
  const dir = directory(t), source = join(dir, 'live.db'), output = join(dir, 'existing.sqlite');
  const store = new Store(source);
  try {
  writeFileSync(output, 'keep-me');
  await assert.rejects(backupDatabase(source, output), /уже существует/);
  assert.equal(readFileSync(output, 'utf8'), 'keep-me');
  await assert.rejects(backupDatabase(join(dir, 'missing'), join(dir, 'new.sqlite')), /не найдена/);
  assert.equal(readdirSync(dir).some(name => name.endsWith('.partial')), false);
  } finally { store.close(); }
});
test('corrupt database cannot produce a successful backup', async t => {
  const dir = directory(t), source = join(dir, 'corrupt.db'), output = join(dir, 'snapshot.sqlite');
  writeFileSync(source, 'this is not sqlite');
  await assert.rejects(backupDatabase(source, output));
  assert.equal(existsSync(output), false);
  assert.equal(readdirSync(dir).some(name => name.endsWith('.partial')), false);
});
test('NPM-style reverse proxy preserves login/session flow', async t => {
  const {base} = await app(t);
  const upstream = new URL(base);
  const proxy = http.createServer((req, res) => {
    const headers = {...req.headers, host: upstream.host, 'x-forwarded-proto': 'https',
      'x-forwarded-for': [req.headers['x-forwarded-for'], req.socket.remoteAddress].filter(Boolean).join(', ')};
    const outgoing = http.request({hostname: upstream.hostname, port: upstream.port, path: req.url, method: req.method, headers}, response => {
      res.writeHead(response.statusCode, response.headers); response.pipe(res);
    });
    outgoing.on('error', () => { res.writeHead(502); res.end(); });
    req.pipe(outgoing);
  });
  await new Promise(r => proxy.listen(0, '127.0.0.1', r));
  t.after(async () => { proxy.closeAllConnections(); await new Promise(r => proxy.close(r)); });
  const proxyUrl = `http://127.0.0.1:${proxy.address().port}`;
  const response = await post(proxyUrl, '/api/login', {username:'admin',password:key}, {Origin: 'https://monitor.example.test'});
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie').split(';')[0];
  assert.equal((await fetch(proxyUrl + '/api/devices', {headers: {cookie}})).status, 200);
});
