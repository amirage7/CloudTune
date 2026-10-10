'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const path=require('node:path');const os=require('node:os');
const {createIngestion}=require('../ingestion');
async function settled(manager,id){for(let i=0;i<150;i++){const t=manager.list().find(x=>x.id===id);if(['done','partial','failed','cancelled'].includes(t.status))return t;await new Promise(r=>setTimeout(r,10));}throw new Error('task timeout');}
test('failed upload retains acquired file; retry and restart never reacquire or repeat successful upload',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ct07-task-'));let downloads=0,uploads=0;let fail=true;
 const hooks={account:()=>({connected:true,id:'42'}),acquire:async()=>{downloads++;return {id:'file-1'};},prepare:async()=>({id:'file-1'}),upload:async()=>{uploads++;if(fail)throw new Error('network');return {id:'file-1',cloudStatus:'uploaded',uploadVerified:true,likedStatus:'liked',coverExt:'jpg'};}};
 try{
  const m=createIngestion(dir,hooks);await m.init();
  assert.throws(()=>m.submit({source:{id:'source'},metadata:{title:'歌曲',artist:'歌手'},confirmedRights:false}),/权限/);
  const t=m.submit({source:{id:'source'},metadata:{title:'歌曲',artist:'歌手'},confirmedRights:true});
  assert.equal((await settled(m,t.id)).status,'failed');assert.equal(downloads,1);
  fail=false;await m.retry(t.id);assert.equal((await settled(m,t.id)).status,'done');assert.equal(downloads,1);assert.equal(uploads,2);
  await m.close();const restored=createIngestion(dir,hooks);await restored.init();assert.equal(restored.list()[0].entryId,'file-1');
  await assert.rejects(restored.retry(t.id),/已完成/);
  await restored.close();
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
