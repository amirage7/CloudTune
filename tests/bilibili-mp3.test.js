'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const fsp=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {spawnSync}=require('node:child_process');
const {normalizeBiliUrl,convertArguments,toolsStatus,manager}=require('../bilibili-mp3');

const sample='https://www.bilibili.com/video/BV1xx411c7mD/';
test('accepts only strict Bilibili video links and strips unrelated query parameters',()=>{
  assert.equal(normalizeBiliUrl(sample+'?spm_id_from=abc&p=2'),'https://www.bilibili.com/video/BV1xx411c7mD/?p=2');
  assert.equal(normalizeBiliUrl('https://bilibili.com/video/av12345'),'https://www.bilibili.com/video/av12345');
  for(const bad of ['http://www.bilibili.com/video/BV1xx411c7mD','https://www.bilibili.com.evil.example/video/BV1xx411c7mD','https://www.bilibili.com@evil.example/video/BV1xx411c7mD','https://127.0.0.1/video/BV1xx411c7mD','file:///etc/passwd','https://b23.tv/abcdef','https://www.bilibili.com/bangumi/play/ep123','https://www.bilibili.com/video/BV1xx411c7mD/?p=-1'])assert.throws(()=>normalizeBiliUrl(bad));
});
test('conversion command requests MP3 and no playlist, no cookies, no shell command',()=>{
  const args=convertArguments(sample,'/tmp/audio.%(ext)s','/usr/bin/ffmpeg');
  assert.ok(args.includes('--extract-audio'));assert.ok(args.includes('mp3'));assert.ok(args.includes('--no-playlist'));
  assert.ok(!args.includes('--cookies-from-browser'));assert.ok(!args.includes('--cookies'));
  assert.equal(args[args.length-1],sample);
});
test('download requires valid Bilibili URL and installed tools without an extra checkbox',async()=>{
  const root=await fsp.mkdtemp(path.join(os.tmpdir(),'cloudtune-no-tools-'));
  const oldEnv={PATH:process.env.PATH,CLOUDTUNE_YTDLP:process.env.CLOUDTUNE_YTDLP,CLOUDTUNE_FFMPEG:process.env.CLOUDTUNE_FFMPEG};
  process.env.PATH='';delete process.env.CLOUDTUNE_YTDLP;delete process.env.CLOUDTUNE_FFMPEG;
  const downloads=manager({root,tracksDir:root,addFile:async()=>{throw new Error('must not be reached')},uploadToCloud:async()=>{}});
  try{
    await assert.rejects(downloads.start({url:'https://127.0.0.1/private'}),/视频链接/);
    assert.equal(toolsStatus({root}).ready,false);
    await assert.rejects(downloads.start({url:sample}),/缺少下载组件/);
  }finally{for(const [key,value] of Object.entries(oldEnv)){if(value===undefined)delete process.env[key];else process.env[key]=value;}await fsp.rm(root,{recursive:true,force:true});}
});
test('local conversion worker completes an MP3 task with a fake downloader and genuine FFmpeg media', {skip:process.platform==='win32'},async()=>{
  const root=await fsp.mkdtemp(path.join(os.tmpdir(),'cloudtune-bili-integration-'));
  const tools=path.join(root,'tools');await fsp.mkdir(tools);
  let saved=null;
  try{
    const ff=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','sine=frequency=440:duration=1','-codec:a','libmp3lame','-qscale:a','4',path.join(root,'input.mp3')],{encoding:'utf8',timeout:15000});
    if(ff.status!==0)throw new Error('ffmpeg fixture generation failed: '+ff.stderr);
    await fsp.symlink('/usr/bin/ffmpeg',path.join(tools,'ffmpeg'));
    const fake='#!/usr/bin/env node\nconst fs=require("node:fs");const args=process.argv.slice(2);if(args.includes("--skip-download")){console.log(JSON.stringify({url:"https://example.test/audio",duration:1,ext:"mp3",acodec:"mp3"}));process.exit(0);}const output=args[args.indexOf("--output")+1].replace("%(ext)s","mp3");console.log("[download] 100.0% of 20KB");fs.copyFileSync(process.env.MOCK_MP3,output);console.log("[ExtractAudio] Destination: "+output);\n';
    await fsp.writeFile(path.join(tools,'yt-dlp'),fake,{mode:0o755});
    process.env.MOCK_MP3=path.join(root,'input.mp3');
    const m=manager({root,tracksDir:root,addFile:async(file,name,meta)=>{saved={file,name,meta};const bytes=await fsp.readFile(file);assert.ok(bytes[0]===0x49&&bytes[1]===0x44||bytes[0]===0xff);return {entry:{id:'mock-music-1',title:meta.title,name},duplicate:false};},uploadToCloud:async()=>{}});
    assert.equal(m.tools().ready,true);
    const started=await m.start({url:sample,title:'测试歌曲',artist:'测试歌手'});assert.ok(started.id);
    let result;for(let i=0;i<60;i++){result=m.get(started.id);if(['done','error'].includes(result.stage))break;await new Promise(r=>setTimeout(r,100));}
    assert.equal(result.stage,'done',JSON.stringify(result));assert.equal(result.progress,100);
    assert.equal(result.entry.title,'测试歌曲');assert.match(saved.name,/\.mp3$/);
    assert.equal(saved.meta.pageUrl,sample);
    assert.equal(fs.existsSync(path.dirname(saved.file)),false,'temporary conversion directory is cleaned');
  }finally{delete process.env.MOCK_MP3;await fsp.rm(root,{recursive:true,force:true});}
});
