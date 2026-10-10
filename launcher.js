'use strict';
const fs=require('node:fs/promises');const path=require('node:path');const os=require('node:os');
const crypto=require('node:crypto');const {spawn}=require('node:child_process');
const {prepareData}=require('./data-location');
const state=path.join(process.env.LOCALAPPDATA || path.join(os.homedir(),'AppData','Local'),'CloudTune');
const runtimeFile=path.join(state,'runtime.json');const lockFile=path.join(state,'launch.lock');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function read(file){try{return JSON.parse(await fs.readFile(file,'utf8'));}catch{return null;}}
function alive(pid){if(!Number.isInteger(pid)||pid<1)return false;try{process.kill(pid,0);return true;}catch(e){return e.code==='EPERM';}}
async function running(){
  const record=await read(runtimeFile);if(!record || !alive(record.pid) || !Number.isInteger(record.port) || record.port<1 || record.port>65535)return null;
  try{const r=await fetch(`http://127.0.0.1:${record.port}/api/health`,{signal:AbortSignal.timeout(1500)});const body=await r.json();return r.ok && body.app==='CloudTune' && body.instanceId===record.instanceId?record:null;}catch{return null;}
}
function openBrowser(port){
  const url=`http://127.0.0.1:${port}`;console.log(`浏览器地址：${url}`);
  if(process.argv.includes('--no-browser') || process.env.CLOUDTUNE_NO_BROWSER==='1')return;
  const child=spawn('explorer.exe',[url],{windowsHide:true,stdio:'ignore',detached:true});
  child.on('error',()=>console.log('未能自动打开浏览器，请复制上面的地址打开。'));child.unref();
}
async function stop(){
  const record=await running();if(!record){console.log('CloudTune 当前未运行。');return;}
  const r=await fetch(`http://127.0.0.1:${record.port}/api/app/stop`,{method:'POST',headers:{'X-CloudTune-Control':record.controlToken},signal:AbortSignal.timeout(5000)});
  if(!r.ok)throw new Error('停止失败，请在启动窗口按 Ctrl+C。');
  for(let i=0;i<50;i++){if(!alive(record.pid)){console.log('CloudTune 已停止，音乐和登录记录已保留。');return;}await pause(100);}
  throw new Error('正在结束后台任务，请稍后重试。');
}
async function launch(){
  await fs.mkdir(state,{recursive:true});let lock;
  for(let attempt=0;attempt<120;attempt++){
    const active=await running();if(active){console.log('CloudTune 已在运行，打开现有窗口。');openBrowser(active.port);return;}
    try{lock=await fs.open(lockFile,'wx',0o600);await lock.writeFile(JSON.stringify({pid:process.pid}));break;}
    catch(e){
      if(e.code!=='EEXIST')throw e;
      const owner=await read(lockFile);const stat=await fs.stat(lockFile).catch(()=>null);
      // Recover an interrupted lock write only after the startup window has elapsed.
      if((owner && !alive(owner.pid)) || (!owner && stat && Date.now()-stat.mtimeMs>30000))await fs.unlink(lockFile).catch(()=>{});
      else await pause(250);
    }
  }
  if(!lock)throw new Error('另一个启动窗口仍在准备，请稍后再试。');
  let server;const instanceId=crypto.randomUUID();let cleaning=false;
  async function cleanup(){if(cleaning)return;cleaning=true;const current=await read(runtimeFile);if(current?.instanceId===instanceId)await fs.unlink(runtimeFile).catch(()=>{});await lock.close();const owner=await read(lockFile);if(owner?.pid===process.pid)await fs.unlink(lockFile).catch(()=>{});}
  try{
    console.log('正在准备 CloudTune，请稍候…');
    process.env.CLOUDTUNE_DATA=await prepareData(__dirname,state);
    const controlToken=crypto.randomBytes(32).toString('hex');
    const {start}=require('./server');server=await start(0,{instanceId,controlToken});
    const record={pid:process.pid,port:server.address().port,instanceId,controlToken};
    const temp=runtimeFile+'.tmp';await fs.writeFile(temp,JSON.stringify(record),{mode:0o600});await fs.rename(temp,runtimeFile);
    server.once('close',()=>cleanup().then(()=>process.exit(0)));
    for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>server.cloudTuneStop());
    console.log(`音乐库保存位置：${process.env.CLOUDTUNE_DATA}`);
    console.log('使用结束请关闭此运行窗口；按 Ctrl+C 可正常停止服务。只关闭网页不会停止服务。');
    openBrowser(record.port);
  }catch(e){if(server)server.close();await cleanup();throw e;}
}
if(require.main===module)(process.argv[2]==='stop'?stop():launch()).catch(e=>{console.error(`启动/停止失败：${e.message}`);process.exitCode=1;});
module.exports={launch,stop,running};
