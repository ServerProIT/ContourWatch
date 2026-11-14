import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {Store,validate} from '../server/core.mjs';import {createApp} from '../server/http.mjs';
test('revoked device immediately changes fleet status and cannot send or re-register',()=>{
 const s=new Store();try{const p={token:s.token().token,name:'TEST',os:'Windows',version:'0.1.2',requestId:randomUUID(),deviceSecret:'a'.repeat(43)};const d=s.register(p);
 s.ingest(d.id,{batchId:randomUUID(),measuredAt:new Date().toISOString(),metrics:[]});s.maintain(d.id,true);
 s.run('UPDATE devices SET revoked=1 WHERE id=?',d.id);
 assert.equal(s.devices()[0].status,'revoked');assert.throws(()=>s.auth(d.id,d.secret),e=>e.status===401);assert.throws(()=>s.register(p),e=>e.status===403);
 assert.equal(s.history(d.id).length,1);
 }finally{s.close();}
});
test('CPU and GPU metrics have distinct types, thresholds and protocol capability',()=>{
 const s=new Store();try{s.saveSettings({holdSeconds:0,gpuHigh:80,gpuClear:75});const d=s.register({token:s.token().token,name:'GPU',os:'Windows',version:'0.1.2'});
 const metrics=[{id:'cpu',kind:'temperature',name:'CPU Package',value:45,state:'ok',source:'LHM'},
 {id:'gpu',kind:'gpu_temperature',name:'RTX 5070',value:85,state:'ok',source:'nvidia-smi'},
 {id:'gpu-fan',kind:'gpu_fan',name:'GPU fans',value:0,state:'ok',source:'nvidia-smi',unit:'%'}];
 const r=s.ingest(d.id,{batchId:randomUUID(),measuredAt:new Date().toISOString(),metrics});assert.equal(r.capabilities.extendedSensors,true);
 assert.equal(s.events(d.id).length,1);assert.match(s.events(d.id)[0].title,/GPU/);assert.equal(s.events(d.id)[0].rule,'gpu_temperature:gpu');
 }finally{s.close();}
});
test('GPU percentage/memory validation rejects invalid values',()=>{
 for(const [kind,value]of [['gpu_load',101],['gpu_fan',-1],['gpu_memory_used',-1],['cpu_load',101]]){
 assert.throws(()=>validate({batchId:'test',measuredAt:new Date().toISOString(),metrics:[{id:kind,name:kind,kind,state:'ok',value,source:'test'}]}),e=>e.status===400);
 }
});
test('API error logs correlate requests without credentials, headers, query strings or payloads',async t=>{
 const records=[],s=new Store(),app=createApp(s,{adminKey:'admin-key-at-least-32-characters',secureCookies:false,logger:r=>records.push(r)});
 await new Promise(r=>app.listen(0,'127.0.0.1',r));t.after(async()=>{app.closeAllConnections();await new Promise(r=>app.close(r));s.close();});
 const response=await fetch(`http://127.0.0.1:${app.address().port}/api/login?secret=DO_NOT_LOG`,{method:'POST',headers:{'content-type':'application/json',Authorization:'Bearer DO_NOT_LOG'},body:JSON.stringify({key:'DO_NOT_LOG'})});
 assert.equal(response.status,401);await response.json();assert.equal(records.length,1);assert.equal(records[0].requestId,response.headers.get('x-request-id'));assert.equal(records[0].path,'/api/login');assert.equal(JSON.stringify(records).includes('DO_NOT_LOG'),false);
});
