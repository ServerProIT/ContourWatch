import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {isIP} from 'node:net';

export const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

export function publicOrigin(value) {
  if (!value) return null;
  let url;
  try { url = new URL(value); } catch { throw Error('PUBLIC_URL: нужен полный HTTPS-адрес панели'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw Error('PUBLIC_URL: нужен HTTPS-адрес без пути, параметров и учётных данных');
  }
  return url.origin;
}

export function normalizeIp(value) {
  if (typeof value !== 'string') return null;
  const ip = value.trim();
  if (ip.startsWith('::ffff:') && isIP(ip.slice(7)) === 4) return ip.slice(7);
  if (isIP(ip) === 4) return ip;
  if (isIP(ip) === 6 && !ip.includes('%')) return new URL(`http://[${ip}]`).hostname.slice(1, -1);
  return null;
}

export function proxyIps(value = '') {
  const result = new Set();
  if (!value.trim()) return result;
  for (const item of value.split(',')) {
    const ip = normalizeIp(item);
    if (!ip) throw Error('TRUSTED_PROXY_IPS: укажите IP-адреса через запятую, без CIDR и имён DNS');
    result.add(ip);
  }
  if (result.size > 32) throw Error('TRUSTED_PROXY_IPS: не более 32 адресов');
  return result;
}

// NPM appends its actual client. Walk from the socket peer towards the client;
// never accept a browser-supplied leftmost address as proof of identity.
export function clientIp(peer, forwarded, trusted) {
  const remote = normalizeIp(peer) || 'unknown';
  if (!trusted.has(remote) || typeof forwarded !== 'string' || forwarded.length > 4096) return remote;
  const chain = forwarded.split(',');
  if (chain.length > 32) return remote;
  let current = remote;
  for (let i = chain.length - 1; i >= 0 && trusted.has(current); i--) {
    const candidate = normalizeIp(chain[i]);
    if (!candidate) return remote;
    current = candidate;
  }
  return current;
}

function accessKey(env, name, dataDir) {
  const fileVariable = `${name}_FILE`;
  if (env[name] && env[fileVariable]) throw Error(`${name}: выберите значение или ${fileVariable}, не оба`);
  let key;
  if (env[name]) key = env[name];
  else if (env[fileVariable]) key = readFileSync(resolve(env[fileVariable]), 'utf8').trim();
  else {
    const file = resolve(dataDir, name === 'ADMIN_KEY' ? 'admin.key' : 'viewer.key');
    if (!existsSync(file)) {
      try { writeFileSync(file, randomBytes(32).toString('base64url'), {mode: 0o600, flag: 'wx'}); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    key = readFileSync(file, 'utf8').trim();
  }
  if (typeof key !== 'string' || key.length < 24 || key.length > 1024 || /[\s\x00-\x1f]/.test(key)) {
    throw Error(`${name}: нужен ключ 24–1024 символа без пробелов`);
  }
  return key;
}

export function loadConfig(env = process.env, cwd = process.cwd()) {
  const origin = publicOrigin(env.PUBLIC_URL);
  const trustedProxies = proxyIps(env.TRUSTED_PROXY_IPS);
  if (origin && env.SECURE_COOKIES === '0') throw Error('Для PUBLIC_URL обязательны Secure cookies');
  const port = Number(env.PORT || 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('PORT: ожидается число 1–65535');
  const dataDir = resolve(cwd, env.DATA_DIR || 'data');
  mkdirSync(dataDir, {recursive: true, mode: 0o700});
  const adminKey = accessKey(env, 'ADMIN_KEY', dataDir);
  const viewerKey = accessKey(env, 'VIEWER_KEY', dataDir);
  if (adminKey === viewerKey) throw Error('Ключ администратора должен отличаться от ключа наблюдателя');
  return {dataDir, adminKey, viewerKey, publicUrl: origin, trustedProxies,
    secureCookies: Boolean(origin) || env.SECURE_COOKIES === '1',
    host: env.HOST || '127.0.0.1', port};
}
