'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');
const path=require('node:path');const os=require('node:os');const {spawn}=require('node:child_process');const {once}=require('node:events');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function record(file){for(let i=0;i<100;i++){try{return JSON.parse(await fs.readFile(file,'utf8'));}catch{}await pause(100);}throw new Error('launcher readiness timeout');}
test('launcher reuses its instance, protects stop, and preserves data on restart',{timeout:25000},async()=>{
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'cloudtune-launch-'));const app=path.join(tmp,'app');await fs.mkdir(app);
  const root=path.resolve(__dirname,'..');
  for(const filename of await fs.readdir(root))if(filename.endsWith('.js') || filename==='package.json')await fs.copyFile(path.join(root,filename),path.join(app,filename));
  await fs.cp(path.join(root,'public'),path.join(app,'public'),{recursive:true});
  const env={...process.env,LOCALAPPDATA:path.join(tmp,'user'),NODE_PATH:path.join(root,'node_modules'),CLOUDTUNE_DATA:''};
  await fs.mkdir(path.join(env.LOCALAPPDATA,'CloudTune'),{recursive:true});
  const stale=path.join(env.LOCALAPPDATA,'CloudTune','launch.lock');await fs.writeFile(stale,'');
  const past=new Date(Date.now()-60000);await fs.utimes(stale,past,past);
  const children=[];function run(arg='start'){const child=spawn(process.execPath,[path.join(app,'launcher.js'),arg,'--no-browser'],{env,stdio:['ignore','pipe','pipe']});children.push(child);let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);return {child,done:once(child,'exit'),output:()=>output};}
  try{
    const first=run();const file=path.join(env.LOCALAPPDATA,'CloudTune','runtime.json');const initial=await record(file);assert.equal(initial.pid,first.child.pid);
    const base=`http://127.0.0.1:${initial.port}`;
    assert.equal((await fetch(base+'/api/status')).status,200);
    assert.equal((await fetch(base+'/api/app/stop',{method:'POST'})).status,403);
    assert.equal((await fetch(base+'/api/app/stop',{method:'POST',headers:{'X-CloudTune-Control':initial.controlToken,Origin:'https://example.com'}})).status,403);
    const duplicate=run();assert.equal((await duplicate.done)[0],0);assert.match(duplicate.output(),/已在运行/);
    assert.equal((await record(file)).pid,initial.pid);
    const data=path.join(env.LOCALAPPDATA,'CloudTune','data');await fs.writeFile(path.join(data,'settings.json'),' {"autoLike":false}');
    const stop=run('stop');assert.equal((await stop.done)[0],0);assert.equal((await first.done)[0],0);
    await assert.rejects(fs.access(file));await assert.rejects(fs.access(path.join(env.LOCALAPPDATA,'CloudTune','launch.lock')));
    const restarted=run();const next=await record(file);assert.notEqual(next.instanceId,initial.instanceId);
    const status=await (await fetch(`http://127.0.0.1:${next.port}/api/status`)).json();assert.equal(status.autoLike,false);
    const finalStop=run('stop');assert.equal((await finalStop.done)[0],0);assert.equal((await restarted.done)[0],0);
  }finally{for(const child of children)if(child.exitCode===null && child.signalCode===null)child.kill();await pause(100);await fs.rm(tmp,{recursive:true,force:true});}
});
