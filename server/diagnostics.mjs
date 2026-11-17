export function safeRoute(url = '/') {
  const path = url.split('?')[0];
  if (['/health','/ready','/','/app.js','/panel.js','/workspace.js','/workspace.css','/layout-editor.js','/layout-editor.css','/styles.css','/panel.css','/icon.svg','/agent.svg'].includes(path)) return path;
  if (/^\/api\/(login|logout|session|password|register|ingest|control|updates|update\/check|devices|events|settings|tokens)$/.test(path)) return path;
  if (/^\/api\/(users(?:\/(delete|enabled))?|problems(?:\/delete)?|groups(?:\/delete)?|preferences|audit|notifications(?:\/(channels|rules|delete|test|retry))?)$/.test(path)) return path;
  if (/^\/api\/devices\/[a-f0-9-]{36}(?:\/(history|events|aggregates|maintenance|revoke|edit|pause))?$/.test(path)) return path.replace(/[a-f0-9-]{36}/, ':device');
  if (/^\/api\/events\/[a-f0-9-]{36}\/ack$/.test(path)) return '/api/events/:event/ack';
  return '/[unknown-route]';
}
export function requestLogger(record) {
  const line = JSON.stringify({time: new Date().toISOString(), component: 'api', ...record});
  if (record.status >= 500) console.error(line);
  else console.warn(line);
}
