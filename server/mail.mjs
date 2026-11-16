import net from 'node:net';
import tls from 'node:tls';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {email} from './management.mjs';

export function mailConfig(env=process.env){
 if(!env.SMTP_HOST)return null;
 const host=env.SMTP_HOST,mode=env.SMTP_MODE||'starttls',port=Number(env.SMTP_PORT||(mode==='tls'?465:587));
 if(!/^[a-zA-Z0-9.-]+$/.test(host)||!['tls','starttls'].includes(mode)||!Number.isInteger(port)||port<1||port>65535)throw Error('Некорректные SMTP_HOST / SMTP_PORT / SMTP_MODE');
 if(env.SMTP_PASSWORD&&env.SMTP_PASSWORD_FILE)throw Error('Выберите SMTP_PASSWORD или SMTP_PASSWORD_FILE');
 const password=env.SMTP_PASSWORD_FILE?readFileSync(env.SMTP_PASSWORD_FILE,'utf8').trim():env.SMTP_PASSWORD;
 if(Boolean(env.SMTP_USER)!==Boolean(password)||password?.includes('\0')||env.SMTP_USER?.includes('\0'))throw Error('Укажите SMTP_USER и пароль вместе');
 return {host,port,mode,from:email(env.SMTP_FROM),user:env.SMTP_USER,password};
}

// Bounded line parser: replies can arrive split over TCP packets or as multiline EHLO.
function replies(socket){
 let buffer='',lines=[],ready=[],waiter=null,failure=null;
 const reject=e=>{failure=e;if(waiter){waiter.reject(e);waiter=null;}};
 const data=chunk=>{buffer+=chunk.toString('utf8');if(buffer.length>65536||lines.length>200){reject(Error('SMTP_PROTOCOL'));socket.destroy();return;}
  while(buffer.includes('\r\n')){const i=buffer.indexOf('\r\n'),line=buffer.slice(0,i);buffer=buffer.slice(i+2);if(!/^\d{3}[ -]/.test(line)){reject(Error('SMTP_PROTOCOL'));socket.destroy();return;}lines.push(line);if(line[3]===' '){const result={code:Number(line.slice(0,3)),lines};lines=[];if(waiter){const w=waiter;waiter=null;w.resolve(result);}else {ready.push(result);if(ready.length>10){reject(Error('SMTP_PROTOCOL'));socket.destroy();return;}}}}
 };
 const closed=()=>reject(Error('SMTP_CLOSED')),error=()=>reject(Error('SMTP_CONNECTION'));
 socket.on('data',data);socket.on('error',error);socket.on('close',closed);
 return {next:()=>failure?Promise.reject(failure):ready.length?Promise.resolve(ready.shift()):new Promise((resolve,reject)=>{waiter={resolve,reject};}),detach(){socket.off('data',data);socket.off('error',error);socket.off('close',closed);}};
}
function connect(socket,event){return new Promise((resolve,reject)=>{const done=()=>{socket.off('error',bad);resolve();},bad=()=>{socket.off(event,done);reject(Error('SMTP_CONNECTION'));};socket.once(event,done);socket.once('error',bad);});}
export async function sendMail(config,{recipients,subject,text}){
 if(!config)throw Error('SMTP_NOT_CONFIGURED');
 const from=email(config.from);recipients=recipients.map(email);if(!recipients.length)throw Error('SMTP_RECIPIENT');
 const options={host:config.host,port:config.port,servername:net.isIP(config.host)?undefined:config.host,minVersion:'TLSv1.2',rejectUnauthorized:true,...(config.ca?{ca:config.ca}:{})};
 let socket=config.mode==='tls'?tls.connect(options):net.connect(options),reader=replies(socket);
 // Includes DNS, TLS, all commands and DATA; a stalled relay cannot hold a worker forever.
 const deadline=setTimeout(()=>socket.destroy(Error('SMTP_TIMEOUT')),30000);deadline.unref();
 const expect=async codes=>{const r=await reader.next();if(!codes.includes(r.code))throw Error('SMTP_'+r.code);return r;};
 const command=async(s,codes)=>{socket.write(s+'\r\n');return expect(codes);};
 try{
  await connect(socket,config.mode==='tls'?'secureConnect':'connect');await expect([220]);let hello=await command('EHLO contourwatch.local',[250]);
  if(config.mode==='starttls'){
   if(!hello.lines.some(l=>/^250[ -]STARTTLS\b/i.test(l)))throw Error('SMTP_TLS_REQUIRED');
   await command('STARTTLS',[220]);reader.detach();socket=tls.connect({...options,socket});reader=replies(socket);await connect(socket,'secureConnect');hello=await command('EHLO contourwatch.local',[250]);
  }
  if(config.user){
   const auth=hello.lines.find(l=>/^250[ -]AUTH\b/i.test(l))||'';
   if(/\bPLAIN\b/i.test(auth))await command('AUTH PLAIN '+Buffer.from('\0'+config.user+'\0'+config.password).toString('base64'),[235]);
   else if(/\bLOGIN\b/i.test(auth)){await command('AUTH LOGIN',[334]);await command(Buffer.from(config.user).toString('base64'),[334]);await command(Buffer.from(config.password).toString('base64'),[235]);}
   else throw Error('SMTP_AUTH_UNSUPPORTED');
  }
  await command('MAIL FROM:<'+from+'>',[250]);for(const r of recipients)await command('RCPT TO:<'+r+'>',[250,251]);await command('DATA',[354]);
  const encoded=Buffer.from(String(text),'utf8').toString('base64').match(/.{1,76}/g)?.join('\r\n')||'';
  const safeSubject=String(subject).replace(/[\r\n]/g,' ').slice(0,90),words=Array.from(safeSubject).reduce((a,c)=>{if(Buffer.byteLength(a.at(-1)+c)>36)a.push('');a[a.length-1]+=c;return a;},['']).map(s=>'=?UTF-8?B?'+Buffer.from(s).toString('base64')+'?=').join('\r\n ');
  socket.write(`From: <${from}>\r\nTo: ${recipients.map(r=>'<'+r+'>').join(',\r\n ')}\r\nSubject: ${words}\r\nDate: ${new Date().toUTCString()}\r\nMessage-ID: <${randomUUID()}@contourwatch.local>\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${encoded}\r\n.\r\n`);await expect([250]);
  // DATA 250 is the delivery acknowledgement. QUIT loss must not trigger a duplicate.
  socket.end('QUIT\r\n');
 }finally{clearTimeout(deadline);socket.destroy();reader.detach();}
}

export function notificationWorker(store,{config=null,send=sendMail}={}){
 let busy=false,stopped=false,drained=[];
 return {stop(){stopped=true;return busy?new Promise(resolve=>drained.push(resolve)):Promise.resolve();},async run(now=Date.now()){
  if(busy||stopped)return;busy=true;
  try{
   store.queueNotifications(now);
   for(const q of store.all("SELECT * FROM notification_queue WHERE status='pending' AND next_try<=? ORDER BY created LIMIT 20",now)){
    if(stopped)break;
    const c=store.channels().find(c=>c.id===q.channel),r=store.rules().find(r=>r.id===q.rule),e=q.event&&store.one('SELECT e.*,d.name,d.revoked,d.maintenance FROM events e JOIN devices d ON d.id=e.device WHERE e.id=?',q.event);
    const membership=e?store.all('SELECT grp FROM device_groups WHERE device=?',e.device).map(g=>g.grp):[];
    if(!c?.enabled||q.event&&(!r?.enabled||!r.channels.includes(q.channel)||!e||e.revoked||e.maintenance||q.phase==='open'&&e.resolved||r.devices.length&&!r.devices.includes(e.device)||r.groups.length&&!r.groups.some(g=>membership.includes(g))||!r.kinds.includes(e.rule.split(':')[0])||r.metricId&&r.metricId!==e.rule.slice(e.rule.indexOf(':')+1)||q.phase==='recovery'&&!r.recovery)){
     store.run("UPDATE notification_queue SET status='cancelled' WHERE id=?",q.id);continue;
    }
    if(!config){store.run("UPDATE notification_queue SET error='SMTP_NOT_CONFIGURED',next_try=? WHERE id=?",now+60000,q.id);continue;}
    if(e&&q.phase==='open'&&now<e.opened+r.delaySeconds*1000){store.run('UPDATE notification_queue SET next_try=? WHERE id=?',e.opened+r.delaySeconds*1000,q.id);continue;}
    try{
     await send(config,{recipients:c.recipients,subject:q.phase==='test'?'Контур: проверка почты':`${q.phase==='recovery'?'Восстановлено':'Проблема'}: ${e.name}`,text:e?`Устройство: ${e.name}\nПроблема: ${e.title}\nПравило: ${e.rule}\nСостояние: ${q.phase==='recovery'?'Восстановлено':'Активно'}\nНачало: ${new Date(e.opened).toISOString()}\n${e.resolved?'Восстановление: '+new Date(e.resolved).toISOString():''}`:'Проверочное уведомление ContourWatch. Доставка работает.'});
     store.run("UPDATE notification_queue SET status='sent',sent=?,attempts=attempts+1,error=NULL WHERE id=?",Date.now(),q.id);
    }catch(err){const code=/^SMTP_(?:\d{3}|[A-Z_]+)$/.test(err.message)?err.message:'SMTP_CONNECTION';store.run("UPDATE notification_queue SET status=?,attempts=attempts+1,error=?,next_try=? WHERE id=?",q.attempts>=7?'failed':'pending',code,now+Math.min(3600000,30000*2**q.attempts),q.id);}
   }
  }finally{busy=false;for(const resolve of drained)resolve();drained=[];}
 }};
}
