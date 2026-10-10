'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const fsp=require('node:fs/promises');const path=require('node:path');const os=require('node:os');
const {spawnSync}=require('node:child_process');
const data=fs.mkdtempSync(path.join(os.tmpdir(),'ct05-route-'));
process.env.CLOUDTUNE_DATA=data;
const {start}=require('../server');
test('V0.5 UI, settings and metadata-edit endpoint work together',async()=>{
  const server=await start(0),base=`http://127.0.0.1:${server.address().port}`;
  const jsonPost=(route,data)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  try{
    const ui=await (await fetch(base+'/')).text();
    assert.match(ui,/LOCAL · V0\.7/);assert.match(ui,/meta-title/);assert.match(ui,/auto-like/);
    const script=await (await fetch(base+'/app.js')).text();assert.match(script,/retryLike/);
    let status=await (await fetch(base+'/api/status')).json();assert.equal(status.autoLike,true);
    assert.equal((await jsonPost('/api/settings',{jamendoClientId:'keep-me'})).status,200);
    assert.equal((await jsonPost('/api/settings',{autoLike:false})).status,200);
    const prefs=JSON.parse(await fsp.readFile(path.join(data,'settings.json'),'utf8'));
    assert.equal(prefs.jamendoClientId,'keep-me','toggling like should not erase Jamendo config');
    assert.equal(prefs.autoLike,false);
    status=await (await fetch(base+'/api/status')).json();assert.equal(status.autoLike,false);
    const missing=await jsonPost('/api/library/metadata',{id:'unknown',title:'稻香',artist:'周杰伦'});
    assert.equal(missing.status,404);
    const cloud=await jsonPost('/api/cloud/like',{id:'unknown'});assert.equal(cloud.status,401);
    if(spawnSync('ffmpeg',['-version'],{encoding:'utf8'}).status===0){
      const pathMp3=path.join(data,'fixture.mp3');
      const gen=spawnSync('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=400:duration=0.3','-c:a','libmp3lame',pathMp3],{encoding:'utf8',timeout:15000});
      assert.equal(gen.status,0,gen.stderr);
      const imp=await fetch(base+'/api/import?filename=video-title.mp3',{method:'POST',body:await fsp.readFile(pathMp3)});
      assert.equal(imp.status,200);const impObj=await imp.json();
      const edited=await jsonPost('/api/library/metadata',{id:impObj.entry.id,title:'稻香',artist:'周杰伦',album:'魔杰座'});
      assert.equal(edited.status,200);const result=await edited.json();
      assert.equal(result.entry.title,'稻香');assert.equal(result.entry.artist,'周杰伦');assert.equal(result.entry.album,'魔杰座');
      const formatted=await (await fetch(base+'/api/file/'+impObj.entry.id)).arrayBuffer();
      assert.ok(formatted.byteLength>0);
      const fp=path.join(data,'edited.mp3');await fsp.writeFile(fp,Buffer.from(formatted));
      const probe=spawnSync('ffprobe',['-v','quiet','-show_entries','format_tags=artist,title,album','-of','json',fp],{encoding:'utf8',timeout:8000});
      assert.equal(probe.status,0,probe.stderr);
      const tags=JSON.parse(probe.stdout).format.tags;
      assert.equal(tags.title,'稻香');assert.equal(tags.artist,'周杰伦');assert.equal(tags.album,'魔杰座');
    }
  } finally {await new Promise(r=>server.close(r));await fsp.rm(data,{recursive:true,force:true});}
});
