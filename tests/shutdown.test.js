'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');const {spawn}=require('node:child_process');
const {manager}=require('../bilibili-mp3');
test('Windows shutdown ends the downloader and its conversion descendant',{skip:process.platform!=='win32',timeout:15000},async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'cloudtune-stop-tree-'));let child;let descendant;
 try{
  await fs.mkdir(path.join(tmp,'tools'));for(const exe of ['yt-dlp.exe','ffmpeg.exe'])await fs.writeFile(path.join(tmp,'tools',exe),'fixture');
  const spawned=new Promise(resolve=>{
   const m=manager({root:tmp,tracksDir:tmp,addFile:async()=>{throw new Error('cancelled tasks must not import');},uploadToCloud:async()=>{},spawnImpl:()=>{
    child=spawn(process.execPath,['-e',`const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});console.log('CHILD='+c.pid);setInterval(()=>{},1000);`],{stdio:['ignore','pipe','pipe'],windowsHide:true});
    child.stdout.once('data',b=>{descendant=Number(b.toString().match(/CHILD=(\d+)/)[1]);resolve(m);});return child;
   }});
   m.start({url:'https://www.bilibili.com/video/BV1ezVV6cE3a/',title:'测试'}).catch(()=>{});
  });
  const m=await spawned;assert.doesNotThrow(()=>process.kill(descendant,0));m.shutdown();
  for(let i=0;i<50;i++){try{process.kill(descendant,0);}catch{descendant=null;break;}await new Promise(r=>setTimeout(r,50));}
  assert.equal(descendant,null,'converter descendant should stop');
 }finally{child?.kill();if(descendant)try{process.kill(descendant);}catch{}await new Promise(r=>setTimeout(r,100));await fs.rm(tmp,{recursive:true,force:true});}
});
