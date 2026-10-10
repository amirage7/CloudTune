'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs/promises');const path=require('node:path');const os=require('node:os');const {spawnSync}=require('node:child_process');
const PNG=Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c636000020000050001a5f645400000000049454e44ae426082','hex');
test('music art upload, ID3 APIC and local player support HTTP byte ranges',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ct06-endpoint-'));
 const file=path.join(dir,'audio.mp3');
 const r=spawnSync('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=440:duration=0.6','-c:a','libmp3lame',file],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
 process.env.CLOUDTUNE_DATA=dir;
 // Load server after configuring isolated test storage.
 const mod=require('../server');const server=await mod.start(0);const base='http://127.0.0.1:'+server.address().port;
 try{
   const importRes=await fetch(base+'/api/import?filename=audio.mp3',{method:'POST',body:await fs.readFile(file)});assert.equal(importRes.status,200);
   const entry=(await importRes.json()).entry;
   const edit=await fetch(base+'/api/library/metadata',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:entry.id,title:'稻香',artist:'周杰伦',album:'魔杰座'})});assert.equal(edit.status,200);
   const picture=await fetch(base+'/api/library/cover?id='+encodeURIComponent(entry.id),{method:'POST',headers:{'Content-Type':'image/png'},body:PNG});assert.equal(picture.status,200);
   const updated=(await picture.json()).entry;assert.equal(updated.coverExt,'png');
   const cover=await fetch(base+'/api/cover/'+entry.id);assert.equal(cover.status,200);assert.equal(cover.headers.get('content-type'),'image/png');assert.ok(Buffer.from(await cover.arrayBuffer()).equals(PNG));
   const player=await fetch(base+'/api/listen/'+entry.id,{headers:{Range:'bytes=0-99'}});assert.equal(player.status,206);assert.equal(player.headers.get('content-type'),'audio/mpeg');assert.match(player.headers.get('content-range'),/^bytes 0-99\//);assert.equal((await player.arrayBuffer()).byteLength,100);
   const out=Buffer.from(await (await fetch(base+'/api/file/'+entry.id)).arrayBuffer());assert.ok(out.includes(Buffer.from('APIC')));
   const invalid=await fetch(base+'/api/library/cover?id='+entry.id,{method:'POST',body:Buffer.from('not an image')});assert.equal(invalid.status,400);
 }finally{await new Promise(ok=>server.close(ok));await fs.rm(dir,{recursive:true,force:true});}
});
