import test from 'node:test';
import assert from 'node:assert/strict';
import tls from 'node:tls';
import net from 'node:net';
import {readFileSync} from 'node:fs';
import {sendMail} from '../server/mail.mjs';
const cert=readFileSync(new URL('./fixtures/smtp-cert.txt',import.meta.url)),key=readFileSync(new URL('./fixtures/smtp-test-key.txt',import.meta.url));
// The fixture private key is deliberately public, for localhost SMTP tests only.
async function relay(t,{mode='tls',auth='PLAIN',reject=false,trust=true}={}){
 const commands=[],messages=[],sockets=new Set();
 const wire=(socket,secure=false)=>{sockets.add(socket);socket.on('error',()=>{});socket.once('close',()=>sockets.delete(socket));let buffer='',data=false,body='',login=0;
  const onData=chunk=>{buffer+=chunk.toString();while(buffer.includes('\r\n')){const at=buffer.indexOf('\r\n'),line=buffer.slice(0,at);buffer=buffer.slice(at+2);
   if(data){if(line==='.') {data=false;messages.push(body);socket.write('250 queued\r\n');}else body+=line+'\r\n';continue;}
   commands.push(line);
   if(login){if(login===1){login=2;socket.write('334 UGFzc3dvcmQ6\r\n');}else{login=0;socket.write('235 authenticated\r\n');}}
   else if(line.startsWith('EHLO')){socket.write('250-localhost\r\n');socket.write(!secure?'250 STARTTLS\r\n':`250 AUTH ${auth}\r\n`);}
   else if(line==='STARTTLS'){socket.write('220 begin TLS\r\n');socket.off('data',onData);const encrypted=new tls.TLSSocket(socket,{isServer:true,secureContext:tls.createSecureContext({key,cert})});wire(encrypted,true);return;}
   else if(line.startsWith('AUTH PLAIN'))socket.write('235 authenticated\r\n');
   else if(line==='AUTH LOGIN'){login=1;socket.write('334 VXNlcm5hbWU6\r\n');}
   else if(line.startsWith('MAIL'))socket.write('250 sender ok\r\n');
   else if(line.startsWith('RCPT'))socket.write(reject?'550 rejected\r\n':'250 recipient ok\r\n');
   else if(line==='DATA'){data=true;socket.write('354 data\r\n');}
   else if(line==='QUIT')socket.end('221 bye\r\n');
  }};socket.on('data',onData);
 };
 const server=mode==='tls'?tls.createServer({key,cert},s=>{wire(s,true);s.write('220 test relay\r\n');}):net.createServer(s=>{wire(s);s.write('220 test relay\r\n');});
 server.on('tlsClientError',()=>{});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(async()=>{for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));});
 return {commands,messages,config:{host:'127.0.0.1',port:server.address().port,mode,from:'monitor@example.com',user:'test-user',password:'test-password',...(trust?{ca:cert}:{})}};
}
for(const mode of ['tls','starttls'])test(`SMTP ${mode}: validated certificate, auth, multiple recipients and UTF-8 MIME`,async t=>{const {config,commands,messages}=await relay(t,{mode,auth:mode==='tls'?'PLAIN':'LOGIN'});await sendMail(config,{recipients:['ops@example.com','other@example.com'],subject:'Проблема на сервере',text:'Температура CPU повышена.\n.\nДанные тестовые.'});assert.equal(messages.length,1);assert.match(messages[0],/Content-Transfer-Encoding: base64/);assert.match(Buffer.from(messages[0].split('\r\n\r\n')[1].replace(/\s/g,''),'base64').toString(),/Температура CPU повышена/);assert.equal(commands.filter(c=>c.startsWith('RCPT')).length,2);if(mode==='starttls'){const start=commands.indexOf('STARTTLS');assert.ok(start>0);assert.ok(commands.findIndex(c=>c.startsWith('AUTH'))>start);assert.equal(commands.filter(c=>c.startsWith('EHLO')).length,2);}});
test('SMTP rejects untrusted certificates before credentials',async t=>{const {config,commands}=await relay(t,{trust:false});await assert.rejects(sendMail(config,{recipients:['ops@example.com'],subject:'Test',text:'Test'}));assert.ok(!commands.some(c=>c.startsWith('AUTH')));});
test('SMTP recipient rejection is an error, not success',async t=>{const {config,messages}=await relay(t,{reject:true});await assert.rejects(sendMail(config,{recipients:['ops@example.com'],subject:'Test',text:'Test'}),/SMTP_550/);assert.equal(messages.length,0);});
test('SMTP refuses a plaintext relay without STARTTLS',async t=>{const server=net.createServer(s=>{s.on('error',()=>{});s.write('220 test\r\n');s.on('data',()=>s.write('250 no TLS\r\n'));});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));await assert.rejects(sendMail({host:'127.0.0.1',port:server.address().port,mode:'starttls',from:'test@example.com',user:'user',password:'password'},{recipients:['ops@example.com'],subject:'Test',text:'Test'}),/SMTP_TLS_REQUIRED/);});
