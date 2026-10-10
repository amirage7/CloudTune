'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');const {EventEmitter}=require('node:events');const {inspectSource}=require('../bilibili-mp3');
test('preflight obtains metadata without downloading and rejects protected or live sources',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ct-preflight-'));await fs.mkdir(path.join(dir,'tools'));await fs.writeFile(path.join(dir,'tools','yt-dlp'+(process.platform==='win32'?'.exe':'')),'fixture');
 try{for(const info of [{url:'https://example.test/audio',duration:180,ext:'m4a',acodec:'aac'},{url:'x',has_drm:true},{url:'x',is_live:true},{duration:1}]){
  const spawnImpl=(exe,args,options)=>{assert.ok(args.includes('--skip-download'));assert.ok(args.includes('--ignore-config'));assert.equal(options.shell,false);assert.equal(args.at(-2),'--');const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.kill=()=>{};queueMicrotask(()=>{child.stdout.emit('data',Buffer.from(JSON.stringify(info)));child.emit('close',0);});return child;};
  const result=inspectSource('https://www.bilibili.com/video/BV1ezVV6cE3a/',{root:dir,spawnImpl});
  if(info.acodec)assert.equal((await result).duration,180);else await assert.rejects(result,/音源检查失败/);
 }}finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('HTTP 412 is reported explicitly instead of discarded',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ct-preflight-error-'));await fs.mkdir(path.join(dir,'tools'));await fs.writeFile(path.join(dir,'tools','yt-dlp'+(process.platform==='win32'?'.exe':'')),'fixture');
 try{const spawnImpl=()=>{const c=new EventEmitter();c.stdout=new EventEmitter();c.stderr=new EventEmitter();c.kill=()=>{};queueMicrotask(()=>{c.stderr.emit('data',Buffer.from('ERROR: Unable to download webpage: HTTP Error 412: Precondition Failed'));c.emit('close',1);});return c;};
 await assert.rejects(inspectSource('https://www.bilibili.com/video/BV1MwYg6tEsR/',{root:dir,spawnImpl,fetchImpl:async()=>({ok:false,status:412})}),/HTTP 412/);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('stalled inspection times out, kills worker and reports visible waiting progress',{timeout:2000},async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ct-preflight-timeout-'));await fs.mkdir(path.join(dir,'tools'));await fs.writeFile(path.join(dir,'tools','yt-dlp'+(process.platform==='win32'?'.exe':'')),'fixture');let killed=false;const progress=[];
 try{const spawnImpl=()=>{const c=new EventEmitter();c.stdout=new EventEmitter();c.stderr=new EventEmitter();c.kill=()=>{killed=true;};return c;};
 await assert.rejects(inspectSource('https://www.bilibili.com/video/BV1MwYg6tEsR/',{root:dir,spawnImpl,timeoutMs:60,progressIntervalMs:10,onProgress:m=>progress.push(m)}),/超时/);
 assert.equal(killed,true);assert.ok(progress.some(m=>/检查.*自动下载/.test(m)));
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
