'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const tempPath=require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(),'cloudtune-test-'));
process.env.CLOUDTUNE_DATA=tempPath;
const {start,safeName,fileFormat,fetchApproved}=require('../server');
const {isApprovedSource,resultsShape,searchAll}=require('../sources');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');

test('filename sanitization and audio extension',()=>{
  assert.equal(safeName('a<b>c.mp3'),'a_b_c.mp3');
  assert.equal(fileFormat('music.FLAC'),'flac');
  assert.equal(fileFormat('music.exe'),'');
});
test('only approved HTTPS hosts',()=>{
  assert.equal(isApprovedSource('https://upload.wikimedia.org/a.ogg'),true);
  assert.equal(isApprovedSource('https://prod-1.storage.jamendo.com/download/track/1/mp32/'),true);
  assert.equal(isApprovedSource('https://ia903234.us.archive.org/file.mp3'),true);
  assert.equal(isApprovedSource('http://upload.wikimedia.org/a.ogg'),false);
  assert.equal(isApprovedSource('https://archive.org.evil.example/test.mp3'),false);
  assert.equal(isApprovedSource('http://127.0.0.1/secrets'),false);
});
test('source adapters merge valid hits and tolerate partial failures',async()=>{
  const a=resultsShape({title:'Song',url:'https://upload.wikimedia.org/audio.mp3',source:'Wikimedia Commons'});
  const r=await searchAll('jazz','',{commons:async()=>[a],archive:async()=>{throw new Error('暂时不可用');},jamendo:async()=>[]});
  assert.equal(r.hits.length,1);assert.equal(r.errors.length,1);
});
test('local app serves UI, imports a sample and deduplicates',async()=>{
    const server=await start(0);
  const base=`http://127.0.0.1:${server.address().port}`;
  try{
    const ui=await fetch(base+'/');assert.equal(ui.status,200);assert.match(await ui.text(),/CloudTune/);
    const s=await fetch(base+'/api/status');assert.equal(s.status,200);const payload=await s.json();assert.equal(payload.connected,false);
    const file=Buffer.from('ID3'+ 'x'.repeat(120));
    const a=await fetch(base+'/api/import?filename='+encodeURIComponent('Example.mp3'),{method:'POST',body:file});assert.equal(a.status,200,await a.text().catch(()=>''));
    // Repeat import to confirm a dedup response.
    const b=await fetch(base+'/api/import?filename='+encodeURIComponent('Example.mp3'),{method:'POST',body:file});assert.equal(b.status,200);const again=await b.json();assert.equal(again.duplicate,true);
    const lib=await (await fetch(base+'/api/library')).json();assert.equal(lib.tracks.length>=1,true);
    const invalid=await fetch(base+'/api/import?filename=not-audio.mp3',{method:'POST',body:Buffer.from('<html>not music</html>')});assert.equal(invalid.status,400);
    const denied=await fetch(base+'/api/logout',{method:'POST',headers:{Origin:'https://evil.example'}});assert.equal(denied.status,403);
    const noCloud=await fetch(base+'/api/cloud/upload',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:again.entry.id})});assert.equal(noCloud.status,401);
  }finally{await new Promise(resolve=>server.close(resolve));await fs.rm(tempPath,{recursive:true,force:true});}
});

test('catalog records do not masquerade as downloadable audio',async()=>{
  const {resultsShape}=require('../sources');
  const song=resultsShape({title:'晴天',artist:'周杰伦',source:'Apple 音乐目录（仅信息）',pageUrl:'https://music.apple.com/xx',downloadable:false,format:'目录'});
  assert.equal(song.downloadable,false);
  assert.equal(song.url,'');
  assert.equal(isApprovedSource('https://cdn.freesound.org/sound.mp3'),true);
  assert.equal(isApprovedSource('https://127.0.0.1/a.mp3'),false);
  assert.equal(isApprovedSource('https://freesound.org.evil.tld/a.mp3'),false);
});

test('all-source searches separate discovery from downloadable records',async()=>{
  const {resultsShape}=require('../sources');
  const free=resultsShape({title:'Test audio',url:'https://upload.wikimedia.org/audio.mp3',source:'Commons'});
  const info=resultsShape({title:'Test audio',pageUrl:'https://music.apple.com/track',downloadable:false,source:'Apple'});
  const r=await searchAll('test','',{commons:async()=>[],archive:async()=>[],openverse:async()=>[info],catalog:async()=>[free],jamendo:async()=>[]});
  assert.equal(r.hits.length,2);
  assert.equal(r.hits[0].downloadable,true);
  assert.equal(r.hits[1].downloadable,false);
});

test('invalid session token is rejected locally without invoking SDK',async()=>{
  const server=await start(0);
  try{
    const url=`http://127.0.0.1:${server.address().port}/api/login/session`;
    const invalid=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cookie:'not-a-cookie'})});
    assert.equal(invalid.status,400);
    const remote=await fetch(url,{method:'POST',headers:{'Origin':'https://example.com','Content-Type':'application/json'},body:JSON.stringify({cookie:'MUSIC_U='+'A'.repeat(64)})});
    assert.equal(remote.status,403);
  } finally {await new Promise(resolve=>server.close(resolve));}
});

test('Bilibili converter API reports installed tools and rejects unsafe requests before download',async()=>{
  const server=await start(0);
  const base=`http://127.0.0.1:${server.address().port}`;
  const postBili=data=>fetch(base+'/api/bilibili/mp3',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  try{
    const status=await fetch(base+'/api/bilibili/tools');assert.equal(status.status,200);
    const t=await status.json();assert.equal(typeof t.ready,'boolean');
    const denied=await postBili({url:'https://www.bilibili.com/video/BV1xx411c7mD/'});assert.ok([202,503].includes(denied.status));
    const hostile=await postBili({url:'https://evil.example/video/BV1xx411c7mD/'});assert.equal(hostile.status,400);
    const noAccount=await postBili({url:'https://www.bilibili.com/video/BV1xx411c7mD/',syncToCloud:true});assert.equal(noAccount.status,401);
    const missing=await fetch(base+'/api/bilibili/jobs/not-a-job');assert.equal(missing.status,404);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
