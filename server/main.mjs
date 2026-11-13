import {resolve} from 'node:path';
import {Store} from './core.mjs';
import {createApp} from './http.mjs';
import {loadConfig, version} from './config.mjs';

const config = loadConfig();
const demo = process.argv.includes('--demo');
const store = new Store(resolve(config.dataDir, demo ? 'demo.db' : 'contour.db'));
let demoTimer;
if (demo) {
  const {seedDemo, advanceDemo} = await import('./seed.mjs');
  seedDemo(store);
  demoTimer = setInterval(() => {
    try { advanceDemo(store); } catch (e) { console.error('Demo:', e.name); }
  }, 15000);
}
const server = createApp(store, {...config, demo});
server.listen(config.port, config.host, () => {
  console.log(`ContourWatch ${version}${demo ? ' [ДЕМО]' : ''}`);
  console.log(`Слушает http://${config.host}:${config.port}`);
  if (config.publicUrl) console.log(`Панель: ${config.publicUrl}`);
  console.log('Ключи: настроенные переменные/файлы или admin.key и viewer.key в DATA_DIR. Значения в журнал не выводятся.');
});
const tick = setInterval(() => {
  try { store.tick(); } catch (e) { console.error('Event evaluation:', e.name); }
}, 30000);
const prune = setInterval(() => {
  try { store.prune(); } catch (e) { console.error('Retention:', e.name); }
}, 3600000);
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(tick);
  clearInterval(prune);
  clearInterval(demoTimer);
  server.close(() => { store.close(); process.exit(0); });
  server.closeIdleConnections();
  setTimeout(() => { server.closeAllConnections(); process.exit(1); }, 10000).unref();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
