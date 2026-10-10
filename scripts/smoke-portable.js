'use strict';
const fs=require('node:fs/promises');const path=require('node:path');const assert=require('node:assert/strict');
const {spawn,spawnSync}=require('node:child_process');const {once}=require('node:events');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){
 const app=path.resolve(process.argv[2]);const work=await fs.mkdtemp(path.join(__dirname,'..','.packaging','smoke-'));const node=path.join(app,'runtime','node.exe');const children=[];
 const env={...process.env,PATH:`${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`,NODE_PATH:'',CLOUDTUNE_DATA:'',CLOUDTUNE_NO_BROWSER:'1',LOCALAPPDATA:path.join(work,'user-one')};
 function run(exe,args){const r=spawnSync(exe,args,{cwd:app,env,encoding:'utf8',windowsHide:true,timeout:20000});assert.equal(r.status,0,r.stderr);return r.stdout.trim();}
 function launch(user=env.LOCALAPPDATA,stop=false,batch=false){const child=spawn(batch?process.env.ComSpec:node,batch?['/d','/c','启动 CloudTune.bat']:[path.join(app,'launcher.js'),stop?'stop':'start','--no-browser'],{cwd:app,env:{...env,LOCALAPPDATA:user},stdio:['ignore','pipe','pipe'],windowsHide:true});children.push(child);let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);return {child,done:once(child,'exit'),output:()=>output};}
 async function ready(user){for(let i=0;i<100;i++){try{const r=JSON.parse(await fs.readFile(path.join(user,'CloudTune','runtime.json'),'utf8'));const res=await fetch(`http://127.0.0.1:${r.port}/api/health`);if(res.ok)return r;}catch{}await pause(100);}throw new Error('startup timeout');}
 const firstUser=env.LOCALAPPDATA;const otherUser=path.join(work,'user-two');
 try{
  const versions={node:run(node,['--version']),ytDlp:run(path.join(app,'tools','yt-dlp.exe'),['--version']),ffmpeg:run(path.join(app,'tools','ffmpeg.exe'),['-version']).split('\n')[0]};
  assert.match(versions.node,/v22\.23\.3/);assert.match(versions.ytDlp,/2026\.08\.19/);
  assert.match(run(node,['-e',`const sdk=require(${JSON.stringify(path.join(app,'node_modules','@neteasecloudmusicapienhanced','api'))});if(typeof sdk.login_qr_key!=='function')process.exit(1);console.log('SDK_READY')`]),/SDK_READY$/);
  const mp3=path.join(work,'test.mp3');run(path.join(app,'tools','ffmpeg.exe'),['-hide_banner','-loglevel','error','-f','lavfi','-i','sine=frequency=440:duration=0.2','-codec:a','libmp3lame','-q:a','4',mp3]);
  const first=launch(firstUser,false,true);const info=await ready(firstUser);const base=`http://127.0.0.1:${info.port}`;
  assert.equal((await fetch(base)).status,200);
  let status=await (await fetch(base+'/api/status')).json();assert.equal(status.connected,false);assert.equal(status.localCount,0);assert.equal(status.biliTools.ready,true);assert.equal(status.sdkInstalled,true);
  const duplicate=launch();assert.equal((await duplicate.done)[0],0);assert.match(duplicate.output(),/已在运行/);
  const uploaded=await fetch(base+'/api/import?filename=test.mp3',{method:'POST',body:await fs.readFile(mp3)});assert.equal(uploaded.status,200);const entry=(await uploaded.json()).entry;
  const png=Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c636000020000050001a5f645400000000049454e44ae426082','hex');
  assert.equal((await fetch(base+'/api/library/cover?id='+entry.id,{method:'POST',body:png})).status,200);
  const audio=await fetch(base+'/api/listen/'+entry.id,{headers:{Range:'bytes=0-63'}});assert.equal(audio.status,206);assert.equal((await audio.arrayBuffer()).byteLength,64);
  const second=launch(otherUser);const other=await ready(otherUser);assert.notEqual(other.port,info.port);const secondStatus=await (await fetch(`http://127.0.0.1:${other.port}/api/status`)).json();assert.equal(secondStatus.localCount,0);assert.equal(secondStatus.connected,false);
  const otherStop=launch(otherUser,true);assert.equal((await otherStop.done)[0],0);assert.equal((await second.done)[0],0);
  const stop=launch(firstUser,true);assert.equal((await stop.done)[0],0);assert.equal((await first.done)[0],0);
  const restarted=launch();const next=await ready(firstUser);const nextBase=`http://127.0.0.1:${next.port}`;status=await (await fetch(nextBase+'/api/status')).json();assert.equal(status.localCount,1);
  assert.deepEqual(Buffer.from(await (await fetch(nextBase+'/api/cover/'+entry.id)).arrayBuffer()),png);
  assert.equal((await fetch(nextBase+'/api/listen/'+entry.id)).status,200);
  const finalStop=launch(firstUser,true);assert.equal((await finalStop.done)[0],0);assert.equal((await restarted.done)[0],0);
  console.log(JSON.stringify({passed:true,versions,checks:['packaged BAT startup with system-only PATH','SDK loading','bundled real MP3 conversion','fresh empty account','duplicate startup','local import and range playback','MP3 cover embedding','two independent user directories','restart music and cover retention','clean shutdown']},null,2));
 }finally{for(const child of children)if(child.exitCode===null && child.signalCode===null)child.kill();await pause(200);await fs.rm(work,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
