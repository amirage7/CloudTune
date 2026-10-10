'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {ensureLiked,identifyUploadedSong,lookupCloudSongId,numberId}=require('../netease-like');
const {titleFromVideo,writeTags,metadataBuffer}=require('../mp3-tags');
const {searchMetadataCandidates}=require('../sources');
test('cloud candidate matching refuses ambiguous uploads and incorrect ids',()=>{
  assert.equal(numberId('1234567890'),'1234567890');assert.equal(numberId('abc'),'');
  const entry={name:'周杰伦 - 稻香.mp3',title:'稻香',artist:'周杰伦'};
  const rows=[{songId:987,songName:'稻香',artist:'周杰伦',fileName:'周杰伦 - 稻香.mp3'}];
  assert.equal(identifyUploadedSong({songId:987},rows,entry),'987');
  assert.equal(identifyUploadedSong({},rows,entry),'987');
  assert.equal(identifyUploadedSong({},[...rows,{...rows[0],songId:988}],entry),'');
  assert.equal(identifyUploadedSong({songId:100},rows,entry),'987','songId must exist in authenticated cloud rows');
});
test('cloud lookup enforces authenticated cloud list response',async()=>{
  const entry={name:'周杰伦 - 稻香.mp3',title:'稻香',artist:'周杰伦'};
  const sdk={user_cloud:async()=>({body:{code:200,data:[{songId:123,songName:'稻香',artist:'周杰伦'}]}})};
  assert.equal(await lookupCloudSongId(sdk,'test',entry,{}),'123');
  await assert.rejects(lookupCloudSongId({user_cloud:async()=>({body:{code:403}})},'test',entry,{}),/云盘/);
});
test('auto-like verifies liked list, not just successful API response',async()=>{
  let count=0;let liked=false;
  const sdk={likelist:async()=>({body:{code:200,ids:liked?[321]:[]}}),like:async()=>{count++;liked=true;return {body:{code:200}}}};
  const result=await ensureLiked({sdk,cookie:'private',userId:1,songId:321});
  assert.equal(result.liked,true);assert.equal(count,1);
  const next=await ensureLiked({sdk,cookie:'private',userId:1,songId:321});assert.equal(next.skipped,true);assert.equal(count,1);
  const dishonest={likelist:async()=>({body:{code:200,ids:[]}}),like:async()=>({body:{code:200}})};
  await assert.rejects(ensureLiked({sdk:dishonest,cookie:'private',userId:1,songId:321}),/喜欢未确认/);
});
test('Bilibili title cleaning extracts song name but does not invent an artist',()=>{
  assert.equal(titleFromVideo('【Hi-Res无损音质】｜《稻香》- 周杰伦 - 4K'),'稻香');
  assert.match(metadataBuffer({title:'稻香',artist:'周杰伦',album:'魔杰座'}).toString('ascii',0,3),/ID3/);
});
test('search suggestions require human selection and include album metadata',async()=>{
  const matches=await searchMetadataCandidates('稻香',async()=>({results:[{trackName:'稻香',artistName:'周杰伦',collectionName:'魔杰座'}]}));
  assert.deepEqual(matches,[{title:'稻香',artist:'周杰伦',album:'魔杰座',artworkUrl:'',source:'Apple 音乐目录（仅用于核对信息）'}]);
});
test('ID3 tags survive audio remux and preserve embedded cover artwork',async()=>{
  if(spawnSync('ffmpeg',['-version'],{encoding:'utf8'}).status!==0)return;
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ct05-tags-'));
  const mp3=path.join(dir,'demo.mp3');
  try{
    const made=spawnSync('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=440:duration=1','-c:a','libmp3lame','-qscale:a','4',mp3],{encoding:'utf8',timeout:20000});
    assert.equal(made.status,0,made.stderr);
    // prepend a syntactically valid ID3v2.3 APIC frame, then check cover frame survives tag edits.
    const picture=Buffer.concat([Buffer.from([0]),Buffer.from('image/png\0','ascii'),Buffer.from([3,0]),Buffer.from('FAKE_PNG_CONTENT','ascii')]);
    const apicHead=Buffer.alloc(10);apicHead.write('APIC');apicHead.writeUInt32BE(picture.length,4);
    const tagPayload=Buffer.concat([apicHead,picture]);
    const id3Head=Buffer.from([73,68,51,3,0,0,0,0,0,tagPayload.length]);
    await fs.writeFile(mp3,Buffer.concat([id3Head,tagPayload,await fs.readFile(mp3)]));
    const first=await writeTags(mp3,{title:'稻香',artist:'周杰伦',album:'魔杰座'});
    assert.ok((await fs.readFile(mp3)).includes(Buffer.from('FAKE_PNG_CONTENT')),'existing APIC frame should survive');
    assert.ok(first.size>0);assert.equal(first.sha256.length,64);
    const meta=spawnSync('ffprobe',['-v','error','-show_entries','format_tags=title,artist,album','-of','json',mp3],{encoding:'utf8'});
    assert.equal(meta.status,0,meta.stderr);
    const tags=JSON.parse(meta.stdout).format.tags;
    assert.equal(tags.title,'稻香');assert.equal(tags.artist,'周杰伦');assert.equal(tags.album,'魔杰座');
    // Additional empty frames shouldn't corrupt the MP3 payload.
    const updated=await writeTags(mp3,{title:'晴天',artist:'周杰伦',album:'叶惠美'});
    assert.ok(updated.size>0);
    const tags2=JSON.parse(spawnSync('ffprobe',['-v','error','-show_entries','format_tags=title','-of','json',mp3],{encoding:'utf8'}).stdout).format.tags;
    assert.equal(tags2.title,'晴天');
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('fallback adds an uploaded cloud ID only to the special liked playlist and verifies it',async()=>{
  let added=false;
  const calls=[];
  const sdk={
    likelist:async()=>({body:{code:200,ids:[]}}),
    like:async()=>({body:{code:401,message:'云盘歌曲不能直接喜欢'}}),
    user_playlist:async()=>({body:{code:200,playlist:[
      {id:300,name:'我的普通歌单',specialType:0,creator:{userId:42}},
      {id:900,name:'我喜欢的音乐',specialType:5,creator:{userId:42}}
    ]}}),
    playlist_detail:async()=>({body:{code:200,playlist:{trackIds:added?[{id:888}]:[]}}}),
    playlist_tracks:async arg=>{calls.push(arg);added=true;return {body:{code:200}};}
  };
  const r=await ensureLiked({sdk,cookie:'secret',userId:42,songId:888});
  assert.equal(r.method,'playlist');assert.equal(r.verifiedBy,'playlist');
  assert.equal(calls.length,1);assert.equal(String(calls[0].pid),'900');
  assert.equal(String(calls[0].tracks),'888');
});

test('fallback refuses to guess the liked playlist, or trust a success response without list confirmation',async()=>{
  let count=0;
  const sdk={
    likelist:async()=>({body:{code:200,ids:[]}}),
    like:async()=>({body:{code:400}}),
    user_playlist:async()=>({body:{code:200,playlist:[{id:555,name:'喜欢',specialType:0}]}}),
    playlist_tracks:async()=>{count++;return {body:{code:200}};}
  };
  await assert.rejects(ensureLiked({sdk,cookie:'secret',userId:42,songId:888}),/无法唯一识别/);
  assert.equal(count,0);
  sdk.user_playlist=async()=>({body:{code:200,playlist:[{id:555,specialType:5}]}});
  sdk.playlist_detail=async()=>({body:{code:200,playlist:{trackIds:[]}}});
  await assert.rejects(ensureLiked({sdk,cookie:'secret',userId:42,songId:888}),/列表没有这首歌/);
  assert.equal(count,1);
});

test('cloud ID matching supports the corrected upload filename instead of old Bilibili title',()=>{
  const entry={name:'【无损音质】稻香 B站.mp3',title:'稻香',artist:'周杰伦',format:'MP3'};
  const rows=[{songId:777,fileName:'周杰伦 - 稻香.mp3',songName:'未知歌曲',artist:'未知'}];
  assert.equal(identifyUploadedSong({},rows,entry),'777');
});
