'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const path=require('node:path');const os=require('node:os');const Module=require('node:module');
const PNG=Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c636000020000050001a5f645400000000049454e44ae426082','hex');
test('recognition, CDN preview and selected album art saving work together',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ct-recognition-'));
 const originalFetch=global.fetch,originalLoad=Module._load;let server;
 process.env.CLOUDTUNE_DATA=dir;
 const song={name:'稻香',ar:[{name:'周杰伦'}],al:{name:'魔杰座',picUrl:'http://p3.music.126.net/album.jpg'},id:1};
 Module._load=function(name,...args){if(name==='@neteasecloudmusicapienhanced/api')return {cloudsearch:async()=>({body:{code:200,result:{songs:[song]}}})};return originalLoad.call(this,name,...args);};
 global.fetch=async(url,options)=>{
  if(String(url).startsWith('https://itunes.apple.com/'))return new Response(JSON.stringify({results:[]}),{status:200});
  if(String(url)==='https://p3.music.126.net/album.jpg')return new Response(PNG,{status:200,headers:{'Content-Length':String(PNG.length)}});
  return originalFetch(url,options);
 };
 try{
  server=await require('../server').start(0);const base='http://127.0.0.1:'+server.address().port;
  const post=(route,data)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  const recognition=await post('/api/metadata/recognize',{videoTitle:'周杰伦《稻香》官方MV'});assert.equal(recognition.status,200);
  const r=await recognition.json();assert.equal(r.proposal.artist,'周杰伦');assert.equal(r.proposal.artworkUrl,'https://p3.music.126.net/album.jpg');
  const preview=await fetch(base+'/api/artwork?url='+encodeURIComponent(r.proposal.artworkUrl));assert.equal(preview.status,200);assert.deepEqual(Buffer.from(await preview.arrayBuffer()),PNG);
  const unsafe=await fetch(base+'/api/artwork?url='+encodeURIComponent('https://127.0.0.1/private'));assert.equal(unsafe.status,400);
  const wav=Buffer.alloc(48);wav.write('RIFF');wav.write('WAVE',8);
  const imported=await fetch(base+'/api/import?filename=sample.wav',{method:'POST',body:wav});const entry=(await imported.json()).entry;
  const saved=await post('/api/library/metadata',{id:entry.id,...r.proposal});assert.equal(saved.status,200);assert.equal((await saved.json()).entry.coverExt,'png');
  assert.deepEqual(Buffer.from(await (await fetch(base+'/api/cover/'+entry.id)).arrayBuffer()),PNG);
  const disk=JSON.parse(await fs.readFile(path.join(dir,'library.json'),'utf8'));assert.equal(disk[0].title,'稻香');assert.equal(disk[0].coverExt,'png');
 }finally{if(server)await new Promise(resolve=>server.close(resolve));global.fetch=originalFetch;Module._load=originalLoad;await fs.rm(dir,{recursive:true,force:true});}
});
