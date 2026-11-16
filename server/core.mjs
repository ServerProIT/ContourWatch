import {DatabaseSync} from 'node:sqlite';
import {randomBytes,randomUUID,createHash,timingSafeEqual} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {management} from './management.mjs';
import {platform,migratePlatform} from './platform.mjs';
import {problems,seedProblems} from './problems.mjs';
import {ApiError,fail,textField} from './errors.mjs';
export {ApiError,fail,textField};
export const hash=s=>createHash('sha256').update(s).digest('hex');
export const equal=(a,b)=>{if(typeof a!=='string'||typeof b!=='string')return false;const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
export const defaults={fastSeconds:60,volumeSeconds:300,smartSeconds:900,offlineSeconds:180,ramHigh:90,ramClear:85,tempHigh:85,tempClear:80,gpuHigh:85,gpuClear:80,volumeHigh:90,volumeClear:85,holdSeconds:120,historyDays:30,aggregateDays:365,autoUpdate:true,updateWindowStart:0,updateWindowEnd:24};
export const capabilities={extendedSensors:true,diskWear:true,control:true};
export function validate(p,now=Date.now()){
 if(!p||typeof p!=='object'||Array.isArray(p))fail(400,'Ожидается объект');
 textField(p.batchId,'batchId',80); const t=Date.parse(p.measuredAt);
 if(!Number.isFinite(t)||t>now+300000||t<now-8*86400000)fail(400,'Недопустимое время измерения');
 if(!Array.isArray(p.metrics)||p.metrics.length>512)fail(400,'Не более 512 метрик');
 const ids=new Set();
 for(const m of p.metrics){if(!m||typeof m!=='object'||Array.isArray(m))fail(400,'Метрика должна быть объектом');textField(m.id,'id',240);textField(m.name,'name');textField(m.source,'source',80);
 if(ids.has(m.id))fail(400,'Повторный id метрики');ids.add(m.id);
 if(!['ok','unsupported','denied','error','stale'].includes(m.state))fail(400,'Неизвестное состояние');
 if(!['ram','volume','temperature','fan','smart','collector','cpu_load','gpu_temperature','gpu_load','gpu_fan','gpu_memory_used','gpu_memory_total','disk_wear'].includes(m.kind))fail(400,'Неизвестный тип');
 if(m.state==='ok'&&(typeof m.value!=='number'||!Number.isFinite(m.value)))fail(400,'Нужен числовой показатель');
 if(m.state!=='ok'&&m.value!=null)fail(400,'Недоступная метрика не имеет значения');
 if(m.unit!=null&&(typeof m.unit!=='string'||m.unit.length>20))fail(400,'Некорректная единица');
 if(m.measuredAt&&(!Number.isFinite(Date.parse(m.measuredAt))||Date.parse(m.measuredAt)>t+300000))fail(400,'Время метрики некорректно');
 if(m.state==='ok'&&['ram','volume'].includes(m.kind)&&(m.value<0||m.value>100))fail(400,'Процент вне диапазона');
 if(m.state==='ok'&&['cpu_load','gpu_load','gpu_fan'].includes(m.kind)&&(m.value<0||m.value>100))fail(400,'Процент вне диапазона');
 if(m.state==='ok'&&['gpu_memory_used','gpu_memory_total'].includes(m.kind)&&m.value<0)fail(400,'Объём памяти отрицательный');
 if(m.state==='ok'&&m.kind==='disk_wear'&&(m.value<0||m.value>255))fail(400,'Износ вне диапазона 0–255');
 } return t;
}
export function settingsPatch(p,current=defaults){
 if(!p||typeof p!=='object'||Array.isArray(p))fail(400,'Некорректные настройки');
 const bounds={fastSeconds:[30,3600],volumeSeconds:[60,86400],smartSeconds:[300,86400],offlineSeconds:[90,86400],ramHigh:[1,100],ramClear:[0,99],tempHigh:[30,120],tempClear:[0,119],gpuHigh:[30,120],gpuClear:[0,119],volumeHigh:[1,100],volumeClear:[0,99],holdSeconds:[0,86400],historyDays:[1,365],aggregateDays:[1,3650],updateWindowStart:[0,23],updateWindowEnd:[1,24]};
 for(const [k,v]of Object.entries(p)){if(k==='autoUpdate'){if(typeof v!=='boolean')fail(400,'autoUpdate: boolean');}else if(!bounds[k]||!Number.isInteger(v)||v<bounds[k][0]||v>bounds[k][1])fail(400,'Недопустимая настройка '+k);}
 const s={...current,...p};for(const k of ['ram','temp','gpu','volume'])if(s[k+'Clear']>=s[k+'High'])fail(400,'Порог восстановления должен быть ниже порога срабатывания');
 if(s.updateWindowStart>=s.updateWindowEnd)fail(400,'Окно установки должно быть в пределах суток UTC');return s;
}
export class Store{
 constructor(file=':memory:'){this.db=new DatabaseSync(file);this.db.exec('PRAGMA busy_timeout=5000');this.db.exec(readFileSync(new URL('./001.sql',import.meta.url),'utf8'));if(!this.db.prepare('PRAGMA table_info(aggregates)').all().some(c=>c.name==='ram_count'))this.db.exec(readFileSync(new URL('./002.sql',import.meta.url),'utf8'));this.transaction(()=>{this.db.exec(readFileSync(new URL('./003.sql',import.meta.url),'utf8'));if(!this.one("SELECT value FROM settings WHERE key='groupsMigrated'")){for(const d of this.all('SELECT id,grp FROM devices')){const g=this.ensureGroup(d.grp);this.run('INSERT OR IGNORE INTO device_groups VALUES(?,?)',d.id,g.id);}this.run("INSERT INTO settings VALUES('groupsMigrated','true')");}migratePlatform(this);seedProblems(this);});}
 close(){this.db.close();} run(q,...v){return this.db.prepare(q).run(...v);} one(q,...v){return this.db.prepare(q).get(...v);} all(q,...v){return this.db.prepare(q).all(...v);}
 transaction(fn){this.db.exec('BEGIN IMMEDIATE');try{const v=fn();this.db.exec('COMMIT');return v;}catch(e){this.db.exec('ROLLBACK');throw e;}}
 settings(){const r=this.one("SELECT value FROM settings WHERE key='global'");return {...defaults,...(r?JSON.parse(r.value):{})};}
 saveSettings(p){const s=settingsPatch(p,this.settings());this.run("INSERT INTO settings VALUES('global',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",JSON.stringify(s));return s;}
 token(uses=1,minutes=60,now=Date.now()){if(!Number.isInteger(uses)||uses<1||uses>300||!Number.isInteger(minutes)||minutes<1||minutes>10080)fail(400,'Некорректный срок или число регистраций');const token=randomBytes(32).toString('base64url');this.run('INSERT INTO tokens VALUES(?,?,?)',hash(token),now+minutes*60000,uses);return {token,expiresAt:new Date(now+minutes*60000).toISOString(),uses};}
 register(p,now=Date.now()){const name=textField(p.name,'name'),group=textField(p.group||'Без группы','group'),os=textField(p.os,'os'),version=textField(p.version,'version',40);textField(p.token,'token',128);
 let requestedId=null,requestedSecret=null;if(p.requestId!=null||p.deviceSecret!=null){if(typeof p.requestId!=='string'||! /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(p.requestId)||typeof p.deviceSecret!=='string'||! /^[a-zA-Z0-9_-]{43,128}$/.test(p.deviceSecret))fail(400,'Некорректный идентификатор регистрации');requestedId=p.requestId;requestedSecret=p.deviceSecret;}
 return this.transaction(()=>{if(requestedId){const old=this.one('SELECT * FROM devices WHERE id=?',requestedId);if(old){if(old.revoked||!equal(old.secret,hash(requestedSecret)))fail(403,'Регистрация отклонена');return {id:requestedId,secret:requestedSecret,settings:this.settings()};}}
 const t=this.one('SELECT * FROM tokens WHERE hash=?',hash(p.token));if(!t||t.expires<=now||t.remaining<1)fail(403,'Токен истёк или использован');
 const id=requestedId||randomUUID(),secret=requestedSecret||randomBytes(32).toString('base64url');this.run('INSERT INTO devices(id,secret,name,grp,os,version,created) VALUES(?,?,?,?,?,?,?)',id,hash(secret),name,group,os,version,now);this.run('INSERT INTO device_groups VALUES(?,?)',id,this.ensureGroup(group).id);this.run('UPDATE tokens SET remaining=remaining-1 WHERE hash=?',hash(p.token));return {id,secret,settings:this.settings()};});}
 auth(id,secret){const d=this.one('SELECT * FROM devices WHERE id=?',id||'');if(!d||d.revoked||!equal(d.secret,hash(secret||'')))fail(401,'Учётные данные отозваны или неверны');return d;}
 ingest(id,p,now=Date.now()){const t=validate(p,now);return this.transaction(()=>{
 const d=this.one('SELECT * FROM devices WHERE id=?',id);if(!d||d.revoked)fail(401,'Устройство недоступно');if(d.paused){this.run('UPDATE devices SET control_seen=? WHERE id=?',now,id);return {accepted:true,paused:true,settings:this.settings(),capabilities};}
 const result=this.run('INSERT OR IGNORE INTO samples VALUES(?,?,?,?,?)',id,p.batchId,t,now,JSON.stringify(p));
 if(result.changes){if(!d.measured||t>d.measured){this.run('UPDATE devices SET measured=?,latest=?,version=? WHERE id=?',t,JSON.stringify(p),String(p.version||d.version).slice(0,40),id);
 // Replayed historical samples never open current alerts.
 if(now-t<=this.settings().offlineSeconds*1000&&!d.maintenance)this.evaluate(id,p,now);}
 this.aggregate(id,p,t);}
 this.run('UPDATE devices SET last_seen=? WHERE id=?',now,id);this.event(id,'offline',false,'Нет связи',now,0);
 return {accepted:true,duplicate:!result.changes,settings:this.settings(),capabilities};});}
 event(device,rule,bad,title,now,hold=0){const e=this.one('SELECT * FROM events WHERE device=? AND rule=? AND resolved IS NULL',device,rule);
 if(bad){if(!e)this.run('INSERT INTO events(id,device,rule,title,started,opened) VALUES(?,?,?,?,?,?)',randomUUID(),device,rule,title,now,hold===0?now:null);else if(e.opened==null&&now-e.started>=hold*1000)this.run('UPDATE events SET opened=? WHERE id=?',now,e.id);}
 else if(e)this.run('UPDATE events SET resolved=? WHERE id=?',now,e.id);}
 evaluate(id,p,now){return this.evaluateProblems(id,p,now);}
 tick(now=Date.now()){for(const d of this.all('SELECT id FROM devices WHERE revoked=0 AND maintenance=0 AND paused=0'))this.evaluateProblems(d.id,null,now,true);}
 decorate(d,now){if(!d)return null;const groups=this.all('SELECT g.* FROM groups g JOIN device_groups dg ON dg.grp=g.id WHERE dg.device=? ORDER BY g.name',d.id),counts={normal:0,warning:0,critical:0};for(const e of this.all('SELECT severity,count(*) n FROM events WHERE device=? AND opened IS NOT NULL AND resolved IS NULL GROUP BY severity',d.id))counts[e.severity]=e.n;return {...d,groups,grp:groups.map(g=>g.name).join(', ')||'Без группы',latest:d.latest?JSON.parse(d.latest):null,status:d.revoked?'revoked':d.paused?'paused':d.maintenance?'maintenance':!Math.max(d.last_seen||0,d.control_seen||0)||now-Math.max(d.last_seen||0,d.control_seen||0)>this.settings().offlineSeconds*1000?'offline':'online',problemCounts:counts,problems:d.paused||d.revoked||d.maintenance?0:Object.values(counts).reduce((a,b)=>a+b,0)};}
 device(id,now=Date.now()){this.evaluateProblems(id,null,now,true);return this.decorate(this.one('SELECT id,name,grp,os,version,last_seen,measured,latest,maintenance,revoked,paused,control_seen,pause_confirmed FROM devices WHERE id=?',id),now);}
 devices(now=Date.now()){this.tick(now);return this.all('SELECT id,name,grp,os,version,last_seen,measured,latest,maintenance,revoked,paused,control_seen,pause_confirmed FROM devices ORDER BY name').map(d=>this.decorate(d,now));}
 history(id,limit=360){return this.all('SELECT measured,payload FROM samples WHERE device=? ORDER BY measured DESC LIMIT ?',id,limit).reverse().map(r=>JSON.parse(r.payload));}
 events(id){return this.all('SELECT * FROM events WHERE opened IS NOT NULL'+(id?' AND device=?':'')+' ORDER BY started DESC LIMIT 1000',...(id?[id]:[]));}
 maintain(id,on){if(typeof on!=='boolean')fail(400,'Нужно логическое значение');if(!this.run('UPDATE devices SET maintenance=? WHERE id=?',on?1:0,id).changes)fail(404,'Устройство не найдено');}
 aggregate(id,p,t){const values=k=>p.metrics.filter(m=>m.kind===k&&m.state==='ok').map(m=>m.value);const r=values('ram'),temp=values('temperature');const ram=r.length?Math.max(...r):null,temperature=temp.length?Math.max(...temp):null;
 this.run(`INSERT INTO aggregates(device,hour,ram_avg,ram_max,temp_max,count,ram_count) VALUES(?,?,?,?,?,1,?) ON CONFLICT(device,hour) DO UPDATE SET ram_avg=CASE WHEN excluded.ram_count=0 THEN aggregates.ram_avg WHEN aggregates.ram_count=0 THEN excluded.ram_avg ELSE (aggregates.ram_avg*aggregates.ram_count+excluded.ram_avg)/(aggregates.ram_count+1) END,ram_max=CASE WHEN aggregates.ram_max IS NULL THEN excluded.ram_max WHEN excluded.ram_max IS NULL THEN aggregates.ram_max ELSE max(aggregates.ram_max,excluded.ram_max) END,temp_max=CASE WHEN aggregates.temp_max IS NULL THEN excluded.temp_max WHEN excluded.temp_max IS NULL THEN aggregates.temp_max ELSE max(aggregates.temp_max,excluded.temp_max) END,count=aggregates.count+1,ram_count=aggregates.ram_count+excluded.ram_count`,id,Math.floor(t/3600000)*3600000,ram,ram,temperature,r.length?1:0);}
 prune(now=Date.now()){const s=this.settings();this.transaction(()=>{
 this.run('DELETE FROM samples WHERE measured<?',now-s.historyDays*86400000);this.run('DELETE FROM aggregates WHERE hour<?',now-s.aggregateDays*86400000);this.run('DELETE FROM tokens WHERE expires<? OR remaining=0',now);this.run('DELETE FROM events WHERE resolved IS NOT NULL AND resolved<?',now-s.aggregateDays*86400000);
 });}
}
Object.assign(Store.prototype,management,platform,problems);
