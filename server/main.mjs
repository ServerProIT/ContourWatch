import {mkdirSync,existsSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomBytes} from 'node:crypto';
import {Store} from './core.mjs';import {createApp} from './http.mjs';
const demo=process.argv.includes('--demo'),dir=resolve(process.env.DATA_DIR||'data');mkdirSync(dir,{recursive:true});
const keyFile=resolve(dir,'admin.key');if(!process.env.ADMIN_KEY&&!existsSync(keyFile))writeFileSync(keyFile,randomBytes(32).toString('base64url'),{mode:0o600});
const adminKey=process.env.ADMIN_KEY||readFileSync(keyFile,'utf8').trim();const store=new Store(resolve(dir,demo?'demo.db':'contour.db'));
let demoTimer;if(demo){const {seedDemo,advanceDemo}=await import('./seed.mjs');seedDemo(store);demoTimer=setInterval(()=>{try{advanceDemo(store);}catch(e){console.error('Demo:',e.name);}},15000);}
const host=process.env.HOST||'127.0.0.1',port=Number(process.env.PORT||8080);
const server=createApp(store,{adminKey,viewerKey:process.env.VIEWER_KEY,secureCookies:process.env.SECURE_COOKIES==='1',demo});
server.listen(port,host,()=>console.log(`ContourWatch ${demo?'[ДЕМО] ':''}http://${host}:${port}\nКлюч администратора: ${process.env.ADMIN_KEY?'из окружения':keyFile}`));
const tick=setInterval(()=>{try{store.tick();}catch(e){console.error('Event evaluation:',e.name);}},30000),prune=setInterval(()=>{try{store.prune();}catch(e){console.error('Retention:',e.name);}},3600000);
function stop(){clearInterval(tick);clearInterval(prune);clearInterval(demoTimer);server.close(()=>{store.close();process.exit(0);});setTimeout(()=>process.exit(1),10000).unref();}process.on('SIGINT',stop);process.on('SIGTERM',stop);
