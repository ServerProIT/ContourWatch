const repository='https://api.github.com/repos/ServerProIT/ContourWatch';
const base='https://github.com/ServerProIT/ContourWatch/releases/download/';
const cache=new Map();
async function limited(url,max){const response=await fetch(url,{headers:{'User-Agent':'ContourWatch-updates','Accept':'application/vnd.github+json'},signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('Release unavailable');const reader=response.body.getReader(),chunks=[];let length=0;try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>max)throw Error('Release response limit');chunks.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>{});}return Buffer.concat(chunks).toString('utf8');}
export async function releaseManifest(channel='stable'){
 const old=cache.get(channel);if(old&&old.until>Date.now())return old.promise;
 const promise=(async()=>{const releases=JSON.parse(await limited(repository+'/releases?per_page=30',3000000));const release=releases.find(r=>!r.draft&&/^agent-\d+\.\d+\.\d+(?:-pilot\.\d+)?$/.test(r.tag_name)&&(channel==='pilot'||!r.prerelease&&!r.tag_name.includes('-pilot.')));if(!release)return {available:false};
  const [manifest,signature]=await Promise.all([limited(base+release.tag_name+'/manifest.json',65536),limited(base+release.tag_name+'/manifest.sig',2048)]);return {available:true,manifest,signature:signature.trim()};})();
 cache.set(channel,{until:Date.now()+15*60000,promise});try{return await promise;}catch(e){cache.delete(channel);throw e;}
}
