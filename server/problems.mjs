import {randomUUID} from 'node:crypto';
import {fail,textField} from './errors.mjs';
export const kinds=['offline','ram','volume','temperature','gpu_temperature','cpu_load','gpu_load','fan','gpu_fan','disk_wear','smart','collector'];
const severities=['normal','warning','critical'];
const arrays=(x,name)=>{if(!Array.isArray(x)||x.length>500||x.some(v=>typeof v!=='string')||new Set(x).size!==x.length)fail(400,'Некорректный список '+name);return x;};
export function seedProblems(s){if(s.one("SELECT value FROM settings WHERE key='problemRulesMigrated'"))return;
 const defaults=[['offline','Нет связи','offline',null,'critical'],['ram','Высокое использование ОЗУ','above','ram','warning'],['volume','Том заполнен','above','volume','critical'],['temperature','Повышенная температура CPU','above','temp','warning'],['gpu_temperature','Повышенная температура GPU','above','gpu','warning'],['smart','Предупреждение SMART','above',null,'critical'],['disk_wear','Износ SSD','above',null,'warning'],['collector','Датчик недоступен','unavailable',null,'normal']];
 for(const [kind,name,condition,global,severity] of defaults){const r={id:randomUUID(),name,kind,condition,threshold:kind==='disk_wear'?85:kind==='smart'?1:0,clearThreshold:kind==='disk_wear'?80:kind==='smart'?1:0,holdSeconds:['smart','offline'].includes(kind)?0:s.settings().holdSeconds,severity,enabled:true,devices:[],groups:[],metricId:'',global,legacy:true};s.run('INSERT INTO problem_rules VALUES(?,?)',r.id,JSON.stringify(r));}
 s.run("INSERT INTO settings VALUES('problemRulesMigrated','true')");
 for(const r of s.rules()){if(!r.problemRules?.length||!r.devices.length){r.enabled=false;r.needsReview=true;r.problemRules=[];s.run('UPDATE notification_rules SET value=? WHERE id=?',JSON.stringify(r),r.id);}}
}
export const problems={
 problemRules(){return this.all('SELECT value FROM problem_rules').map(r=>JSON.parse(r.value));},
 saveProblem(p){const old=p.id&&this.one('SELECT value FROM problem_rules WHERE id=?',p.id);if(p.id&&!old)fail(404,'Правило не найдено');const name=textField(p.name,'название'),devices=arrays(p.devices,'устройства'),groups=arrays(p.groups,'группы');
  if(!kinds.includes(p.kind)||!['above','below','equals','unavailable','offline'].includes(p.condition)||!severities.includes(p.severity)||typeof p.enabled!=='boolean'||!Number.isInteger(p.holdSeconds)||p.holdSeconds<0||p.holdSeconds>86400)fail(400,'Проверьте параметры проблемы');
  if(p.kind==='offline'&&p.condition!=='offline'||p.condition==='offline'&&p.kind!=='offline')fail(400,'Условие отсутствия связи используется только для связи');
  if(!['unavailable','offline'].includes(p.condition)&&(!Number.isFinite(p.threshold)||!Number.isFinite(p.clearThreshold)||p.condition==='above'&&p.clearThreshold>p.threshold||p.condition==='below'&&p.clearThreshold<p.threshold))fail(400,'Проверьте пороги срабатывания и восстановления');
  if(devices.some(id=>!this.one('SELECT id FROM devices WHERE id=?',id))||groups.some(id=>!this.one('SELECT id FROM groups WHERE id=?',id)))fail(400,'Неизвестное устройство или группа');
  const prior=old&&JSON.parse(old.value),id=p.id||randomUUID(),r={id,name,kind:p.kind,condition:p.condition,threshold:Number(p.threshold)||0,clearThreshold:Number(p.clearThreshold)||0,holdSeconds:p.holdSeconds,severity:p.severity,enabled:p.enabled,devices,groups,metricId:p.metricId?textField(p.metricId,'ID датчика',240):'',legacy:prior?.legacy||false,configured:true,global:null};
  this.transaction(()=>{this.run('INSERT INTO problem_rules VALUES(?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value',id,JSON.stringify(r));this.run('UPDATE events SET resolved=? WHERE problem_rule=? AND resolved IS NULL',Date.now(),id);});return r;
 },
 deleteProblem(id){if(typeof id!=='string')fail(400,'Нужен ID');if(this.rules().some(r=>r.problemRules?.includes(id)))fail(400,'Сначала исключите проблему из правил уведомлений');if(!this.run('DELETE FROM problem_rules WHERE id=?',id).changes)fail(404,'Правило не найдено');this.run('UPDATE events SET resolved=? WHERE problem_rule=? AND resolved IS NULL',Date.now(),id);return {ok:true};},
 evaluateProblems(id,p,now,offlineOnly=false){const d=this.one('SELECT * FROM devices WHERE id=?',id);if(!d||d.revoked||d.paused||d.maintenance)return;const s=this.settings(),groups=this.all('SELECT grp FROM device_groups WHERE device=?',id).map(x=>x.grp);
  for(const r of this.problemRules()){
   if((r.kind==='offline')!==offlineOnly)continue;
   if(!r.enabled||r.devices.length&&!r.devices.includes(id)||r.groups.length&&!r.groups.some(g=>groups.includes(g))){this.run('UPDATE events SET resolved=? WHERE device=? AND problem_rule=? AND resolved IS NULL',now,id,r.id);continue;}
   const target=this.metricAlias(id,r.metricId,d.secret);
   const metrics=r.kind==='offline'?[{id:'offline',name:d.name,kind:'offline'}]:(p?.metrics||[]).filter(m=>(r.kind==='collector'||m.kind===r.kind)&&(!target||m.id===target)&&!(r.legacy&&r.kind==='collector'&&m.kind==='disk_wear'&&m.state==='unsupported'));
   for(const m of metrics){const key=r.legacy?(r.kind==='offline'?'offline':r.kind==='collector'?'collector:'+m.id:m.kind+':'+m.id):'problem:'+r.id+':'+m.id;
    const active=this.one('SELECT id FROM events WHERE device=? AND rule=? AND resolved IS NULL',id,key),interval=['smart','disk_wear'].includes(m.kind)?s.smartSeconds:m.kind==='volume'?s.volumeSeconds:s.fastSeconds,fresh=m.kind==='offline'||now-Date.parse(m.measuredAt||p?.measuredAt)<=Math.max(interval*2,180)*1000;
    const threshold=r.global?s[r.global+'High']:r.threshold,clear=r.global?s[r.global+'Clear']:r.clearThreshold,hold=r.global||r.kind==='collector'&&r.legacy&&!r.configured?s.holdSeconds:r.holdSeconds;
    const bad=r.condition==='offline'?now-Math.max(d.last_seen||d.created,d.control_seen||0)>s.offlineSeconds*1000:r.condition==='unavailable'?m.state!=='ok'||!fresh:m.state==='ok'&&fresh&&(r.condition==='above'?m.value>=(active?clear:threshold):r.condition==='below'?m.value<=(active?clear:threshold):m.value===threshold);
    this.event(id,key,bad,r.name+(r.kind==='offline'?'':': '+m.name),now,hold);
    this.run('UPDATE events SET severity=?,problem_rule=?,kind=?,metric_id=? WHERE device=? AND rule=? AND resolved IS NULL',r.severity,r.id,r.kind,m.id,id,key);
   }
  }
 },
};
