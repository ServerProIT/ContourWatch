import {randomBytes,randomUUID,scrypt as scryptCallback} from 'node:crypto';
import {promisify} from 'node:util';
import {writeFileSync} from 'node:fs';
import {fail,textField} from './errors.mjs';
const scrypt=promisify(scryptCallback);
export async function encodePassword(password){if(typeof password!=='string'||password.length<12||password.length>256)fail(400,'Пароль: от 12 до 256 символов');const salt=randomBytes(16).toString('hex');return salt+':'+(await scrypt(password,salt,64)).toString('hex');}
export function migratePlatform(store){
 const add=(table,name,definition)=>{if(!store.all(`PRAGMA table_info(${table})`).some(c=>c.name===name))store.db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);};
 if(store.one("SELECT count(*) n FROM users WHERE role='admin'").n>1)throw Error('Перед обновлением оставьте одного персонального администратора');
 add('users','enabled','INTEGER NOT NULL DEFAULT 1');add('users','must_change','INTEGER NOT NULL DEFAULT 0');
 add('devices','paused','INTEGER NOT NULL DEFAULT 0');add('devices','control_seen','INTEGER');add('devices','pause_confirmed','INTEGER NOT NULL DEFAULT 0');
 add('events','severity',"TEXT NOT NULL DEFAULT 'warning'");
 add('events','problem_rule','TEXT');add('events','kind','TEXT');add('events','metric_id','TEXT');
 store.db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS only_admin ON users(role) WHERE role='admin';
 CREATE TRIGGER IF NOT EXISTS keep_admin BEFORE DELETE ON users WHEN OLD.role='admin' BEGIN SELECT RAISE(ABORT,'Administrator cannot be deleted'); END;
 CREATE TRIGGER IF NOT EXISTS protect_admin BEFORE UPDATE OF role,enabled ON users WHEN OLD.role='admin' AND (NEW.role<>'admin' OR NEW.enabled<>1) BEGIN SELECT RAISE(ABORT,'Administrator must stay active'); END;
 CREATE TABLE IF NOT EXISTS problem_rules(id TEXT PRIMARY KEY,value TEXT NOT NULL);`);
}
export const platform={
 async bootstrapAdmin({username='admin',password,credentialsFile}={}){
  if(this.one("SELECT id FROM users WHERE role='admin'"))return null;
  username=textField(username,'логин',64).normalize('NFC').toLocaleLowerCase('ru');if(!/^[\p{L}\p{N}_.@-]+$/u.test(username))fail(400,'Некорректный логин');
  const generated=!password;password=password||randomBytes(24).toString('base64url');const encoded=await encodePassword(password);
  return this.transaction(()=>{if(this.one("SELECT id FROM users WHERE role='admin'"))return null;if(this.one('SELECT id FROM users WHERE username=?',username))fail(409,'Логин начального администратора занят');
   if(generated&&!credentialsFile)throw Error('Нужен защищённый файл начального пароля');
   if(credentialsFile)writeFileSync(credentialsFile,`Логин: ${username}\nВременный пароль: ${password}\nСмените пароль при первом входе.\n`,{mode:0o600,flag:'wx'});
   const id=randomUUID();this.run('INSERT INTO users(id,username,password,role,created,enabled,must_change) VALUES(?,?,?,?,?,1,?)',id,username,encoded,'admin',Date.now(),generated?1:0);return {id,username};
  });
 },
 async changeOwnPassword(id,password,revision){const expected=revision??this.one('SELECT revision FROM users WHERE id=?',id)?.revision,encoded=await encodePassword(password);if(!this.run('UPDATE users SET password=?,must_change=0,revision=revision+1 WHERE id=? AND enabled=1 AND revision=?',encoded,id,expected).changes)fail(401,'Пользователь или пароль изменён. Войдите снова');this.audit({id},'user.password',id);return {ok:true};},
 historySeries(id){return this.all(`WITH recent AS (SELECT batch,measured,payload FROM samples WHERE device=? ORDER BY measured DESC LIMIT 360)
 SELECT r.measured,json_group_array(json_object('id',json_extract(m.value,'$.id'),'name',json_extract(m.value,'$.name'),'kind',json_extract(m.value,'$.kind'),'state',json_extract(m.value,'$.state'),'value',json_extract(m.value,'$.value'),'unit',json_extract(m.value,'$.unit'),'measuredAt',coalesce(json_extract(m.value,'$.measuredAt'),json_extract(r.payload,'$.measuredAt')))) metrics FROM recent r,json_each(r.payload,'$.metrics') m GROUP BY r.batch,r.measured ORDER BY r.measured`,id).map(r=>({measuredAt:new Date(r.measured).toISOString(),metrics:JSON.parse(r.metrics)}));},
 setUserEnabled(id,enabled,actor){if(typeof enabled!=='boolean'||typeof id!=='string')fail(400,'Некорректное состояние');const u=this.one('SELECT * FROM users WHERE id=?',id);if(!u)fail(404,'Пользователь не найден');if(u.role==='admin'||id===actor.id)fail(403,'Нельзя отключить эту учётную запись');this.run('UPDATE users SET enabled=?,revision=revision+1 WHERE id=?',+enabled,id);this.audit(actor,enabled?'user.enable':'user.disable',id);return {ok:true};},
 pauseDevice(id,enabled){if(typeof enabled!=='boolean')fail(400,'Нужно логическое значение');if(!this.run('UPDATE devices SET paused=?,pause_confirmed=0,control_seen=CASE WHEN ?=0 THEN ? ELSE control_seen END WHERE id=? AND revoked=0',+enabled,+enabled,Date.now(),id).changes)fail(404,'Устройство недоступно');return {ok:true};},
 controlDevice(id,p={},now=Date.now()){const d=this.one('SELECT * FROM devices WHERE id=? AND revoked=0',id);if(!d)fail(401,'Устройство недоступно');this.run('UPDATE devices SET control_seen=?,pause_confirmed=?,version=? WHERE id=?',now,p.paused===!!d.paused?1:0,typeof p.version==='string'?p.version.slice(0,40):d.version,id);return {paused:!!d.paused,settings:this.settings(),capabilities:{extendedSensors:true,diskWear:true,control:true},updates:this.updatePolicy()};},
 updatePolicy(){return JSON.parse(this.one("SELECT value FROM settings WHERE key='updates'")?.value||'{"enabled":false,"channel":"stable","start":0,"end":24}');},
 saveUpdatePolicy(p){if(typeof p.enabled!=='boolean'||!['stable','pilot'].includes(p.channel)||!Number.isInteger(p.start)||!Number.isInteger(p.end)||p.start<0||p.start>23||p.end<1||p.end>24||p.start===p.end)fail(400,'Некорректная политика обновлений');const policy={enabled:p.enabled,channel:p.channel,start:p.start,end:p.end};this.run("INSERT INTO settings VALUES('updates',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",JSON.stringify(policy));return policy;},
};
