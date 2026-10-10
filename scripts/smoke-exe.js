'use strict';
const fs=require('node:fs/promises');const path=require('node:path');const assert=require('node:assert/strict');const {spawn,spawnSync}=require('node:child_process');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function main(){const exe=path.resolve(process.argv[2]||'release/CloudTune-0.7.4-Windows-x64.exe');await fs.access(exe);const work=await fs.mkdtemp(path.join(__dirname,'../.packaging/exe-smoke-'));const env={...process.env,LOCALAPPDATA:path.join(work,'用户 空白'),CLOUDTUNE_NO_BROWSER:'1',PATH:process.env.SystemRoot+'\\System32;'+process.env.SystemRoot};const children=[];
 function run(arg){const c=spawn(exe,[arg],{env,windowsHide:true,stdio:'ignore'});children.push(c);return c;}
 async function exit(c){if(c.exitCode!==null)return c.exitCode;return new Promise((r,j)=>{const timer=setTimeout(()=>j(new Error('EXE exit timeout')),20000);c.once('exit',code=>{clearTimeout(timer);r(code);});c.once('error',j);});}
 async function ready(){for(let i=0;i<350;i++){try{const record=JSON.parse(await fs.readFile(path.join(env.LOCALAPPDATA,'CloudTune/runtime.json'),'utf8'));const base='http://127.0.0.1:'+record.port;const response=await fetch(base+'/api/health');if(response.ok)return {record,base};}catch{}await pause(100);}throw new Error('EXE startup timeout');}
 let extracted;
 try{assert.equal(await exit(run('--extract-only')),0);const apps=path.join(env.LOCALAPPDATA,'CloudTune/app');extracted=path.join(apps,(await fs.readdir(apps)).find(x=>!x.startsWith('.')));assert.ok(extracted);assert.equal(await fs.access(path.join(extracted,'data')).then(()=>true,()=>false),false);
  const first=run('--no-window');const initial=await ready();let status=await (await fetch(initial.base+'/api/status')).json();assert.equal(status.connected,false);assert.equal(status.localCount,0);
  const duplicate=run('--no-window');assert.equal(await exit(duplicate),0);assert.equal((await ready()).record.pid,initial.record.pid);
  const audio=path.join(work,'fixture.mp3');const generated=spawnSync(path.join(extracted,'tools/ffmpeg.exe'),['-hide_banner','-loglevel','error','-f','lavfi','-i','sine=frequency=440:duration=0.2','-codec:a','libmp3lame',audio],{env,windowsHide:true,encoding:'utf8'});assert.equal(generated.status,0,generated.stderr);
  const saved=await fetch(initial.base+'/api/import?filename=fixture.mp3',{method:'POST',body:await fs.readFile(audio)});assert.equal(saved.status,200);const entry=(await saved.json()).entry;
  assert.equal(await exit(run('--stop')),0);assert.equal(await exit(first),0);
  const again=run('--no-window');const next=await ready();status=await (await fetch(next.base+'/api/status')).json();assert.equal(status.localCount,1);assert.equal((await fetch(next.base+'/api/listen/'+entry.id)).status,200);
  assert.equal(await exit(run('--stop')),0);assert.equal(await exit(again),0);
  assert.equal((await fs.readdir(apps)).length,1,'second launch reuses extracted components');console.log(JSON.stringify({passed:true,checks:['single EXE extraction','Chinese/spaced user path','no installed runtime needed','fresh account','double launch reuse','MP3 import','restart retains music','local playback','graceful stop','cached components reuse']}));
 }finally{for(const c of children)if(c.exitCode===null)c.kill();await fs.rm(work,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
