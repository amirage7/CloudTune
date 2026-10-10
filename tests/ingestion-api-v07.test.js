'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const path=require('node:path');const os=require('node:os');const Module=require('node:module');
test('one-click API converts, embeds metadata and cover, uploads and verifies liked state with isolated mock account',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ct07-api-'));const originalFetch=global.fetch,originalLoad=Module._load;let server,downloads=0,uploads=0,uploadStarted=false,releaseUpload,blockManualCheck=false,likeStarted=false,releaseLike;const remote=new Map(),likes=new Map();const uploadGate=new Promise(resolve=>releaseUpload=resolve),likeGate=new Promise(resolve=>releaseLike=resolve);
 const ff=path.join(__dirname,'../.packaging/ffmpeg/ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe');
 const previousFfmpeg=process.env.CLOUDTUNE_FFMPEG;process.env.CLOUDTUNE_DATA=dir;process.env.CLOUDTUNE_FFMPEG=ff;
 const wav=Buffer.alloc(44+16000);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(16000,40);
 const png=Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c636000020000050001a5f645400000000049454e44ae426082','hex');
 Module._load=function(name,...args){if(name==='@neteasecloudmusicapienhanced/api')return {
  user_account:async({cookie})=>({body:{profile:{userId:cookie.includes('second-account')?43:42,nickname:'隔离验收账号'}}}),cloudsearch:async()=>({body:{result:{songs:[]}}}),
  cloud:async({songFile,cookie})=>{uploads++;assert.equal(songFile.data.subarray(0,3).toString(),'ID3');if(uploads===1){uploadStarted=true;await uploadGate;}const songId=98+uploads;remote.set(cookie,songId);return {status:200,body:{code:200,songId}};},
  user_cloud:async({cookie})=>({body:{code:200,data:remote.has(cookie)?[{songId:remote.get(cookie)}]:[]}}),
  likelist:async({cookie})=>{if(blockManualCheck){blockManualCheck=false;likeStarted=true;await likeGate;}return {body:{code:200,ids:likes.has(cookie)?[likes.get(cookie)]:[]}};},like:async({cookie,id})=>{assert.equal(String(id),String(remote.get(cookie)));likes.set(cookie,Number(id));return {body:{code:200}};}
 };return originalLoad.call(this,name,...args);};
 global.fetch=async(url,opts)=>{const u=String(url);if(u.startsWith('https://api.bilibili.com/'))return new Response(JSON.stringify({code:0,data:{title:'测试歌手《测试歌曲》现场',desc:'演唱：测试歌手',owner:{name:'资料发布者'}}}));if(u==='https://upload.wikimedia.org/wikipedia/commons/a/a0/fixture.wav'){downloads++;return new Response(wav,{headers:{'Content-Type':'audio/wav','Content-Length':String(wav.length)}});}if(u==='https://p3.music.126.net/fixture.png')return new Response(png);if(u.startsWith('https://itunes.apple.com/'))return new Response('{"results":[]}');return originalFetch(url,opts);};
 try{
  server=await require('../server').start(0);const base='http://127.0.0.1:'+server.address().port;
  const post=(route,body)=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const video=(await (await fetch(base+'/api/search?q='+encodeURIComponent('https://www.bilibili.com/video/BV1ezVV6cE3a/'))).json()).results[0];
  assert.equal(video.title,'测试歌手《测试歌曲》现场');assert.equal(video.category,'live');assert.equal(video.artist,'资料发布者');assert.equal(downloads,0);
  const q='https://upload.wikimedia.org/wikipedia/commons/a/a0/fixture.wav';
  const searched=await (await fetch(base+'/api/search?q='+encodeURIComponent(q))).json();assert.equal(downloads,0,'search must not fetch audio');
  assert.equal((await post('/api/login/session',{cookie:'MUSIC_U=isolated-test-only-123456789'})).status,200);
  const input={sourceId:searched.results[0].id,metadata:{title:'测试歌曲',artist:'测试歌手',album:'测试专辑',artworkUrl:'https://p3.music.126.net/fixture.png'},confirmedRights:false};
  assert.equal((await post('/api/ingest',input)).status,400);assert.equal(downloads,0);
  const preview=await fetch(base+'/api/source/listen/'+input.sourceId);assert.equal(preview.status,200);assert.equal((await preview.arrayBuffer()).byteLength,wav.length);assert.equal((await (await fetch(base+'/api/library')).json()).tracks.length,0,'preview cannot save to library');assert.equal((await (await fetch(base+'/api/tasks')).json()).tasks.length,0,'preview cannot create ingest task');downloads=0;
  input.confirmedRights=true;const submitted=await post('/api/ingest',input);assert.equal(submitted.status,202);const result=await submitted.json();const id=result.task.id;
  for(let i=0;i<100&&!uploadStarted;i++)await new Promise(r=>setTimeout(r,50));assert.equal(uploadStarted,true);
  const secondCookie='MUSIC_U=second-account-isolated-123456789';assert.equal((await post('/api/login/session',{cookie:secondCookie})).status,200);releaseUpload();
  let task;for(let i=0;i<120;i++){task=(await (await fetch(base+'/api/tasks')).json()).tasks.find(t=>t.id===id);if(['done','failed','partial'].includes(task.status))break;await new Promise(r=>setTimeout(r,100));}
  assert.equal(task.status,'done',task.error||task.message);assert.equal(downloads,1);assert.equal(uploads,1);assert.equal(task.uploadVerified,true);assert.equal(task.likedStatus,'liked');
  assert.equal(task.accountId,'42');assert.equal(likes.has(secondCookie),false,'switching accounts during upload cannot like under the new account');
  const library=(await (await fetch(base+'/api/library')).json()).tracks;assert.equal(library[0].format,'MP3');assert.equal(library[0].title,'测试歌曲');assert.equal(library[0].coverExt,'png');assert.equal(library[0].cloudStatus,'local','account A upload must not appear uploaded under B');
  const audio=await fetch(base+'/api/listen/'+task.entryId,{headers:{Range:'bytes=0-10'}});assert.equal(audio.status,206);
  assert.equal((await post('/api/tasks/'+id+'/retry',{})).status,400);assert.equal(uploads,1);
  const b=(await (await post('/api/ingest',input)).json()).task;for(let i=0;i<100;i++){task=(await (await fetch(base+'/api/tasks')).json()).tasks.find(t=>t.id===b.id);if(['done','failed','partial'].includes(task.status))break;await new Promise(r=>setTimeout(r,100));}
  assert.equal(task.status,'done',task.error);assert.equal(task.accountId,'43');assert.equal(uploads,2,'B needs its own upload');assert.equal(downloads,1,'reuse local file across account uploads');assert.equal(likes.get(secondCookie),100);
  assert.equal((await post('/api/login/session',{cookie:'MUSIC_U=isolated-test-only-123456789'})).status,200);
  const again=(await (await post('/api/ingest',input)).json()).task;for(let i=0;i<100;i++){task=(await (await fetch(base+'/api/tasks')).json()).tasks.find(t=>t.id===again.id);if(['done','failed','partial'].includes(task.status))break;await new Promise(r=>setTimeout(r,100));}
  assert.equal(task.status,'done',task.error);assert.equal(uploads,2,'returning to A must reuse its verified upload');
  blockManualCheck=true;const pendingLike=post('/api/cloud/like',{id:task.entryId});for(let i=0;i<100&&!likeStarted;i++)await new Promise(r=>setTimeout(r,20));assert.equal(likeStarted,true);
  await post('/api/login/session',{cookie:secondCookie});assert.equal((await post('/api/cloud/upload',{id:task.entryId})).status,409,'manual like must lock out concurrent upload under another account');releaseLike();assert.equal((await pendingLike).status,200);assert.equal(uploads,2);
 }finally{if(server){await server.cloudTuneStop();}global.fetch=originalFetch;Module._load=originalLoad;if(previousFfmpeg===undefined)delete process.env.CLOUDTUNE_FFMPEG;else process.env.CLOUDTUNE_FFMPEG=previousFfmpeg;await fs.rm(dir,{recursive:true,force:true});}
});
