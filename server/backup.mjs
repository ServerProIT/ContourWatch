import {DatabaseSync, backup} from 'node:sqlite';
import {mkdirSync, existsSync, linkSync, unlinkSync, chmodSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';

export async function backupDatabase(source, destination) {
  const input = resolve(source), output = resolve(destination);
  if (!existsSync(input)) throw Error('Исходная БД не найдена');
  if (input === output || existsSync(output)) throw Error('Файл назначения уже существует');
  mkdirSync(dirname(output), {recursive: true, mode: 0o700});
  const temporary = `${output}.${randomUUID()}.partial`;
  let db;
  try {
    db = new DatabaseSync(input, {readOnly: true});
    db.exec('PRAGMA busy_timeout=5000');
    await backup(db, temporary);
    const check = new DatabaseSync(temporary, {readOnly: true});
    try {
      if (check.prepare('PRAGMA quick_check').get().quick_check !== 'ok') throw Error('Проверка резервной БД не пройдена');
    } finally { check.close(); }
    chmodSync(temporary, 0o600);
    // Same-directory hard link publishes atomically and refuses overwrite even
    // when a second process creates the requested output during backup.
    linkSync(temporary, output);
    unlinkSync(temporary);
    return {ok: true, file: output};
  } finally {
    db?.close();
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const outputAt = args.indexOf('--output');
  if (outputAt !== -1 && !args[outputAt + 1]) throw Error('--output требует путь');
  const dir = resolve(process.env.DATA_DIR || 'data');
  const output = outputAt === -1
    ? resolve(dir, 'backups', `contour-${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}.sqlite`)
    : resolve(args[outputAt + 1]);
  try { console.log(JSON.stringify(await backupDatabase(resolve(dir, 'contour.db'), output))); }
  catch (e) { console.error(`Backup failed: ${e.message}`); process.exitCode = 1; }
}
