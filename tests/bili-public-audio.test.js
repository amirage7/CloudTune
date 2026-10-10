'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {resolvePublicAudio}=require('../bilibili-mp3');
const fs=require('node:fs/promises');const path=require('node:path');const os=require('node:os');const {EventEmitter}=require('node:events');
const {manager}=require('../bilibili-mp3');
const url='https://www.bilibili.com/video/BV1MwYg6tEsR/?p=2';
const view={code:0,data:{bvid:'BV1MwYg6tEsR',title:'花海',duration:200,rights:{download:1},pages:[{cid:11,duration:200},{cid:22,duration:180}]}};
const play={code:0,data:{timelength:180000,dash:{audio:[{baseUrl:'https://cdn.bilivideo.com/audio.m4a?token=temporary',codecs:'mp4a.40.2',bandwidth:176000}]}}};
function fetching(v=view,p=play){return async (input,options)=>{const u=new URL(input);assert.equal(u.hostname,'api.bilibili.com');assert.equal(options.headers,undefined,'public API requests must not inherit media/browser headers');assert.equal(options.redirect,'error');if(u.pathname.endsWith('/view'))return {ok:true,json:async()=>v};assert.equal(u.searchParams.get('cid'),'22');return {ok:true,json:async()=>p};};}
test('public audio resolution uses selected part and returns only approved audio CDN',async()=>{
 const info=await resolvePublicAudio(url,{fetchImpl:fetching()});assert.equal(info.duration,180);assert.equal(info.vcodec,'none');assert.equal(info.ext,'m4a');assert.match(info.url,/cdn.bilivideo.com/);
});
test('412 fallback completes the conversion worker and removes its temporary signed manifest',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'ct-public-worker-'));await fs.mkdir(path.join(root,'tools'));
 for(const tool of ['yt-dlp','ffmpeg'])await fs.writeFile(path.join(root,'tools',tool+(process.platform==='win32'?'.exe':'')),'fixture');
 let imported=false,manifestPath;
 const spawnImpl=(exe,args)=>{const c=new EventEmitter();c.stdout=new EventEmitter();c.stderr=new EventEmitter();c.kill=()=>{};
  setImmediate(async()=>{try{if(args.includes('--skip-download')){c.stderr.emit('data',Buffer.from('HTTP Error 412'));c.emit('close',1);return;}
   assert.ok(args.includes('--load-info-json'));manifestPath=args[args.indexOf('--load-info-json')+1];const info=JSON.parse(await fs.readFile(manifestPath,'utf8'));assert.equal(info.duration,180);assert.equal(args.includes('--cookies'),false);
   await fs.writeFile(args[args.indexOf('--output')+1].replace('%(ext)s','mp3'),Buffer.alloc(256));c.emit('close',0);
  }catch(e){c.emit('error',e);}});return c;};
 try{const m=manager({root,tracksDir:root,spawnImpl,fetchImpl:fetching(),addFile:async(file,name,meta)=>{assert.equal((await fs.stat(file)).size,256);imported=true;return {entry:{id:'test',title:meta.title}};}});
  const start=await m.start({url,title:'花海',artist:'周杰伦'});let job;for(let i=0;i<100;i++){job=m.get(start.id);if(['done','error'].includes(job.stage))break;await new Promise(r=>setTimeout(r,10));}
  assert.equal(job.stage,'done',JSON.stringify(job));assert.equal(imported,true);for(let i=0;i<100;i++){if(!await fs.access(manifestPath).then(()=>true,()=>false))break;await new Promise(r=>setTimeout(r,10));}await assert.rejects(fs.access(manifestPath));
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('public resolution rejects paid and download-disabled videos before requesting media',async()=>{
 for(const rights of [{pay:1},{ugc_pay:1},{arc_pay:1},{download:0}])await assert.rejects(resolvePublicAudio(url,{fetchImpl:fetching({...view,data:{...view.data,rights}})}),/限制/);
});
test('public resolution rejects missing part, unsafe CDN and unavailable audio',async()=>{
 await assert.rejects(resolvePublicAudio(url.replace('p=2','p=3'),{fetchImpl:fetching()}),/分P/);
 for(const audio of [[],[{baseUrl:'https://127.0.0.1/private',codecs:'mp4a.40.2'}],[{baseUrl:'https://evil.bilivideo.com.evil.test/a',codecs:'mp4a.40.2'}],[{baseUrl:'https://user:password@cdn.bilivideo.com/a',codecs:'mp4a.40.2'}]])await assert.rejects(resolvePublicAudio(url,{fetchImpl:fetching(view,{code:0,data:{dash:{audio}}})}),/音轨/);
});
