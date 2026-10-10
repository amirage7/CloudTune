'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs/promises');const path=require('node:path');const os=require('node:os');
const {spawn}=require('node:child_process');
const SECRET='MUSIC_U=test-session-secret-123456789';
const childCode=`
const Module=require('node:module'),original=Module._load;
Module._load=function(name,...args){if(name==='@neteasecloudmusicapienhanced/api')return {
user_account:async()=>{if(process.env.REMOTE==='offline')throw new Error('offline');if(process.env.REMOTE==='expired')return {body:{code:301}};return {body:{code:200,profile:{userId:42,nickname:'测试账号'}}};},
login_qr_key:async()=>({body:{data:{unikey:'qr-key'}}}),login_qr_create:async()=>({body:{data:{qrimg:'test-image'}}}),
login_qr_check:async()=>({body:{code:803,cookie:${JSON.stringify(SECRET)}}})
};return original.call(this,name,...args);};
require('./server').start(0).then(s=>{console.log('TEST_PORT='+s.address().port);process.on('message',()=>s.close(()=>process.exit(0)));});`;
async function launch(dir,remote='valid'){
 const child=spawn(process.execPath,['-e',childCode],{cwd:path.join(__dirname,'..'),env:{...process.env,CLOUDTUNE_DATA:dir,REMOTE:remote},stdio:['ignore','pipe','pipe','ipc'],windowsHide:true});
 const base=await new Promise((resolve,reject)=>{let output='';const timeout=setTimeout(()=>{child.kill();reject(new Error('startup timeout'));},20000);child.stdout.on('data',b=>{output+=b;const m=output.match(/TEST_PORT=(\d+)/);if(m){clearTimeout(timeout);resolve('http://127.0.0.1:'+m[1]);}});child.once('exit',code=>{clearTimeout(timeout);reject(new Error('startup exit '+code));});});
 return {base,stop:()=>new Promise(resolve=>{child.once('exit',resolve);child.send('stop');})};
}
const post=(base,url,data={})=>fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
test('login, library, covers and settings survive real process restarts; logout only clears login',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ct-persist-'));let app;
 try{
  app=await launch(dir);
  assert.equal((await post(app.base,'/api/login/session',{cookie:SECRET})).status,200);
  const saved=await fs.readFile(path.join(dir,'session.json'),'utf8');assert.ok(!saved.includes(SECRET));assert.ok(!saved.includes('test-session-secret'));
  const wav=Buffer.alloc(48);wav.write('RIFF');wav.writeUInt32LE(40,4);wav.write('WAVE',8);
  const imported=await fetch(app.base+'/api/import?filename=retained.wav',{method:'POST',body:wav});assert.equal(imported.status,200);const entry=(await imported.json()).entry;
  const png=Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c636000020000050001a5f645400000000049454e44ae426082','hex');
  assert.equal((await fetch(app.base+'/api/library/cover?id='+entry.id,{method:'POST',body:png})).status,200);
  await post(app.base,'/api/settings',{autoLike:false});await app.stop();app=await launch(dir);
  let status=await (await fetch(app.base+'/api/status')).json();assert.equal(status.connected,true);assert.equal(status.account,'测试账号');assert.equal(status.localCount,1);assert.equal(status.autoLike,false);
  assert.deepEqual(Buffer.from(await (await fetch(app.base+'/api/file/'+entry.id)).arrayBuffer()),wav);
  assert.deepEqual(Buffer.from(await (await fetch(app.base+'/api/cover/'+entry.id)).arrayBuffer()),png);
  await post(app.base,'/api/logout');await assert.rejects(fs.access(path.join(dir,'session.json')));await app.stop();app=await launch(dir);
  status=await (await fetch(app.base+'/api/status')).json();assert.equal(status.connected,false);assert.equal(status.localCount,1);
  await post(app.base,'/api/login/start');const qr=await (await fetch(app.base+'/api/login/poll')).json();assert.equal(qr.connected,true);
  await app.stop();app=await launch(dir,'offline');assert.equal((await (await fetch(app.base+'/api/status')).json()).connected,true);
  await app.stop();app=await launch(dir,'expired');assert.equal((await (await fetch(app.base+'/api/status')).json()).connected,false);await assert.rejects(fs.access(path.join(dir,'session.json')));
  await app.stop();await fs.writeFile(path.join(dir,'session.json'),'{broken');app=await launch(dir);
  status=await (await fetch(app.base+'/api/status')).json();assert.equal(status.connected,false);assert.equal(status.localCount,1);
 }finally{if(app)await app.stop();await fs.rm(dir,{recursive:true,force:true});}
});
