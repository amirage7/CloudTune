'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs/promises');const path=require('node:path');const os=require('node:os');
const {spawnSync}=require('node:child_process');
const {detectImage,fetchArtwork,findExactCandidate,validateArtworkUrl}=require('../cover-art');
const {writeTags,extractCover}=require('../mp3-tags');
const {parseVideoResults,normalizeThumbnail}=require('../bilibili');
const PNG=Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c636000020000050001a5f645400000000049454e44ae426082','hex');
test('album art accepts image formats and refuses spoofed URL or arbitrary payload',async()=>{
 assert.equal(detectImage(PNG).mime,'image/png');
 assert.throws(()=>detectImage(Buffer.from('<html>oops')),/JPG \/ PNG/);
 assert.throws(()=>validateArtworkUrl('https://127.0.0.1/internal'),/Apple/);
 assert.throws(()=>validateArtworkUrl('https://is1-ssl.mzstatic.com.evil.com/foo'),/Apple/);
 const cover=await fetchArtwork('https://is1-ssl.mzstatic.com/image/thumb/foo.jpg',async()=>({ok:true,headers:{get:()=>String(PNG.length)},body:(async function*(){yield PNG})()}));
 assert.equal(cover.mime,'image/png');assert.equal(cover.bytes.length,PNG.length);
});
test('exact cover selection requires identical title and artist',()=>{
 const suggestions=[{title:'稻香',artist:'周杰伦',artworkUrl:'https://is1-ssl.mzstatic.com/x.jpg'}, {title:'稻香',artist:'翻唱歌手',artworkUrl:'https://is1-ssl.mzstatic.com/y.jpg'}];
 assert.equal(findExactCandidate(suggestions,'稻香','周杰伦'),suggestions[0]);
 assert.equal(findExactCandidate(suggestions,'稻香','未知歌手'),null);
});
test('Bilibili thumbnail URLs are validated and parsed',()=>{
 const entries=parseVideoResults({data:{result:[{bvid:'BV1xx411c7mD',title:'一纸情书',pic:'//i0.hdslb.com/bfs/archive/foo.jpg',author:'up'}]}});
 assert.equal(entries[0].thumbnailUrl,'https://i0.hdslb.com/bfs/archive/foo.jpg');
 assert.equal(normalizeThumbnail('https://hacker.com/cover.jpg'),'');
});
test('MP3 writer inserts and replaces APIC cover art',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'cloudtune-art-'));const file=path.join(dir,'song.mp3');
 try{const ff=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','sine=frequency=400:duration=0.25','-codec:a','libmp3lame','-y',file],{encoding:'utf8'});
 assert.equal(ff.status,0,ff.stderr);
 await writeTags(file,{title:'稻香',artist:'周杰伦',album:'魔杰座'},PNG);
 assert.ok(extractCover(await fs.readFile(file)).equals(PNG));
 await writeTags(file,{title:'晴天',artist:'周杰伦',album:'叶惠美'});
 assert.ok(extractCover(await fs.readFile(file)).equals(PNG));
 const probe=spawnSync('ffprobe',['-v','error','-show_entries','format_tags=title,artist,album','-of','json',file],{encoding:'utf8'});
 assert.equal(probe.status,0,probe.stderr);assert.equal(JSON.parse(probe.stdout).format.tags.title,'晴天');
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('no mandatory per-song rights checkbox remains',async()=>{
 const markup=await fs.readFile(path.join(__dirname,'..','public','index.html'),'utf8');
 const app=await fs.readFile(path.join(__dirname,'..','public','app.js'),'utf8');
 assert.ok(!markup.includes('bili-rights'));assert.ok(!app.includes('bili-rights'));
 assert.ok(markup.includes('player-modal'));assert.ok(app.includes('player.bilibili.com/player.html'));
});
