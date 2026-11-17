import {randomBytes,randomUUID,scrypt as scryptCallback,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {fail,textField} from './errors.mjs';
import {validateLayout} from './layout.mjs';
import {validateDashboard} from './dashboard.mjs';
const scrypt=promisify(scryptCallback),roles=['admin','manager','viewer'];
const publicUser=u=>({id:u.id,username:u.username,role:u.role,created:u.created,enabled:!!u.enabled});
export const columnIds=['name','status','smart','cpu','gpu','fan','ram','volume','problems','seen'];
export const problemKinds=['offline','ram','temperature','gpu_temperature','volume','smart','collector','disk_wear','cpu_load','gpu_load','fan','gpu_fan'];
export function email(value){if(typeof value!=='string'||value.length>254||! /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/.test(value))fail(400,'Некорректный email');return value;}
function list(value,name,max=200){if(!Array.isArray(value)||value.length>max||value.some(x=>typeof x!=='string')||new Set(value).size!==value.length)fail(400,'Некорректный список '+name);return value;}
const optionalId=p=>{if(p.id!==undefined)textField(p.id,'ID',64);};
const fold=s=>s.normalize('NFC').toLocaleLowerCase('ru');
async function passwordHash(password){if(typeof password!=='string'||password.length<12||password.length>256)fail(400,'Пароль: от 12 до 256 символов');const salt=randomBytes(16).toString('hex');return salt+':'+(await scrypt(password,salt,64)).toString('hex');}
// An unknown login still performs the same password derivation.
const dummy='0'.repeat(32)+':'+ '0'.repeat(128);
export const management={
 deleteRevokedDevice(id,actor){
  if(!['admin','manager'].includes(actor?.role))fail(403,'Нужна роль менеджера или администратора');
  return this.transaction(()=>{
   const d=this.one('SELECT revoked FROM devices WHERE id=?',id);if(!d)fail(404,'Устройство не найдено');if(!d.revoked)fail(409,'Сначала отзовите доступ устройства');
   // Empty device lists mean "all": disable a rule when its last explicit PC is removed.
   for(const table of ['problem_rules','notification_rules'])for(const row of this.all(`SELECT id,value FROM ${table}`)){
    const rule=JSON.parse(row.value);if(!rule.devices?.includes(id))continue;rule.devices=rule.devices.filter(x=>x!==id);if(!rule.devices.length)rule.enabled=false;
    this.run(`UPDATE ${table} SET value=? WHERE id=?`,JSON.stringify(rule),row.id);
    if(!rule.enabled)this.run("UPDATE notification_queue SET status='cancelled',error='Устройство удалено' WHERE rule=? AND status='pending'",row.id);
   }
   for(const row of this.all('SELECT owner,value FROM preferences')){
    const p=JSON.parse(row.value);if(!p.dashboard)continue;const old=JSON.stringify(p.dashboard);
    p.dashboard.widgets=p.dashboard.widgets.map(w=>({...w,devices:w.devices.filter(x=>x!==id)})).filter(w=>w.devices.length);
    if(JSON.stringify(p.dashboard)!==old)this.run('UPDATE preferences SET value=? WHERE owner=?',JSON.stringify(p),row.owner);
   }
   for(const table of ['samples','aggregates','device_groups','events'])this.run(`DELETE FROM ${table} WHERE device=?`,id);
   this.run('DELETE FROM devices WHERE id=?',id);this.audit(actor,'device.delete',id);return {ok:true};
  });
 },
 users(){return this.all('SELECT id,username,role,created,enabled FROM users ORDER BY username');},
 async loginUser(username,password){const valid=typeof username==='string'&&username.length<=64&&typeof password==='string'&&password.length<=256;const u=valid?this.one('SELECT * FROM users WHERE username=?',fold(username)):null;const [salt,expected]=(u?.password||dummy).split(':');const actual=await scrypt(typeof password==='string'?password.slice(0,256):'',salt,64);return u&&u.enabled&&timingSafeEqual(actual,Buffer.from(expected,'hex'))?u:null;},
 async saveUser(p,actor){optionalId(p);const old=p.id?this.one('SELECT * FROM users WHERE id=?',p.id):null;if(p.id&&!old)fail(404,'Пользователь не найден');
  if(old?.role==='admin'&&actor.role!=='admin')fail(403,'Менеджер не может изменять администратора');
  const username=textField(fold(textField(p.username,'логин',64)),'логин',64);if(!/^[\p{L}\p{N}_.@-]+$/u.test(username))fail(400,'Логин: буквы, цифры и _.@-');
  if(!roles.includes(p.role)||p.role==='admin'&&(!old||old.role!=='admin')||old?.role==='admin'&&p.role!=='admin')fail(403,'Недопустимая роль');
  if(old?.id===actor.id&&p.role!==old.role)fail(400,'Нельзя изменять собственную роль');
  const password=p.password?await passwordHash(p.password):old?.password;if(!password)fail(400,'Укажите пароль');
  return this.transaction(()=>{if(actor.revision){const current=this.one('SELECT revision,role FROM users WHERE id=?',actor.id);if(!current||current.revision!==actor.revision||current.role!==actor.role)fail(401,'Права изменены. Войдите снова');}const fresh=old&&this.one('SELECT * FROM users WHERE id=?',old.id);if(old&&(!fresh||fresh.revision!==old.revision))fail(409,'Пользователь изменён, обновите список');
   if(this.one('SELECT id FROM users WHERE username=? AND id<>?',username,old?.id||''))fail(409,'Логин уже занят');
   const id=old?.id||randomUUID();this.run('INSERT INTO users(id,username,password,role,created) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET username=excluded.username,password=excluded.password,role=excluded.role,revision=users.revision+1',id,username,password,p.role,Date.now());this.audit(actor,'user.save',id);return publicUser(this.one('SELECT * FROM users WHERE id=?',id));});
 },
 deleteUser(id,actor){textField(id,'ID',64);const old=this.one('SELECT * FROM users WHERE id=?',id);if(!old)fail(404,'Пользователь не найден');if(old.role==='admin'||old.id===actor.id)fail(403,'Нельзя удалить этого пользователя');this.transaction(()=>{this.run('DELETE FROM users WHERE id=?',id);this.run('DELETE FROM preferences WHERE owner=?',id);this.audit(actor,'user.delete',id);});return {ok:true};},
 audit(actor,action,target){this.run('INSERT INTO audit(at,actor,action,target) VALUES(?,?,?,?)',Date.now(),actor.id,action,target);},
 preferences(owner){return JSON.parse(this.one('SELECT value FROM preferences WHERE owner=?',owner)?.value||'{}');},
 savePreferences(owner,p){if(!p||typeof p!=='object'||Array.isArray(p)||!Object.keys(p).length||Object.keys(p).some(k=>!['columns','layout','dashboard'].includes(k)))fail(400,'Некорректные настройки вида');const value={...this.preferences(owner)};if(p.columns!==undefined){const columns=list(p.columns,'колонки',columnIds.length);if(!columns.length||columns.some(c=>!columnIds.includes(c)))fail(400,'Выберите хотя бы одну известную колонку');value.columns=columns;}if(p.layout!==undefined)value.layout=validateLayout(p.layout);if(p.dashboard!==undefined){value.dashboard=validateDashboard(p.dashboard);for(const w of value.dashboard.widgets)for(const id of w.devices)if(!this.one('SELECT id FROM devices WHERE id=?',id))fail(400,'Устройство блока не найдено');}this.run('INSERT INTO preferences VALUES(?,?) ON CONFLICT(owner) DO UPDATE SET value=excluded.value',owner,JSON.stringify(value));return value;},
 groups(){return this.all('SELECT * FROM groups ORDER BY name');},
 ensureGroup(name){name=textField(name,'группа');let g=this.groups().find(g=>fold(g.name)===fold(name));if(!g){g={id:randomUUID(),name};this.run('INSERT INTO groups VALUES(?,?)',g.id,g.name);}return g;},
 saveGroup(p){optionalId(p);const name=textField(p.name,'группа');if(this.groups().some(g=>g.id!==p.id&&fold(g.name)===fold(name)))fail(409,'Группа уже существует');const id=p.id||randomUUID();if(p.id){if(!this.run('UPDATE groups SET name=? WHERE id=?',name,id).changes)fail(404,'Группа не найдена');}else this.run('INSERT INTO groups VALUES(?,?)',id,name);return {id,name};},
 deleteGroup(id){textField(id,'ID',64);if(this.problemRules().some(r=>r.groups.includes(id)))fail(400,'Сначала исключите группу из конструктора проблем');if(this.rules().some(r=>r.groups.includes(id)))fail(400,'Сначала исключите группу из правил оповещений');if(!this.run('DELETE FROM groups WHERE id=?',id).changes)fail(404,'Группа не найдена');return {ok:true};},
 setDeviceGroups(id,ids){list(ids,'группы');if(ids.some(g=>!this.one('SELECT id FROM groups WHERE id=?',g)))fail(400,'Неизвестная группа');this.run('DELETE FROM device_groups WHERE device=?',id);for(const g of ids)this.run('INSERT INTO device_groups VALUES(?,?)',id,g);},
 editDevice(id,p){const name=textField(p.name,'имя');return this.transaction(()=>{if(!this.one('SELECT id FROM devices WHERE id=?',id))fail(404,'Устройство не найдено');const ids=p.groups??[this.ensureGroup(p.group).id];this.setDeviceGroups(id,ids);this.run('UPDATE devices SET name=?,grp=? WHERE id=?',name,ids.map(g=>this.one('SELECT name FROM groups WHERE id=?',g).name).join(', ')||'Без группы',id);return {ok:true};});},
 channels(){return this.all('SELECT * FROM notification_channels ORDER BY name').map(c=>({...c,recipients:JSON.parse(c.recipients),enabled:!!c.enabled}));},
 saveChannel(p){optionalId(p);const name=textField(p.name,'название');const recipients=list(p.recipients,'получатели',20).map(email);if(!recipients.length)fail(400,'Укажите получателей');if(typeof p.enabled!=='boolean')fail(400,'Нужно состояние канала');const id=p.id||randomUUID();if(p.id&&!this.one('SELECT id FROM notification_channels WHERE id=?',id))fail(404,'Канал не найден');this.run('INSERT INTO notification_channels VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,recipients=excluded.recipients,enabled=excluded.enabled',id,name,JSON.stringify(recipients),+p.enabled);return {id};},
 rules(){return this.all('SELECT value FROM notification_rules').map(r=>JSON.parse(r.value));},
 saveRule(p){optionalId(p);const name=textField(p.name,'название'),devices=list(p.devices,'устройства'),groups=list(p.groups,'группы'),kinds=list(p.kinds,'проблемы',problemKinds.length),channels=list(p.channels,'каналы');
  if(!kinds.length||kinds.some(k=>!problemKinds.includes(k))||!channels.length||channels.some(c=>!this.one('SELECT id FROM notification_channels WHERE id=?',c))||devices.some(d=>!this.one('SELECT id FROM devices WHERE id=?',d))||groups.some(g=>!this.one('SELECT id FROM groups WHERE id=?',g)))fail(400,'Проверьте устройства, группы, проблемы и каналы');
  if(typeof p.enabled!=='boolean'||typeof p.recovery!=='boolean'||!Number.isInteger(p.delaySeconds)||p.delaySeconds<0||p.delaySeconds>86400)fail(400,'Некорректные параметры правила');
  const problemRules=p.problemRules==null?[]:list(p.problemRules,'проблемы');if(!problemRules.length||!devices.length)fail(400,'Выберите конкретные ПК и проблемы');if(problemRules.some(id=>!this.one('SELECT id FROM problem_rules WHERE id=?',id)))fail(400,'Неизвестная проблема');const metricId=p.metricId==null||p.metricId===''?'':textField(p.metricId,'ID датчика',240);const id=p.id||randomUUID();if(p.id&&!this.one('SELECT id FROM notification_rules WHERE id=?',id))fail(404,'Правило не найдено');const value={id,name,devices,groups,kinds,channels,problemRules,metricId,enabled:p.enabled,recovery:p.recovery,delaySeconds:p.delaySeconds};this.run('INSERT INTO notification_rules VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',id,JSON.stringify(value));return value;
 },
 deleteNotification(type,id){textField(id,'ID',64);if(type==='channel'&&this.rules().some(r=>r.channels.includes(id)))fail(400,'Сначала исключите канал из правил оповещений');const table=type==='channel'?'notification_channels':'notification_rules';return this.transaction(()=>{if(!this.run(`DELETE FROM ${table} WHERE id=?`,id).changes)fail(404,'Не найдено');if(type==='rule')this.run("UPDATE notification_queue SET status='cancelled' WHERE rule=? AND status='pending'",id);return {ok:true};});},
 notificationLog(){return this.all('SELECT q.id,q.event,q.phase,q.status,q.attempts,q.created,q.sent,q.error,c.name channel FROM notification_queue q JOIN notification_channels c ON c.id=q.channel ORDER BY q.created DESC LIMIT 100');},
 queueNotifications(now=Date.now()){
  const rules=this.rules().filter(r=>r.enabled),channels=new Set(this.channels().filter(c=>c.enabled).map(c=>c.id));
  for(const e of this.all('SELECT e.*,d.name device_name,d.maintenance,d.revoked,d.paused FROM events e JOIN devices d ON d.id=e.device WHERE e.opened IS NOT NULL AND d.revoked=0 AND d.maintenance=0 AND d.paused=0')){
   const memberships=this.all('SELECT grp FROM device_groups WHERE device=?',e.device).map(g=>g.grp),kind=e.kind||e.rule.split(':')[0],metricId=e.metric_id||(e.rule.includes(':')?e.rule.slice(e.rule.indexOf(':')+1):'');
   for(const r of rules){if((r.problemRules?.length?!r.problemRules.includes(e.problem_rule):!r.kinds.includes(kind))||r.devices.length&&!r.devices.includes(e.device)||r.groups.length&&!r.groups.some(g=>memberships.includes(g))||r.metricId&&r.metricId!==metricId)continue;
    for(const c of r.channels){if(!channels.has(c))continue;
     const enqueue=phase=>this.run("INSERT INTO notification_queue(id,event,rule,channel,phase,next_try,created) VALUES(?,?,?,?,?,?,?) ON CONFLICT(event,rule,channel,phase) DO UPDATE SET status='pending',attempts=0,next_try=excluded.next_try,error=NULL WHERE notification_queue.status='cancelled'",randomUUID(),e.id,r.id,c,phase,now,now);
     if(!e.resolved&&now>=e.opened+r.delaySeconds*1000)enqueue('open');
     if(e.resolved&&r.recovery&&this.one("SELECT id FROM notification_queue WHERE event=? AND rule=? AND channel=? AND phase='open' AND status='sent'",e.id,r.id,c))enqueue('recovery');
    }
   }
  }
 },
};
